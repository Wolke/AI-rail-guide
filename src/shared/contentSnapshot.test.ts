import { describe, expect, it } from "vitest";
import snapshot from "../data/rail-content.v1.json";
import { getContentSnapshot, stationStories, validateSnapshot } from "./seedData";

describe("rail content snapshot", () => {
  it("keeps route order and source metadata valid", () => {
    const content = validateSnapshot(snapshot);
    expect(content.route.stationIds).toHaveLength(9);
    expect(content.route.stationIds[0]).toBe("ruifang");
    expect(content.route.stationIds.at(-1)).toBe("jingtong");
    expect(content.sources.every((source) => source.publisher && source.sourceUrl && source.retrievedAt)).toBe(true);
  });

  it("does not publish draft stories", () => {
    expect(stationStories.every((story) => story.reviewStatus !== "draft")).toBe(true);
    expect(getContentSnapshot().stories).toHaveLength(9);
  });

  it("rejects stories without provenance", () => {
    const invalid = structuredClone(snapshot) as any;
    invalid.stories[0].sources = [];
    expect(() => validateSnapshot(invalid)).toThrow(/source/);
  });
});
