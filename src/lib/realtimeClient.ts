import { callTool, createRealtimeSession } from "./api";
import type { TourContext } from "../shared/tourOrchestrator";
import type { GuideLanguage, JourneyEventType, JourneyState } from "../shared/types";

type RealtimeStatus = "idle" | "connecting" | "connected" | "fallback" | "error";

export function formatTourContextLine(context: TourContext): string {
  return [
    "LATEST_CONTEXT",
    `routeId=${context.routeId}`,
    `language=${context.language}`,
    `phase=${context.phase}`,
    `currentStationId=${context.currentStationId}`,
    `currentStationName=${context.currentStationName}`,
    `nextStationId=${context.nextStationId ?? "none"}`,
    `nextStationName=${context.nextStationName ?? "none"}`,
    `guideSegmentIndex=${context.guideSegmentIndex}`,
    `pendingQuestionStatus=${context.pendingQuestionStatus}`
  ].join("; ");
}

export function buildRealtimeSessionInstructions(language: GuideLanguage, routeId: string, context?: TourContext): string {
  const languageRule =
    language === "en-US"
      ? "You must speak English unless the user explicitly requests another language."
      : "你必須全程使用繁體中文口語回答，除非使用者明確要求其他語言。";
  const latestContext = context ? formatTourContextLine(context) : `LATEST_CONTEXT routeId=${routeId}; language=${language}; currentStationId=unknown;`;
  return [
    languageRule,
    "You are AI Rail Guide, a professional TRA cultural guide. You are not a generic assistant.",
    "Always prioritize the newest simulation context over older conversation memory.",
    latestContext,
    "If the user jumps to another station, abandon the previous station and continue the guide from the new currentStationId.",
    "During guide narration, finish the current segment before answering pending passenger questions."
  ].join("\n");
}

export function buildRealtimeResponseInput(text: string) {
  return [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }]
    }
  ];
}

export function buildRealtimeResponsePayload(language: GuideLanguage, routeId: string, text: string, responseId: string, context?: TourContext, isSystemJourneyEvent = false) {
  const latestContext = context ? formatTourContextLine(context) : `LATEST_CONTEXT routeId=${routeId}; language=${language}; currentStationId=unknown;`;
  const responseInstructions =
    language === "en-US"
      ? isSystemJourneyEvent
        ? `Speak English. Be a TRA rail guide. Use this response input as the authoritative latest state. ${latestContext}`
        : `Speak English unless the user asks otherwise. Answer briefly, then return to the rail journey context. Use this response input as the authoritative latest state. ${latestContext}`
      : isSystemJourneyEvent
        ? `只能使用繁體中文。你是台鐵文史導覽員。本次 response input 是唯一權威狀態，不要延續上一站。${latestContext}`
        : `只能使用繁體中文，除非使用者明確要求其他語言。先回答插話，再回到軌道伴遊情境。本次 response input 是唯一權威狀態。${latestContext}`;
  return {
    instructions: responseInstructions,
    conversation: "none",
    metadata: {
      client_response_id: responseId,
      currentStationId: context?.currentStationId ?? "unknown",
      nextStationId: context?.nextStationId ?? "none",
      phase: context?.phase ?? "unknown"
    },
    input: buildRealtimeResponseInput(text)
  };
}

export interface RealtimeCallbacks {
  onStatus(status: RealtimeStatus): void;
  onMessage(message: string): void;
  onTranscript(text: string): void;
  onResponseDone(responseId?: string): void;
  onError(message: string): void;
  onDebug?(message: string): void;
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
  private latestContext?: TourContext;
  private lastSyncedContext = "";
  private lastIssuedResponseId?: string;

  constructor(callbacks: RealtimeCallbacks) {
    this.callbacks = callbacks;
  }

  async connect(journeyId: string, routeId: string, language: GuideLanguage): Promise<void> {
    this.disconnect();
    this.journeyId = journeyId;
    this.routeId = routeId;
    this.language = language;
    this.latestContext = undefined;
    this.lastSyncedContext = "";
    this.lastIssuedResponseId = undefined;
    this.callbacks.onStatus("connecting");

    try {
      if (!window.isSecureContext && !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
        throw new Error("Realtime voice requires HTTPS on mobile/LAN browsers. Use text fallback or open the app through HTTPS.");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not expose microphone access in the current context.");
      }
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
        if (this.latestContext) this.syncContext(this.latestContext);
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
    this.lastSyncedContext = "";
    this.lastIssuedResponseId = undefined;
    this.latestContext = undefined;
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

  syncContext(context: TourContext): void {
    this.latestContext = context;
    this.syncSessionContext(context);
  }

  sendUserText(text: string, isSystemJourneyEvent = false, responseId?: string): void {
    if (!this.dc || this.dc.readyState !== "open") {
      this.callbacks.onError("Realtime data channel is not open.");
      return;
    }
    this.resumeOutput();
    this.lastIssuedResponseId = responseId;
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

  sendIsolatedResponse(text: string, responseId: string, context: TourContext, isSystemJourneyEvent = false): void {
    if (!this.dc || this.dc.readyState !== "open") {
      this.callbacks.onError("Realtime data channel is not open.");
      return;
    }
    this.resumeOutput();
    this.lastIssuedResponseId = responseId;
    const payload = buildRealtimeResponsePayload(context.language, context.routeId, text, responseId, context, isSystemJourneyEvent);
    this.debug(
      `response.create ${responseId}: current=${context.currentStationName}(${context.currentStationId}), next=${context.nextStationName ?? "none"}(${context.nextStationId ?? "none"}), phase=${context.phase}`
    );
    console.debug("[AI Rail Realtime] response.create", payload);
    this.dc.send(
      JSON.stringify({
        type: "response.create",
        event_id: responseId,
        response: payload
      })
    );
  }

  sendGuideSegment(context: TourContext, segmentText: string, segmentLabel: string, responseId: string): void {
    this.syncContext(context);
    const latestContext = this.latestContextLine(context);
    const text =
      context.language === "en-US"
        ? [
            `CONTROL_RESPONSE_ID=${responseId}`,
            latestContext,
            `Guide segment: ${segmentLabel}`,
            segmentText,
            "This is the latest station context. Ignore any previous station context if it conflicts.",
            "Deliver only this segment as a professional rail guide. Do not answer pending passenger questions until this segment is complete."
          ].join("\n")
        : [
            `CONTROL_RESPONSE_ID=${responseId}`,
            latestContext,
            `導覽段落：${segmentLabel}`,
            segmentText,
            "這是最新站點 context；如果和先前站點記憶衝突，一律以這裡為準。",
            "請像專業台鐵導遊一樣，只講這一段。講完整段落後停下，不要在段落中途回答旅客問題。"
          ].join("\n");
    this.sendIsolatedResponse(text, responseId, context, true);
  }

  answerQuestion(context: TourContext, question: string, responseId: string): void {
    this.syncContext(context);
    const text =
      context.language === "en-US"
        ? [
            `CONTROL_RESPONSE_ID=${responseId}`,
            this.latestContextLine(context),
            `A passenger asked during the previous guide segment: "${question}".`,
            `Answer it now around ${context.currentStationName}, then bridge back to the tour.`
          ].join("\n")
        : [
            `CONTROL_RESPONSE_ID=${responseId}`,
            this.latestContextLine(context),
            `旅客剛剛在上一段導覽中問：「${question}」。`,
            `現在請先回答這個問題，地點脈絡是 ${context.currentStationName}，回答後自然接回導覽。`
          ].join("\n");
    this.sendIsolatedResponse(text, responseId, context);
  }

  askQuestionClarification(context: TourContext, question: string, responseId: string): void {
    this.syncContext(context);
    const text =
      context.language === "en-US"
        ? [
            `CONTROL_RESPONSE_ID=${responseId}`,
            this.latestContextLine(context),
            `The passenger seemed to ask a question, but it was unclear: "${question}". Ask one concise clarification question.`
          ].join("\n")
        : [
            `CONTROL_RESPONSE_ID=${responseId}`,
            this.latestContextLine(context),
            `旅客剛剛像是想問問題，但不夠清楚：「${question}」。請用一句話反問他想問哪一部分。`
          ].join("\n");
    this.sendIsolatedResponse(text, responseId, context);
  }

  cancelResponse(): void {
    if (this.dc?.readyState === "open") {
      this.debug("response.cancel + output_audio_buffer.clear");
      this.dc.send(JSON.stringify({ type: "response.cancel" }));
      this.dc.send(JSON.stringify({ type: "output_audio_buffer.clear" }));
    }
    this.lastIssuedResponseId = undefined;
  }

  muteOutput(): void {
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

  private syncSessionContext(context: TourContext): void {
    if (this.dc?.readyState !== "open") return;
    const latestContext = this.latestContextLine(context);
    if (latestContext === this.lastSyncedContext) return;
    this.lastSyncedContext = latestContext;
    this.debug(`session.update ${latestContext}`);
    this.dc.send(
      JSON.stringify({
        type: "session.update",
        session: {
          instructions: this.sessionInstructions(context),
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

  private sessionInstructions(context?: TourContext): string {
    return buildRealtimeSessionInstructions(this.language, this.routeId, context ?? this.latestContext);
  }

  private latestContextLine(context: TourContext): string {
    return formatTourContextLine(context);
  }

  private responseInstructions(isSystemJourneyEvent: boolean): string {
    const latestContext = this.latestContext ? this.latestContextLine(this.latestContext) : `LATEST_CONTEXT routeId=${this.routeId}; language=${this.language}; currentStationId=unknown;`;
    if (this.language === "en-US") {
      return isSystemJourneyEvent
        ? `Speak English. Be a TRA rail guide. Use the newest station context only. ${latestContext}`
        : `Speak English unless the user asks otherwise. Answer briefly, then return to the rail journey context. ${latestContext}`;
    }
    return isSystemJourneyEvent
      ? `只能使用繁體中文。你是台鐵文史導覽員。只使用最新站點 context，不要延續上一站。${latestContext}`
      : `只能使用繁體中文，除非使用者明確要求其他語言。先回答插話，再回到軌道伴遊情境。${latestContext}`;
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

    if (type === "error") {
      this.callbacks.onError(`Realtime error: ${JSON.stringify(event.error ?? event)}`);
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      this.callbacks.onTranscript(String(event.transcript ?? ""));
    }

    if (type === "response.done") {
      const responseId = extractClientResponseId(event) ?? this.lastIssuedResponseId;
      if (responseId === this.lastIssuedResponseId) this.lastIssuedResponseId = undefined;
      this.debug(`response.done ${responseId ?? "unknown"}`);
      this.callbacks.onResponseDone(responseId);
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
    if (this.latestContext) Object.assign(payload, { tourContext: this.latestContext });
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

  private debug(message: string): void {
    this.callbacks.onDebug?.(`[Realtime debug] ${message}`);
  }
}

function extractClientResponseId(event: Record<string, unknown>): string | undefined {
  const response = event.response;
  if (!response || typeof response !== "object") return undefined;
  const metadata = (response as Record<string, unknown>).metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  const value = (metadata as Record<string, unknown>).client_response_id;
  return typeof value === "string" ? value : undefined;
}
