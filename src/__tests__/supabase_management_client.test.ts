import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/ipc/utils/simpleSpawn", () => ({
  simpleSpawn: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/main/settings", () => ({
  readSettings: () => ({
    supabase: {
      accessToken: { value: "test-token" },
      refreshToken: { value: "refresh-token" },
      expiresIn: 3600,
      tokenTimestamp: Math.floor(Date.now() / 1000),
    },
  }),
  writeSettings: vi.fn(),
}));

vi.mock("@dyad-sh/supabase-management-js", () => ({
  SupabaseManagementAPI: vi.fn().mockImplementation(({ accessToken }) => ({
    options: { accessToken },
  })),
  SupabaseManagementAPIError: class extends Error {},
}));

import { simpleSpawn } from "@/ipc/utils/simpleSpawn";
import {
  deploySupabaseFunctions,
  serveSupabaseFunction,
} from "@/supabase_admin/supabase_management_client";

const simpleSpawnMock = vi.mocked(simpleSpawn);

beforeEach(() => {
  simpleSpawnMock.mockClear();
  process.env.SUPABASE_CLI_PATH = "supabase";
});

afterEach(() => {
  delete process.env.SUPABASE_CLI_PATH;
});

describe("deploySupabaseFunctions", () => {
  it("invokes the Supabase CLI with the project ref and access token", async () => {
    await deploySupabaseFunctions({
      supabaseProjectId: "project-ref",
      functionName: "hello-world",
      appPath: "/path/to/app",
    });

    expect(simpleSpawnMock).toHaveBeenCalledTimes(1);

    const callArgs = simpleSpawnMock.mock.calls[0]?.[0];
    expect(callArgs?.command).toBe(
      "supabase functions deploy hello-world --project-ref project-ref --no-verify-jwt",
    );
    expect(callArgs?.cwd).toBe("/path/to/app");
    expect(callArgs?.env?.SUPABASE_ACCESS_TOKEN).toBe("test-token");
    expect(callArgs?.successMessage).toContain("hello-world");
  });
});

describe("serveSupabaseFunction", () => {
  it("runs supabase serve using the configured CLI path", async () => {
    process.env.SUPABASE_CLI_PATH = "echo";

    await expect(
      serveSupabaseFunction({
        functionName: "hello-world",
        appPath: process.cwd(),
      }),
    ).resolves.not.toThrow();
  });

  it("rejects when the CLI exits with a failure code", async () => {
    process.env.SUPABASE_CLI_PATH = "false";

    await expect(
      serveSupabaseFunction({
        functionName: "bad-func",
        appPath: process.cwd(),
      }),
    ).rejects.toThrow(/Failed to serve Supabase function bad-func/);
  });
});
