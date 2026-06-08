import { describe, expect, it } from "vitest";
import { sanitizeOperationalText } from "./safeText";

describe("sanitizeOperationalText", () => {
  it("redacts secrets and keeps useful path hints", () => {
    const workspaceRoot = "C:\\Users\\yashm\\Desktop\\OpenAgentGraphV1Publish";
    const input = [
      "Bearer abc.def.ghi",
      "OPENAI_API_KEY=sk_123456789012",
      "JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature",
      "C:\\Users\\yashm\\Desktop\\OpenAgentGraphV1Publish\\packages\\sdk\\src\\index.ts",
      "C:\\Users\\yashm\\AppData\\Local\\Temp\\openagentgraph\\trace.log",
      "/Users/yashm/private/notes.md",
      "/tmp/openagentgraph/session.log",
    ].join(" ");

    const output = sanitizeOperationalText(input, { workspaceRoot });

    expect(output).not.toContain("abc.def.ghi");
    expect(output).not.toContain("sk_123456789012");
    expect(output).not.toContain("eyJhbGci");
    expect(output).not.toContain("C:\\Users\\yashm");
    expect(output).not.toContain("/Users/yashm");
    expect(output).toContain("Bearer <redacted-token>");
    expect(output).toContain("OPENAI_API_KEY=<redacted-secret>");
    expect(output).toContain("<workspace>/packages/sdk/src/index.ts");
    expect(output).toContain("<temp>/openagentgraph/trace.log");
    expect(output).toContain("<home>/private/notes.md");
    expect(output).toContain("<temp>/openagentgraph/session.log");
  });
});
