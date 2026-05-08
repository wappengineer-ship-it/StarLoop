# Starloop

Starter project for a shared-universe multiplayer browser game.

## Stack
- Express
- Socket.IO
- PostgreSQL
- Phaser 3
- Render

## Local setup
1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` if you want persistence.
3. Start the server:
   `npm start`
4. Open:
   `http://localhost:10000`

## Current prototype
- Shared top-down space scene
- Planet landing
- Shared side-on looping planet scene
- Realtime movement sync
- Optional Postgres-backed player persistence

## Deployment notes
- Render web services must listen on `0.0.0.0`.
- Render Postgres should be connected through `DATABASE_URL`.
- The included `render.yaml` is a starter blueprint, not a final production setup.
