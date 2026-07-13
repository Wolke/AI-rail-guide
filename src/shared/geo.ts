import { getRouteStations } from "./seedData";
import type { GpsPoint, JourneyEventType, JourneyState, LocationUpdateResult, Station } from "./types";

const ARRIVAL_RADIUS_METERS = 180;
const APPROACHING_RADIUS_METERS = 900;
const WEAK_ACCURACY_METERS = 120;

export function distanceMeters(a: Pick<Station | GpsPoint, "lat" | "lng">, b: Pick<Station | GpsPoint, "lat" | "lng">): number {
  const earthRadius = 6371000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function eventId(event: JourneyEventType, stationId?: string): string {
  return `${event}:${stationId ?? "route"}`;
}

export function createInitialJourney(routeId: string): JourneyState {
  const routeStations = getRouteStations(routeId);
  return {
    journeyId: cryptoSafeId(),
    routeId,
    phase: "idle",
    gpsStatus: "idle",
    currentStationId: routeStations[0]?.id,
    nextStationId: routeStations[1]?.id,
    triggeredEventIds: []
  };
}

export function evaluateLocation(previous: JourneyState, point: GpsPoint): LocationUpdateResult {
  const routeStations = getRouteStations(previous.routeId);
  if (routeStations.length === 0) {
    return { state: { ...previous, gpsStatus: "lost", phase: "gps_lost", lastPoint: point }, event: "gps_lost", confidence: 0 };
  }

  const sortedByDistance = [...routeStations].sort((a, b) => distanceMeters(point, a) - distanceMeters(point, b));
  const nearest = sortedByDistance[0];
  const nearestIndex = routeStations.findIndex((station) => station.id === nearest.id);
  const next = routeStations[Math.min(nearestIndex + 1, routeStations.length - 1)];
  const distanceToCurrentMeters = distanceMeters(point, nearest);
  const distanceToNextMeters = next ? distanceMeters(point, next) : undefined;
  const gpsStatus = point.accuracy > WEAK_ACCURACY_METERS ? "weak" : "active";

  let phase = previous.phase === "idle" ? "tracking" : previous.phase;
  let event: JourneyEventType | undefined;
  let eventStationId = nearest.id;

  if (!previous.triggeredEventIds.includes(eventId("journey_started"))) {
    event = "journey_started";
    eventStationId = nearest.id;
  } else if (distanceToCurrentMeters <= ARRIVAL_RADIUS_METERS) {
    phase = "at_station";
    event = "arrived_station";
    eventStationId = nearest.id;
  } else if (next && distanceToNextMeters !== undefined && distanceToNextMeters <= APPROACHING_RADIUS_METERS) {
    phase = "approaching_station";
    event = "approaching_station";
    eventStationId = next.id;
  } else if (previous.currentStationId && previous.currentStationId !== nearest.id) {
    phase = "tracking";
    event = "departed_station";
    eventStationId = previous.currentStationId;
  } else {
    phase = "tracking";
    event = "between_stations";
    eventStationId = nearest.id;
  }

  const dedupeId = eventId(event, eventStationId);
  const shouldEmit = !previous.triggeredEventIds.includes(dedupeId);
  const triggeredEventIds = shouldEmit ? [...previous.triggeredEventIds, dedupeId] : previous.triggeredEventIds;
  const confidence = Math.max(0.1, Math.min(1, 1 - point.accuracy / 300));

  return {
    state: {
      ...previous,
      phase,
      gpsStatus,
      currentStationId: nearest.id,
      nextStationId: next?.id,
      triggeredEventIds,
      lastPoint: point
    },
    event: shouldEmit ? event : undefined,
    confidence,
    distanceToCurrentMeters,
    distanceToNextMeters
  };
}

export function markGpsLost(previous: JourneyState): LocationUpdateResult {
  const gpsLostId = eventId("gps_lost");
  const shouldEmit = !previous.triggeredEventIds.includes(gpsLostId);
  return {
    state: {
      ...previous,
      phase: "gps_lost",
      gpsStatus: previous.lastPoint ? "estimated" : "lost",
      triggeredEventIds: shouldEmit ? [...previous.triggeredEventIds, gpsLostId] : previous.triggeredEventIds
    },
    event: shouldEmit ? "gps_lost" : undefined,
    confidence: previous.lastPoint ? 0.25 : 0
  };
}

function cryptoSafeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `journey_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
