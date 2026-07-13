import "dotenv/config";
import express from "express";
import { createInitialJourney, evaluateLocation, eventId, markGpsLost } from "../src/shared/geo";
import { getRoute, getRouteStations, getStationGuideScript, getStationPois, getStationStory, routes, stations } from "../src/shared/seedData";
import type { GpsPoint, GuideContext, GuideLanguage, JourneyEventType, JourneyState, Station, StationStory, TrainSimulationState } from "../src/shared/types";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const journeys = new Map<string, JourneyState>();

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "ai-rail-guide" });
});

app.get("/api/routes", (_req, res) => {
  res.json({ routes });
});

app.get("/api/routes/:routeId", (req, res) => {
  const route = getRoute(req.params.routeId);
  if (!route) {
    res.status(404).json({ error: "Route not found" });
    return;
  }
  res.json({ route, stations: getRouteStations(route.id) });
});

app.get("/api/stations/:stationId/pois", (req, res) => {
  res.json({ pois: getStationPois(req.params.stationId) });
});

app.post("/api/journey/start", (req, res) => {
  const routeId = typeof req.body?.routeId === "string" ? req.body.routeId : "tra-pingxi";
  const route = getRoute(routeId);
  if (!route) {
    res.status(400).json({ error: "Unknown routeId" });
    return;
  }

  const state = createInitialJourney(route.id);
  journeys.set(state.journeyId, state);
  res.json({ journeyId: state.journeyId, route, stations: getRouteStations(route.id), initialState: state });
});

app.post("/api/location/update", (req, res) => {
  const journeyId = req.body?.journeyId;
  if (typeof journeyId !== "string") {
    res.status(400).json({ error: "journeyId is required" });
    return;
  }

  const previous = journeys.get(journeyId);
  if (!previous) {
    res.status(404).json({ error: "Journey not found" });
    return;
  }

  const point = parseGpsPoint(req.body);
  if (!point) {
    const lost = markGpsLost(previous);
    journeys.set(journeyId, lost.state);
    res.json(lost);
    return;
  }

  const result = evaluateLocation(previous, point);
  journeys.set(journeyId, result.state);
  res.json(result);
});

app.post("/api/realtime/session", async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(501).json({ fallback: true, error: "OPENAI_API_KEY is not configured. Text fallback is available." });
    return;
  }

  const routeId = typeof req.body?.routeId === "string" ? req.body.routeId : "tra-pingxi";
  const journeyId = typeof req.body?.journeyId === "string" ? req.body.journeyId : undefined;
  const language = parseGuideLanguage(req.body?.language);
  const simulation = parseSimulation(req.body?.simulation);
  const state = journeyId ? journeys.get(journeyId) : undefined;
  const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1";
  const voice = process.env.OPENAI_REALTIME_VOICE ?? "marin";

  const payload = {
    session: {
      type: "realtime",
      model,
      instructions: buildRealtimeInstructions(routeId, state, language, simulation),
      audio: {
        output: { voice },
        input: {
          transcription: {
            model: "gpt-4o-mini-transcribe"
          },
          turn_detection: {
            type: "semantic_vad",
            eagerness: "low",
            create_response: false,
            interrupt_response: false
          }
        }
      },
      tools: buildRealtimeTools()
    }
  };

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": hashSafetyIdentifier(req.ip ?? "local-user")
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      res.status(response.status).json({ error: data?.error?.message ?? "Failed to create Realtime session" });
      return;
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create Realtime session" });
  }
});

app.post("/api/chat", (req, res) => {
  const message = String(req.body?.message ?? "").trim();
  const language = parseGuideLanguage(req.body?.language);
  const stationId = typeof req.body?.currentStationId === "string" ? req.body.currentStationId : "ruifang";
  const story = getStationStory(stationId);
  const station = stations.find((item) => item.id === stationId);
  const nearbyPois = getStationPois(stationId);
  const poiLine = nearbyPois[0]?.pitchLine ?? "目前先留在車上聽故事，下一站再看是否適合下車。";

  res.json({
    text:
      language === "en-US"
        ? `You asked, "${message || "what is around here"}." Around ${station?.name ?? "this station"}, ${story?.summary ?? "this is a valley segment of the Pingxi Line."} ${nearbyPois[0]?.pitchLine ?? ""}`
        : `你問「${message || "現在附近有什麼故事"}」。以${station?.name ?? "這一站"}來說，${story?.summary ?? "這裡是平溪線山谷旅程的一段轉折。"} ${poiLine}`
  });
});

app.post("/api/tools/get_guide_context", (req, res) => {
  const journeyId = String(req.body?.journeyId ?? "");
  const routeId = typeof req.body?.routeId === "string" ? req.body.routeId : journeys.get(journeyId)?.routeId ?? "tra-pingxi";
  const language = parseGuideLanguage(req.body?.language);
  const simulation = parseSimulation(req.body?.simulation) ?? parseTourContextAsSimulation(req.body?.tourContext);
  const state = journeys.get(journeyId);
  res.json({ context: buildGuideContext(routeId, state, language, simulation) });
});

app.post("/api/tools/get_current_journey_state", (req, res) => {
  const journeyId = String(req.body?.journeyId ?? "");
  res.json({ state: journeys.get(journeyId) ?? null });
});

app.post("/api/tools/get_station_story", (req, res) => {
  const stationId = String(req.body?.stationId ?? "");
  res.json({ story: getStationStory(stationId) ?? null });
});

app.post("/api/tools/get_nearby_pois", (req, res) => {
  const stationId = String(req.body?.stationId ?? "");
  res.json({ pois: getStationPois(stationId) });
});

app.post("/api/tools/mark_event_triggered", (req, res) => {
  const journeyId = String(req.body?.journeyId ?? "");
  const event = String(req.body?.event ?? "") as JourneyEventType;
  const stationId = typeof req.body?.stationId === "string" ? req.body.stationId : undefined;
  const state = journeys.get(journeyId);
  if (!state) {
    res.status(404).json({ error: "Journey not found" });
    return;
  }
  const id = eventId(event, stationId);
  const next = state.triggeredEventIds.includes(id)
    ? state
    : { ...state, triggeredEventIds: [...state.triggeredEventIds, id] };
  journeys.set(journeyId, next);
  res.json({ state: next });
});

app.listen(port, () => {
  console.log(`AI Rail Guide API listening on http://localhost:${port}`);
});

function parseGpsPoint(body: unknown): GpsPoint | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  const accuracy = Number(value.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(accuracy)) return null;
  return {
    lat,
    lng,
    accuracy,
    speed: value.speed == null ? null : Number(value.speed),
    timestamp: Number(value.timestamp ?? Date.now())
  };
}

function buildRealtimeInstructions(routeId: string, state: JourneyState | undefined, language: GuideLanguage, simulation?: TrainSimulationState): string {
  const languageRule =
    language === "en-US"
      ? "You must speak English. Do not switch to Chinese unless the user explicitly asks."
      : "你必須全程使用繁體中文口語回答。不要用英文開場、不要用英文解釋任務，除非使用者明確要求英文。";
  return [
    languageRule,
    "你是 AI Rail Guide，專業台鐵平溪線文史導遊。",
    `routeId=${routeId}; journeyPhase=${state?.phase ?? "unknown"}。`,
    simulation ? `Initial simulation snapshot: ${JSON.stringify(simulation)}` : "不要假設目前站點；每次導覽都必須以最新 response input 或 get_guide_context tool 回傳為準。",
    "你的任務不是閒聊助理，而是專業軌道導遊：一段導覽要講到段落邊界，不要因使用者背景聲音立刻中斷。",
    "使用者自然插話時，先把問題暫存；等目前段落結束，再回答或反問澄清。",
    "如果缺少即時營業狀態、班次或官方來源，不要編造；要說目前只有 MVP 種子資料。",
    "收到 guide segment prompt 時，只講指定段落，不要自己跳到下一段。",
    "必要時呼叫 get_guide_context、get_station_story 或 get_nearby_pois 補上下文；若工具參數有 tourContext，必須優先使用 tourContext，不要退回 journey 初始站。"
  ].join("\n");
}

function buildRealtimeTools() {
  return [
    {
      type: "function",
      name: "get_guide_context",
      description: "Get the full route, station, language, story, and POI context for the current AI Rail Guide journey.",
      parameters: {
        type: "object",
        properties: {
          journeyId: { type: "string" },
          routeId: { type: "string" },
          language: { type: "string", enum: ["zh-TW", "en-US"] },
          simulation: { type: "object" },
          tourContext: { type: "object" }
        },
        required: ["journeyId"]
      }
    },
    {
      type: "function",
      name: "get_current_journey_state",
      description: "Get the current rail journey state by journeyId.",
      parameters: {
        type: "object",
        properties: { journeyId: { type: "string" } },
        required: ["journeyId"]
      }
    },
    {
      type: "function",
      name: "get_station_story",
      description: "Get local guide story seed content for a station.",
      parameters: {
        type: "object",
        properties: { stationId: { type: "string" } },
        required: ["stationId"]
      }
    },
    {
      type: "function",
      name: "get_nearby_pois",
      description: "Get nearby POI recommendations around a station.",
      parameters: {
        type: "object",
        properties: { stationId: { type: "string" } },
        required: ["stationId"]
      }
    },
    {
      type: "function",
      name: "mark_event_triggered",
      description: "Mark a journey event as already triggered.",
      parameters: {
        type: "object",
        properties: {
          journeyId: { type: "string" },
          event: { type: "string" },
          stationId: { type: "string" }
        },
        required: ["journeyId", "event"]
      }
    }
  ];
}

function buildGuideContext(routeId: string, state: JourneyState | undefined, language: GuideLanguage, simulation?: TrainSimulationState): GuideContext {
  const route = getRoute(routeId) ?? null;
  const routeStations = getRouteStations(routeId);
  const currentStation = findStation(simulation?.currentStationId ?? state?.currentStationId);
  const nextStation = findStation(simulation?.nextStationId ?? state?.nextStationId);
  const currentIndex = currentStation ? routeStations.findIndex((station) => station.id === currentStation.id) : 0;
  const nearbyStationIds = [routeStations[currentIndex - 1]?.id, currentStation?.id, nextStation?.id, routeStations[currentIndex + 2]?.id];
  const relevantStationIds = uniqueStrings([...nearbyStationIds, routeStations[0]?.id]);
  const relevantStories = relevantStationIds.map((stationId) => getStationStory(stationId)).filter(isStationStory);
  const relevantPois = relevantStationIds.flatMap((stationId) => getStationPois(stationId));
  const guideScript = currentStation ? getStationGuideScript(currentStation.id) : undefined;
  const localizedScript = guideScript ? (language === "en-US" ? guideScript.en : guideScript.zh) : undefined;
  const currentGuideSegment =
    localizedScript && simulation ? localizedScript.segments[simulation.stationNarrationIndex] : localizedScript?.segments[0];
  const taskBrief =
    language === "en-US"
      ? "AI Rail Guide turns a train ride into an immersive micro-trip. Act as a TRA cultural guide, explain what is outside the window, and suggest one optional stop only when context supports it."
      : "AI Rail Guide 要把枯燥的軌道移動變成沉浸式微旅行。你要化身台鐵文史嚮導，說明窗外與站點故事，並在適合時推一個可下車探索的點。";

  return {
    language,
    route,
    currentStation,
    nextStation,
    relevantStories,
    relevantPois,
    guideScript,
    currentGuideSegment,
    simulation,
    routeStationNames: routeStations.map((station) => station.name),
    taskBrief
  };
}

function findStation(stationId?: string): Station | undefined {
  return stationId ? stations.find((station) => station.id === stationId) : undefined;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function parseGuideLanguage(value: unknown): GuideLanguage {
  return value === "en-US" ? "en-US" : "zh-TW";
}

function parseSimulation(value: unknown): TrainSimulationState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const simulation = value as Partial<TrainSimulationState>;
  if (typeof simulation.currentStationId !== "string") return undefined;
  return simulation as TrainSimulationState;
}

function parseTourContextAsSimulation(value: unknown): TrainSimulationState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const context = value as Record<string, unknown>;
  const currentStationId = typeof context.currentStationId === "string" ? context.currentStationId : undefined;
  if (!currentStationId) return undefined;
  return {
    mode: context.phase === "traveling" ? "running_between_stations" : context.phase === "answering_question" ? "answering_pending_question" : "narrating_station",
    currentStationId,
    nextStationId: typeof context.nextStationId === "string" ? context.nextStationId : undefined,
    segmentIndex: 0,
    progressOnSegment: 0,
    stationNarrationIndex: Number(context.guideSegmentIndex ?? 0),
    pendingQuestion: { status: "none", text: "" },
    fastMode: false
  };
}

function isStationStory(value: StationStory | undefined): value is StationStory {
  return Boolean(value);
}

function hashSafetyIdentifier(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return `rail-guide-${Math.abs(hash)}`;
}
