import React, { useEffect, useState } from 'react';
import { ArrowRight, Home, Play, RotateCcw, Skull, Trophy } from 'lucide-react';
import type { BossCutsceneOutcome, BossSpec, CharacterSpec } from '../game/types';
import { CharacterExpressionAvatar } from './CharacterExpressionAvatar';

interface BossCutsceneOverlayProps {
  boss: BossSpec;
  outcome?: BossCutsceneOutcome;
  unlockedCharacter?: CharacterSpec | null;
  onStartBattle: () => void;
  onContinueToPodium?: () => void;
  onCancel: () => void;
}

export const BossCutsceneOverlay: React.FC<BossCutsceneOverlayProps> = ({
  boss,
  outcome = 'intro',
  unlockedCharacter,
  onStartBattle,
  onContinueToPodium,
  onCancel,
}) => {
  const [lineIdx, setLineIdx] = useState(0);

  useEffect(() => {
    setLineIdx(0);
  }, [boss.id, outcome]);

  const dialogueLines =
    outcome === 'victory'
      ? [boss.defeatLine]
      : outcome === 'defeat'
        ? (boss.loseTauntLines && boss.loseTauntLines.length > 0
            ? boss.loseTauntLines
            : boss.tauntLines)
        : boss.tauntLines;

  const currentLine = dialogueLines[lineIdx] ?? dialogueLines[0] ?? '';
  const hasMoreLines = lineIdx < dialogueLines.length - 1;

  const bannerTitle =
    outcome === 'victory'
      ? `¡${boss.name} DERROTADO!`
      : outcome === 'defeat'
        ? `¡${boss.name} GANÓ EL DUELO!`
        : `${boss.name} — ${boss.title}`;

  const bannerSub =
    outcome === 'victory'
      ? 'CINEMÁTICA DE VICTORIA 3D'
      : outcome === 'defeat'
        ? 'CINEMÁTICA DE DERROTA 3D'
        : 'CINEMÁTICA DE JEFE 3D';

  const avatarExpr =
    outcome === 'victory' ? 'dizzy' : outcome === 'defeat' ? 'laughing' : 'angry';

  return (
    <div className="fixed inset-0 z-30 pointer-events-none flex flex-col justify-between p-4 sm:p-5 md:p-8">
      {/* Top Boss Banner */}
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div
          className={`bg-[#090d14]/92 border-2 rounded-2xl px-4 sm:px-6 py-3 shadow-2xl ${
            outcome === 'victory' ? 'border-emerald-400' : 'border-red-500'
          } ${boss.glitchOnDefeat ? 'glitch-fx' : ''}`}
        >
          <div
            className={`flex items-center gap-2 font-display text-[11px] sm:text-xs font-bold tracking-widest ${
              outcome === 'victory' ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {outcome === 'victory' ? <Trophy className="w-4 h-4" /> : <Skull className="w-4 h-4" />}
            <span>{bannerSub}</span>
          </div>
          <h1 className="font-display text-xl sm:text-2xl md:text-4xl font-bold text-white mt-0.5">
            {bannerTitle}
          </h1>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="pointer-events-auto px-4 py-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 border border-white/15 text-xs font-semibold cursor-pointer"
        >
          {outcome === 'intro' ? 'Cancelar' : 'Menú'}
        </button>
      </div>

      {/* Bottom 2D Expressive Dialogue Box */}
      <div className="flex flex-col items-center gap-3 w-full">
        {outcome === 'victory' && unlockedCharacter && (
          <div className="pointer-events-auto bg-[#090d14]/95 border-2 border-emerald-400 rounded-2xl px-5 py-2.5 shadow-2xl flex items-center gap-3 max-w-2xl">
            <CharacterExpressionAvatar
              characterId={unlockedCharacter.id}
              expression="win"
              sizeClass="w-11 h-11"
              glitch={unlockedCharacter.id === 'jarvin_exe'}
            />
            <div>
              <div className="font-display font-bold text-xs sm:text-sm text-emerald-400">
                ¡DESBLOQUEASTE A {unlockedCharacter.name.toUpperCase()}!
              </div>
              <div className="text-xs text-slate-200">
                Ya está disponible en el Garaje y Multijugador.
              </div>
            </div>
          </div>
        )}

        <div
          className={`pointer-events-auto mx-auto w-full max-w-3xl bg-[#090d14]/95 border-2 rounded-2xl p-4 md:p-5 shadow-2xl flex flex-col sm:flex-row items-center gap-4 ${
            outcome === 'victory' ? 'border-emerald-400/70' : 'border-red-500/60'
          }`}
        >
          <CharacterExpressionAvatar
            characterId={boss.characterId}
            expression={avatarExpr}
            sizeClass="w-16 h-16 sm:w-20 sm:h-20"
            glitch={boss.glitchOnDefeat}
          />

          <div className="flex-1 min-w-0 text-center sm:text-left">
            <div
              className={`font-display font-bold text-xs sm:text-sm uppercase tracking-wide ${
                outcome === 'victory' ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {outcome === 'victory'
                ? `${boss.name} fue derrotado:`
                : outcome === 'defeat'
                  ? `${boss.name} se burla:`
                  : `${boss.name} dice:`}
            </div>
            <p className="text-sm sm:text-base md:text-lg font-semibold text-white mt-1">
              “{currentLine}”
            </p>
            <p className="text-xs text-slate-400 mt-1">{boss.description}</p>
          </div>

          <div className="flex flex-wrap sm:flex-col gap-2 shrink-0 justify-center">
            {hasMoreLines ? (
              <button
                type="button"
                onClick={() => setLineIdx((i) => i + 1)}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display font-bold text-sm cursor-pointer"
              >
                <span>Siguiente</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : outcome === 'victory' ? (
              <>
                {onContinueToPodium && (
                  <button
                    type="button"
                    data-start="true"
                    onClick={onContinueToPodium}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-sm cursor-pointer shadow-lg"
                  >
                    <Trophy className="w-4 h-4" />
                    <span>Ver Podio 3D</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onStartBattle}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white border border-white/15 font-display font-bold text-xs cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Revancha</span>
                </button>
              </>
            ) : outcome === 'defeat' ? (
              <>
                <button
                  type="button"
                  data-start="true"
                  onClick={onStartBattle}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-display font-bold text-sm cursor-pointer shadow-lg"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>¡Revancha!</span>
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/15 font-semibold text-xs cursor-pointer"
                >
                  <Home className="w-3.5 h-3.5" />
                  <span>Menú</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                data-start="true"
                onClick={onStartBattle}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-display font-bold text-sm cursor-pointer shadow-lg"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>¡Comenzar Duelo!</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
