import type { TourEvent, TourState } from "../shared/tourOrchestrator";
import type { SpeechStatus } from "./speech";

export type RuntimeMode = "simulated" | "realtime";
export type RuntimeConnectionState = "unavailable" | "disconnected" | "connecting" | "connected" | "error";

export interface GuideRuntime {
  state: TourState;
  displayText: string;
  transcript: string;
  muted: boolean;
  speech: SpeechStatus;
  mode: RuntimeMode;
  realtimeAvailable: boolean;
  connection: RuntimeConnectionState;
  error?: string;
  connect(): Promise<void>;
  disconnect(): void;
  setMode(mode: RuntimeMode): Promise<void>;
  dispatch(event: TourEvent): void;
  ask(question: string): void;
  toggleMute(): void;
  startListening(): void;
  stopListening(): void;
}
