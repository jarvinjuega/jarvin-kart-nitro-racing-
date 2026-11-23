import React from 'react';
import { Flag } from 'lucide-react';

export interface LoadingScreenState {
  active: boolean;
  detail: string;
  stage: string;
  progress: number;
}

interface LoadingOverlayProps {
  state: LoadingScreenState | null;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ state }) => {
  if (!state || !state.active) return null;

  const pct = Math.max(5, Math.min(100, Math.round(state.progress)));

  return (
    <div
      data-testid="loading-overlay"
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-[#090d14] select-none"
    >
      {/* Checkered Racing Flag Background */}
      <div
        aria-hidden="true"
        className="racing-flag-bg animate-flag-wave absolute -inset-12 opacity-35"
      />
      {/* High-contrast racing scrim + emerald/amber diagonal sheen */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-[#090d14]/92 via-[#090d14]/72 to-[#090d14]/95"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-emerald-400 via-amber-400 to-emerald-400"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-2 bg-gradient-to-r from-amber-400 via-emerald-400 to-amber-400"
      />

      {/* Centered Loading Card */}
      <div className="relative z-10 w-full max-w-lg mx-4 bg-[#090d14]/92 border border-white/20 rounded-2xl p-6 sm:p-8 shadow-2xl flex flex-col items-center text-center gap-5">
        {/* Flowing SVG Checkered Flag Emblem */}
        <div className="w-24 h-16 rounded-xl overflow-hidden border-2 border-amber-400 shadow-lg bg-slate-950 flex items-center justify-center">
          <svg viewBox="0 0 120 80" className="w-full h-full" aria-hidden="true">
            <rect width="120" height="80" fill="#0f172a" />
            {[0, 1, 2, 3, 4, 5].map((col) =>
              [0, 1, 2, 3].map((row) =>
                (col + row) % 2 === 0 ? (
                  <rect
                    key={`${col}-${row}`}
                    x={col * 20}
                    y={row * 20}
                    width="20"
                    height="20"
                    fill="#f8fafc"
                  />
                ) : null,
              ),
            )}
            <path
              d="M0 0 Q30 12 60 0 T120 0 L120 80 Q90 68 60 80 T0 80 Z"
              fill="rgba(250, 204, 21, 0.14)"
            />
          </svg>
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-amber-300 tracking-widest uppercase">
            <Flag className="w-3.5 h-3.5" />
            <span>Jarvin Kart Turbo 3D</span>
          </div>
          <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-wider text-white">
            LOADING...
          </h2>
          <p className="text-sm text-slate-200 font-medium max-w-md">
            {state.detail}
          </p>
        </div>

        {/* Progress Bar */}
        <div className="w-full flex flex-col gap-2">
          <div className="w-full h-3.5 bg-slate-900 border border-white/15 rounded-full overflow-hidden p-0.5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-emerald-400 transition-[width] duration-150 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span>{state.stage}</span>
            <span className="font-mono-tabular font-bold text-amber-300">{pct}%</span>
          </div>
        </div>
      </div>
    </div>
  );
};
