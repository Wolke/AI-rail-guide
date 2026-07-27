import { describe, expect, it } from "vitest";
import { JourneyContextStore } from "./context";
import { callLocalTool } from "./tools";

describe("local Realtime tools", () => {
  it("always returns the supplied authoritative snapshot", () => {
    const store = new JourneyContextStore("tra-pingxi", "journey-test");
    const snapshot = store.moveTo("shifen", "scenario");
    const result = callLocalTool("get_guide_context", {}, snapshot) as any;
    expect(result.context.revision).toBe(snapshot.revision);
    expect(result.currentStation.id).toBe("shifen");
    expect(result.story.stationId).toBe("shifen");
  });

  it("tags tool output with its context revision", () => {
    const snapshot = new JourneyContextStore().moveTo("wanggu");
    const result = callLocalTool("get_station_story", { stationId: "wanggu" }, snapshot) as any;
    expect(result.contextRevision).toBe(snapshot.revision);
    expect(result.story.stationId).toBe("wanggu");
  });
});
