import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import type { JourneyContextSnapshot } from "./context";

export type TraceDirection = "client" | "server" | "local";

export interface TraceRecord {
  timestamp: string;
  direction: TraceDirection;
  type: string;
  eventId?: string;
  responseId?: string;
  correlationId?: string;
  contextRevision?: number;
  currentStationId?: string;
  detail?: unknown;
}

export class SessionTrace {
  private path?: string;
  private eventsVisible = true;

  constructor(private readonly directory = process.env.AI_RAIL_TRACE_DIR ?? "traces") {}

  async start(journeyId: string): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    this.path = join(this.directory, `${new Date().toISOString().replaceAll(":", "-")}-${journeyId}.jsonl`);
    return this.path;
  }

  setVisible(visible: boolean): void {
    this.eventsVisible = visible;
  }

  async record(direction: TraceDirection, type: string, options: Omit<TraceRecord, "timestamp" | "direction" | "type"> = {}): Promise<void> {
    const record: TraceRecord = { timestamp: new Date().toISOString(), direction, type, ...sanitize(options) };
    if (this.eventsVisible) {
      const tags = [direction.padEnd(6), type, record.contextRevision == null ? "" : `rev=${record.contextRevision}`, record.currentStationId ? `station=${record.currentStationId}` : "", record.correlationId ? `corr=${record.correlationId}` : ""].filter(Boolean);
      process.stdout.write(`\n[${record.timestamp}] ${tags.join(" ")}\n> `);
    }
    if (!this.path) return;
    const file = await open(this.path, "a");
    try {
      await file.write(`${JSON.stringify(record)}\n`);
    } finally {
      await file.close();
    }
  }
}

export function contextTrace(snapshot: JourneyContextSnapshot) {
  return { contextRevision: snapshot.revision, currentStationId: snapshot.currentStationId };
}

function sanitize<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  const copy = JSON.parse(JSON.stringify(value, (key, item) => {
    if (/api.?key|authorization|audio/i.test(key)) return "[redacted]";
    if (typeof item === "string" && item.length > 500) return `${item.slice(0, 500)}…`;
    return item;
  }));
  return copy as T;
}
