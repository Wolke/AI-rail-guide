import type { Poi, Route, Station, StationStory } from "./types";

export const routes: Route[] = [
  {
    id: "tra-pingxi",
    name: "台鐵平溪線微旅行",
    mode: "tra",
    stationIds: ["ruifang", "houtong", "sandiaoling", "dahua", "shifen", "wanggu", "lingjiao", "pingxi", "jingtong"]
  }
];

export const stations: Station[] = [
  { id: "ruifang", name: "瑞芳", lineId: "tra-pingxi", lat: 25.1088, lng: 121.8062, order: 1 },
  { id: "houtong", name: "猴硐", lineId: "tra-pingxi", lat: 25.087, lng: 121.8274, order: 2 },
  { id: "sandiaoling", name: "三貂嶺", lineId: "tra-pingxi", lat: 25.0655, lng: 121.8228, order: 3 },
  { id: "dahua", name: "大華", lineId: "tra-pingxi", lat: 25.0499, lng: 121.7976, order: 4 },
  { id: "shifen", name: "十分", lineId: "tra-pingxi", lat: 25.0411, lng: 121.7751, order: 5 },
  { id: "wanggu", name: "望古", lineId: "tra-pingxi", lat: 25.0347, lng: 121.7649, order: 6 },
  { id: "lingjiao", name: "嶺腳", lineId: "tra-pingxi", lat: 25.0307, lng: 121.7471, order: 7 },
  { id: "pingxi", name: "平溪", lineId: "tra-pingxi", lat: 25.0256, lng: 121.7383, order: 8 },
  { id: "jingtong", name: "菁桐", lineId: "tra-pingxi", lat: 25.0238, lng: 121.7238, order: 9 }
];

export const stationStories: StationStory[] = [
  {
    stationId: "ruifang",
    theme: "礦業轉運門戶",
    summary: "瑞芳曾是北台灣礦業與山城交通的入口，平溪線旅程從這裡轉入基隆河谷，城市聲音開始慢慢變成山谷回音。",
    sourceNote: "MVP seed content; replace with verified editorial source before production."
  },
  {
    stationId: "houtong",
    theme: "礦村與貓村",
    summary: "猴硐保留礦業聚落的尺度，也因貓村形成新的慢遊節奏。列車靠近時，山壁、河道與舊礦場會一起出現在窗景裡。",
    sourceNote: "MVP seed content; replace with verified editorial source before production."
  },
  {
    stationId: "sandiaoling",
    theme: "支線分岔與山徑",
    summary: "三貂嶺是山線感最強的轉折點之一，鐵道在這裡沿溪谷前進，也連接瀑布步道與更安靜的山村記憶。",
    sourceNote: "MVP seed content; replace with verified editorial source before production."
  },
  {
    stationId: "shifen",
    theme: "瀑布、老街與天燈",
    summary: "十分把鐵道、老街、瀑布和天燈文化壓縮在步行尺度內，是平溪線最容易臨時下車探索的一站。",
    sourceNote: "MVP seed content; replace with verified editorial source before production."
  },
  {
    stationId: "pingxi",
    theme: "山城老街",
    summary: "平溪站周邊保留山城街屋與緩慢坡道，適合把旅程從車廂切換成步行，用二十分鐘讀一段地方生活史。",
    sourceNote: "MVP seed content; replace with verified editorial source before production."
  },
  {
    stationId: "jingtong",
    theme: "終點站與礦業遺構",
    summary: "菁桐是平溪線終點，木造車站、礦業遺構與山城街廓讓它很適合作為微旅行的收束點。",
    sourceNote: "MVP seed content; replace with verified editorial source before production."
  }
];

export const pois: Poi[] = [
  {
    id: "houtong-mining-park",
    stationId: "houtong",
    name: "猴硐煤礦博物園區",
    category: "history",
    distanceMeters: 450,
    pitchLine: "如果你想把窗外的礦村故事踩在腳下，猴硐很適合下車走一小圈。"
  },
  {
    id: "shifen-waterfall",
    stationId: "shifen",
    name: "十分瀑布",
    category: "nature",
    distanceMeters: 1500,
    pitchLine: "下一站十分可以臨時下車，沿著河谷走去聽瀑布聲。"
  },
  {
    id: "pingxi-old-street",
    stationId: "pingxi",
    name: "平溪老街",
    category: "food",
    distanceMeters: 180,
    pitchLine: "平溪站出站後很快就到老街，適合補一點熱食再繼續山線旅程。"
  },
  {
    id: "jingtong-railway-story",
    stationId: "jingtong",
    name: "菁桐鐵道故事館周邊",
    category: "culture",
    distanceMeters: 120,
    pitchLine: "到了終點菁桐，不急著回頭，先把木造車站和礦業記憶看完。"
  }
];

export function getRoute(routeId: string): Route | undefined {
  return routes.find((route) => route.id === routeId);
}

export function getRouteStations(routeId: string): Station[] {
  const route = getRoute(routeId);
  if (!route) return [];
  return route.stationIds
    .map((stationId) => stations.find((station) => station.id === stationId))
    .filter((station): station is Station => Boolean(station));
}

export function getStationStory(stationId: string): StationStory | undefined {
  return stationStories.find((story) => story.stationId === stationId);
}

export function getStationPois(stationId: string): Poi[] {
  return pois.filter((poi) => poi.stationId === stationId);
}
