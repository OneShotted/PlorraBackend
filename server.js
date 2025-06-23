import WebSocket, { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

console.log(`Petal.io backend running on port ${PORT}`);

const players = new Map();
const enemies = new Map();
const projectiles = new Map();
const teams = new Map();

const SAFE_ZONE_RADIUS = 200;
const MAP_SIZE = 3000;

const PETAL_TYPES = ["basic", "rock", "fire", "ice", "poison", "electric", "shield"];

function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Enemy spawn helper
function spawnEnemy(type) {
  const id = uuidv4();
  const x = randRange(-MAP_SIZE, MAP_SIZE);
  const y = randRange(-MAP_SIZE, MAP_SIZE);
  let enemy = {
    id,
    type,
    x,
    y,
    hp: type === "miniboss" ? 150 : type === "spinner" ? 60 : type === "chaser" ? 40 : 20,
    maxHp: 150,
    vx: 0,
    vy: 0,
    orbitAngle: 0,
    targetPlayerId: null,
    petals: [],
    lastAttackTime: 0,
    dead: false,
    size: type === "miniboss" ? 40 : type === "spinner" ? 25 : 15,
  };
  enemies.set(id, enemy);
}

// Initialize enemies every 3 seconds
setInterval(() => {
  if (enemies.size < 50) {
    const types = ["wanderer", "chaser", "spinner"];
    spawnEnemy(types[Math.floor(Math.random() * types.length)]);
  }
  if (Math.random() < 0.01) {
    spawnEnemy("miniboss");
  }
}, 3000);

// Remove dead enemies every 5 seconds
setInterval(() => {
  for (const [id, e] of enemies) {
    if (e.dead) enemies.delete(id);
  }
}, 5000);

// Player template
function createNewPlayer(ws) {
  const id = uuidv4();
  const player = {
    id,
    ws,
    x: randRange(-MAP_SIZE / 2, MAP_SIZE / 2),
    y: randRange(-MAP_SIZE / 2, MAP_SIZE / 2),
    vx: 0,
    vy: 0,
    speed: 200,
    hp: 100,
    maxHp: 100,
    level: 1,
    xp: 0,
    coins: 0,
    petals: [
      { type: "basic", tier: 1, hp: 20, maxHp: 20, cooldown: 0, broken: false },
      { type: "basic", tier: 1, hp: 20, maxHp: 20, cooldown: 0, broken: false },
      { type: "basic", tier: 1, hp: 20, maxHp: 20, cooldown: 0, broken: false },
    ],
    inventory: [], // Extra petals stored
    petalSlots: 3,
    orbitRadius: 50,
    orbitSpeed: 1.5,
    retracting: false,
    team: null,
    inSafeZone: false,
    name: "Anonymous",
    lastHitTime: 0,
    dead: false,
    respawnTimer: 0,
  };
  players.set(id, player);
  return player;
}

function broadcast(data) {
  const json = JSON.stringify(data);
  for (const p of players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(json);
  }
}

function sendToPlayer(player, data) {
  if (player.ws.readyState === WebSocket.OPEN) {
    player.ws.send(JSON.stringify(data));
  }
}

// Game loop — runs 30 times per second
const TICK_RATE = 30;
setInterval(() => {
  const now = Date.now();

  // Update players movement & status
  for (const player of players.values()) {
    if (player.dead) {
      player.respawnTimer -= 1 / TICK_RATE;
      if (player.respawnTimer <= 0) {
        player.dead = false;
        player.hp = player.maxHp;
        player.x = randRange(-MAP_SIZE / 2, MAP_SIZE / 2);
        player.y = randRange(-MAP_SIZE / 2, MAP_SIZE / 2);
        sendToPlayer(player, { type: "respawn" });
      }
      continue;
    }

    // Movement clamped inside map
    player.x = Math.min(Math.max(player.x + player.vx / TICK_RATE, -MAP_SIZE), MAP_SIZE);
    player.y = Math.min(Math.max(player.y + player.vy / TICK_RATE, -MAP_SIZE), MAP_SIZE);

    // Check safe zone
    player.inSafeZone = player.x * player.x + player.y * player.y < SAFE_ZONE_RADIUS * SAFE_ZONE_RADIUS;

    // Petals cooldowns & regeneration
    player.petals.forEach((petal) => {
      if (petal.broken) {
        petal.cooldown -= 1 / TICK_RATE;
        if (petal.cooldown <= 0) {
          petal.broken = false;
          petal.hp = petal.maxHp;
          petal.cooldown = 0;
        }
      }
    });
  }

  // Enemies AI movement & attacking players
  for (const enemy of enemies.values()) {
    if (enemy.dead) continue;
    if (enemy.type === "wanderer") {
      enemy.vx += randRange(-1, 1);
      enemy.vy += randRange(-1, 1);
      enemy.vx *= 0.9;
      enemy.vy *= 0.9;
      enemy.x += enemy.vx / TICK_RATE;
      enemy.y += enemy.vy / TICK_RATE;
    } else if (enemy.type === "chaser") {
      // Find closest player
      let closest = null;
      let minDist = Infinity;
      for (const p of players.values()) {
        if (p.dead) continue;
        const d = dist(p, enemy);
        if (d < minDist) {
          minDist = d;
          closest = p;
        }
      }
      if (closest) {
        const dx = closest.x - enemy.x;
        const dy = closest.y - enemy.y;
        const len = Math.max(Math.hypot(dx, dy), 0.001);
        enemy.vx = (dx / len) * 120;
        enemy.vy = (dy / len) * 120;
        enemy.x += enemy.vx / TICK_RATE;
        enemy.y += enemy.vy / TICK_RATE;

        // Attack if close
        if (minDist < 30 && now - enemy.lastAttackTime > 1000) {
          enemy.lastAttackTime = now;
          closest.hp -= 15;
          if (closest.hp <= 0) {
            closest.dead = true;
            closest.respawnTimer = 5;
            // Drop petals on death
            closest.inventory = [];
          }
        }
      }
    } else if (enemy.type === "spinner") {
      enemy.orbitAngle += 0.1;
      enemy.x += Math.cos(enemy.orbitAngle) * 1.5;
      enemy.y += Math.sin(enemy.orbitAngle) * 1.5;
    } else if (enemy.type === "miniboss") {
      // Miniboss moves slow toward center and attacks players with petal break attack
      let closest = null;
      let minDist = Infinity;
      for (const p of players.values()) {
        if (p.dead) continue;
        const d = dist(p, enemy);
        if (d < minDist) {
          minDist = d;
          closest = p;
        }
      }
      if (closest) {
        const dx = closest.x - enemy.x;
        const dy = closest.y - enemy.y;
        const len = Math.max(Math.hypot(dx, dy), 0.001);
        enemy.vx = (dx / len) * 50;
        enemy.vy = (dy / len) * 50;
        enemy.x += enemy.vx / TICK_RATE;
        enemy.y += enemy.vy / TICK_RATE;

        if (minDist < 50 && now - enemy.lastAttackTime > 2000) {
          enemy.lastAttackTime = now;
          // Break random petal on player
          if (closest.petals.length > 0) {
            const idx = Math.floor(Math.random() * closest.petals.length);
            const petal = closest.petals[idx];
            if (!petal.broken) {
              petal.broken = true;
              petal.cooldown = 5;
              petal.hp = 0;
            }
          }
          closest.hp -= 30;
          if (closest.hp <= 0) {
            closest.dead = true;
            closest.respawnTimer = 5;
            closest.inventory = [];
          }
        }
      }
    }
  }

  // Broadcast game state (only necessary data)
  const snapshot = {
    type: "update",
    players: [],
    enemies: [],
  };

  for (const p of players.values()) {
    snapshot.players.push({
      id: p.id,
      x: p.x,
      y: p.y,
      hp: p.hp,
      maxHp: p.maxHp,
      level: p.level,
      xp: p.xp,
      coins: p.coins,
      petals: p.petals.map(pet => ({
        type: pet.type,
        tier: pet.tier,
        hp: pet.hp,
        maxHp: pet.maxHp,
        broken: pet.broken,
      })),
      petalSlots: p.petalSlots,
      orbitRadius: p.orbitRadius,
      orbitSpeed: p.orbitSpeed,
      name: p.name,
      dead: p.dead,
      inSafeZone: p.inSafeZone,
      team: p.team,
      inventoryCount: p.inventory.length,
    });
  }
  for (const e of enemies.values()) {
    snapshot.enemies.push({
      id: e.id,
      x: e.x,
      y: e.y,
      hp: e.hp,
      maxHp: e.maxHp,
      type: e.type,
      dead: e.dead,
      size: e.size,
    });
  }

  broadcast(snapshot);
}, 1000 / TICK_RATE);

wss.on("connection", (ws) => {
  console.log("New player connected");
  const player = createNewPlayer(ws);

  // Send initial player id & welcome message
  sendToPlayer(player, { type: "welcome", id: player.id });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === "input") {
        if (player.dead) return;
        // Input contains movement vector and petal commands
        player.vx = data.vx * player.speed;
        player.vy = data.vy * player.speed;

        // Handle petal retraction toggle
        if (typeof data.retract === "boolean") player.retracting = data.retract;

        // Handle inventory actions (add/drop/combine petals)
        if (data.action) {
          handleInventoryAction(player, data.action, data.payload);
        }
      } else if (data.type === "setName") {
        player.name = sanitizeString(data.name);
      }
    } catch (e) {
      console.error("Invalid message", e);
    }
  });

  ws.on("close", () => {
    console.log(`Player ${player.id} disconnected`);
    players.delete(player.id);
  });
});

function sanitizeString(str) {
  return String(str).replace(/[^a-zA-Z0-9 _-]/g, "").substring(0, 15);
}

function handleInventoryAction(player, action, payload) {
  if (action === "addPetal" && payload) {
    // Add new petal to inventory, max 50
    if (player.inventory.length < 50) {
      player.inventory.push({
        type: payload.type,
        tier: 1,
        hp: 20,
        maxHp: 20,
        broken: false,
        cooldown: 0,
      });
    }
  } else if (action === "dropPetal" && typeof payload.index === "number") {
    player.inventory.splice(payload.index, 1);
  } else if (action === "combinePetals" && Array.isArray(payload.indices)) {
    // Combine 3 petals of same type and tier into next tier
    const inds = payload.indices.sort((a, b) => a - b);
    if (inds.length !== 3) return;
    const petalsToCombine = inds.map(i => player.inventory[i]).filter(Boolean);
    if (petalsToCombine.length !== 3) return;

    const first = petalsToCombine[0];
    if (!petalsToCombine.every(p => p.type === first.type && p.tier === first.tier)) return;

    // Remove petals from inventory (from end to start)
    for (let i = inds.length - 1; i >= 0; i--) {
      player.inventory.splice(inds[i], 1);
    }

    // Add combined petal with tier+1 max 3
    if (first.tier < 3) {
      player.inventory.push({
        type: first.type,
        tier: first.tier + 1,
        hp: 20 + first.tier * 10,
        maxHp: 20 + first.tier * 10,
        broken: false,
        cooldown: 0,
      });
    }
  }
}

