import { describe, expect, it } from "vitest";
import { createInitialJourney, evaluateLocation, markGpsLost } from "./geo";

describe("journey location engine", () => {
  it("emits journey_started once", () => {
    const initial = createInitialJourney("tra-pingxi");
    const first = evaluateLocation(initial, { lat: 25.1088, lng: 121.8062, accuracy: 20, timestamp: 1 });
    const second = evaluateLocation(first.state, { lat: 25.1089, lng: 121.8063, accuracy: 20, timestamp: 2 });

    expect(first.event).toBe("journey_started");
    expect(second.event).not.toBe("journey_started");
  });

  it("marks weak GPS when accuracy is poor", () => {
    const result = evaluateLocation(createInitialJourney("tra-pingxi"), {
      lat: 25.087,
      lng: 121.8274,
      accuracy: 180,
      timestamp: 1
    });

    expect(result.state.gpsStatus).toBe("weak");
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("emits an estimated gps_lost state when previous point exists", () => {
    const first = evaluateLocation(createInitialJourney("tra-pingxi"), { lat: 25.1088, lng: 121.8062, accuracy: 20, timestamp: 1 });
    const lost = markGpsLost(first.state);

    expect(lost.event).toBe("gps_lost");
    expect(lost.state.gpsStatus).toBe("estimated");
  });
});
