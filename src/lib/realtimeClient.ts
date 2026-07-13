import { callTool, createRealtimeSession } from "./api";
import type { GuideLanguage, JourneyEventType, JourneyState } from "../shared/types";

type RealtimeStatus = "idle" | "connecting" | "connected" | "fallback" | "error";

export interface RealtimeCallbacks {
  onStatus(status: RealtimeStatus): void;
  onMessage(message: string): void;
  onError(message: string): void;
}

export class RealtimeRailClient {
  private pc?: RTCPeerConnection;
  private dc?: RTCDataChannel;
  private micStream?: MediaStream;
  private audio?: HTMLAudioElement;
  private callbacks: RealtimeCallbacks;
  private journeyId = "";
  private routeId = "";
  private language: GuideLanguage = "zh-TW";

  constructor(callbacks: RealtimeCallbacks) {
    this.callbacks = callbacks;
  }

  async connect(journeyId: string, routeId: string, language: GuideLanguage): Promise<void> {
    this.disconnect();
    this.journeyId = journeyId;
    this.routeId = routeId;
    this.language = language;
    this.callbacks.onStatus("connecting");

    try {
      const token = await createRealtimeSession(journeyId, routeId, language);
      if (!token.value) {
        this.callbacks.onStatus("fallback");
        this.callbacks.onError(token.error ?? "Realtime session is unavailable; using text fallback.");
        return;
      }

      this.pc = new RTCPeerConnection();
      this.audio = document.createElement("audio");
      this.audio.autoplay = true;
      this.pc.ontrack = (event) => {
        if (this.audio) {
          this.audio.srcObject = event.streams[0];
        }
      };

      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.micStream.getAudioTracks().forEach((track) => this.pc?.addTrack(track, this.micStream!));

      this.dc = this.pc.createDataChannel("oai-events");
      this.dc.addEventListener("open", () => {
        this.callbacks.onStatus("connected");
        this.sendMissionBriefing();
      });
      this.dc.addEventListener("message", (event) => void this.handleServerEvent(event.data));

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${token.value}`,
          "Content-Type": "application/sdp"
        }
      });

      if (!sdpResponse.ok) {
        throw new Error(`OpenAI Realtime SDP exchange failed: ${sdpResponse.status}`);
      }

      await this.pc.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });
    } catch (error) {
      this.disconnect();
      this.callbacks.onStatus("fallback");
      this.callbacks.onError(error instanceof Error ? error.message : "Realtime connection failed; using text fallback.");
    }
  }

  disconnect(): void {
    this.dc?.close();
    this.pc?.close();
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.dc = undefined;
    this.pc = undefined;
    this.micStream = undefined;
    this.audio = undefined;
  }

  sendJourneyEvent(event: JourneyEventType, state: JourneyState): void {
    const text =
      this.language === "en-US"
        ? [
            "AI Rail Guide journey event.",
            `Event: ${event}`,
            `Journey ID: ${state.journeyId}`,
            `Current station ID: ${state.currentStationId ?? "unknown"}`,
            `Next station ID: ${state.nextStationId ?? "unknown"}`,
            "Use get_guide_context if needed. Speak a short TRA guide segment in English."
          ].join("\n")
        : [
            "AI Rail Guide 旅程事件。",
            `事件：${event}`,
            `旅程 ID：${state.journeyId}`,
            `目前站點 ID：${state.currentStationId ?? "unknown"}`,
            `下一站 ID：${state.nextStationId ?? "unknown"}`,
            "必要時呼叫 get_guide_context。請用繁體中文說一段短的台鐵導覽，不要用英文。"
          ].join("\n");
    this.sendUserText(text, true);
  }

  sendUserText(text: string, isSystemJourneyEvent = false): void {
    if (!this.dc || this.dc.readyState !== "open") {
      this.callbacks.onError("Realtime data channel is not open.");
      return;
    }
    this.dc.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }]
        }
      })
    );
    this.dc.send(JSON.stringify({ type: "response.create", response: { instructions: this.responseInstructions(isSystemJourneyEvent) } }));
  }

  private sendMissionBriefing(): void {
    const briefing =
      this.language === "en-US"
        ? [
            "Mission briefing: You are AI Rail Guide, a TRA cultural rail companion for the Pingxi Line.",
            "Your job is to narrate local station stories, react to GPS journey events, and answer user interruptions.",
            `journeyId=${this.journeyId}; routeId=${this.routeId}; language=en-US.`,
            "Call get_guide_context before your first substantive guide segment if you need context."
          ].join("\n")
        : [
            "任務簡報：你是 AI Rail Guide，平溪線台鐵文史軌道伴遊。",
            "你的工作是根據 GPS 旅程事件主動說站點故事、回答使用者插話，並在合適時提供下車探索建議。",
            `journeyId=${this.journeyId}; routeId=${this.routeId}; language=zh-TW。`,
            "第一次正式導覽前，如果需要上下文，請呼叫 get_guide_context。全程使用繁體中文。"
          ].join("\n");
    this.sendUserText(briefing, true);
  }

  private responseInstructions(isSystemJourneyEvent: boolean): string {
    if (this.language === "en-US") {
      return isSystemJourneyEvent
        ? "Speak English. Be a TRA rail guide. Keep this proactive guide segment under 45 seconds."
        : "Speak English unless the user asks otherwise. Answer briefly, then return to the rail journey context.";
    }
    return isSystemJourneyEvent
      ? "只能使用繁體中文。你是台鐵文史導覽員。這段主動導覽請控制在 45 秒內，不要用英文。"
      : "只能使用繁體中文，除非使用者明確要求其他語言。先回答插話，再回到軌道伴遊情境。";
  }

  private async handleServerEvent(raw: string): Promise<void> {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    const type = String(event.type ?? "");
    if (type === "response.text.delta" || type === "response.audio_transcript.delta") {
      this.callbacks.onMessage(String(event.delta ?? ""));
    }

    if (type === "response.function_call_arguments.done") {
      await this.handleFunctionCall(event);
    }
  }

  private async handleFunctionCall(event: Record<string, unknown>): Promise<void> {
    const name = String(event.name ?? "");
    const callId = String(event.call_id ?? "");
    if (!name || !callId) return;

    let args: unknown = {};
    try {
      args = JSON.parse(String(event.arguments ?? "{}"));
    } catch {
      args = {};
    }

    const payload =
      typeof args === "object" && args
        ? { journeyId: this.journeyId, routeId: this.routeId, language: this.language, ...args }
        : { journeyId: this.journeyId, routeId: this.routeId, language: this.language };
    const output = await callTool(name, payload);
    this.dc?.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(output)
        }
      })
    );
    this.dc?.send(JSON.stringify({ type: "response.create" }));
  }
}
