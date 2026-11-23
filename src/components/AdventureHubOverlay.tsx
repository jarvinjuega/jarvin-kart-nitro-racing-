import React from 'react';
import { ArrowLeft, Compass, Crown, DoorOpen, Lock, Trophy } from 'lucide-react';
import type { HubPortalHint, SaveProgress, TouchControlsMode } from '../game/types';
import type { TouchControlState } from '../game/input';
import { TRACKS } from '../game/constants';
import { TouchControlsPad, useShouldShowTouchPad } from './TouchControlsPad';

interface AdventureHubOverlayProps {
  save: SaveProgress;
  nearbyPortal: HubPortalHint | null;
  touchControls?: TouchControlsMode;
  onTouchState?: (partial: Partial<TouchControlState>) => void;
  onTouchPulse?: (action: 'jump' | 'item' | 'pause') => void;
  onEnterPortal: (trackId: string, isBossPortal: boolean) => void;
  onBackToMenu: () => void;
}

export const AdventureHubOverlay: React.FC<AdventureHubOverlayProps> = ({
  save,
  nearbyPortal,
  touchControls = 'auto',
  onTouchState,
  onTouchPulse,
  onEnterPortal,
  onBackToMenu,
}) => {
  const winsCount = save.adventureCompletedTracks.length;
  const bossUnlocked = winsCount >= 5;
  const touchVisible = useShouldShowTouchPad(touchControls);
  const currentActiveTrack =
    TRACKS.find((t) => !save.adventureCompletedTracks.includes(t.id) && t.chapter <= save.unlockedChapters) ??
    TRACKS[Math.min(save.unlockedChapters - 1, TRACKS.length - 1)] ??
    TRACKS[0];

  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-4 md:p-6">
      {/* Top Bar */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="pointer-events-auto flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToMenu}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#090d14]/92 hover:bg-slate-800 text-white border border-white/15 font-semibold text-sm cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Menú Principal</span>
          </button>

          <div className="bg-[#090d14]/92 border border-emerald-500/35 rounded-xl px-4 py-2 shadow-xl">
            <div className="flex items-center gap-2 font-display font-bold text-sm text-white">
              <Compass className="w-4 h-4 text-emerald-400" />
              <span>MAPA AVENTURA 3D (MUNDO DE PORTALES)</span>
            </div>
            <div className="text-xs text-slate-300 mt-0.5">
              Conduce hacia cualquier portal iluminado para entrar a la pista. ¡Gana en 1° lugar para desbloquear el siguiente!
            </div>
          </div>
        </div>

        {/* Adventure Progress Counter toward 5-Race Jarvin.exe Cutscene */}
        <div className="pointer-events-auto bg-[#090d14]/92 border border-amber-400/40 rounded-xl px-4 py-2.5 shadow-xl">
          <div className="flex items-center gap-2 text-xs font-display font-bold text-amber-300">
            <Trophy className="w-4 h-4" />
            <span>Capítulos Desbloqueados: {save.unlockedChapters}/{TRACKS.length}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-200 mt-1">
            <Crown className="w-3.5 h-3.5 text-red-400" />
            <span>
              Carreras Ganadas (1°): <strong className="text-white">{winsCount}/5</strong>{' '}
              {bossUnlocked ? '· ¡Portal de Jarvin.exe Abierto!' : 'para despertar a Jarvin.exe'}
            </span>
          </div>
        </div>
      </div>

      {/* Nearby Portal Prompt or Quick Enter CTA */}
      <div className={`flex flex-col items-center gap-3 ${touchVisible ? 'mb-36 sm:mb-40' : ''}`}>
        {nearbyPortal ? (
          <div className="pointer-events-auto bg-[#090d14]/95 border-2 border-amber-400 rounded-2xl px-6 py-4 shadow-2xl text-center max-w-md">
            <div className="text-xs font-display font-bold uppercase tracking-wider text-amber-300">
              {nearbyPortal.isBossPortal
                ? 'PORTAL DE JEFE CORRUPTO'
                : `PORTAL CAPÍTULO ${nearbyPortal.chapter}`}
            </div>
            <div className="font-display text-xl font-bold text-white mt-0.5">
              {nearbyPortal.trackName}
            </div>
            {nearbyPortal.unlocked ? (
              <button
                type="button"
                onClick={() => onEnterPortal(nearbyPortal.trackId, Boolean(nearbyPortal.isBossPortal))}
                className="mt-3 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-sm cursor-pointer"
              >
                <DoorOpen className="w-4 h-4" />
                <span>Entrar al Portal</span>
              </button>
            ) : (
              <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-red-300 font-semibold">
                <Lock className="w-3.5 h-3.5" />
                <span>
                  {nearbyPortal.isBossPortal
                    ? 'Gana 5 carreras en 1° lugar para abrir este portal'
                    : 'Gana el capítulo anterior en 1° lugar para desbloquear'}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2.5 bg-[#090d14]/90 border border-white/15 rounded-xl px-4 py-2.5 shadow-xl">
            <span className="text-xs text-slate-300">
              Conduce con <strong className="text-white">WASD / Mando</strong> · <strong className="text-cyan-300">V</strong> Vista Frontal/Atrás · O entra directo:
            </span>
            <button
              type="button"
              onClick={() => onEnterPortal(currentActiveTrack.id, false)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-xs cursor-pointer"
            >
              <DoorOpen className="w-3.5 h-3.5" />
              <span>Ir a {currentActiveTrack.name}</span>
            </button>
            {bossUnlocked && (
              <button
                type="button"
                onClick={() => onEnterPortal('neon_metropolis', true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-display font-bold text-xs cursor-pointer"
              >
                <Crown className="w-3.5 h-3.5" />
                <span>Retar a Jarvin.exe</span>
              </button>
            )}
          </div>
        )}
      </div>

      {onTouchState && onTouchPulse && (
        <TouchControlsPad
          mode={touchControls}
          showPowerButton={false}
          onTouchState={onTouchState}
          onTouchPulse={onTouchPulse}
        />
      )}
    </div>
  );
};
