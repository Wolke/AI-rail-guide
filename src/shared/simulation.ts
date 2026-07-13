import { getRouteStations, getStationGuideScript } from "./seedData";
import type { PendingQuestion, TrainSimulationState } from "./types";

export const DEFAULT_ROUTE_ID = "tra-pingxi";
export const NORMAL_TRAVEL_MS = 20_000;
export const FAST_TRAVEL_MS = 5_000;

export function createInitialSimulation(routeId = DEFAULT_ROUTE_ID, fastMode = false): TrainSimulationState {
  const stations = getRouteStations(routeId);
  return {
    mode: "stopped",
    currentStationId: stations[0]?.id ?? "ruifang",
    nextStationId: stations[1]?.id,
    segmentIndex: 0,
    progressOnSegment: 0,
    stationNarrationIndex: 0,
    pendingQuestion: emptyPendingQuestion(),
    fastMode
  };
}

export function startSimulation(state: TrainSimulationState): TrainSimulationState {
  return {
    ...state,
    mode: state.nextStationId ? "running_between_stations" : "narrating_station",
    progressOnSegment: 0
  };
}

export function toggleFastMode(state: TrainSimulationState): TrainSimulationState {
  return { ...state, fastMode: !state.fastMode };
}

export function advanceTrain(state: TrainSimulationState, deltaMs: number, routeId = DEFAULT_ROUTE_ID): TrainSimulationState {
  if (state.mode !== "running_between_stations") return state;
  const travelMs = state.fastMode ? FAST_TRAVEL_MS : NORMAL_TRAVEL_MS;
  const progressOnSegment = Math.min(1, state.progressOnSegment + deltaMs / travelMs);
  if (progressOnSegment < 1) {
    return { ...state, progressOnSegment };
  }

  return {
    ...state,
    mode: "narrating_station",
    currentStationId: state.nextStationId ?? state.currentStationId,
    nextStationId: getNextStationId(routeId, state.nextStationId ?? state.currentStationId),
    progressOnSegment: 0,
    stationNarrationIndex: 0,
    pendingQuestion: emptyPendingQuestion()
  };
}

export function completeCurrentNarrationSegment(state: TrainSimulationState, routeId = DEFAULT_ROUTE_ID): TrainSimulationState {
  const script = getStationGuideScript(state.currentStationId);
  const segmentCount = script?.zh.segments.length ?? 0;

  if (state.pendingQuestion.status === "clear_question" || state.pendingQuestion.status === "unclear_question") {
    return { ...state, mode: "answering_pending_question" };
  }

  if (state.stationNarrationIndex + 1 < segmentCount) {
    return { ...state, stationNarrationIndex: state.stationNarrationIndex + 1 };
  }

  return moveToNextSegmentOrComplete(state, routeId);
}

export function completePendingQuestionAnswer(state: TrainSimulationState, routeId = DEFAULT_ROUTE_ID): TrainSimulationState {
  const cleared = { ...state, pendingQuestion: emptyPendingQuestion(), mode: "narrating_station" as const };
  return completeCurrentNarrationSegment(cleared, routeId);
}

export function skipCurrentStation(state: TrainSimulationState, routeId = DEFAULT_ROUTE_ID): TrainSimulationState {
  return moveToNextSegmentOrComplete({ ...state, pendingQuestion: emptyPendingQuestion() }, routeId);
}

export function classifyPendingQuestion(text: string, segmentIndex: number): PendingQuestion {
  const normalized = text.trim();
  if (!normalized) return emptyPendingQuestion();
  const clearPatterns = [
    "不好意思",
    "想問",
    "請問",
    "這個部分",
    "這邊",
    "剛剛說",
    "為什麼",
    "什麼意思",
    "怎麼",
    "I have a question",
    "can I ask",
    "what does",
    "why"
  ];
  const unclearPatterns = ["等一下", "欸", "那個", "sorry", "excuse me", "question"];
  if (clearPatterns.some((pattern) => normalized.toLowerCase().includes(pattern.toLowerCase()))) {
    return { status: "clear_question", text: normalized, capturedAtSegment: segmentIndex };
  }
  if (unclearPatterns.some((pattern) => normalized.toLowerCase().includes(pattern.toLowerCase()))) {
    return { status: "unclear_question", text: normalized, capturedAtSegment: segmentIndex };
  }
  return emptyPendingQuestion();
}

export function emptyPendingQuestion(): PendingQuestion {
  return { status: "none", text: "" };
}

function moveToNextSegmentOrComplete(state: TrainSimulationState, routeId: string): TrainSimulationState {
  const nextStationId = getNextStationId(routeId, state.currentStationId);
  if (!nextStationId) {
    return { ...state, mode: "completed", nextStationId: undefined, progressOnSegment: 1, pendingQuestion: emptyPendingQuestion() };
  }
  return {
    ...state,
    mode: "running_between_stations",
    nextStationId,
    segmentIndex: state.segmentIndex + 1,
    progressOnSegment: 0,
    stationNarrationIndex: 0,
    pendingQuestion: emptyPendingQuestion()
  };
}

function getNextStationId(routeId: string, stationId: string): string | undefined {
  const routeStations = getRouteStations(routeId);
  const index = routeStations.findIndex((station) => station.id === stationId);
  return index >= 0 ? routeStations[index + 1]?.id : undefined;
}
