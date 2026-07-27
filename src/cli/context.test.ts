import { describe, expect, it } from "vitest";
import { JourneyContextStore, formatContext } from "./context";

describe("JourneyContextStore", () => {
  it("increments revisions only for meaningful changes", () => {
    const store = new JourneyContextStore("tra-pingxi", "journey-test");
    expect(store.snapshot().revision).toBe(0);
    expect(store.update({ phase: "idle" }).revision).toBe(0);
    expect(store.update({ phase: "traveling" }).revision).toBe(1);
  });

  it("moves station and derives the next station atomically", () => {
    const store = new JourneyContextStore("tra-pingxi", "journey-test");
    const snapshot = store.moveTo("sandiaoling", "scenario");
    expect(snapshot.currentStationId).toBe("sandiaoling");
    expect(snapshot.nextStationId).toBe("dahua");
    expect(snapshot.guideSegmentIndex).toBe(0);
    expect(snapshot.source).toBe("scenario");
    expect(formatContext(snapshot)).toContain("contextRevision=1");
  });

  it("rejects unknown stations", () => {
    const store = new JourneyContextStore();
    expect(() => store.moveTo("not-a-station")).toThrow("Unknown station");
  });
});
