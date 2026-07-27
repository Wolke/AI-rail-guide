import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { JourneyContextSnapshot } from "./context";
import { formatContext } from "./context";
import { callLocalTool, realtimeTools } from "./tools";
import { contextTrace, SessionTrace } from "./trace";

interface ResponseRequest {
  correlationId: string;
  snapshot: JourneyContextSnapshot;
  purpose: "passenger" | "guide" | "microphone" | "tool_continuation";
}

interface SessionAck {
  eventId: string;
  snapshot: JourneyContextSnapshot;
  resolve(): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export interface RealtimeClientOptions {
  apiKey: string;
  model?: string;
  voice?: string;
  trace: SessionTrace;
  getSnapshot(): JourneyContextSnapshot;
  onAudio?(pcm: Buffer): void;
  onText?(text: string): void;
  onTranscript?(text: string): void;
  onOutputCleared?(): void;
  onError?(error: Error): void;
}

export class RealtimeCliClient {
  private socket?: WebSocket;
  private readonly requests = new Map<string, ResponseRequest>();
  private readonly remoteResponses = new Map<string, ResponseRequest>();
  private readonly activeRemoteResponseIds = new Set<string>();
  private readonly sessionAcks: SessionAck[] = [];
  private connected = false;
  private sessionConfigured = false;

  constructor(private readonly options: RealtimeClientOptions) {}

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    const model = this.options.model ?? process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1";
    const socket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${this.options.apiKey}` }
    });
    this.socket = socket;
    socket.on("message", (data) => void this.handleServerEvent(data.toString()));
    socket.on("error", (error) => this.reportError(error));
    socket.on("close", () => {
      this.connected = false;
      this.rejectSessionAcks(new Error("Realtime socket closed"));
      void this.options.trace.record("local", "connection.closed");
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Realtime connection timed out")), 15_000);
      socket.once("open", () => {
        clearTimeout(timer);
        this.connected = true;
        void this.options.trace.record("local", "connection.open", { detail: { model } });
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    await this.syncContext(this.options.getSnapshot());
  }

  disconnect(): void {
    this.connected = false;
    this.sessionConfigured = false;
    this.rejectSessionAcks(new Error("Realtime client disconnected"));
    this.socket?.close();
    this.socket = undefined;
    this.requests.clear();
    this.remoteResponses.clear();
    this.activeRemoteResponseIds.clear();
  }

  async syncContext(snapshot: JourneyContextSnapshot): Promise<void> {
    this.assertConnected();
    if (this.sessionAcks.length) throw new Error("A context update is already awaiting session.updated");
    const eventId = `context-${snapshot.revision}-${randomUUID()}`;
    const promise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.sessionAcks.findIndex((ack) => ack.eventId === eventId);
        if (index >= 0) this.sessionAcks.splice(index, 1);
        reject(new Error(`session.update timed out for context revision ${snapshot.revision}`));
      }, 8_000);
      this.sessionAcks.push({ eventId, snapshot, resolve, reject, timer });
    });
    const session = this.sessionConfigured
      ? {
          type: "realtime",
          instructions: sessionInstructions(snapshot),
          audio: { input: { turn_detection: { type: "semantic_vad", eagerness: "low", create_response: false, interrupt_response: false } } }
        }
      : {
          type: "realtime",
          instructions: sessionInstructions(snapshot),
          output_modalities: ["audio"],
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: { model: "gpt-4o-mini-transcribe" },
              turn_detection: { type: "semantic_vad", eagerness: "low", create_response: false, interrupt_response: false }
            },
            output: { format: { type: "audio/pcm", rate: 24000 }, voice: this.options.voice ?? process.env.OPENAI_REALTIME_VOICE ?? "marin" }
          },
          tools: realtimeTools
        };
    this.send({
      event_id: eventId,
      type: "session.update",
      session
    }, snapshot);
    await promise;
    this.sessionConfigured = true;
  }

  async updateContext(snapshot: JourneyContextSnapshot): Promise<void> {
    if (!this.connected) return;
    this.cancelActive();
    await this.syncContext(snapshot);
  }

  sendPassengerText(text: string, snapshot = this.options.getSnapshot()): string {
    return this.createResponse(snapshot, "passenger", [{ type: "message", role: "user", content: [{ type: "input_text", text }] }]);
  }

  sendGuide(snapshot = this.options.getSnapshot()): string {
    const input = `Begin the guide segment for the authoritative context below. Call get_guide_context if details are needed.\n${formatContext(snapshot)}`;
    return this.createResponse(snapshot, "guide", [{ type: "message", role: "user", content: [{ type: "input_text", text: input }] }]);
  }

  appendMicrophoneAudio(pcm: Buffer): void {
    if (!this.connected || pcm.length === 0) return;
    this.send({ type: "input_audio_buffer.append", audio: pcm.toString("base64") }, this.options.getSnapshot(), false);
  }

  createMicrophoneResponse(): string {
    return this.createResponse(this.options.getSnapshot(), "microphone");
  }

  cancelActive(): void {
    this.options.onOutputCleared?.();
    if (!this.connected || this.activeRemoteResponseIds.size === 0) return;
    const responseId = [...this.activeRemoteResponseIds].at(-1);
    this.send({ type: "response.cancel", ...(responseId ? { response_id: responseId } : {}) }, this.options.getSnapshot());
  }

  private createResponse(snapshot: JourneyContextSnapshot, purpose: ResponseRequest["purpose"], input?: unknown[]): string {
    this.assertConnected();
    const correlationId = `${purpose}-${snapshot.revision}-${randomUUID()}`;
    const request = { correlationId, snapshot, purpose };
    this.requests.set(correlationId, request);
    this.send({
      event_id: correlationId,
      type: "response.create",
      response: {
        conversation: input ? "none" : "auto",
        output_modalities: ["audio"],
        instructions: responseInstructions(snapshot, purpose),
        metadata: correlationMetadata(request),
        ...(input ? { input } : {})
      }
    }, snapshot);
    return correlationId;
  }

  private async handleServerEvent(raw: string): Promise<void> {
    let event: Record<string, any>;
    try {
      event = JSON.parse(raw);
    } catch {
      await this.options.trace.record("server", "invalid_json", { detail: raw.slice(0, 500) });
      return;
    }
    const type = String(event.type ?? "unknown");
    const responseId = String(event.response_id ?? event.response?.id ?? "") || undefined;
    const metadata = event.response?.metadata as Record<string, unknown> | undefined;
    const correlationId = typeof metadata?.correlation_id === "string" ? metadata.correlation_id : responseId ? this.remoteResponses.get(responseId)?.correlationId : undefined;
    const request = correlationId ? this.requests.get(correlationId) : responseId ? this.remoteResponses.get(responseId) : undefined;
    const acknowledgedContext = type === "session.updated" ? this.sessionAcks[0]?.snapshot : undefined;
    await this.options.trace.record("server", type, {
      eventId: typeof event.event_id === "string" ? event.event_id : undefined,
      responseId,
      correlationId,
      ...(request ? contextTrace(request.snapshot) : acknowledgedContext ? contextTrace(acknowledgedContext) : {}),
      detail: summarizeEvent(event)
    });

    if (type === "session.updated") {
      const ack = this.sessionAcks.shift();
      if (ack) {
        clearTimeout(ack.timer);
        ack.resolve();
      }
      return;
    }
    if (type === "error") {
      const relatedEventId = typeof event.error?.event_id === "string" ? event.error.event_id : undefined;
      const ackIndex = relatedEventId ? this.sessionAcks.findIndex((item) => item.eventId === relatedEventId) : -1;
      const error = new Error(event.error?.message ?? "Realtime API error");
      if (ackIndex >= 0) {
        const [ack] = this.sessionAcks.splice(ackIndex, 1);
        clearTimeout(ack.timer);
        ack.reject(error);
      }
      if (relatedEventId) this.requests.delete(relatedEventId);
      this.reportError(error);
      return;
    }
    if (type === "response.created" && responseId && correlationId) {
      const created = this.requests.get(correlationId);
      if (created) {
        this.remoteResponses.set(responseId, created);
        this.activeRemoteResponseIds.add(responseId);
      }
    }
    if ((type === "response.output_audio.delta" || type === "response.audio.delta") && typeof event.delta === "string") {
      this.options.onAudio?.(Buffer.from(event.delta, "base64"));
    }
    if (["response.output_audio_transcript.delta", "response.output_text.delta", "response.audio_transcript.delta", "response.text.delta"].includes(type) && typeof event.delta === "string") {
      this.options.onText?.(event.delta);
    }
    if (type === "conversation.item.input_audio_transcription.completed" && typeof event.transcript === "string") this.options.onTranscript?.(event.transcript);
    if (type === "input_audio_buffer.committed") this.createMicrophoneResponse();
    if (type === "response.function_call_arguments.done") await this.handleToolCall(event, request);
    if (type === "response.done") this.finishResponse(event, request, responseId);
  }

  private async handleToolCall(event: Record<string, any>, request?: ResponseRequest): Promise<void> {
    if (!request) throw new Error("Uncorrelated function call response");
    const current = this.options.getSnapshot();
    if (request.snapshot.revision !== current.revision) {
      await this.options.trace.record("local", "tool.stale_ignored", { correlationId: request.correlationId, ...contextTrace(request.snapshot) });
      return;
    }
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(String(event.arguments ?? "{}")); } catch { /* trace already contains the malformed event */ }
    const name = String(event.name ?? "");
    const callId = String(event.call_id ?? "");
    const output = callLocalTool(name, args, request.snapshot);
    const continuationId = `tool_continuation-${request.snapshot.revision}-${randomUUID()}`;
    const continuation: ResponseRequest = { correlationId: continuationId, snapshot: request.snapshot, purpose: "tool_continuation" };
    this.requests.set(continuationId, continuation);
    this.send({
      event_id: continuationId,
      type: "response.create",
      response: {
        conversation: "none",
        output_modalities: ["audio"],
        instructions: responseInstructions(request.snapshot, "tool_continuation"),
        metadata: { ...correlationMetadata(continuation), parent_correlation_id: request.correlationId },
        input: [
          { type: "function_call", call_id: callId, name, arguments: String(event.arguments ?? "{}") },
          { type: "function_call_output", call_id: callId, output: JSON.stringify(output) }
        ]
      }
    }, request.snapshot);
  }

  private finishResponse(event: Record<string, any>, request?: ResponseRequest, responseId?: string): void {
    if (!request) {
      this.reportError(new Error(`Uncorrelated response.done: ${responseId ?? "unknown"}`));
      return;
    }
    if (request.snapshot.revision !== this.options.getSnapshot().revision) {
      void this.options.trace.record("local", "response.stale_ignored", { correlationId: request.correlationId, ...contextTrace(request.snapshot) });
    }
    if (event.response?.status === "failed") this.reportError(new Error(event.response?.status_details?.error?.message ?? "Realtime response failed"));
    this.requests.delete(request.correlationId);
    if (responseId) {
      this.remoteResponses.delete(responseId);
      this.activeRemoteResponseIds.delete(responseId);
    }
  }

  private send(event: Record<string, unknown>, snapshot: JourneyContextSnapshot, trace = true): void {
    this.assertConnected();
    this.socket!.send(JSON.stringify(event));
    if (trace) void this.options.trace.record("client", String(event.type), { eventId: typeof event.event_id === "string" ? event.event_id : undefined, ...contextTrace(snapshot), detail: summarizeEvent(event) });
  }

  private assertConnected(): void {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) throw new Error("Realtime WebSocket is not connected");
  }

  private rejectSessionAcks(error: Error): void {
    for (const ack of this.sessionAcks.splice(0)) {
      clearTimeout(ack.timer);
      ack.reject(error);
    }
  }

  private reportError(error: Error): void {
    this.options.onError?.(error);
    void this.options.trace.record("local", "error", { detail: error.message });
  }
}

function sessionInstructions(snapshot: JourneyContextSnapshot): string {
  return [
    "你是 AI-rail-voice，專業台鐵平溪線文史導遊，全程使用繁體中文口語。",
    "每次回答都必須服從 response instructions 內的最新 context revision。",
    "若舊對話和最新 context 衝突，一律忽略舊站點。不得編造即時班次、營業資訊或來源。",
    formatContext(snapshot)
  ].join("\n");
}

function responseInstructions(snapshot: JourneyContextSnapshot, purpose: ResponseRequest["purpose"]): string {
  return [
    "只能使用繁體中文。你是台鐵文史導覽員。",
    `本次 response 的唯一權威狀態如下；不得使用其他 revision：${formatContext(snapshot)}`,
    purpose === "guide" ? "只講目前指定站點的一段導覽；需要資料時呼叫本地工具。" : "先回答旅客，再自然接回目前站點的導覽。",
    "回答完成後停下，不要自行切換站點。"
  ].join("\n");
}

function correlationMetadata(request: ResponseRequest): Record<string, string> {
  return {
    correlation_id: request.correlationId,
    context_revision: String(request.snapshot.revision),
    current_station_id: request.snapshot.currentStationId,
    purpose: request.purpose
  };
}

function summarizeEvent(event: Record<string, any>): unknown {
  const copy = { ...event };
  if (copy.audio) copy.audio = `[base64 ${String(copy.audio).length} chars]`;
  if (copy.delta && /audio/.test(String(copy.type))) copy.delta = `[base64 ${String(copy.delta).length} chars]`;
  if (copy.response?.output) copy.response = { ...copy.response, output: `[${copy.response.output.length} output items]` };
  return copy;
}
