export interface WorkspaceCommandPreset {
  id: string;
  label: string;
  command: string;
}

export interface WorkspaceDocument {
  path: string;
  savedContent: string;
  currentContent: string;
}

export type WorkspaceDocumentReplacementResult =
  | {
      status: "applied";
      content: string;
    }
  | {
      status: "not-found" | "ambiguous";
    };

const preferredFiles = [
  "apps/desktop-shell/src/App.tsx",
  "README.md",
  "apps/desktop-shell/src-tauri/src/main.rs",
  "package.json"
];

const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function pickInitialWorkspaceFile(files: string[]): string {
  for (const preferredFile of preferredFiles) {
    if (files.includes(preferredFile)) {
      return preferredFile;
    }
  }

  return files[0] ?? "";
}

export function isDocumentDirty(savedContent: string, currentContent: string): boolean {
  return savedContent !== currentContent;
}

export function createWorkspaceDocument(path: string, content: string): WorkspaceDocument {
  return {
    path,
    savedContent: content,
    currentContent: content
  };
}

export function upsertWorkspaceDocument(
  documents: WorkspaceDocument[],
  document: WorkspaceDocument
): WorkspaceDocument[] {
  const withoutCurrent = documents.filter((entry) => entry.path !== document.path);
  return [document, ...withoutCurrent];
}

export function updateWorkspaceDocumentContent(
  documents: WorkspaceDocument[],
  path: string,
  content: string
): WorkspaceDocument[] {
  return documents.map((document) =>
    document.path === path
      ? {
          ...document,
          currentContent: content
        }
      : document
  );
}

export function applySingleDocumentReplacement(
  content: string,
  findText: string,
  replaceText: string
): WorkspaceDocumentReplacementResult {
  if (!findText) {
    return {
      status: "not-found"
    };
  }

  const firstIndex = content.indexOf(findText);
  if (firstIndex === -1) {
    return {
      status: "not-found"
    };
  }

  const secondIndex = content.indexOf(findText, firstIndex + findText.length);
  if (secondIndex !== -1) {
    return {
      status: "ambiguous"
    };
  }

  return {
    status: "applied",
    content: content.slice(0, firstIndex) + replaceText + content.slice(firstIndex + findText.length)
  };
}

export function markWorkspaceDocumentSaved(
  documents: WorkspaceDocument[],
  path: string,
  content: string
): WorkspaceDocument[] {
  return documents.map((document) =>
    document.path === path
      ? {
          ...document,
          savedContent: content,
          currentContent: content
        }
      : document
  );
}

export function getWorkspaceDocument(
  documents: WorkspaceDocument[],
  path: string
): WorkspaceDocument | undefined {
  return documents.find((document) => document.path === path);
}

export function getDirtyWorkspaceDocumentCount(documents: WorkspaceDocument[]): number {
  return documents.filter((document) => isDocumentDirty(document.savedContent, document.currentContent)).length;
}

export function filterWorkspaceFiles(files: string[], query: string): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return files;
  }

  return files.filter((file) => file.toLowerCase().includes(normalizedQuery));
}

export function buildWorkspaceCommandPresets(files: string[]): WorkspaceCommandPreset[] {
  const fileSet = new Set(files);
  const presets: WorkspaceCommandPreset[] = [];

  if (fileSet.has("package.json")) {
    presets.push(
      {
        id: "npm-typecheck",
        label: "Typecheck workspace",
        command: "npm run typecheck"
      },
      {
        id: "npm-test",
        label: "Run repository tests",
        command: "npm run test"
      },
      {
        id: "npm-app-check",
        label: "Check desktop shell",
        command: "npm run app:check"
      }
    );
  }

  if (fileSet.has("Cargo.toml")) {
    presets.push({
      id: "cargo-check",
      label: "Run cargo check",
      command: "cargo check"
    });
  }

  if (fileSet.has("CMakeLists.txt")) {
    presets.push(
      {
        id: "cmake-configure",
        label: "Configure CMake",
        command: "cmake -S . -B build"
      },
      {
        id: "cmake-build",
        label: "Build CMake project",
        command: "cmake --build build"
      }
    );
  }

  if (fileSet.has("pyproject.toml")) {
    presets.push({
      id: "python-test",
      label: "Run pytest",
      command: "pytest"
    });
  }

  if (presets.length === 0) {
    presets.push({
      id: "pwd",
      label: "Print working directory",
      command: "pwd"
    });
  }

  const seen = new Set<string>();

  return presets.filter((preset) => {
    if (seen.has(preset.command)) {
      return false;
    }

    seen.add(preset.command);
    return true;
  });
}

export function createEditorTabList(activeFilePath: string, fallbackTabs: string[]): string[] {
  const ordered = [activeFilePath, ...fallbackTabs].filter(Boolean);
  const seen = new Set<string>();

  return ordered.filter((entry) => {
    if (seen.has(entry)) {
      return false;
    }

    seen.add(entry);
    return true;
  });
}

export function labelForFilePath(path: string): string {
  return basename(path);
}


