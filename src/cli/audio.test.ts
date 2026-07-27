import { describe, expect, it, vi } from "vitest";
import { MacAudioController } from "./audio";

describe("MacAudioController", () => {
  it("degrades without a helper instead of throwing", () => {
    const onError = vi.fn();
    const audio = new MacAudioController(vi.fn(), onError, "/missing/rail-audio-helper");
    expect(audio.available()).toBe(false);
    audio.startMicrophone();
    audio.play(Buffer.from([1, 2]));
    expect(onError).toHaveBeenCalled();
    audio.close();
  });
});
