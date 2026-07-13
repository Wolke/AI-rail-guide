# AI Rail Guide

PWA MVP for a dynamic AI rail companion. The first route is a TRA Pingxi Line demo using foreground GPS, OpenAI Realtime voice, and static seed content.

## Features

- React + TypeScript + Vite PWA.
- Foreground GPS tracking with `navigator.geolocation.watchPosition()`.
- OpenAI Realtime WebRTC voice session through a protected backend-created client secret.
- Text fallback when no OpenAI key, microphone permission, or WebRTC connection is available.
- Static route, station, story, and POI seed data for the Pingxi Line.
- IndexedDB persistence for the latest journey state.

## Setup

```bash
npm install
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env` for Realtime voice. Without it, the app still runs in text fallback mode.

## Development

```bash
npm run dev
```

- Client: http://localhost:5173
- API: http://localhost:8787

GPS and microphone APIs work on `localhost` during development. For device testing, serve the app over HTTPS.

## Verification

```bash
npm run test
npm run build
```

## MVP Constraints

- Background GPS is not a PWA acceptance target.
- PTX timetable integration is intentionally deferred.
- Seed stories are placeholders and should be replaced with verified editorial sources before production.
