import React, { useState } from 'react';
import { CheckCircle2, Flame, ShieldAlert, Skull, X, Zap } from 'lucide-react';
import type { BossSpec, SaveProgress } from '../game/types';
import { BOSSES, TRACKS } from '../game/constants';
import { CharacterExpressionAvatar } from './CharacterExpressionAvatar';

interface BossSelectModalProps {
  isOpen: boolean;
  save: SaveProgress;
  onClose: () => void;
  onSelectBoss: (boss: BossSpec) => void;
}

export const BossSelectModal: React.FC<BossSelectModalProps> = ({
  isOpen,
  save,
  onClose,
  onSelectBoss,
}) => {
  const [selectedId, setSelectedId] = useState<string>(BOSSES[0].id);

  if (!isOpen) return null;

  const selectedBoss = BOSSES.find((b) => b.id === selectedId) ?? BOSSES[0];
  const bossTrack = TRACKS.find((t) => t.id === selectedBoss.trackId);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-[#0b0d14] border-2 border-red-500/40 rounded-2xl p-5 md:p-6 shadow-2xl flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5">
            <Skull className="w-6 h-6 text-red-500" />
            <div>
              <h2 className="font-display text-xl md:text-2xl font-bold text-white">
                MODO JEFE · DUELOS 1 VS 1
              </h2>
              <p className="text-xs text-slate-400">
                Elige a un jefe y derrótalo en 1° lugar para dominar su pista.
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {BOSSES.map((boss) => {
            const defeated = save.defeatedBosses.includes(boss.id);
            const active = boss.id === selectedId;
            return (
              <button
                key={boss.id}
                type="button"
                onClick={() => setSelectedId(boss.id)}
                className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                  active
                    ? 'bg-red-500/15 border-red-400 text-white'
                    : 'bg-slate-900/85 border-white/10 text-slate-300 hover:border-white/25'
                }`}
              >
                <CharacterExpressionAvatar
                  characterId={boss.characterId}
                  expression="angry"
                  sizeClass="w-12 h-12"
                  glitch={boss.glitchOnDefeat}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display font-bold text-base text-white truncate">
                      {boss.name}
                    </span>
                    {defeated && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Vencido
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-semibold text-amber-300">{boss.title}</div>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">{boss.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Boss Detail */}
        <div className="bg-slate-900/90 border border-white/10 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="text-xs text-slate-400">
              Pista del Duelo: <strong className="text-white">{bossTrack?.name ?? selectedBoss.trackId}</strong>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {selectedBoss.infiniteTurbo && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-lime-500/20 text-lime-300 border border-lime-500/40 font-semibold">
                  <Zap className="w-3.5 h-3.5" /> Turbo Infinito
                </span>
              )}
              {selectedBoss.heavyPowerSpam && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-orange-500/20 text-orange-300 border border-orange-500/40 font-semibold">
                  <Flame className="w-3.5 h-3.5" /> Poderes Constantes
                </span>
              )}
              {selectedBoss.bumpSlowsPlayer && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-500/20 text-red-300 border border-red-500/40 font-semibold">
                  <ShieldAlert className="w-3.5 h-3.5" /> Choque Ralentiza tu Kart
                </span>
              )}
              {selectedBoss.glitchOnDefeat && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40 font-semibold">
                  <Skull className="w-3.5 h-3.5" /> Furia Glitch al Ganar
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onSelectBoss(selectedBoss)}
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-display font-bold text-sm cursor-pointer transition-colors shrink-0"
          >
            ¡Desafiar a {selectedBoss.name}!
          </button>
        </div>
      </div>
    </div>
  );
};
