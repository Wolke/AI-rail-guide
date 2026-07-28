# RailTalk（軌語）完整重建規格書 — Lovable 版

日期：2026-07-28
用途：在 Lovable 從零重建 RailTalk，語音層做成 **OpenAI ↔ ElevenLabs ↔ 瀏覽器 TTS 三引擎可切換**。此文件的目標是：**不看原始 repo 也能重做出同等產品**。所有規格取自現行可運作的程式碼（非構想）。

---

# Part A · 產品規格

## A1. 產品概述

RailTalk 是行動優先的 AI 火車導遊 PWA。示範路線為台鐵平溪線九站（瑞芳→菁桐）。模擬列車沿線前進，到站後 AI 用語音分段講述該站故事；旅客隨時可以「按住說話」提問，導覽講完當前段落後回答問題、再自然接回導覽。所有文史內容來自一份**已完成編輯查證、附官方來源**的資料快照（附錄一）。

三種語音引擎，使用者可在設定面板切換：

| 引擎 | 旁白 | 問答 | 需要後端 | 用途 |
|------|------|------|---------|------|
| `browser`（Web Speech） | speechSynthesis | 模板回答（見 A5.4） | 否 | 免費 fallback、離線可用 |
| `openai`（Realtime WebRTC） | 模型即時口播 | 真 AI 語音對話 | SDP proxy | 黑客松主打 |
| `elevenlabs`（TTS） | ElevenLabs 音訊 | 模板回答（同 browser） | TTS proxy + 快取 | grants 申請證據 |

## A2. 畫面規格

單頁應用。桌機三欄、手機單欄直向堆疊（route panel 摺疊為水平進度點列亦可）。UI 語言 zh-TW。

### A2.1 頂欄（topbar）
- 品牌：方形字標「軌」+「**軌語** / RailTalk」。
- 狀態膠囊（status pill）：顯示目前引擎與連線狀態。文案：
  - browser：「模擬導覽 · Web Speech」
  - openai：「Realtime 已連線 / 連線中 / 未連線 / 連線異常」（帶綠/黃/灰/紅圓點）
  - elevenlabs：「ElevenLabs 語音」
- 設定按鈕（齒輪）開啟設定抽屜（A2.6）。
- 新版本橫幅：service worker 偵測到更新時顯示「新版本已準備好。〔重新載入〕」。

### A2.2 路線面板（route panel）
- Eyebrow 小字「TRA · PINGXI LINE」、標題「台鐵平溪線」、副標「9 站 · AI 隨行故事」。
- 九站直列，每站一個圓點 + 站名；目前站高亮並標「目前」，已過站淡化。

### A2.3 導覽面板（guide panel，主區）
- 階段標籤（phase → 文案）：`idle` 尚未出發 / `traveling` 列車行進中 / `narrating` 正在導覽 / `answering_question` 回答旅客問題 / `paused` 導覽已暫停 / `completed` 旅程完成。
- 大標：目前站名 +「站」小字；右側「下一站 →〔站名 | 終點〕」。
- 旅程進度條：`progress = (currentIndex + travelProgress) / (stationCount - 1) × 100%`。
- 故事卡（story card）：
  - meta 列：「NOW PLAYING」+「第 n / 5 段」
  - 標題：該站故事 theme
  - 聲波動畫：28 根長條，播音時跳動（`speaking` 狀態驅動）
  - 字幕區（caption）：目前旁白全文；Realtime 模式下為串流逐字顯示
  - 若旅客有提問，顯示「你問：〔轉錄文字〕」
- 主控制列：〔← 上一站〕〔▶/Ⅱ 播放暫停〕〔下一站 →〕。上一站在第一站時 disabled；下一站在 completed 時 disabled。播放鍵語意：idle/completed→開始旅程、paused→繼續、其餘→暫停。
- 次控制列：〔音訊 開/關〕〔快速展示〕（toggle 樣式，aria-pressed）。
- 提問區（ask area）：
  - 主按鈕「●按住說話」：pointerdown 開始收音（setPointerCapture）、pointerup/cancel 送出。openai 引擎→開 mic track；browser 引擎→Web Speech 辨識；兩者皆不可用→改為「問導遊一個問題」開啟預設問題選單。
  - 輔助說明小字：「放開後送出，導覽會在回答後接續」或「此瀏覽器未提供語音辨識，可選擇示範問題」。
  - 預設問題選單（dialog）：「請問這一站為什麼值得停留？」「剛剛說的礦業歷史是什麼？」「下一站適合下車嗎？」+ 取消。
  - 錯誤列（role=alert）：顯示 runtime 錯誤 + 「回到模擬模式」按鈕（切回 browser 引擎）。

### A2.4 車站洞察面板（insight panel）
- Eyebrow「STATION INSIGHT」、標題「這站，要下車嗎？」。
- 兩張建議卡：
  - 「留在車上」卡：固定文案「看河谷從窗邊展開／如果行程緊湊，沿線地形本身就是主角。」
  - 「下車探索」卡：目前站第一個 POI 的 name + pitchLine。
- 資料聲明卡：「**示範內容** 定位與列車進度為模擬資料；文史內容已完成官方來源查證（見關於頁）。」

### A2.5 頁尾
「平溪線示範旅程」·「位置感知 · 雙向語音 · 可續接導覽」。

### A2.6 設定抽屜（新增，原版沒有）
- **語音引擎**：三選一卡片（Browser / OpenAI Realtime / ElevenLabs），各自顯示可用性徽章：可用｜未設定（缺 key）｜此瀏覽器不支援。選擇存 localStorage（key：`railtalk.voiceProvider`）。
- **語言**：zh-TW / en-US 切換（P5）。
- **用量儀表**（P5）：本次 session 的 TTS 字元數（分引擎）、Realtime 連線秒數、最近一次首音延遲 ms。
- **關於**：內容版本、九站來源清單（附錄一的 sources 逐條列出）。

## A3. 核心互動流程

1. **出發**：按 ▶ → 進度條開跑（正常 180 秒/站距、快速展示 8 秒）→ 到站 → 依序播 5 段旁白 → 播完自動開往下一站 → … → 菁桐播完顯示「抵達菁桐，平溪線的故事在這裡暫告一段落。」（completed）。completed 後再按 ▶ 從頭重來。
2. **行進中字幕**：「列車行進中，下一站 〔站名〕。」；初始字幕：「準備好後，從瑞芳出發。沿途故事會在正確的時間出現。」
3. **提問插隊**：旁白中按住說話 → 放開 → 字幕顯示「已收到：『…』這段說完就回答你。」→ 當前段落講完 → 進入回答 → 回答完 → 接續下一段。**問題永不打斷當前段落**。
4. **暫停/繼續**：暫停即停止播音並取消進行中的回應；繼續時：traveling 重啟計時、narrating **從當前段落開頭重講**、answering 重新回答。
5. **跳站/回上一站**：立即取消播音與計時；跳站進入前往下一站的 traveling（最後一站則 completed）；上一站直接進入該站 narrating 第 1 段。
6. **靜音**：browser/elevenlabs 引擎下靜音時，若正在播音則跳過該段（視為完成）；openai 引擎下僅靜音喇叭（audio element muted），流程照走。
7. **引擎切換**：立即 stop 當前播音、斷開 Realtime、清計時器，新引擎自下一段旁白生效。

## A4. 視覺設計

- 基調：夜行列車感。深石板底（#0f172a 系）、暖琥珀強調色（#f59e0b 系）、卡片圓角 16px、細邊框半透明白。
- 字體：系統中文黑體優先（PingFang TC / Noto Sans TC）；英文 eyebrow 用等寬或加寬字距大寫。
- 觸控目標 ≥ 44px；播放鍵為大圓鈕；單手可及（主控制在下半部）。
- 聲波動畫、進度條、站點高亮是僅有的三種動效；提問選單淡入。
- 支援 `prefers-reduced-motion`。

## A5. 內容與問答規則

### A5.1 內容資料
唯一來源為附錄一 JSON（schemaVersion 1）。結構：`route`（九站順序）、`stations`（座標）、`stories`（theme/summary/來源/審核狀態）、`pois`（每站一個下車建議）、`sources`（快照層級出處）。**規則：`reviewStatus === "draft"` 的故事不得顯示**（目前 8 站 approved、望古 approved_for_demo）。

### A5.2 導覽腳本生成（五段式）
每站 5 段旁白由模板生成，不另外寫稿。各站段落主題表：

| 站 | 段 1–5 主題 |
|----|------------|
| ruifang | 轉乘入口、礦業山城、窗外地形、下車建議、轉入山線 |
| houtong | 礦村記憶、河谷窗景、貓村轉型、下車步調、前往三貂嶺 |
| sandiaoling | 分岔節點、山徑瀑布、溪谷鐵道、安靜觀察、轉向大華 |
| dahua | 小站尺度、基隆河谷、慢車節奏、窗景優先、靠近十分 |
| shifen | 鐵道老街、天燈文化、瀑布支線、下車推薦、往望古前進 |
| wanggu | 安靜小站、礦業支線、溪谷聚落、短停建議、往嶺腳前進 |
| lingjiao | 瀑布與小聚落、山線生活、步行尺度、不急著打卡、靠近平溪 |
| pingxi | 山城街廓、老街生活、天燈之外、下車探索、前往終點 |
| jingtong | 終點站、木造車站、礦業遺構、停留收束、旅程回望 |

zh 模板（第 i 段，i 從 0 起）：
`${站名}導覽第 ${i+1} 段：${主題}。${story.summary} ${i===3 ? poi.pitchLine : "請用像真人導遊的節奏，把這一段講完整，再停頓讓旅客吸收。"}`
en 模板同構（`${name} guide segment ${i+1}: …`，尾句 "Speak like a professional guide and complete this segment before handling questions."）。每站總時長基準 180 秒。

### A5.3 問題分類
```
clear_question（明確）：/不好意思.*(問|請問|想問)/、/請問/、/我想問/、/想問一下/、
  /這邊是什麼意思/、/剛剛說的/、/what does/i、/can i ask/i、/i have a question/i、/could you explain/i
unclear_question（含糊）：/不好意思$/、/請問一下$/、/想問$/、/question\??$/i、/sorry/i
```
- 語音/預設選單送進來的文字若不匹配任何 pattern，一律視為 clear_question（使用者已明確按了提問）。
- 已有 clear_question 排隊時，新問題丟棄（不覆蓋）。
- unclear_question 的回應是澄清語：「我有聽到你想提問，可以再說完整一點嗎？」

### A5.4 非 Realtime 引擎的模板回答
`好問題。${story.summary}${poi ? " 如果想下車，" + poi.pitchLine : ""}`

---

# Part B · 技術規格

## B1. 技術棧

Lovable 預設：React 18 + Vite + TypeScript + Tailwind + shadcn/ui；後端 Supabase（Edge Functions + Storage + secrets）。狀態機為純函式 reducer（可單元測試、無副作用）；副作用（計時器、播音、網路）全部由 reducer 回傳的 **commands** 在 runtime hook 執行。

## B2. 導覽狀態機（照抄即可，這是現行已通過測試的設計）

### B2.1 State
```ts
type TourPhase = "idle" | "traveling" | "narrating" | "answering_question" | "paused" | "completed";
type TourResponseKind = "guide" | "question" | "clarification";
interface TourState {
  routeId: string; language: "zh-TW" | "en-US"; phase: TourPhase;
  currentStationId: string; nextStationId?: string;
  travelProgress: number;          // 0..1
  guideSegmentIndex: number;       // 0..4
  activeResponseId?: string;       // 當前進行中的旁白/回答
  activeResponseKind?: TourResponseKind;
  pendingQuestion: { status: "none" | "clear_question" | "unclear_question"; text: string; capturedAtSegment?: number };
  pausedFrom?: Exclude<TourPhase, "paused">;
  fastMode: boolean;
}
```
常數：`NORMAL_TRAVEL_MS = 180_000`、`FAST_TRAVEL_MS = 8_000`、travel tick 每 250ms。

### B2.2 Events 與 Commands
```ts
type TourEvent =
  | { type: "START" } | { type: "PAUSE" } | { type: "RESUME" }
  | { type: "PREVIOUS_STATION" } | { type: "SKIP_TO_NEXT_STATION" }
  | { type: "TRAVEL_TICK"; deltaMs: number }
  | { type: "GUIDE_RESPONSE_DONE"; responseId?: string }
  | { type: "QUESTION_RESPONSE_DONE"; responseId?: string }
  | { type: "QUESTION_CAPTURED"; pendingQuestion: PendingQuestion }
  | { type: "LANGUAGE_CHANGED"; language: GuideLanguage }
  | { type: "TOGGLE_FAST_MODE" };

type TourCommand =
  | { type: "SYNC_CONTEXT"; context: TourContext }        // 引擎需要知道目前站/段（openai 用）
  | { type: "CANCEL_RESPONSE" }                            // 停止當前播音/取消模型回應
  | { type: "MUTE_OUTPUT" } | { type: "RESUME_OUTPUT" }
  | { type: "SEND_GUIDE_SEGMENT"; context; segmentText; segmentLabel; responseId }
  | { type: "ANSWER_PENDING_QUESTION"; context; question; responseId }
  | { type: "ASK_QUESTION_CLARIFICATION"; context; question; responseId }
  | { type: "START_TRAVEL_TIMER" } | { type: "CLEAR_TIMERS" };
```

### B2.3 轉移表（reducer 規則）

| Event | 前置條件 | 結果 |
|-------|---------|------|
| START | idle 或 completed（completed 先重置到瑞芳） | → traveling（無下一站則 narrating）；commands: RESUME_OUTPUT, SYNC_CONTEXT, START_TRAVEL_TIMER |
| PAUSE | traveling/narrating/answering | → paused，記 `pausedFrom`，清 activeResponse；commands: CANCEL_RESPONSE, CLEAR_TIMERS, MUTE_OUTPUT, SYNC_CONTEXT |
| RESUME | paused | 回 `pausedFrom`：traveling→START_TRAVEL_TIMER；narrating→重發當前段（新 responseId）；answering→重發 pendingQuestion |
| TRAVEL_TICK | traveling | progress += delta/duration；達 1 → 到站：currentStation=next、segment=0、phase=narrating、發第 1 段（無下一站則 completed）；commands 前綴 CLEAR_TIMERS, SYNC_CONTEXT |
| GUIDE_RESPONSE_DONE | narrating **且 responseId+kind 與 active 相符**（否則忽略——這是防過期回應的關鍵） | 有 pendingQuestion → answering_question 並發回答；否則還有段落 → segment+1 發下一段；否則 → 結束本站：有下一站 traveling+START_TRAVEL_TIMER，無則 completed |
| QUESTION_RESPONSE_DONE | answering **且 responseId 相符**（kind 為 question/clarification） | 清 pendingQuestion → 回 narrating：還有段落發下一段（segment+1），否則結束本站（同上） |
| QUESTION_CAPTURED | status ≠ none；且目前沒有排隊中的 clear_question | 存入 pendingQuestion（不改 phase） |
| SKIP_TO_NEXT_STATION | 任意 | 跳到下一站的 traveling（最後一站→completed）；commands: CANCEL_RESPONSE, CLEAR_TIMERS, RESUME_OUTPUT, SYNC_CONTEXT, (START_TRAVEL_TIMER) |
| PREVIOUS_STATION | currentIndex > 0 | 直接進上一站 narrating 第 1 段（發段落）；commands 前綴 CANCEL_RESPONSE, CLEAR_TIMERS, RESUME_OUTPUT, SYNC_CONTEXT |
| TOGGLE_FAST_MODE | 任意 | 切 fastMode；若 traveling 則 CLEAR_TIMERS + START_TRAVEL_TIMER（用新時長重跑） |
| LANGUAGE_CHANGED | 任意 | 換語言 + SYNC_CONTEXT |

**responseId 規則**：每次發旁白段/回答都產生唯一 id（`guide-{ts}-{rand}` 等）。DONE 事件必須帶相同 id 且 kind 相符才生效——被取消、過期（切站後才回來）的完成事件一律忽略。這條規則是整個系統不亂序的根基，務必實作。

### B2.4 Runtime hook 執行 commands
- START_TRAVEL_TIMER：setInterval 250ms dispatch TRAVEL_TICK。
- SEND_GUIDE_SEGMENT / ANSWER / CLARIFICATION → 交給當前 VoiceProvider（B3）。播完（或無語音時 3.6 秒後備計時）dispatch 對應 DONE 事件。
- traveling 時字幕固定為「列車行進中，下一站 X。」；completed 固定收尾句。

## B3. 語音抽象層

```ts
interface VoiceProvider {
  id: "browser" | "elevenlabs" | "openai";
  label: string;
  isAvailable(): Promise<boolean>;   // browser: 檢查 window.speechSynthesis；其餘: 打對應 health endpoint
  // 旁白／模板回答（browser、elevenlabs 實作）
  speak(text: string, opts: { lang: "zh-TW" | "en-US" }, onDone: () => void): void;
  stop(): void;
  // 對話能力（僅 openai 實作；其餘丟 NotSupported，由 runtime 走模板回答）
  sendGuide?(state: TourState, text: string, responseId: string): Promise<void>;
  sendQuestion?(state: TourState, question: string, responseId: string): Promise<void>;
  cancel?(): void;
  setMicrophoneEnabled?(on: boolean): void;
  setMuted(muted: boolean): void;
}
```
- 所有旁白與回答**只能**經 provider，元件不得直接碰 speechSynthesis / fetch。
- Fallback 順序：openai/elevenlabs 失敗 → toast 提示 → 自動降級 browser → browser 也不可用 → 靜音字幕模式（3.6 秒/段自動前進）。
- 首次播音必須由使用者手勢（▶ 按鈕）觸發後解鎖（iOS Safari autoplay 政策；elevenlabs 需先 `new Audio()` 並在手勢中 play 一次空白音）。

## B4. Edge Function ①：`realtime-sdp`（OpenAI Realtime proxy，P3）

WebRTC 音訊為點對點，**function 只做一次 SDP 交換**，不經手音訊。

```
POST /realtime-sdp        Content-Type: application/sdp   Body: 瀏覽器的 SDP offer（必以 "v=" 開頭，≤64KB）
成功 → 200 application/sdp（OpenAI 的 answer）
無 key → 503 {error:"realtime_not_configured"}；格式錯 → 415；過大 → 413；上游失敗 → 502
GET  /realtime-sdp/health → 200 {realtimeConfigured: boolean}
```
Function 內部：
```
POST https://api.openai.com/v1/realtime/calls
Authorization: Bearer ${OPENAI_API_KEY}      // Supabase secret
Body: FormData { sdp: <offer>, session: JSON.stringify({
  type: "realtime", model: "gpt-realtime-2.1-mini",
  output_modalities: ["audio"], audio: { output: { voice: "marin" } } }) }
→ 回傳 text 即 SDP answer
```

## B5. OpenAI Realtime 客戶端協定（P3，直接照此實作）

1. **連線**：getUserMedia(audio, echoCancellation+noiseSuppression) → RTCPeerConnection → addTrack → `createDataChannel("oai-events")` → offer → POST 給 `realtime-sdp` → setRemoteDescription(answer) → 等 channel open（12 秒逾時）。遠端音軌接到 `<audio autoplay>`。麥克風平時 `track.enabled = false`，按住說話期間 true（push-to-talk）。
2. **Context 同步**（每次發旁白/回答前必做）：`revision++`，送 `session.update`：
   - `instructions`：多行字串——「你是 RailTalk 平溪線導覽員，只能使用繁體中文口語。／不得編造即時班次、營業時間、票價或未由工具提供的史實。／旅客問題優先；回答完成後停下，不得自行切換站點。」+ `contextRevision=`、`routeId=`、`currentStationId=`、`nextStationId=`、`phase=`、`guideSegmentIndex=` 各一行。
   - `output_modalities: ["audio"]`；`audio.input.transcription.model: "gpt-4o-mini-transcribe"`；`audio.input.turn_detection: { type: "semantic_vad", eagerness: "low", create_response: false, interrupt_response: false }`（**由狀態機決定何時回應，不讓 VAD 自動觸發**）。
   - `tools`：`get_station_story`（取得目前站已審核附來源的故事）、`get_station_pois`（取得下車建議）——皆無參數。
   - 等 `session.updated` ack（8 秒逾時，pending map 以 event_id 對應）。
3. **發旁白**：`response.create`，`conversation: "none"`（不進對話歷史，防 context 漂移），`metadata: { local_response_id, context_revision }`，input 為一則 user message：「請根據目前 authoritative context 口語導覽這一段，內容限於：${segmentText}」。
4. **發回答**：同上，文字為「旅客問：『${question}』。先回答，再自然接回目前站點。需要事實時必須呼叫工具。」
5. **事件處理**：
   - `conversation.item.input_audio_transcription.completed` → 得到旅客語音轉錄 → 走 QUESTION_CAPTURED 流程
   - `response.output_audio_transcript.delta` / `response.output_text.delta` → 串流字幕
   - `response.function_call_arguments.done` → 本地查資料（story 過濾 draft、pois）→ 送 `conversation.item.create`(function_call_output) + 補一個 `response.create`（帶同 metadata）
   - `response.done` → **檢查 metadata.local_response_id 的 revision 是否等於當前 revision，不等則忽略** → dispatch 對應 DONE 事件
   - `error` → 顯示「Realtime 服務回報錯誤，請稍後重試。」
6. **取消**：送 `response.cancel`。

## B6. Edge Function ②：`tts-elevenlabs`（P4）

```
POST /tts-elevenlabs   Body: { text: string, lang: "zh-TW"|"en-US", voiceId?: string }
成功 → 200 audio/mpeg（串流）；Header: X-Cache: HIT|MISS, X-Characters-Billed: <n>
無 key → 503 {error:"tts_not_configured"}；上游失敗 → 502
GET /tts-elevenlabs/health → 200 {ttsConfigured: boolean}
```
內部流程：
1. cacheKey = sha256(`${text}|${lang}|${voiceId}|${modelId}`)。
2. 查 Supabase Storage bucket `tts-cache/${cacheKey}.mp3`——命中直接回傳（X-Cache: HIT，計費字元 0）。
3. 未命中 → 呼叫 ElevenLabs `POST /v1/text-to-speech/{voiceId}`（`ELEVENLABS_API_KEY` from secrets；model `eleven_flash_v2_5` 低延遲，或 `eleven_multilingual_v2` 高品質；zh-TW/en 各配一個預設 voiceId 存 config）→ 寫入 bucket → 回傳（X-Cache: MISS，計費字元 = text.length）。
4. **快取是必做項**：九站 45 段旁白是固定文本，全快取後 demo 排練成本趨近於零。

`ElevenLabsProvider.speak()`：fetch → blob → `<audio>` 播放 → onended 呼叫 onDone；失敗則降級 browser 並 toast。

## B7. PWA 與離線

- manifest（名稱「軌語 RailTalk」、主題色深石板、icon）；service worker 預快取 shell 與內容 JSON。
- SW 偵測新版本時 dispatch `railtalk-update-available` 自訂事件 → 顯示更新橫幅。
- 離線時：browser 引擎完整可用；openai/elevenlabs 顯示「未連線」並自動降級。

## B8. 用量儀表（P5，grants 申請的數據來源）

session 內累計（存 localStorage，設定抽屜顯示）：
- 各引擎 TTS 字元數（elevenlabs 以 X-Characters-Billed 累加，快取命中不計）
- Realtime 連線秒數、回答次數
- 最近一次首音延遲 ms（speak 呼叫 → audio playing 事件）
- 常駐徽章：目前引擎 + 最近首音延遲。

## B9. 錯誤處理矩陣

| 情境 | 行為 |
|------|------|
| openai health 不可用 | 引擎選項顯示「未設定」，選不了 |
| Realtime 連線失敗/逾時（12s） | 錯誤列 + 「回到模擬模式」；自動降級 browser |
| Realtime context 同步逾時（8s） | 同上 |
| elevenlabs 503/502 | toast「ElevenLabs 暫時無法使用，已改用瀏覽器語音」，降級 |
| 麥克風權限拒絕 | 提問區退化為預設問題選單 |
| speechSynthesis 不存在 | 靜音字幕模式（3.6s/段） |
| 切站/暫停時有進行中回應 | CANCEL_RESPONSE；遲到的 DONE 因 responseId 不符被忽略 |

---

# Part C · 交付計畫

## C1. 階段與驗收

### P1 — App 殼與模擬旅程（純前端，零 key）
做：A2 全部畫面（設定抽屜先只有引擎佔位）、B2 狀態機 reducer + runtime hook、附錄一資料、A5.2 腳本生成、字幕流程（靜音字幕模式即可）。
**驗收**：手機開啟按 ▶，列車 180s/站距（快速展示 8s）走完九站；每站 5 段字幕依序出現；上一站/下一站/暫停/繼續行為符合 A3；預設問題插隊 → 段落講完出現模板回答 → 接續。reducer 有單元測試（至少：到站轉移、問題插隊、responseId 不符忽略、completed 重啟）。

### P2 — 語音抽象層 + 瀏覽器 TTS
做：B3 介面、BrowserTtsProvider（speechSynthesis + Web Speech 辨識）、設定抽屜引擎選擇（另兩個顯示未設定）、靜音語意（A3.6）、手勢解鎖。
**驗收**：到站自動語音旁白；按住說話（支援的瀏覽器）能語音提問；切換選項持久化；跳站立即停音。

### P3 — OpenAI Realtime 問答（黑客松主打；你已有 OpenAI credit）
做：B4 edge function、B5 客戶端全協定、引擎選項解鎖。
**驗收**：切到 OpenAI 後旁白由模型口播、字幕串流；按住說話提問 → 轉錄顯示「你問」→ 段落完講答案（模型可呼叫兩個工具取資料）→ 接回導覽；切站後遲到的 response.done 不會弄亂狀態；行動版 Safari/Chrome 可用；key 只存在 Supabase secrets。

### P4 — ElevenLabs TTS（grants 證據；黑客松後補上也行）
做：B6 edge function + Storage 快取、ElevenLabsProvider、降級 toast。
**驗收**：切到 ElevenLabs 旁白為 ElevenLabs 音色；同段第二次播放 X-Cache: HIT；拔掉 key 自動降級 browser；X-Characters-Billed 正確累計。

### P5 — Demo 打磨
做：B8 用量儀表與延遲徽章、en-US 語言切換（腳本模板已雙語）、PWA 離線、關於頁來源清單。
**驗收**：儀表數字隨播放增長；離線仍可用 browser 引擎走完全程；語言切換即時生效。

**時程感**：P1 一個下午、P2 半天、P3 一天（協定細節多，B5 照抄可省一半時間）、P4 半天、P5 半天。**黑客松最低要求 P1–P3**；P4 在申請 ElevenLabs grants 前完成。

## C2. Lovable prompt 策略

- 每階段一個起手 prompt + 數個修正 prompt；驗收清單過了才進下一階段。
- 第一個 prompt 就把「附錄一 JSON 全文 + A5.2 腳本表 + B2 狀態機」全部貼進去（Lovable 有 Knowledge 功能就放 Knowledge）。
- 之後每階段把本文件對應章節（如 P3 = B4+B5）整段貼上，**不要自己摘要**——協定細節（conversation:"none"、semantic_vad 參數、revision 檢查）漏一條就會出現幽靈 bug。
- 卡住時把本 repo 對應檔案（`src/shared/tourOrchestrator.ts`、`src/web/realtimeClient.ts`、`src/server/realtimeServer.ts`）內容貼給它當參考實作。

### P1 起手 prompt（英文，直接貼）

> Build "軌語 RailTalk" — a mobile-first PWA acting as an AI tour guide for Taiwan's TRA Pingxi Branch Line. UI copy is Traditional Chinese. Tech: React + TypeScript + Tailwind + shadcn.
>
> Implement the tour state machine EXACTLY as specified below as a pure reducer `reduceTourEvent(state, event) → { state, commands[] }` with no side effects; a `useTourRuntime` hook executes returned commands (timers, captions). Include unit tests for: arrival transition, question queueing during narration, stale responseId ignored, restart after completion.
>
> Screens and copy must follow the attached UI spec (topbar, route panel with 9 stations, guide panel with phase label / progress bar / story card with 28-bar sound wave / primary+secondary controls / ask area with preset-question dialog, insight panel, footer). Travel takes 180s per segment (8s in fast mode), narration is 5 scripted segments per station generated from the template in the spec. This phase has NO audio and NO backend: captions auto-advance every 3.6s per segment.
>
> [貼上：A2 畫面規格、A3 互動流程、A5 內容與問答規則、B2 狀態機、附錄一 JSON]

### P2 prompt

> Add the voice layer per the attached spec (section B3): a `VoiceProvider` interface, `BrowserTtsProvider` using window.speechSynthesis for narration and Web Speech recognition for hold-to-talk questions. All narration/answers must flow through the provider — components never touch speechSynthesis directly. Segment advance is now driven by speech end (keep the 3.6s fallback when synthesis is unavailable or muted). Add the Settings drawer with a 3-engine picker (OpenAI and ElevenLabs shown as "not configured"), persisted to localStorage key `railtalk.voiceProvider`. Unlock audio on the first ▶ tap for iOS Safari.
>
> [貼上：B3、A2.6、A3 第 6–7 條]

### P3 prompt

> Connect Supabase. Implement the OpenAI Realtime engine exactly per the attached protocol spec: an edge function `realtime-sdp` proxying one SDP exchange to `POST https://api.openai.com/v1/realtime/calls` (model gpt-realtime-2.1-mini, voice marin, key from Supabase secrets; 503 when unconfigured, plus a health endpoint), and a `OpenAiRealtimeProvider` WebRTC client: data channel "oai-events", push-to-talk mic track, session.update context sync with revision + ack before every response, `response.create` with `conversation:"none"` and local_response_id metadata, semantic_vad with create_response:false, two client-executed tools (get_station_story / get_station_pois), streaming caption deltas, and the stale-revision guard on response.done. Do not proxy audio through the function — WebRTC is peer-to-peer.
>
> [貼上：B4、B5、B9]

### P4 prompt

> Add the ElevenLabs engine per spec: edge function `tts-elevenlabs` (POST {text, lang, voiceId} → audio/mpeg; ELEVENLABS_API_KEY from secrets; model eleven_flash_v2_5; sha256 cache in a Storage bucket `tts-cache` with X-Cache and X-Characters-Billed headers; health endpoint) and `ElevenLabsProvider` playing returned audio through an `<audio>` element. On any failure fall back to the browser provider with a toast. Never expose the key to the client.
>
> [貼上：B6、B9]

### P5 prompt

> Final polish per spec: (1) usage meter in Settings — per-engine TTS characters (sum X-Characters-Billed), realtime connected seconds, last time-to-first-audio ms, plus a persistent engine badge showing engine + latency; (2) zh-TW/en-US language toggle wired to LANGUAGE_CHANGED (scripts are already bilingual by template); (3) PWA: manifest, service worker precaching shell + content JSON, update banner on `railtalk-update-available`; offline mode keeps the browser engine fully working; (4) About section listing the content sources from the JSON.
>
> [貼上：B7、B8、A2.6]

## C3. 風險與注意

1. **ElevenLabs credits**：無快取排練一天就燒掉可觀字元。B6 的 Storage 快取是必做項。
2. **Realtime 音訊不過 function**：只 proxy SDP；讓 Lovable 誤把音訊也代理會又貴又卡。
3. **iOS 自動播放**：首播必須綁使用者手勢（▶ 就是那個手勢），elevenlabs 引擎要先解鎖 `<audio>`。
4. **狀態機是心臟**：B2.3 的 responseId 相符規則與 B5 的 revision 檢查缺一不可，否則切站/取消後會出現幽靈語音或跳段。
5. **內容單向同步**：編輯查證流程留在原 repo（有 provenance 與測試）；內容更新後把 JSON 重新貼進 Lovable，不在 Lovable 端改內容。
6. **grants 敘事**：P5 用量儀表的數字（字元/月、對話分鐘）直接寫進 ElevenLabs 申請書的 projected usage；demo 時錄影存證。

---

# 附錄一 · 內容資料快照（rail-content.v1.json 全文，2026-07-28 查證版）

```json
{
  "schemaVersion": 1,
  "route": {
    "id": "tra-pingxi",
    "name": "台鐵平溪線微旅行",
    "mode": "tra",
    "stationIds": ["ruifang", "houtong", "sandiaoling", "dahua", "shifen", "wanggu", "lingjiao", "pingxi", "jingtong"]
  },
  "stations": [
    { "id": "ruifang", "name": "瑞芳", "lineId": "tra-pingxi", "lat": 25.1088, "lng": 121.8062, "order": 1 },
    { "id": "houtong", "name": "猴硐", "lineId": "tra-pingxi", "lat": 25.087, "lng": 121.8274, "order": 2 },
    { "id": "sandiaoling", "name": "三貂嶺", "lineId": "tra-pingxi", "lat": 25.0655, "lng": 121.8228, "order": 3 },
    { "id": "dahua", "name": "大華", "lineId": "tra-pingxi", "lat": 25.0499, "lng": 121.7976, "order": 4 },
    { "id": "shifen", "name": "十分", "lineId": "tra-pingxi", "lat": 25.0411, "lng": 121.7751, "order": 5 },
    { "id": "wanggu", "name": "望古", "lineId": "tra-pingxi", "lat": 25.0347, "lng": 121.7649, "order": 6 },
    { "id": "lingjiao", "name": "嶺腳", "lineId": "tra-pingxi", "lat": 25.0307, "lng": 121.7471, "order": 7 },
    { "id": "pingxi", "name": "平溪", "lineId": "tra-pingxi", "lat": 25.0256, "lng": 121.7383, "order": 8 },
    { "id": "jingtong", "name": "菁桐", "lineId": "tra-pingxi", "lat": 25.0238, "lng": 121.7238, "order": 9 }
  ],
  "stories": [
    { "stationId": "ruifang", "theme": "礦業轉運門戶", "summary": "瑞芳曾是北台灣礦業與山城交通的入口，平溪線旅程從這裡轉入基隆河谷，城市聲音開始慢慢變成山谷回音。", "sourceNote": "Editorial copy fact-checked against the linked official sources on 2026-07-28.", "reviewStatus": "approved", "reviewedAt": "2026-07-28", "sources": [{ "publisher": "新北市政府觀光旅遊局", "sourceUrl": "https://newtaipei.travel/zh-tw/attractions/detail/109993", "retrievedAt": "2026-07-28" }, { "publisher": "新北市政府觀光旅遊局", "sourceUrl": "https://newtaipei.travel/zh-tw/tour/21", "retrievedAt": "2026-07-28" }] },
    { "stationId": "houtong", "theme": "礦村與貓村", "summary": "猴硐保留礦業聚落的尺度，也因貓村形成新的慢遊節奏。列車靠近時，山壁、河道與舊礦場會一起出現在窗景裡。", "sourceNote": "Editorial copy fact-checked against the linked official sources on 2026-07-28.", "reviewStatus": "approved", "reviewedAt": "2026-07-28", "sources": [{ "publisher": "新北市政府觀光旅遊局", "sourceUrl": "https://newtaipei.travel/zh-tw/attractions/detail/110802", "retrievedAt": "2026-07-28" }, { "publisher": "新北市政府觀光旅遊局", "sourceUrl": "https://newtaipei.travel/zh-tw/attractions/detail/110748", "retrievedAt": "2026-07-28" }] },
    { "stationId": "sandiaoling", "theme": "支線分岔與山徑", "summary": "三貂嶺是山線感最強的轉折點之一，鐵道在這裡沿溪谷前進，也連接瀑布步道與更安靜的山村記憶。", "sourceNote": "Editorial copy fact-checked against the linked official sources on 2026-07-28.", "reviewStatus": "approved", "reviewedAt": "2026-07-28", "sources": [{ "publisher": "新北市政府觀光旅遊局", "sourceUrl": "https://newtaipei.travel/zh-tw/attractions/detail/302768", "retrievedAt": "2026-07-28" }, { "publisher": "新北市政府觀光旅遊局", "sourceUrl": "https://newtaipei.travel/zh-tw/tour/21", "retrievedAt": "2026-07-28" }] },
    { "stationId": "dahua", "theme": "溪谷裡的小站停頓", "summary": "大華站規模很小，像是平溪線特意留下的一個呼吸點；列車貼著基隆河谷走，窗外比月台本身更像主角。", "sourceNote": "Editorial copy fact-checked against the linked official sources on 2026-07-28.", "reviewStatus": "approved", "reviewedAt": "2026-07-28", "sources": [{ "publisher": "新北市政府觀光旅遊局", "sourceUrl": "https://newtaipei.travel/zh-tw/attractions/detail/110053", "retrievedAt": "2026-07-28" }, { "publisher": "新北市平溪區公所", "sourceUrl": "https://www.pingxi.ntpc.gov.tw/home.jsp?id=d807b8f840c41169", "retrievedAt": "2026-07-28" }] },
    { "stationId": "shifen", "theme": "瀑布、老街與天燈", "summary": "十分把鐵道、老街、瀑布和天燈文化壓縮在步行尺度內，是平溪線最容易臨時下車探索的一站。", "sourceNote": "Editorial copy fact-checked against the linked official sources on 2026-07-28.", "reviewStatus": "approved", "reviewedAt": "2026-07-28", "sources": [{ "publisher": "新北市政府觀光旅遊局", "sourceUrl": "https://newtaipei.travel/zh-tw/attractions/detail/110037", "retrievedAt": "2026-07-28" }, { "publisher": "新北市政府觀光旅遊局", "sourceUrl": "https://newtaipei.travel/zh-tw/attractions/detail/109612", "retrievedAt": "2026-07-28" }] },
    { "stationId": "wanggu", "theme": "避開人潮的山谷小站", "summary": "望古比十分安靜，適合把旅程從觀光節奏切回溪流、樹影與小聚落。", "sourceNote": "Editorial copy fact-checked on 2026-07-28. The Wanggu waterfall trail is partially closed for slope repairs per the official source; keep demo status until the closure is lifted.", "reviewStatus": "approved_for_demo", "reviewedAt": "2026-07-28", "sources": [{ "publisher": "新北市政府觀光旅遊局", "sourceUrl": "https://newtaipei.travel/zh-tw/attractions/detail/302751", "retrievedAt": "2026-07-28" }] },
    { "stationId": "lingjiao", "theme": "瀑布旁的生活尺度", "summary": "嶺腳能看見平溪線的生活尺度；瀑布、老屋、鐵道彼此靠得很近，適合短暫停留。", "sourceNote": "Editorial copy fact-checked against the linked official sources on 2026-07-28.", "reviewStatus": "approved", "reviewedAt": "2026-07-28", "sources": [{ "publisher": "新北市政府觀光旅遊局", "sourceUrl": "https://newtaipei.travel/zh-tw/attractions/detail/110703", "retrievedAt": "2026-07-28" }] },
    { "stationId": "pingxi", "theme": "山城老街", "summary": "平溪站周邊保留山城街屋與緩慢坡道，適合把旅程從車廂切換成步行，用二十分鐘讀一段地方生活史。", "sourceNote": "Editorial copy fact-checked against the linked official sources on 2026-07-28.", "reviewStatus": "approved", "reviewedAt": "2026-07-28", "sources": [{ "publisher": "新北市政府觀光旅遊局", "sourceUrl": "https://newtaipei.travel/zh-tw/attractions/detail/110030", "retrievedAt": "2026-07-28" }] },
    { "stationId": "jingtong", "theme": "終點站與礦業遺構", "summary": "菁桐是平溪線終點，木造車站、礦業遺構與山城街廓讓它很適合作為微旅行的收束點。", "sourceNote": "Editorial copy fact-checked against the linked official sources on 2026-07-28.", "reviewStatus": "approved", "reviewedAt": "2026-07-28", "sources": [{ "publisher": "新北市政府觀光旅遊局", "sourceUrl": "https://newtaipei.travel/zh-tw/attractions/detail/110042", "retrievedAt": "2026-07-28" }, { "publisher": "新北市政府觀光旅遊局", "sourceUrl": "https://newtaipei.travel/zh-tw/attractions/detail/110043", "retrievedAt": "2026-07-28" }] }
  ],
  "pois": [
    { "id": "ruifang-food-walk", "stationId": "ruifang", "name": "瑞芳車站周邊小吃", "category": "food", "distanceMeters": 220, "pitchLine": "瑞芳很適合當作出發前補給站，先買點小吃再轉進平溪線山谷。" },
    { "id": "houtong-mining-park", "stationId": "houtong", "name": "猴硐煤礦博物園區", "category": "history", "distanceMeters": 150, "pitchLine": "如果你想把窗外的礦村故事踩在腳下，猴硐很適合下車走一小圈。" },
    { "id": "sandiaoling-trail", "stationId": "sandiaoling", "name": "三貂嶺瀑布步道入口", "category": "nature", "distanceMeters": 700, "pitchLine": "三貂嶺適合有時間與體力的旅客下車，往瀑布步道慢慢走。" },
    { "id": "dahua-window-view", "stationId": "dahua", "name": "大華溪谷窗景", "category": "window_view", "distanceMeters": 0, "pitchLine": "大華站不一定要下車，最好的體驗反而是留在車上看溪谷與小站擦身而過。" },
    { "id": "shifen-waterfall", "stationId": "shifen", "name": "十分瀑布", "category": "nature", "distanceMeters": 1500, "pitchLine": "下一站十分可以臨時下車，沿著河谷走去聽瀑布聲。" },
    { "id": "wanggu-waterfall", "stationId": "wanggu", "name": "望古瀑布周邊", "category": "nature", "distanceMeters": 650, "pitchLine": "望古比十分安靜，適合想避開人潮的人下車看水聲與山谷；出發前請留意觀瀑步道部分路段整修封閉的公告。" },
    { "id": "lingjiao-waterfall", "stationId": "lingjiao", "name": "嶺腳瀑布", "category": "nature", "distanceMeters": 500, "pitchLine": "嶺腳適合短暫下車，把瀑布、老聚落和鐵道距離放在同一段步行裡。" },
    { "id": "pingxi-old-street", "stationId": "pingxi", "name": "平溪老街", "category": "food", "distanceMeters": 180, "pitchLine": "平溪站出站後很快就到老街，適合補一點熱食再繼續山線旅程。" },
    { "id": "jingtong-railway-story", "stationId": "jingtong", "name": "菁桐鐵道故事館周邊", "category": "culture", "distanceMeters": 50, "pitchLine": "到了終點菁桐，不急著回頭，先把木造車站和礦業記憶看完。" }
  ],
  "sources": [
    { "publisher": "國營臺灣鐵路股份有限公司（政府資料開放平臺：臺鐵車站基本資料集）", "sourceUrl": "https://data.gov.tw/dataset/33425", "retrievedAt": "2026-07-28" },
    { "publisher": "交通部觀光署", "sourceUrl": "https://media.taiwan.net.tw/zh-tw/portal/data", "retrievedAt": "2026-07-28" },
    { "publisher": "新北市政府觀光旅遊局", "sourceUrl": "https://newtaipei.travel/", "retrievedAt": "2026-07-28" }
  ]
}
```
