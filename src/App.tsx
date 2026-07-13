import { useMemo, useRef, useState } from "react";
import { sendFallbackChat, startJourney } from "./lib/api";
import { RealtimeRailClient } from "./lib/realtimeClient";
import { saveJourneyState } from "./lib/storage";
import { useGeolocationJourney } from "./hooks/useGeolocationJourney";
import { getRouteStations, getStationPois, getStationStory } from "./shared/seedData";
import type { JourneyEventType, JourneyState, LocationUpdateResult, Station } from "./shared/types";

type VoiceStatus = "idle" | "connecting" | "connected" | "fallback" | "error";

const routeId = "tra-pingxi";

export function App() {
  const [journey, setJourney] = useState<JourneyState | null>(null);
  const [tracking, setTracking] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [feed, setFeed] = useState<string[]>(["按下開始旅程後，我會取得 GPS、建立 Realtime 語音導覽，並在接近站點時主動說故事。"]);
  const [input, setInput] = useState("");
  const [lastResult, setLastResult] = useState<LocationUpdateResult | null>(null);
  const realtime = useRef<RealtimeRailClient | null>(null);
  const routeStations = useMemo(() => getRouteStations(routeId), []);

  const appendFeed = (message: string) => {
    setFeed((items) => [message, ...items].slice(0, 12));
  };

  const handleJourneyEvent = (event: JourneyEventType, state: JourneyState) => {
    const station = findStation(routeStations, state.nextStationId ?? state.currentStationId);
    const story = station ? getStationStory(station.id) : undefined;
    const poi = station ? getStationPois(station.id)[0] : undefined;
    appendFeed(formatEvent(event, station, story?.summary, poi?.pitchLine));
    realtime.current?.sendJourneyEvent(event, state);
  };

  const { error: gpsError, mockLocation } = useGeolocationJourney({
    journeyId: journey?.journeyId,
    enabled: tracking,
    onLocationResult: (result) => {
      setJourney(result.state);
      setLastResult(result);
    },
    onJourneyEvent: handleJourneyEvent
  });

  const currentStation = findStation(routeStations, journey?.currentStationId);
  const nextStation = findStation(routeStations, journey?.nextStationId);
  const currentStory = currentStation ? getStationStory(currentStation.id) : undefined;
  const currentPois = currentStation ? getStationPois(currentStation.id) : [];

  const beginJourney = async () => {
    const response = await startJourney(routeId);
    setJourney(response.initialState);
    await saveJourneyState(response.initialState);
    setTracking(true);
    appendFeed("旅程已開始。請允許定位與麥克風權限，AI 嚮導會在前景狀態陪你移動。");

    realtime.current = new RealtimeRailClient({
      onStatus: setVoiceStatus,
      onMessage: (message) => {
        if (message.trim()) appendFeed(message);
      },
      onError: appendFeed
    });
    await realtime.current.connect(response.journeyId, response.route.id);
  };

  const stopJourney = () => {
    setTracking(false);
    realtime.current?.disconnect();
    realtime.current = null;
    setVoiceStatus("idle");
    appendFeed("旅程已暫停。");
  };

  const sendMessage = async () => {
    const message = input.trim();
    if (!message || !journey) return;
    setInput("");
    appendFeed(`你：${message}`);

    if (voiceStatus === "connected") {
      realtime.current?.sendUserText(message);
      return;
    }

    const response = await sendFallbackChat({
      journeyId: journey.journeyId,
      message,
      currentStationId: journey.currentStationId,
      nextStationId: journey.nextStationId
    });
    appendFeed(`AI：${response.text}`);
  };

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">AI Rail Guide PWA</p>
          <h1>平溪線動態 AI 伴遊</h1>
        </div>
        <div className={`status status-${voiceStatus}`}>{voiceStatusLabel(voiceStatus)}</div>
      </section>

      <section className="dashboard">
        <div className="journey-panel">
          <div className="rail-line" aria-hidden="true">
            {routeStations.map((station) => (
              <span
                key={station.id}
                className={[
                  "rail-dot",
                  station.id === currentStation?.id ? "is-current" : "",
                  station.id === nextStation?.id ? "is-next" : ""
                ].join(" ")}
                title={station.name}
              />
            ))}
          </div>

          <div className="station-grid">
            <Metric label="目前站點" value={currentStation?.name ?? "尚未定位"} />
            <Metric label="下一站" value={nextStation?.name ?? "待判斷"} />
            <Metric label="GPS" value={journey?.gpsStatus ?? "idle"} />
            <Metric label="旅程狀態" value={journey?.phase ?? "idle"} />
          </div>

          <div className="actions">
            {!tracking ? (
              <button className="primary" onClick={() => void beginJourney()}>
                開始旅程
              </button>
            ) : (
              <button className="secondary" onClick={stopJourney}>
                暫停旅程
              </button>
            )}
            <button className="ghost" onClick={() => void mockLocationFor(nextStation ?? routeStations[0], mockLocation)}>
              模擬下一站
            </button>
          </div>
          {gpsError ? <p className="warning">{gpsError}</p> : null}
          {lastResult ? <p className="meta">定位信心 {Math.round(lastResult.confidence * 100)}%</p> : null}
        </div>

        <div className="story-panel">
          <p className="eyebrow">Current Context</p>
          <h2>{currentStory?.theme ?? "等待旅程事件"}</h2>
          <p>{currentStory?.summary ?? "開始旅程後，AI 會根據 GPS 與站點事件主動導覽。"}</p>
          {currentPois[0] ? <p className="poi">推坑：{currentPois[0].pitchLine}</p> : null}
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
              if (event.key === "Enter") void sendMessage();
            }}
            placeholder="打字插話；Realtime 連線成功時也可直接開口說話"
          />
          <button onClick={() => void sendMessage()}>送出</button>
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

function voiceStatusLabel(status: VoiceStatus): string {
  const labels: Record<VoiceStatus, string> = {
    idle: "語音待機",
    connecting: "連線中",
    connected: "Realtime 已連線",
    fallback: "文字 fallback",
    error: "語音錯誤"
  };
  return labels[status];
}

function formatEvent(event: JourneyEventType, station?: Station, summary?: string, poiLine?: string): string {
  const stationName = station?.name ?? "目前路段";
  if (event === "poi_recommendation" && poiLine) return `AI：${poiLine}`;
  if (event === "approaching_station") return `AI：快到 ${stationName} 了。${summary ?? "我會準備一段在地故事。"}`;
  if (event === "arrived_station") return `AI：抵達 ${stationName}。${summary ?? "這一站可以短暫停留觀察周邊。"}`;
  if (event === "gps_lost") return "AI：GPS 暫時不穩，我會先用上一段旅程狀態推估。";
  if (event === "journey_started") return `AI：旅程開始，先從 ${stationName} 的故事進入平溪線。`;
  return `AI：列車正在往 ${stationName} 方向移動。${summary ?? ""}`;
}

async function mockLocationFor(station: Station | undefined, update: (point: Partial<{ lat: number; lng: number; accuracy: number; timestamp: number }>) => Promise<void>) {
  if (!station) return;
  await update({ lat: station.lat, lng: station.lng, accuracy: 35, timestamp: Date.now() });
}
