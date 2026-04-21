#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};

static NEXT_RUN_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Default)]
struct CommandRegistry {
    runs: Arc<Mutex<HashMap<String, RunningProcess>>>,
}

#[derive(Clone)]
struct RunningProcess {
    pid: u32,
    cancellation_requested: bool,
}

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
struct RepositorySnapshot {
    available: bool,
    workspace_root: String,
    repository_root: String,
    branch: String,
    origin_url: String,
    status_lines: Vec<String>,
    recent_commit_lines: Vec<String>,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceCommandStarted {
    run_id: String,
    command: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceCommandEventPayload {
    run_id: String,
    command: String,
    kind: String,
    line: Option<String>,
    success: Option<bool>,
    exit_code: Option<i32>,
    duration_ms: Option<u128>,
    message: Option<String>,
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
            "Streaming desktop command bridge".into(),
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
fn repository_snapshot() -> Result<RepositorySnapshot, String> {
    let root = workspace_root()?;
    let repository_root = match run_git_command(&["rev-parse", "--show-toplevel"], &root) {
        Ok(output) => output.trim().to_string(),
        Err(_) => {
            return Ok(RepositorySnapshot {
                available: false,
                workspace_root: root.to_string_lossy().into_owned(),
                repository_root: String::new(),
                branch: String::new(),
                origin_url: String::new(),
                status_lines: Vec::new(),
                recent_commit_lines: Vec::new(),
            })
        }
    };

    let repository_root_path = PathBuf::from(&repository_root);
    let branch = run_git_command(&["rev-parse", "--abbrev-ref", "HEAD"], &repository_root_path)
        .unwrap_or_default()
        .trim()
        .to_string();
    let origin_url = run_git_command(&["remote", "get-url", "origin"], &repository_root_path)
        .unwrap_or_default()
        .trim()
        .to_string();
    let status_lines = split_non_empty_lines(
        &run_git_command(&["status", "--short", "--branch"], &repository_root_path).unwrap_or_default(),
    );
    let recent_commit_lines = split_non_empty_lines(
        &run_git_command(
            &["log", "--pretty=format:%H%x09%s%x09%cr", "-n", "12"],
            &repository_root_path,
        )
        .unwrap_or_default(),
    );

    Ok(RepositorySnapshot {
        available: true,
        workspace_root: root.to_string_lossy().into_owned(),
        repository_root,
        branch,
        origin_url,
        status_lines,
        recent_commit_lines,
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
fn read_external_file(absolute_path: String) -> Result<WorkspaceFilePayload, String> {
    let resolved = resolve_external_file_path(&absolute_path)?;
    let content = read_text_file(&resolved)?;

    Ok(WorkspaceFilePayload {
        path: normalize_display_path(&resolved),
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
fn write_external_file(absolute_path: String, content: String) -> Result<WorkspaceFilePayload, String> {
    let resolved = resolve_external_file_path(&absolute_path)?;

    fs::write(&resolved, content.as_bytes()).map_err(|error| {
        format!(
            "Failed to write '{}': {}",
            resolved.display(),
            error
        )
    })?;

    Ok(WorkspaceFilePayload {
        path: normalize_display_path(&resolved),
        content,
    })
}

#[tauri::command]
fn run_workspace_command(command: String) -> Result<WorkspaceCommandResult, String> {
    let trimmed_command = command.trim();
    validate_allowed_command(trimmed_command)?;

    let started_at = Instant::now();
    let output = run_blocking_shell_command(trimmed_command, &workspace_root()?)?;
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

#[tauri::command]
fn launch_skill_process(
    executable_path: String,
    arguments: Vec<String>,
    working_directory: Option<String>,
) -> Result<bool, String> {
    let executable = resolve_external_file_path(&executable_path)?;
    let mut command = Command::new(&executable);
    command.args(arguments.into_iter().filter(|entry| !entry.trim().is_empty()));

    if let Some(directory) = working_directory {
        let resolved_directory = resolve_external_directory_path(&directory)?;
        command.current_dir(resolved_directory);
    }

    command
        .spawn()
        .map_err(|error| {
            format!(
                "Failed to launch external tool '{}': {}",
                executable.display(),
                error
            )
        })?;

    Ok(true)
}

#[tauri::command]
fn start_workspace_command(
    app: AppHandle,
    registry: State<CommandRegistry>,
    command: String,
) -> Result<WorkspaceCommandStarted, String> {
    let trimmed_command = command.trim();
    validate_allowed_command(trimmed_command)?;

    let run_id = next_run_id();
    let workspace = workspace_root()?;
    let started_at = Instant::now();
    let mut child = spawn_shell_command(trimmed_command, &workspace)?;
    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    {
        let mut runs = registry
            .runs
            .lock()
            .map_err(|_| "Failed to lock running command registry.".to_string())?;
        runs.insert(
            run_id.clone(),
            RunningProcess {
                pid,
                cancellation_requested: false,
            },
        );
    }

    emit_workspace_event(
        &app,
        WorkspaceCommandEventPayload {
            run_id: run_id.clone(),
            command: trimmed_command.into(),
            kind: "started".into(),
            line: None,
            success: None,
            exit_code: None,
            duration_ms: None,
            message: Some("Process started.".into()),
        },
    );

    if let Some(stdout_reader) = stdout {
        spawn_output_reader(app.clone(), run_id.clone(), trimmed_command.into(), "stdout", stdout_reader);
    }

    if let Some(stderr_reader) = stderr {
        spawn_output_reader(app.clone(), run_id.clone(), trimmed_command.into(), "stderr", stderr_reader);
    }

    let registry_clone = registry.inner().clone();
    let app_clone = app.clone();
    let command_copy = trimmed_command.to_string();
    let run_id_copy = run_id.clone();

    thread::spawn(move || {
        let wait_result = child.wait();
        let duration_ms = started_at.elapsed().as_millis();
        let cancelled = registry_clone
            .runs
            .lock()
            .ok()
            .and_then(|mut runs| runs.remove(&run_id_copy))
            .map(|process| process.cancellation_requested)
            .unwrap_or(false);

        match wait_result {
            Ok(status) => {
                let exit_code = status.code().unwrap_or(-1);
                let was_success = status.success() && !cancelled;
                let kind = if cancelled { "cancelled" } else { "completed" };
                emit_workspace_event(
                    &app_clone,
                    WorkspaceCommandEventPayload {
                        run_id: run_id_copy,
                        command: command_copy,
                        kind: kind.into(),
                        line: None,
                        success: Some(was_success),
                        exit_code: Some(exit_code),
                        duration_ms: Some(duration_ms),
                        message: Some(if cancelled {
                            "Process cancelled by user.".into()
                        } else {
                            "Process finished.".into()
                        }),
                    },
                );
            }
            Err(error) => {
                emit_workspace_event(
                    &app_clone,
                    WorkspaceCommandEventPayload {
                        run_id: run_id_copy,
                        command: command_copy,
                        kind: "launch-failed".into(),
                        line: None,
                        success: Some(false),
                        exit_code: Some(-1),
                        duration_ms: Some(duration_ms),
                        message: Some(format!("Process wait failed: {}", error)),
                    },
                );
            }
        }
    });

    Ok(WorkspaceCommandStarted {
        run_id,
        command: trimmed_command.into(),
    })
}

#[tauri::command]
fn cancel_workspace_command(
    registry: State<CommandRegistry>,
    run_id: String,
) -> Result<bool, String> {
    let pid = {
        let mut runs = registry
            .runs
            .lock()
            .map_err(|_| "Failed to lock running command registry.".to_string())?;

        if let Some(process) = runs.get_mut(&run_id) {
            process.cancellation_requested = true;
            process.pid
        } else {
            return Ok(false);
        }
    };

    terminate_process(pid)?;
    Ok(true)
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

fn resolve_external_file_path(absolute_path: &str) -> Result<PathBuf, String> {
    let trimmed = absolute_path.trim();
    if trimmed.is_empty() {
        return Err("External file path cannot be empty.".into());
    }

    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("External file path must be absolute.".into());
    }

    let canonical = path.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve external file '{}': {}",
            absolute_path,
            error
        )
    })?;

    if !canonical.is_file() {
        return Err(format!("External path '{}' is not a file.", canonical.display()));
    }

    Ok(canonical)
}

fn resolve_external_directory_path(absolute_path: &str) -> Result<PathBuf, String> {
    let trimmed = absolute_path.trim();
    if trimmed.is_empty() {
        return Err("Working directory cannot be empty.".into());
    }

    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("Working directory must be an absolute path.".into());
    }

    let canonical = path.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve working directory '{}': {}",
            absolute_path,
            error
        )
    })?;

    if !canonical.is_dir() {
        return Err(format!("Path '{}' is not a directory.", canonical.display()));
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

fn normalize_display_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn split_non_empty_lines(value: &str) -> Vec<String> {
    value.lines()
        .map(|entry| normalize_line_endings(entry.to_string()).trim().to_string())
        .filter(|entry| !entry.is_empty())
        .collect()
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

fn next_run_id() -> String {
    format!("cmd-{:06}", NEXT_RUN_ID.fetch_add(1, Ordering::Relaxed))
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
            | "echo"
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

fn spawn_output_reader<R>(
    app: AppHandle,
    run_id: String,
    command: String,
    kind: &str,
    reader: R,
) where
    R: Read + Send + 'static,
{
    let stream_kind = kind.to_string();

    thread::spawn(move || {
        let buffered = BufReader::new(reader);

        for line in buffered.lines() {
            match line {
                Ok(content) => {
                    emit_workspace_event(
                        &app,
                        WorkspaceCommandEventPayload {
                            run_id: run_id.clone(),
                            command: command.clone(),
                            kind: stream_kind.clone(),
                            line: Some(normalize_line_endings(content)),
                            success: None,
                            exit_code: None,
                            duration_ms: None,
                            message: None,
                        },
                    );
                }
                Err(error) => {
                    emit_workspace_event(
                        &app,
                        WorkspaceCommandEventPayload {
                            run_id: run_id.clone(),
                            command: command.clone(),
                            kind: "launch-failed".into(),
                            line: None,
                            success: Some(false),
                            exit_code: Some(-1),
                            duration_ms: None,
                            message: Some(format!("Failed to read command output: {}", error)),
                        },
                    );
                    break;
                }
            }
        }
    });
}

fn emit_workspace_event(app: &AppHandle, payload: WorkspaceCommandEventPayload) {
    let _ = app.emit("workspace-command", payload);
}

#[cfg(target_os = "windows")]
fn spawn_shell_command(command: &str, working_directory: &Path) -> Result<Child, String> {
    let attempted_shells = ["pwsh", "powershell"];
    let mut last_error: Option<String> = None;

    for shell in attempted_shells {
        match Command::new(shell)
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command])
            .current_dir(working_directory)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => return Ok(child),
            Err(error) => last_error = Some(format!("{}: {}", shell, error)),
        }
    }

    Err(last_error.unwrap_or_else(|| "No supported shell was available.".into()))
}

#[cfg(not(target_os = "windows"))]
fn spawn_shell_command(command: &str, working_directory: &Path) -> Result<Child, String> {
    Command::new("sh")
        .args(["-lc", command])
        .current_dir(working_directory)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to launch shell command '{}': {}", command, error))
}

#[cfg(target_os = "windows")]
fn run_blocking_shell_command(command: &str, working_directory: &Path) -> Result<Output, String> {
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
fn run_blocking_shell_command(command: &str, working_directory: &Path) -> Result<Output, String> {
    Command::new("sh")
        .args(["-lc", command])
        .current_dir(working_directory)
        .output()
        .map_err(|error| format!("Failed to launch shell command '{}': {}", command, error))
}

#[cfg(target_os = "windows")]
fn terminate_process(pid: u32) -> Result<(), String> {
    let status = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status()
        .map_err(|error| format!("Failed to cancel process {}: {}", pid, error))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("Process {} could not be cancelled.", pid))
    }
}

#[cfg(not(target_os = "windows"))]
fn terminate_process(pid: u32) -> Result<(), String> {
    let status = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status()
        .map_err(|error| format!("Failed to cancel process {}: {}", pid, error))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("Process {} could not be cancelled.", pid))
    }
}

fn normalize_line_endings(value: String) -> String {
    value.replace("\r\n", "\n")
}

fn run_git_command(args: &[&str], working_directory: &Path) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(working_directory)
        .output()
        .map_err(|error| {
            format!(
                "Failed to launch git command '{}': {}",
                args.join(" "),
                error
            )
        })?;

    if !output.status.success() {
        let stderr = normalize_line_endings(String::from_utf8_lossy(&output.stderr).into_owned());
        let message = if stderr.trim().is_empty() {
            format!(
                "git command '{}' exited with status {}.",
                args.join(" "),
                output.status.code().unwrap_or(-1)
            )
        } else {
            stderr
        };
        return Err(message.trim().to_string());
    }

    Ok(normalize_line_endings(
        String::from_utf8_lossy(&output.stdout).into_owned(),
    ))
}

fn main() {
    tauri::Builder::default()
        .manage(CommandRegistry::default())
        .invoke_handler(tauri::generate_handler![
            shell_health,
            workspace_snapshot,
            repository_snapshot,
            read_workspace_file,
            read_external_file,
            write_workspace_file,
            write_external_file,
            run_workspace_command,
            start_workspace_command,
            cancel_workspace_command,
            launch_skill_process
        ])
        .run(tauri::generate_context!())
        .expect("failed to run OpenGravity desktop shell");
}

#[cfg(test)]
mod tests {
    use super::{
        next_run_id, pick_initial_file, resolve_external_file_path, sanitize_relative_path,
        split_non_empty_lines, validate_allowed_command,
    };
    use std::path::PathBuf;

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
    fn requires_absolute_external_paths() {
        assert!(resolve_external_file_path("README.md").is_err());
        let missing = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("missing-file.txt")
            .to_string_lossy()
            .into_owned();
        assert!(resolve_external_file_path(&missing).is_err());
    }

    #[test]
    fn validates_safe_commands() {
        assert!(validate_allowed_command("npm run test").is_ok());
        assert!(validate_allowed_command("git status --short").is_ok());
        assert!(validate_allowed_command("echo hello").is_ok());
        assert!(validate_allowed_command("git reset --hard").is_err());
        assert!(validate_allowed_command("npm run test && git status").is_err());
        assert!(validate_allowed_command("rm -rf build").is_err());
    }

    #[test]
    fn creates_unique_run_ids() {
        let first = next_run_id();
        let second = next_run_id();

        assert_ne!(first, second);
        assert!(first.starts_with("cmd-"));
    }

    #[test]
    fn splits_non_empty_output_lines() {
        assert_eq!(
            split_non_empty_lines("line one\r\n\r\nline two\n"),
            vec!["line one".to_string(), "line two".to_string()]
        );
    }
}
