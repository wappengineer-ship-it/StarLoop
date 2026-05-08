const ui = {
  nameInput: document.getElementById("nameInput"),
  joinButton: document.getElementById("joinButton"),
  zoneValue: document.getElementById("zoneValue"),
  planetValue: document.getElementById("planetValue"),
  playersValue: document.getElementById("playersValue"),
  statusValue: document.getElementById("statusValue"),
  transitionOverlay: document.getElementById("transitionOverlay"),
  transitionTitle: document.getElementById("transitionTitle"),
  transitionSubtitle: document.getElementById("transitionSubtitle")
};

const socket = io();
ui.nameInput.value = localStorage.getItem("starloop.playerName") || "";
const GAME_WIDTH = 1280;
const GAME_HEIGHT = 720;

const gameState = {
  connected: false,
  self: null,
  planets: [],
  players: new Map(),
  velocity: {
    x: 0,
    y: 0
  },
  keys: {
    left: false,
    right: false,
    up: false,
    down: false
  },
  transitionTimer: null,
  lastMoveSentAt: 0
};

function setStatus(text) {
  ui.statusValue.textContent = text;
}

function getPlanetTheme(planetId) {
  if (planetId === "solara") {
    return {
      skyTop: 0x4d2f0d,
      skyBottom: 0xd5884f,
      horizon: 0xf8c98e,
      ground: 0xb06b3f,
      groundDetail: 0x7f492b,
      decor: 0xf1d282,
      label: "Amber dunes and warm light"
    };
  }

  if (planetId === "mira") {
    return {
      skyTop: 0x0f4152,
      skyBottom: 0x47b8b5,
      horizon: 0xbef9ec,
      ground: 0x2f7e66,
      groundDetail: 0x1e5b49,
      decor: 0xa9fff1,
      label: "Cool sea-glow and soft mist"
    };
  }

  return {
    skyTop: 0x23133d,
    skyBottom: 0x6f5fb6,
    horizon: 0xe1d8ff,
    ground: 0x5b4b87,
    groundDetail: 0x3f335f,
    decor: 0xd8ceff,
    label: "Dusky violet stone and pale stars"
  };
}

function getPlanetLandmarks(planetId) {
  if (planetId === "solara") {
    return [
      { x: 120, kind: "spire" },
      { x: 360, kind: "crystal" },
      { x: 640, kind: "spire" },
      { x: 930, kind: "arch" },
      { x: 1220, kind: "crystal" }
    ];
  }

  if (planetId === "mira") {
    return [
      { x: 180, kind: "mushroom" },
      { x: 440, kind: "mushroom" },
      { x: 760, kind: "arch" },
      { x: 1080, kind: "mushroom" },
      { x: 1420, kind: "crystal" }
    ];
  }

  return [
    { x: 160, kind: "crystal" },
    { x: 510, kind: "arch" },
    { x: 820, kind: "spire" },
    { x: 1110, kind: "crystal" },
    { x: 1380, kind: "arch" }
  ];
}

function wrapSurfaceDelta(delta, surfaceLength) {
  if (delta > surfaceLength / 2) {
    return delta - surfaceLength;
  }
  if (delta < -surfaceLength / 2) {
    return delta + surfaceLength;
  }
  return delta;
}

function showTransition(title, subtitle, duration = 900) {
  clearTimeout(gameState.transitionTimer);
  ui.transitionTitle.textContent = title;
  ui.transitionSubtitle.textContent = subtitle;
  ui.transitionOverlay.classList.remove("hidden");

  gameState.transitionTimer = window.setTimeout(() => {
    ui.transitionOverlay.classList.add("hidden");
  }, duration);
}

function switchScene(targetScene) {
  if (targetScene === "space") {
    game.scene.stop("planet");
    if (!game.scene.isActive("space")) {
      game.scene.start("space");
    }
    return;
  }

  game.scene.stop("space");
  if (!game.scene.isActive("planet")) {
    game.scene.start("planet");
  }
}

function tryLand() {
  if (!gameState.self || gameState.self.zoneType !== "space") {
    return;
  }

  const planet = gameState.planets.find((entry) => {
    const distance = Phaser.Math.Distance.Between(
      gameState.self.x,
      gameState.self.y,
      entry.spaceX,
      entry.spaceY
    );
    return distance <= entry.radius;
  });

  if (!planet) {
    setStatus("Fly into a planet circle before landing.");
    return;
  }

  const dx = gameState.self.x - planet.spaceX;
  const dy = gameState.self.y - planet.spaceY;
  const angle = Math.atan2(dy, dx);
  const normalizedAngle = ((angle + Math.PI) / (Math.PI * 2) + 0.25) % 1;
  const surfaceX = normalizedAngle * planet.surfaceLength;

  socket.emit("player:land", {
    planetId: planet.id,
    surfaceX
  });
  setStatus(`Landing on ${planet.name} at a mapped surface position.`);
}

function tryTakeoff() {
  if (!gameState.self || gameState.self.zoneType !== "planet") {
    return;
  }

  socket.emit("player:takeoff", {
    planetId: gameState.self.zoneId
  });
  setStatus(`Taking off from ${gameState.self.zoneId}.`);
}

function updateSidebar() {
  if (!gameState.self) {
    ui.zoneValue.textContent = "Offline";
    ui.planetValue.textContent = "None";
    ui.playersValue.textContent = "0";
    return;
  }

  ui.zoneValue.textContent = gameState.self.zoneType;
  ui.planetValue.textContent =
    gameState.self.zoneType === "planet" ? gameState.self.zoneId : "None";

  let visibleCount = 0;
  for (const player of gameState.players.values()) {
    if (
      player.id !== gameState.self.id &&
      player.zoneType === gameState.self.zoneType &&
      player.zoneId === gameState.self.zoneId
    ) {
      visibleCount += 1;
    }
  }
  ui.playersValue.textContent = String(visibleCount);
}

function upsertPlayer(player) {
  const existing = gameState.players.get(player.id);
  const nextPlayer = existing
    ? {
        ...existing,
        ...player,
        renderX: player.id === gameState.self?.id ? player.x : existing.renderX ?? player.x,
        renderY: player.id === gameState.self?.id ? player.y : existing.renderY ?? player.y,
        targetX: player.x,
        targetY: player.y
      }
    : {
        ...player,
        renderX: player.x,
        renderY: player.y,
        targetX: player.x,
        targetY: player.y
      };

  gameState.players.set(player.id, nextPlayer);
  if (gameState.self && player.id === gameState.self.id) {
    gameState.self = { ...player };
  }
  updateSidebar();
}

function maybeSendMove(payload) {
  const now = performance.now();
  if (now - gameState.lastMoveSentAt < 75) {
    return;
  }

  gameState.lastMoveSentAt = now;
  socket.emit("player:move", payload);
}

class SpaceScene extends Phaser.Scene {
  constructor() {
    super("space");
    this.ship = null;
    this.otherShips = new Map();
    this.starfield = [];
    this.nebulas = [];
  }

  create() {
    this.starfield = [];
    for (let i = 0; i < 120; i += 1) {
      this.starfield.push({
        x: Phaser.Math.Between(0, 1280),
        y: Phaser.Math.Between(0, 720),
        size: Phaser.Math.FloatBetween(1, 2.8),
        alpha: Phaser.Math.FloatBetween(0.35, 0.95)
      });
    }

    this.nebulas = [
      { x: 220, y: 170, radius: 180, color: 0x17406b, alpha: 0.28 },
      { x: 930, y: 520, radius: 220, color: 0x3c2061, alpha: 0.18 },
      { x: 1060, y: 180, radius: 140, color: 0x0d5d66, alpha: 0.14 }
    ];

    this.cameras.main.setBackgroundColor("#07111f");
  }

  update() {
    if (!gameState.self || gameState.self.zoneType !== "space") {
      return;
    }

    const acceleration = 0.24;
    const maxSpeed = 4.4;
    const drag = 0.92;

    if (gameState.keys.left) {
      gameState.velocity.x -= acceleration;
    }
    if (gameState.keys.right) {
      gameState.velocity.x += acceleration;
    }
    if (gameState.keys.up) {
      gameState.velocity.y -= acceleration;
    }
    if (gameState.keys.down) {
      gameState.velocity.y += acceleration;
    }

    gameState.velocity.x = Phaser.Math.Clamp(gameState.velocity.x * drag, -maxSpeed, maxSpeed);
    gameState.velocity.y = Phaser.Math.Clamp(gameState.velocity.y * drag, -maxSpeed, maxSpeed);

    const moving =
      Math.abs(gameState.velocity.x) > 0.03 || Math.abs(gameState.velocity.y) > 0.03;

    if (moving) {
      gameState.self.x = Phaser.Math.Clamp(gameState.self.x + gameState.velocity.x, 0, 1280);
      gameState.self.y = Phaser.Math.Clamp(gameState.self.y + gameState.velocity.y, 0, 720);
      gameState.self.direction = gameState.velocity.x < 0 ? "left" : "right";
      maybeSendMove({
        x: gameState.self.x,
        y: gameState.self.y,
        direction: gameState.self.direction
      });
      updateSidebar();
    }

    this.renderWorld();
  }

  renderWorld() {
    this.children.removeAll(true);

    const width = GAME_WIDTH;
    const height = GAME_HEIGHT;
    const time = this.time.now;
    const driftX = gameState.self ? gameState.self.x * 0.03 : 0;
    const driftY = gameState.self ? gameState.self.y * 0.03 : 0;

    this.add.rectangle(width / 2, height / 2, width, height, 0x050b16);
    this.add.rectangle(width / 2, 120, width, 260, 0x0a1730, 0.85);
    this.add.rectangle(width / 2, height - 110, width, 260, 0x08111f, 0.95);

    for (const nebula of this.nebulas) {
      this.add.circle(
        nebula.x - driftX,
        nebula.y - driftY,
        nebula.radius,
        nebula.color,
        nebula.alpha
      );
    }

    for (let i = 0; i < this.starfield.length; i += 1) {
      const star = this.starfield[i];
      const twinkle = 0.55 + 0.35 * Math.sin(time / 600 + i);
      let starX = star.x - driftX * (0.2 + (i % 4) * 0.06);
      let starY = star.y - driftY * (0.2 + (i % 5) * 0.05);

      if (starX < 0) starX += width;
      if (starX > width) starX -= width;
      if (starY < 0) starY += height;
      if (starY > height) starY -= height;

      this.add.circle(starX, starY, star.size, 0xffffff, star.alpha * twinkle);
    }

    for (const planet of gameState.planets) {
      const color =
        planet.theme === "amber"
          ? 0xf6bd60
          : planet.theme === "teal"
          ? 0x84dcc6
          : 0xb8a1ff;

      this.add.circle(planet.spaceX, planet.spaceY, planet.radius + 18, color, 0.12);
      this.add.circle(planet.spaceX, planet.spaceY, planet.radius + 8, color, 0.2);
      this.add.circle(planet.spaceX, planet.spaceY, planet.radius, color, 0.96);

      if (planet.theme === "amber") {
        this.add.ellipse(planet.spaceX, planet.spaceY + 8, planet.radius * 1.9, 24, 0xffdf9a, 0.22);
      }
      if (planet.theme === "teal") {
        this.add.circle(planet.spaceX - 18, planet.spaceY - 18, planet.radius * 0.28, 0xbffff3, 0.22);
      }
      if (planet.theme === "violet") {
        this.add.ellipse(planet.spaceX + 8, planet.spaceY - 8, planet.radius * 1.55, 18, 0xe6d5ff, 0.18);
      }

      this.add.text(planet.spaceX - planet.radius, planet.spaceY + planet.radius + 14, planet.name, {
        color: "#ffffff",
        fontSize: "14px"
      });
    }

    if (gameState.self?.zoneType === "space") {
      this.drawShip(gameState.self.x, gameState.self.y, 0x8de4ff, gameState.self.direction, true);

      const landingPlanet = gameState.planets.find((planet) => {
        const distance = Phaser.Math.Distance.Between(
          gameState.self.x,
          gameState.self.y,
          planet.spaceX,
          planet.spaceY
        );
        return distance <= planet.radius;
      });

      if (landingPlanet) {
        this.add.text(gameState.self.x - 56, gameState.self.y - 42, `Press L to land on ${landingPlanet.name}`, {
          color: "#dffbff",
          fontSize: "14px",
          backgroundColor: "#0f2138"
        }).setPadding(8, 4, 8, 4);
      }
    }

    for (const player of gameState.players.values()) {
      if (player.id === gameState.self?.id || player.zoneType !== "space") {
        continue;
      }

      player.renderX = Phaser.Math.Linear(player.renderX ?? player.x, player.targetX ?? player.x, 0.25);
      player.renderY = Phaser.Math.Linear(player.renderY ?? player.y, player.targetY ?? player.y, 0.25);

      this.drawShip(player.renderX, player.renderY, 0xffd56b, player.direction, false);
      this.add.text(player.renderX - 20, player.renderY - 26, player.name, {
        color: "#ffffff",
        fontSize: "12px"
      });
    }

    this.add.text(28, 28, "Shared Universe", {
      color: "#dff7ff",
      fontSize: "26px"
    });
    this.add.text(28, 58, "Fly into a planet and press L to land", {
      color: "#95afcf",
      fontSize: "15px"
    });
  }

  drawShip(x, y, color, direction, isSelf) {
    const points =
      direction === "left"
        ? [-16, 0, 10, -10, 10, 10]
        : [16, 0, -10, -10, -10, 10];

    this.add.polygon(x, y, points, color, 0.98);
    this.add.rectangle(x, y, 10, 8, isSelf ? 0xe8fcff : 0xfff0bf, 0.95);
    this.add.circle(x, y, 2.5, 0x08111f, 0.95);

    if (isSelf) {
      const thrusterX = direction === "left" ? x + 12 : x - 12;
      const flamePoints =
        direction === "left"
          ? [0, 0, 12, -5, 12, 5]
          : [0, 0, -12, -5, -12, 5];
      this.add.polygon(thrusterX, y, flamePoints, 0xffb347, 0.75);
    }
  }
}

class PlanetScene extends Phaser.Scene {
  constructor() {
    super("planet");
  }

  create() {}

  update() {
    if (!gameState.self || gameState.self.zoneType !== "planet") {
      return;
    }

    const speed = 4;
    const currentPlanet = gameState.planets.find(
      (planet) => planet.id === gameState.self.zoneId
    );

    if (!currentPlanet) {
      return;
    }

    let dx = 0;
    if (gameState.keys.left) {
      dx -= speed;
    }
    if (gameState.keys.right) {
      dx += speed;
    }

    if (dx !== 0) {
      gameState.self.x += dx;
      if (gameState.self.x < 0) {
        gameState.self.x += currentPlanet.surfaceLength;
      }
      if (gameState.self.x >= currentPlanet.surfaceLength) {
        gameState.self.x -= currentPlanet.surfaceLength;
      }
      gameState.self.direction = dx < 0 ? "left" : "right";
      maybeSendMove({
        x: gameState.self.x,
        y: 0,
        direction: gameState.self.direction
      });
      updateSidebar();
    }

    this.renderWorld(currentPlanet);
  }

  renderWorld(planet) {
    this.children.removeAll(true);

    const width = GAME_WIDTH;
    const height = GAME_HEIGHT;
    const playerScreenX = width / 2;
    const selfSurfaceX = gameState.self.x;
    const theme = getPlanetTheme(planet.id);
    const hillScroll = (selfSurfaceX * 0.35) % 180;
    const lowerHillScroll = (selfSurfaceX * 0.6) % 220;

    const skyGradient = this.add.graphics();
    skyGradient.fillGradientStyle(
      theme.skyTop,
      theme.skyTop,
      theme.skyBottom,
      theme.skyBottom,
      1
    );
    skyGradient.fillRect(0, 0, width, height);

    this.add.ellipse(width / 2, 280, 950, 220, theme.horizon, 0.32);
    this.add.ellipse(width / 2, 320, 1220, 170, 0xffffff, 0.08);

    for (let i = 0; i < 14; i += 1) {
      const x = (i * 103 + 30) % width;
      const y = 70 + (i % 4) * 28;
      this.add.circle(x, y, 2, 0xffffff, 0.55);
    }

    this.drawGroundBand(
      [
        { x: -220, y: 450 },
        { x: -100, y: 424 },
        { x: 20, y: 442 },
        { x: 160, y: 414 },
        { x: 320, y: 430 },
        { x: 470, y: 405 },
        { x: 630, y: 432 },
        { x: 780, y: 416 },
        { x: 920, y: 440 },
        { x: 1060, y: 420 },
        { x: 1200, y: 446 },
        { x: 1360, y: 418 }
      ],
      -hillScroll,
      180,
      theme.ground,
      height
    );

    this.drawGroundBand(
      [
        { x: -260, y: 490 },
        { x: -80, y: 470 },
        { x: 80, y: 500 },
        { x: 240, y: 476 },
        { x: 460, y: 510 },
        { x: 640, y: 482 },
        { x: 830, y: 514 },
        { x: 1020, y: 490 },
        { x: 1200, y: 520 },
        { x: 1420, y: 486 }
      ],
      -lowerHillScroll,
      220,
      theme.groundDetail,
      height
    );

    const landmarks = getPlanetLandmarks(planet.id);
    for (const landmark of landmarks) {
      const delta = wrapSurfaceDelta(landmark.x - selfSurfaceX, planet.surfaceLength);

      const screenX = playerScreenX + delta;
      if (screenX < -80 || screenX > width + 80) {
        continue;
      }

      this.drawLandmark(screenX, 430, landmark.kind, theme);
    }

    this.add.text(30, 28, `${planet.name} surface`, {
      color: "#ffffff",
      fontSize: "24px"
    });
    this.add.text(30, 58, theme.label, {
      color: "#eef7ff",
      fontSize: "14px"
    });
    this.add.text(30, 84, "Press T to take off", {
      color: "#d6e4f5",
      fontSize: "14px"
    });
    this.add.text(30, 110, `Surface position ${Math.round(selfSurfaceX)}`, {
      color: "#d6e4f5",
      fontSize: "14px"
    });

    this.drawWalker(playerScreenX, 430, 0x8de4ff, gameState.self.direction);

    for (const player of gameState.players.values()) {
      if (player.id === gameState.self.id) {
        continue;
      }
      if (player.zoneType !== "planet" || player.zoneId !== planet.id) {
        continue;
      }

      const targetX = player.targetX ?? player.x;
      player.renderX =
        player.renderX == null
          ? targetX
          : Phaser.Math.Linear(player.renderX, targetX, 0.22);
      const delta = wrapSurfaceDelta(player.renderX - selfSurfaceX, planet.surfaceLength);

      const screenX = playerScreenX + delta;
      if (screenX < -40 || screenX > width + 40) {
        continue;
      }

      this.drawWalker(screenX, 430, 0xffd56b, player.direction);
      this.add.text(screenX - 24, 395, player.name, {
        color: "#ffffff",
        fontSize: "12px"
      });
    }
  }

  drawWalker(x, groundY, color, direction) {
    this.add.ellipse(x, groundY + 10, 34, 10, 0x000000, 0.18);
    this.add.rectangle(x, groundY - 8, 18, 30, color, 0.98);
    this.add.circle(x, groundY - 30, 9, color, 0.98);
    const faceX = direction === "left" ? x - 2 : x + 2;
    this.add.circle(faceX, groundY - 31, 2, 0x101c2d, 0.95);
  }

  drawLandmark(x, groundY, kind, theme) {
    if (kind === "spire") {
      this.add.rectangle(x, groundY - 18, 12, 36, theme.decor, 0.85);
      this.add.triangle(x, groundY - 42, 0, 12, 10, 0, 20, 12, theme.decor, 0.85);
      return;
    }

    if (kind === "crystal") {
      this.add.polygon(x, groundY - 18, [0, -26, 14, 0, 0, 22, -14, 0], theme.decor, 0.82);
      return;
    }

    if (kind === "mushroom") {
      this.add.rectangle(x, groundY - 12, 8, 24, theme.decor, 0.85);
      this.add.ellipse(x, groundY - 30, 34, 18, theme.horizon, 0.82);
      return;
    }

    this.add.rectangle(x - 16, groundY - 12, 10, 24, theme.decor, 0.8);
    this.add.rectangle(x + 16, groundY - 12, 10, 24, theme.decor, 0.8);
    this.add.rectangle(x, groundY - 30, 42, 8, theme.decor, 0.8);
  }

  drawGroundBand(points, offsetX, repeatWidth, color, height) {
    for (let repeat = -1; repeat <= 8; repeat += 1) {
      const shifted = [];
      for (const point of points) {
        shifted.push(point.x + offsetX + repeat * repeatWidth, point.y);
      }
      shifted.push(
        points[points.length - 1].x + offsetX + repeat * repeatWidth,
        height,
        points[0].x + offsetX + repeat * repeatWidth,
        height
      );
      this.add.polygon(0, 0, shifted, color, 1).setOrigin(0, 0);
    }
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  parent: "game",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT
  },
  scene: [SpaceScene, PlanetScene]
});

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === "arrowleft" || key === "a") {
    gameState.keys.left = true;
  }
  if (key === "arrowright" || key === "d") {
    gameState.keys.right = true;
  }
  if (key === "arrowup" || key === "w") {
    gameState.keys.up = true;
  }
  if (key === "arrowdown" || key === "s") {
    gameState.keys.down = true;
  }
  if (key === "l") {
    tryLand();
  }
  if (key === "t") {
    tryTakeoff();
  }
});

window.addEventListener("keyup", (event) => {
  const key = event.key.toLowerCase();
  if (key === "arrowleft" || key === "a") {
    gameState.keys.left = false;
  }
  if (key === "arrowright" || key === "d") {
    gameState.keys.right = false;
  }
  if (key === "arrowup" || key === "w") {
    gameState.keys.up = false;
  }
  if (key === "arrowdown" || key === "s") {
    gameState.keys.down = false;
  }
});

ui.joinButton.addEventListener("click", () => {
  const storedId = localStorage.getItem("starloop.playerId") || crypto.randomUUID();
  localStorage.setItem("starloop.playerId", storedId);

  socket.emit(
    "player:join",
    {
      playerId: storedId,
      name: ui.nameInput.value
    },
    (response) => {
      if (!response?.ok) {
        setStatus(response?.error || "Failed to join.");
        return;
      }

      gameState.connected = true;
      gameState.self = response.self;
      gameState.planets = response.planets;
      gameState.lastMoveSentAt = 0;
      localStorage.setItem("starloop.playerName", ui.nameInput.value);
      gameState.players.clear();
      gameState.players.set(response.self.id, response.self);
      for (const player of response.players) {
        gameState.players.set(player.id, player);
      }

      updateSidebar();
      setStatus("Connected to the shared universe.");
      showTransition("Starloop", "Entering the shared universe", 1000);
      switchScene(response.self.zoneType === "planet" ? "planet" : "space");
    }
  );
});

socket.on("player:joined", (player) => {
  upsertPlayer(player);
});

socket.on("player:updated", (player) => {
  const previousSelf = gameState.self ? { ...gameState.self } : null;
  upsertPlayer(player);

  if (gameState.self?.id === player.id) {
    const zoneChanged =
      !previousSelf ||
      previousSelf.zoneType !== player.zoneType ||
      previousSelf.zoneId !== player.zoneId;

    if (!zoneChanged) {
      return;
    }

    if (player.zoneType === "space") {
      if (previousSelf && previousSelf.zoneType !== "space") {
        showTransition("Takeoff", "Leaving the planet surface", 900);
      }
      switchScene("space");
    } else {
      const planet = gameState.planets.find((entry) => entry.id === player.zoneId);
      showTransition(
        planet ? planet.name : "Planetfall",
        planet ? `Landing on ${planet.name}` : "Entering planet orbit",
        1000
      );
      switchScene("planet");
    }
  }
});

socket.on("player:left", ({ id }) => {
  gameState.players.delete(id);
  updateSidebar();
});

socket.on("connect", () => {
  setStatus("Socket connected. Join when ready.");
});

socket.on("disconnect", () => {
  setStatus("Disconnected from server.");
});
