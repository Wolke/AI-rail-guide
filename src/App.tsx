import { useEffect, useMemo, useRef, useState } from "react";
import { sendFallbackChat, startJourney } from "./lib/api";
import { RealtimeRailClient } from "./lib/realtimeClient";
import { saveJourneyState } from "./lib/storage";
import { getRouteStations, getStationGuideScript } from "./shared/seedData";
import {
  buildTourContext,
  classifyPendingQuestion,
  createInitialTourState,
  getSegmentDurationMs,
  reduceTourEvent
} from "./shared/tourOrchestrator";
import type { TourCommand, TourEvent, TourPhase, TourState } from "./shared/tourOrchestrator";
import type { GuideLanguage, JourneyState, PendingQuestion, Station } from "./shared/types";

type VoiceStatus = "idle" | "connecting" | "connected" | "fallback" | "error";

const routeId = "tra-pingxi";

const copy = {
  "zh-TW": {
    title: "平溪線導遊式列車模擬",
    start: "開始模擬",
    pause: "暫停",
    resume: "繼續",
    skip: "跳到下一站",
    fast: "快速模式",
    normal: "正常模式",
    current: "目前站",
    next: "下一站",
    mode: "狀態",
    segment: "導覽段落",
    progress: "列車進度",
    input: "也可以打字插話；系統會等導覽段落結束後處理",
    send: "送出",
    language: "語言"
  },
  "en-US": {
    title: "Pingxi Line Guided Train Simulation",
    start: "Start demo",
    pause: "Pause",
    resume: "Resume",
    skip: "Jump to next station",
    fast: "Fast mode",
    normal: "Normal mode",
    current: "Current",
    next: "Next",
    mode: "Mode",
    segment: "Guide segment",
    progress: "Train progress",
    input: "Type a question; the guide will answer at the next segment boundary",
    send: "Send",
    language: "Language"
  }
};

export function App() {
  const [journey, setJourney] = useState<JourneyState | null>(null);
  const [tourState, setTourState] = useState<TourState>(() => createInitialTourState(routeId));
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [feed, setFeed] = useState<string[]>([
    "這版 Demo 會讓一台假列車沿平溪線行駛；AI 會把每站導覽講到段落邊界，再處理使用者問題。"
  ]);
  const [input, setInput] = useState("");
  const [languageState, setLanguageState] = useState("已套用");
  const realtime = useRef<RealtimeRailClient | null>(null);
  const tourStateRef = useRef(tourState);
  const voiceStatusRef = useRef(voiceStatus);
  const journeyRef = useRef(journey);
  const timers = useRef<{ travel?: number; fallback?: number; boundary?: number }>({});
  const routeStations = useMemo(() => getRouteStations(routeId), []);

  const language = tourState.language;
  const c = copy[language];
  const currentStation = findStation(routeStations, tourState.currentStationId);
  const nextStation = findStation(routeStations, tourState.nextStationId);
  const guideScript = getStationGuideScript(tourState.currentStationId);
  const localizedScript = guideScript ? (language === "en-US" ? guideScript.en : guideScript.zh) : undefined;
  const segmentCount = localizedScript?.segments.length ?? 0;
  const trainLeft = computeTrainLeft(routeStations, tourState);
  const realtimeBlockedReason = getRealtimeBlockedReason();

  useEffect(() => {
    tourStateRef.current = tourState;
  }, [tourState]);

  useEffect(() => {
    voiceStatusRef.current = voiceStatus;
  }, [voiceStatus]);

  useEffect(() => {
    journeyRef.current = journey;
  }, [journey]);

  useEffect(() => {
    return () => {
      clearAllTimers();
      realtime.current?.disconnect();
    };
  }, []);

  const appendFeed = (message: string) => {
    setFeed((items) => [message, ...items].slice(0, 14));
  };

  const dispatchTourEvent = (event: TourEvent) => {
    const transition = reduceTourEvent(tourStateRef.current, event);
    tourStateRef.current = transition.state;
    setTourState(transition.state);
    executeCommands(transition.commands, transition.state);
  };

  const beginSimulation = async () => {
    const response = journeyRef.current ? null : await startJourney(routeId);
    const activeJourney = journeyRef.current ?? response?.initialState ?? null;
    if (response) {
      setJourney(response.initialState);
      await saveJourneyState(response.initialState);
    }
    if (!activeJourney) return;

    appendFeed(language === "en-US" ? "The train simulation has started." : "列車模擬已開始。");
    if (!realtime.current) {
      realtime.current = createRealtimeClient();
      await realtime.current.connect(activeJourney.journeyId, routeId, language);
      realtime.current.updateGuideTurnMode();
      realtime.current.syncContext(buildTourContext(tourStateRef.current));
    }
    dispatchTourEvent({ type: "START" });
  };

  const pauseOrResume = () => {
    dispatchTourEvent({ type: tourStateRef.current.phase === "paused" ? "RESUME" : "PAUSE" });
  };

  const skipStation = () => {
    dispatchTourEvent({ type: "SKIP_TO_NEXT_STATION" });
    appendFeed(language === "en-US" ? "Jumped to the next station. The train keeps moving forward." : "已跳到下一站，列車會繼續往後行駛。");
  };

  const changeLanguage = async (value: GuideLanguage) => {
    setLanguageState(value === "en-US" ? "Applying" : "套用中");
    dispatchTourEvent({ type: "LANGUAGE_CHANGED", language: value });
    if (journeyRef.current && realtime.current) {
      realtime.current.disconnect();
      realtime.current = createRealtimeClient();
      await realtime.current.connect(journeyRef.current.journeyId, routeId, value);
      realtime.current.updateGuideTurnMode();
      realtime.current.syncContext(buildTourContext({ ...tourStateRef.current, language: value }));
    }
    setLanguageState(value === "en-US" ? "Applied" : "已套用");
  };

  const sendTypedQuestion = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    const pending = classifyPendingQuestion(text, tourStateRef.current.guideSegmentIndex);
    const nextPending: PendingQuestion =
      pending.status === "none" ? { status: "clear_question", text, capturedAtSegment: tourStateRef.current.guideSegmentIndex } : pending;
    dispatchTourEvent({ type: "QUESTION_CAPTURED", pendingQuestion: nextPending });
    appendFeed(language === "en-US" ? `Question received; answering after this segment: ${text}` : `問題已收到，段落後回答：${text}`);
  };

  const capturePendingQuestion = (text: string) => {
    const pending = classifyPendingQuestion(text, tourStateRef.current.guideSegmentIndex);
    if (pending.status === "none") return;
    dispatchTourEvent({ type: "QUESTION_CAPTURED", pendingQuestion: pending });
    appendFeed(
      pending.status === "clear_question"
        ? tourStateRef.current.language === "en-US"
          ? "A question was captured. The guide will answer after this segment."
          : "偵測到明確問題，導遊會在段落結束後回答。"
        : tourStateRef.current.language === "en-US"
          ? "A possible question was captured. The guide will clarify after this segment."
          : "偵測到可能的提問，導遊會在段落結束後確認。"
    );
  };

  const handleRealtimeResponseDone = (responseId?: string) => {
    const state = tourStateRef.current;
    if (!responseId || state.activeResponseId !== responseId) return;
    if (state.activeResponseKind === "guide") {
      const remainingMs = Math.max(0, getSegmentDurationMs(state) - (Date.now() - (state.activeResponseStartedAt ?? 0)));
      clearTimer("boundary");
      timers.current.boundary = window.setTimeout(() => dispatchTourEvent({ type: "GUIDE_RESPONSE_DONE", responseId }), remainingMs);
      return;
    }
    dispatchTourEvent({ type: "QUESTION_RESPONSE_DONE", responseId });
  };

  const executeCommands = (commands: TourCommand[], state: TourState) => {
    for (const command of commands) {
      switch (command.type) {
        case "CLEAR_TIMERS":
          clearAllTimers();
          break;
        case "START_TRAVEL_TIMER":
          startTravelTimer();
          break;
        case "SYNC_CONTEXT":
          realtime.current?.syncContext(command.context);
          break;
        case "CANCEL_RESPONSE":
          realtime.current?.cancelResponse();
          break;
        case "MUTE_OUTPUT":
          realtime.current?.muteOutput();
          break;
        case "RESUME_OUTPUT":
          realtime.current?.resumeOutput();
          break;
        case "SEND_GUIDE_SEGMENT":
          appendFeed(
            command.context.language === "en-US"
              ? `Guide: ${command.segmentLabel}`
              : `導覽：${command.segmentLabel.replace(" ", " 第 ")} 段`
          );
          if (voiceStatusRef.current === "connected") {
            realtime.current?.sendGuideSegment(command.context, command.segmentText, command.segmentLabel, command.responseId);
          } else {
            appendFeed(`AI：${command.segmentText}`);
            scheduleFallbackDone(command.responseId, getSegmentDurationMs(state), "GUIDE_RESPONSE_DONE");
          }
          break;
        case "ANSWER_PENDING_QUESTION":
          if (voiceStatusRef.current === "connected") {
            realtime.current?.answerQuestion(command.context, command.question, command.responseId);
          } else {
            void sendFallbackChat({
              journeyId: journeyRef.current?.journeyId,
              message: command.question,
              language: command.context.language,
              currentStationId: command.context.currentStationId,
              nextStationId: command.context.nextStationId
            }).then((response) => {
              appendFeed(`AI：${response.text}`);
              dispatchTourEvent({ type: "QUESTION_RESPONSE_DONE", responseId: command.responseId });
            });
          }
          break;
        case "ASK_QUESTION_CLARIFICATION":
          if (voiceStatusRef.current === "connected") {
            realtime.current?.askQuestionClarification(command.context, command.question, command.responseId);
          } else {
            appendFeed(command.context.language === "en-US" ? "AI: Which part would you like to ask about?" : "AI：你剛剛想問的是哪一個部分？");
            dispatchTourEvent({ type: "QUESTION_RESPONSE_DONE", responseId: command.responseId });
          }
          break;
      }
    }
  };

  const startTravelTimer = () => {
    clearTimer("travel");
    timers.current.travel = window.setInterval(() => {
      dispatchTourEvent({ type: "TRAVEL_TICK", deltaMs: 200 });
    }, 200);
  };

  const scheduleFallbackDone = (responseId: string, delayMs: number, eventType: "GUIDE_RESPONSE_DONE" | "QUESTION_RESPONSE_DONE") => {
    clearTimer("fallback");
    timers.current.fallback = window.setTimeout(() => {
      dispatchTourEvent({ type: eventType, responseId } as TourEvent);
    }, delayMs);
  };

  const clearTimer = (key: keyof typeof timers.current) => {
    const timer = timers.current[key];
    if (timer != null) {
      if (key === "travel") window.clearInterval(timer);
      else window.clearTimeout(timer);
      timers.current[key] = undefined;
    }
  };

  function clearAllTimers() {
    clearTimer("travel");
    clearTimer("fallback");
    clearTimer("boundary");
  }

  function createRealtimeClient() {
    return new RealtimeRailClient({
      onStatus: setVoiceStatus,
      onMessage: (message) => {
        if (message.trim()) appendFeed(message);
      },
      onTranscript: capturePendingQuestion,
      onResponseDone: handleRealtimeResponseDone,
      onError: appendFeed,
      onDebug: appendFeed
    });
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">AI Rail Guide PWA</p>
          <h1>{c.title}</h1>
        </div>
        <div className="topbar-controls">
          <label className="language-control">
            <span>{c.language}</span>
            <select value={language} onChange={(event) => void changeLanguage(event.target.value as GuideLanguage)}>
              <option value="zh-TW">繁體中文</option>
              <option value="en-US">English</option>
            </select>
          </label>
          <div className={`status status-${voiceStatus}`}>{voiceStatusLabel(voiceStatus, language)}</div>
        </div>
      </section>

      <section className="sim-board">
        <div className="route-map" aria-label="Pingxi Line train simulation">
          <div className="track" />
          <div className="train" style={{ left: `${trainLeft}%` }} aria-hidden="true">
            <span />
          </div>
          {routeStations.map((station, index) => (
            <div className="station-node" key={station.id} style={{ left: `${stationPercent(index, routeStations.length)}%` }}>
              <span className={station.id === tourState.currentStationId ? "node-dot active" : "node-dot"} />
              <small>{station.name}</small>
            </div>
          ))}
        </div>

        <div className="control-grid">
          <Metric label={c.current} value={currentStation?.name ?? "-"} />
          <Metric label={c.next} value={nextStation?.name ?? "-"} />
          <Metric label={c.mode} value={modeLabel(tourState.phase, language)} />
          <Metric label={c.segment} value={`${tourState.guideSegmentIndex + 1}/${Math.max(segmentCount, 1)}`} />
        </div>

        <div className="progress-row">
          <span>{c.progress}</span>
          <div className="progress-bar">
            <i style={{ width: `${Math.round(tourState.travelProgress * 100)}%` }} />
          </div>
          <strong>{Math.round(tourState.travelProgress * 100)}%</strong>
        </div>

        <div className="actions">
          {tourState.phase === "idle" || tourState.phase === "completed" ? (
            <button className="primary" onClick={() => void beginSimulation()}>
              {c.start}
            </button>
          ) : (
            <button className="secondary" onClick={pauseOrResume}>
              {tourState.phase === "paused" ? c.resume : c.pause}
            </button>
          )}
          <button className="ghost" onClick={skipStation} disabled={tourState.phase === "idle" || tourState.phase === "completed"}>
            {c.skip}
          </button>
          <button className="ghost" onClick={() => dispatchTourEvent({ type: "TOGGLE_FAST_MODE" })}>
            {tourState.fastMode ? c.normal : c.fast}
          </button>
          <span className="meta">{languageState}</span>
        </div>
        {realtimeBlockedReason ? <p className="warning">{realtimeBlockedReason}</p> : null}
      </section>

      <section className="dashboard">
        <div className="story-panel">
          <p className="eyebrow">Guide Context</p>
          <h2>{localizedScript?.theme ?? "等待導覽"}</h2>
          <p>{localizedScript?.summary ?? "開始模擬後，列車會沿線行駛並在每站分段導覽。"}</p>
          <p className="poi">{localizedScript?.stopPitch ?? ""}</p>
        </div>
        <div className="story-panel">
          <p className="eyebrow">Pending Question</p>
          <h2>{pendingLabel(tourState.pendingQuestion.status, language)}</h2>
          <p>{tourState.pendingQuestion.text || (language === "en-US" ? "No passenger question is waiting." : "目前沒有等待處理的旅客問題。")}</p>
        </div>
      </section>

      <section className="console">
        <div className="feed">
          {feed.map((item, index) => (
            <p key={`${item}-${index}`}>{item}</p>
          ))}
        </div>
        <div className="composer">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void sendTypedQuestion();
            }}
            placeholder={c.input}
          />
          <button onClick={() => void sendTypedQuestion()}>{c.send}</button>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function findStation(stations: Station[], id?: string): Station | undefined {
  return stations.find((station) => station.id === id);
}

function stationPercent(index: number, length: number): number {
  return length <= 1 ? 0 : (index / (length - 1)) * 100;
}

function computeTrainLeft(stations: Station[], state: TourState): number {
  const currentIndex = Math.max(0, stations.findIndex((station) => station.id === state.currentStationId));
  const nextIndex = state.nextStationId ? stations.findIndex((station) => station.id === state.nextStationId) : currentIndex;
  const start = stationPercent(currentIndex, stations.length);
  const end = stationPercent(nextIndex >= 0 ? nextIndex : currentIndex, stations.length);
  return state.phase === "traveling" ? start + (end - start) * state.travelProgress : start;
}

function getRealtimeBlockedReason(): string {
  if (typeof window === "undefined") return "";
  const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  if (window.isSecureContext || isLocalhost) return "";
  return "手機瀏覽器用 http://192.168... 開啟時不是 secure context，麥克風/WebRTC Realtime 可能會被瀏覽器擋下；目前會改用文字 fallback。要測語音需用 HTTPS 或 localhost/tunnel。";
}

function voiceStatusLabel(status: VoiceStatus, language: GuideLanguage): string {
  const zh: Record<VoiceStatus, string> = {
    idle: "語音待機",
    connecting: "連線中",
    connected: "Realtime 已連線",
    fallback: "文字 fallback",
    error: "語音錯誤"
  };
  const en: Record<VoiceStatus, string> = {
    idle: "Voice idle",
    connecting: "Connecting",
    connected: "Realtime connected",
    fallback: "Text fallback",
    error: "Voice error"
  };
  return language === "en-US" ? en[status] : zh[status];
}

function modeLabel(mode: TourPhase, language: GuideLanguage): string {
  const zh: Record<TourPhase, string> = {
    idle: "尚未開始",
    traveling: "列車行駛中",
    narrating: "到站導覽",
    answering_question: "回答暫存問題",
    paused: "已暫停",
    completed: "路線完成"
  };
  const en: Record<TourPhase, string> = {
    idle: "Idle",
    traveling: "Running",
    narrating: "Narrating",
    answering_question: "Answering",
    paused: "Paused",
    completed: "Completed"
  };
  return language === "en-US" ? en[mode] : zh[mode];
}

function pendingLabel(status: PendingQuestion["status"], language: GuideLanguage): string {
  const zh: Record<PendingQuestion["status"], string> = {
    none: "沒有暫存問題",
    capturing: "正在聽到一個問題",
    clear_question: "問題已收到，段落後回答",
    unclear_question: "問題不清楚，段落後會確認"
  };
  const en: Record<PendingQuestion["status"], string> = {
    none: "No pending question",
    capturing: "Capturing a question",
    clear_question: "Question captured",
    unclear_question: "Clarification needed"
  };
  return language === "en-US" ? en[status] : zh[status];
}
