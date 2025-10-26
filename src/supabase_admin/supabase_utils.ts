import fs from "node:fs/promises";
import path from "node:path";

const SUPABASE_FUNCTIONS_DIR = path.join("supabase", "functions");
const SUPABASE_FUNCTIONS_PREFIX = "supabase/functions/";
const SUPABASE_SHARED_DIRECTORY = "_shared";
const SUPABASE_SHARED_PREFIX =
  SUPABASE_FUNCTIONS_PREFIX + SUPABASE_SHARED_DIRECTORY + "/";

function normalizeToPosix(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

export function isServerFunction(filePath: string) {
  return getSupabaseFunctionName(filePath) !== null;
}

export function getSupabaseFunctionName(filePath: string): string | null {
  const normalized = normalizeToPosix(filePath);
  if (!normalized.startsWith(SUPABASE_FUNCTIONS_PREFIX)) {
    return null;
  }

  const relativePath = normalized.slice(SUPABASE_FUNCTIONS_PREFIX.length);
  if (!relativePath) {
    return null;
  }

  const segments = relativePath.split("/");
  const [firstSegment] = segments;

  if (!firstSegment || firstSegment === SUPABASE_SHARED_DIRECTORY) {
    return null;
  }

  if (segments.length === 1) {
    const baseName = firstSegment.replace(/\.[^.]+$/, "");
    return baseName === SUPABASE_SHARED_DIRECTORY ? null : baseName;
  }

  return firstSegment;
}

export function isSupabaseSharedPath(filePath: string): boolean {
  const normalized = normalizeToPosix(filePath);
  return (
    normalized ===
      SUPABASE_FUNCTIONS_PREFIX + SUPABASE_SHARED_DIRECTORY ||
    normalized.startsWith(SUPABASE_SHARED_PREFIX)
  );
}

export async function listSupabaseFunctionNames(
  appPath: string,
): Promise<string[]> {
  const functionsDir = path.join(appPath, SUPABASE_FUNCTIONS_DIR);

  try {
    const entries = await fs.readdir(functionsDir, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() && entry.name !== SUPABASE_SHARED_DIRECTORY,
      )
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
