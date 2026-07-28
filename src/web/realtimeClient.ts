import { getStationPois, getStationStory } from "../shared/seedData";
import type { TourState } from "../shared/tourOrchestrator";

interface RealtimeCallbacks {
  onConnection(connected: boolean): void;
  onTranscript(text: string): void;
  onTextDelta(delta: string): void;
  onResponseDone(localResponseId?: string): void;
  onSpeaking(speaking: boolean): void;
  onError(message: string): void;
}

interface PendingAck {
  revision: number;
  resolve(): void;
  reject(error: Error): void;
  timer: number;
}

const tools = [
  {
    type: "function",
    name: "get_station_story",
    description: "取得目前站已審核並附來源的導覽故事。只能查詢 session context 指定的站。",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    type: "function",
    name: "get_station_pois",
    description: "取得目前站已收錄的下車景點建議。不能回答即時營業或班次。",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  }
];

export class RealtimeWebRtcClient {
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private stream?: MediaStream;
  private audio?: HTMLAudioElement;
  private revision = 0;
  private stationId = "";
  private pendingAcks = new Map<string, PendingAck>();
  private responseRevision = new Map<string, number>();
  private activeLocalResponseId?: string;

  constructor(private readonly callbacks: RealtimeCallbacks) {}

  isConnected(): boolean {
    return this.channel?.readyState === "open";
  }

  async connect(): Promise<void> {
    this.disconnect();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      const peer = new RTCPeerConnection();
      this.peer = peer;
      for (const track of this.stream.getTracks()) peer.addTrack(track, this.stream);
      this.audio = new Audio();
      this.audio.autoplay = true;
      peer.ontrack = (event) => {
        if (this.audio) this.audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      };
      peer.onconnectionstatechange = () => {
        if (["failed", "closed", "disconnected"].includes(peer.connectionState)) this.callbacks.onConnection(false);
      };
      const channel = peer.createDataChannel("oai-events");
      this.channel = channel;
      channel.onmessage = (event) => this.handleEvent(String(event.data));
      channel.onerror = () => this.callbacks.onError("Realtime 資料通道發生錯誤。");

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const response = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp ?? ""
      });
      if (!response.ok) throw new Error(response.status === 503 ? "本機尚未設定 OPENAI_API_KEY。" : "無法建立 Realtime session。");
      await peer.setRemoteDescription({ type: "answer", sdp: await response.text() });
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("Realtime 連線逾時。")), 12_000);
        const finish = () => {
          window.clearTimeout(timer);
          this.callbacks.onConnection(true);
          resolve();
        };
        if (channel.readyState === "open") {
          finish();
          return;
        }
        channel.onopen = finish;
      });
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }

  disconnect(): void {
    for (const ack of this.pendingAcks.values()) {
      window.clearTimeout(ack.timer);
      ack.reject(new Error("Realtime session 已關閉"));
    }
    this.pendingAcks.clear();
    this.channel?.close();
    this.peer?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.audio) this.audio.srcObject = null;
    this.channel = undefined;
    this.peer = undefined;
    this.stream = undefined;
    this.callbacks.onConnection(false);
    this.callbacks.onSpeaking(false);
  }

  setMuted(muted: boolean): void {
    if (this.audio) this.audio.muted = muted;
  }

  setMicrophoneEnabled(enabled: boolean): void {
    this.stream?.getAudioTracks().forEach((track) => { track.enabled = enabled; });
  }

  cancel(): void {
    if (!this.isConnected()) return;
    this.send({ type: "response.cancel" });
    this.callbacks.onSpeaking(false);
  }

  async syncContext(state: TourState): Promise<number> {
    this.assertConnected();
    this.cancel();
    const revision = ++this.revision;
    this.stationId = state.currentStationId;
    const eventId = `context-${revision}-${crypto.randomUUID()}`;
    const promise = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pendingAcks.delete(eventId);
        reject(new Error("Realtime context 同步逾時。"));
      }, 8_000);
      this.pendingAcks.set(eventId, { revision, resolve, reject, timer });
    });
    this.send({
      event_id: eventId,
      type: "session.update",
      session: {
        type: "realtime",
        instructions: instructionsFor(state, revision),
        output_modalities: ["audio"],
        audio: {
          input: {
            transcription: { model: "gpt-4o-mini-transcribe" },
            turn_detection: { type: "semantic_vad", eagerness: "low", create_response: false, interrupt_response: false }
          }
        },
        tools
      }
    });
    await promise;
    return revision;
  }

  async sendGuide(state: TourState, text: string, localResponseId: string): Promise<void> {
    const revision = await this.syncContext(state);
    this.createResponse(revision, localResponseId, `請根據目前 authoritative context 口語導覽這一段，內容限於：${text}`);
  }

  async sendQuestion(state: TourState, question: string, localResponseId: string): Promise<void> {
    const revision = await this.syncContext(state);
    this.createResponse(revision, localResponseId, `旅客問：「${question}」。先回答，再自然接回目前站點。需要事實時必須呼叫工具。`);
  }

  private createResponse(revision: number, localResponseId: string, text: string): void {
    const eventId = `response-${revision}-${crypto.randomUUID()}`;
    this.responseRevision.set(localResponseId, revision);
    this.callbacks.onSpeaking(true);
    this.activeLocalResponseId = localResponseId;
    this.send({
      event_id: eventId,
      type: "response.create",
      response: {
        conversation: "none",
        output_modalities: ["audio"],
        metadata: { local_response_id: localResponseId, context_revision: String(revision) },
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text }] }]
      }
    });
  }

  private handleEvent(raw: string): void {
    let event: Record<string, any>;
    try { event = JSON.parse(raw); } catch { return; }
    if (event.type === "session.updated") {
      const ack = this.pendingAcks.get(String(event.event_id ?? "")) ?? [...this.pendingAcks.values()][0];
      const key = [...this.pendingAcks.entries()].find(([, value]) => value === ack)?.[0];
      if (ack && key) {
        window.clearTimeout(ack.timer);
        this.pendingAcks.delete(key);
        ack.resolve();
      }
      return;
    }
    if (event.type === "error") {
      this.callbacks.onError("Realtime 服務回報錯誤，請稍後重試。");
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.completed" && typeof event.transcript === "string") {
      this.callbacks.onTranscript(event.transcript);
    }
    if (["response.output_audio_transcript.delta", "response.output_text.delta"].includes(event.type) && typeof event.delta === "string") {
      this.callbacks.onTextDelta(event.delta);
    }
    if (event.type === "response.function_call_arguments.done") this.handleToolCall(event);
    if (event.type === "response.done") {
      const localResponseId = (event.response?.metadata?.local_response_id as string | undefined) ?? this.activeLocalResponseId;
      if (localResponseId && this.responseRevision.get(localResponseId) !== this.revision) return;
      this.callbacks.onSpeaking(false);
      this.callbacks.onResponseDone(localResponseId);
      this.activeLocalResponseId = undefined;
    }
  }

  private handleToolCall(event: Record<string, any>): void {
    const callId = String(event.call_id ?? "");
    const name = String(event.name ?? "");
    const story = getStationStory(this.stationId);
    const output = name === "get_station_story"
      ? story && story.reviewStatus !== "draft" ? { theme: story.theme, summary: story.summary, sources: story.sources } : { unavailable: true }
      : name === "get_station_pois" ? getStationPois(this.stationId) : { error: "unknown_tool" };
    this.send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) }
    });
    this.send({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        metadata: { local_response_id: this.activeLocalResponseId ?? "", context_revision: String(this.revision) }
      }
    });
  }

  private send(event: Record<string, unknown>): void {
    this.assertConnected();
    this.channel!.send(JSON.stringify(event));
  }

  private assertConnected(): void {
    if (!this.isConnected()) throw new Error("Realtime 尚未連線。");
  }
}

function instructionsFor(state: TourState, revision: number): string {
  return [
    "你是 RailTalk 平溪線導覽員，只能使用繁體中文口語。",
    "不得編造即時班次、營業時間、票價或未由工具提供的史實。",
    "旅客問題優先；回答完成後停下，不得自行切換站點。",
    `contextRevision=${revision}`,
    `routeId=${state.routeId}`,
    `currentStationId=${state.currentStationId}`,
    `nextStationId=${state.nextStationId ?? "none"}`,
    `phase=${state.phase}`,
    `guideSegmentIndex=${state.guideSegmentIndex}`
  ].join("\n");
}
