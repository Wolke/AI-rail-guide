import { callTool, createRealtimeSession } from "./api";
import type { GuideLanguage, JourneyEventType, JourneyState, TrainSimulationState } from "../shared/types";

type RealtimeStatus = "idle" | "connecting" | "connected" | "fallback" | "error";

export interface RealtimeCallbacks {
  onStatus(status: RealtimeStatus): void;
  onMessage(message: string): void;
  onTranscript(text: string): void;
  onResponseDone(): void;
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
  private simulation?: TrainSimulationState;

  constructor(callbacks: RealtimeCallbacks) {
    this.callbacks = callbacks;
  }

  async connect(journeyId: string, routeId: string, language: GuideLanguage, simulation?: TrainSimulationState): Promise<void> {
    this.disconnect();
    this.journeyId = journeyId;
    this.routeId = routeId;
    this.language = language;
    this.simulation = simulation;
    this.callbacks.onStatus("connecting");

    try {
      if (!window.isSecureContext && !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
        throw new Error("Realtime voice requires HTTPS on mobile/LAN browsers. Use text fallback or open the app through HTTPS.");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not expose microphone access in the current context.");
      }
      const token = await createRealtimeSession(journeyId, routeId, language, simulation);
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

  setSimulation(simulation: TrainSimulationState): void {
    this.simulation = simulation;
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
    this.resumeOutput();
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

  sendGuideSegment(segmentText: string, segmentLabel: string): void {
    const text =
      this.language === "en-US"
        ? [
            `Guide segment: ${segmentLabel}`,
            segmentText,
            "Deliver only this segment as a professional rail guide. Do not answer pending passenger questions until this segment is complete."
          ].join("\n")
        : [
            `導覽段落：${segmentLabel}`,
            segmentText,
            "請像專業台鐵導遊一樣，只講這一段。講完整段落後停下，不要在段落中途回答旅客問題。"
          ].join("\n");
    this.sendUserText(text, true);
  }

  answerPendingQuestion(question: string, stationName: string): void {
    const text =
      this.language === "en-US"
        ? `A passenger asked during the previous guide segment: "${question}". Answer it now around ${stationName}, then bridge back to the tour.`
        : `旅客剛剛在上一段導覽中問：「${question}」。現在請先回答這個問題，地點脈絡是 ${stationName}，回答後自然接回導覽。`;
    this.sendUserText(text, false);
  }

  askQuestionClarification(question: string): void {
    const text =
      this.language === "en-US"
        ? `The passenger seemed to ask a question, but it was unclear: "${question}". Ask one concise clarification question.`
        : `旅客剛剛像是想問問題，但不夠清楚：「${question}」。請用一句話反問他想問哪一部分。`;
    this.sendUserText(text, false);
  }

  cancelResponse(): void {
    if (this.dc?.readyState === "open") {
      this.dc.send(JSON.stringify({ type: "response.cancel" }));
    }
  }

  stopOutput(): void {
    this.cancelResponse();
    if (this.audio) {
      this.audio.muted = true;
      this.audio.pause();
    }
  }

  resumeOutput(): void {
    if (this.audio) {
      this.audio.muted = false;
      void this.audio.play().catch(() => undefined);
    }
  }

  updateGuideTurnMode(): void {
    if (this.dc?.readyState !== "open") return;
    this.dc.send(
      JSON.stringify({
        type: "session.update",
        session: {
          audio: {
            input: {
              turn_detection: {
                type: "semantic_vad",
                eagerness: "low",
                create_response: false,
                interrupt_response: false
              }
            }
          }
        }
      })
    );
  }

  private sendMissionBriefing(): void {
    const briefing =
      this.language === "en-US"
        ? [
            "Mission briefing: You are AI Rail Guide, a TRA cultural rail companion for the Pingxi Line.",
            "Your job is to narrate local station stories, react to GPS journey events, and answer user interruptions.",
          `journeyId=${this.journeyId}; routeId=${this.routeId}; language=en-US.`,
          this.simulation ? `simulation=${JSON.stringify(this.simulation)}` : "",
          "Call get_guide_context before your first substantive guide segment if you need context."
          ].join("\n")
        : [
            "任務簡報：你是 AI Rail Guide，平溪線台鐵文史軌道伴遊。",
            "你的工作是根據 GPS 旅程事件主動說站點故事、回答使用者插話，並在合適時提供下車探索建議。",
          `journeyId=${this.journeyId}; routeId=${this.routeId}; language=zh-TW。`,
          this.simulation ? `simulation=${JSON.stringify(this.simulation)}。` : "",
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

    if (type === "conversation.item.input_audio_transcription.completed") {
      this.callbacks.onTranscript(String(event.transcript ?? ""));
    }

    if (type === "response.done") {
      this.callbacks.onResponseDone();
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
    if (this.simulation) {
      Object.assign(payload, { simulation: this.simulation });
    }
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
