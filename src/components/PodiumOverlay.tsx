import React from 'react';
import { ArrowRight, Home, Key, RotateCcw, Skull, Trophy } from 'lucide-react';
import type { BossSpec, CharacterSpec, RaceHudSnapshot, RelicKeyTier } from '../game/types';
import { formatRaceTime } from '../game/constants';
import { CharacterExpressionAvatar } from './CharacterExpressionAvatar';

interface PodiumOverlayProps {
  results: RaceHudSnapshot;
  isNewRecord: boolean;
  unlockedNextChapter: boolean;
  earnedRelicKey?: RelicKeyTier | null;
  unlockedBattle?: boolean;
  bossDefeated?: BossSpec | null;
  unlockedCharacter?: CharacterSpec | null;
  hasNextTrack: boolean;
  onNextTrack: () => void;
  onReplay: () => void;
  onMainMenu: () => void;
}

export const PodiumOverlay: React.FC<PodiumOverlayProps> = ({
  results,
  isNewRecord,
  unlockedNextChapter,
  earnedRelicKey,
  unlockedBattle,
  bossDefeated,
  unlockedCharacter,
  hasNextTrack,
  onNextTrack,
  onReplay,
  onMainMenu,
}) => {
  const top3 = results.standings.slice(0, 3);
  const moodLabels = ['¡Celebrando el Triunfo!', 'Desanimado (2°)', '¡Furioso (3°)'];
  const moodExpr = ['win', 'bored', 'angry'] as const;
  const glitchBoss = Boolean(bossDefeated?.glitchOnDefeat);

  const keyLabel =
    earnedRelicKey === 'gold'
      ? 'Llave de Oro (≤ 00:59)'
      : earnedRelicKey === 'metal'
        ? 'Llave de Metal (≤ 01:20)'
        : earnedRelicKey === 'copper'
          ? 'Llave de Cobre (≤ 02:20)'
          : null;

  return (
    <div className="fixed inset-0 z-30 pointer-events-none flex flex-col justify-between gap-3 p-3 sm:p-5 md:p-8 overflow-y-auto lg:overflow-hidden">
      {/* Top WIN Banner */}
      <div className="flex flex-col items-center gap-2.5">
        <div
          className={`bg-[#090d14]/92 border-2 rounded-2xl px-8 py-3 shadow-2xl text-center ${
            glitchBoss ? 'border-red-500 glitch-fx' : 'border-amber-400'
          }`}
        >
          <div className="flex items-center justify-center gap-2 text-amber-400 font-display text-sm font-bold tracking-wider">
            <Trophy className="w-5 h-5" />
            <span>
              {bossDefeated
                ? `¡VICTORIA CONTRA ${bossDefeated.name.toUpperCase()} — WIN!`
                : '¡CARRERA FINALIZADA — WIN!'}
            </span>
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold text-white mt-0.5">
            {top3[0]?.name ?? 'Campeón'} Gana el Podio
          </h1>
          {(isNewRecord || unlockedNextChapter) && (
            <div className="text-xs font-semibold text-emerald-400 mt-1">
              {isNewRecord ? '¡Nuevo Récord de Pista! ' : ''}
              {unlockedNextChapter ? '· ¡Siguiente Capítulo Desbloqueado!' : ''}
            </div>
          )}
        </div>

        {/* Glitched Angry Boss Reaction Card (Jarvin.exe / Crash.exe) */}
        {bossDefeated && (
          <div
            className={`bg-[#14070b]/95 border-2 border-red-500 rounded-2xl px-5 py-2.5 shadow-2xl flex items-center gap-3 max-w-xl ${
              glitchBoss ? 'glitch-fx' : ''
            }`}
          >
            <CharacterExpressionAvatar
              characterId={bossDefeated.characterId}
              expression="angry"
              sizeClass="w-12 h-12"
              glitch={glitchBoss}
            />
            <div className="text-left">
              <div className="flex items-center gap-1.5 text-xs font-display font-bold text-red-400">
                <Skull className="w-3.5 h-3.5" />
                <span>{bossDefeated.name} FURIOSO:</span>
              </div>
              <div className="text-xs font-semibold text-white">“{bossDefeated.defeatLine}”</div>
            </div>
          </div>
        )}

        {/* Newly Unlocked Playable Character Banner */}
        {unlockedCharacter && (
          <div className="bg-[#090d14]/95 border-2 border-emerald-400 rounded-2xl px-6 py-2.5 shadow-2xl flex items-center gap-3">
            <CharacterExpressionAvatar
              characterId={unlockedCharacter.id}
              expression="win"
              sizeClass="w-11 h-11"
              glitch={unlockedCharacter.id === 'jarvin_exe'}
            />
            <div className="text-left">
              <div className="font-display font-bold text-sm text-emerald-400">
                ¡NUEVO CORREDOR DESBLOQUEADO: {unlockedCharacter.name.toUpperCase()}!
              </div>
              <div className="text-xs text-slate-200">
                Ya puedes seleccionarlo en el Garaje y en Multijugador.
              </div>
            </div>
          </div>
        )}

        {/* Relic Key Earned & Battle Mode Unlock Banner */}
        {keyLabel && (
          <div className="bg-[#090d14]/95 border-2 border-amber-400 rounded-2xl px-6 py-2.5 shadow-2xl flex items-center gap-3">
            <Key
              className={`w-6 h-6 ${
                earnedRelicKey === 'gold'
                  ? 'text-amber-400'
                  : earnedRelicKey === 'metal'
                    ? 'text-slate-200'
                    : 'text-orange-400'
              }`}
            />
            <div>
              <div className="font-display font-bold text-sm text-amber-300">
                ¡Conseguiste {keyLabel}!
              </div>
              {unlockedBattle && (
                <div className="text-xs font-bold text-emerald-400">
                  ¡MODO BATALLA A MUERTE DESBLOQUEADO!
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Results & Action Buttons */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-end justify-between gap-4">
        <div className="pointer-events-auto bg-[#090d14]/92 border border-white/15 rounded-2xl p-4 shadow-2xl flex-1 max-w-2xl">
          <div className="text-xs font-semibold text-slate-400 mb-2">
            Clasificación Final del Podio 3D
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {top3.map((racer, idx) => (
              <div
                key={racer.id}
                className={`p-3 rounded-xl border ${
                  idx === 0
                    ? 'bg-amber-400/15 border-amber-400'
                    : idx === 1
                      ? 'bg-slate-800/80 border-slate-500/50'
                      : 'bg-red-950/50 border-red-500/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-display font-bold text-sm text-white">
                    {idx + 1}° Lugar
                  </span>
                  <span className="font-mono-tabular text-xs text-slate-300">
                    {formatRaceTime(racer.finishTimeMs)}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <CharacterExpressionAvatar
                    characterId={racer.characterId}
                    expression={moodExpr[idx] ?? 'normal'}
                    sizeClass="w-8 h-8"
                  />
                  <div className="min-w-0">
                    <div className="font-display font-bold text-sm text-amber-300 truncate">
                      {racer.name}
                    </div>
                    <div className="text-[11px] text-slate-300">{moodLabels[idx]}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pointer-events-auto bg-[#090d14]/92 border border-white/15 rounded-2xl p-4 shadow-2xl flex flex-wrap lg:flex-col gap-2.5 min-w-[230px]">
          {hasNextTrack && (
            <button
              type="button"
              data-start="true"
              onClick={onNextTrack}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-sm cursor-pointer transition-colors whitespace-nowrap"
            >
              <span>Siguiente Pista</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onReplay}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display font-bold text-sm cursor-pointer transition-colors whitespace-nowrap"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Repetir Carrera</span>
          </button>
          <button
            type="button"
            onClick={onMainMenu}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white border border-white/15 font-semibold text-sm cursor-pointer transition-colors whitespace-nowrap"
          >
            <Home className="w-4 h-4" />
            <span>Volver al Menú</span>
          </button>
        </div>
      </div>
    </div>
  );
};
