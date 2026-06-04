import { describe, expect, it } from "vitest";
import { sanitizeOperationalText } from "./safeText";

describe("sanitizeOperationalText", () => {
  it("redacts secrets, bearer tokens, and home path usernames", () => {
    const sanitized = sanitizeOperationalText(
      "OPENAI_API_KEY=sk_1234567890abcdef failed near C:\\Users\\yashm\\token.txt with Bearer abc.def.ghi"
    );

    expect(sanitized).toContain("OPENAI_API_KEY=<redacted-secret>");
    expect(sanitized).toContain("Bearer <redacted-token>");
    expect(sanitized).toContain("<home>/token.txt");
    expect(sanitized).not.toContain("sk_1234567890abcdef");
    expect(sanitized).not.toContain("abc.def.ghi");
    expect(sanitized).not.toContain("C:");
    expect(sanitized).not.toContain("yashm");
  });
});
