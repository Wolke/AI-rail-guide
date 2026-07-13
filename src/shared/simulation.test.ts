import { describe, expect, it } from "vitest";
import { advanceTrain, classifyPendingQuestion, completeCurrentNarrationSegment, createInitialSimulation, skipCurrentStation, startSimulation } from "./simulation";

describe("train simulation", () => {
  it("moves from the first station to the next station", () => {
    const started = startSimulation(createInitialSimulation("tra-pingxi", true));
    const arrived = advanceTrain(started, 5_000);

    expect(arrived.mode).toBe("narrating_station");
    expect(arrived.currentStationId).toBe("houtong");
  });

  it("does not answer clear questions until segment boundary", () => {
    const state = {
      ...createInitialSimulation("tra-pingxi", true),
      mode: "narrating_station" as const,
      pendingQuestion: classifyPendingQuestion("不好意思，我想問剛剛說的礦業是什麼？", 0)
    };

    expect(state.pendingQuestion.status).toBe("clear_question");
    expect(completeCurrentNarrationSegment(state).mode).toBe("answering_pending_question");
  });

  it("can skip a station and continue route movement", () => {
    const state = { ...createInitialSimulation("tra-pingxi", true), mode: "narrating_station" as const };
    const skipped = skipCurrentStation(state);

    expect(skipped.mode).toBe("running_between_stations");
    expect(skipped.nextStationId).toBe("houtong");
  });

  it("can skip the upcoming stop while already moving", () => {
    const state = startSimulation(createInitialSimulation("tra-pingxi", true));
    const skipped = skipCurrentStation(state);

    expect(skipped.mode).toBe("running_between_stations");
    expect(skipped.currentStationId).toBe("houtong");
    expect(skipped.nextStationId).toBe("sandiaoling");
  });
});
