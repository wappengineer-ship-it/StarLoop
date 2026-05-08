const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { initDb, loadPlayer, savePlayer } = require("./db");

const PORT = Number(process.env.PORT) || 10000;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const planets = [
  {
    id: "solara",
    name: "Solara",
    spaceX: 300,
    spaceY: 260,
    radius: 70,
    surfaceLength: 1600,
    theme: "amber"
  },
  {
    id: "mira",
    name: "Mira",
    spaceX: 760,
    spaceY: 440,
    radius: 80,
    surfaceLength: 1900,
    theme: "teal"
  },
  {
    id: "noctis",
    name: "Noctis",
    spaceX: 1120,
    spaceY: 180,
    radius: 62,
    surfaceLength: 1500,
    theme: "violet"
  }
];

const players = new Map();

function getPlanetById(id) {
  return planets.find((planet) => planet.id === id) || null;
}

function sanitizeName(name) {
  const trimmed = String(name || "").trim().slice(0, 20);
  return trimmed || "Pilot";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildInitialPlayer(id, name) {
  return {
    id,
    name: sanitizeName(name),
    zoneType: "space",
    zoneId: "space",
    x: 120,
    y: 120,
    direction: "right"
  };
}

function serializePlayer(player) {
  return {
    id: player.id,
    name: player.name,
    zoneType: player.zoneType,
    zoneId: player.zoneId,
    x: player.x,
    y: player.y,
    direction: player.direction
  };
}

function getVisiblePlayersFor(player) {
  return [...players.values()]
    .filter((other) => other.id !== player.id)
    .filter(
      (other) =>
        other.zoneType === player.zoneType && other.zoneId === player.zoneId
    )
    .map(serializePlayer);
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    players: players.size,
    planets: planets.length
  });
});

io.on("connection", (socket) => {
  socket.on("player:join", async (payload = {}, ack) => {
    try {
      const playerId = String(payload.playerId || socket.id);
      const saved = await loadPlayer(playerId);
      const player = saved
        ? {
            id: saved.id,
            name: sanitizeName(payload.name || saved.name),
            zoneType: saved.zone_type,
            zoneId: saved.zone_id,
            x: Number(saved.x),
            y: Number(saved.y),
            direction: saved.direction || "right"
          }
        : buildInitialPlayer(playerId, payload.name);

      players.set(socket.id, player);
      socket.data.playerId = player.id;

      ack?.({
        ok: true,
        self: serializePlayer(player),
        planets,
        players: getVisiblePlayersFor(player)
      });

      socket.broadcast.emit("player:joined", serializePlayer(player));
      await savePlayer(player);
    } catch (error) {
      console.error("join failed", error);
      ack?.({ ok: false, error: "Failed to join world." });
    }
  });

  socket.on("player:move", async (payload = {}) => {
    const player = players.get(socket.id);
    if (!player) {
      return;
    }

    if (player.zoneType === "space") {
      player.x = clamp(Number(payload.x) || player.x, 0, 1400);
      player.y = clamp(Number(payload.y) || player.y, 0, 800);
    } else {
      const planet = getPlanetById(player.zoneId);
      if (!planet) {
        return;
      }

      const nextX = Number(payload.x);
      player.x = Number.isFinite(nextX) ? nextX : player.x;
      if (player.x < 0) {
        player.x += planet.surfaceLength;
      }
      if (player.x >= planet.surfaceLength) {
        player.x -= planet.surfaceLength;
      }
      player.y = 0;
    }

    player.direction = payload.direction === "left" ? "left" : "right";

    io.emit("player:updated", serializePlayer(player));
  });

  socket.on("player:land", async (payload = {}) => {
    const player = players.get(socket.id);
    const planet = getPlanetById(payload.planetId);
    if (!player || !planet) {
      return;
    }

    player.zoneType = "planet";
    player.zoneId = planet.id;
    player.x = Number(payload.surfaceX) || 0;
    player.y = 0;

    await savePlayer(player);
    io.emit("player:updated", serializePlayer(player));
  });

  socket.on("player:takeoff", async (payload = {}) => {
    const player = players.get(socket.id);
    const planet = getPlanetById(payload.planetId);
    if (!player || !planet) {
      return;
    }

    player.zoneType = "space";
    player.zoneId = "space";
    player.x = planet.spaceX + planet.radius + 24;
    player.y = planet.spaceY;

    await savePlayer(player);
    io.emit("player:updated", serializePlayer(player));
  });

  socket.on("disconnect", async () => {
    const player = players.get(socket.id);
    if (!player) {
      return;
    }

    players.delete(socket.id);
    io.emit("player:left", { id: player.id });
    await savePlayer(player);
  });
});

async function start() {
  await initDb();

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Starloop server running on http://0.0.0.0:${PORT}`);
  });
}

start().catch((error) => {
  console.error("failed to start", error);
  process.exit(1);
});
