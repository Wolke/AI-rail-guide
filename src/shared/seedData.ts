import snapshotJson from "../data/rail-content.v1.json";
import type { Poi, RailContentSnapshot, Route, Station, StationGuideScript, StationStory } from "./types";

const snapshot = validateSnapshot(snapshotJson);

export const routes: Route[] = [snapshot.route];
export const stations: Station[] = snapshot.stations;
export const stationStories: StationStory[] = snapshot.stories.filter((story) => story.reviewStatus !== "draft");
export const pois: Poi[] = snapshot.pois;

const segmentThemes = {
  ruifang: ["轉乘入口", "礦業山城", "窗外地形", "下車建議", "轉入山線"],
  houtong: ["礦村記憶", "河谷窗景", "貓村轉型", "下車步調", "前往三貂嶺"],
  sandiaoling: ["分岔節點", "山徑瀑布", "溪谷鐵道", "安靜觀察", "轉向大華"],
  dahua: ["小站尺度", "基隆河谷", "慢車節奏", "窗景優先", "靠近十分"],
  shifen: ["鐵道老街", "天燈文化", "瀑布支線", "下車推薦", "往望古前進"],
  wanggu: ["安靜小站", "礦業支線", "溪谷聚落", "短停建議", "往嶺腳前進"],
  lingjiao: ["瀑布與小聚落", "山線生活", "步行尺度", "不急著打卡", "靠近平溪"],
  pingxi: ["山城街廓", "老街生活", "天燈之外", "下車探索", "前往終點"],
  jingtong: ["終點站", "木造車站", "礦業遺構", "停留收束", "旅程回望"]
};

export const stationGuideScripts: StationGuideScript[] = stations.map((station) => {
  const themes = segmentThemes[station.id as keyof typeof segmentThemes] ?? ["地方故事", "沿線窗景", "生活記憶", "下車建議", "旅程續行"];
  const story = stationStories.find((item) => item.stationId === station.id);
  const stationPoi = pois.find((poi) => poi.stationId === station.id);
  return {
    stationId: station.id,
    durationSeconds: 180,
    zh: {
      theme: story?.theme ?? `${station.name}小站故事`,
      summary: story?.summary ?? `${station.name}是平溪線山谷旅程的一個安靜節點，適合放慢速度看窗外。`,
      stopPitch: stationPoi?.pitchLine ?? `${station.name}比較適合在車上慢慢看窗景，不一定要臨時下車。`,
      segments: themes.map(
        (theme, index) =>
          `${station.name}導覽第 ${index + 1} 段：${theme}。${story?.summary ?? `${station.name}把平溪線的山谷、溪流與地方生活接在一起。`} ${
            index === 3 ? stationPoi?.pitchLine ?? "這裡可以把注意力放在窗外山壁與聚落尺度，不一定要下車。" : "請用像真人導遊的節奏，把這一段講完整，再停頓讓旅客吸收。"
          }`
      )
    },
    en: {
      theme: story?.theme ?? `${station.name} station story`,
      summary: story?.summary ?? `${station.name} is a quiet point on the Pingxi Line, best experienced at a slower pace.`,
      stopPitch: stationPoi?.pitchLine ?? `${station.name} is better as a window-view stop in this demo.`,
      segments: themes.map(
        (theme, index) =>
          `${station.name} guide segment ${index + 1}: ${theme}. ${story?.summary ?? `${station.name} connects the valley, railway, and local daily life of the Pingxi Line.`} ${
            index === 3 ? stationPoi?.pitchLine ?? "Focus on the valley and settlement scale rather than pushing a stopover." : "Speak like a professional guide and complete this segment before handling questions."
          }`
      )
    },
    sourceNote: story?.sourceNote ?? "No approved editorial story is available; use only the generic station description."
  };
});

export function getContentSnapshot(): RailContentSnapshot {
  return snapshot;
}

export function getRoute(routeId: string): Route | undefined {
  return routes.find((route) => route.id === routeId);
}

export function getRouteStations(routeId: string): Station[] {
  const route = getRoute(routeId);
  if (!route) return [];
  return route.stationIds.map((stationId) => stations.find((station) => station.id === stationId)).filter((station): station is Station => Boolean(station));
}

export function getStationStory(stationId: string): StationStory | undefined {
  return stationStories.find((story) => story.stationId === stationId);
}

export function getStationGuideScript(stationId: string): StationGuideScript | undefined {
  return stationGuideScripts.find((script) => script.stationId === stationId);
}

export function getStationPois(stationId: string): Poi[] {
  return pois.filter((poi) => poi.stationId === stationId);
}

export function validateSnapshot(value: unknown): RailContentSnapshot {
  if (!value || typeof value !== "object") throw new Error("Rail content snapshot must be an object");
  const candidate = value as Partial<RailContentSnapshot>;
  if (candidate.schemaVersion !== 1) throw new Error("Unsupported rail content schema version");
  if (!candidate.route || !Array.isArray(candidate.stations) || !Array.isArray(candidate.stories) || !Array.isArray(candidate.pois) || !Array.isArray(candidate.sources)) {
    throw new Error("Rail content snapshot is missing required collections");
  }
  const stationIds = new Set(candidate.stations.map((station) => station.id));
  if (candidate.route.stationIds.some((id) => !stationIds.has(id))) throw new Error("Route references an unknown station");
  if (candidate.stories.some((story) => !stationIds.has(story.stationId) || !story.reviewStatus || !story.sources?.length)) {
    throw new Error("Every story must reference a station, review status, and source");
  }
  if (candidate.sources.some((source) => !source.publisher || !source.sourceUrl || !source.retrievedAt)) {
    throw new Error("Every snapshot source must include publisher, URL, and retrieval date");
  }
  return candidate as RailContentSnapshot;
}
