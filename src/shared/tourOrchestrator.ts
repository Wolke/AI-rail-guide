import { getRouteStations, getStationGuideScript } from "./seedData";
import type { GuideLanguage, PendingQuestion, PendingQuestionStatus } from "./types";

export type TourPhase = "idle" | "traveling" | "narrating" | "answering_question" | "paused" | "completed";
export type TourResponseKind = "guide" | "question" | "clarification";

export interface TourState {
  routeId: string;
  language: GuideLanguage;
  phase: TourPhase;
  currentStationId: string;
  nextStationId?: string;
  travelProgress: number;
  guideSegmentIndex: number;
  activeResponseId?: string;
  activeResponseKind?: TourResponseKind;
  activeResponseStartedAt?: number;
  pendingQuestion: PendingQuestion;
  pausedFrom?: Exclude<TourPhase, "paused">;
  fastMode: boolean;
}

export interface TourContext {
  routeId: string;
  language: GuideLanguage;
  phase: TourPhase;
  currentStationId: string;
  currentStationName: string;
  nextStationId?: string;
  nextStationName?: string;
  guideSegmentIndex: number;
  pendingQuestionStatus: PendingQuestionStatus;
}

export type TourEvent =
  | { type: "START" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "PREVIOUS_STATION" }
  | { type: "SKIP_TO_NEXT_STATION" }
  | { type: "TRAVEL_TICK"; deltaMs: number }
  | { type: "GUIDE_RESPONSE_DONE"; responseId?: string }
  | { type: "QUESTION_RESPONSE_DONE"; responseId?: string }
  | { type: "QUESTION_CAPTURED"; pendingQuestion: PendingQuestion }
  | { type: "LANGUAGE_CHANGED"; language: GuideLanguage }
  | { type: "TOGGLE_FAST_MODE" };

export type TourCommand =
  | { type: "SYNC_CONTEXT"; context: TourContext }
  | { type: "CANCEL_RESPONSE" }
  | { type: "MUTE_OUTPUT" }
  | { type: "RESUME_OUTPUT" }
  | { type: "SEND_GUIDE_SEGMENT"; context: TourContext; segmentText: string; segmentLabel: string; responseId: string }
  | { type: "ANSWER_PENDING_QUESTION"; context: TourContext; question: string; responseId: string }
  | { type: "ASK_QUESTION_CLARIFICATION"; context: TourContext; question: string; responseId: string }
  | { type: "START_TRAVEL_TIMER" }
  | { type: "CLEAR_TIMERS" };

export interface TourTransition {
  state: TourState;
  commands: TourCommand[];
}

export const NORMAL_TRAVEL_MS = 180_000;
export const FAST_TRAVEL_MS = 8_000;

export function emptyPendingQuestion(): PendingQuestion {
  return { status: "none", text: "" };
}

export function createInitialTourState(routeId: string, language: GuideLanguage = "zh-TW", fastMode = false): TourState {
  const routeStations = getRouteStations(routeId);
  const firstStation = routeStations[0];
  const secondStation = routeStations[1];
  return {
    routeId,
    language,
    phase: "idle",
    currentStationId: firstStation?.id ?? "",
    nextStationId: secondStation?.id,
    travelProgress: 0,
    guideSegmentIndex: 0,
    pendingQuestion: emptyPendingQuestion(),
    fastMode
  };
}

export function reduceTourEvent(state: TourState, event: TourEvent, now = Date.now()): TourTransition {
  switch (event.type) {
    case "START": {
      if (state.phase !== "idle" && state.phase !== "completed") {
        return withCommands(state, syncAndMaybeTravel(state));
      }
      const fresh = state.phase === "completed" ? createInitialTourState(state.routeId, state.language, state.fastMode) : state;
      const next: TourState = {
        ...fresh,
        phase: fresh.nextStationId ? "traveling" : "narrating",
        travelProgress: 0,
        guideSegmentIndex: 0,
        activeResponseId: undefined,
        activeResponseKind: undefined,
        pendingQuestion: emptyPendingQuestion()
      };
      return withCommands(next, [{ type: "RESUME_OUTPUT" }, { type: "SYNC_CONTEXT", context: buildTourContext(next) }, ...syncAndMaybeTravel(next)]);
    }

    case "PAUSE": {
      if (state.phase === "paused" || state.phase === "idle" || state.phase === "completed") return withCommands(state, []);
      const next: TourState = {
        ...state,
        phase: "paused",
        pausedFrom: state.phase,
        activeResponseId: undefined,
        activeResponseKind: undefined
      };
      return withCommands(next, [
        { type: "CANCEL_RESPONSE" },
        { type: "CLEAR_TIMERS" },
        { type: "MUTE_OUTPUT" },
        { type: "SYNC_CONTEXT", context: buildTourContext(next) }
      ]);
    }

    case "RESUME": {
      if (state.phase !== "paused") return withCommands(state, []);
      const resumedPhase = state.pausedFrom ?? "traveling";
      const next: TourState = { ...state, phase: resumedPhase, pausedFrom: undefined };
      const commands: TourCommand[] = [{ type: "RESUME_OUTPUT" }, { type: "SYNC_CONTEXT", context: buildTourContext(next) }];
      if (resumedPhase === "traveling") {
        commands.push({ type: "START_TRAVEL_TIMER" });
      } else if (resumedPhase === "narrating") {
        return startGuideSegment(next, now, commands);
      } else if (resumedPhase === "answering_question") {
        return startPendingQuestion(next, now, commands);
      }
      return withCommands(next, commands);
    }

    case "SKIP_TO_NEXT_STATION":
      return skipToNextStation(state);

    case "PREVIOUS_STATION":
      return moveToPreviousStation(state);

    case "TRAVEL_TICK": {
      if (state.phase !== "traveling") return withCommands(state, []);
      const duration = getTravelDurationMs(state);
      const progress = Math.min(1, state.travelProgress + event.deltaMs / duration);
      if (progress < 1) return withCommands({ ...state, travelProgress: progress }, []);
      const arrived = arriveAtNextStation(state);
      if (arrived.phase === "completed") {
        return withCommands(arrived, [{ type: "CLEAR_TIMERS" }, { type: "SYNC_CONTEXT", context: buildTourContext(arrived) }]);
      }
      return startGuideSegment(arrived, now, [{ type: "CLEAR_TIMERS" }, { type: "SYNC_CONTEXT", context: buildTourContext(arrived) }]);
    }

    case "GUIDE_RESPONSE_DONE": {
      if (state.phase !== "narrating" || !matchesActiveResponse(state, event.responseId, "guide")) return withCommands(state, []);
      if (state.pendingQuestion.status === "clear_question" || state.pendingQuestion.status === "unclear_question") {
        const next: TourState = {
          ...state,
          phase: "answering_question",
          activeResponseId: undefined,
          activeResponseKind: undefined
        };
        return startPendingQuestion(next, now);
      }
      const script = getStationGuideScript(state.currentStationId);
      const segmentCount = (state.language === "en-US" ? script?.en.segments.length : script?.zh.segments.length) ?? 0;
      if (state.guideSegmentIndex + 1 < segmentCount) {
        const next = { ...state, guideSegmentIndex: state.guideSegmentIndex + 1, activeResponseId: undefined, activeResponseKind: undefined };
        return startGuideSegment(next, now);
      }
      const next = finishStationNarration(state);
      return withCommands(next, [{ type: "SYNC_CONTEXT", context: buildTourContext(next) }, ...(next.phase === "traveling" ? [{ type: "START_TRAVEL_TIMER" } as TourCommand] : [])]);
    }

    case "QUESTION_RESPONSE_DONE": {
      if (state.phase !== "answering_question" || !matchesQuestionResponse(state, event.responseId)) return withCommands(state, []);
      const next = {
        ...state,
        phase: "narrating" as const,
        activeResponseId: undefined,
        activeResponseKind: undefined,
        pendingQuestion: emptyPendingQuestion()
      };
      const script = getStationGuideScript(next.currentStationId);
      const segmentCount = (next.language === "en-US" ? script?.en.segments.length : script?.zh.segments.length) ?? 0;
      if (next.guideSegmentIndex + 1 < segmentCount) {
        return startGuideSegment({ ...next, guideSegmentIndex: next.guideSegmentIndex + 1 }, now);
      }
      const afterStation = finishStationNarration(next);
      return withCommands(afterStation, [
        { type: "SYNC_CONTEXT", context: buildTourContext(afterStation) },
        ...(afterStation.phase === "traveling" ? [{ type: "START_TRAVEL_TIMER" } as TourCommand] : [])
      ]);
    }

    case "QUESTION_CAPTURED": {
      if (event.pendingQuestion.status === "none") return withCommands(state, []);
      if (state.pendingQuestion.status === "clear_question") return withCommands(state, []);
      return withCommands({ ...state, pendingQuestion: event.pendingQuestion }, []);
    }

    case "LANGUAGE_CHANGED": {
      const next = { ...state, language: event.language };
      return withCommands(next, [{ type: "SYNC_CONTEXT", context: buildTourContext(next) }]);
    }

    case "TOGGLE_FAST_MODE": {
      const next = { ...state, fastMode: !state.fastMode };
      return withCommands(next, next.phase === "traveling" ? [{ type: "CLEAR_TIMERS" }, { type: "START_TRAVEL_TIMER" }] : []);
    }

    default:
      return withCommands(state, []);
  }
}

export function buildTourContext(state: TourState): TourContext {
  const routeStations = getRouteStations(state.routeId);
  const currentStation = routeStations.find((station) => station.id === state.currentStationId);
  const nextStation = routeStations.find((station) => station.id === state.nextStationId);
  return {
    routeId: state.routeId,
    language: state.language,
    phase: state.phase,
    currentStationId: state.currentStationId,
    currentStationName: currentStation?.name ?? state.currentStationId,
    nextStationId: state.nextStationId,
    nextStationName: nextStation?.name,
    guideSegmentIndex: state.guideSegmentIndex,
    pendingQuestionStatus: state.pendingQuestion.status
  };
}

export function getCurrentGuideSegment(state: TourState): string {
  const script = getStationGuideScript(state.currentStationId);
  const localized = state.language === "en-US" ? script?.en : script?.zh;
  return localized?.segments[state.guideSegmentIndex] ?? "";
}

export function getCurrentSegmentLabel(state: TourState): string {
  const script = getStationGuideScript(state.currentStationId);
  const localized = state.language === "en-US" ? script?.en : script?.zh;
  const context = buildTourContext(state);
  return `${context.currentStationName} ${state.guideSegmentIndex + 1}/${localized?.segments.length ?? 1}`;
}

export function getSegmentDurationMs(state: TourState): number {
  const script = getStationGuideScript(state.currentStationId);
  const segmentCount = Math.max(1, (state.language === "en-US" ? script?.en.segments.length : script?.zh.segments.length) ?? 5);
  const stationDurationMs = (script?.durationSeconds ?? 180) * 1000;
  return state.fastMode ? 4_000 : Math.round(stationDurationMs / segmentCount);
}

export function getTravelDurationMs(state: TourState): number {
  return state.fastMode ? FAST_TRAVEL_MS : NORMAL_TRAVEL_MS;
}

export function classifyPendingQuestion(text: string, capturedAtSegment = 0): PendingQuestion {
  const normalized = text.trim();
  if (!normalized) return emptyPendingQuestion();
  const clearPatterns = [
    /不好意思.*(問|請問|想問)/,
    /請問/,
    /我想問/,
    /想問一下/,
    /這邊是什麼意思/,
    /剛剛說的/,
    /what does/i,
    /can i ask/i,
    /i have a question/i,
    /could you explain/i
  ];
  const unclearPatterns = [/不好意思$/, /請問一下$/, /想問$/, /question\??$/i, /sorry/i];
  if (clearPatterns.some((pattern) => pattern.test(normalized))) {
    return { status: "clear_question", text: normalized, capturedAtSegment };
  }
  if (unclearPatterns.some((pattern) => pattern.test(normalized))) {
    return { status: "unclear_question", text: normalized, capturedAtSegment };
  }
  return emptyPendingQuestion();
}

function startGuideSegment(state: TourState, now: number, prefixCommands: TourCommand[] = []): TourTransition {
  const responseId = makeResponseId("guide");
  const next: TourState = {
    ...state,
    phase: "narrating",
    activeResponseId: responseId,
    activeResponseKind: "guide",
    activeResponseStartedAt: now
  };
  return withCommands(next, [
    ...prefixCommands,
    {
      type: "SEND_GUIDE_SEGMENT",
      context: buildTourContext(next),
      segmentText: getCurrentGuideSegment(next),
      segmentLabel: getCurrentSegmentLabel(next),
      responseId
    }
  ]);
}

function startPendingQuestion(state: TourState, now: number, prefixCommands: TourCommand[] = []): TourTransition {
  if (state.pendingQuestion.status === "clear_question") {
    const responseId = makeResponseId("question");
    const next: TourState = { ...state, phase: "answering_question", activeResponseId: responseId, activeResponseKind: "question", activeResponseStartedAt: now };
    return withCommands(next, [
      ...prefixCommands,
      { type: "ANSWER_PENDING_QUESTION", context: buildTourContext(next), question: state.pendingQuestion.text, responseId }
    ]);
  }
  const responseId = makeResponseId("clarification");
  const next: TourState = { ...state, phase: "answering_question", activeResponseId: responseId, activeResponseKind: "clarification", activeResponseStartedAt: now };
  return withCommands(next, [
    ...prefixCommands,
    { type: "ASK_QUESTION_CLARIFICATION", context: buildTourContext(next), question: state.pendingQuestion.text, responseId }
  ]);
}

function skipToNextStation(state: TourState): TourTransition {
  const routeStations = getRouteStations(state.routeId);
  const currentIndex = routeStations.findIndex((station) => station.id === state.currentStationId);
  const upcomingStationId = state.nextStationId ?? routeStations[currentIndex + 1]?.id;
  if (!upcomingStationId) {
    const completed = { ...state, phase: "completed" as const, activeResponseId: undefined, activeResponseKind: undefined, pendingQuestion: emptyPendingQuestion() };
    return withCommands(completed, [{ type: "CANCEL_RESPONSE" }, { type: "CLEAR_TIMERS" }, { type: "SYNC_CONTEXT", context: buildTourContext(completed) }]);
  }
  const upcomingIndex = routeStations.findIndex((station) => station.id === upcomingStationId);
  const followingStationId = routeStations[upcomingIndex + 1]?.id;
  const next: TourState = {
    ...state,
    phase: followingStationId ? "traveling" : "completed",
    currentStationId: upcomingStationId,
    nextStationId: followingStationId,
    travelProgress: 0,
    guideSegmentIndex: 0,
    activeResponseId: undefined,
    activeResponseKind: undefined,
    activeResponseStartedAt: undefined,
    pendingQuestion: emptyPendingQuestion(),
    pausedFrom: undefined
  };
  return withCommands(next, [
    { type: "CANCEL_RESPONSE" },
    { type: "CLEAR_TIMERS" },
    { type: "RESUME_OUTPUT" },
    { type: "SYNC_CONTEXT", context: buildTourContext(next) },
    ...(next.phase === "traveling" ? [{ type: "START_TRAVEL_TIMER" } as TourCommand] : [])
  ]);
}

function moveToPreviousStation(state: TourState): TourTransition {
  const routeStations = getRouteStations(state.routeId);
  const currentIndex = routeStations.findIndex((station) => station.id === state.currentStationId);
  if (currentIndex <= 0) return withCommands(state, []);
  const previous = routeStations[currentIndex - 1];
  const next: TourState = {
    ...state,
    phase: "narrating",
    currentStationId: previous.id,
    nextStationId: routeStations[currentIndex]?.id,
    travelProgress: 0,
    guideSegmentIndex: 0,
    activeResponseId: undefined,
    activeResponseKind: undefined,
    activeResponseStartedAt: undefined,
    pendingQuestion: emptyPendingQuestion(),
    pausedFrom: undefined
  };
  return startGuideSegment(next, Date.now(), [
    { type: "CANCEL_RESPONSE" },
    { type: "CLEAR_TIMERS" },
    { type: "RESUME_OUTPUT" },
    { type: "SYNC_CONTEXT", context: buildTourContext(next) }
  ]);
}

function arriveAtNextStation(state: TourState): TourState {
  if (!state.nextStationId) return { ...state, phase: "completed", travelProgress: 1 };
  const routeStations = getRouteStations(state.routeId);
  const arrivedIndex = routeStations.findIndex((station) => station.id === state.nextStationId);
  return {
    ...state,
    phase: "narrating",
    currentStationId: state.nextStationId,
    nextStationId: routeStations[arrivedIndex + 1]?.id,
    travelProgress: 0,
    guideSegmentIndex: 0,
    activeResponseId: undefined,
    activeResponseKind: undefined,
    pendingQuestion: emptyPendingQuestion()
  };
}

function finishStationNarration(state: TourState): TourState {
  if (!state.nextStationId) {
    return {
      ...state,
      phase: "completed",
      travelProgress: 1,
      activeResponseId: undefined,
      activeResponseKind: undefined,
      activeResponseStartedAt: undefined,
      pendingQuestion: emptyPendingQuestion()
    };
  }
  return {
    ...state,
    phase: "traveling",
    travelProgress: 0,
    guideSegmentIndex: 0,
    activeResponseId: undefined,
    activeResponseKind: undefined,
    activeResponseStartedAt: undefined,
    pendingQuestion: emptyPendingQuestion()
  };
}

function matchesActiveResponse(state: TourState, responseId: string | undefined, kind: TourResponseKind): boolean {
  return Boolean(responseId && state.activeResponseId === responseId && state.activeResponseKind === kind);
}

function matchesQuestionResponse(state: TourState, responseId: string | undefined): boolean {
  return Boolean(responseId && state.activeResponseId === responseId && (state.activeResponseKind === "question" || state.activeResponseKind === "clarification"));
}

function syncAndMaybeTravel(state: TourState): TourCommand[] {
  return state.phase === "traveling" ? [{ type: "START_TRAVEL_TIMER" }] : [];
}

function withCommands(state: TourState, commands: TourCommand[]): TourTransition {
  return { state, commands };
}

function makeResponseId(prefix: TourResponseKind): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
