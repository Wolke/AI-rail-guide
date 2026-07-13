import { callTool, createRealtimeSession } from "./api";
import type { JourneyEventType, JourneyState } from "../shared/types";

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

  constructor(callbacks: RealtimeCallbacks) {
    this.callbacks = callbacks;
  }

  async connect(journeyId: string, routeId: string): Promise<void> {
    this.disconnect();
    this.journeyId = journeyId;
    this.callbacks.onStatus("connecting");

    try {
      const token = await createRealtimeSession(journeyId, routeId);
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
    const text = [
      "Rail journey event received.",
      `event=${event}`,
      `journeyId=${state.journeyId}`,
      `currentStationId=${state.currentStationId ?? "unknown"}`,
      `nextStationId=${state.nextStationId ?? "unknown"}`,
      "Please speak a short, contextual TRA guide segment in Traditional Chinese."
    ].join("\n");
    this.sendUserText(text);
  }

  sendUserText(text: string): void {
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
    this.dc.send(JSON.stringify({ type: "response.create" }));
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

    const payload = typeof args === "object" && args ? { journeyId: this.journeyId, ...args } : { journeyId: this.journeyId };
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
