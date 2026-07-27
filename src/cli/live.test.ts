import { describe, expect, it } from "vitest";

const enabled = process.env.AI_RAIL_LIVE_TEST === "1";

describe.skipIf(!enabled)("Realtime live smoke", () => {
  it("requires explicit credentials", () => {
    expect(process.env.OPENAI_API_KEY, "OPENAI_API_KEY must be set for live smoke tests").toBeTruthy();
  });
});
