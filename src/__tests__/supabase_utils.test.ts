import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getSupabaseFunctionName,
  isServerFunction,
  isSupabaseSharedPath,
  listSupabaseFunctionNames,
} from "@/supabase_admin/supabase_utils";

async function createTempDirectory(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "supabase-utils-"));
  return tmpDir;
}

describe("supabase utils", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("detects supabase function names", () => {
    expect(getSupabaseFunctionName("supabase/functions/example/index.ts")).toBe(
      "example",
    );
    expect(getSupabaseFunctionName("supabase/functions/example/utils.ts")).toBe(
      "example",
    );
    expect(getSupabaseFunctionName("supabase/functions/example.ts")).toBe(
      "example",
    );
    expect(
      getSupabaseFunctionName("supabase/functions/_shared/helpers.ts"),
    ).toBeNull();
    expect(getSupabaseFunctionName("src/routes/api/index.ts")).toBeNull();
  });

  it("identifies supabase server functions", () => {
    expect(isServerFunction("supabase/functions/example/index.ts")).toBe(true);
    expect(isServerFunction("supabase/functions/_shared/helpers.ts")).toBe(
      false,
    );
  });

  it("detects shared module paths", () => {
    expect(isSupabaseSharedPath("supabase/functions/_shared/index.ts")).toBe(
      true,
    );
    expect(
      isSupabaseSharedPath("supabase/functions/example/index.ts"),
    ).toBe(false);
  });

  it("lists available supabase functions", async () => {
    tempDir = await createTempDirectory();
    const functionsDir = path.join(tempDir, "supabase", "functions");
    await fs.mkdir(path.join(functionsDir, "alpha"), { recursive: true });
    await fs.mkdir(path.join(functionsDir, "beta"), { recursive: true });
    await fs.mkdir(path.join(functionsDir, "_shared"), { recursive: true });

    const result = await listSupabaseFunctionNames(tempDir);
    expect(result).toEqual(["alpha", "beta"]);
  });
});
