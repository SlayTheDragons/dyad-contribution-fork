import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { bundleSupabaseFunction } from "@/supabase_admin/supabase_bundler";

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "supabase-bundle-"));
}

describe("bundleSupabaseFunction", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("bundles local and shared modules", async () => {
    tempDir = await createTempDirectory();
    const functionDir = path.join(tempDir, "supabase", "functions", "hello");
    const sharedDir = path.join(tempDir, "supabase", "functions", "_shared");

    await fs.mkdir(functionDir, { recursive: true });
    await fs.mkdir(sharedDir, { recursive: true });

    await fs.writeFile(
      path.join(sharedDir, "greeting.ts"),
      "export function greeting(name: string) { return `Hello ${name}`; }\n",
      "utf8",
    );

    await fs.writeFile(
      path.join(functionDir, "helper.ts"),
      "import { greeting } from '../_shared/greeting.ts';\nexport function message() { return greeting('World'); }\n",
      "utf8",
    );

    await fs.writeFile(
      path.join(functionDir, "index.ts"),
      "import { message } from './helper.ts';\nexport default function handler() { return message(); }\n",
      "utf8",
    );

    const bundle = await bundleSupabaseFunction({
      appPath: tempDir,
      functionName: "hello",
    });

    expect(bundle).toContain("Hello");
    expect(bundle).not.toContain("../_shared");
    expect(bundle).toContain("message");
  });
});
