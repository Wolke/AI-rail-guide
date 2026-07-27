import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JourneyContextStore } from "./context";

class MockWebSocket extends EventEmitter {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  static autoComplete = true;
  readyState = MockWebSocket.OPEN;
  sent: Record<string, any>[] = [];

  constructor() {
    super();
    MockWebSocket.instances.push(this);
    queueMicrotask(() => this.emit("open"));
  }

  send(raw: string) {
    const event = JSON.parse(raw);
    this.sent.push(event);
    if (event.type === "session.update") queueMicrotask(() => this.emit("message", Buffer.from(JSON.stringify({ type: "session.updated", session: event.session }))));
    if (event.type === "response.create") {
      const response = { id: `remote-${this.sent.length}`, metadata: event.response.metadata, status: "completed" };
      queueMicrotask(() => this.emit("message", Buffer.from(JSON.stringify({ type: "response.created", response }))));
      queueMicrotask(() => this.emit("message", Buffer.from(JSON.stringify({ type: "response.output_audio.delta", response_id: response.id, delta: Buffer.from([1, 2]).toString("base64") }))));
      queueMicrotask(() => this.emit("message", Buffer.from(JSON.stringify({ type: "response.output_audio_transcript.delta", response_id: response.id, delta: "測試" }))));
      if (MockWebSocket.autoComplete) queueMicrotask(() => this.emit("message", Buffer.from(JSON.stringify({ type: "response.done", response }))));
    }
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }
}

vi.mock("ws", () => ({ default: MockWebSocket }));

describe("RealtimeCliClient protocol ordering", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    MockWebSocket.autoComplete = true;
  });

  it("waits for session.updated and stamps responses with the latest revision", async () => {
    const { RealtimeCliClient } = await import("./realtime");
    const store = new JourneyContextStore("tra-pingxi", "journey-test");
    const records: any[] = [];
    const audioChunks: Buffer[] = [];
    const textChunks: string[] = [];
    const trace = { record: async (...args: any[]) => { records.push(args); } } as any;
    const client = new RealtimeCliClient({
      apiKey: "test-key",
      trace,
      getSnapshot: () => store.snapshot(),
      onAudio: (chunk) => audioChunks.push(chunk),
      onText: (text) => textChunks.push(text)
    });

    await client.connect();
    const latest = store.moveTo("sandiaoling", "scenario");
    await client.updateContext(latest);
    client.sendPassengerText("現在在哪裡？", latest);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const sent = MockWebSocket.instances[0].sent;
    expect(sent.map((event) => event.type)).toEqual([
      "session.update",
      "session.update",
      "response.create"
    ]);
    const responseCreate = sent.at(-1)!;
    expect(responseCreate.response.metadata.context_revision).toBe(String(latest.revision));
    expect(responseCreate.response.metadata.current_station_id).toBe("sandiaoling");
    expect(sent.some((event) => event.type === "output_audio_buffer.clear")).toBe(false);
    expect(audioChunks[0]).toEqual(Buffer.from([1, 2]));
    expect(textChunks).toEqual(["測試"]);
    expect(records.some((entry) => entry[1] === "session.updated")).toBe(true);
    client.disconnect();
  });

  it("cancels only a server-confirmed active response and clears playback locally", async () => {
    MockWebSocket.autoComplete = false;
    const { RealtimeCliClient } = await import("./realtime");
    const store = new JourneyContextStore("tra-pingxi", "journey-cancel");
    const cleared = vi.fn();
    const client = new RealtimeCliClient({
      apiKey: "test-key",
      trace: { record: async () => undefined } as any,
      getSnapshot: () => store.snapshot(),
      onOutputCleared: cleared
    });
    await client.connect();
    client.sendGuide();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const latest = store.moveTo("houtong");
    await client.updateContext(latest);

    const sent = MockWebSocket.instances[0].sent;
    const cancel = sent.find((event) => event.type === "response.cancel");
    expect(cancel).toBeDefined();
    expect(cancel!.response_id).toMatch(/^remote-/);
    expect(sent.some((event) => event.type === "output_audio_buffer.clear")).toBe(false);
    expect(cleared).toHaveBeenCalled();
    client.disconnect();
  });
});
