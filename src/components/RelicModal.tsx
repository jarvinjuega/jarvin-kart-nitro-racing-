import React, { useState } from 'react';
import { Clock, Key, Play, Timer, X } from 'lucide-react';
import type { GameMode, RelicKeyTier, SaveProgress } from '../game/types';
import { TRACKS, formatRaceTime } from '../game/constants';

interface RelicModalProps {
  isOpen: boolean;
  save: SaveProgress;
  defaultTrackId: string;
  onClose: () => void;
  onLaunchTimeMode: (mode: 'timetrial' | 'relic', trackId: string) => void;
}

function keyBadge(tier: RelicKeyTier | undefined) {
  if (tier === 'gold') {
    return { label: 'Llave de Oro', cls: 'bg-amber-400/20 text-amber-300 border-amber-400' };
  }
  if (tier === 'metal') {
    return { label: 'Llave de Metal', cls: 'bg-slate-300/20 text-slate-200 border-slate-300' };
  }
  if (tier === 'copper') {
    return { label: 'Llave de Cobre', cls: 'bg-orange-500/20 text-orange-300 border-orange-400' };
  }
  return null;
}

export const RelicModal: React.FC<RelicModalProps> = ({
  isOpen,
  save,
  defaultTrackId,
  onClose,
  onLaunchTimeMode,
}) => {
  const [subMode, setSubMode] = useState<'relic' | 'timetrial'>('relic');
  const [trackId, setTrackId] = useState<string>(defaultTrackId);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#0b101b] border-2 border-cyan-500/40 rounded-2xl p-5 md:p-6 shadow-2xl flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5">
            <Timer className="w-6 h-6 text-cyan-400" />
            <div>
              <h2 className="font-display text-xl font-bold text-white">
                CONTRARRELOJ Y CARRERA RELIQUIA
              </h2>
              <p className="text-xs text-slate-400">
                Rompe cajas de tiempo (+1s, +2s, +3s congelados) para ganar llaves y desbloquear Modo Batalla.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Submode toggle */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => setSubMode('relic')}
            className={`p-3 rounded-xl border text-left cursor-pointer ${
              subMode === 'relic'
                ? 'bg-amber-400/15 border-amber-400 text-white'
                : 'bg-slate-900/80 border-white/10 text-slate-300'
            }`}
          >
            <div className="flex items-center gap-2 font-display font-bold text-sm">
              <Key className="w-4 h-4 text-amber-400" />
              <span>Carrera Reliquia (Llaves)</span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              2 vueltas · Cajas amarillas detienen el cronómetro 1s / 2s / 3s.
            </div>
          </button>

          <button
            type="button"
            onClick={() => setSubMode('timetrial')}
            className={`p-3 rounded-xl border text-left cursor-pointer ${
              subMode === 'timetrial'
                ? 'bg-cyan-500/15 border-cyan-400 text-white'
                : 'bg-slate-900/80 border-white/10 text-slate-300'
            }`}
          >
            <div className="flex items-center gap-2 font-display font-bold text-sm">
              <Clock className="w-4 h-4 text-cyan-400" />
              <span>Contrarreloj Clásico</span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              Compite contra tu fantasma récord sin cajas de tiempo.
            </div>
          </button>
        </div>

        {/* Threshold Guide for Relic */}
        {subMode === 'relic' && (
          <div className="grid grid-cols-3 gap-2 bg-slate-900/90 border border-white/10 rounded-xl p-3 text-center text-xs">
            <div className="p-2 rounded-lg bg-amber-400/10 border border-amber-400/40">
              <div className="font-display font-bold text-amber-300">Llave de Oro</div>
              <div className="font-mono-tabular text-white mt-0.5">≤ 00:59.00</div>
              <div className="text-[10px] text-emerald-300 mt-0.5">Desbloquea Batalla</div>
            </div>
            <div className="p-2 rounded-lg bg-slate-300/10 border border-slate-300/40">
              <div className="font-display font-bold text-slate-200">Llave de Metal</div>
              <div className="font-mono-tabular text-white mt-0.5">≤ 01:20.00</div>
              <div className="text-[10px] text-emerald-300 mt-0.5">Desbloquea Batalla</div>
            </div>
            <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-400/40">
              <div className="font-display font-bold text-orange-300">Llave de Cobre</div>
              <div className="font-mono-tabular text-white mt-0.5">≤ 02:20.00</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Trofeo Reliquia</div>
            </div>
          </div>
        )}

        {/* Track selector */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[260px] overflow-y-auto pr-1">
          {TRACKS.map((trk) => {
            const active = trackId === trk.id;
            const tier = save.relicKeys[trk.id];
            const badge = keyBadge(tier);
            const best = subMode === 'relic' ? save.bestRelicTimes[trk.id] : save.bestTimes[trk.id];
            return (
              <button
                key={trk.id}
                type="button"
                onClick={() => setTrackId(trk.id)}
                className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border text-left cursor-pointer ${
                  active
                    ? 'bg-cyan-500/15 border-cyan-400 text-white'
                    : 'bg-slate-900/80 border-white/10 text-slate-300 hover:border-white/25'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-display font-bold text-xs truncate">{trk.name}</div>
                  {best && (
                    <div className="text-[11px] font-mono-tabular text-cyan-300">
                      Mejor: {formatRaceTime(best)}
                    </div>
                  )}
                </div>
                {badge && (
                  <span className={`px-2 py-0.5 rounded border text-[10px] font-bold shrink-0 ${badge.cls}`}>
                    {badge.label}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => onLaunchTimeMode(subMode as Extract<GameMode, 'timetrial' | 'relic'>, trackId)}
          className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display font-bold text-sm cursor-pointer"
        >
          <Play className="w-4 h-4 fill-current" />
          <span>{subMode === 'relic' ? '¡Iniciar Carrera Reliquia!' : '¡Iniciar Contrarreloj!'}</span>
        </button>
      </div>
    </div>
  );
};
