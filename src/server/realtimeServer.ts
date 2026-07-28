import express, { type Express, type NextFunction, type Request, type Response } from "express";

export interface RealtimeServerOptions {
  apiKey?: string;
  model?: string;
  voice?: string;
  fetchImpl?: typeof fetch;
}

const MAX_SDP_BYTES = 64 * 1024;

export function createRealtimeApp(options: RealtimeServerOptions = {}): Express {
  const app = express();
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const model = options.model ?? process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1-mini";
  const voice = options.voice ?? process.env.OPENAI_REALTIME_VOICE ?? "marin";
  const fetchImpl = options.fetchImpl ?? fetch;

  app.disable("x-powered-by");
  app.use((request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    if (!isLocalOrigin(request.headers.origin)) {
      response.status(403).json({ error: "origin_not_allowed" });
      return;
    }
    next();
  });

  app.get("/api/health", (_request, response) => {
    response.json({ realtimeConfigured: Boolean(apiKey) });
  });

  app.post("/api/realtime/session", express.text({ type: "application/sdp", limit: MAX_SDP_BYTES }), async (request, response) => {
    if (!apiKey) {
      response.status(503).json({ error: "realtime_not_configured" });
      return;
    }
    if (!request.is("application/sdp") || typeof request.body !== "string" || !request.body.startsWith("v=")) {
      response.status(415).json({ error: "invalid_sdp" });
      return;
    }
    const form = new FormData();
    form.set("sdp", request.body);
    form.set("session", JSON.stringify({
      type: "realtime",
      model,
      output_modalities: ["audio"],
      audio: { output: { voice } }
    }));
    try {
      const upstream = await fetchImpl("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form
      });
      if (!upstream.ok) {
        response.status(502).json({ error: "realtime_upstream_failed" });
        return;
      }
      response.type("application/sdp").send(await upstream.text());
    } catch {
      response.status(502).json({ error: "realtime_upstream_unreachable" });
    }
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const status = typeof error === "object" && error && "type" in error && error.type === "entity.too.large" ? 413 : 400;
    response.status(status).json({ error: status === 413 ? "sdp_too_large" : "invalid_request" });
  });

  return app;
}

export function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}
