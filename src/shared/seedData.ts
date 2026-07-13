import type { Poi, Route, Station, StationGuideScript, StationStory } from "./types";

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
    stationId: "dahua",
    theme: "溪谷裡的小站停頓",
    summary: "大華站規模很小，像是平溪線特意留下的一個呼吸點；列車貼著基隆河谷走，窗外比月台本身更像主角。",
    sourceNote: "MVP seed content; replace with verified editorial source before production."
  },
  {
    stationId: "shifen",
    theme: "瀑布、老街與天燈",
    summary: "十分把鐵道、老街、瀑布和天燈文化壓縮在步行尺度內，是平溪線最容易臨時下車探索的一站。",
    sourceNote: "MVP seed content; replace with verified editorial source before production."
  },
  {
    stationId: "wanggu",
    theme: "避開人潮的山谷小站",
    summary: "望古比十分安靜，站名本身就帶有回望山谷的感覺；這裡適合把旅程從觀光節奏切回溪流、樹影與小聚落。",
    sourceNote: "MVP seed content; replace with verified editorial source before production."
  },
  {
    stationId: "lingjiao",
    theme: "瀑布旁的生活尺度",
    summary: "嶺腳不是最大聲的景點，卻很能看見平溪線的生活尺度；瀑布、老屋、鐵道彼此靠得很近，適合短暫停留。",
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

export const pois: Poi[] = [
  {
    id: "ruifang-food-walk",
    stationId: "ruifang",
    name: "瑞芳車站周邊小吃",
    category: "food",
    distanceMeters: 220,
    pitchLine: "瑞芳很適合當作出發前補給站，先買點小吃再轉進平溪線山谷。"
  },
  {
    id: "houtong-mining-park",
    stationId: "houtong",
    name: "猴硐煤礦博物園區",
    category: "history",
    distanceMeters: 450,
    pitchLine: "如果你想把窗外的礦村故事踩在腳下，猴硐很適合下車走一小圈。"
  },
  {
    id: "sandiaoling-trail",
    stationId: "sandiaoling",
    name: "三貂嶺瀑布步道入口",
    category: "nature",
    distanceMeters: 700,
    pitchLine: "三貂嶺適合有時間與體力的旅客下車，往瀑布步道慢慢走。"
  },
  {
    id: "dahua-window-view",
    stationId: "dahua",
    name: "大華溪谷窗景",
    category: "window_view",
    distanceMeters: 0,
    pitchLine: "大華站不一定要下車，最好的體驗反而是留在車上看溪谷與小站擦身而過。"
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
    id: "wanggu-waterfall",
    stationId: "wanggu",
    name: "望古瀑布周邊",
    category: "nature",
    distanceMeters: 650,
    pitchLine: "望古比十分安靜，適合想避開人潮的人下車看水聲與山谷。"
  },
  {
    id: "lingjiao-waterfall",
    stationId: "lingjiao",
    name: "嶺腳瀑布",
    category: "nature",
    distanceMeters: 500,
    pitchLine: "嶺腳適合短暫下車，把瀑布、老聚落和鐵道距離放在同一段步行裡。"
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

export const stationGuideScripts: StationGuideScript[] = stations.map((station) => {
  const themes = segmentThemes[station.id as keyof typeof segmentThemes];
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
      stopPitch: stationPoi?.pitchLine ?? `${station.name} is better as a window-view stop in this MVP demo.`,
      segments: themes.map(
        (theme, index) =>
          `${station.name} guide segment ${index + 1}: ${theme}. ${story?.summary ?? `${station.name} connects the valley, railway, and local daily life of the Pingxi Line.`} ${
            index === 3 ? stationPoi?.pitchLine ?? "For this stop, focus on the valley and settlement scale rather than pushing a stopover." : "Speak like a professional guide and complete this segment before handling questions."
          }`
      )
    },
    sourceNote: "MVP guide script seed; replace with verified TRA and local tourism sources before production."
  };
});

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

export function getStationGuideScript(stationId: string): StationGuideScript | undefined {
  return stationGuideScripts.find((script) => script.stationId === stationId);
}

export function getStationPois(stationId: string): Poi[] {
  return pois.filter((poi) => poi.stationId === stationId);
}
