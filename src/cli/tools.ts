import { getRoute, getRouteStations, getStationGuideScript, getStationPois, getStationStory } from "../shared/seedData";
import type { JourneyContextSnapshot } from "./context";

export const realtimeTools = [
  tool("get_guide_context", "Get the authoritative current rail journey context and guide material.", {}),
  tool("get_station_story", "Get seed story content for a station.", { stationId: { type: "string" } }, ["stationId"]),
  tool("get_nearby_pois", "Get nearby POIs for a station.", { stationId: { type: "string" } }, ["stationId"])
];

export function callLocalTool(name: string, args: Record<string, unknown>, snapshot: JourneyContextSnapshot): unknown {
  if (name === "get_guide_context") {
    const stations = getRouteStations(snapshot.routeId);
    return {
      context: snapshot,
      route: getRoute(snapshot.routeId),
      currentStation: stations.find((item) => item.id === snapshot.currentStationId),
      nextStation: stations.find((item) => item.id === snapshot.nextStationId),
      story: getStationStory(snapshot.currentStationId),
      pois: getStationPois(snapshot.currentStationId),
      guideScript: getStationGuideScript(snapshot.currentStationId)
    };
  }
  const requestedStation = typeof args.stationId === "string" ? args.stationId : snapshot.currentStationId;
  if (name === "get_station_story") return { contextRevision: snapshot.revision, story: getStationStory(requestedStation) ?? null };
  if (name === "get_nearby_pois") return { contextRevision: snapshot.revision, pois: getStationPois(requestedStation) };
  throw new Error(`Unknown tool: ${name}`);
}

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[] = []) {
  return { type: "function", name, description, parameters: { type: "object", properties, required, additionalProperties: false } };
}
