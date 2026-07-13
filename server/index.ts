import "dotenv/config";
import express from "express";
import { createInitialJourney, evaluateLocation, eventId, markGpsLost } from "../src/shared/geo";
import { getRoute, getRouteStations, getStationPois, getStationStory, pois, routes, stations } from "../src/shared/seedData";
import type { GpsPoint, GuideContext, GuideLanguage, JourneyEventType, JourneyState, Station, StationStory } from "../src/shared/types";

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
  const state = journeyId ? journeys.get(journeyId) : undefined;
  const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1";
  const voice = process.env.OPENAI_REALTIME_VOICE ?? "marin";

  const payload = {
    session: {
      type: "realtime",
      model,
      instructions: buildRealtimeInstructions(routeId, state, language),
      audio: {
        output: { voice },
        input: {
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 600
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
  const state = journeys.get(journeyId);
  res.json({ context: buildGuideContext(routeId, state, language) });
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

function buildRealtimeInstructions(routeId: string, state: JourneyState | undefined, language: GuideLanguage): string {
  const context = buildGuideContext(routeId, state, language);
  const languageRule =
    language === "en-US"
      ? "You must speak English. Do not switch to Chinese unless the user explicitly asks."
      : "你必須全程使用繁體中文口語回答。不要用英文開場、不要用英文解釋任務，除非使用者明確要求英文。";
  return [
    languageRule,
    context.taskBrief,
    "你的任務不是閒聊助理，而是軌道伴遊 voice agent：根據 GPS 事件、目前站點、下一站、故事資料與 POI 推薦，主動產生短語音導覽。",
    "每次主動導覽控制在 20 到 45 秒；使用者插話時，先回答問題，再自然接回旅程。",
    "如果缺少即時營業狀態、班次或官方來源，不要編造；要說目前只有 MVP 種子資料。",
    "收到 journey event 時，先判斷事件類型，再用 guide context 的故事與 POI 回答。",
    "必要時呼叫 get_guide_context、get_station_story 或 get_nearby_pois 補上下文。",
    `Guide context JSON:\n${JSON.stringify(context)}`
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
          language: { type: "string", enum: ["zh-TW", "en-US"] }
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

function buildGuideContext(routeId: string, state: JourneyState | undefined, language: GuideLanguage): GuideContext {
  const route = getRoute(routeId) ?? null;
  const routeStations = getRouteStations(routeId);
  const currentStation = findStation(state?.currentStationId);
  const nextStation = findStation(state?.nextStationId);
  const relevantStationIds = uniqueStrings([currentStation?.id, nextStation?.id, routeStations[0]?.id]);
  const relevantStories = relevantStationIds.map((stationId) => getStationStory(stationId)).filter(isStationStory);
  const relevantPois = relevantStationIds.flatMap((stationId) => getStationPois(stationId));
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
