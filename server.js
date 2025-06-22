const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

const TICK_RATE = 50;
const MOB_SPAWN_INTERVAL = 1000; // ms

// Player and Mob Data
let players = {};
let mobs = {};
let petalsOnGround = {};
let nextPlayerId = 1;
let nextMobId = 1;
let nextPetalId = 1;

// Mob types
const MOB_TYPES = {
  WANDERER: {
    maxHp: 20,
    speed: 2,
    shape: 'circle',
    color: 'yellow',
    damage: 5,
  },
  CHASER: {
    maxHp: 30,
    speed: 3,
    shape: 'triangle',
    color: 'orange',
    damage: 7,
  }
};

function randomPosition() {
  return {
    x: Math.random() * 2000 - 1000,
    y: Math.random() * 2000 - 1000,
  };
}

function spawnMob(typeKey) {
  const type = MOB_TYPES[typeKey];
  const pos = randomPosition();
  const mob = {
    id: nextMobId++,
    type: typeKey,
    x: pos.x,
    y: pos.y,
    hp: type.maxHp,
    maxHp: type.maxHp,
    speed: type.speed,
    shape: type.shape,
    color: type.color,
    damage: type.damage,
    targetPlayerId: null,
  };
  mobs[mob.id] = mob;
}

function spawnPetalOnGround(petal) {
  const pos = randomPosition();
  petalsOnGround[nextPetalId] = {
    ...petal,
    id: nextPetalId++,
    x: pos.x,
    y: pos.y,
  };
}

wss.on('connection', (socket) => {
  let playerId = nextPlayerId++;

  players[playerId] = {
    id: playerId,
    username: '',
    x: 0,
    y: 0,
    hp: 100,
    maxHp: 100,
    inventory: new Array(10).fill(null).map(() => ({
      id: nextPetalId++,
      type: 'basic',
      damage: 5,
      color: 'cyan',
      angle: 0,
    })),
    hotbar: [null, null, null, null, null]
  };

  socket.send(JSON.stringify({ type: 'init', id: playerId }));

  socket.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === 'join') {
        players[playerId].username = data.username;
      }
      else if (data.type === 'move') {
        if (players[playerId]) {
          players[playerId].x = data.x;
          players[playerId].y = data.y;
        }
      }
      else if (data.type === 'updateInventory') {
        // For security, validate here
        // This example trusts the client (for simplicity), but you should verify in production.
        if (players[playerId]) {
          players[playerId].hotbar = data.hotbar;
          players[playerId].inventory = data.inventory;
        }
      }
      else if (data.type === 'attackMob') {
        const mob = mobs[data.mobId];
        const player = players[playerId];
        if (mob && player) {
          mob.hp -= data.damage;
          if (mob.hp <= 0) {
            // Drop petals on death
            spawnPetalOnGround({
              type: 'basic',
              damage: 5,
              color: 'cyan',
              angle: 0,
            });
            delete mobs[mob.id];
          }
        }
      }
    } catch (e) {
      console.error('Error processing message:', e);
    }
  });

  socket.on('close', () => {
    delete players[playerId];
  });
});

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Mob AI update loop
function updateMobs() {
  for (const id in mobs) {
    const mob = mobs[id];
    if (mob.type === 'WANDERER') {
      // Random movement
      mob.x += (Math.random() - 0.5) * mob.speed;
      mob.y += (Math.random() - 0.5) * mob.speed;
    } else if (mob.type === 'CHASER') {
      // Chase nearest player
      let nearest = null;
      let nearestDist = Infinity;
      for (const pid in players) {
        const p = players[pid];
        const dist = distance(p, mob);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = p;
        }
      }
      if (nearest) {
        const dx = nearest.x - mob.x;
        const dy = nearest.y - mob.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          mob.x += (dx / len) * mob.speed;
          mob.y += (dy / len) * mob.speed;
        }
      }
    }

    // Check collision with players to damage
    for (const pid in players) {
      const p = players[pid];
      if (distance(p, mob) < 30) { // collision radius approx
        p.hp -= mob.damage;
        if (p.hp < 0) p.hp = 0;
      }
    }
  }
}

// Spawn mobs periodically
setInterval(() => {
  spawnMob('WANDERER');
  spawnMob('CHASER');
}, MOB_SPAWN_INTERVAL);

// Broadcast game state loop
setInterval(() => {
  updateMobs();

  const state = {
    type: 'state',
    players,
    mobs,
    petalsOnGround,
  };

  const msg = JSON.stringify(state);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}, TICK_RATE);

