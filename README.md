# AI-rail-voice CLI

A macOS-first diagnostic CLI for OpenAI Realtime rail-voice sessions. It keeps one revisioned journey context, traces every protocol event, and supports text, microphone input, streamed speaker output, manual station changes, and reproducible scenarios.

## Requirements

- Node.js 22 or newer
- macOS with Xcode Command Line Tools (`swiftc`)
- `OPENAI_API_KEY`

```bash
npm install
cp .env.example .env
npm run audio:build
npm start
```

The CLI stays usable in text mode if the audio helper is not built or microphone permission is denied. Type `/help` for commands. JSONL traces are written under `traces/` by default.

## Verification

```bash
npm test
npm run build
npm run audio:build
```

Live tests consume API quota and only run explicitly with `npm run smoke:live`.

Station stories remain placeholder seed content and require verified editorial sources before production.
