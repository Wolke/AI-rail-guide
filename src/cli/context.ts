import { randomUUID } from "node:crypto";
import { getRouteStations } from "../shared/seedData";

export type JourneyContextSource = "manual" | "scenario" | "gps" | "estimated";
export type JourneyContextPhase = "idle" | "traveling" | "narrating" | "answering_question" | "paused" | "completed";

export interface JourneyContextSnapshot {
  journeyId: string;
  revision: number;
  routeId: string;
  currentStationId: string;
  nextStationId?: string;
  phase: JourneyContextPhase;
  guideSegmentIndex: number;
  source: JourneyContextSource;
  updatedAt: string;
}

export type ContextPatch = Partial<Pick<JourneyContextSnapshot, "currentStationId" | "nextStationId" | "phase" | "guideSegmentIndex" | "source">>;

export class JourneyContextStore {
  private current: JourneyContextSnapshot;

  constructor(routeId = "tra-pingxi", journeyId: string = randomUUID()) {
    const stations = getRouteStations(routeId);
    if (!stations[0]) throw new Error(`Unknown or empty route: ${routeId}`);
    this.current = Object.freeze({
      journeyId,
      revision: 0,
      routeId,
      currentStationId: stations[0].id,
      nextStationId: stations[1]?.id,
      phase: "idle",
      guideSegmentIndex: 0,
      source: "manual",
      updatedAt: new Date().toISOString()
    });
  }

  snapshot(): JourneyContextSnapshot {
    return this.current;
  }

  update(patch: ContextPatch): JourneyContextSnapshot {
    const routeStations = getRouteStations(this.current.routeId);
    const stationIds = new Set(routeStations.map((station) => station.id));
    if (patch.currentStationId && !stationIds.has(patch.currentStationId)) throw new Error(`Unknown station: ${patch.currentStationId}`);
    if (patch.nextStationId && !stationIds.has(patch.nextStationId)) throw new Error(`Unknown next station: ${patch.nextStationId}`);
    if (patch.guideSegmentIndex != null && (!Number.isInteger(patch.guideSegmentIndex) || patch.guideSegmentIndex < 0)) {
      throw new Error("guideSegmentIndex must be a non-negative integer");
    }
    const next = { ...this.current, ...patch };
    if (sameContext(this.current, next)) return this.current;
    this.current = Object.freeze({ ...next, revision: this.current.revision + 1, updatedAt: new Date().toISOString() });
    return this.current;
  }

  moveTo(stationId: string, source: JourneyContextSource = "manual"): JourneyContextSnapshot {
    const stations = getRouteStations(this.current.routeId);
    const index = stations.findIndex((station) => station.id === stationId);
    if (index < 0) throw new Error(`Unknown station: ${stationId}`);
    return this.update({
      currentStationId: stationId,
      nextStationId: stations[index + 1]?.id,
      phase: stations[index + 1] ? "traveling" : "completed",
      guideSegmentIndex: 0,
      source
    });
  }
}

export function formatContext(snapshot: JourneyContextSnapshot): string {
  return [
    `journeyId=${snapshot.journeyId}`,
    `contextRevision=${snapshot.revision}`,
    `routeId=${snapshot.routeId}`,
    `currentStationId=${snapshot.currentStationId}`,
    `nextStationId=${snapshot.nextStationId ?? "none"}`,
    `phase=${snapshot.phase}`,
    `guideSegmentIndex=${snapshot.guideSegmentIndex}`,
    `source=${snapshot.source}`,
    `updatedAt=${snapshot.updatedAt}`
  ].join("; ");
}

function sameContext(a: JourneyContextSnapshot, b: JourneyContextSnapshot): boolean {
  return a.currentStationId === b.currentStationId && a.nextStationId === b.nextStationId && a.phase === b.phase && a.guideSegmentIndex === b.guideSegmentIndex && a.source === b.source;
}
