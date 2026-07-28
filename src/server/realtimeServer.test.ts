import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createRealtimeApp, isLocalOrigin } from "./realtimeServer";

describe("local Realtime server", () => {
  it("reports configuration without exposing secrets", async () => {
    const response = await request(createRealtimeApp({ apiKey: "test-secret" })).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ realtimeConfigured: true });
    expect(response.text).not.toContain("test-secret");
  });

  it("rejects non-local origins", async () => {
    const response = await request(createRealtimeApp({ apiKey: "test-secret" }))
      .get("/api/health")
      .set("Origin", "https://example.com");
    expect(response.status).toBe(403);
    expect(isLocalOrigin("http://127.0.0.1:5173")).toBe(true);
  });

  it("requires a configured key and valid SDP", async () => {
    const missing = await request(createRealtimeApp({ apiKey: "" }))
      .post("/api/realtime/session")
      .set("Content-Type", "application/sdp")
      .send("v=0\r\n");
    expect(missing.status).toBe(503);

    const invalid = await request(createRealtimeApp({ apiKey: "test-secret" }))
      .post("/api/realtime/session")
      .set("Content-Type", "text/plain")
      .send("not-sdp");
    expect(invalid.status).toBe(415);
  });

  it("relays SDP with server-side auth and hides upstream errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("v=0\r\nanswer", { status: 200 }));
    const response = await request(createRealtimeApp({ apiKey: "test-secret", fetchImpl }))
      .post("/api/realtime/session")
      .set("Origin", "http://localhost:5173")
      .set("Content-Type", "application/sdp")
      .send("v=0\r\noffer");
    expect(response.status).toBe(200);
    expect(response.text).toContain("answer");
    expect(fetchImpl).toHaveBeenCalledWith("https://api.openai.com/v1/realtime/calls", expect.objectContaining({
      headers: { Authorization: "Bearer test-secret" }
    }));

    const failedFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response("sensitive upstream detail", { status: 401 }));
    const failed = await request(createRealtimeApp({ apiKey: "test-secret", fetchImpl: failedFetch }))
      .post("/api/realtime/session")
      .set("Content-Type", "application/sdp")
      .send("v=0\r\noffer");
    expect(failed.status).toBe(502);
    expect(failed.text).not.toContain("sensitive upstream detail");
  });
});
