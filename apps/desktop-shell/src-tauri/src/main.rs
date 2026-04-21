#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::Instant;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellHealth {
    app_name: String,
    version: String,
    shell: String,
    backend: String,
    sidecar_mode: String,
    features: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSnapshot {
    root_path: String,
    files: Vec<String>,
    active_file_path: String,
    active_file_content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFilePayload {
    path: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceCommandResult {
    command: String,
    success: bool,
    exit_code: i32,
    stdout: String,
    stderr: String,
    duration_ms: u128,
}

#[tauri::command]
fn shell_health() -> ShellHealth {
    ShellHealth {
        app_name: "OpenGravity".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        shell: "tauri-2".into(),
        backend: "rust-core".into(),
        sidecar_mode: "planned-cpp-sidecars".into(),
        features: vec![
            "Tauri window shell".into(),
            "Rust backend commands".into(),
            "Workspace file bridge".into(),
            "Desktop command bridge".into(),
            "Browser-safe preview fallback".into(),
        ],
    }
}

#[tauri::command]
fn workspace_snapshot() -> Result<WorkspaceSnapshot, String> {
    let root = workspace_root()?;
    let files = list_workspace_files(&root)?;
    let active_file_path = pick_initial_file(&files).unwrap_or_default();
    let active_file_content = if active_file_path.is_empty() {
        String::new()
    } else {
        read_text_file(&resolve_workspace_path(&active_file_path)?)?
    };

    Ok(WorkspaceSnapshot {
        root_path: root.to_string_lossy().into_owned(),
        files,
        active_file_path,
        active_file_content,
    })
}

#[tauri::command]
fn read_workspace_file(relative_path: String) -> Result<WorkspaceFilePayload, String> {
    let resolved = resolve_workspace_path(&relative_path)?;
    let content = read_text_file(&resolved)?;

    Ok(WorkspaceFilePayload {
        path: relative_path,
        content,
    })
}

#[tauri::command]
fn write_workspace_file(relative_path: String, content: String) -> Result<WorkspaceFilePayload, String> {
    let resolved = resolve_workspace_path(&relative_path)?;
    if !resolved.is_file() {
        return Err(format!(
            "Workspace path '{}' is not a writable file.",
            relative_path
        ));
    }

    fs::write(&resolved, content.as_bytes()).map_err(|error| {
        format!(
            "Failed to write '{}': {}",
            relative_path,
            error
        )
    })?;

    Ok(WorkspaceFilePayload {
        path: relative_path,
        content,
    })
}

#[tauri::command]
fn run_workspace_command(command: String) -> Result<WorkspaceCommandResult, String> {
    let trimmed_command = command.trim();
    validate_allowed_command(trimmed_command)?;

    let started_at = Instant::now();
    let output = run_shell_command(trimmed_command, &workspace_root()?)?;
    let duration_ms = started_at.elapsed().as_millis();
    let exit_code = output.status.code().unwrap_or(-1);
    let stdout = normalize_line_endings(String::from_utf8_lossy(&output.stdout).into_owned());
    let stderr = normalize_line_endings(String::from_utf8_lossy(&output.stderr).into_owned());

    Ok(WorkspaceCommandResult {
        command: trimmed_command.into(),
        success: output.status.success(),
        exit_code,
        stdout,
        stderr,
        duration_ms,
    })
}

fn workspace_root() -> Result<PathBuf, String> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace root: {}", error))
}

fn list_workspace_files(root: &Path) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    collect_workspace_files(root, root, &mut files)?;
    files.sort_by_cached_key(|entry| entry.to_lowercase());
    Ok(files)
}

fn collect_workspace_files(current: &Path, root: &Path, files: &mut Vec<String>) -> Result<(), String> {
    let entries = fs::read_dir(current).map_err(|error| {
        format!(
            "Failed to read workspace directory '{}': {}",
            current.display(),
            error
        )
    })?;

    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "Failed to inspect workspace directory '{}': {}",
                current.display(),
                error
            )
        })?;
        let path = entry.path();

        if path.is_dir() {
            if should_skip_directory(&path) {
                continue;
            }

            collect_workspace_files(&path, root, files)?;
            continue;
        }

        if path.is_file() {
            let relative_path = path
                .strip_prefix(root)
                .map_err(|error| format!("Failed to derive relative file path: {}", error))?;
            files.push(relative_path.to_string_lossy().replace('\\', "/"));
        }
    }

    Ok(())
}

fn should_skip_directory(path: &Path) -> bool {
    let name = path.file_name().and_then(|value| value.to_str()).unwrap_or_default();

    matches!(
        name,
        ".git"
            | "node_modules"
            | "dist"
            | ".test-dist"
            | ".cargo-target-check"
            | ".cargo-target-dev"
            | "target"
    )
}

fn sanitize_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let trimmed = relative_path.trim();
    if trimmed.is_empty() {
        return Err("Workspace file path cannot be empty.".into());
    }

    let input_path = Path::new(trimmed);
    if input_path.is_absolute() {
        return Err("Absolute paths are not allowed.".into());
    }

    let mut sanitized = PathBuf::new();
    for component in input_path.components() {
        match component {
            Component::Normal(part) => sanitized.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Path traversal is not allowed.".into())
            }
        }
    }

    if sanitized.as_os_str().is_empty() {
        return Err("Workspace file path cannot be empty.".into());
    }

    Ok(sanitized)
}

fn resolve_workspace_path(relative_path: &str) -> Result<PathBuf, String> {
    let root = workspace_root()?;
    let sanitized = sanitize_relative_path(relative_path)?;
    let resolved = root.join(sanitized);
    let canonical = resolved.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve workspace path '{}': {}",
            relative_path,
            error
        )
    })?;

    if !canonical.starts_with(&root) {
        return Err("Resolved path escapes the workspace root.".into());
    }

    Ok(canonical)
}

fn read_text_file(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| {
        format!(
            "Failed to read '{}': {}",
            path.display(),
            error
        )
    })
}

fn pick_initial_file(files: &[String]) -> Option<String> {
    const PREFERRED_FILES: [&str; 4] = [
        "apps/desktop-shell/src/App.tsx",
        "README.md",
        "apps/desktop-shell/src-tauri/src/main.rs",
        "package.json",
    ];

    for preferred_file in PREFERRED_FILES {
        if let Some(entry) = files.iter().find(|candidate| candidate.as_str() == preferred_file) {
            return Some(entry.clone());
        }
    }

    files.first().cloned()
}

fn validate_allowed_command(command: &str) -> Result<(), String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("Command cannot be empty.".into());
    }

    for forbidden_fragment in ["&&", "||", ";", "|", ">", "<"] {
        if trimmed.contains(forbidden_fragment) {
            return Err("Command chaining and redirection are disabled in this prototype.".into());
        }
    }

    let tokens: Vec<&str> = trimmed.split_whitespace().collect();
    let first = tokens
        .first()
        .ok_or_else(|| "Command cannot be empty.".to_string())?
        .to_ascii_lowercase();

    if matches!(
        first.as_str(),
        "remove-item" | "rm" | "del" | "erase" | "rmdir" | "format" | "shutdown"
    ) {
        return Err("Destructive commands are blocked in the desktop shell prototype.".into());
    }

    let allowed = matches!(
        first.as_str(),
        "cmake"
            | "ctest"
            | "cargo"
            | "npm"
            | "pnpm"
            | "yarn"
            | "python"
            | "python3"
            | "pytest"
            | "uv"
            | "go"
            | "dotnet"
            | "gradle"
            | "mvn"
            | "java"
            | "javac"
            | "make"
            | "ninja"
            | "cl"
            | "clang"
            | "clang++"
            | "g++"
            | "pwd"
            | "ls"
            | "dir"
    );

    if allowed {
        return Ok(());
    }

    if first == "git" {
        let git_subcommand = tokens.get(1).copied().unwrap_or_default().to_ascii_lowercase();
        if matches!(
            git_subcommand.as_str(),
            "status" | "diff" | "log" | "show" | "branch" | "rev-parse"
        ) {
            return Ok(());
        }
    }

    Err("Command is not allowed by the desktop shell safety policy.".into())
}

#[cfg(target_os = "windows")]
fn run_shell_command(command: &str, working_directory: &Path) -> Result<std::process::Output, String> {
    let attempted_shells = ["pwsh", "powershell"];
    let mut last_error: Option<String> = None;

    for shell in attempted_shells {
        match Command::new(shell)
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command])
            .current_dir(working_directory)
            .output()
        {
            Ok(output) => return Ok(output),
            Err(error) => last_error = Some(format!("{}: {}", shell, error)),
        }
    }

    Err(last_error.unwrap_or_else(|| "No supported shell was available.".into()))
}

#[cfg(not(target_os = "windows"))]
fn run_shell_command(command: &str, working_directory: &Path) -> Result<std::process::Output, String> {
    Command::new("sh")
        .args(["-lc", command])
        .current_dir(working_directory)
        .output()
        .map_err(|error| format!("Failed to launch shell command '{}': {}", command, error))
}

fn normalize_line_endings(value: String) -> String {
    value.replace("\r\n", "\n")
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            shell_health,
            workspace_snapshot,
            read_workspace_file,
            write_workspace_file,
            run_workspace_command
        ])
        .run(tauri::generate_context!())
        .expect("failed to run OpenGravity desktop shell");
}

#[cfg(test)]
mod tests {
    use super::{pick_initial_file, sanitize_relative_path, validate_allowed_command};

    #[test]
    fn picks_preferred_workspace_file() {
        let files = vec![
            "README.md".to_string(),
            "apps/desktop-shell/src/App.tsx".to_string(),
            "package.json".to_string(),
        ];

        assert_eq!(
            pick_initial_file(&files),
            Some("apps/desktop-shell/src/App.tsx".to_string())
        );
    }

    #[test]
    fn rejects_path_traversal() {
        assert!(sanitize_relative_path("../README.md").is_err());
        assert!(sanitize_relative_path("apps/desktop-shell/src/App.tsx").is_ok());
    }

    #[test]
    fn validates_safe_commands() {
        assert!(validate_allowed_command("npm run test").is_ok());
        assert!(validate_allowed_command("git status --short").is_ok());
        assert!(validate_allowed_command("git reset --hard").is_err());
        assert!(validate_allowed_command("npm run test && git status").is_err());
        assert!(validate_allowed_command("rm -rf build").is_err());
    }
}
