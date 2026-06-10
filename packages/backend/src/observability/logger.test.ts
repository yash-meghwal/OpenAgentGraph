import { afterEach, describe, expect, it } from "vitest";
import { loadAppConfig, setAppConfigForTests } from "../config.js";
import { logDiagnostic, safeErrorMessage, setStructuredLogSink } from "./logger.js";

describe("structured logger", () => {
  afterEach(() => {
    setStructuredLogSink(undefined);
    setAppConfigForTests(undefined);
  });

  it("omits sensitive values from structured log metadata", () => {
    const entries: Array<Record<string, unknown>> = [];
    setAppConfigForTests(
      loadAppConfig({
        NODE_ENV: "test",
        OPENAGENTGRAPH_LOG_LEVEL: "debug",
      })
    );
    setStructuredLogSink((entry) => {
      entries.push(entry as unknown as Record<string, unknown>);
    });

    logDiagnostic({
      level: "warn",
      component: "test",
      message: "Testing redaction",
      safeMetadata: {
        apiKey: "secret-key",
        authorization: "Bearer 123",
        harmlessValue: "visible",
      },
    });

    expect(entries).toEqual([
      expect.objectContaining({
        component: "test",
        message: "Testing redaction",
        safeMetadata: {
          apiKey: "[redacted]",
          authorization: "[redacted]",
          harmlessValue: "visible",
        },
      }),
    ]);
  });

  it("sanitizes tokens and absolute paths from messages and string metadata", () => {
    const entries: Array<Record<string, unknown>> = [];
    setAppConfigForTests(
      loadAppConfig({
        NODE_ENV: "test",
        OPENAGENTGRAPH_LOG_LEVEL: "debug",
      })
    );
    setStructuredLogSink((entry) => {
      entries.push(entry as unknown as Record<string, unknown>);
    });

    logDiagnostic({
      level: "error",
      component: "test",
      message:
        "Failure at C:\\Users\\yashm\\AppData\\Local\\Temp\\openagentgraph\\secret.txt with Bearer abc.def.ghi",
      safeMetadata: {
        error: "ENOENT: no such file or directory, open 'C:\\Users\\yashm\\Desktop\\openagentgraph\\missing.txt'",
        jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature",
      },
    });

    expect(entries).toEqual([
      expect.objectContaining({
        message: "Failure at <temp>/openagentgraph/secret.txt with Bearer <redacted-token>",
        safeMetadata: {
          error: "ENOENT: no such file or directory, open '<home>/openagentgraph/missing.txt'",
          jwt: "[redacted]",
        },
      }),
    ]);
    expect(
      safeErrorMessage(
        new Error(
          "JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature failed near C:\\Users\\yashm\\token.txt"
        )
      )
    ).toBe("JWT <redacted-token> failed near <home>/token.txt");
  });
});
