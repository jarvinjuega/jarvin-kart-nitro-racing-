import React from 'react';
import { Home, RotateCcw, Skull, Trophy } from 'lucide-react';
import type { BattleResultSummary } from '../game/types';
import { CharacterExpressionAvatar } from './CharacterExpressionAvatar';

interface BattleWinOverlayProps {
  summary: BattleResultSummary;
  onRematch: () => void;
  onMainMenu: () => void;
}

export const BattleWinOverlay: React.FC<BattleWinOverlayProps> = ({
  summary,
  onRematch,
  onMainMenu,
}) => {
  return (
    <div className="fixed inset-0 z-30 pointer-events-none flex flex-col justify-between p-5 md:p-8">
      {/* Top Dark Battle WIN Header */}
      <div className="flex flex-col items-center">
        <div className="bg-[#090d14]/92 border-2 border-amber-400 rounded-2xl px-8 py-3 shadow-2xl text-center">
          <div className="flex items-center justify-center gap-2 text-amber-400 font-display text-sm font-bold tracking-wider">
            <Trophy className="w-5 h-5" />
            <span>¡VICTORIA EN BATALLA A MUERTE — WIN!</span>
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold text-white mt-0.5">
            {summary.winner.name} Domina {summary.arenaName}
          </h1>
          <div className="text-xs text-emerald-400 font-semibold mt-0.5">
            {summary.winner.kills} Bajas con Cohetes Buscadores
          </div>
        </div>
      </div>

      {/* Bottom Winner vs Dizzy Loser Cards + Actions */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-end justify-between gap-4">
        <div className="pointer-events-auto grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#090d14]/92 border border-white/15 rounded-2xl p-4 shadow-2xl max-w-2xl flex-1">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-400/15 border border-amber-400">
            <CharacterExpressionAvatar
              characterId={summary.winner.characterId}
              expression="win"
              sizeClass="w-12 h-12"
            />
            <div className="min-w-0">
              <div className="text-[11px] font-display font-bold text-amber-300">CAMPEÓN DEL KART</div>
              <div className="font-display font-bold text-base text-white truncate">
                {summary.winner.name}
              </div>
              <div className="text-xs text-emerald-300 font-semibold">
                {summary.winner.kills} Bajas · ¡Celebrando!
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/90 border border-red-500/40">
            <CharacterExpressionAvatar
              characterId={summary.loser.characterId}
              expression="dizzy"
              sizeClass="w-12 h-12"
            />
            <div className="min-w-0">
              <div className="text-[11px] font-display font-bold text-red-400 flex items-center gap-1">
                <Skull className="w-3.5 h-3.5" /> DERROTADO MAREADO
              </div>
              <div className="font-display font-bold text-base text-white truncate">
                {summary.loser.name}
              </div>
              <div className="text-xs text-slate-400">
                {summary.loser.kills} Bajas · Viendo estrellas ★
              </div>
            </div>
          </div>
        </div>

        <div className="pointer-events-auto bg-[#090d14]/92 border border-white/15 rounded-2xl p-4 shadow-2xl flex flex-wrap lg:flex-col gap-2.5 min-w-[220px]">
          <button
            type="button"
            onClick={onRematch}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-display font-bold text-sm cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Revancha de Batalla</span>
          </button>
          <button
            type="button"
            onClick={onMainMenu}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white border border-white/15 font-semibold text-sm cursor-pointer"
          >
            <Home className="w-4 h-4" />
            <span>Volver al Menú</span>
          </button>
        </div>
      </div>
    </div>
  );
};
