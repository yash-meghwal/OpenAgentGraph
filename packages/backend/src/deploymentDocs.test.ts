import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { CONFIG_ENV_SPECS } from "./config.js";

function findRepoRoot() {
  let current = process.cwd();
  while (true) {
    if (
      fs.existsSync(path.join(current, "package.json")) &&
      fs.existsSync(path.join(current, "packages", "backend", "package.json"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Could not locate repository root for deployment docs tests.");
    }
    current = parent;
  }
}

const repoRoot = findRepoRoot();

function read(filePath: string) {
  return fs.readFileSync(path.join(repoRoot, filePath), "utf8");
}

describe("deployment and docs alignment", () => {
  it(".env.example stays aligned with the typed config layer", () => {
    const envExample = read(".env.example");
    const keys = envExample
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=")[0]);

    expect(keys.sort()).toEqual(CONFIG_ENV_SPECS.map((spec) => spec.key).sort());
  });

  it("deployment docs describe the real health and readiness endpoints", () => {
    const readme = read("README.md");
    const frontendEnvExample = read("packages/frontend/.env.example");

    expect(readme).toContain("GET /health");
    expect(readme).toContain("GET /ready");
    expect(readme).toContain("GET /auth/session");
    expect(readme).toContain("GET /metrics");
    expect(readme).toContain("Basic liveness only.");
    expect(readme).toContain("Readiness summary for database initialization, provider configuration, workspace availability, and auth-mode safety.");
    expect(readme).toContain("Operational metrics for scraping and monitoring. It is for runtime telemetry, not product-state truth.");
    expect(readme).toContain("openagentgraph_readiness_status");
    expect(readme).toContain("openagentgraph_provider_fallback_total");
    expect(readme).toContain("OPENAGENTGRAPH_AUTH_MODE");
    expect(readme).toContain("OPENAGENTGRAPH_JWT_SECRET");
    expect(readme).toContain("OPENAGENTGRAPH_ALLOWED_ORIGINS");
    expect(readme).toContain("VITE_OPENAGENTGRAPH_API_BASE_URL");
    expect(readme).toContain("Vite `/api` proxy");
    expect(frontendEnvExample).toContain("VITE_OPENAGENTGRAPH_API_BASE_URL");
  });

  it("LLM function docs describe protected graph scan and write endpoints", () => {
    const functionsDoc = read("docs/OPENAGENTGRAPH-FUNCTIONS.md");

    expect(functionsDoc).toContain("| Endpoint | Method | Purpose | Access |");
    expect(functionsDoc).not.toContain("Typical actor");
    expect(functionsDoc).toContain("| `/provider/config` | GET/POST/DELETE | runtime provider status and setup | operator/admin |");
    expect(functionsDoc).toContain("| `/project-graph/scan-jobs` | POST | start Project Graph scan job | operator/admin |");
    expect(functionsDoc).toContain("| `/product-graph/codebase/scan` | POST | synchronous Product Graph scan | operator/admin |");
    expect(functionsDoc).toContain("| `/product-graph/codebase/scan-jobs` | POST | start Product Graph scan job | operator/admin |");
    expect(functionsDoc).toContain("| `/product-graph/handoff/write` | POST | path-safe `GRAPH_REPORT.md` write | operator/admin |");
  });

  it("the Docker packaging path uses the real diagnostics endpoints", () => {
    const dockerfile = read("Dockerfile");
    const rootPackageJson = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    const sharedPackageJson = JSON.parse(read("packages/shared/package.json")) as {
      main: string;
      types: string;
    };

    expect(dockerfile).toContain("/health");
    expect(dockerfile).toContain("packages/backend/dist/index.js");
    expect(rootPackageJson.scripts["docker:build"]).toBe("docker build -t openagentgraph-backend .");
    expect(sharedPackageJson.main).toBe("./dist/index.js");
    expect(sharedPackageJson.types).toBe("./dist/index.d.ts");
  });
});
