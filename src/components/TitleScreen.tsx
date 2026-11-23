import React from 'react';
import {
  Clock,
  Compass,
  Crosshair,
  Download,
  Flag,
  Flame,
  Globe,
  Key,
  KeyRound,
  Lock,
  MonitorDown,
  Play,
  Settings,
  Skull,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import type { GameMode, MatchSettings, SaveProgress } from '../game/types';
import { TRACKS, formatRaceTime } from '../game/constants';

interface TitleScreenProps {
  settings: MatchSettings;
  save: SaveProgress;
  isMobileClient: boolean;
  pwaInstalled: boolean;
  onChangeSettings: (next: MatchSettings) => void;
  onEnterAdventureHub: () => void;
  onOpenGarage: () => void;
  onQuickStartRace: () => void;
  onOpenSettings: () => void;
  onOpenOnline: () => void;
  onOpenBossMenu: () => void;
  onOpenRelicMenu: () => void;
  onOpenBattleMenu: () => void;
  onOpenDownload: () => void;
  onInstallApp: () => void;
  onOpenHighscores: () => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  settings,
  save,
  isMobileClient,
  pwaInstalled,
  onChangeSettings,
  onEnterAdventureHub,
  onOpenGarage,
  onQuickStartRace,
  onOpenSettings,
  onOpenOnline,
  onOpenBossMenu,
  onOpenRelicMenu,
  onOpenBattleMenu,
  onOpenDownload,
  onInstallApp,
  onOpenHighscores,
}) => {
  const sm = save.specialModesUnlocked;

  const modeOptions: Array<{
    id: GameMode;
    title: string;
    desc: string;
    icon: React.ReactNode;
    badge?: string;
    locked?: boolean;
  }> = [
    {
      id: 'adventure',
      title: 'Modo Aventura (Mapa 3D)',
      desc: 'Explora portales 3D, gana en 1° y desbloquea a Jarvin.exe',
      icon: <Compass className="w-5 h-5 text-amber-400" />,
      badge: `${save.adventureCompletedTracks.length}/5 Jefe`,
    },
    {
      id: 'arcade',
      title: 'Modo Arcade',
      desc: `${TRACKS.length} pistas largas, rampas con abismos y cascadas`,
      icon: <Zap className="w-5 h-5 text-emerald-400" />,
    },
    {
      id: 'relic',
      title: 'Contrarreloj / Reliquia',
      desc: 'Cajas de tiempo, Llaves Oro/Metal/Cobre y fantasmas',
      icon: <Clock className="w-5 h-5 text-cyan-400" />,
    },
    {
      id: 'boss',
      title: 'Modo Jefe (4 Jefes)',
      desc: "Jarvin.exe, Armagedón, Crash.exe y Nitro's Oxide",
      icon: <Skull className="w-5 h-5 text-red-400" />,
      badge: `${save.defeatedBosses.length}/4`,
    },
    {
      id: 'battle',
      title: 'Modo Batalla a Muerte',
      desc: save.battleUnlocked
        ? 'Arena 1-4J solo cohetes · ¡Primero a 5 bajas gana!'
        : 'Bloqueado: gana Llave de Metal o Oro en Reliquia',
      icon: save.battleUnlocked ? (
        <Crosshair className="w-5 h-5 text-rose-400" />
      ) : (
        <Lock className="w-5 h-5 text-slate-400" />
      ),
      badge: save.battleUnlocked ? 'Abierto' : 'Llave Metal',
    },
    {
      id: 'online',
      title: 'Modo Online (Salas)',
      desc: 'Crea una sala o únete con amigos por código/link',
      icon: <Globe className="w-5 h-5 text-sky-400" />,
    },
    {
      id: 'madness',
      title: 'Modo Locura',
      desc: sm.madness
        ? '¡Todos corren súper rápido + poderes ilimitados!'
        : 'Desbloquéalo en Ajustes → Modos Especiales',
      icon: sm.madness ? (
        <Flame className="w-5 h-5 text-fuchsia-400" />
      ) : (
        <Lock className="w-5 h-5 text-slate-400" />
      ),
      badge: sm.madness ? 'Especial' : 'Ajustes',
      locked: !sm.madness,
    },
    {
      id: 'elimination',
      title: 'Eliminación (Solo 2J)',
      desc: sm.elimination
        ? 'El último en el temporizador explota · Solo 2 jugadores'
        : 'Desbloquéalo en Ajustes → Modos Especiales',
      icon: sm.elimination ? (
        <Skull className="w-5 h-5 text-orange-400" />
      ) : (
        <Lock className="w-5 h-5 text-slate-400" />
      ),
      badge: sm.elimination ? 'Solo 2J' : 'Ajustes',
      locked: !sm.elimination,
    },
    {
      id: 'tokens',
      title: 'Modo Tokens (J-K-T)',
      desc: sm.tokens
        ? 'Consigue las letras J, K y T para desbloquear 8J (PC)'
        : 'Desbloquéalo en Ajustes → Modos Especiales',
      icon: sm.tokens ? (
        <KeyRound className="w-5 h-5 text-amber-300" />
      ) : (
        <Lock className="w-5 h-5 text-slate-400" />
      ),
      badge: sm.tokens
        ? sm.eightPlayerPc
          ? '8J PC Listo'
          : 'Desbloquea 8J'
        : 'Ajustes',
      locked: !sm.tokens,
    },
  ];

  const handleModeSelect = (mode: GameMode) => {
    if (mode === 'online') {
      onOpenOnline();
      return;
    }
    if (mode === 'boss') {
      onOpenBossMenu();
      return;
    }
    if (mode === 'relic' || mode === 'timetrial') {
      onOpenRelicMenu();
      return;
    }
    if (mode === 'battle') {
      onOpenBattleMenu();
      return;
    }
    if (mode === 'madness' && !sm.madness) {
      onOpenSettings();
      return;
    }
    if (mode === 'elimination' && !sm.elimination) {
      onOpenSettings();
      return;
    }
    if (mode === 'tokens' && !sm.tokens) {
      onOpenSettings();
      return;
    }
    const maxAllowedPlayers = isMobileClient ? 2 : sm.eightPlayerPc ? 8 : 4;
    const nextPlayers =
      mode === 'elimination'
        ? 2
        : Math.max(1, Math.min(maxAllowedPlayers, settings.playerCount));
    const next: MatchSettings = {
      ...settings,
      mode,
      playerCount: nextPlayers,
      useAI: nextPlayers === 1 ? true : settings.useAI,
      aiCount: settings.aiCount ?? 4,
    };
    if (mode === 'adventure') {
      const currentTrack = TRACKS.find((t) => t.id === settings.trackId);
      if (currentTrack && currentTrack.chapter > save.unlockedChapters) {
        next.trackId = TRACKS[0].id;
      }
    }
    onChangeSettings(next);
  };

  const allowedPlayerCounts = isMobileClient
    ? [1, 2]
    : sm.eightPlayerPc
      ? [1, 2, 3, 4, 5, 6, 7, 8]
      : [1, 2, 3, 4];

  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between gap-3 p-3 sm:p-4 md:p-6 overflow-y-auto lg:overflow-hidden">
      {/* Top Header Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
        <div className="pointer-events-auto flex items-center gap-3 bg-[#090d14]/92 border border-emerald-500/35 rounded-2xl px-3.5 py-2 shadow-2xl max-w-full">
          <img
            src="/assets/aistudio/channels4_profile_8411e407.jpg"
            alt="Emblema Jarvin"
            referrerPolicy="no-referrer"
            className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl object-cover border-2 border-emerald-400 shrink-0"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <svg viewBox="0 0 28 20" className="w-5 h-3.5 sm:w-6 sm:h-4 shrink-0" aria-hidden="true">
                <path
                  d="M2 18 L5 5 L11 11 L14 2 L17 11 L23 5 L26 18 Z"
                  fill="#facc15"
                  stroke="#090d14"
                  strokeWidth="1.5"
                />
              </svg>
              <h1 className="font-display text-lg sm:text-2xl md:text-3xl font-bold tracking-tight text-white truncate">
                JARVIN KART TURBO
              </h1>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-300 truncate">
              {TRACKS.length} Pistas · Abismos & Cascadas · 13 Corredores · Highscore Global
            </p>
          </div>
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="open-highscores-btn"
            onClick={onOpenHighscores}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Trophy className="w-4 h-4" />
            <span>Récords</span>
          </button>

          <button
            type="button"
            onClick={onOpenBossMenu}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-display font-bold text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Skull className="w-4 h-4" />
            <span>Modo Jefe</span>
          </button>

          <button
            type="button"
            onClick={onOpenOnline}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-display font-bold text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Globe className="w-4 h-4" />
            <span>Jugar Online</span>
          </button>

          {!pwaInstalled && (
            <button
              type="button"
              data-testid="title-install-app-btn"
              onClick={onInstallApp}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-display font-bold text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <MonitorDown className="w-4 h-4" />
              <span>Instalar App</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenDownload}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display font-bold text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4" />
            <span>App / Link</span>
          </button>

          <button
            type="button"
            data-testid="open-settings-btn"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[#090d14]/90 hover:bg-slate-800 text-slate-100 border border-white/15 font-semibold text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Settings className="w-4 h-4 text-emerald-400" />
            <span>Ajustes</span>
          </button>
        </div>
      </div>

      {/* Main Menu Grid: Left Panel (Mode & Options) + Right Panel (Tracks) */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-end justify-between gap-3.5 sm:gap-4 my-auto lg:my-0">
        {/* Left: Game Modes & Match Configuration */}
        <div className="pointer-events-auto w-full lg:w-[490px] bg-[#090d14]/92 border border-white/15 rounded-2xl p-3.5 sm:p-4 shadow-2xl flex flex-col gap-2.5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-display text-xs font-bold uppercase tracking-wider text-slate-400">
                Modo de Juego
              </h2>
              <span className="text-[11px] text-slate-400">
                Piloto: <strong className="text-emerald-300">{save.playerNickname}</strong>
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[250px] lg:max-h-[285px] overflow-y-auto pr-1">
              {modeOptions.map((m) => {
                const active = settings.mode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    data-testid={`mode-btn-${m.id}`}
                    onClick={() => handleModeSelect(m.id)}
                    className={`flex items-center gap-2.5 p-2 rounded-xl border text-left transition-colors cursor-pointer ${
                      m.locked
                        ? 'bg-slate-950/80 border-white/10 text-slate-400 opacity-80 hover:border-amber-400/50'
                        : active
                          ? 'bg-emerald-500/20 border-emerald-400 text-white'
                          : 'bg-slate-900/85 border-white/10 text-slate-300 hover:border-white/25'
                    }`}
                  >
                    <div className="shrink-0">{m.icon}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-display font-bold text-xs truncate">{m.title}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">{m.desc}</div>
                      {m.badge && (
                        <div className="text-[10px] font-bold text-amber-300 mt-0.5">{m.badge}</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {settings.mode === 'adventure' ? (
            <div className="bg-amber-400/12 border border-amber-400/40 rounded-xl p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-display font-bold text-amber-300 flex items-center gap-1.5">
                  <Trophy className="w-4 h-4" />
                  AVENTURA TIPO CTR · PORTALES 3D
                </span>
                <span className="font-mono-tabular text-white">
                  {save.adventureCompletedTracks.length}/5 Jefes
                </span>
              </div>
              <p className="text-xs text-slate-300">
                Al empezar la aventura entrarás al Mapa 3D con portales desbloqueables al ganar en 1°. ¡Gana 5 carreras para desbloquear la cinemática de Jarvin.exe!
              </p>
              <button
                type="button"
                data-start="true"
                onClick={onEnterAdventureHub}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-display font-bold text-sm transition-colors cursor-pointer"
              >
                <Compass className="w-4 h-4" />
                <span>¡Empezar la Aventura! (Mapa 3D)</span>
              </button>
            </div>
          ) : (
            <>
              {/* Match Options: Players & Laps */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/10">
                <div>
                  <div className="text-xs text-slate-400 mb-1 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    <span>
                      {settings.mode === 'elimination'
                        ? 'Eliminación (Solo 2J)'
                        : sm.eightPlayerPc && !isMobileClient
                          ? 'Jugadores (PC 1–8J)'
                          : 'Jugadores Locales'}
                    </span>
                  </div>
                  {settings.mode === 'elimination' ? (
                    <div className="bg-red-500/20 border border-red-400/50 rounded-lg px-2.5 py-1.5 text-xs font-display font-bold text-red-200 text-center">
                      2J Obligatorio (Solo 2 Jugadores)
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-1 bg-slate-900 p-1 rounded-lg border border-white/10">
                      {allowedPlayerCounts.map((cnt) => {
                        const active = settings.playerCount === cnt;
                        return (
                          <button
                            key={cnt}
                            type="button"
                            data-testid={`player-count-${cnt}`}
                            onClick={() =>
                              onChangeSettings({
                                ...settings,
                                playerCount: cnt,
                                useAI: cnt === 1 ? true : settings.useAI,
                                aiCount:
                                  cnt === 1
                                    ? Math.max(1, settings.aiCount ?? 4)
                                    : Math.min(settings.aiCount ?? 0, Math.max(0, 8 - cnt)),
                              })
                            }
                            className={`py-1 rounded-md text-xs font-bold font-mono-tabular transition-colors cursor-pointer ${
                              active
                                ? 'bg-emerald-500 text-slate-950'
                                : 'text-slate-300 hover:text-white'
                            }`}
                          >
                            {cnt}J
                          </button>
                        );
                      })}
                      {isMobileClient && (
                        <div className="col-span-2 flex items-center justify-center text-[10px] font-bold text-slate-500 px-1 text-center">
                          8J Solo PC
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-xs text-slate-400 mb-1 flex items-center gap-1.5">
                    <Flag className="w-3.5 h-3.5" />
                    <span>Vueltas</span>
                  </div>
                  {settings.mode === 'elimination' ? (
                    <div className="bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs font-display font-bold text-amber-300 text-center">
                      Hasta 1 Sobreviviente
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-lg border border-white/10">
                      {[2, 3, 5].map((laps) => {
                        const active = settings.laps === laps;
                        return (
                          <button
                            key={laps}
                            type="button"
                            onClick={() => onChangeSettings({ ...settings, laps })}
                            className={`py-1 rounded-md text-xs font-bold font-mono-tabular transition-colors cursor-pointer ${
                              active
                                ? 'bg-amber-400 text-slate-950'
                                : 'text-slate-300 hover:text-white'
                            }`}
                          >
                            {laps}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* AI Options */}
              <div className="flex flex-col gap-2 bg-slate-900/90 border border-emerald-500/25 rounded-xl p-2.5">
                {settings.mode === 'madness' ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs">
                      <div className="font-semibold text-fuchsia-300">Modo Locura Activo</div>
                      <div className="text-slate-400">
                        ¡Todos los corredores al máximo con poderes que se recargan al instante!
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-fuchsia-500 text-white shrink-0">
                      LOCURA
                    </span>
                  </div>
                ) : settings.mode === 'tokens' ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs">
                      <div className="font-semibold text-amber-300">Desafío Tokens J-K-T</div>
                      <div className="text-slate-400">
                        Busca las 3 letras doradas J, K, T en la pista para desbloquear 8J (PC)
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-amber-400 text-slate-950 shrink-0">
                      J-K-T
                    </span>
                  </div>
                ) : settings.playerCount >= 2 ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs">
                      <div className="font-semibold text-white">Oponentes en Multijugador</div>
                      <div className="text-slate-400">
                        {!settings.useAI || (settings.aiCount ?? 0) === 0
                          ? `Solo los ${settings.playerCount} jugadores (Sin Bots IA)`
                          : `${settings.playerCount}J + ${settings.aiCount ?? 1} Bots IA`}
                      </div>
                    </div>
                    <div className="flex gap-1 bg-[#090d14] p-1 rounded-lg border border-white/10">
                      <button
                        type="button"
                        onClick={() => onChangeSettings({ ...settings, useAI: false, aiCount: 0 })}
                        className={`px-2.5 py-1 rounded-md text-xs font-bold cursor-pointer ${
                          !settings.useAI || (settings.aiCount ?? 0) === 0
                            ? 'bg-emerald-500 text-slate-950'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        Solo {settings.playerCount}J
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onChangeSettings({
                            ...settings,
                            useAI: true,
                            aiCount: Math.max(1, Math.min(4, 8 - settings.playerCount)),
                          })
                        }
                        className={`px-2.5 py-1 rounded-md text-xs font-bold cursor-pointer ${
                          settings.useAI && (settings.aiCount ?? 0) > 0
                            ? 'bg-amber-400 text-slate-950'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        +Bots IA
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs">
                      <div className="font-semibold text-white">Rivales IA (Modo Normal)</div>
                      <div className="text-slate-400">
                        Carrera equilibrada · Los ataques solo golpean de cerca
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-500 text-slate-950 shrink-0">
                      Normal
                    </span>
                  </div>
                )}
              </div>

              {/* Primary CTAs */}
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-2.5 pt-1">
                <button
                  type="button"
                  data-start="true"
                  onClick={onOpenGarage}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-sm transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Elegir Corredores y Kart</span>
                </button>
                <button
                  type="button"
                  data-testid="quick-start-race-btn"
                  onClick={onQuickStartRace}
                  className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white border border-white/15 font-display font-bold text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  Carrera Rápida
                </button>
              </div>
            </>
          )}
        </div>

        {/* Right: Track Selector (All 24 Tracks) */}
        <div className="pointer-events-auto w-full lg:w-[410px] bg-[#090d14]/92 border border-white/15 rounded-2xl p-3.5 sm:p-4 shadow-2xl">
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="font-display text-sm font-bold text-slate-300 tracking-wide">
              Circuito Seleccionado
            </h2>
            <span className="text-xs text-slate-400">
              {settings.mode === 'adventure'
                ? `Progreso: Cap. ${save.unlockedChapters}/${TRACKS.length}`
                : `${TRACKS.length} pistas con abismos y cascadas`}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-1.5 max-h-[260px] lg:max-h-[340px] overflow-y-auto pr-1">
            {TRACKS.map((trk) => {
              const locked =
                settings.mode === 'adventure' && trk.chapter > save.unlockedChapters;
              const active = settings.trackId === trk.id;
              const bestMs = save.bestTimes[trk.id];
              const relic = save.relicKeys[trk.id];

              return (
                <button
                  key={trk.id}
                  type="button"
                  disabled={locked}
                  onClick={() => onChangeSettings({ ...settings, trackId: trk.id })}
                  className={`flex items-center justify-between gap-3 p-2.5 rounded-xl border text-left transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                    active
                      ? 'bg-amber-400/15 border-amber-400 text-white'
                      : 'bg-slate-900/80 border-white/10 text-slate-300 hover:border-white/25'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: trk.accentColor }}
                      />
                      <span className="font-display font-bold text-sm truncate">
                        {trk.name}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 truncate mt-0.5">
                      {trk.subtitle}
                    </div>
                  </div>

                  <div className="shrink-0 text-right flex items-center gap-2">
                    {relic && (
                      <Key
                        className={`w-3.5 h-3.5 ${
                          relic === 'gold'
                            ? 'text-amber-400'
                            : relic === 'metal'
                              ? 'text-slate-200'
                              : 'text-orange-400'
                        }`}
                      />
                    )}
                    {locked ? (
                      <Lock className="w-4 h-4 text-slate-400" />
                    ) : (
                      <div className="text-xs font-mono-tabular text-amber-300">
                        {bestMs ? formatRaceTime(bestMs) : formatRaceTime(trk.parTimeMs)}
                        <div className="text-[11px] text-slate-400 font-sans">
                          {bestMs ? 'Récord' : 'Meta'}
                        </div>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Flat Single-Line Control Hint */}
      <div className="hidden sm:flex justify-center">
        <div className="text-xs text-slate-300 bg-[#090d14]/85 px-4 py-1.5 rounded-lg border border-white/10">
          J1: WASD + Shift Izq Turbo · V: Cámara Frontal/Atrás · J2: Flechas + Intro Num Turbo · Mando: X Acelerar · O Poder · L1/R1 Saltar
        </div>
      </div>
    </div>
  );
};
