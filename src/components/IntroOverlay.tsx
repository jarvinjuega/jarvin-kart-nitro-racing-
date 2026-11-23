import React from 'react';
import { FastForward, Gamepad2, MousePointerClick, Smartphone } from 'lucide-react';

interface IntroOverlayProps {
  onSkip: () => void;
}

export const IntroOverlay: React.FC<IntroOverlayProps> = ({ onSkip }) => {
  const handleContainerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === 0) {
      onSkip();
    }
  };

  return (
    <div
      data-testid="ctr-intro-overlay"
      onMouseDown={handleContainerMouseDown}
      className="fixed inset-0 z-20 pointer-events-auto cursor-pointer flex flex-col justify-between p-4 sm:p-6 md:p-10 select-none"
    >
      {/* Top Bar: Compact Studio Header & Skip Button (leaves center 3D CTR trophy stage clear!) */}
      <div className="flex items-start justify-between gap-3">
        <div className="bg-[#090d14]/88 border border-emerald-500/40 rounded-xl px-3.5 py-2 shadow-xl flex items-center gap-3">
          <img
            src="/assets/aistudio/channels4_profile_8411e407.jpg"
            alt="Jarvin Studios"
            referrerPolicy="no-referrer"
            className="w-9 h-9 rounded-lg object-cover border border-emerald-400"
          />
          <div>
            <div className="text-[10px] font-bold tracking-widest uppercase text-emerald-400">
              Jarvin Studios Presenta
            </div>
            <div className="font-display text-xs sm:text-sm font-bold text-white">
              JARVIN KART TURBO 3D
            </div>
          </div>
        </div>

        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onSkip}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#090d14]/92 hover:bg-emerald-600 text-white border border-white/25 font-semibold text-xs sm:text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-lg"
        >
          <span>Saltar</span>
          <FastForward className="w-4 h-4" />
        </button>
      </div>

      {/* Bottom CTR-style Continue Prompt */}
      <div className="flex flex-col items-center gap-3 mb-2 sm:mb-4">
        <button
          type="button"
          data-testid="intro-continue-btn"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onSkip}
          className="px-6 sm:px-8 py-3.5 rounded-2xl bg-amber-400 hover:bg-amber-300 active:scale-95 text-slate-950 border-2 border-white font-display font-extrabold text-sm sm:text-lg tracking-wide shadow-2xl transition-transform cursor-pointer animate-pulse"
        >
          TOCA PARA CONTINUAR
        </button>

        <div className="bg-[#090d14]/90 border border-amber-400/45 rounded-xl px-4 py-2.5 text-center shadow-2xl max-w-2xl">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs sm:text-sm font-semibold text-slate-100">
            <span className="inline-flex items-center gap-1.5">
              <MousePointerClick className="w-4 h-4 text-amber-300" />
              <span>Click Izquierdo (PC)</span>
            </span>
            <span className="text-slate-500">·</span>
            <span className="inline-flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-emerald-400" />
              <span>Botón Táctil (Celular)</span>
            </span>
            <span className="text-slate-500">·</span>
            <span className="inline-flex items-center gap-1.5">
              <Gamepad2 className="w-4 h-4 text-cyan-400" />
              <span>Botón X (Mando)</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
