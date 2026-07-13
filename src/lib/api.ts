import type { GpsPoint, GuideLanguage, JourneyState, LocationUpdateResult, RealtimeClientSecretResponse, Route, Station, TrainSimulationState } from "../shared/types";

export interface JourneyStartResponse {
  journeyId: string;
  route: Route;
  stations: Station[];
  initialState: JourneyState;
}

export async function startJourney(routeId = "tra-pingxi"): Promise<JourneyStartResponse> {
  return postJson("/api/journey/start", { routeId, mode: "tra" });
}

export async function updateLocation(journeyId: string, point?: Partial<GpsPoint>): Promise<LocationUpdateResult> {
  return postJson("/api/location/update", { journeyId, ...point });
}

export async function createRealtimeSession(
  journeyId: string,
  routeId: string,
  language: GuideLanguage,
  simulation?: TrainSimulationState
): Promise<RealtimeClientSecretResponse> {
  return postJson("/api/realtime/session", { journeyId, routeId, language, simulation });
}

export async function sendFallbackChat(input: {
  journeyId?: string;
  message: string;
  language: GuideLanguage;
  currentStationId?: string;
  nextStationId?: string;
}): Promise<{ text: string }> {
  return postJson("/api/chat", input);
}

export async function callTool(name: string, args: unknown): Promise<unknown> {
  return postJson(`/api/tools/${name}`, args);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed: ${response.status}`);
  }
  return data;
}
