import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, ChevronDown, Flame, Pause, Sparkles, Zap } from 'lucide-react';
import type { TouchControlState } from '../game/input';
import type { TouchControlsMode } from '../game/types';

interface TouchControlsPadProps {
  mode: TouchControlsMode;
  showPowerButton?: boolean;
  hasPowerUp?: boolean;
  turboEnergy?: number;
  isStunned?: boolean;
  onTouchState: (partial: Partial<TouchControlState>) => void;
  onTouchPulse: (action: 'jump' | 'item' | 'pause') => void;
}

type HoldButtonKey = 'left' | 'right' | 'accelerate' | 'brake';

export function useShouldShowTouchPad(mode: TouchControlsMode): boolean {
  const [visible, setVisible] = useState<boolean>(() => {
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    if (typeof window === 'undefined') return false;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    return coarse || (navigator.maxTouchPoints ?? 0) > 0 || window.innerWidth < 860;
  });

  useEffect(() => {
    const check = () => {
      if (mode === 'on') {
        setVisible(true);
        return;
      }
      if (mode === 'off') {
        setVisible(false);
        return;
      }
      const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
      setVisible(coarse || (navigator.maxTouchPoints ?? 0) > 0 || window.innerWidth < 860);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [mode]);

  return visible;
}

export const TouchControlsPad: React.FC<TouchControlsPadProps> = ({
  mode,
  showPowerButton = true,
  hasPowerUp = false,
  turboEnergy = 100,
  isStunned = false,
  onTouchState,
  onTouchPulse,
}) => {
  const visible = useShouldShowTouchPad(mode);
  const activePointersRef = useRef<Map<number, HoldButtonKey>>(new Map());
  const [pressedSet, setPressedSet] = useState<Set<HoldButtonKey>>(() => new Set());
  const [turboLatched, setTurboLatched] = useState(false);
  const turboLatchedRef = useRef(false);
  turboLatchedRef.current = turboLatched;

  const syncHeldState = useCallback(() => {
    const counts = new Set<HoldButtonKey>();
    for (const key of activePointersRef.current.values()) {
      counts.add(key);
    }
    setPressedSet(counts);
    const left = counts.has('left');
    const right = counts.has('right');
    onTouchState({
      accelerate: counts.has('accelerate'),
      brake: counts.has('brake'),
      turbo: turboLatchedRef.current,
      steer: left && !right ? -1 : right && !left ? 1 : 0,
    });
  }, [onTouchState]);

  const clearAll = useCallback(() => {
    activePointersRef.current.clear();
    turboLatchedRef.current = false;
    setTurboLatched(false);
    setPressedSet(new Set());
    onTouchState({ accelerate: false, brake: false, steer: 0, turbo: false });
  }, [onTouchState]);

  // Auto-release latched turbo when tank runs empty or kart is stunned
  useEffect(() => {
    if (turboLatched && (turboEnergy <= 2 || isStunned)) {
      turboLatchedRef.current = false;
      setTurboLatched(false);
      onTouchState({ turbo: false });
    }
  }, [turboLatched, turboEnergy, isStunned, onTouchState]);

  useEffect(() => {
    if (!visible) {
      clearAll();
    }
  }, [visible, clearAll]);

  useEffect(() => {
    const onBlur = () => clearAll();
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('blur', onBlur);
      activePointersRef.current.clear();
      onTouchState({ accelerate: false, brake: false, steer: 0, turbo: false });
    };
  }, [clearAll, onTouchState]);

  if (!visible) return null;

  const bindHold = (key: HoldButtonKey) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture is unsupported
      }
      activePointersRef.current.set(e.pointerId, key);
      syncHeldState();
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      activePointersRef.current.delete(e.pointerId);
      syncHeldState();
    },
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => {
      activePointersRef.current.delete(e.pointerId);
      syncHeldState();
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const bindPulse = (action: 'jump' | 'item' | 'pause') => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      onTouchPulse(action);
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const handleToggleTurboLatch = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const next = turboLatchedRef.current ? false : turboEnergy > 2 && !isStunned;
    turboLatchedRef.current = next;
    setTurboLatched(next);
    onTouchState({ turbo: next });
  };

  return (
    <div
      data-testid="touch-controls-pad"
      className="fixed inset-x-0 bottom-0 z-30 pointer-events-none flex items-end justify-between gap-1.5 px-2 pb-2 sm:px-5 sm:pb-5"
    >
      {/* Left Cluster: Steering Left & Right */}
      <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        <button
          type="button"
          data-testid="touch-left"
          aria-label="Girar izquierda"
          {...bindHold('left')}
          className={`touch-btn w-12 h-12 sm:w-20 sm:h-20 rounded-xl sm:rounded-2xl border-2 flex flex-col items-center justify-center shadow-2xl transition-transform active:scale-95 ${
            pressedSet.has('left')
              ? 'bg-emerald-400 text-slate-950 border-white scale-95'
              : 'bg-[#090d14]/82 text-white border-white/25'
          }`}
        >
          <ArrowLeft className="w-5 h-5 sm:w-8 sm:h-8" />
          <span className="text-[8px] sm:text-[10px] font-display font-bold">IZQ</span>
        </button>

        <button
          type="button"
          data-testid="touch-right"
          aria-label="Girar derecha"
          {...bindHold('right')}
          className={`touch-btn w-12 h-12 sm:w-20 sm:h-20 rounded-xl sm:rounded-2xl border-2 flex flex-col items-center justify-center shadow-2xl transition-transform active:scale-95 ${
            pressedSet.has('right')
              ? 'bg-emerald-400 text-slate-950 border-white scale-95'
              : 'bg-[#090d14]/82 text-white border-white/25'
          }`}
        >
          <ArrowRight className="w-5 h-5 sm:w-8 sm:h-8" />
          <span className="text-[8px] sm:text-[10px] font-display font-bold">DER</span>
        </button>
      </div>

      {/* Right Cluster: Jump, Power, Latched Turbo, Brake, Accelerate */}
      <div className="pointer-events-auto flex flex-col items-end gap-1.5 sm:gap-2 shrink-0">
        <div className="flex items-center gap-1 sm:gap-2">
          {showPowerButton && (
            <button
              type="button"
              data-testid="touch-item"
              aria-label="Lanzar poder"
              {...bindPulse('item')}
              className={`touch-btn px-2 sm:px-3.5 h-9 sm:h-14 rounded-lg sm:rounded-xl border-2 flex items-center justify-center gap-1 font-display font-bold text-[9px] sm:text-xs shadow-xl active:scale-95 ${
                hasPowerUp
                  ? 'bg-amber-400 text-slate-950 border-white animate-pulse'
                  : 'bg-[#090d14]/82 text-slate-300 border-white/25'
              }`}
            >
              <Sparkles className="w-3 h-3 sm:w-4 sm:h-4" />
              <span>PODER</span>
            </button>
          )}

          <button
            type="button"
            data-testid="touch-jump"
            aria-label="Saltar"
            {...bindPulse('jump')}
            className="touch-btn px-2 sm:px-3.5 h-9 sm:h-14 rounded-lg sm:rounded-xl border-2 bg-cyan-500/88 text-slate-950 border-cyan-200 flex items-center justify-center gap-1 font-display font-bold text-[9px] sm:text-xs shadow-xl active:scale-95"
          >
            <ArrowUp className="w-3 h-3 sm:w-4 sm:h-4" />
            <span>SALTAR</span>
          </button>

          <button
            type="button"
            data-testid="touch-turbo"
            aria-label="Turbo sostenido hasta vaciar"
            aria-pressed={turboLatched}
            onPointerDown={handleToggleTurboLatch}
            onContextMenu={(e) => e.preventDefault()}
            className={`touch-btn px-2 sm:px-3.5 h-9 sm:h-14 rounded-lg sm:rounded-xl border-2 flex items-center justify-center gap-1 font-display font-bold text-[9px] sm:text-xs shadow-xl active:scale-95 ${
              turboLatched
                ? 'bg-amber-400 text-slate-950 border-white animate-pulse'
                : 'bg-orange-600/88 text-white border-amber-300'
            }`}
          >
            <Flame className="w-3 h-3 sm:w-4 sm:h-4" />
            <span>{turboLatched ? 'TURBO ON' : 'TURBO'}</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2.5">
          <button
            type="button"
            data-testid="touch-brake"
            aria-label="Frenar o reversa"
            {...bindHold('brake')}
            className={`touch-btn w-13 h-11 sm:w-20 sm:h-16 rounded-xl sm:rounded-2xl border-2 flex flex-col items-center justify-center shadow-2xl active:scale-95 ${
              pressedSet.has('brake')
                ? 'bg-red-500 text-white border-white scale-95'
                : 'bg-slate-900/85 text-red-300 border-red-400/50'
            }`}
          >
            <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="text-[8px] sm:text-[10px] font-display font-bold">FRENAR</span>
          </button>

          <button
            type="button"
            data-testid="touch-accelerate"
            aria-label="Acelerar"
            {...bindHold('accelerate')}
            className={`touch-btn w-20 h-13 sm:w-28 sm:h-20 rounded-2xl border-2 flex flex-col items-center justify-center shadow-2xl active:scale-95 ${
              pressedSet.has('accelerate')
                ? 'bg-emerald-300 text-slate-950 border-white scale-95'
                : 'bg-emerald-500/92 text-slate-950 border-emerald-200'
            }`}
          >
            <Zap className="w-5 h-5 sm:w-7 sm:h-7 fill-current" />
            <span className="text-[10px] sm:text-[11px] font-display font-bold">ACELERAR</span>
          </button>
        </div>
      </div>

      {!showPowerButton && (
        <button
          type="button"
          aria-label="Pausa"
          {...bindPulse('pause')}
          className="hidden"
        >
          <Pause className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
