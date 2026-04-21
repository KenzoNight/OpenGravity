import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const currentDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(currentDir, "..");
const entryFile = resolve(appDir, "src", "test-suite.ts");
const outputDir = resolve(appDir, ".test-dist");
const outputFile = resolve(outputDir, "desktop-shell.test.mjs");

mkdirSync(outputDir, { recursive: true });

await build({
  entryPoints: [entryFile],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: outputFile
});

execFileSync(process.execPath, ["--test", "--test-isolation=none", outputFile], {
  stdio: "inherit"
});
