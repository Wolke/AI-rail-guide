import { describe, expect, it } from "vitest";
import { buildRealtimeSessionInstructions, formatTourContextLine } from "./realtimeClient";
import type { TourContext } from "../shared/tourOrchestrator";

const context: TourContext = {
  routeId: "tra-pingxi",
  language: "zh-TW",
  phase: "traveling",
  currentStationId: "sandiaoling",
  currentStationName: "三貂嶺",
  nextStationId: "dahua",
  nextStationName: "大華",
  guideSegmentIndex: 0,
  pendingQuestionStatus: "none"
};

describe("Realtime prompt context", () => {
  it("formats the latest tour context explicitly", () => {
    expect(formatTourContextLine(context)).toContain("currentStationId=sandiaoling");
    expect(formatTourContextLine(context)).toContain("nextStationId=dahua");
    expect(formatTourContextLine(context)).toContain("phase=traveling");
  });

  it("injects the latest context into session instructions", () => {
    const instructions = buildRealtimeSessionInstructions("zh-TW", "tra-pingxi", context);

    expect(instructions).toContain("你必須全程使用繁體中文");
    expect(instructions).toContain("currentStationName=三貂嶺");
    expect(instructions).toContain("nextStationName=大華");
    expect(instructions).toContain("abandon the previous station");
  });
});
