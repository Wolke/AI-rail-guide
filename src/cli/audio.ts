import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export class MacAudioController {
  private capture?: ChildProcessWithoutNullStreams;
  private playback?: ChildProcessWithoutNullStreams;
  private muted = false;

  constructor(
    private readonly onMicrophonePcm: (chunk: Buffer) => void,
    private readonly onError: (error: Error) => void,
    private readonly helperPath = resolve(".build/rail-audio-helper")
  ) {}

  available(): boolean {
    return process.platform === "darwin" && existsSync(this.helperPath);
  }

  startMicrophone(): void {
    if (this.capture) return;
    const child = this.spawnHelper("capture");
    if (!child) return;
    this.capture = child;
    child.stdout.on("data", (chunk: Buffer) => this.onMicrophonePcm(chunk));
    child.once("exit", (code) => {
      if (this.capture === child) this.capture = undefined;
      if (code && code !== 0) this.onError(new Error(`Audio capture exited with code ${code}`));
    });
  }

  stopMicrophone(): void {
    this.capture?.kill("SIGTERM");
    this.capture = undefined;
  }

  play(chunk: Buffer): void {
    if (this.muted || chunk.length === 0) return;
    if (!this.playback) {
      const child = this.spawnHelper("playback");
      if (!child) return;
      this.playback = child;
      child.once("exit", (code) => {
        if (this.playback === child) this.playback = undefined;
        if (code && code !== 0) this.onError(new Error(`Audio playback exited with code ${code}`));
      });
    }
    this.playback.stdin.write(chunk);
  }

  clearPlayback(): void {
    this.playback?.kill("SIGTERM");
    this.playback = undefined;
  }

  mute(): void {
    this.muted = true;
    this.clearPlayback();
  }

  unmute(): void {
    this.muted = false;
  }

  close(): void {
    this.stopMicrophone();
    this.clearPlayback();
  }

  private spawnHelper(mode: "capture" | "playback"): ChildProcessWithoutNullStreams | undefined {
    if (!this.available()) {
      this.onError(new Error("Audio helper unavailable. Run npm run audio:build; continuing in text mode."));
      return undefined;
    }
    const child = spawn(this.helperPath, [mode], { stdio: ["pipe", "pipe", "pipe"] });
    child.stderr.on("data", (chunk) => this.onError(new Error(String(chunk).trim())));
    child.on("error", this.onError);
    return child;
  }
}
