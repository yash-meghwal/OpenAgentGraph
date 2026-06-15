import type { FastifyInstance } from "fastify";

export function registerScanPostBodyTolerance(app: FastifyInstance) {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      const text = typeof body === "string" ? body : "";
      if (!text.trim()) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(text) as unknown);
      } catch (error) {
        done(error as Error, undefined);
      }
    }
  );
}