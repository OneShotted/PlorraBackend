const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

const TICK_RATE = 50;
const MOB_SPAWN_INTERVAL = 1000;

let players = {};
let mobs = {};
let petalsOnGround = {};
let nextPlayerId = 1;
let nextMobId = 1;
let nextPetalId = 1;

const MOB_TYPES = {
  WANDERER: { maxHp: 20, speed: 2, shape: 'circle', color: 'yellow', damage: 5 },
  CHASER: { maxHp: 30, speed: 3, shape: 'triangle', color: 'orange', damage: 7 }
};

function randomPosition() {
  return {
    x: Math.random() * 2000 - 1000,
    y: Math.random() * 2000 - 1000
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
    lastHitBy: {} // { petalId: timestamp }
  };
  mobs[mob.id] = mob;
}

function spawnPetalOnGround(petal) {
  petalsOnGround[nextPetalId] = {
    ...petal,
    id: nextPetalId++,
    x: petal.x,
    y: petal.y
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
    inventory: [],
    hotbar: []
  };

  socket.send(JSON.stringify({ type: 'init', id: playerId }));

  socket.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === 'join') {
        players[playerId].username = data.username;
        players[playerId].inventory = new Array(10).fill(null).map(() => ({
          id: nextPetalId++,
          type: 'basic',
          damage: 5,
          hp: 100,
          color: 'cyan',
          angle: 0,
          cooldown: 0
        }));
        players[playerId].hotbar = [null, null, null, null, null];
      }

      else if (data.type === 'move') {
        if (players[playerId]) {
          players[playerId].x = data.x;
          players[playerId].y = data.y;
        }
      }

      else if (data.type === 'updateInventory') {
        if (players[playerId]) {
          players[playerId].hotbar = data.hotbar;
          players[playerId].inventory = data.inventory;
        }
      }

      else if (data.type === 'attackTick') {
        const player = players[playerId];
        if (!player) return;

        const now = Date.now();
        player.hotbar.forEach((petal) => {
          if (!petal || petal.hp <= 0) return;

          for (const mid in mobs) {
            const mob = mobs[mid];
            const dist = Math.hypot(player.x - mob.x, player.y - mob.y);
            if (dist < 60) {
              const lastHit = mob.lastHitBy[petal.id] || 0;
              if (now - lastHit >= 1000) {
                mob.hp -= petal.damage;
                mob.lastHitBy[petal.id] = now;

                petal.hp = 0;
                setTimeout(() => {
                  if (player.hotbar.includes(petal)) petal.hp = 100;
                }, 1000);

                if (mob.hp <= 0) {
                  spawnPetalOnGround({
                    type: 'basic',
                    damage: 5,
                    color: 'cyan',
                    angle: 0,
                    x: mob.x,
                    y: mob.y
                  });
                  delete mobs[mid];
                }
              }
            }
          }
        });
      }
    } catch (e) {
      console.error('Error:', e);
    }
  });

  socket.on('close', () => delete players[playerId]);
});

function updateMobs() {
  for (const id in mobs) {
    const mob = mobs[id];
    if (mob.type === 'WANDERER') {
      mob.x += (Math.random() - 0.5) * mob.speed;
      mob.y += (Math.random() - 0.5) * mob.speed;
    } else {
      let nearest = null, nearestDist = Infinity;
      for (const pid in players) {
        const p = players[pid];
        const dist = Math.hypot(p.x - mob.x, p.y - mob.y);
        if (dist < nearestDist) {
          nearest = p;
          nearestDist = dist;
        }
      }
      if (nearest) {
        const dx = nearest.x - mob.x;
        const dy = nearest.y - mob.y;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          mob.x += (dx / len) * mob.speed;
          mob.y += (dy / len) * mob.speed;
        }

        if (nearestDist < 30) {
          nearest.hp -= mob.damage;
          if (nearest.hp < 0) nearest.hp = 0;
        }
      }
    }
  }
}

setInterval(() => {
  spawnMob('WANDERER');
  spawnMob('CHASER');
}, MOB_SPAWN_INTERVAL);

setInterval(() => {
  updateMobs();
  const snapshot = JSON.stringify({
    type: 'state',
    players,
    mobs,
    petalsOnGround
  });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(snapshot);
  });
}, TICK_RATE);


