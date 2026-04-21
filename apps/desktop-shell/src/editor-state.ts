type MonacoNamespace = typeof import("monaco-editor");

const explicitFilenameLanguages: Record<string, string> = {
  ".gitignore": "plaintext",
  "cargo.toml": "toml",
  "cmakelists.txt": "cmake",
  "cmakepresets.json": "json",
  "package-lock.json": "json",
  "package.json": "json",
  "readme.md": "markdown",
  "tsconfig.json": "json"
};

const extensionLanguages: Record<string, string> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  css: "css",
  cxx: "cpp",
  h: "cpp",
  hh: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  md: "markdown",
  mts: "typescript",
  ps1: "powershell",
  py: "python",
  rs: "rust",
  sh: "shell",
  toml: "toml",
  ts: "typescript",
  tsx: "typescript",
  txt: "plaintext",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml"
};

const languageLabels: Record<string, string> = {
  c: "C",
  cmake: "CMake",
  cpp: "C++",
  css: "CSS",
  html: "HTML",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  markdown: "Markdown",
  plaintext: "Plain Text",
  powershell: "PowerShell",
  python: "Python",
  rust: "Rust",
  shell: "Shell",
  toml: "TOML",
  typescript: "TypeScript",
  xml: "XML",
  yaml: "YAML"
};

let themeDefined = false;

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
}

export function detectEditorLanguage(path: string): string {
  const fileName = basename(path);
  if (fileName && explicitFilenameLanguages[fileName]) {
    return explicitFilenameLanguages[fileName];
  }

  const extension = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() ?? "" : "";
  if (extension && extensionLanguages[extension]) {
    return extensionLanguages[extension];
  }

  return "plaintext";
}

export function formatEditorLanguageLabel(languageId: string): string {
  return languageLabels[languageId] ?? "Plain Text";
}

export function countDocumentLines(content: string): number {
  if (!content) {
    return 1;
  }

  return content.split(/\r?\n/).length;
}

export function configureOpenGravityTheme(monaco: MonacoNamespace): void {
  if (themeDefined) {
    return;
  }

  monaco.editor.defineTheme("opengravity-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6f8a9c" },
      { token: "keyword", foreground: "71d4ff" },
      { token: "string", foreground: "b7f1a8" },
      { token: "number", foreground: "f6c177" },
      { token: "delimiter", foreground: "d8e4f0" }
    ],
    colors: {
      "editor.background": "#071019",
      "editor.foreground": "#f4f7ff",
      "editor.lineHighlightBackground": "#0d1823",
      "editor.selectionBackground": "#174561",
      "editor.inactiveSelectionBackground": "#123349",
      "editorCursor.foreground": "#7ae3ff",
      "editorLineNumber.foreground": "#486173",
      "editorLineNumber.activeForeground": "#8bb2c8",
      "editorGutter.background": "#071019",
      "editorIndentGuide.background1": "#12212d",
      "editorIndentGuide.activeBackground1": "#244458"
    }
  });

  themeDefined = true;
}
