import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Crown,
  Globe,
  Lock,
  LogIn,
  Play,
  Plus,
  RefreshCw,
  Users,
  X,
} from 'lucide-react';
import type { CharacterId, KartCustomization, OnlineRoomState, PlayableCharacterId } from '../game/types';
import type { OpenRoomSummary } from '../game/onlineClient';
import { CHARACTERS, CHARACTER_MAP, TRACKS } from '../game/constants';
import { PUBLIC_GAME_URL } from './AppDownloadModal';
import { CharacterExpressionAvatar } from './CharacterExpressionAvatar';

interface OnlineLobbyModalProps {
  isOpen: boolean;
  connected: boolean;
  room: OnlineRoomState | null;
  playerId: string | null;
  openRooms: OpenRoomSummary[];
  errorMessage: string | null;
  initialJoinCode?: string;
  unlockedCharacters: PlayableCharacterId[];
  defaultCharacterId: CharacterId;
  defaultCustomization: KartCustomization;
  defaultTrackId: string;
  defaultLaps: number;
  onClose: () => void;
  onRefreshRooms: () => void;
  onCreateRoom: (params: {
    name: string;
    characterId: CharacterId;
    customization: KartCustomization;
    trackId: string;
    laps: number;
    aiCount: number;
  }) => void;
  onJoinRoom: (params: {
    code: string;
    name: string;
    characterId: CharacterId;
    customization: KartCustomization;
  }) => void;
  onUpdatePlayer: (params: {
    name?: string;
    characterId?: CharacterId;
    customization?: KartCustomization;
  }) => void;
  onUpdateRoomSettings: (params: { trackId?: string; laps?: number; aiCount?: number }) => void;
  onStartRace: () => void;
  onLeaveRoom: () => void;
}

export const OnlineLobbyModal: React.FC<OnlineLobbyModalProps> = ({
  isOpen,
  connected,
  room,
  playerId,
  openRooms,
  errorMessage,
  initialJoinCode = '',
  unlockedCharacters,
  defaultCharacterId,
  defaultCustomization,
  defaultTrackId,
  defaultLaps,
  onClose,
  onRefreshRooms,
  onCreateRoom,
  onJoinRoom,
  onUpdatePlayer,
  onUpdateRoomSettings,
  onStartRace,
  onLeaveRoom,
}) => {
  const [playerName, setPlayerName] = useState('JarvinPro');
  const [charId, setCharId] = useState<CharacterId>(defaultCharacterId);
  const [joinCode, setJoinCode] = useState(initialJoinCode);
  const [trackId, setTrackId] = useState(defaultTrackId);
  const [laps, setLaps] = useState(defaultLaps);
  const [aiCount, setAiCount] = useState(2);
  const [copiedInvite, setCopiedInvite] = useState(false);

  useEffect(() => {
    if (initialJoinCode) {
      setJoinCode(initialJoinCode.toUpperCase());
    }
  }, [initialJoinCode]);

  if (!isOpen) return null;

  const isHost = Boolean(room && playerId && room.hostId === playerId);
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : PUBLIC_GAME_URL;
  const isDevOrLocal =
    currentOrigin.includes('ais-dev-') ||
    currentOrigin.includes('localhost') ||
    currentOrigin.includes('127.0.0.1');
  const publicBase = isDevOrLocal ? PUBLIC_GAME_URL : currentOrigin;
  const inviteLink = room ? `${publicBase}/?sala=${room.code}` : publicBase;

  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleCharSelect = (cid: CharacterId) => {
    setCharId(cid);
    const cust = CHARACTER_MAP[cid].defaultCustomization;
    if (room) {
      onUpdatePlayer({ name: playerName, characterId: cid, customization: cust });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[92vh] bg-[#0b101b] border border-cyan-500/35 rounded-2xl p-5 md:p-6 shadow-2xl flex flex-col gap-4 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/15 border border-cyan-400/30">
              <Globe className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="font-display text-xl font-bold text-white">
                Multijugador Online en Tiempo Real
              </h2>
              <p className="text-xs text-slate-400">
                {connected
                  ? 'Conectado al servidor · Crea una sala o únete con código/enlace'
                  : 'Conectando al servidor WebSocket...'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar lobby online"
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {errorMessage && (
          <div className="bg-red-500/15 border border-red-400/50 text-red-200 text-xs px-4 py-2.5 rounded-xl font-semibold">
            {errorMessage}
          </div>
        )}

        {/* Racer Name & Character Picker */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-900/80 border border-white/10 rounded-xl p-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Tu Nombre de Piloto
            </label>
            <input
              type="text"
              maxLength={18}
              value={playerName}
              onChange={(e) => {
                setPlayerName(e.target.value);
                if (room) onUpdatePlayer({ name: e.target.value });
              }}
              placeholder="Tu nombre..."
              className="w-full bg-[#090d14] border border-white/15 rounded-lg px-3 py-2 text-sm text-white focus:border-cyan-400 outline-none"
            />
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-300 mb-1.5">Tu Corredor</div>
            <div className="grid grid-cols-4 gap-1.5">
              {CHARACTERS.map((c) => {
                const active = charId === c.id;
                const locked = Boolean(
                  c.unlockRequirement && !unlockedCharacters.includes(c.id as PlayableCharacterId),
                );
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={locked}
                    title={locked ? c.unlockRequirement?.hint : c.name}
                    onClick={() => handleCharSelect(c.id)}
                    className={`py-2 px-1.5 rounded-lg border text-[11px] font-display font-bold truncate transition-colors flex items-center justify-center gap-1 ${
                      locked
                        ? 'bg-slate-950 text-slate-500 border-red-500/20 opacity-60 cursor-not-allowed'
                        : active
                          ? 'bg-emerald-500 text-slate-950 border-emerald-300 cursor-pointer'
                          : 'bg-[#090d14] text-slate-300 border-white/10 hover:border-white/30 cursor-pointer'
                    }`}
                  >
                    {locked && <Lock className="w-3 h-3 shrink-0" />}
                    <span className="truncate">{c.name.split(' ')[0]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Either Create/Join View OR Active Room Waiting Lobby */}
        {!room ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Create Room */}
            <div className="bg-slate-900/80 border border-emerald-500/30 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2 font-display font-bold text-sm text-emerald-400">
                <Plus className="w-4 h-4" />
                <span>Crear Nueva Sala</span>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Pista</label>
                <select
                  value={trackId}
                  onChange={(e) => setTrackId(e.target.value)}
                  className="w-full bg-[#090d14] border border-white/15 rounded-lg px-3 py-2 text-xs text-white"
                >
                  {TRACKS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Vueltas</label>
                  <select
                    value={laps}
                    onChange={(e) => setLaps(Number(e.target.value))}
                    className="w-full bg-[#090d14] border border-white/15 rounded-lg px-3 py-2 text-xs text-white"
                  >
                    <option value={2}>2 Vueltas</option>
                    <option value={3}>3 Vueltas</option>
                    <option value={5}>5 Vueltas</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Bots IA Extra</label>
                  <select
                    value={aiCount}
                    onChange={(e) => setAiCount(Number(e.target.value))}
                    className="w-full bg-[#090d14] border border-white/15 rounded-lg px-3 py-2 text-xs text-white"
                  >
                    <option value={0}>0 (Solo Humanos)</option>
                    <option value={1}>1 Bot IA</option>
                    <option value={2}>2 Bots IA</option>
                    <option value={3}>3 Bots IA</option>
                  </select>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  onCreateRoom({
                    name: playerName || 'JarvinPro',
                    characterId: charId,
                    customization:
                      charId === defaultCharacterId
                        ? defaultCustomization
                        : CHARACTER_MAP[charId].defaultCustomization,
                    trackId,
                    laps,
                    aiCount,
                  })
                }
                className="mt-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-sm cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Crear Sala Online</span>
              </button>
            </div>

            {/* Join Room + Open Rooms */}
            <div className="bg-slate-900/80 border border-cyan-500/30 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-display font-bold text-sm text-cyan-400">
                  <LogIn className="w-4 h-4" />
                  <span>Unirse a una Sala</span>
                </div>
                <button
                  type="button"
                  onClick={onRefreshRooms}
                  className="inline-flex items-center gap-1 text-xs text-slate-300 hover:text-white cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Actualizar</span>
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={8}
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="Código (ej. KART42)"
                  className="flex-1 bg-[#090d14] border border-white/15 rounded-lg px-3 py-2 text-sm font-mono-tabular uppercase text-white focus:border-cyan-400 outline-none"
                />
                <button
                  type="button"
                  disabled={joinCode.trim().length < 4}
                  onClick={() =>
                    onJoinRoom({
                      code: joinCode.trim().toUpperCase(),
                      name: playerName || 'Corredor',
                      characterId: charId,
                      customization:
                        charId === defaultCharacterId
                          ? defaultCustomization
                          : CHARACTER_MAP[charId].defaultCustomization,
                    })
                  }
                  className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-display font-bold text-xs cursor-pointer"
                >
                  Unirse
                </button>
              </div>

              <div className="text-xs text-slate-400 font-semibold">Salas Abiertas Ahora:</div>
              <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
                {openRooms.length === 0 ? (
                  <div className="text-xs text-slate-500 bg-[#090d14]/70 rounded-lg p-3 text-center">
                    No hay salas públicas abiertas. ¡Crea una y comparte el código!
                  </div>
                ) : (
                  openRooms.map((r) => {
                    const trk = TRACKS.find((t) => t.id === r.trackId);
                    return (
                      <button
                        key={r.code}
                        type="button"
                        onClick={() =>
                          onJoinRoom({
                            code: r.code,
                            name: playerName || 'Corredor',
                            characterId: charId,
                            customization: CHARACTER_MAP[charId].defaultCustomization,
                          })
                        }
                        className="flex items-center justify-between bg-[#090d14] hover:bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-left cursor-pointer"
                      >
                        <div>
                          <div className="font-display font-bold text-xs text-white">
                            Sala {r.code} · {r.hostName}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {trk?.name ?? r.trackId} · {r.laps}V
                          </div>
                        </div>
                        <span className="text-xs font-mono-tabular font-bold text-cyan-300">
                          {r.playerCount}/{r.maxPlayers}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Inside Room Lobby */
          <div className="bg-slate-900/85 border border-emerald-500/35 rounded-xl p-4 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10">
              <div>
                <div className="text-xs text-slate-400">Código de Sala</div>
                <div className="font-mono-tabular text-2xl font-bold text-amber-400 tracking-wider">
                  {room.code}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyInvite}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-200 text-xs font-bold cursor-pointer"
                >
                  {copiedInvite ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedInvite ? '¡Enlace Copiado!' : 'Copiar Link de Sala'}</span>
                </button>
                <button
                  type="button"
                  onClick={onLeaveRoom}
                  className="px-3.5 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-400/30 text-red-200 text-xs font-bold cursor-pointer"
                >
                  Salir
                </button>
              </div>
            </div>

            {/* Room Settings (Host editable) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Circuito</label>
                <select
                  disabled={!isHost}
                  value={room.trackId}
                  onChange={(e) => onUpdateRoomSettings({ trackId: e.target.value })}
                  className="w-full bg-[#090d14] border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white disabled:opacity-70"
                >
                  {TRACKS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Vueltas</label>
                <select
                  disabled={!isHost}
                  value={room.laps}
                  onChange={(e) => onUpdateRoomSettings({ laps: Number(e.target.value) })}
                  className="w-full bg-[#090d14] border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white disabled:opacity-70"
                >
                  <option value={2}>2 Vueltas</option>
                  <option value={3}>3 Vueltas</option>
                  <option value={5}>5 Vueltas</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Bots IA en Pista</label>
                <select
                  disabled={!isHost}
                  value={room.aiCount}
                  onChange={(e) => onUpdateRoomSettings({ aiCount: Number(e.target.value) })}
                  className="w-full bg-[#090d14] border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white disabled:opacity-70"
                >
                  <option value={0}>0 Bots (Solo Jugadores)</option>
                  <option value={1}>1 Bot IA</option>
                  <option value={2}>2 Bots IA</option>
                  <option value={3}>3 Bots IA</option>
                </select>
              </div>
            </div>

            {/* Connected Players List */}
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300 mb-2">
                <Users className="w-3.5 h-3.5 text-emerald-400" />
                <span>Corredores Conectados ({room.players.length}/4)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {room.players.map((p) => {
                  const char = CHARACTER_MAP[p.characterId];
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border ${
                        p.id === playerId
                          ? 'bg-emerald-500/15 border-emerald-400/50'
                          : 'bg-[#090d14] border-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <CharacterExpressionAvatar characterId={p.characterId} sizeClass="w-8 h-8" />
                        <div className="min-w-0">
                          <div className="font-display font-bold text-sm text-white truncate flex items-center gap-1.5">
                            <span>{p.name}</span>
                            {p.isHost && <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                          </div>
                          <div className="text-[11px] text-slate-400">{char?.name ?? p.characterId}</div>
                        </div>
                      </div>
                      <span className="text-[11px] font-bold text-emerald-400">Listo</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {isHost ? (
              <button
                type="button"
                onClick={onStartRace}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-sm cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>¡Iniciar Carrera Online!</span>
              </button>
            ) : (
              <div className="text-center text-xs text-cyan-300 font-semibold py-2 bg-[#090d14] rounded-xl border border-cyan-500/20">
                Esperando a que el anfitrión inicie la carrera...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
