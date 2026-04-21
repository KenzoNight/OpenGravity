import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(currentDir, "..");

const mode = process.argv[2];

if (!mode || !["dev", "build", "check"].includes(mode)) {
  console.error("Usage: node ./scripts/run-tauri.mjs <dev|build|check>");
  process.exit(1);
}

const tauriCommand =
  process.platform === "win32"
    ? resolve(appDir, "..", "..", "node_modules", ".bin", "tauri.cmd")
    : resolve(appDir, "..", "..", "node_modules", ".bin", "tauri");

const cargoCommand = process.platform === "win32" ? "cargo.exe" : "cargo";
const command =
  mode === "check"
    ? cargoCommand
    : process.platform === "win32"
      ? `"${tauriCommand}" ${mode}`
      : tauriCommand;
const args = mode === "check" ? ["check", "--manifest-path", "src-tauri/Cargo.toml"] : process.platform === "win32" ? [] : [mode];

const child = spawn(command, args, {
  cwd: appDir,
  stdio: "inherit",
  shell: mode !== "check" && process.platform === "win32",
  env: {
    ...process.env,
    CARGO_TARGET_DIR: resolve(appDir, "src-tauri", `.cargo-target-${mode}`)
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
