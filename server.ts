import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { buildOpenSourcePackageEntries, buildZipBuffer } from './server/zipBuilder.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_CHARACTERS = new Set([
  'jarvin',
  'joaquin',
  'armagedon',
  'fedex',
  'crash',
  'jason',
  'lucia',
  'jarvin_exe',
  'n_tropy',
  'penta_penguin',
  'falso_jarvin',
  'celular_kart',
  'pc_gamer',
]);
const VALID_MODES = new Set(['adventure', 'arcade', 'timetrial', 'relic', 'madness', 'elimination', 'tokens', 'online']);
const HIGHSCORES_FILE = path.resolve(__dirname, 'data/highscores.json');
const VALID_TRACKS = new Set([
  'jarvin_city',
  'dragon_mines',
  'mystery_caves',
  'crash_cove',
  'cortex_castle',
  'wumpa_jungle',
  'sunset_canyon',
  'arctic_glacier',
  'neon_metropolis',
  'space_orbit',
  'armagedon_volcano',
  'oxide_station',
  'tiger_temple',
  'papu_pyramid',
  'ngin_labs',
  'vice_city_beach',
  'sewer_speedway',
  'blizzard_bluff',
  'hot_air_skyway',
  'coco_park',
  'dingo_canyon',
  'slide_coliseum',
  'roo_tubes',
  'turbo_track',
  'skull_rock_cove',
  'cortex_reactor',
  'dragon_palace',
  'wumpa_falls',
  'freeze_fjord',
  'galaxy_oxide_finale',
]);
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

interface KartCustomizationDTO {
  bodyColor: string;
  rimColor: string;
  neonColor: string;
}

interface OnlinePlayerDTO {
  id: string;
  name: string;
  characterId: string;
  customization: KartCustomizationDTO;
  ready: boolean;
  isHost: boolean;
  slotIndex: number;
}

interface TelemetryDTO {
  id: string;
  isAI?: boolean;
  characterId?: string;
  name?: string;
  customization?: KartCustomizationDTO;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  speed: number;
  steerAngle: number;
  nearestT: number;
  lap: number;
  maxProgress: number;
  turboActiveTimer: number;
  akuAkuTimer: number;
  shieldTimer: number;
  spinoutTimer: number;
  stunTimer: number;
  heldItem: string | null;
  finished: boolean;
  finishTimeMs: number;
}

interface ServerRoom {
  code: string;
  trackId: string;
  laps: number;
  includeAI: boolean;
  aiCount: number;
  status: 'lobby' | 'racing' | 'finished';
  hostId: string;
  players: Map<string, { info: OnlinePlayerDTO; ws: WebSocket }>;
  telemetry: Map<string, TelemetryDTO>;
  createdAt: number;
}

function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/[<>]/g, '').trim().slice(0, 20);
  return cleaned || fallback;
}

interface HighscoreRecord {
  id: string;
  clientId: string;
  playerName: string;
  trackId: string;
  characterId: string;
  mode: string;
  timeMs: number;
  isMobile: boolean;
  createdAt: number;
}

function loadHighscores(): HighscoreRecord[] {
  try {
    if (!fs.existsSync(HIGHSCORES_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(HIGHSCORES_FILE, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is HighscoreRecord =>
        Boolean(r) &&
        typeof r.id === 'string' &&
        typeof r.playerName === 'string' &&
        typeof r.trackId === 'string' &&
        typeof r.timeMs === 'number' &&
        Number.isFinite(r.timeMs),
    );
  } catch {
    return [];
  }
}

function saveHighscores(records: HighscoreRecord[]): void {
  try {
    const dir = path.dirname(HIGHSCORES_FILE);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${HIGHSCORES_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf8');
    fs.renameSync(tmp, HIGHSCORES_FILE);
  } catch (err) {
    console.warn('No se pudo guardar highscores.json:', err);
  }
}

function sanitizeCharacter(raw: unknown): string {
  return typeof raw === 'string' && VALID_CHARACTERS.has(raw) ? raw : 'jarvin';
}

function sanitizeTrack(raw: unknown): string {
  return typeof raw === 'string' && VALID_TRACKS.has(raw) ? raw : 'jarvin_city';
}

function sanitizeCustomization(raw: unknown): KartCustomizationDTO {
  const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    bodyColor: typeof obj.bodyColor === 'string' && HEX_COLOR_RE.test(obj.bodyColor) ? obj.bodyColor : '#16a34a',
    rimColor: typeof obj.rimColor === 'string' && HEX_COLOR_RE.test(obj.rimColor) ? obj.rimColor : '#facc15',
    neonColor: typeof obj.neonColor === 'string' && HEX_COLOR_RE.test(obj.neonColor) ? obj.neonColor : '#22c55e',
  };
}

function sanitizeRoomCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function generateRoomCode(rooms: Map<string, ServerRoom>): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 25; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return `JK${Date.now().toString(36).toUpperCase().slice(-4)}`;
}

function serializeRoom(room: ServerRoom) {
  const players = Array.from(room.players.values())
    .map((p) => p.info)
    .sort((a, b) => a.slotIndex - b.slotIndex);
  return {
    code: room.code,
    trackId: room.trackId,
    laps: room.laps,
    includeAI: room.includeAI,
    aiCount: room.aiCount,
    status: room.status,
    hostId: room.hostId,
    players,
  };
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastRoom(room: ServerRoom, payload: unknown, excludePlayerId?: string): void {
  const encoded = JSON.stringify(payload);
  for (const [pid, entry] of room.players.entries()) {
    if (excludePlayerId && pid === excludePlayerId) continue;
    if (entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.send(encoded);
    }
  }
}

function getOpenRoomsSummary(rooms: ServerRoom[]) {
  return rooms
    .filter((r) => r.status === 'lobby' && r.players.size < 4)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 12)
    .map((r) => {
      const host = r.players.get(r.hostId)?.info;
      return {
        code: r.code,
        trackId: r.trackId,
        laps: r.laps,
        playerCount: r.players.size,
        maxPlayers: 4,
        hostName: host?.name ?? 'Anfitrión',
      };
    });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  const rooms = new Map<string, ServerRoom>();
  let highscoresCache: HighscoreRecord[] = loadHighscores();

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, activeRooms: rooms.size });
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: getOpenRoomsSummary(Array.from(rooms.values())) });
  });

  let cachedOpenSourceZip: Buffer | null = null;
  app.get('/api/download/opensource.zip', (_req, res) => {
    if (!cachedOpenSourceZip) {
      const entries = buildOpenSourcePackageEntries(__dirname);
      cachedOpenSourceZip = buildZipBuffer(entries);
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="JarvinKartTurbo_CodigoLibre.zip"');
    res.setHeader('Content-Length', String(cachedOpenSourceZip.length));
    res.send(cachedOpenSourceZip);
  });

  app.get('/api/highscores', (req, res) => {
    const trackFilter = typeof req.query.trackId === 'string' ? req.query.trackId : '';
    const modeFilter = typeof req.query.mode === 'string' ? req.query.mode : '';
    let filtered = highscoresCache;
    if (trackFilter && trackFilter !== 'all') {
      filtered = filtered.filter((r) => r.trackId === trackFilter);
    }
    if (modeFilter && modeFilter !== 'all') {
      filtered = filtered.filter((r) => r.mode === modeFilter);
    }
    const sorted = [...filtered].sort((a, b) => a.timeMs - b.timeMs).slice(0, 100);
    res.json({ entries: sorted });
  });

  app.post('/api/highscores', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const trackId = typeof body.trackId === 'string' && VALID_TRACKS.has(body.trackId) ? body.trackId : '';
    const characterId = typeof body.characterId === 'string' && VALID_CHARACTERS.has(body.characterId) ? body.characterId : '';
    const mode = typeof body.mode === 'string' && VALID_MODES.has(body.mode) ? body.mode : 'arcade';
    const timeMs = typeof body.timeMs === 'number' && Number.isFinite(body.timeMs) ? Math.round(body.timeMs) : 0;
    if (!trackId || !characterId || timeMs < 10000 || timeMs > 3600000) {
      res.status(400).json({ error: 'Datos de récord inválidos.' });
      return;
    }
    const playerName = sanitizeName(body.playerName, 'Corredor');
    const clientIdRaw = typeof body.clientId === 'string' ? body.clientId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) : '';
    const clientId = clientIdRaw || 'anon';
    const entry: HighscoreRecord = {
      id: `hs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      clientId,
      playerName,
      trackId,
      characterId,
      mode,
      timeMs,
      isMobile: Boolean(body.isMobile),
      createdAt: Date.now(),
    };
    highscoresCache.push(entry);
    highscoresCache = highscoresCache.sort((a, b) => a.timeMs - b.timeMs).slice(0, 500);
    saveHighscores(highscoresCache);
    res.json({
      ok: true,
      entry,
      entries: highscoresCache.filter((r) => r.trackId === trackId).slice(0, 100),
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 32 * 1024,
  });

  server.on('upgrade', (req, socket, head) => {
    const reqUrl = req.url ?? '';
    if (reqUrl.startsWith('/ws')) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
  });

  // Periodic authoritative snapshot broadcast (20 Hz) for active racing rooms
  setInterval(() => {
    for (const room of rooms.values()) {
      if (room.status !== 'racing' || room.telemetry.size === 0) continue;
      broadcastRoom(room, {
        type: 'race:snapshot',
        karts: Array.from(room.telemetry.values()),
      });
    }
  }, 50);

  wss.on('connection', (ws) => {
    let joinedRoomCode: string | null = null;
    let playerId: string | null = null;

    const leaveCurrentRoom = () => {
      if (!joinedRoomCode || !playerId) return;
      const room = rooms.get(joinedRoomCode);
      if (room) {
        room.players.delete(playerId);
        room.telemetry.delete(playerId);
        if (room.players.size === 0) {
          rooms.delete(joinedRoomCode);
        } else {
          if (room.hostId === playerId) {
            const nextHost = Array.from(room.players.values())[0];
            if (nextHost) {
              room.hostId = nextHost.info.id;
              nextHost.info.isHost = true;
            }
          }
          // Recompute slot indices cleanly
          Array.from(room.players.values()).forEach((p, idx) => {
            p.info.slotIndex = idx;
          });
          broadcastRoom(room, { type: 'room:state', room: serializeRoom(room) });
        }
      }
      joinedRoomCode = null;
      playerId = null;
    };

    ws.on('close', leaveCurrentRoom);

    ws.on('message', (rawBuf) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(rawBuf.toString('utf8')) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = msg.type;
      if (typeof type !== 'string') return;

      if (type === 'rooms:list') {
        sendJson(ws, {
          type: 'rooms:list',
          rooms: getOpenRoomsSummary(Array.from(rooms.values())),
        });
        return;
      }

      if (type === 'room:create') {
        leaveCurrentRoom();
        const code = generateRoomCode(rooms);
        const pid = `on_${Math.random().toString(36).slice(2, 10)}`;
        const playerInfo: OnlinePlayerDTO = {
          id: pid,
          name: sanitizeName(msg.name, 'Jugador 1'),
          characterId: sanitizeCharacter(msg.characterId),
          customization: sanitizeCustomization(msg.customization),
          ready: true,
          isHost: true,
          slotIndex: 0,
        };
        const aiCntRaw = typeof msg.aiCount === 'number' ? Math.round(msg.aiCount) : 2;
        const aiCount = Math.max(0, Math.min(3, aiCntRaw));
        const room: ServerRoom = {
          code,
          trackId: sanitizeTrack(msg.trackId),
          laps: typeof msg.laps === 'number' ? Math.max(1, Math.min(5, Math.round(msg.laps))) : 3,
          includeAI: typeof msg.includeAI === 'boolean' ? msg.includeAI : aiCount > 0,
          aiCount,
          status: 'lobby',
          hostId: pid,
          players: new Map([[pid, { info: playerInfo, ws }]]),
          telemetry: new Map(),
          createdAt: Date.now(),
        };
        rooms.set(code, room);
        joinedRoomCode = code;
        playerId = pid;
        sendJson(ws, { type: 'room:joined', playerId: pid, room: serializeRoom(room) });
        return;
      }

      if (type === 'room:join') {
        const code = sanitizeRoomCode(msg.code);
        const room = rooms.get(code);
        if (!room) {
          sendJson(ws, { type: 'room:error', message: `No existe ninguna sala con el código ${code || 'indicado'}.` });
          return;
        }
        if (room.players.size >= 4) {
          sendJson(ws, { type: 'room:error', message: 'La sala está llena (máximo 4 corredores online).' });
          return;
        }
        if (room.status === 'racing') {
          sendJson(ws, { type: 'room:error', message: 'La carrera en esta sala ya comenzó.' });
          return;
        }
        leaveCurrentRoom();
        const pid = `on_${Math.random().toString(36).slice(2, 10)}`;
        const slotIndex = room.players.size;
        const playerInfo: OnlinePlayerDTO = {
          id: pid,
          name: sanitizeName(msg.name, `Jugador ${slotIndex + 1}`),
          characterId: sanitizeCharacter(msg.characterId),
          customization: sanitizeCustomization(msg.customization),
          ready: true,
          isHost: false,
          slotIndex,
        };
        room.players.set(pid, { info: playerInfo, ws });
        joinedRoomCode = code;
        playerId = pid;
        const serialized = serializeRoom(room);
        sendJson(ws, { type: 'room:joined', playerId: pid, room: serialized });
        broadcastRoom(room, { type: 'room:state', room: serialized }, pid);
        return;
      }

      if (type === 'room:leave') {
        leaveCurrentRoom();
        return;
      }

      if (!joinedRoomCode || !playerId) return;
      const room = rooms.get(joinedRoomCode);
      if (!room) return;
      const me = room.players.get(playerId);
      if (!me) return;

      if (type === 'room:update_player') {
        if (typeof msg.name === 'string') me.info.name = sanitizeName(msg.name, me.info.name);
        if (typeof msg.characterId === 'string') me.info.characterId = sanitizeCharacter(msg.characterId);
        if (msg.customization) me.info.customization = sanitizeCustomization(msg.customization);
        if (typeof msg.ready === 'boolean') me.info.ready = msg.ready;
        broadcastRoom(room, { type: 'room:state', room: serializeRoom(room) });
        return;
      }

      if (type === 'room:update_settings') {
        if (room.hostId !== playerId) return;
        if (typeof msg.trackId === 'string') room.trackId = sanitizeTrack(msg.trackId);
        if (typeof msg.laps === 'number') room.laps = Math.max(1, Math.min(5, Math.round(msg.laps)));
        if (typeof msg.aiCount === 'number') {
          room.aiCount = Math.max(0, Math.min(3, Math.round(msg.aiCount)));
          room.includeAI = room.aiCount > 0;
        }
        if (typeof msg.includeAI === 'boolean') {
          room.includeAI = msg.includeAI;
          if (!room.includeAI) room.aiCount = 0;
        }
        broadcastRoom(room, { type: 'room:state', room: serializeRoom(room) });
        return;
      }

      if (type === 'room:start') {
        if (room.hostId !== playerId) return;
        room.status = 'racing';
        room.telemetry.clear();
        broadcastRoom(room, {
          type: 'race:start',
          room: serializeRoom(room),
          startedAt: Date.now(),
        });
        return;
      }

      if (type === 'room:back_to_lobby') {
        if (room.hostId !== playerId) return;
        room.status = 'lobby';
        room.telemetry.clear();
        broadcastRoom(room, { type: 'room:state', room: serializeRoom(room) });
        return;
      }

      if (type === 'race:telemetry') {
        const finiteOrZero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
        const sanitizeTelemetry = (raw: TelemetryDTO, forcedId: string, isAI: boolean): TelemetryDTO => ({
          id: forcedId,
          isAI,
          characterId: typeof raw.characterId === 'string' ? sanitizeCharacter(raw.characterId) : undefined,
          name: typeof raw.name === 'string' ? sanitizeName(raw.name, forcedId) : undefined,
          customization: raw.customization ? sanitizeCustomization(raw.customization) : undefined,
          x: finiteOrZero(raw.x),
          y: finiteOrZero(raw.y),
          z: finiteOrZero(raw.z),
          vx: finiteOrZero(raw.vx),
          vy: finiteOrZero(raw.vy),
          vz: finiteOrZero(raw.vz),
          heading: finiteOrZero(raw.heading),
          speed: finiteOrZero(raw.speed),
          steerAngle: finiteOrZero(raw.steerAngle),
          nearestT: finiteOrZero(raw.nearestT),
          lap: Math.max(1, Math.min(10, Math.round(finiteOrZero(raw.lap) || 1))),
          maxProgress: finiteOrZero(raw.maxProgress),
          turboActiveTimer: Math.max(0, Math.min(15, finiteOrZero(raw.turboActiveTimer))),
          akuAkuTimer: Math.max(0, Math.min(20, finiteOrZero(raw.akuAkuTimer))),
          shieldTimer: Math.max(0, Math.min(20, finiteOrZero(raw.shieldTimer))),
          spinoutTimer: Math.max(0, Math.min(10, finiteOrZero(raw.spinoutTimer))),
          stunTimer: Math.max(0, Math.min(10, finiteOrZero(raw.stunTimer))),
          heldItem:
            typeof raw.heldItem === 'string' &&
            ['aku_aku', 'homing_rocket', 'tnt', 'potion', 'turbo_boost', 'shield', 'bolt', 'shockwave', 'bowling_bomb', 'warp_orb', 'time_clock'].includes(raw.heldItem)
              ? raw.heldItem
              : null,
          finished: Boolean(raw.finished),
          finishTimeMs: Math.max(0, finiteOrZero(raw.finishTimeMs)),
        });

        const selfT = msg.kart as TelemetryDTO | undefined;
        if (selfT && typeof selfT.x === 'number' && Number.isFinite(selfT.x) && typeof selfT.z === 'number' && Number.isFinite(selfT.z)) {
          room.telemetry.set(playerId, sanitizeTelemetry(selfT, playerId, false));
        }
        if (room.hostId === playerId && Array.isArray(msg.aiKarts)) {
          for (const ai of (msg.aiKarts as TelemetryDTO[]).slice(0, 4)) {
            if (ai && typeof ai.id === 'string' && /^ai_[0-3]$/.test(ai.id) && typeof ai.x === 'number' && Number.isFinite(ai.x)) {
              room.telemetry.set(ai.id, sanitizeTelemetry(ai, ai.id, true));
            }
          }
        }
        return;
      }

      if (type === 'race:attack') {
        const attackType = typeof msg.attackType === 'string' ? msg.attackType : '';
        if (!['homing_rocket', 'bolt', 'shockwave', 'aku_aku_ram', 'bowling_bomb', 'warp_orb', 'time_clock'].includes(attackType)) return;
        const finiteOrZero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
        broadcastRoom(
          room,
          {
            type: 'race:attack_event',
            senderId: playerId,
            attackType,
            targetId: typeof msg.targetId === 'string' ? msg.targetId.slice(0, 32) : undefined,
            x: finiteOrZero(msg.x),
            y: finiteOrZero(msg.y),
            z: finiteOrZero(msg.z),
            heading: finiteOrZero(msg.heading),
          },
          playerId,
        );
        return;
      }

      if (type === 'race:player_finished') {
        const cur = room.telemetry.get(playerId);
        if (cur) {
          cur.finished = true;
          cur.finishTimeMs = typeof msg.finishTimeMs === 'number' ? msg.finishTimeMs : cur.finishTimeMs;
        }
        const allHumansDone = Array.from(room.players.keys()).every(
          (pid) => room.telemetry.get(pid)?.finished,
        );
        if (allHumansDone) {
          room.status = 'finished';
        }
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Jarvin Kart Turbo 3D server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
