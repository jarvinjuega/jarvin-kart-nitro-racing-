import React, { useState } from 'react';
import { Crosshair, Key, Lock, Play, Shield, Users, X } from 'lucide-react';
import type { SaveProgress } from '../game/types';
import { BATTLE_ARENAS } from '../game/constants';

interface BattleSetupModalProps {
  isOpen: boolean;
  save: SaveProgress;
  onClose: () => void;
  onGoToRelic: () => void;
  onStartBattle: (config: {
    playerCount: number;
    useAI: boolean;
    aiCount: number;
    arenaId: string;
    chooseKartsFirst: boolean;
  }) => void;
}

export const BattleSetupModal: React.FC<BattleSetupModalProps> = ({
  isOpen,
  save,
  onClose,
  onGoToRelic,
  onStartBattle,
}) => {
  const [playerCount, setPlayerCount] = useState(2);
  const [useAI, setUseAI] = useState(true);
  const [arenaId, setArenaId] = useState(BATTLE_ARENAS[0].id);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-[#0b0e17] border-2 border-red-500/45 rounded-2xl p-5 md:p-6 shadow-2xl flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5">
            <Crosshair className="w-6 h-6 text-red-500" />
            <div>
              <h2 className="font-display text-xl font-bold text-white">
                MODO BATALLA A MUERTE (COHETES)
              </h2>
              <p className="text-xs text-slate-400">
                Arena cerrada con cajas exclusivas de Cohetes. ¡El primero en lograr 5 bajas gana!
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

        {!save.battleUnlocked ? (
          <div className="bg-slate-900/90 border border-amber-400/40 rounded-xl p-5 text-center space-y-3">
            <Lock className="w-10 h-10 text-amber-400 mx-auto" />
            <h3 className="font-display text-lg font-bold text-white">
              Modo Batalla Bloqueado
            </h3>
            <p className="text-sm text-slate-300">
              Para desbloquear el Modo Batalla a Muerte, consigue al menos una{' '}
              <strong className="text-slate-100">Llave de Metal (≤ 01:20)</strong> o{' '}
              <strong className="text-amber-300">Llave de Oro (≤ 00:59)</strong> en{' '}
              <strong>Carrera Reliquia</strong>.
            </p>
            <button
              type="button"
              onClick={onGoToRelic}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display font-bold text-sm cursor-pointer"
            >
              <Key className="w-4 h-4" />
              <span>Ir a Carrera Reliquia</span>
            </button>
          </div>
        ) : (
          <>
            {/* Players Selector (1-4 Local Players) */}
            <div>
              <div className="text-xs text-slate-400 mb-1.5 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                <span>¿Cuántos Jugadores Locales?</span>
              </div>
              <div className="grid grid-cols-4 gap-2 bg-slate-900 p-1.5 rounded-xl border border-white/10">
                {[1, 2, 3, 4].map((cnt) => (
                  <button
                    key={cnt}
                    type="button"
                    onClick={() => setPlayerCount(cnt)}
                    className={`py-2 rounded-lg font-display font-bold text-sm cursor-pointer ${
                      playerCount === cnt
                        ? 'bg-red-600 text-white'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {cnt} {cnt === 1 ? 'Jugador' : 'Jugadores'}
                  </button>
                ))}
              </div>
            </div>

            {/* AI Bots Toggle */}
            <div className="flex items-center justify-between bg-slate-900/85 border border-white/10 rounded-xl p-3">
              <div className="text-xs">
                <div className="font-semibold text-white">Bots IA en Arena</div>
                <div className="text-slate-400">
                  {playerCount === 1
                    ? '1J siempre combate contra 3 Bots IA'
                    : useAI
                      ? `${playerCount}J + ${Math.max(0, 4 - playerCount)} Bots IA`
                      : `Solo ${playerCount} Jugadores entre sí`}
                </div>
              </div>
              {playerCount >= 2 && (
                <div className="flex gap-1 bg-[#090d14] p-1 rounded-lg border border-white/10">
                  <button
                    type="button"
                    onClick={() => setUseAI(false)}
                    className={`px-3 py-1 rounded text-xs font-bold cursor-pointer ${
                      !useAI ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'
                    }`}
                  >
                    Solo {playerCount}J
                  </button>
                  <button
                    type="button"
                    onClick={() => setUseAI(true)}
                    className={`px-3 py-1 rounded text-xs font-bold cursor-pointer ${
                      useAI ? 'bg-amber-400 text-slate-950' : 'text-slate-300'
                    }`}
                  >
                    +Bots
                  </button>
                </div>
              )}
            </div>

            {/* Arena Selector */}
            <div>
              <div className="text-xs text-slate-400 mb-1.5 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" />
                <span>Mapa de Batalla (Meta: 5 Bajas)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {BATTLE_ARENAS.map((ar) => (
                  <button
                    key={ar.id}
                    type="button"
                    onClick={() => setArenaId(ar.id)}
                    className={`p-3 rounded-xl border text-left cursor-pointer ${
                      arenaId === ar.id
                        ? 'bg-red-500/15 border-red-400 text-white'
                        : 'bg-slate-900/80 border-white/10 text-slate-300'
                    }`}
                  >
                    <div className="font-display font-bold text-sm">{ar.name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{ar.subtitle}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={() =>
                  onStartBattle({
                    playerCount,
                    useAI: playerCount === 1 ? true : useAI,
                    aiCount: playerCount === 1 ? 3 : useAI ? Math.max(0, 4 - playerCount) : 0,
                    arenaId,
                    chooseKartsFirst: true,
                  })
                }
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white border border-white/15 font-display font-bold text-sm cursor-pointer"
              >
                Elegir Corredores
              </button>
              <button
                type="button"
                onClick={() =>
                  onStartBattle({
                    playerCount,
                    useAI: playerCount === 1 ? true : useAI,
                    aiCount: playerCount === 1 ? 3 : useAI ? Math.max(0, 4 - playerCount) : 0,
                    arenaId,
                    chooseKartsFirst: false,
                  })
                }
                className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-display font-bold text-sm cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>¡Iniciar Batalla!</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
