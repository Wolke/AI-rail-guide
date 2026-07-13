import { useEffect, useMemo, useRef, useState } from "react";
import { sendFallbackChat, startJourney } from "./lib/api";
import { RealtimeRailClient } from "./lib/realtimeClient";
import { saveJourneyState } from "./lib/storage";
import { getRouteStations, getStationGuideScript } from "./shared/seedData";
import {
  advanceTrain,
  classifyPendingQuestion,
  completeCurrentNarrationSegment,
  completePendingQuestionAnswer,
  createInitialSimulation,
  skipCurrentStation,
  startSimulation,
  toggleFastMode
} from "./shared/simulation";
import type { GuideLanguage, JourneyState, PendingQuestion, Station, TrainSimulationState } from "./shared/types";

type VoiceStatus = "idle" | "connecting" | "connected" | "fallback" | "error";
type ActiveResponse = "none" | "segment" | "question" | "clarification";

const routeId = "tra-pingxi";

const copy = {
  "zh-TW": {
    title: "平溪線導遊式列車模擬",
    start: "開始模擬",
    pause: "暫停",
    resume: "繼續",
    skip: "跳過本站",
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
    skip: "Skip stop",
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
  const [simulation, setSimulation] = useState<TrainSimulationState>(() => createInitialSimulation(routeId));
  const [language, setLanguage] = useState<GuideLanguage>("zh-TW");
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [feed, setFeed] = useState<string[]>([
    "這版 Demo 會讓一台假列車沿平溪線行駛；AI 會把每站導覽講到段落邊界，再處理使用者問題。"
  ]);
  const [input, setInput] = useState("");
  const [languageState, setLanguageState] = useState("已套用");
  const realtime = useRef<RealtimeRailClient | null>(null);
  const routeStations = useMemo(() => getRouteStations(routeId), []);
  const activeResponse = useRef<ActiveResponse>("none");
  const activeResponseStartedAt = useRef(0);
  const lastGuideKey = useRef("");
  const fallbackTimer = useRef<number | null>(null);
  const responseBoundaryTimer = useRef<number | null>(null);
  const simulationRef = useRef(simulation);
  const languageRef = useRef(language);

  const c = copy[language];
  const currentStation = findStation(routeStations, simulation.currentStationId);
  const nextStation = findStation(routeStations, simulation.nextStationId);
  const guideScript = getStationGuideScript(simulation.currentStationId);
  const localizedScript = guideScript ? (language === "en-US" ? guideScript.en : guideScript.zh) : undefined;
  const currentSegment = localizedScript?.segments[simulation.stationNarrationIndex] ?? "";
  const segmentCount = localizedScript?.segments.length ?? 0;
  const trainLeft = computeTrainLeft(routeStations, simulation);
  const realtimeBlockedReason = getRealtimeBlockedReason();

  useEffect(() => {
    simulationRef.current = simulation;
    realtime.current?.setSimulation(simulation);
  }, [simulation]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  const appendFeed = (message: string) => {
    setFeed((items) => [message, ...items].slice(0, 14));
  };

  const setSimulationState = (updater: (state: TrainSimulationState) => TrainSimulationState) => {
    setSimulation((previous) => {
      const next = updater(previous);
      realtime.current?.setSimulation(next);
      return next;
    });
  };

  const beginSimulation = async () => {
    const response = journey ? null : await startJourney(routeId);
    const activeJourney = journey ?? response?.initialState ?? null;
    if (response) {
      setJourney(response.initialState);
      await saveJourneyState(response.initialState);
    }
    if (!activeJourney) return;

    const nextSimulation = startSimulation(simulation.mode === "completed" ? createInitialSimulation(routeId, simulation.fastMode) : simulation);
    setSimulation(nextSimulation);
    appendFeed(language === "en-US" ? "The train simulation has started." : "列車模擬已開始。");

    if (!realtime.current) {
      realtime.current = new RealtimeRailClient({
        onStatus: setVoiceStatus,
        onMessage: (message) => {
          if (message.trim()) appendFeed(message);
        },
        onTranscript: (text) => capturePendingQuestion(text),
        onResponseDone: () => handleResponseDone(),
        onError: appendFeed
      });
      await realtime.current.connect(activeJourney.journeyId, routeId, language, nextSimulation);
      realtime.current.updateGuideTurnMode();
    }
  };

  const pauseOrResume = () => {
    if (simulation.mode === "paused") {
      lastGuideKey.current = "";
      realtime.current?.resumeOutput();
      setSimulationState((state) => ({ ...state, mode: state.pausedFrom ?? "narrating_station", pausedFrom: undefined }));
      return;
    }
    realtime.current?.stopOutput();
    clearFallbackTimer();
    clearResponseBoundaryTimer();
    activeResponse.current = "none";
    setSimulationState((state) => ({ ...state, mode: "paused", pausedFrom: state.mode === "paused" ? state.pausedFrom : state.mode }));
  };

  const skipStation = () => {
    realtime.current?.cancelResponse();
    realtime.current?.resumeOutput();
    clearFallbackTimer();
    clearResponseBoundaryTimer();
    activeResponse.current = "none";
    lastGuideKey.current = "";
    setSimulationState((state) => skipCurrentStation(state, routeId));
    appendFeed(language === "en-US" ? "Skipped this stop. The train keeps moving to the next station." : "已跳過本站導覽，列車會繼續往下一站。");
  };

  const changeLanguage = async (value: GuideLanguage) => {
    setLanguage(value);
    setLanguageState(value === "en-US" ? "Applying" : "套用中");
    if (journey && realtime.current) {
      realtime.current.disconnect();
      realtime.current = new RealtimeRailClient({
        onStatus: setVoiceStatus,
        onMessage: (message) => {
          if (message.trim()) appendFeed(message);
        },
        onTranscript: (text) => capturePendingQuestion(text),
        onResponseDone: () => handleResponseDone(),
        onError: appendFeed
      });
      await realtime.current.connect(journey.journeyId, routeId, value, simulation);
      realtime.current.updateGuideTurnMode();
    }
    setLanguageState(value === "en-US" ? "Applied" : "已套用");
    lastGuideKey.current = "";
  };

  const sendTypedQuestion = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    const pending = classifyPendingQuestion(text, simulationRef.current.stationNarrationIndex);
    const nextPending: PendingQuestion =
      pending.status === "none" ? { status: "clear_question", text, capturedAtSegment: simulation.stationNarrationIndex } : pending;
    setSimulationState((state) => ({ ...state, pendingQuestion: nextPending }));
    appendFeed(language === "en-US" ? `Question received; answering after this segment: ${text}` : `問題已收到，段落後回答：${text}`);
  };

  const capturePendingQuestion = (text: string) => {
    const pending = classifyPendingQuestion(text, simulationRef.current.stationNarrationIndex);
    if (pending.status === "none") return;
    setSimulationState((state) => {
      if (state.pendingQuestion.status === "clear_question") return state;
      return { ...state, pendingQuestion: pending };
    });
    appendFeed(
      pending.status === "clear_question"
        ? languageRef.current === "en-US"
          ? "A question was captured. The guide will answer after this segment."
          : "偵測到明確問題，導遊會在段落結束後回答。"
        : languageRef.current === "en-US"
          ? "A possible question was captured. The guide will clarify after this segment."
          : "偵測到可能的提問，導遊會在段落結束後確認。"
    );
  };

  const handleResponseDone = () => {
    const kind = activeResponse.current;
    if (kind === "segment") {
      const remainingMs = getRemainingSegmentMs(activeResponseStartedAt.current, simulationRef.current, getStationGuideScript(simulationRef.current.currentStationId)?.durationSeconds ?? 180);
      if (remainingMs > 0) {
        clearResponseBoundaryTimer();
        responseBoundaryTimer.current = window.setTimeout(() => completeActiveResponse(), remainingMs);
        return;
      }
    }
    completeActiveResponse();
  };

  const completeActiveResponse = () => {
    const kind = activeResponse.current;
    activeResponse.current = "none";
    if (kind === "segment") {
      setSimulationState((state) => completeCurrentNarrationSegment(state, routeId));
    } else if (kind === "question" || kind === "clarification") {
      setSimulationState((state) => completePendingQuestionAnswer(state, routeId));
    }
  };

  useEffect(() => {
    if (simulation.mode !== "running_between_stations") return;
    const id = window.setInterval(() => {
      setSimulationState((state) => advanceTrain(state, 200, routeId));
    }, 200);
    return () => window.clearInterval(id);
  }, [simulation.mode]);

  useEffect(() => {
    if (simulation.mode !== "narrating_station" || !currentSegment || !currentStation) return;
    const key = `${simulation.currentStationId}:${simulation.stationNarrationIndex}:${language}`;
    if (lastGuideKey.current === key) return;
    lastGuideKey.current = key;
    activeResponse.current = "segment";
    activeResponseStartedAt.current = Date.now();
    appendFeed(
      language === "en-US"
        ? `Guide: ${currentStation.name} segment ${simulation.stationNarrationIndex + 1}/${segmentCount}`
        : `導覽：${currentStation.name} 第 ${simulation.stationNarrationIndex + 1}/${segmentCount} 段`
    );
    if (voiceStatus === "connected") {
      realtime.current?.sendGuideSegment(currentSegment, `${currentStation.name} ${simulation.stationNarrationIndex + 1}/${segmentCount}`);
    } else {
      appendFeed(`AI：${currentSegment}`);
      scheduleFallbackDone(getSegmentDurationMs(simulation, guideScript?.durationSeconds ?? 180));
    }
  }, [currentSegment, currentStation?.id, language, segmentCount, simulation.currentStationId, simulation.fastMode, simulation.mode, simulation.stationNarrationIndex, voiceStatus]);

  useEffect(() => {
    if (simulation.mode !== "answering_pending_question" || !currentStation) return;
    const pending = simulation.pendingQuestion;
    if (pending.status === "clear_question") {
      activeResponse.current = "question";
      activeResponseStartedAt.current = Date.now();
      if (voiceStatus === "connected") {
        realtime.current?.answerPendingQuestion(pending.text, currentStation.name);
      } else {
        void sendFallbackChat({
          journeyId: journey?.journeyId,
          message: pending.text,
          language,
          currentStationId: currentStation.id,
          nextStationId: nextStation?.id
        }).then((response) => {
          appendFeed(`AI：${response.text}`);
          handleResponseDone();
        });
      }
    } else if (pending.status === "unclear_question") {
      activeResponse.current = "clarification";
      activeResponseStartedAt.current = Date.now();
      if (voiceStatus === "connected") {
        realtime.current?.askQuestionClarification(pending.text);
      } else {
        appendFeed(language === "en-US" ? "AI: Which part would you like to ask about?" : "AI：你剛剛想問的是哪一個部分？");
        handleResponseDone();
      }
    }
  }, [currentStation?.id, journey?.journeyId, language, nextStation?.id, simulation.mode, simulation.pendingQuestion, voiceStatus]);

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
              <span className={station.id === simulation.currentStationId ? "node-dot active" : "node-dot"} />
              <small>{station.name}</small>
            </div>
          ))}
        </div>

        <div className="control-grid">
          <Metric label={c.current} value={currentStation?.name ?? "-"} />
          <Metric label={c.next} value={nextStation?.name ?? "-"} />
          <Metric label={c.mode} value={modeLabel(simulation.mode, language)} />
          <Metric label={c.segment} value={`${simulation.stationNarrationIndex + 1}/${Math.max(segmentCount, 1)}`} />
        </div>

        <div className="progress-row">
          <span>{c.progress}</span>
          <div className="progress-bar">
            <i style={{ width: `${Math.round(simulation.progressOnSegment * 100)}%` }} />
          </div>
          <strong>{Math.round(simulation.progressOnSegment * 100)}%</strong>
        </div>

        <div className="actions">
          {simulation.mode === "stopped" || simulation.mode === "completed" ? (
            <button className="primary" onClick={() => void beginSimulation()}>
              {c.start}
            </button>
          ) : (
            <button className="secondary" onClick={pauseOrResume}>
              {simulation.mode === "paused" ? c.resume : c.pause}
            </button>
          )}
          <button className="ghost" onClick={skipStation} disabled={simulation.mode === "stopped" || simulation.mode === "completed"}>
            {c.skip}
          </button>
          <button className="ghost" onClick={() => setSimulationState(toggleFastMode)}>
            {simulation.fastMode ? c.normal : c.fast}
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
          <h2>{pendingLabel(simulation.pendingQuestion.status, language)}</h2>
          <p>{simulation.pendingQuestion.text || (language === "en-US" ? "No passenger question is waiting." : "目前沒有等待處理的旅客問題。")}</p>
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

  function scheduleFallbackDone(delayMs: number) {
    clearFallbackTimer();
    fallbackTimer.current = window.setTimeout(() => {
      handleResponseDone();
    }, delayMs);
  }

  function clearFallbackTimer() {
    if (fallbackTimer.current != null) {
      window.clearTimeout(fallbackTimer.current);
      fallbackTimer.current = null;
    }
  }

  function clearResponseBoundaryTimer() {
    if (responseBoundaryTimer.current != null) {
      window.clearTimeout(responseBoundaryTimer.current);
      responseBoundaryTimer.current = null;
    }
  }
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

function computeTrainLeft(stations: Station[], simulation: TrainSimulationState): number {
  const currentIndex = Math.max(0, stations.findIndex((station) => station.id === simulation.currentStationId));
  const nextIndex = simulation.nextStationId ? stations.findIndex((station) => station.id === simulation.nextStationId) : currentIndex;
  const start = stationPercent(currentIndex, stations.length);
  const end = stationPercent(nextIndex >= 0 ? nextIndex : currentIndex, stations.length);
  return simulation.mode === "running_between_stations" ? start + (end - start) * simulation.progressOnSegment : start;
}

function getSegmentDurationMs(simulation: TrainSimulationState, stationDurationSeconds: number): number {
  return simulation.fastMode ? 4_000 : Math.round((stationDurationSeconds * 1000) / 5);
}

function getRemainingSegmentMs(startedAt: number, simulation: TrainSimulationState, stationDurationSeconds: number): number {
  if (!startedAt) return 0;
  return Math.max(0, getSegmentDurationMs(simulation, stationDurationSeconds) - (Date.now() - startedAt));
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

function modeLabel(mode: TrainSimulationState["mode"], language: GuideLanguage): string {
  const zh: Record<TrainSimulationState["mode"], string> = {
    stopped: "尚未開始",
    running_between_stations: "列車行駛中",
    narrating_station: "到站導覽",
    answering_pending_question: "回答暫存問題",
    paused: "已暫停",
    completed: "路線完成"
  };
  const en: Record<TrainSimulationState["mode"], string> = {
    stopped: "Stopped",
    running_between_stations: "Running",
    narrating_station: "Narrating",
    answering_pending_question: "Answering",
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
