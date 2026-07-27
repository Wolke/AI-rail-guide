#!/usr/bin/env node
import "dotenv/config";
import { createInterface } from "node:readline";
import { MacAudioController } from "./audio";
import { JourneyContextStore, formatContext, type JourneyContextPhase } from "./context";
import { RealtimeCliClient } from "./realtime";
import { runScenario, scenarioNames } from "./scenarios";
import { SessionTrace } from "./trace";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  process.stderr.write("OPENAI_API_KEY is required. Copy .env.example to .env and set a server API key.\n");
  process.exit(1);
}

const store = new JourneyContextStore();
const trace = new SessionTrace();
const tracePath = await trace.start(store.snapshot().journeyId);
let textLineOpen = false;

const audio = new MacAudioController(
  (chunk) => client.appendMicrophoneAudio(chunk),
  (error) => printError(error)
);
const client = new RealtimeCliClient({
  apiKey,
  trace,
  getSnapshot: () => store.snapshot(),
  onAudio: (chunk) => audio.play(chunk),
  onOutputCleared: () => audio.clearPlayback(),
  onText: (delta) => {
    if (!textLineOpen) {
      process.stdout.write("\nAI: ");
      textLineOpen = true;
    }
    process.stdout.write(delta);
  },
  onTranscript: (text) => process.stdout.write(`\nYOU (mic): ${text}\n> `),
  onError: printError
});

const readline = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
process.stdout.write(`AI-rail-voice CLI\nTrace: ${tracePath}\nAudio: ${audio.available() ? "ready" : "not built (text mode available)"}\nType /help for commands.\n`);
readline.prompt();

let commandQueue = Promise.resolve();
readline.on("line", (line) => {
  commandQueue = commandQueue.then(() => handleLine(line)).catch(printError).finally(() => {
    textLineOpen = false;
    readline.prompt();
  });
});
readline.on("SIGINT", () => void shutdown());
readline.on("close", () => void shutdown());

async function handleLine(raw: string): Promise<void> {
  const line = raw.trim();
  if (!line) return;
  try {
    if (!line.startsWith("/")) {
      ensureConnected();
      client.sendPassengerText(line);
      return;
    }
    const [command, ...args] = line.slice(1).split(/\s+/);
    switch (command) {
      case "help":
        printHelp();
        break;
      case "connect":
        await client.connect();
        process.stdout.write("Connected.\n");
        break;
      case "disconnect":
        audio.close();
        client.disconnect();
        process.stdout.write("Disconnected.\n");
        break;
      case "start": {
        await connectIfNeeded();
        const snapshot = store.update({ phase: "traveling", source: "manual" });
        await client.updateContext(snapshot);
        client.sendGuide(snapshot);
        break;
      }
      case "station": {
        requireArg(args[0], "station id");
        await applyContext(store.moveTo(args[0], "manual"));
        break;
      }
      case "next": {
        requireArg(args[0], "station id or none");
        await applyContext(store.update({ nextStationId: args[0] === "none" ? undefined : args[0], source: "manual" }));
        break;
      }
      case "phase": {
        const phase = args[0] as JourneyContextPhase;
        if (!["idle", "traveling", "narrating", "answering_question", "paused", "completed"].includes(phase)) throw new Error("Invalid phase");
        await applyContext(store.update({ phase, source: "manual" }));
        break;
      }
      case "segment": {
        const index = Number(args[0]);
        await applyContext(store.update({ guideSegmentIndex: index, source: "manual" }));
        break;
      }
      case "run":
        requireArg(args[0], "scenario name");
        await connectIfNeeded();
        await runScenario(args[0], store, client);
        break;
      case "context":
        process.stdout.write(`${JSON.stringify(store.snapshot(), null, 2)}\n`);
        break;
      case "mic":
        if (args[0] === "on") audio.startMicrophone();
        else if (args[0] === "off") audio.stopMicrophone();
        else throw new Error("Usage: /mic on|off");
        break;
      case "mute":
        audio.mute();
        break;
      case "unmute":
        audio.unmute();
        break;
      case "cancel":
        client.cancelActive();
        break;
      case "events":
        if (args[0] !== "on" && args[0] !== "off") throw new Error("Usage: /events on|off");
        trace.setVisible(args[0] === "on");
        break;
      case "quit":
        await shutdown();
        break;
      default:
        throw new Error(`Unknown command: /${command}`);
    }
  } catch (error) {
    printError(error instanceof Error ? error : new Error(String(error)));
  }
}

async function applyContext(snapshot: ReturnType<JourneyContextStore["snapshot"]>): Promise<void> {
  if (client.isConnected()) await client.updateContext(snapshot);
  process.stdout.write(`${formatContext(snapshot)}\n`);
}

async function connectIfNeeded(): Promise<void> {
  if (!client.isConnected()) await client.connect();
}

function ensureConnected(): void {
  if (!client.isConnected()) throw new Error("Not connected. Run /connect first.");
}

function requireArg(value: string | undefined, label: string): asserts value is string {
  if (!value) throw new Error(`Missing ${label}`);
}

function printError(error: Error): void {
  process.stderr.write(`\nERROR: ${error.message}\n> `);
}

function printHelp(): void {
  process.stdout.write(`
/connect                 connect to OpenAI Realtime
/disconnect              close Realtime and audio processes
/start                   start the current station guide
/station <id>            move to a station and increment context revision
/next <id|none>          set the next station
/phase <phase>           set journey phase
/segment <index>         set zero-based guide segment
/run <scenario>          run: ${scenarioNames.join(", ")}
/context                 print the authoritative snapshot
/mic on|off              start or stop live microphone PCM
/mute | /unmute          control streamed speaker output
/cancel                  cancel response and clear playback
/events on|off           show or hide protocol events (trace always records)
/quit                    exit
Plain text sends a passenger message.
`);
}

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  audio.close();
  client.disconnect();
  readline.close();
  process.stdout.write("\nClosed.\n");
  process.exit(0);
}
