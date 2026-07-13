import { describe, expect, it } from "vitest";
import { buildRealtimeResponsePayload, buildRealtimeSessionInstructions, formatTourContextLine } from "./realtimeClient";
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

  it("creates isolated response payloads with authoritative current station context", () => {
    const payload = buildRealtimeResponsePayload("zh-TW", "tra-pingxi", "導覽段落：三貂嶺 1/5", "guide-123", context, true);

    expect(payload.conversation).toBe("none");
    expect(payload.metadata.client_response_id).toBe("guide-123");
    expect(payload.metadata.currentStationId).toBe("sandiaoling");
    expect(payload.instructions).toContain("本次 response input 是唯一權威狀態");
    expect(JSON.stringify(payload.input)).toContain("導覽段落：三貂嶺 1/5");
  });
});
