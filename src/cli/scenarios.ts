import { getRouteStations } from "../shared/seedData";
import type { JourneyContextStore } from "./context";
import type { RealtimeCliClient } from "./realtime";

export const scenarioNames = ["normal-route", "rapid-station-change", "change-during-guide", "tool-then-change", "cancel-response"] as const;
export type ScenarioName = (typeof scenarioNames)[number];

export async function runScenario(name: string, store: JourneyContextStore, client: RealtimeCliClient): Promise<void> {
  if (!scenarioNames.includes(name as ScenarioName)) throw new Error(`Unknown scenario: ${name}. Available: ${scenarioNames.join(", ")}`);
  const stations = getRouteStations(store.snapshot().routeId);
  const move = async (stationId: string) => {
    const snapshot = store.moveTo(stationId, "scenario");
    await client.updateContext(snapshot);
    return snapshot;
  };

  if (name === "normal-route") {
    for (const station of stations) {
      const snapshot = await move(station.id);
      client.sendGuide(snapshot);
      await delay(2_000);
    }
    return;
  }
  if (name === "rapid-station-change") {
    for (const station of stations.slice(1, 6)) {
      await move(station.id);
      await delay(250);
    }
    client.sendGuide(store.snapshot());
    return;
  }
  if (name === "change-during-guide") {
    const first = await move("houtong");
    client.sendGuide(first);
    await delay(750);
    const latest = await move("sandiaoling");
    client.sendGuide(latest);
    return;
  }
  if (name === "tool-then-change") {
    const first = await move("shifen");
    client.sendPassengerText("請呼叫 get_guide_context 後介紹目前站點。", first);
    await delay(750);
    const latest = await move("wanggu");
    client.sendGuide(latest);
    return;
  }
  const snapshot = await move("pingxi");
  client.sendGuide(snapshot);
  await delay(500);
  client.cancelActive();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
