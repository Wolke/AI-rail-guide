import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialTourState } from "../shared/tourOrchestrator";
import { RealtimeWebRtcClient } from "./realtimeClient";

class MockDataChannel {
  readyState: RTCDataChannelState = "connecting";
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: Record<string, any>[] = [];
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = "closed"; }
  emit(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent); }
}

class MockPeerConnection {
  static latest?: MockPeerConnection;
  channel = new MockDataChannel();
  connectionState: RTCPeerConnectionState = "new";
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor() { MockPeerConnection.latest = this; }
  addTrack() { return {} as RTCRtpSender; }
  createDataChannel() { return this.channel as unknown as RTCDataChannel; }
  async createOffer() { return { type: "offer" as RTCSdpType, sdp: "v=0\r\noffer" }; }
  async setLocalDescription() {}
  async setRemoteDescription() {
    this.channel.readyState = "open";
    queueMicrotask(() => this.channel.onopen?.());
  }
  close() { this.connectionState = "closed"; }
}

describe("Realtime WebRTC client", () => {
  beforeEach(() => {
    vi.stubGlobal("RTCPeerConnection", MockPeerConnection);
    vi.stubGlobal("Audio", class { autoplay = false; muted = false; srcObject: MediaStream | null = null; });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("v=0\r\nanswer", { status: 200 })));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [], getAudioTracks: () => [] }) }
    });
  });

  it("negotiates through the local endpoint", async () => {
    const connection = vi.fn();
    const client = makeClient({ onConnection: connection });
    await client.connect();
    expect(fetch).toHaveBeenCalledWith("/api/realtime/session", expect.objectContaining({ method: "POST" }));
    expect(connection).toHaveBeenCalledWith(true);
  });

  it("waits for context acknowledgement before creating a response", async () => {
    const client = makeClient();
    await client.connect();
    const channel = MockPeerConnection.latest!.channel;
    const pending = client.sendGuide(createInitialTourState("tra-pingxi"), "導覽文字", "guide-local");
    expect(channel.sent.at(-1)?.type).toBe("session.update");
    channel.emit({ type: "session.updated" });
    await pending;
    expect(channel.sent.at(-1)).toMatchObject({
      type: "response.create",
      response: { metadata: { local_response_id: "guide-local" } }
    });
  });

  it("ignores a completed response from an older revision", async () => {
    const done = vi.fn();
    const client = makeClient({ onResponseDone: done });
    await client.connect();
    const channel = MockPeerConnection.latest!.channel;
    const state = createInitialTourState("tra-pingxi");
    const first = client.sendGuide(state, "第一段", "old");
    channel.emit({ type: "session.updated" });
    await first;
    const second = client.sendGuide(state, "第二段", "current");
    channel.emit({ type: "session.updated" });
    await second;
    channel.emit({ type: "response.done", response: { metadata: { local_response_id: "old" } } });
    expect(done).not.toHaveBeenCalled();
    channel.emit({ type: "response.done", response: { metadata: { local_response_id: "current" } } });
    expect(done).toHaveBeenCalledWith("current");
  });
});

function makeClient(overrides: Partial<ConstructorParameters<typeof RealtimeWebRtcClient>[0]> = {}) {
  return new RealtimeWebRtcClient({
    onConnection: vi.fn(),
    onTranscript: vi.fn(),
    onTextDelta: vi.fn(),
    onResponseDone: vi.fn(),
    onSpeaking: vi.fn(),
    onError: vi.fn(),
    ...overrides
  });
}
