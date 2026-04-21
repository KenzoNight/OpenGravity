import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyBuildFailure, detectWorkspaceProfile, recommendWorkspaceExecution } from "./index.js";

describe("detectWorkspaceProfile", () => {
  it("detects a C++ CMake workspace with high confidence", () => {
    const profile = detectWorkspaceProfile([
      "CMakeLists.txt",
      "src/main.cpp",
      "include/engine.hpp",
      "tests/solver_test.cpp"
    ]);

    assert.equal(profile.primaryLanguage, "cpp");
    assert.ok(profile.buildSystems.includes("cmake"));
    assert.ok(profile.detectedLanguages.includes("cpp"));
    assert.equal(profile.confidence, "high");
  });

  it("detects a mixed TypeScript workspace using pnpm", () => {
    const profile = detectWorkspaceProfile([
      "package.json",
      "pnpm-lock.yaml",
      "src/index.ts",
      "apps/web/package.json"
    ]);

    assert.equal(profile.primaryLanguage, "typescript");
    assert.ok(profile.buildSystems.includes("npm"));
    assert.ok(profile.buildSystems.includes("pnpm"));
    assert.ok(profile.dependencyManagers.includes("pnpm"));
    assert.ok(profile.detectedLanguages.includes("typescript"));
  });

  it("recommends a CMake execution plan", () => {
    const profile = detectWorkspaceProfile([
      "CMakeLists.txt",
      "src/main.cpp",
      "include/engine.hpp"
    ]);

    const plan = recommendWorkspaceExecution(profile);

    assert.equal(plan.primaryBuildSystem, "cmake");
    assert.equal(plan.steps[0]?.kind, "configure");
    assert.ok(plan.steps[0]?.commands.includes("cmake -S . -B build"));
    assert.equal(plan.steps[1]?.kind, "test");
  });

  it("recommends a pnpm execution plan", () => {
    const profile = detectWorkspaceProfile([
      "package.json",
      "pnpm-lock.yaml",
      "src/index.ts"
    ]);

    const plan = recommendWorkspaceExecution(profile);

    assert.equal(plan.primaryBuildSystem, "pnpm");
    assert.equal(plan.steps[0]?.kind, "install");
    assert.ok(plan.steps[0]?.commands.includes("pnpm install --frozen-lockfile"));
    assert.equal(plan.steps[2]?.kind, "test");
  });
});

describe("classifyBuildFailure", () => {
  it("classifies missing header failures", () => {
    const result = classifyBuildFailure(`
      cl /c src/main.cpp
      fatal error C1083: cannot open include file: 'physics/solver.hpp': No such file or directory
    `);

    assert.equal(result.category, "missing-header");
    assert.ok(result.evidence[0]?.includes("C1083"));
  });

  it("classifies linker failures", () => {
    const result = classifyBuildFailure(`
      undefined reference to 'Solver::run()'
      collect2: error: ld returned 1 exit status
    `);

    assert.equal(result.category, "linker");
    assert.ok(result.suggestedFixHints.some((hint) => hint.includes("linked")));
  });

  it("falls back to unknown for unmatched logs", () => {
    const result = classifyBuildFailure("build failed for an unspecified reason");

    assert.equal(result.category, "unknown");
    assert.ok(result.suggestedFixHints.length > 0);
  });
});
