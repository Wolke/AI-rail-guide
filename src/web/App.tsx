import { useEffect, useState, type PointerEvent } from "react";
import { getStationPresentation, useTourRuntime } from "./useTourRuntime";

const questions = ["請問這一站為什麼值得停留？", "剛剛說的礦業歷史是什麼？", "下一站適合下車嗎？"];

const phaseLabel = {
  idle: "尚未出發",
  traveling: "列車行進中",
  narrating: "正在導覽",
  answering_question: "回答旅客問題",
  paused: "導覽已暫停",
  completed: "旅程完成"
};

export function App() {
  const runtime = useTourRuntime();
  const info = getStationPresentation(runtime.state);
  const [showQuestions, setShowQuestions] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => {
    const showUpdate = () => setUpdateAvailable(true);
    window.addEventListener("railtalk-update-available", showUpdate);
    return () => window.removeEventListener("railtalk-update-available", showUpdate);
  }, []);
  const isPaused = runtime.state.phase === "paused";
  const isIdle = runtime.state.phase === "idle";
  const voiceInputAvailable = runtime.mode === "realtime" || runtime.speech.recognitionSupported;
  const progress = ((info.currentIndex + runtime.state.travelProgress) / Math.max(1, info.stations.length - 1)) * 100;

  const handleMicDown = (event: PointerEvent<HTMLButtonElement>) => {
    if ("setPointerCapture" in event.currentTarget) event.currentTarget.setPointerCapture(event.pointerId);
    if (voiceInputAvailable) runtime.startListening();
    else setShowQuestions(true);
  };
  const handleMicUp = () => runtime.stopListening();

  const play = () => {
    if (isIdle || runtime.state.phase === "completed") runtime.dispatch({ type: "START" });
    else if (isPaused) runtime.dispatch({ type: "RESUME" });
    else runtime.dispatch({ type: "PAUSE" });
  };

  return (
    <div className="app-shell">
      {updateAvailable && <div className="update-banner" role="status">新版本已準備好。<button onClick={() => window.location.reload()}>重新載入</button></div>}
      <header className="topbar">
        <a className="brand" href="#main" aria-label="RailTalk 首頁">
          <span className="brand-mark" aria-hidden="true">軌</span>
          <span><strong>軌語</strong><small>RailTalk</small></span>
        </a>
        <div className="topbar-actions">
          {runtime.realtimeAvailable && (
            <div className="mode-switch" aria-label="導覽模式">
              <button className={runtime.mode === "simulated" ? "active" : ""} onClick={() => void runtime.setMode("simulated")}>模擬</button>
              <button className={runtime.mode === "realtime" ? "active" : ""} onClick={() => void runtime.setMode("realtime")}>Realtime</button>
            </div>
          )}
          <div className={`status-pill ${runtime.mode === "realtime" ? runtime.connection : ""}`}>
            <i /> {runtime.mode === "realtime" ? connectionLabel(runtime.connection) : "模擬導覽 · Web Speech"}
          </div>
        </div>
      </header>

      <main id="main" className="dashboard">
        <aside className="route-panel" aria-label="平溪線路線">
          <div className="eyebrow">TRA · PINGXI LINE</div>
          <h2>台鐵平溪線</h2>
          <p className="muted">9 站 · AI 隨行故事</p>
          <ol className="route-list">
            {info.stations.map((station, index) => (
              <li key={station.id} className={index === info.currentIndex ? "active" : index < info.currentIndex ? "passed" : ""}>
                <span className="route-dot" aria-hidden="true" />
                <span>{station.name}</span>
                {index === info.currentIndex && <em>目前</em>}
              </li>
            ))}
          </ol>
        </aside>

        <section className="guide-panel" aria-live="polite">
          <div className="journey-head">
            <div>
              <span className="phase">{phaseLabel[runtime.state.phase]}</span>
              <h1>{info.current?.name ?? "瑞芳"}<small>站</small></h1>
            </div>
            <div className="next-stop"><span>下一站</span><strong>{info.next?.name ?? "終點"}</strong></div>
          </div>

          <div className="mobile-track" aria-label={`旅程進度 ${Math.round(progress)}%`}>
            <span style={{ width: `${progress}%` }} />
          </div>

          <article className="story-card">
            <div className="story-meta">
              <span>NOW PLAYING</span>
              <span>{runtime.state.guideSegmentIndex + 1} / {info.segmentCount}</span>
            </div>
            <h2>{info.story?.theme ?? "準備進入山線"}</h2>
            <div className={`sound-wave ${runtime.speech.speaking ? "playing" : ""}`} aria-hidden="true">
              {Array.from({ length: 28 }, (_, index) => <i key={index} />)}
            </div>
            <p className="caption">{runtime.displayText}</p>
            {runtime.transcript && <p className="transcript"><span>你問</span>{runtime.transcript}</p>}
          </article>

          <div className="primary-controls">
            <button className="icon-button" onClick={() => runtime.dispatch({ type: "PREVIOUS_STATION" })} disabled={info.currentIndex === 0} aria-label="上一站">←</button>
            <button className="play-button" onClick={play} aria-label={isIdle ? "開始旅程" : isPaused ? "繼續導覽" : "暫停導覽"}>
              <span aria-hidden="true">{isIdle || isPaused || runtime.state.phase === "completed" ? "▶" : "Ⅱ"}</span>
            </button>
            <button className="icon-button" onClick={() => runtime.dispatch({ type: "SKIP_TO_NEXT_STATION" })} disabled={runtime.state.phase === "completed"} aria-label="下一站">→</button>
          </div>

          <div className="secondary-controls">
            <button className={runtime.muted ? "selected" : ""} onClick={runtime.toggleMute} aria-pressed={runtime.muted}>音訊 {runtime.muted ? "關" : "開"}</button>
            <button className={runtime.state.fastMode ? "selected" : ""} onClick={() => runtime.dispatch({ type: "TOGGLE_FAST_MODE" })} aria-pressed={runtime.state.fastMode}>快速展示</button>
          </div>

          <div className="ask-area">
            <button className={`mic-button ${runtime.speech.listening ? "listening" : ""}`} onPointerDown={handleMicDown} onPointerUp={handleMicUp} onPointerCancel={handleMicUp}>
              <span aria-hidden="true">●</span>{voiceInputAvailable ? "按住說話" : "問導遊一個問題"}
            </button>
            <small>{voiceInputAvailable ? "放開後送出，導覽會在回答後接續" : "此瀏覽器未提供語音辨識，可選擇示範問題"}</small>
            {runtime.error && <p className="runtime-error" role="alert">{runtime.error} <button onClick={() => void runtime.setMode("simulated")}>回到模擬模式</button></p>}
            {showQuestions && (
              <div className="question-menu" role="dialog" aria-label="選擇示範問題">
                {questions.map((question) => <button key={question} onClick={() => { runtime.ask(question); setShowQuestions(false); }}>{question}</button>)}
                <button className="close" onClick={() => setShowQuestions(false)}>取消</button>
              </div>
            )}
          </div>
        </section>

        <aside className="insight-panel">
          <div className="eyebrow">STATION INSIGHT</div>
          <h2>這站，要下車嗎？</h2>
          <article className="recommend-card stay">
            <span className="recommend-icon" aria-hidden="true">▱</span>
            <div><small>留在車上</small><strong>看河谷從窗邊展開</strong><p>如果行程緊湊，沿線地形本身就是主角。</p></div>
          </article>
          <article className="recommend-card explore">
            <span className="recommend-icon" aria-hidden="true">↗</span>
            <div><small>下車探索</small><strong>{info.poi?.name ?? `${info.current?.name}站周邊`}</strong><p>{info.poi?.pitchLine ?? "用二十分鐘，讀一段地方生活史。"}</p></div>
          </article>
          <div className="data-note"><span>i</span><p><strong>示範內容</strong>定位與列車進度為模擬資料；文史內容正式上線前將完成來源查證。{!runtime.realtimeAvailable && "OpenAI Realtime 即時對話僅於本機開發環境提供，此網頁版使用瀏覽器語音模擬。"}</p></div>
        </aside>
      </main>
      <footer><span>平溪線示範旅程</span><span>位置感知 · 雙向語音 · 可續接導覽</span></footer>
    </div>
  );
}

function connectionLabel(connection: "unavailable" | "disconnected" | "connecting" | "connected" | "error"): string {
  if (connection === "connected") return "Realtime 已連線";
  if (connection === "connecting") return "Realtime 連線中";
  if (connection === "error") return "Realtime 連線異常";
  return "Realtime 未連線";
}
