import React, { useCallback, useEffect, useState } from 'react';
import { Globe, Laptop, RefreshCw, Smartphone, Trophy, User, X } from 'lucide-react';
import { TRACKS, formatRaceTime } from '../game/constants';
import type { CharacterId } from '../game/types';
import { CharacterExpressionAvatar } from './CharacterExpressionAvatar';

export interface HighscoreEntry {
  id: string;
  clientId: string;
  playerName: string;
  trackId: string;
  characterId: CharacterId;
  mode: string;
  timeMs: number;
  isMobile: boolean;
  createdAt: number;
}

const CLIENT_ID_KEY = 'jarvin_kart_client_id_v1';

export function getOrCreateClientId(): string {
  if (typeof window === 'undefined') return 'anon';
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing && existing.length >= 6) return existing;
    const generated = `jk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(CLIENT_ID_KEY, generated);
    return generated;
  } catch {
    return 'anon';
  }
}

interface HighscoreModalProps {
  isOpen: boolean;
  defaultTrackId: string;
  playerNickname: string;
  onChangeNickname: (nextName: string) => void;
  onClose: () => void;
}

const MODE_LABELS: Record<string, string> = {
  all: 'Todos los Modos',
  arcade: 'Arcade',
  adventure: 'Aventura',
  relic: 'Reliquia',
  timetrial: 'Contrarreloj',
  madness: 'Locura',
  tokens: 'Tokens J-K-T',
};

export const HighscoreModal: React.FC<HighscoreModalProps> = ({
  isOpen,
  defaultTrackId,
  playerNickname,
  onChangeNickname,
  onClose,
}) => {
  const [trackFilter, setTrackFilter] = useState<string>(defaultTrackId);
  const [modeFilter, setModeFilter] = useState<string>('all');
  const [entries, setEntries] = useState<HighscoreEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState(playerNickname);
  const clientId = getOrCreateClientId();

  useEffect(() => {
    setDraftName(playerNickname);
  }, [playerNickname, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTrackFilter(defaultTrackId);
    }
  }, [isOpen, defaultTrackId]);

  const fetchScores = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        trackId: trackFilter,
        mode: modeFilter,
      });
      const res = await fetch(`/api/highscores?${qs.toString()}`);
      if (!res.ok) throw new Error('Error consultando récords');
      const data = (await res.json()) as { entries?: HighscoreEntry[] };
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      setError('No se pudo cargar el ranking global en este momento.');
    } finally {
      setLoading(false);
    }
  }, [trackFilter, modeFilter]);

  useEffect(() => {
    if (isOpen) {
      void fetchScores();
    }
  }, [isOpen, fetchScores]);

  if (!isOpen) return null;

  const trackNameMap = new Map(TRACKS.map((t) => [t.id, t.name]));
  const myBestEntry = entries.find((e) => e.clientId === clientId) ?? null;

  const commitNickname = () => {
    const cleaned = draftName.replace(/[<>]/g, '').trim().slice(0, 20) || 'Corredor';
    setDraftName(cleaned);
    if (cleaned !== playerNickname) {
      onChangeNickname(cleaned);
    }
  };

  return (
    <div
      data-testid="highscore-modal"
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-5"
    >
      <div className="w-full max-w-3xl max-h-[90vh] bg-[#0b101b] border border-amber-400/35 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <Trophy className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="font-display text-lg sm:text-xl font-bold text-white">
                Highscore Global · Jugadores Reales
              </h2>
              <p className="text-xs text-slate-400">
                Mejores tiempos reales registrados al terminar carreras
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchScores()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Actualizar</span>
            </button>
            <button
              type="button"
              aria-label="Cerrar highscores"
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Nickname + Filters */}
        <div className="p-4 border-b border-white/10 bg-slate-900/60 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 flex-1">
              <User className="w-4 h-4 text-emerald-400 shrink-0" />
              <label htmlFor="player-nickname-input" className="text-xs font-semibold text-slate-300 shrink-0">
                Tu Nombre:
              </label>
              <input
                id="player-nickname-input"
                type="text"
                maxLength={20}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitNickname}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitNickname();
                    e.currentTarget.blur();
                  }
                }}
                className="flex-1 max-w-[220px] bg-[#090d14] border border-white/20 rounded-lg px-2.5 py-1.5 text-xs font-display font-bold text-white focus:outline-none focus:border-emerald-400"
              />
              <button
                type="button"
                onClick={commitNickname}
                className="px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs cursor-pointer"
              >
                Guardar
              </button>
            </div>

            {myBestEntry && (
              <div className="bg-emerald-500/15 border border-emerald-400/40 rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs">
                <span className="text-emerald-300 font-semibold">Tu Récord Aquí:</span>
                <span className="font-mono-tabular font-bold text-white">
                  {formatRaceTime(myBestEntry.timeMs)}
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <select
              aria-label="Filtrar por circuito"
              value={trackFilter}
              onChange={(e) => setTrackFilter(e.target.value)}
              className="bg-[#090d14] border border-white/15 rounded-lg px-3 py-2 text-xs text-white font-semibold"
            >
              <option value="all">Todas las Pistas (Global)</option>
              {TRACKS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.chapter}. {t.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filtrar por modo"
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value)}
              className="bg-[#090d14] border border-white/15 rounded-lg px-3 py-2 text-xs text-white font-semibold"
            >
              {Object.entries(MODE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  Modo: {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Ranking List */}
        <div className="flex-1 overflow-y-auto p-4">
          {error ? (
            <div className="text-center py-8 text-sm text-red-300">{error}</div>
          ) : loading && entries.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-400">Cargando tiempos reales...</div>
          ) : entries.length === 0 ? (
            <div className="text-center py-10 px-4 bg-slate-900/60 border border-white/10 rounded-xl flex flex-col items-center gap-2">
              <Globe className="w-8 h-8 text-slate-500" />
              <div className="font-display font-bold text-sm text-white">
                Todavía no hay récords en este filtro
              </div>
              <p className="text-xs text-slate-400 max-w-md">
                Solo se muestran tiempos reales de corredores humanos al terminar una carrera. ¡Sé el primero en marcar el récord!
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {entries.map((entry, idx) => {
                const isMine = entry.clientId === clientId;
                const rank = idx + 1;
                const medalColor =
                  rank === 1
                    ? 'text-amber-400'
                    : rank === 2
                      ? 'text-slate-200'
                      : rank === 3
                        ? 'text-orange-400'
                        : 'text-slate-400';

                return (
                  <div
                    key={entry.id}
                    className={`flex items-center justify-between gap-3 px-3 py-2 rounded-xl border ${
                      isMine
                        ? 'bg-emerald-500/15 border-emerald-400/50'
                        : 'bg-slate-900/80 border-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`font-display font-bold text-sm w-7 text-center shrink-0 tabular-nums ${medalColor}`}>
                        {rank}°
                      </span>
                      <CharacterExpressionAvatar
                        characterId={entry.characterId}
                        sizeClass="w-8 h-8"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-display font-bold text-xs sm:text-sm text-white truncate">
                            {entry.playerName}
                          </span>
                          {isMine && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-400 text-slate-950 font-bold text-[10px] shrink-0">
                              TÚ
                            </span>
                          )}
                          {entry.isMobile ? (
                            <Smartphone className="w-3.5 h-3.5 text-cyan-400 shrink-0" aria-label="Celular" />
                          ) : (
                            <Laptop className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-label="PC" />
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {trackNameMap.get(entry.trackId) ?? entry.trackId} · {MODE_LABELS[entry.mode] ?? entry.mode}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="font-mono-tabular font-bold text-sm sm:text-base text-amber-300">
                        {formatRaceTime(entry.timeMs)}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {new Date(entry.createdAt).toLocaleDateString('es-ES')}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
