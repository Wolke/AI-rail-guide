import { describe, expect, it } from "vitest";
import { createInitialTourState, reduceTourEvent } from "./tourOrchestrator";

describe("tour orchestrator", () => {
  it("starts from idle into traveling", () => {
    const initial = createInitialTourState("tra-pingxi");
    const transition = reduceTourEvent(initial, { type: "START" }, 1_000);

    expect(transition.state.phase).toBe("traveling");
    expect(transition.commands.map((command) => command.type)).toContain("START_TRAVEL_TIMER");
  });

  it("arrives at a station and sends the first guide segment", () => {
    const started = reduceTourEvent(createInitialTourState("tra-pingxi", "zh-TW", true), { type: "START" }, 1_000).state;
    const transition = reduceTourEvent(started, { type: "TRAVEL_TICK", deltaMs: 8_000 }, 2_000);

    expect(transition.state.phase).toBe("narrating");
    expect(transition.state.currentStationId).toBe("houtong");
    expect(transition.state.guideSegmentIndex).toBe(0);
    expect(transition.commands.some((command) => command.type === "SEND_GUIDE_SEGMENT")).toBe(true);
  });

  it("skips from narrating atomically into traveling without sending a guide segment", () => {
    const started = reduceTourEvent(createInitialTourState("tra-pingxi", "zh-TW", true), { type: "START" }, 1_000).state;
    const narrating = reduceTourEvent(started, { type: "TRAVEL_TICK", deltaMs: 8_000 }, 2_000).state;
    const transition = reduceTourEvent(narrating, { type: "SKIP_TO_NEXT_STATION" }, 3_000);

    expect(transition.state.currentStationId).toBe("sandiaoling");
    expect(transition.state.nextStationId).toBe("dahua");
    expect(transition.state.phase).toBe("traveling");
    expect(transition.commands.map((command) => command.type)).toEqual([
      "CANCEL_RESPONSE",
      "CLEAR_TIMERS",
      "RESUME_OUTPUT",
      "SYNC_CONTEXT",
      "START_TRAVEL_TIMER"
    ]);
  });

  it("skips from traveling to the upcoming stop and keeps moving forward", () => {
    const traveling = reduceTourEvent(createInitialTourState("tra-pingxi"), { type: "START" }, 1_000).state;
    const transition = reduceTourEvent(traveling, { type: "SKIP_TO_NEXT_STATION" }, 2_000);

    expect(transition.state.currentStationId).toBe("houtong");
    expect(transition.state.nextStationId).toBe("sandiaoling");
    expect(transition.state.phase).toBe("traveling");
    expect(transition.state.travelProgress).toBe(0);
  });

  it("ignores stale guide response done events", () => {
    const started = reduceTourEvent(createInitialTourState("tra-pingxi", "zh-TW", true), { type: "START" }, 1_000).state;
    const narrating = reduceTourEvent(started, { type: "TRAVEL_TICK", deltaMs: 8_000 }, 2_000).state;
    const transition = reduceTourEvent(narrating, { type: "GUIDE_RESPONSE_DONE", responseId: "old-response" }, 3_000);

    expect(transition.state).toEqual(narrating);
    expect(transition.commands).toEqual([]);
  });
});
