import { spawn, exec } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import fs from "node:fs";
import { withLock } from "../ipc/utils/lock_utils";
import { readSettings, writeSettings } from "../main/settings";
import { simpleSpawn } from "../ipc/utils/simpleSpawn";
import {
  SupabaseManagementAPI,
  SupabaseManagementAPIError,
} from "@dyad-sh/supabase-management-js";
import log from "electron-log";
import { IS_TEST_BUILD } from "../ipc/utils/test_utils";

const logger = log.scope("supabase_management_client");
const execPromise = promisify(exec);

const SUPABASE_CLI_POLL_INTERVAL_MS = 1_000;
const SUPABASE_CLI_WAIT_TIMEOUT_MS = 5 * 60_000; // 5 minutes
const SUPABASE_SERVE_RUN_DURATION_MS = 10_000;
const SUPABASE_SERVE_FORCE_KILL_DELAY_MS = 4_000;

type SupabaseCliLocation = {
  command: string;
  rawPath: string;
  source: "env" | "local" | "global";
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function quoteCommand(command: string): string {
  if (command.includes("\"")) {
    command = command.replace(/"/g, '\\"');
  }
  if (/(\s)/.test(command)) {
    return `"${command}"`;
  }
  return command;
}

function getLocalSupabaseCli(appPath: string): SupabaseCliLocation | undefined {
  const binName = process.platform === "win32" ? "supabase.cmd" : "supabase";
  const localPath = path.join(appPath, "node_modules", ".bin", binName);

  if (fs.existsSync(localPath)) {
    return {
      command: quoteCommand(localPath),
      rawPath: localPath,
      source: "local",
    };
  }

  if (process.platform === "win32") {
    const exePath = path.join(appPath, "node_modules", ".bin", "supabase.exe");
    if (fs.existsSync(exePath)) {
      return {
        command: quoteCommand(exePath),
        rawPath: exePath,
        source: "local",
      };
    }
  }

  return undefined;
}

async function getGlobalSupabaseCli(): Promise<SupabaseCliLocation | undefined> {
  const lookupCommand = process.platform === "win32" ? "where supabase" : "which supabase";

  try {
    const { stdout } = await execPromise(lookupCommand, { windowsHide: true });
    const candidate = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    if (candidate) {
      return {
        command: quoteCommand(candidate),
        rawPath: candidate,
        source: "global",
      };
    }
  } catch (error) {
    logger.debug(
      `Global Supabase CLI lookup failed using command "${lookupCommand}": ${String(
        error,
      )}`,
    );
  }

  return undefined;
}

async function waitForSupabaseCli(appPath: string): Promise<SupabaseCliLocation> {
  const envOverride = process.env.SUPABASE_CLI_PATH?.trim();
  if (envOverride) {
    logger.info(
      `Using Supabase CLI path from SUPABASE_CLI_PATH environment variable: ${envOverride}`,
    );
    return {
      command: quoteCommand(envOverride),
      rawPath: envOverride,
      source: "env",
    };
  }

  const start = Date.now();
  let loggedWaiting = false;

  while (Date.now() - start < SUPABASE_CLI_WAIT_TIMEOUT_MS) {
    const location = getLocalSupabaseCli(appPath) ?? (await getGlobalSupabaseCli());
    if (location) {
      logger.info(
        `Supabase CLI detected (${location.source}) at ${location.rawPath}`,
      );
      return location;
    }

    if (!loggedWaiting) {
      logger.info(
        "Supabase CLI not found yet. Waiting for installation to complete before running commands...",
      );
      loggedWaiting = true;
    }

    await sleep(SUPABASE_CLI_POLL_INTERVAL_MS);
  }

  throw new Error(
    "Supabase CLI not found. Install it with `pnpm add -D supabase` or `npm install --save-dev supabase` before running Supabase functions.",
  );
}

async function runSupabaseServeCommand({
  command,
  cwd,
  successMessage,
  errorPrefix,
}: {
  command: string;
  cwd: string;
  successMessage: string;
  errorPrefix: string;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    logger.info(`Running: ${command}`);
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      const output = data.toString();
      stdout += output;
      logger.info(output);
    });

    child.stderr?.on("data", (data) => {
      const output = data.toString();
      stderr += output;
      logger.error(output);
    });

    const gracefulTimeout = setTimeout(() => {
      if (!child.killed) {
        logger.info(
          `Stopping Supabase serve command after ${SUPABASE_SERVE_RUN_DURATION_MS}ms`,
        );
        child.kill();
      }
    }, SUPABASE_SERVE_RUN_DURATION_MS);

    const forceTimeout = setTimeout(() => {
      if (!child.killed) {
        logger.warn("Supabase serve process did not terminate gracefully; forcing exit.");
        child.kill("SIGKILL");
      }
    }, SUPABASE_SERVE_RUN_DURATION_MS + SUPABASE_SERVE_FORCE_KILL_DELAY_MS);

    const cleanup = () => {
      clearTimeout(gracefulTimeout);
      clearTimeout(forceTimeout);
    };

    child.on("error", (err) => {
      cleanup();
      const errorMessage = `${errorPrefix}: ${err.message}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;
      reject(new Error(errorMessage));
    });

    child.on("close", (code, signal) => {
      cleanup();
      if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") {
        logger.info(successMessage);
        resolve();
        return;
      }

      const exitDetails =
        code !== null ? `exit code ${code}` : signal ? `signal ${signal}` : "unknown exit";
      const errorMessage = `${errorPrefix} (${exitDetails})\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;
      reject(new Error(errorMessage));
    });
  });
}

/**
 * Checks if the Supabase access token is expired or about to expire
 * Returns true if token needs to be refreshed
 */
function isTokenExpired(expiresIn?: number): boolean {
  if (!expiresIn) return true;

  // Get when the token was saved (expiresIn is stored at the time of token receipt)
  const settings = readSettings();
  const tokenTimestamp = settings.supabase?.tokenTimestamp || 0;
  const currentTime = Math.floor(Date.now() / 1000);

  // Check if the token is expired or about to expire (within 5 minutes)
  return currentTime >= tokenTimestamp + expiresIn - 300;
}

/**
 * Refreshes the Supabase access token using the refresh token
 * Updates settings with new tokens and expiration time
 */
export async function refreshSupabaseToken(): Promise<void> {
  const settings = readSettings();
  const refreshToken = settings.supabase?.refreshToken?.value;

  if (!isTokenExpired(settings.supabase?.expiresIn)) {
    return;
  }

  if (!refreshToken) {
    throw new Error(
      "Supabase refresh token not found. Please authenticate first.",
    );
  }

  try {
    // Make request to Supabase refresh endpoint
    const response = await fetch(
      "https://supabase-oauth.dyad.sh/api/connect-supabase/refresh",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refreshToken }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Supabase token refresh failed. Try going to Settings to disconnect Supabase and then reconnect to Supabase. Error status: ${response.statusText}`,
      );
    }

    const {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn,
    } = await response.json();

    // Update settings with new tokens
    writeSettings({
      supabase: {
        accessToken: {
          value: accessToken,
        },
        refreshToken: {
          value: newRefreshToken,
        },
        expiresIn,
        tokenTimestamp: Math.floor(Date.now() / 1000), // Store current timestamp
      },
    });
  } catch (error) {
    logger.error("Error refreshing Supabase token:", error);
    throw error;
  }
}

// Function to get the Supabase Management API client
export async function getSupabaseClient(): Promise<SupabaseManagementAPI> {
  const settings = readSettings();

  // Check if Supabase token exists in settings
  const supabaseAccessToken = settings.supabase?.accessToken?.value;
  const expiresIn = settings.supabase?.expiresIn;

  if (!supabaseAccessToken) {
    throw new Error(
      "Supabase access token not found. Please authenticate first.",
    );
  }

  // Check if token needs refreshing
  if (isTokenExpired(expiresIn)) {
    await withLock("refresh-supabase-token", refreshSupabaseToken);
    // Get updated settings after refresh
    const updatedSettings = readSettings();
    const newAccessToken = updatedSettings.supabase?.accessToken?.value;

    if (!newAccessToken) {
      throw new Error("Failed to refresh Supabase access token");
    }

    return new SupabaseManagementAPI({
      accessToken: newAccessToken,
    });
  }

  return new SupabaseManagementAPI({
    accessToken: supabaseAccessToken,
  });
}

export async function getSupabaseProjectName(
  projectId: string,
): Promise<string> {
  if (IS_TEST_BUILD) {
    return "Fake Supabase Project";
  }

  const supabase = await getSupabaseClient();
  const projects = await supabase.getProjects();
  const project = projects?.find((p) => p.id === projectId);
  return project?.name || `<project not found for: ${projectId}>`;
}

export async function executeSupabaseSql({
  supabaseProjectId,
  query,
}: {
  supabaseProjectId: string;
  query: string;
}): Promise<string> {
  if (IS_TEST_BUILD) {
    return "{}";
  }

  const supabase = await getSupabaseClient();
  const result = await supabase.runQuery(supabaseProjectId, query);
  return JSON.stringify(result);
}

export async function deleteSupabaseFunction({
  supabaseProjectId,
  functionName,
}: {
  supabaseProjectId: string;
  functionName: string;
}): Promise<void> {
  logger.info(
    `Deleting Supabase function: ${functionName} from project: ${supabaseProjectId}`,
  );
  const supabase = await getSupabaseClient();
  await supabase.deleteFunction(supabaseProjectId, functionName);
  logger.info(
    `Deleted Supabase function: ${functionName} from project: ${supabaseProjectId}`,
  );
}

export async function listSupabaseBranches({
  supabaseProjectId,
}: {
  supabaseProjectId: string;
}): Promise<
  Array<{
    id: string;
    name: string;
    is_default: boolean;
    project_ref: string;
    parent_project_ref: string;
  }>
> {
  if (IS_TEST_BUILD) {
    return [
      {
        id: "default-branch-id",
        name: "Default Branch",
        is_default: true,
        project_ref: "fake-project-id",
        parent_project_ref: "fake-project-id",
      },

      {
        id: "test-branch-id",
        name: "Test Branch",
        is_default: false,
        project_ref: "test-branch-project-id",
        parent_project_ref: "fake-project-id",
      },
    ];
  }

  logger.info(`Listing Supabase branches for project: ${supabaseProjectId}`);
  const supabase = await getSupabaseClient();

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${supabaseProjectId}/branches`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${(supabase as any).options.accessToken}`,
      },
    },
  );

  if (response.status !== 200) {
    throw await createResponseError(response, "list branches");
  }

  logger.info(`Listed Supabase branches for project: ${supabaseProjectId}`);
  const jsonResponse = await response.json();
  return jsonResponse;
}

export async function deploySupabaseFunctions({
  supabaseProjectId,
  functionName,
  appPath,
}: {
  supabaseProjectId: string;
  functionName: string;
  appPath: string;
}): Promise<void> {
  logger.info(
    `Deploying Supabase function: ${functionName} to project: ${supabaseProjectId}`,
  );
  const supabase = await getSupabaseClient();
  const accessToken = (supabase as any).options?.accessToken as string | undefined;

  if (!accessToken) {
    throw new Error("Missing Supabase access token for deployment");
  }

  if (IS_TEST_BUILD) {
    logger.info("Test build: skipping Supabase CLI deployment");
    return;
  }

  const cli = await waitForSupabaseCli(appPath);

  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  env.SUPABASE_ACCESS_TOKEN = accessToken;

  await simpleSpawn({
    command: `${cli.command} functions deploy ${functionName} --project-ref ${supabaseProjectId} --no-verify-jwt`,
    cwd: appPath,
    successMessage: `Deployed Supabase function ${functionName} via Supabase CLI`,
    errorPrefix: `Failed to deploy Supabase function ${functionName}`,
    env,
  });
}

export async function serveSupabaseFunction({
  functionName,
  appPath,
}: {
  functionName: string;
  appPath: string;
}): Promise<void> {
  logger.info(`Serving Supabase function locally: ${functionName}`);

  if (IS_TEST_BUILD) {
    logger.info("Test build: skipping Supabase CLI serve");
    return;
  }

  const cli = await waitForSupabaseCli(appPath);

  await runSupabaseServeCommand({
    command: `${cli.command} functions serve ${functionName} --no-verify-jwt`,
    cwd: appPath,
    successMessage: `Served Supabase function ${functionName} locally via Supabase CLI`,
    errorPrefix: `Failed to serve Supabase function ${functionName}`,
  });
}

async function createResponseError(response: Response, action: string) {
  const errorBody = await safeParseErrorResponseBody(response);

  return new SupabaseManagementAPIError(
    `Failed to ${action}: ${response.statusText} (${response.status})${
      errorBody ? `: ${errorBody.message}` : ""
    }`,
    response,
  );
}

async function safeParseErrorResponseBody(
  response: Response,
): Promise<{ message: string } | undefined> {
  try {
    const body = await response.json();

    if (
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
    ) {
      return { message: body.message };
    }
  } catch {
    return;
  }
}
