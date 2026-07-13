export type RailMode = "tra";

export type GuideLanguage = "zh-TW" | "en-US";

export type GpsStatus = "idle" | "active" | "weak" | "lost" | "estimated";

export type JourneyPhase = "idle" | "tracking" | "approaching_station" | "at_station" | "gps_lost";

export type JourneyEventType =
  | "journey_started"
  | "departed_station"
  | "between_stations"
  | "approaching_station"
  | "arrived_station"
  | "poi_recommendation"
  | "gps_lost";

export interface Station {
  id: string;
  name: string;
  lineId: string;
  lat: number;
  lng: number;
  order: number;
}

export interface Route {
  id: string;
  name: string;
  mode: RailMode;
  stationIds: string[];
}

export interface Poi {
  id: string;
  stationId: string;
  name: string;
  category: string;
  distanceMeters: number;
  pitchLine: string;
}

export interface StationStory {
  stationId: string;
  theme: string;
  summary: string;
  sourceNote: string;
}

export interface GpsPoint {
  lat: number;
  lng: number;
  accuracy: number;
  speed?: number | null;
  timestamp: number;
}

export interface JourneyState {
  journeyId: string;
  routeId: string;
  phase: JourneyPhase;
  gpsStatus: GpsStatus;
  currentStationId?: string;
  nextStationId?: string;
  triggeredEventIds: string[];
  lastPoint?: GpsPoint;
}

export interface LocationUpdateResult {
  state: JourneyState;
  event?: JourneyEventType;
  confidence: number;
  distanceToCurrentMeters?: number;
  distanceToNextMeters?: number;
}

export interface RealtimeClientSecretResponse {
  value?: string;
  expires_at?: number;
  session?: unknown;
  fallback?: boolean;
  error?: string;
}

export interface GuideContext {
  language: GuideLanguage;
  route: Route | null;
  currentStation?: Station;
  nextStation?: Station;
  relevantStories: StationStory[];
  relevantPois: Poi[];
  routeStationNames: string[];
  taskBrief: string;
}
