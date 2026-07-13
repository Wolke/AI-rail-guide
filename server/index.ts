import "dotenv/config";
import express from "express";
import { createInitialJourney, evaluateLocation, eventId, markGpsLost } from "../src/shared/geo";
import { getRoute, getRouteStations, getStationPois, getStationStory, pois, routes, stations } from "../src/shared/seedData";
import type { GpsPoint, JourneyEventType, JourneyState } from "../src/shared/types";

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
  const state = journeyId ? journeys.get(journeyId) : undefined;
  const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1";
  const voice = process.env.OPENAI_REALTIME_VOICE ?? "marin";

  const payload = {
    session: {
      type: "realtime",
      model,
      instructions: buildRealtimeInstructions(routeId, state),
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
  const stationId = typeof req.body?.currentStationId === "string" ? req.body.currentStationId : "ruifang";
  const story = getStationStory(stationId);
  const station = stations.find((item) => item.id === stationId);
  const nearbyPois = getStationPois(stationId);
  const poiLine = nearbyPois[0]?.pitchLine ?? "目前先留在車上聽故事，下一站再看是否適合下車。";

  res.json({
    text: `你問「${message || "現在附近有什麼故事"}」。以${station?.name ?? "這一站"}來說，${story?.summary ?? "這裡是平溪線山谷旅程的一段轉折。"} ${poiLine}`
  });
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

function buildRealtimeInstructions(routeId: string, state?: JourneyState): string {
  const route = getRoute(routeId);
  const currentStation = state?.currentStationId ? stations.find((station) => station.id === state.currentStationId) : undefined;
  return [
    "你是 AI Rail Guide 的台鐵文史導覽員。",
    "用繁體中文回答，語氣像在地朋友加文史嚮導，精準、溫暖、不要浮誇。",
    "每次主動導覽控制在 20 到 45 秒；如果使用者插話，先回答問題，再自然接回旅程。",
    "不要假裝知道即時營業狀態或班次。沒有資料時明確說目前只能提供 MVP 種子資料。",
    "收到 journey event 時，根據目前站點、下一站、故事與 POI 生成語音導覽。",
    `目前路線：${route?.name ?? routeId}。`,
    currentStation ? `目前推定站點：${currentStation.name}。` : "目前尚未取得站點。"
  ].join("\n");
}

function buildRealtimeTools() {
  return [
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

function hashSafetyIdentifier(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return `rail-guide-${Math.abs(hash)}`;
}
