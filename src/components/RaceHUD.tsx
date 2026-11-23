import React from 'react';
import {
  Bomb,
  Camera,
  Crosshair,
  Flame,
  FlaskConical,
  Pause,
  Play,
  RotateCcw,
  Shield,
  Skull,
  Sliders,
  Sparkles,
  Timer,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import type { MinimapSnapshot, PowerUpType, RaceHudSnapshot, TouchControlsMode } from '../game/types';
import type { TouchControlState } from '../game/input';
import { BOSS_MAP, CHARACTER_MAP, formatRaceTime } from '../game/constants';
import { CharacterExpressionAvatar } from './CharacterExpressionAvatar';
import { TouchControlsPad, useShouldShowTouchPad } from './TouchControlsPad';

interface RaceHUDProps {
  hud: RaceHudSnapshot | null;
  playerCount: number;
  paused: boolean;
  muted: boolean;
  touchControls?: TouchControlsMode;
  onTouchState?: (partial: Partial<TouchControlState>) => void;
  onTouchPulse?: (action: 'jump' | 'item' | 'pause') => void;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onToggleCamera?: () => void;
  onRestartRace: () => void;
  onOpenControlSettings: () => void;
  onExitToMenu: () => void;
}

function renderPowerUpLabel(item: PowerUpType): { label: string; icon: React.ReactNode; color: string } | null {
  if (item === 'aku_aku') {
    return { label: 'Máscara Aku Aku', icon: <Sparkles className="w-4 h-4 text-amber-300" />, color: 'border-amber-400 text-amber-200' };
  }
  if (item === 'homing_rocket') {
    return { label: 'Cohete Buscador', icon: <Flame className="w-4 h-4 text-red-400" />, color: 'border-red-500 text-red-200' };
  }
  if (item === 'bowling_bomb') {
    return { label: 'Bomba Boliche', icon: <Bomb className="w-4 h-4 text-orange-400" />, color: 'border-orange-400 text-orange-200' };
  }
  if (item === 'warp_orb') {
    return { label: 'Orbe Warp (1°)', icon: <Sparkles className="w-4 h-4 text-cyan-300" />, color: 'border-cyan-400 text-cyan-200' };
  }
  if (item === 'time_clock') {
    return { label: 'Reloj N. Tropy', icon: <Timer className="w-4 h-4 text-sky-300" />, color: 'border-sky-400 text-sky-200' };
  }
  if (item === 'tnt') {
    return { label: 'Caja TNT (Atrás)', icon: <Bomb className="w-4 h-4 text-red-400" />, color: 'border-red-500 text-red-200' };
  }
  if (item === 'potion') {
    return { label: 'Pócima Resbalosa (5s)', icon: <FlaskConical className="w-4 h-4 text-lime-400" />, color: 'border-lime-400 text-lime-200' };
  }
  if (item === 'turbo_boost') {
    return { label: 'Super Turbo', icon: <Zap className="w-4 h-4 text-emerald-300" />, color: 'border-emerald-400 text-emerald-200' };
  }
  if (item === 'shield') {
    return { label: 'Escudo Dorado', icon: <Shield className="w-4 h-4 text-amber-300" />, color: 'border-amber-400 text-amber-200' };
  }
  if (item === 'bolt') {
    return { label: 'Rayo (1x1 Todos)', icon: <Zap className="w-4 h-4 text-cyan-300" />, color: 'border-cyan-400 text-cyan-200' };
  }
  if (item === 'shockwave') {
    return { label: 'Onda Choque', icon: <Sparkles className="w-4 h-4 text-fuchsia-300" />, color: 'border-fuchsia-400 text-fuchsia-200' };
  }
  return null;
}

const MinimapBox: React.FC<{
  minimap?: MinimapSnapshot;
  highlightPlayerIndex?: number;
  compact?: boolean;
}> = ({ minimap, highlightPlayerIndex, compact = false }) => {
  if (!minimap || minimap.path.length < 3) return null;
  const polyPoints = minimap.path.map((pt) => `${pt.x},${pt.y}`).join(' ');
  const startPt = minimap.path[0];

  return (
    <div
      className={`bg-[#090d14]/88 border border-white/15 rounded-xl p-1.5 shadow-xl ${
        compact ? 'w-20 h-16 sm:w-24 sm:h-20' : 'w-36 h-32 md:w-44 md:h-36'
      }`}
    >
      <svg viewBox="-8 -8 116 116" className="w-full h-full overflow-visible">
        <polygon
          points={polyPoints}
          fill="none"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth="9"
          strokeLinejoin="round"
        />
        <polygon
          points={polyPoints}
          fill="none"
          stroke="#94a3b8"
          strokeWidth="4"
          strokeLinejoin="round"
        />
        {startPt && (
          <circle cx={startPt.x} cy={startPt.y} r="3.5" fill="#facc15" stroke="#090d14" strokeWidth="1.5" />
        )}
        {minimap.markers.map((m) => {
          const isFocus = m.isPlayer && (highlightPlayerIndex === undefined || m.playerIndex === highlightPlayerIndex);
          return (
            <g key={m.id}>
              {isFocus && (
                <circle
                  cx={m.x}
                  cy={m.y}
                  r="7.2"
                  fill="none"
                  stroke="#facc15"
                  strokeWidth="2"
                />
              )}
              <circle
                cx={m.x}
                cy={m.y}
                r={isFocus ? 5.2 : 3.8}
                fill={isFocus ? '#22c55e' : m.color}
                stroke="#090d14"
                strokeWidth="1.5"
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export const RaceHUD: React.FC<RaceHUDProps> = ({
  hud,
  playerCount,
  paused,
  muted,
  touchControls = 'auto',
  onTouchState,
  onTouchPulse,
  onTogglePause,
  onToggleMute,
  onToggleCamera,
  onRestartRace,
  onOpenControlSettings,
  onExitToMenu,
}) => {
  const countdown = hud?.countdown ?? 0;
  const topFour = (hud?.standings ?? []).slice(0, 4);
  const isBattle = hud?.mode === 'battle';
  const isRelic = hud?.mode === 'relic';
  const isBoss = hud?.mode === 'boss';
  const isElimination = hud?.mode === 'elimination';
  const isTokens = hud?.mode === 'tokens';
  const isMadness = hud?.mode === 'madness';
  const bossSpec = hud?.bossId ? BOSS_MAP[hud.bossId] : undefined;
  const touchVisible = useShouldShowTouchPad(touchControls) && playerCount === 1 && !paused;
  const p1HasItem = Boolean(hud?.players[0]?.heldItem);
  const p1TurboEnergy = hud?.players[0]?.turboEnergy ?? 0;
  const p1Stunned = Boolean(hud?.players[0]?.stunned);
  const isEightGrid = playerCount >= 5;

  const gridClass =
    playerCount === 1
      ? 'grid-cols-1 grid-rows-1'
      : playerCount === 2
        ? 'grid-cols-1 grid-rows-2'
        : playerCount <= 4
          ? 'grid-cols-2 grid-rows-2'
          : 'grid-cols-4 grid-rows-2';

  const cellCount = playerCount === 3 ? 4 : isEightGrid ? 8 : playerCount;

  return (
    <div className="fixed inset-0 z-20 pointer-events-none">
      {/* Split-Screen Viewport Overlay Grid */}
      <div className={`w-full h-full grid ${gridClass}`}>
        {Array.from({ length: cellCount }).map((_, idx) => {
          if (playerCount === 3 && idx === 3) {
            return (
              <div
                key="standings-quad"
                className="border-t border-l border-white/25 bg-[#090d14]/92 p-4 flex flex-col justify-center"
              >
                <div className="font-display text-xs font-bold text-emerald-400 mb-2">
                  {isBattle ? 'Bajas en Vivo (1° - 4°)' : 'Posiciones en Vivo (1° - 4°)'}
                </div>
                <div className="flex flex-col gap-1.5">
                  {topFour.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between bg-slate-900/90 px-3 py-1.5 rounded-lg text-xs border border-white/10"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-display font-bold text-amber-400 w-5">{s.rank}°</span>
                        <CharacterExpressionAvatar characterId={s.characterId} sizeClass="w-6 h-6" />
                        <span className="font-display font-bold text-white truncate">{s.name}</span>
                      </div>
                      <span className="font-mono-tabular text-slate-300 shrink-0">
                        {isBattle ? `${s.battleKills} Bajas` : `V${s.lap}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          if (isEightGrid && idx >= playerCount) {
            return (
              <div
                key={`empty-${idx}`}
                className="border border-white/15 bg-[#090d14]/92 p-3 flex flex-col justify-center items-center text-center"
              >
                <div className="font-display text-xs font-bold text-emerald-400">MODO {playerCount}J PC</div>
                <div className="text-[11px] text-slate-400 mt-1">Espacio libre de pantalla</div>
              </div>
            );
          }

          const p = hud?.players[idx];
          const itemMeta = p?.heldItem ? renderPowerUpLabel(p.heldItem) : null;
          const charSpec = p ? CHARACTER_MAP[p.characterId] : undefined;
          const driftColor =
            p?.driftStage === 3
              ? 'bg-red-500 text-white'
              : p?.driftStage === 2
                ? 'bg-amber-400 text-slate-950'
                : p?.driftStage === 1
                  ? 'bg-emerald-400 text-slate-950'
                  : '';

          return (
            <div
              key={idx}
              className={`relative flex flex-col justify-between ${
                isEightGrid ? 'p-1.5 sm:p-2 border border-white/25' : 'p-3 md:p-5'
              } ${playerCount === 2 && idx === 0 ? 'border-b-2 border-white/35' : ''} ${
                playerCount >= 3 && !isEightGrid ? 'border border-white/20' : ''
              }`}
            >
              {/* Top Corner Row */}
              <div className="flex items-start justify-between gap-1.5">
                <div
                  className={`flex items-center gap-2 bg-[#090d14]/90 border border-white/15 rounded-xl shadow-lg ${
                    isEightGrid ? 'px-2 py-1' : 'px-3 py-2'
                  }`}
                >
                  <CharacterExpressionAvatar
                    characterId={p?.characterId ?? 'jarvin'}
                    expression={p?.expression ?? 'normal'}
                    sizeClass={isEightGrid ? 'w-7 h-7' : 'w-10 h-10 md:w-11 md:h-11'}
                  />
                  <div
                    className={`font-display font-bold text-amber-400 leading-none tabular-nums ${
                      isEightGrid ? 'text-lg' : 'text-2xl md:text-3xl'
                    }`}
                  >
                    {p?.rank ?? 1}°
                    {!isEightGrid && (
                      <span className="text-xs text-slate-400 font-normal">
                        /{p?.totalRacers ?? 5}
                      </span>
                    )}
                  </div>
                  <div className="h-6 w-px bg-white/15" />
                  <div>
                    <div className="text-[10px] text-slate-300 font-semibold leading-none truncate max-w-[95px]">
                      {playerCount > 1 ? `J${idx + 1} · ${charSpec?.name ?? p?.name ?? ''}` : charSpec?.name ?? 'Corredor'}
                    </div>
                    <div
                      className={`font-display font-bold text-white tabular-nums mt-0.5 ${
                        isEightGrid ? 'text-xs' : 'text-sm md:text-base'
                      }`}
                    >
                      {isBattle
                        ? `Bajas ${p?.battleKills ?? 0}/${hud?.battleKillGoal ?? 5}`
                        : isElimination
                          ? p?.eliminated
                            ? 'ELIMINADO'
                            : `Ronda ${hud?.eliminationRound ?? 1}`
                          : `V${p?.lap ?? 1}/${p?.totalLaps ?? 3}`}
                    </div>
                  </div>
                </div>

                {/* Power-Up Socket + Wumpa Fruit Counter */}
                <div className="flex flex-col items-end gap-1">
                  {itemMeta ? (
                    <div
                      className={`flex items-center gap-1.5 bg-[#090d14]/92 border-2 rounded-xl ${
                        isEightGrid ? 'px-2 py-1' : 'px-3 py-2'
                      } ${itemMeta.color} ${
                        p?.juicedPowers ? 'ring-2 ring-amber-300 shadow-[0_0_16px_rgba(250,204,21,0.45)]' : ''
                      }`}
                    >
                      {itemMeta.icon}
                      {!isEightGrid && (
                        <span className="font-display font-bold text-xs">
                          {itemMeta.label}
                          {p?.juicedPowers ? ' ★' : ''}
                        </span>
                      )}
                    </div>
                  ) : !isEightGrid ? (
                    <div className="bg-[#090d14]/75 border border-white/10 rounded-xl px-3 py-2 text-[11px] text-slate-400">
                      {isBattle ? 'Busca Cohete' : 'Sin Poder'}
                    </div>
                  ) : null}

                  {!isBattle && !isRelic && hud?.mode !== 'timetrial' && !isEightGrid && (
                    <div
                      data-testid={`wumpa-hud-${idx}`}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-mono-tabular font-bold shadow ${
                        p?.juicedPowers
                          ? 'bg-gradient-to-r from-orange-500/90 to-amber-400/90 text-slate-950 border-yellow-200'
                          : 'bg-[#090d14]/88 text-amber-300 border-amber-500/35'
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full bg-orange-500 border border-yellow-200 shrink-0" />
                      <span>Wumpas: {p?.wumpas ?? 0}/10</span>
                      {p?.juicedPowers && <span className="font-display text-[10px]">¡MEJORADO!</span>}
                    </div>
                  )}
                </div>
              </div>

              {/* Status Alerts */}
              <div className="self-center flex flex-col items-center gap-1">
                {p?.eliminated && (
                  <div className="bg-red-700/95 text-white font-display font-bold text-xs sm:text-sm px-4 py-1.5 rounded-lg border-2 border-red-300 shadow-lg">
                    ELIMINADO · ESPERANDO RESULTADO
                  </div>
                )}
                {p?.wrongWay && !isBattle && !p.eliminated && (
                  <div className="bg-red-600/95 text-white font-display font-bold text-xs sm:text-sm px-3 py-1 rounded-lg border border-red-300">
                    ¡Sentido Contrario!
                  </div>
                )}
                {p && p.tntTimer > 0 && (
                  <div className="bg-red-600 text-white font-display font-bold text-xs px-3 py-1 rounded-lg border-2 border-amber-300 shadow-lg">
                    ¡TNT! SALTA 2x ({p.tntShakeJumps}/2) · {p.tntTimer.toFixed(1)}s
                  </div>
                )}
                {p?.burnActive && (
                  <div className="bg-orange-600/95 text-white font-display font-bold text-[11px] px-3 py-0.5 rounded-lg border border-amber-300">
                    ¡QUEMADO! (2s · Detenido)
                  </div>
                )}
                {p?.slipperyActive && (
                  <div className="bg-lime-500/95 text-slate-950 font-display font-bold text-[11px] px-3 py-0.5 rounded-lg border border-lime-200">
                    ¡AUTO RESBALOSO! (5s)
                  </div>
                )}
                {p?.timeSlowActive && (
                  <div className="bg-sky-600/95 text-white font-display font-bold text-[11px] px-3 py-0.5 rounded-lg border border-sky-200">
                    ¡RALENTIZADO POR RELOJ!
                  </div>
                )}
                {p?.slowActive && (
                  <div className="bg-purple-700/95 text-white font-display font-bold text-[11px] px-3 py-0.5 rounded-lg border border-purple-300">
                    ¡VELOCIDAD REDUCIDA!
                  </div>
                )}
                {p?.akuAkuActive && (
                  <div
                    data-testid="aku-aku-hud-timer"
                    className="bg-amber-500/95 text-slate-950 font-display font-bold text-[11px] px-3 py-0.5 rounded-lg border border-yellow-200"
                  >
                    AKU AKU ACTIVO ·{' '}
                    <span className="font-mono-tabular">{(p.akuAkuTimer ?? 0).toFixed(1)}s</span>
                  </div>
                )}
                {isRelic && (hud?.timeFreezeTimer ?? 0) > 0 && (
                  <div className="bg-amber-400 text-slate-950 font-display font-bold text-xs px-4 py-1 rounded-lg border border-white shadow">
                    TIEMPO CONGELADO · {(hud?.timeFreezeTimer ?? 0).toFixed(1)}s
                  </div>
                )}
                {p && p.driftStage > 0 && !isEightGrid && (
                  <div className={`font-display font-bold text-[11px] px-3 py-0.5 rounded-md shadow ${driftColor}`}>
                    DERRAPE NIVEL {p.driftStage}
                  </div>
                )}
                {p?.inAntigravity && !isEightGrid && (
                  <div className="bg-cyan-500/95 text-slate-950 font-display font-bold text-[11px] px-3 py-0.5 rounded-md border border-white shadow">
                    ANTIGRAVEDAD · +VELOCIDAD & TURBO
                  </div>
                )}
              </div>

              {/* Bottom Row */}
              <div className={`flex items-end justify-between gap-2 ${touchVisible ? 'mb-36 sm:mb-40' : ''}`}>
                <div
                  className={`bg-[#090d14]/90 border border-white/15 rounded-xl flex items-baseline gap-1 ${
                    isEightGrid ? 'px-2 py-1' : 'px-3 py-1.5 sm:px-3.5 sm:py-2 sm:gap-2'
                  }`}
                >
                  <span
                    className={`font-mono-tabular font-bold text-white leading-none ${
                      isEightGrid ? 'text-sm' : 'text-xl sm:text-2xl md:text-3xl'
                    }`}
                  >
                    {p?.speedKmh ?? 0}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400">km/h</span>
                </div>

                {/* Right Corner Stack: Minimap Directly Above Turbo */}
                <div className="flex flex-col items-end gap-1.5">
                  {!isEightGrid && (
                    <MinimapBox
                      minimap={hud?.minimap}
                      highlightPlayerIndex={p?.playerIndex ?? idx}
                      compact={playerCount > 1 || touchVisible}
                    />
                  )}

                  <div
                    className={`bg-[#090d14]/90 border border-white/15 rounded-xl ${
                      isEightGrid ? 'px-2 py-1 w-24' : 'px-2.5 py-1.5 sm:px-3 sm:py-2 w-32 sm:w-36 md:w-48'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] mb-0.5">
                      <span className="font-semibold text-slate-300">
                        {p?.turboActive ? 'TURBO' : 'Turbo'}
                      </span>
                      <span className="font-mono-tabular text-emerald-400">
                        {p?.turboEnergy ?? 0}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-75 ${
                          p?.turboActive ? 'bg-amber-400' : 'bg-emerald-400'
                        }`}
                        style={{ width: `${p?.turboEnergy ?? 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Left-Center Live Standings Ladder (hide in 8-player PC grid to preserve viewports) */}
      {(hud?.standings ?? []).length > 0 && !isEightGrid && (
        <div
          data-testid="left-standings-hud"
          className={`fixed left-2 sm:left-2.5 md:left-4 z-20 flex flex-col gap-1 bg-[#090d14]/90 border border-white/15 rounded-xl p-1.5 sm:p-2 shadow-2xl ${
            playerCount === 1
              ? touchVisible
                ? 'top-28 sm:top-24 md:top-1/2 md:-translate-y-1/2 w-32 sm:w-44 md:w-52'
                : 'top-1/2 -translate-y-1/2 w-40 sm:w-48 md:w-56'
              : 'top-[25%] -translate-y-1/2 w-36 sm:w-40 md:w-48'
          }`}
        >
          <div className="text-[10px] font-display font-bold uppercase tracking-wider text-slate-400 px-1">
            {isBattle
              ? 'Bajas (Meta 5)'
              : isElimination
                ? `Vivos (${hud?.aliveRacers ?? 0})`
                : `Puestos 1° - ${Math.min(5, (hud?.standings ?? []).length)}°`}
          </div>
          {(hud?.standings ?? []).slice(0, 5).map((s) => {
            const rankBadgeColor =
              s.rank === 1
                ? 'text-amber-400'
                : s.rank === 2
                  ? 'text-slate-200'
                  : s.rank === 3
                    ? 'text-orange-400'
                    : 'text-slate-400';

            return (
              <div
                key={s.id}
                className={`flex items-center gap-2 px-2 py-1 rounded-lg border ${
                  s.eliminated
                    ? 'bg-red-950/60 border-red-500/30 opacity-55'
                    : s.isPlayer
                      ? 'bg-emerald-500/20 border-emerald-400/60'
                      : 'bg-slate-900/85 border-white/10'
                }`}
              >
                <span className={`font-display font-bold text-xs w-5 shrink-0 ${rankBadgeColor}`}>
                  {s.rank}°
                </span>
                <CharacterExpressionAvatar characterId={s.characterId} sizeClass="w-7 h-7 md:w-8 md:h-8" />
                <span className="font-display font-semibold text-xs text-white truncate flex-1">
                  {s.name}
                </span>
                {isBattle && (
                  <span className="font-mono-tabular text-[11px] font-bold text-red-400">
                    {s.battleKills}
                  </span>
                )}
                {s.eliminated && <Skull className="w-3.5 h-3.5 text-red-400 shrink-0" />}
              </div>
            );
          })}
        </div>
      )}

      {/* Multiplayer Divider Line Profile Photos Overlay */}
      {playerCount === 2 && hud?.players && hud.players.length >= 2 && (
        <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-30 flex items-center gap-4 bg-[#090d14]/95 border-2 border-white/30 rounded-2xl px-4 py-1.5 shadow-2xl">
          {[hud.players[0], hud.players[1]].map((pl, pIdx) => (
            <div key={pl.playerIndex} className="flex items-center gap-2">
              {pIdx === 1 && <div className="h-7 w-px bg-white/25 mr-2" />}
              <CharacterExpressionAvatar
                characterId={pl.characterId}
                expression={pl.expression}
                sizeClass="w-8 h-8 md:w-9 md:h-9"
              />
              <div className="leading-tight">
                <div className="text-[10px] font-bold text-slate-300">J{pl.playerIndex + 1}</div>
                <div className="font-display text-xs font-bold text-amber-400">
                  {isBattle ? `${pl.battleKills}★` : `${pl.rank}°`}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {playerCount >= 3 && !isEightGrid && hud?.players && hud.players.length >= 2 && (
        <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-30 grid grid-cols-2 gap-1.5 bg-[#090d14]/95 border-2 border-white/30 rounded-2xl p-2 shadow-2xl">
          {Array.from({ length: Math.min(4, playerCount) }).map((_, qIdx) => {
            const pl = hud.players[qIdx];
            if (!pl) {
              return <div key={qIdx} className="w-10 h-10 rounded-lg bg-slate-900/60" />;
            }
            return (
              <div
                key={pl.playerIndex}
                className="flex items-center gap-1.5 bg-slate-900/90 border border-white/15 rounded-xl px-2 py-1"
              >
                <CharacterExpressionAvatar
                  characterId={pl.characterId}
                  expression={pl.expression}
                  sizeClass="w-6 h-6"
                />
                <div className="leading-none">
                  <div className="text-[9px] font-bold text-slate-300">J{pl.playerIndex + 1}</div>
                  <div className="font-display text-[11px] font-bold text-amber-400">
                    {isBattle ? `${pl.battleKills}★` : `${pl.rank}°`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Top Center Race Clock / Mode Badges & Utility Buttons */}
      <div
        className={`fixed left-1/2 -translate-x-1/2 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 z-30 max-w-[96vw] ${
          isEightGrid ? 'top-1/2 -translate-y-1/2' : 'top-16 sm:top-3'
        }`}
      >
        {isBoss && bossSpec && (
          <div className="bg-red-950/90 border border-red-500/50 rounded-xl px-3 py-1.5 text-xs font-display font-bold text-red-200 hidden sm:block">
            VS {bossSpec.name}
          </div>
        )}

        {isMadness && (
          <div
            data-testid="madness-hud-badge"
            className="bg-fuchsia-600/95 border border-fuchsia-300 rounded-xl px-3 py-1.5 text-xs font-display font-bold text-white flex items-center gap-1.5 shadow-lg"
          >
            <Flame className="w-3.5 h-3.5 text-amber-300" />
            <span>LOCURA · PODERES ILIMITADOS</span>
          </div>
        )}

        {isElimination && (
          <div
            data-testid="elimination-hud-badge"
            className="bg-red-950/95 border border-red-400 rounded-xl px-3 py-1.5 text-xs font-display font-bold text-white flex items-center gap-2 shadow-lg"
          >
            <Skull className="w-3.5 h-3.5 text-red-400" />
            <span>
              Ronda {hud?.eliminationRound ?? 1} · Próx KO:{' '}
              <strong className="font-mono-tabular text-amber-300">
                {(hud?.eliminationTimer ?? 0).toFixed(1)}s
              </strong>{' '}
              · Vivos: {hud?.aliveRacers ?? 0}
            </span>
          </div>
        )}

        {isTokens && (
          <div
            data-testid="tokens-hud-bar"
            className="bg-[#090d14]/95 border border-amber-400/60 rounded-xl px-3 py-1.5 flex items-center gap-2 shadow-lg"
          >
            <span className="text-[11px] font-display font-bold text-amber-300 hidden sm:inline">
              TOKENS:
            </span>
            {(['J', 'K', 'T'] as const).map((letter) => {
              const got = (hud?.tokensCollected ?? []).includes(letter);
              return (
                <span
                  key={letter}
                  data-testid={`token-chip-${letter}`}
                  className={`w-6 h-6 rounded-md font-display font-extrabold text-xs flex items-center justify-center border ${
                    got
                      ? 'bg-amber-400 text-slate-950 border-white shadow'
                      : 'bg-slate-900 text-slate-500 border-white/15'
                  }`}
                >
                  {letter}
                </span>
              );
            })}
            {hud?.tokensCompleted && (
              <span className="text-[10px] font-bold text-emerald-300 ml-1">
                ¡8J PC Listo!
              </span>
            )}
          </div>
        )}

        <div
          className={`border rounded-xl px-4 py-1.5 font-mono-tabular text-sm font-bold flex items-center gap-2 ${
            isRelic && (hud?.timeFreezeTimer ?? 0) > 0
              ? 'bg-amber-400 border-white text-slate-950'
              : 'bg-[#090d14]/92 border-white/15 text-white'
          }`}
        >
          {isBattle ? (
            <>
              <Crosshair className="w-4 h-4 text-red-400" />
              <span>Meta: {hud?.battleKillGoal ?? 5} Bajas</span>
            </>
          ) : (
            <>
              {isRelic && <Timer className="w-4 h-4 text-cyan-400" />}
              <span>{formatRaceTime(hud?.raceTimeMs ?? 0)}</span>
              {isRelic && (hud?.timeBonusSavedSec ?? 0) > 0 && (
                <span className="text-[11px] text-emerald-400 font-sans">
                  (-{hud?.timeBonusSavedSec}s)
                </span>
              )}
            </>
          )}
        </div>

        <button
          type="button"
          tabIndex={-1}
          aria-label={hud?.frontCamera ? 'Cambiar a cámara trasera (V)' : 'Cambiar a cámara frontal (V)'}
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleCamera?.();
          }}
          className={`pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-xs font-display font-bold cursor-pointer transition-colors ${
            hud?.frontCamera
              ? 'bg-cyan-500 text-slate-950 border-cyan-300'
              : 'bg-[#090d14]/92 hover:bg-slate-800 border-white/15 text-slate-200'
          }`}
        >
          <Camera className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{hud?.frontCamera ? 'V: Frontal' : 'V: Atrás'}</span>
        </button>

        <button
          type="button"
          tabIndex={-1}
          aria-label={muted ? 'Activar sonido' : 'Silenciar sonido'}
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleMute();
          }}
          className="pointer-events-auto p-2 rounded-xl bg-[#090d14]/92 hover:bg-slate-800 border border-white/15 text-slate-200 cursor-pointer"
        >
          {muted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
        </button>

        <button
          type="button"
          tabIndex={-1}
          aria-label="Pausar carrera"
          onClick={(e) => {
            e.currentTarget.blur();
            onTogglePause();
          }}
          className="pointer-events-auto p-2 rounded-xl bg-[#090d14]/92 hover:bg-slate-800 border border-white/15 text-slate-200 cursor-pointer"
        >
          <Pause className="w-4 h-4" />
        </button>
      </div>

      {/* Countdown Overlay */}
      {countdown > 0 && !paused && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-30">
          <div className="-translate-y-28 bg-[#090d14]/92 border-2 border-amber-400 rounded-2xl px-9 py-5 shadow-2xl">
            <div className="font-display text-6xl md:text-7xl font-bold text-amber-400 tabular-nums">
              {countdown}
            </div>
          </div>
        </div>
      )}

      {/* Pause Modal */}
      {paused && (
        <div className="fixed inset-0 z-40 bg-black/75 pointer-events-auto flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#0b101b] border border-white/20 rounded-2xl p-6 shadow-2xl flex flex-col gap-3">
            <h2 className="font-display text-2xl font-bold text-white text-center mb-1">
              {isBattle ? 'Batalla en Pausa' : 'Carrera en Pausa'}
            </h2>
            <button
              type="button"
              onClick={onTogglePause}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-sm cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Reanudar</span>
            </button>
            <button
              type="button"
              onClick={onRestartRace}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white border border-white/10 font-semibold text-sm cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Reiniciar</span>
            </button>
            <button
              type="button"
              onClick={onOpenControlSettings}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white border border-white/10 font-semibold text-sm cursor-pointer"
            >
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span>Ajustes de Controles</span>
            </button>
            <button
              type="button"
              onClick={onExitToMenu}
              className="px-4 py-2.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/30 font-semibold text-sm cursor-pointer"
            >
              Volver al Menú Principal
            </button>
          </div>
        </div>
      )}

      {onTouchState && onTouchPulse && playerCount === 1 && !paused && (
        <TouchControlsPad
          mode={touchControls}
          showPowerButton={!isRelic}
          hasPowerUp={p1HasItem}
          turboEnergy={p1TurboEnergy}
          isStunned={p1Stunned}
          onTouchState={onTouchState}
          onTouchPulse={onTouchPulse}
        />
      )}
    </div>
  );
};
