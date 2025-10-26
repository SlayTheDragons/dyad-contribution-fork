import fs from "node:fs/promises";
import path from "node:path";

const SUPABASE_FUNCTIONS_DIR = path.join("supabase", "functions");

let esbuildModulePromise: Promise<typeof import("esbuild")> | undefined;

async function loadEsbuild(): Promise<typeof import("esbuild")> {
  if (!esbuildModulePromise) {
    esbuildModulePromise = import("esbuild");
  }

  return esbuildModulePromise;
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", path.sep);
}

function isRelativeOrAbsoluteImport(importPath: string): boolean {
  return (
    importPath.startsWith(".") ||
    importPath.startsWith("/") ||
    path.isAbsolute(importPath)
  );
}

const externalImportPrefixes = /^(https?:|npm:|jsr:)/;

export async function bundleSupabaseFunction({
  appPath,
  functionName,
}: {
  appPath: string;
  functionName: string;
}): Promise<string> {
  const functionDir = path.join(appPath, SUPABASE_FUNCTIONS_DIR, functionName);
  const entryPoint = path.join(functionDir, "index.ts");

  try {
    await fs.access(entryPoint);
  } catch {
    throw new Error(
      `Supabase function "${functionName}" must include an index.ts entry point. Expected file at ${entryPoint}.`,
    );
  }

  const { build } = await loadEsbuild();

  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "esnext",
    write: false,
    logLevel: "silent",
    sourcesContent: false,
    plugins: [
      {
        name: "externalize-non-relative-imports",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            const specifier = normalizePath(args.path);

            if (externalImportPrefixes.test(specifier)) {
              return { path: specifier, external: true };
            }

            if (!isRelativeOrAbsoluteImport(specifier)) {
              return { path: specifier, external: true };
            }

            return undefined;
          });
        },
      },
    ],
  });

  const output = result.outputFiles?.[0]?.text;

  if (!output) {
    throw new Error(
      `Failed to bundle Supabase function "${functionName}". No output generated.`,
    );
  }

  return output;
}
