import type { BuildSystem, WorkspaceProfile } from "@opengravity/shared-types";

const hasPath = (paths: string[], pattern: RegExp): boolean => paths.some((path) => pattern.test(path));

const orderedUnique = <T>(values: T[]): T[] => [...new Set(values)];

export type ExecutionStepKind = "install" | "configure" | "build" | "test" | "inspect";
export type BuildErrorCategory =
  | "missing-header"
  | "linker"
  | "syntax"
  | "toolchain-missing"
  | "dependency-missing"
  | "test-failure"
  | "unknown";

export interface ExecutionStep {
  kind: ExecutionStepKind;
  label: string;
  commands: string[];
  rationale: string;
}

export interface WorkspaceExecutionPlan {
  primaryBuildSystem?: BuildSystem;
  steps: ExecutionStep[];
  rationale: string[];
}

export interface ClassifiedBuildError {
  category: BuildErrorCategory;
  probableCause: string;
  evidence: string[];
  suggestedFixHints: string[];
}

export function detectWorkspaceProfile(paths: string[]): WorkspaceProfile {
  const normalized = paths.map((path) => path.replaceAll("\\", "/"));
  const detectedLanguages: string[] = [];
  const buildSystems: BuildSystem[] = [];
  const dependencyManagers: string[] = [];
  const evidence: string[] = [];

  if (hasPath(normalized, /(^|\/)CMakeLists\.txt$/i)) {
    detectedLanguages.push("cpp");
    buildSystems.push("cmake");
    evidence.push("CMakeLists.txt");
  }

  if (hasPath(normalized, /(^|\/).+\.(c|cc|cpp|cxx|hpp|h)$/i)) {
    detectedLanguages.push("cpp");
    evidence.push("C/C++ source files");
  }

  if (hasPath(normalized, /(^|\/)package\.json$/i)) {
    detectedLanguages.push("javascript", "typescript");
    buildSystems.push("npm");
    dependencyManagers.push("npm");
    evidence.push("package.json");
  }

  if (hasPath(normalized, /(^|\/)pnpm-lock\.ya?ml$/i)) {
    buildSystems.push("pnpm");
    dependencyManagers.push("pnpm");
    evidence.push("pnpm-lock.yaml");
  }

  if (hasPath(normalized, /(^|\/)yarn\.lock$/i)) {
    buildSystems.push("yarn");
    dependencyManagers.push("yarn");
    evidence.push("yarn.lock");
  }

  if (hasPath(normalized, /(^|\/)Cargo\.toml$/i)) {
    detectedLanguages.push("rust");
    buildSystems.push("cargo");
    evidence.push("Cargo.toml");
  }

  if (hasPath(normalized, /(^|\/)go\.mod$/i)) {
    detectedLanguages.push("go");
    evidence.push("go.mod");
  }

  if (hasPath(normalized, /(^|\/)(requirements\.txt|pyproject\.toml)$/i)) {
    detectedLanguages.push("python");
    dependencyManagers.push("pip");
    evidence.push("Python dependency manifest");
  }

  if (hasPath(normalized, /(^|\/)uv\.lock$/i)) {
    buildSystems.push("uv");
    dependencyManagers.push("uv");
    evidence.push("uv.lock");
  }

  if (hasPath(normalized, /(^|\/)(build\.gradle|build\.gradle\.kts|settings\.gradle|settings\.gradle\.kts)$/i)) {
    detectedLanguages.push("java", "kotlin");
    buildSystems.push("gradle");
    evidence.push("Gradle files");
  }

  if (hasPath(normalized, /(^|\/)pom\.xml$/i)) {
    detectedLanguages.push("java");
    buildSystems.push("maven");
    evidence.push("pom.xml");
  }

  if (hasPath(normalized, /(^|\/).+\.sln$/i) || hasPath(normalized, /(^|\/).+\.vcxproj$/i)) {
    detectedLanguages.push("cpp", "csharp");
    buildSystems.push("msbuild");
    evidence.push("Visual Studio project files");
  }

  if (hasPath(normalized, /(^|\/)WORKSPACE(\.bazel)?$/i) || hasPath(normalized, /(^|\/)MODULE\.bazel$/i)) {
    buildSystems.push("bazel");
    evidence.push("Bazel workspace files");
  }

  if (hasPath(normalized, /(^|\/).+\.csproj$/i)) {
    detectedLanguages.push("csharp");
    buildSystems.push("dotnet");
    dependencyManagers.push("dotnet");
    evidence.push(".csproj");
  }

  const uniqueLanguages = orderedUnique(detectedLanguages);
  const uniqueBuildSystems = orderedUnique(buildSystems);
  const uniqueDependencyManagers = orderedUnique(dependencyManagers);
  const uniqueEvidence = orderedUnique(evidence);

  let primaryLanguage: string | null = uniqueLanguages[0] ?? null;
  if (uniqueLanguages.includes("cpp") && uniqueBuildSystems.includes("cmake")) {
    primaryLanguage = "cpp";
  } else if (uniqueLanguages.includes("typescript") && uniqueDependencyManagers.includes("pnpm")) {
    primaryLanguage = "typescript";
  }

  let confidence: WorkspaceProfile["confidence"] = "low";
  if (uniqueEvidence.length >= 2) {
    confidence = "medium";
  }
  const strongBuildSignals = new Set<BuildSystem>([
    "cmake",
    "msbuild",
    "cargo",
    "gradle",
    "maven",
    "bazel",
    "dotnet"
  ]);
  const hasStrongBuildSignal = uniqueBuildSystems.some((system) => strongBuildSignals.has(system));

  if (
    uniqueBuildSystems.length >= 1 &&
    uniqueLanguages.length >= 1 &&
    (uniqueEvidence.length >= 3 || (hasStrongBuildSignal && uniqueEvidence.length >= 2))
  ) {
    confidence = "high";
  }

  return {
    primaryLanguage,
    detectedLanguages: uniqueLanguages,
    buildSystems: uniqueBuildSystems,
    dependencyManagers: uniqueDependencyManagers,
    confidence,
    evidence: uniqueEvidence
  };
}

export function recommendWorkspaceExecution(profile: WorkspaceProfile): WorkspaceExecutionPlan {
  const steps: ExecutionStep[] = [];
  const rationale: string[] = [];
  let primaryBuildSystem = profile.buildSystems[0];

  const push = (step: ExecutionStep): void => {
    steps.push(step);
    rationale.push(step.rationale);
  };

  if (profile.buildSystems.includes("cmake")) {
    primaryBuildSystem = "cmake";
    push({
      kind: "configure",
      label: "Configure CMake workspace",
      commands: ["cmake -S . -B build", "cmake --build build"],
      rationale: "CMake projects should configure first so generator, compiler, and cache issues surface early."
    });
    push({
      kind: "test",
      label: "Run CTest suite",
      commands: ["ctest --test-dir build --output-on-failure"],
      rationale: "CTest is the canonical test runner after a successful CMake build."
    });
    return { primaryBuildSystem, steps, rationale };
  }

  if (profile.buildSystems.includes("cargo")) {
    primaryBuildSystem = "cargo";
    push({
      kind: "build",
      label: "Build Rust workspace",
      commands: ["cargo build"],
      rationale: "Cargo owns dependency resolution and build orchestration for Rust workspaces."
    });
    push({
      kind: "test",
      label: "Run Rust tests",
      commands: ["cargo test"],
      rationale: "Cargo test validates both compilation and crate-level tests."
    });
    return { primaryBuildSystem, steps, rationale };
  }

  if (profile.buildSystems.includes("gradle")) {
    primaryBuildSystem = "gradle";
    push({
      kind: "build",
      label: "Build with Gradle",
      commands: ["./gradlew build"],
      rationale: "Gradle workspaces should use the project wrapper when available."
    });
    push({
      kind: "test",
      label: "Run Gradle tests",
      commands: ["./gradlew test"],
      rationale: "Gradle test executes the standard verification lifecycle."
    });
    return { primaryBuildSystem, steps, rationale };
  }

  if (profile.buildSystems.includes("maven")) {
    primaryBuildSystem = "maven";
    push({
      kind: "build",
      label: "Build with Maven",
      commands: ["mvn -B package"],
      rationale: "Maven package is a straightforward first-pass build and packaging check."
    });
    push({
      kind: "test",
      label: "Run Maven tests",
      commands: ["mvn -B test"],
      rationale: "Maven test validates unit tests separately from packaging."
    });
    return { primaryBuildSystem, steps, rationale };
  }

  if (profile.buildSystems.includes("dotnet")) {
    primaryBuildSystem = "dotnet";
    push({
      kind: "build",
      label: "Build .NET workspace",
      commands: ["dotnet build"],
      rationale: ".NET solutions and projects typically expose a consistent dotnet build entry point."
    });
    push({
      kind: "test",
      label: "Run .NET tests",
      commands: ["dotnet test"],
      rationale: "dotnet test is the default verification step for .NET repos."
    });
    return { primaryBuildSystem, steps, rationale };
  }

  if (profile.buildSystems.includes("uv")) {
    primaryBuildSystem = "uv";
    push({
      kind: "install",
      label: "Sync Python environment with uv",
      commands: ["uv sync"],
      rationale: "uv.lock indicates a uv-managed environment should be restored before running code."
    });
    push({
      kind: "test",
      label: "Run Python tests",
      commands: ["uv run pytest"],
      rationale: "uv run keeps execution inside the resolved Python environment."
    });
    return { primaryBuildSystem, steps, rationale };
  }

  if (profile.dependencyManagers.includes("pip")) {
    primaryBuildSystem = "pip";
    push({
      kind: "install",
      label: "Install Python dependencies",
      commands: ["pip install -r requirements.txt"],
      rationale: "A requirements manifest suggests a direct pip environment bootstrap."
    });
    push({
      kind: "test",
      label: "Run Python tests",
      commands: ["pytest"],
      rationale: "pytest is the most common verification entry point for Python repos."
    });
    return { primaryBuildSystem, steps, rationale };
  }

  if (profile.buildSystems.includes("pnpm")) {
    primaryBuildSystem = "pnpm";
    push({
      kind: "install",
      label: "Install Node dependencies with pnpm",
      commands: ["pnpm install --frozen-lockfile"],
      rationale: "pnpm-lock.yaml indicates pnpm is the intended package manager."
    });
    push({
      kind: "build",
      label: "Build Node workspace",
      commands: ["pnpm build"],
      rationale: "pnpm build is the expected top-level build entry point in most JS/TS repos."
    });
    push({
      kind: "test",
      label: "Run Node tests",
      commands: ["pnpm test"],
      rationale: "pnpm test is the default verification step once dependencies are installed."
    });
    return { primaryBuildSystem, steps, rationale };
  }

  if (profile.buildSystems.includes("yarn")) {
    primaryBuildSystem = "yarn";
    push({
      kind: "install",
      label: "Install Node dependencies with Yarn",
      commands: ["yarn install --immutable"],
      rationale: "A yarn.lock file suggests Yarn should control dependency resolution."
    });
    push({
      kind: "build",
      label: "Build Node workspace",
      commands: ["yarn build"],
      rationale: "yarn build is the expected project build entry point."
    });
    push({
      kind: "test",
      label: "Run Node tests",
      commands: ["yarn test"],
      rationale: "yarn test is the standard follow-up verification command."
    });
    return { primaryBuildSystem, steps, rationale };
  }

  if (profile.buildSystems.includes("npm")) {
    primaryBuildSystem = "npm";
    push({
      kind: "install",
      label: "Install Node dependencies with npm",
      commands: ["npm install"],
      rationale: "package.json without a stronger lockfile signal falls back to npm."
    });
    push({
      kind: "build",
      label: "Build Node workspace",
      commands: ["npm run build"],
      rationale: "npm run build is the conventional project build step."
    });
    push({
      kind: "test",
      label: "Run Node tests",
      commands: ["npm test"],
      rationale: "npm test is the conventional verification command."
    });
    return { primaryBuildSystem, steps, rationale };
  }

  push({
    kind: "inspect",
    label: "Inspect workspace manually",
    commands: ["rg --files", "git status --short"],
    rationale: "No confident build system was detected, so the repo should be inspected before execution."
  });

  return { primaryBuildSystem, steps, rationale };
}

export function classifyBuildFailure(log: string): ClassifiedBuildError {
  const lines = log
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const text = lines.join("\n");

  const matchers: Array<{
    category: BuildErrorCategory;
    patterns: RegExp[];
    probableCause: string;
    suggestedFixHints: string[];
  }> = [
    {
      category: "missing-header",
      patterns: [/cannot open include file/i, /fatal error: .* no such file or directory/i, /\bC1083\b/i],
      probableCause: "A required header or source include path is missing from the build configuration.",
      suggestedFixHints: [
        "Verify include directories in CMake, MSBuild, or compiler flags.",
        "Confirm the referenced header exists at the expected relative path."
      ]
    },
    {
      category: "linker",
      patterns: [/undefined reference/i, /\bLNK20\d+\b/i, /unresolved external symbol/i],
      probableCause: "Compilation succeeded, but symbol resolution failed during linking.",
      suggestedFixHints: [
        "Check that the required library or object file is linked.",
        "Look for missing implementation files or incorrect target linkage."
      ]
    },
    {
      category: "syntax",
      patterns: [/expected ['"`]/i, /\bsyntax error\b/i, /\berror C2143\b/i, /\berror C2065\b/i],
      probableCause: "The source code contains a parse or syntax-level error.",
      suggestedFixHints: [
        "Inspect the reported line and the lines immediately above it for missing punctuation or invalid tokens.",
        "Check whether generated code or macros changed the apparent source structure."
      ]
    },
    {
      category: "toolchain-missing",
      patterns: [/not recognized as an internal or external command/i, /command not found/i, /No CMAKE_CXX_COMPILER could be found/i, /cl\.exe.*not found/i],
      probableCause: "The required compiler, SDK, or build tool is not available in the environment.",
      suggestedFixHints: [
        "Verify the expected toolchain is installed and on PATH.",
        "Confirm the shell or environment initialization step ran before the build."
      ]
    },
    {
      category: "dependency-missing",
      patterns: [/Cannot find module/i, /No module named/i, /could not find package/i, /failed to resolve import/i],
      probableCause: "A runtime or build dependency is missing or not installed correctly.",
      suggestedFixHints: [
        "Restore dependencies using the workspace's package manager.",
        "Verify lockfiles and manifest entries are in sync."
      ]
    },
    {
      category: "test-failure",
      patterns: [/\bAssertionError\b/i, /\btest failed\b/i, /\bFAILURES\b/i, /\bexpected:.*received:/i],
      probableCause: "The build succeeded but one or more verification steps failed.",
      suggestedFixHints: [
        "Inspect the failing test output and isolate whether the regression is behavioral or environment-specific.",
        "Re-run the specific failing test with verbose output."
      ]
    }
  ];

  for (const matcher of matchers) {
    const evidence = lines.filter((line) => matcher.patterns.some((pattern) => pattern.test(line)));
    if (evidence.length > 0) {
      return {
        category: matcher.category,
        probableCause: matcher.probableCause,
        evidence: evidence.slice(0, 3),
        suggestedFixHints: matcher.suggestedFixHints
      };
    }
  }

  return {
    category: "unknown",
    probableCause: "The failure log did not match a known build or test error pattern.",
    evidence: text ? lines.slice(0, 3) : [],
    suggestedFixHints: [
      "Inspect the full log and identify the first real error rather than the final summary line.",
      "Capture a clean rerun with verbose output before attempting a fix."
    ]
  };
}
