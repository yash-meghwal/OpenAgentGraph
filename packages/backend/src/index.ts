import { buildApp, logStartupDiagnostics } from "./app.js";
import { getAppConfig } from "./config.js";
import { logDiagnostic, safeErrorMessage } from "./observability/logger.js";

async function start() {
  const config = getAppConfig();
  const startup = logStartupDiagnostics(config);
  if (startup.errors.length > 0) {
    throw new Error(startup.errors[0]);
  }

  const app = await buildApp(config);
  await app.listen({ port: config.server.port, host: config.server.host });
  logDiagnostic({
    level: "info",
    component: "startup",
    message: `OpenAgentGraph backend running on http://localhost:${config.server.port}`,
  });
}

start().catch((err) => {
  logDiagnostic({
    level: "error",
    component: "startup",
    message: safeErrorMessage(err),
    errorCode: "STARTUP_FATAL",
  });
  process.exit(1);
});
