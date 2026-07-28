import { useCallback, useEffect, useRef, useState } from "react";
import { getRouteStations, getStationGuideScript, getStationPois, getStationStory } from "../shared/seedData";
import {
  classifyPendingQuestion,
  createInitialTourState,
  getCurrentGuideSegment,
  reduceTourEvent,
  type TourCommand,
  type TourEvent,
  type TourState
} from "../shared/tourOrchestrator";
import { createSpeechController, type SpeechController, type SpeechStatus } from "./speech";
import { RealtimeWebRtcClient } from "./realtimeClient";
import type { GuideRuntime, RuntimeConnectionState, RuntimeMode } from "./runtimeTypes";

const initialSpeech: SpeechStatus = {
  synthesisSupported: false,
  recognitionSupported: false,
  speaking: false,
  listening: false
};

export function useTourRuntime(): GuideRuntime {
  const [state, setState] = useState(() => createInitialTourState("tra-pingxi", "zh-TW", false));
  const [displayText, setDisplayText] = useState("準備好後，從瑞芳出發。沿途故事會在正確的時間出現。");
  const [transcript, setTranscript] = useState("");
  const [muted, setMuted] = useState(false);
  const [speech, setSpeech] = useState<SpeechStatus>(initialSpeech);
  const [mode, setModeState] = useState<RuntimeMode>("simulated");
  const [realtimeAvailable, setRealtimeAvailable] = useState(false);
  const [connection, setConnection] = useState<RuntimeConnectionState>("unavailable");
  const [error, setError] = useState<string>();
  const stateRef = useRef(state);
  const mutedRef = useRef(muted);
  const speechRef = useRef<SpeechController | undefined>(undefined);
  const realtimeRef = useRef<RealtimeWebRtcClient | undefined>(undefined);
  const modeRef = useRef<RuntimeMode>("simulated");
  const travelTimerRef = useRef<number | undefined>(undefined);
  const responseTimerRef = useRef<number | undefined>(undefined);
  const askRef = useRef<(question: string) => void>(() => undefined);

  useEffect(() => {
    speechRef.current = createSpeechController(setSpeech);
    setSpeech({ ...speechRef.current.status });
    realtimeRef.current = new RealtimeWebRtcClient({
      onConnection: (connected) => setConnection(connected ? "connected" : modeRef.current === "realtime" ? "disconnected" : "unavailable"),
      onTranscript: (text) => askRef.current(text),
      onTextDelta: (delta) => setDisplayText((current) => current + delta),
      onResponseDone: (responseId) => {
        const active = stateRef.current;
        if (active.activeResponseKind === "guide") dispatchRef.current({ type: "GUIDE_RESPONSE_DONE", responseId });
        else dispatchRef.current({ type: "QUESTION_RESPONSE_DONE", responseId });
      },
      onSpeaking: (speaking) => setSpeech((current) => ({ ...current, speaking })),
      onError: (message) => { setError(message); setConnection("error"); }
    });
    void fetch("/api/health", { headers: { Accept: "application/json" } })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((body: { realtimeConfigured?: boolean }) => {
        setRealtimeAvailable(Boolean(body.realtimeConfigured));
        setConnection(body.realtimeConfigured ? "disconnected" : "unavailable");
      })
      .catch(() => { setRealtimeAvailable(false); setConnection("unavailable"); });
    return () => {
      speechRef.current?.stop();
      realtimeRef.current?.disconnect();
      if (travelTimerRef.current) window.clearInterval(travelTimerRef.current);
      if (responseTimerRef.current) window.clearTimeout(responseTimerRef.current);
    };
  }, []);

  const clearTimers = useCallback(() => {
    if (travelTimerRef.current) window.clearInterval(travelTimerRef.current);
    travelTimerRef.current = undefined;
    if (responseTimerRef.current) window.clearTimeout(responseTimerRef.current);
    responseTimerRef.current = undefined;
  }, []);

  const dispatchRef = useRef<(event: TourEvent) => void>(() => undefined);

  const finishAfterSpeech = useCallback((text: string, done: () => void) => {
    setDisplayText(text);
    if (!mutedRef.current && speechRef.current?.status.synthesisSupported) {
      speechRef.current.speak(text, done);
      return;
    }
    speechRef.current?.stop();
    responseTimerRef.current = window.setTimeout(done, 3600);
  }, []);

  const runCommands = useCallback((commands: TourCommand[], nextState: TourState) => {
    for (const command of commands) {
      switch (command.type) {
        case "CLEAR_TIMERS":
          clearTimers();
          break;
        case "CANCEL_RESPONSE":
          if (modeRef.current === "realtime") realtimeRef.current?.cancel();
          else speechRef.current?.stop();
          if (responseTimerRef.current) window.clearTimeout(responseTimerRef.current);
          break;
        case "START_TRAVEL_TIMER":
          if (travelTimerRef.current) window.clearInterval(travelTimerRef.current);
          travelTimerRef.current = window.setInterval(() => dispatchRef.current({ type: "TRAVEL_TICK", deltaMs: 250 }), 250);
          break;
        case "SEND_GUIDE_SEGMENT":
          setDisplayText("");
          if (modeRef.current === "realtime") {
            void realtimeRef.current?.sendGuide(nextState, command.segmentText, command.responseId).catch((cause) => {
              setError(cause instanceof Error ? cause.message : "Realtime 導覽失敗。");
              setConnection("error");
            });
          } else {
            finishAfterSpeech(command.segmentText, () => dispatchRef.current({ type: "GUIDE_RESPONSE_DONE", responseId: command.responseId }));
          }
          break;
        case "ANSWER_PENDING_QUESTION": {
          if (modeRef.current === "realtime") {
            setDisplayText("");
            void realtimeRef.current?.sendQuestion(nextState, command.question, command.responseId).catch((cause) => {
              setError(cause instanceof Error ? cause.message : "Realtime 問答失敗。");
              setConnection("error");
            });
          } else {
            const story = getStationStory(command.context.currentStationId);
            const poi = getStationPois(command.context.currentStationId)[0];
            const answer = `好問題。${story?.summary ?? "這一站把鐵路、山谷與地方生活連在一起。"}${poi ? ` 如果想下車，${poi.pitchLine}` : ""}`;
            finishAfterSpeech(answer, () => dispatchRef.current({ type: "QUESTION_RESPONSE_DONE", responseId: command.responseId }));
          }
          break;
        }
        case "ASK_QUESTION_CLARIFICATION":
          if (modeRef.current === "realtime") {
            void realtimeRef.current?.sendQuestion(nextState, command.question, command.responseId);
          } else {
            finishAfterSpeech("我有聽到你想提問，可以再說完整一點嗎？", () =>
              dispatchRef.current({ type: "QUESTION_RESPONSE_DONE", responseId: command.responseId })
            );
          }
          break;
        case "MUTE_OUTPUT":
          speechRef.current?.stop();
          break;
        case "RESUME_OUTPUT":
        case "SYNC_CONTEXT":
          break;
      }
    }
    if (nextState.phase === "traveling") {
      const stations = getRouteStations(nextState.routeId);
      const next = stations.find((station) => station.id === nextState.nextStationId);
      setDisplayText(next ? `列車行進中，下一站 ${next.name}。` : "旅程即將完成。");
    }
    if (nextState.phase === "completed") setDisplayText("抵達菁桐，平溪線的故事在這裡暫告一段落。");
  }, [clearTimers, finishAfterSpeech]);

  const dispatch = useCallback((event: TourEvent) => {
    const transition = reduceTourEvent(stateRef.current, event);
    stateRef.current = transition.state;
    setState(transition.state);
    runCommands(transition.commands, transition.state);
  }, [runCommands]);
  dispatchRef.current = dispatch;

  const ask = useCallback((question: string) => {
    const value = question.trim();
    if (!value) return;
    setTranscript(value);
    const pending = classifyPendingQuestion(value, stateRef.current.guideSegmentIndex);
    dispatchRef.current({
      type: "QUESTION_CAPTURED",
      pendingQuestion: pending.status === "none" ? { status: "clear_question", text: value, capturedAtSegment: stateRef.current.guideSegmentIndex } : pending
    });
    setDisplayText(`已收到：「${value}」\n這段說完就回答你。`);
  }, []);
  askRef.current = ask;

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (modeRef.current === "realtime") {
      realtimeRef.current?.setMuted(next);
      return;
    }
    if (next && speechRef.current?.status.speaking) {
      speechRef.current.stop();
      const active = stateRef.current;
      if (active.activeResponseKind === "guide") {
        dispatchRef.current({ type: "GUIDE_RESPONSE_DONE", responseId: active.activeResponseId });
      } else if (active.activeResponseKind === "question" || active.activeResponseKind === "clarification") {
        dispatchRef.current({ type: "QUESTION_RESPONSE_DONE", responseId: active.activeResponseId });
      }
    }
  }, []);

  const startListening = useCallback(() => {
    if (modeRef.current === "realtime") {
      realtimeRef.current?.setMicrophoneEnabled(true);
      setSpeech((current) => ({ ...current, listening: true }));
      return;
    }
    if (!speechRef.current?.status.recognitionSupported) return;
    setTranscript("");
    speechRef.current.startListening(ask, () => undefined);
  }, [ask]);

  const stopListening = useCallback(() => {
    if (modeRef.current === "realtime") {
      realtimeRef.current?.setMicrophoneEnabled(false);
      setSpeech((current) => ({ ...current, listening: false }));
    } else {
      speechRef.current?.stopListening();
    }
  }, []);

  const connect = useCallback(async () => {
    if (!realtimeAvailable) throw new Error("本機 Realtime server 尚未設定。");
    setConnection("connecting");
    setError(undefined);
    try {
      await realtimeRef.current?.connect();
      realtimeRef.current?.setMicrophoneEnabled(false);
      setConnection("connected");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Realtime 連線失敗。";
      setError(message);
      setConnection("error");
      throw cause;
    }
  }, [realtimeAvailable]);

  const disconnect = useCallback(() => {
    realtimeRef.current?.disconnect();
    setConnection(realtimeAvailable ? "disconnected" : "unavailable");
  }, [realtimeAvailable]);

  const setMode = useCallback(async (nextMode: RuntimeMode) => {
    if (nextMode === modeRef.current) return;
    clearTimers();
    speechRef.current?.stop();
    realtimeRef.current?.disconnect();
    modeRef.current = nextMode;
    setModeState(nextMode);
    setError(undefined);
    if (nextMode === "realtime") await connect();
    else setConnection(realtimeAvailable ? "disconnected" : "unavailable");
  }, [clearTimers, connect, realtimeAvailable]);

  return {
    state,
    displayText,
    transcript,
    muted,
    speech,
    mode,
    realtimeAvailable,
    connection,
    error,
    connect,
    disconnect,
    setMode,
    dispatch,
    ask,
    toggleMute,
    startListening,
    stopListening
  };
}

export function getStationPresentation(state: TourState) {
  const stations = getRouteStations(state.routeId);
  const currentIndex = stations.findIndex((station) => station.id === state.currentStationId);
  const current = stations[currentIndex];
  const next = stations.find((station) => station.id === state.nextStationId);
  const story = getStationStory(state.currentStationId);
  const poi = getStationPois(state.currentStationId)[0];
  const script = getStationGuideScript(state.currentStationId);
  return {
    stations,
    currentIndex,
    current,
    next,
    story,
    poi,
    segmentCount: script?.zh.segments.length ?? 5,
    currentSegment: getCurrentGuideSegment(state)
  };
}
