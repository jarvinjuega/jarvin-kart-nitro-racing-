import React, { useEffect, useState } from 'react';
import {
  Flame,
  Gamepad2,
  Headphones,
  KeyRound,
  Keyboard,
  Lock,
  Monitor,
  Music,
  RotateCcw,
  Skull,
  Sliders,
  Smartphone,
  Sparkles,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import type {
  AudioChannelMode,
  GamepadBindingSet,
  GraphicsMode,
  KeyboardBindingSet,
  LiveInputSnapshot,
  PlayerControlConfig,
  SaveProgress,
  SpecialModesUnlockState,
  TouchControlsMode,
} from '../game/types';
import { DEFAULT_CONTROLS, detectMobileClient, formatKeyCode } from '../game/constants';

interface ControlsSettingsModalProps {
  isOpen: boolean;
  initialTab?: 'general' | 'controls';
  save: SaveProgress;
  controlConfigs: PlayerControlConfig[];
  liveInputs: LiveInputSnapshot[];
  connectedGamepads: Array<{ index: number; id: string }>;
  onClose: () => void;
  onUpdateSave: (next: SaveProgress) => void;
  onUpdateControls: (next: PlayerControlConfig[]) => void;
}

const KEYBOARD_ACTION_LABELS: Array<{ key: keyof KeyboardBindingSet; label: string }> = [
  { key: 'accelerate', label: 'Acelerar' },
  { key: 'brake', label: 'Frenar / Reversa' },
  { key: 'left', label: 'Girar Izquierda' },
  { key: 'right', label: 'Girar Derecha' },
  { key: 'turbo', label: 'Activar Turbo' },
  { key: 'jump', label: 'Saltar' },
  { key: 'item', label: 'Lanzar Poder / Ítem' },
];

const GAMEPAD_ACTION_LABELS: Array<{
  key: keyof GamepadBindingSet;
  label: string;
  note?: string;
}> = [
  { key: 'accelerate', label: 'X (Botón 0) — Acelerar' },
  { key: 'item', label: 'Círculo / O (Botón 1) — Lanzar Poder' },
  { key: 'square', label: 'Cuadrado (Botón 2) — Sin Acción', note: 'Sin acción' },
  { key: 'pause', label: 'Triángulo (Botón 3) — Pausa' },
  { key: 'jumpL1', label: 'L1 (Botón 4) — Saltar (L1+R1 = Turbo)' },
  { key: 'jumpR1', label: 'R1 (Botón 5) — Saltar (L1+R1 = Turbo)' },
  { key: 'brake', label: 'L2 (Botón 6) — Frenar / Reversa' },
];

export const ControlsSettingsModal: React.FC<ControlsSettingsModalProps> = ({
  isOpen,
  initialTab = 'general',
  save,
  controlConfigs,
  liveInputs,
  connectedGamepads,
  onClose,
  onUpdateSave,
  onUpdateControls,
}) => {
  const [section, setSection] = useState<'general' | 'controls'>(initialTab);
  const [selectedPlayer, setSelectedPlayer] = useState(0);
  const [listeningTarget, setListeningTarget] = useState<
    | { type: 'keyboard'; playerIndex: number; action: keyof KeyboardBindingSet }
    | { type: 'gamepad'; playerIndex: number; action: keyof GamepadBindingSet }
    | null
  >(null);

  const isMobile = detectMobileClient();

  useEffect(() => {
    setSection(initialTab);
  }, [initialTab, isOpen]);

  // Listen for keyboard rebind
  useEffect(() => {
    if (!listeningTarget || listeningTarget.type !== 'keyboard') return;
    const handleKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const next = structuredClone(controlConfigs);
      next[listeningTarget.playerIndex].keyboard[listeningTarget.action] = e.code;
      onUpdateControls(next);
      setListeningTarget(null);
    };
    window.addEventListener('keydown', handleKey, { capture: true });
    return () => window.removeEventListener('keydown', handleKey, { capture: true });
  }, [listeningTarget, controlConfigs, onUpdateControls]);

  // Poll gamepad rebind
  useEffect(() => {
    if (!listeningTarget || listeningTarget.type !== 'gamepad') return;
    const timer = window.setInterval(() => {
      const gps = navigator.getGamepads?.() ?? [];
      const cfg = controlConfigs[listeningTarget.playerIndex];
      const gp = gps[cfg.gamepadIndex ?? listeningTarget.playerIndex] ?? gps[0];
      if (!gp) return;
      const pressedIdx = gp.buttons.findIndex((b) => b.pressed);
      if (pressedIdx >= 0) {
        const next = structuredClone(controlConfigs);
        next[listeningTarget.playerIndex].gamepad[listeningTarget.action] = pressedIdx;
        onUpdateControls(next);
        setListeningTarget(null);
      }
    }, 60);
    return () => clearInterval(timer);
  }, [listeningTarget, controlConfigs, onUpdateControls]);

  if (!isOpen) return null;

  const activeConfig = controlConfigs[selectedPlayer] ?? controlConfigs[0];
  const liveSample = liveInputs[selectedPlayer];
  const sm = save.specialModesUnlocked;

  const toggleSpecialMode = (key: keyof SpecialModesUnlockState) => {
    if (key === 'eightPlayerPc' && isMobile) return;
    onUpdateSave({
      ...save,
      specialModesUnlocked: {
        ...sm,
        [key]: !sm[key],
      },
    });
  };

  const unlockAllSpecialModes = () => {
    onUpdateSave({
      ...save,
      specialModesUnlocked: {
        madness: true,
        elimination: true,
        tokens: true,
        eightPlayerPc: isMobile ? sm.eightPlayerPc : true,
      },
    });
  };

  return (
    <div
      data-testid="settings-modal"
      className="fixed inset-0 z-40 bg-black/75 flex items-center justify-center p-2.5 sm:p-4 md:p-8"
    >
      <div className="w-full max-w-4xl max-h-[92vh] bg-[#0b101b] border border-white/20 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <Sliders className="w-5 h-5 text-emerald-400 shrink-0" />
            <h2 className="font-display text-base sm:text-xl font-bold text-white">
              {section === 'general' ? 'Ajustes del Juego' : 'Ajustes de Controles (1–8 Jugadores)'}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {section === 'controls' && (
              <button
                type="button"
                onClick={() => setSection('general')}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 cursor-pointer"
              >
                Volver a Ajustes
              </button>
            )}
            <button
              type="button"
              aria-label="Cerrar ajustes"
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {section === 'general' ? (
            <div className="flex flex-col gap-4 max-w-2xl mx-auto">
              {/* Primary "Ajustes de Controles" button */}
              <div className="bg-slate-900/90 border border-emerald-500/35 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
                <div>
                  <h3 className="font-display text-sm sm:text-base font-bold text-white">
                    Configuración de Teclado y Mandos (1–8 Jugadores en PC)
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Reasigna teclas, revisa botones PS4/PS5 y prueba entradas en tiempo real.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSection('controls')}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-xs sm:text-sm cursor-pointer transition-colors whitespace-nowrap shrink-0"
                >
                  <Gamepad2 className="w-4 h-4" />
                  <span>Ajustes de Controles</span>
                </button>
              </div>

              {/* Desbloquear Modos de Juego Especiales */}
              <div
                data-testid="special-modes-unlock-panel"
                className="bg-slate-900/90 border border-amber-400/40 rounded-xl p-4 sm:p-5 flex flex-col gap-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-display text-sm sm:text-base font-bold text-amber-300 flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      <span>Desbloquear Modos de Juego Especiales</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Activa Locura, Eliminación (2J), Tokens J-K-T y Modo 8 Jugadores (Solo PC)
                    </p>
                  </div>

                  <button
                    type="button"
                    data-testid="unlock-all-special-modes"
                    onClick={unlockAllSpecialModes}
                    className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-display font-bold text-xs cursor-pointer whitespace-nowrap"
                  >
                    Desbloquear Especiales
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    data-testid="toggle-special-madness"
                    onClick={() => toggleSpecialMode('madness')}
                    className={`p-3 rounded-xl border text-left transition-colors cursor-pointer flex items-start justify-between gap-2 ${
                      sm.madness
                        ? 'bg-fuchsia-500/20 border-fuchsia-400 text-white'
                        : 'bg-slate-950/80 border-white/10 text-slate-300 hover:border-white/30'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-display font-bold text-xs flex items-center gap-1.5">
                        <Flame className="w-3.5 h-3.5 text-fuchsia-400 shrink-0" />
                        <span>Modo Locura</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Todos corren súper rápido + poderes ilimitados al instante
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                        sm.madness ? 'bg-fuchsia-400 text-slate-950' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {sm.madness ? 'ACTIVO' : 'BLOQUEADO'}
                    </span>
                  </button>

                  <button
                    type="button"
                    data-testid="toggle-special-elimination"
                    onClick={() => toggleSpecialMode('elimination')}
                    className={`p-3 rounded-xl border text-left transition-colors cursor-pointer flex items-start justify-between gap-2 ${
                      sm.elimination
                        ? 'bg-red-500/20 border-red-400 text-white'
                        : 'bg-slate-950/80 border-white/10 text-slate-300 hover:border-white/30'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-display font-bold text-xs flex items-center gap-1.5">
                        <Skull className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        <span>Eliminación (Solo 2J)</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Último puesto explota por tiempo · Exclusivo para 2 jugadores
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                        sm.elimination ? 'bg-red-400 text-slate-950' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {sm.elimination ? 'ACTIVO' : 'BLOQUEADO'}
                    </span>
                  </button>

                  <button
                    type="button"
                    data-testid="toggle-special-tokens"
                    onClick={() => toggleSpecialMode('tokens')}
                    className={`p-3 rounded-xl border text-left transition-colors cursor-pointer flex items-start justify-between gap-2 ${
                      sm.tokens
                        ? 'bg-amber-500/20 border-amber-400 text-white'
                        : 'bg-slate-950/80 border-white/10 text-slate-300 hover:border-white/30'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-display font-bold text-xs flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>Modo Tokens (J-K-T)</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Recoge J, K y T ocultas en el mapa para desbloquear 8J en PC
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                        sm.tokens ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {sm.tokens ? 'ACTIVO' : 'BLOQUEADO'}
                    </span>
                  </button>

                  <button
                    type="button"
                    data-testid="toggle-special-eight-pc"
                    disabled={isMobile}
                    onClick={() => toggleSpecialMode('eightPlayerPc')}
                    className={`p-3 rounded-xl border text-left transition-colors flex items-start justify-between gap-2 ${
                      isMobile
                        ? 'bg-slate-950/70 border-red-500/30 text-slate-500 cursor-not-allowed'
                        : sm.eightPlayerPc
                          ? 'bg-emerald-500/20 border-emerald-400 text-white cursor-pointer'
                          : 'bg-slate-950/80 border-white/10 text-slate-300 hover:border-white/30 cursor-pointer'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-display font-bold text-xs flex items-center gap-1.5">
                        {isMobile ? (
                          <Lock className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        ) : (
                          <Users className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        )}
                        <span>Modo 8 Jugadores (Solo PC)</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {isMobile
                          ? 'No disponible en celular: 8 pantallas cargarían demasiado el teléfono.'
                          : 'Pantalla dividida 4×2 · También se desbloquea al reunir J-K-T'}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                        isMobile
                          ? 'bg-red-500/20 text-red-300'
                          : sm.eightPlayerPc
                            ? 'bg-emerald-400 text-slate-950'
                            : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {isMobile ? 'SOLO PC' : sm.eightPlayerPc ? 'ACTIVO' : 'BLOQUEADO'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Volume */}
              <div className="bg-slate-900/80 border border-white/10 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="sfx-vol" className="text-sm font-semibold text-white flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-amber-400" />
                    <span>Volumen de Motores y Efectos</span>
                  </label>
                  <span className="font-mono-tabular text-xs text-slate-300">
                    {Math.round(save.sfxVolume * 100)}%
                  </span>
                </div>
                <input
                  id="sfx-vol"
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(save.sfxVolume * 100)}
                  onChange={(e) =>
                    onUpdateSave({ ...save, sfxVolume: Number(e.target.value) / 100 })
                  }
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>

              {/* Background Music Toggle */}
              <div className="bg-slate-900/80 border border-white/10 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white flex items-center gap-2">
                    <Music className="w-4 h-4 text-emerald-400" />
                    <span>Música de Fondo (Pistas, Aventura y Jefes)</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Banda sonora dinámica para menú, pistas 1–30, jefes y Aku Aku
                  </div>
                </div>
                <div className="flex gap-1 bg-slate-950 p-1 rounded-lg border border-white/10 self-start sm:self-auto">
                  <button
                    type="button"
                    data-testid="music-toggle-on"
                    onClick={() => onUpdateSave({ ...save, musicEnabled: true })}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
                      save.musicEnabled
                        ? 'bg-emerald-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Activa
                  </button>
                  <button
                    type="button"
                    data-testid="music-toggle-off"
                    onClick={() => onUpdateSave({ ...save, musicEnabled: false })}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
                      !save.musicEnabled
                        ? 'bg-red-500 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Silenciada
                  </button>
                </div>
              </div>

              {/* Audio Stereo vs Mono */}
              <div className="bg-slate-900/80 border border-white/10 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white flex items-center gap-2">
                    <Headphones className="w-4 h-4 text-cyan-400" />
                    <span>Canales de Sonido</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Estéreo direccional (izq/der) o Mono clásico unificado
                  </div>
                </div>
                <div className="flex gap-1 bg-slate-950 p-1 rounded-lg border border-white/10 self-start sm:self-auto">
                  {(
                    [
                      { id: 'stereo', label: 'Estéreo' },
                      { id: 'mono', label: 'Mono' },
                    ] as Array<{ id: AudioChannelMode; label: string }>
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`audio-mode-${opt.id}`}
                      onClick={() => onUpdateSave({ ...save, audioMode: opt.id })}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
                        save.audioMode === opt.id
                          ? 'bg-cyan-400 text-slate-950'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Graphics Quality: Optimized vs Classic PS1 Pixel */}
              <div className="bg-slate-900/80 border border-white/10 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-emerald-400" />
                    <span>Gráficos 3D (Móvil Auto-Pixelado y Web)</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Optimizado rápido (pixelado ligero en celular) o modo retro PS1 Clásico
                  </div>
                </div>
                <div className="flex gap-1 bg-slate-950 p-1 rounded-lg border border-white/10 self-start sm:self-auto">
                  {(
                    [
                      { id: 'optimized', label: 'Optimizado' },
                      { id: 'ps1', label: 'PS1 Clásico' },
                    ] as Array<{ id: GraphicsMode; label: string }>
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`graphics-mode-${opt.id}`}
                      onClick={() => onUpdateSave({ ...save, graphicsMode: opt.id })}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap ${
                        save.graphicsMode === opt.id
                          ? opt.id === 'ps1'
                            ? 'bg-fuchsia-500 text-white'
                            : 'bg-emerald-500 text-slate-950'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mobile Touch Controls Mode */}
              <div className="bg-slate-900/80 border border-white/10 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-amber-400" />
                    <span>Botones Táctiles (Celulares)</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Acelerar, frenar, girar, turbo sostenido, saltar y poder en pantalla
                  </div>
                </div>
                <div className="flex gap-1 bg-slate-950 p-1 rounded-lg border border-white/10 self-start sm:self-auto">
                  {(
                    [
                      { id: 'auto', label: 'Auto' },
                      { id: 'on', label: 'Activos' },
                      { id: 'off', label: 'Ocultos' },
                    ] as Array<{ id: TouchControlsMode; label: string }>
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`touch-mode-${opt.id}`}
                      onClick={() => onUpdateSave({ ...save, touchControls: opt.id })}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
                        save.touchControls === opt.id
                          ? 'bg-amber-400 text-slate-950'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {/* 8 Player Selector Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {controlConfigs.map((cfg, idx) => {
                  const active = selectedPlayer === idx;
                  const gpConnected = connectedGamepads.find(
                    (g) => g.index === (cfg.gamepadIndex ?? idx),
                  );
                  const deviceText =
                    cfg.deviceMode === 'keyboard'
                      ? 'Teclado'
                      : gpConnected
                        ? `Mando ${gpConnected.index + 1} Conectado`
                        : cfg.deviceMode === 'gamepad'
                          ? `Mando ${idx + 1} (Desconectado)`
                          : 'Teclado (Auto)';

                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedPlayer(idx)}
                      className={`p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                        active
                          ? 'bg-emerald-500/20 border-emerald-400 text-white'
                          : 'bg-slate-900/80 border-white/10 text-slate-300 hover:border-white/30'
                      }`}
                    >
                      <div className="font-display font-bold text-xs sm:text-sm flex items-center justify-between">
                        <span>Jugador {idx + 1}</span>
                        {gpConnected ? (
                          <Gamepad2 className="w-4 h-4 text-cyan-400" />
                        ) : (
                          <Keyboard className="w-4 h-4 text-slate-400" />
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 truncate">{deviceText}</div>
                    </button>
                  );
                })}
              </div>

              {/* Player Device & Live Tester Bar */}
              <div className="bg-slate-900/90 border border-white/10 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-semibold text-slate-300">
                    Dispositivo de Jugador {selectedPlayer + 1}:
                  </span>
                  <div className="flex gap-1 bg-slate-950 p-1 rounded-lg border border-white/10">
                    {(['auto', 'keyboard', 'gamepad'] as const).map((dm) => (
                      <button
                        key={dm}
                        type="button"
                        onClick={() => {
                          const next = structuredClone(controlConfigs);
                          next[selectedPlayer].deviceMode = dm;
                          onUpdateControls(next);
                        }}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                          activeConfig.deviceMode === dm
                            ? 'bg-emerald-500 text-slate-950'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {dm === 'auto' ? 'Auto' : dm === 'keyboard' ? 'Teclado' : 'Mando'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Real-Time Input Tester */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-slate-400 mr-1">Probador en Vivo:</span>
                  {[
                    { label: 'Acelerar', on: liveSample?.accelerate },
                    { label: 'Frenar', on: liveSample?.brake },
                    { label: 'Izq', on: (liveSample?.steer ?? 0) < -0.2 },
                    { label: 'Der', on: (liveSample?.steer ?? 0) > 0.2 },
                    { label: 'Turbo', on: liveSample?.turbo },
                    { label: 'Saltar', on: liveSample?.jumpJustPressed },
                    { label: 'Poder', on: liveSample?.itemJustPressed },
                  ].map((ind) => (
                    <span
                      key={ind.label}
                      className={`px-2 py-0.5 rounded font-mono-tabular border ${
                        ind.on
                          ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-bold'
                          : 'bg-slate-950 text-slate-500 border-white/10'
                      }`}
                    >
                      {ind.label}
                    </span>
                  ))}
                </div>
              </div>

              {/* Keyboard + Gamepad Rebinding Columns */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Keyboard Mapping */}
                <div className="bg-slate-900/80 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 font-display font-bold text-sm text-white">
                      <Keyboard className="w-4 h-4 text-emerald-400" />
                      <span>Teclado (Jugador {selectedPlayer + 1})</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    {KEYBOARD_ACTION_LABELS.map((item) => {
                      const isListening =
                        listeningTarget?.type === 'keyboard' &&
                        listeningTarget.playerIndex === selectedPlayer &&
                        listeningTarget.action === item.key;
                      const currentCode = activeConfig.keyboard[item.key];
                      return (
                        <div
                          key={item.key}
                          className="flex items-center justify-between gap-2 bg-slate-950/80 border border-white/10 rounded-lg px-3 py-2"
                        >
                          <span className="text-xs text-slate-200">{item.label}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setListeningTarget({
                                type: 'keyboard',
                                playerIndex: selectedPlayer,
                                action: item.key,
                              })
                            }
                            className={`px-3 py-1 rounded-md text-xs font-mono-tabular font-bold cursor-pointer transition-colors ${
                              isListening
                                ? 'bg-amber-400 text-slate-950'
                                : 'bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-white/10'
                            }`}
                          >
                            {isListening ? 'Pulsa una tecla...' : formatKeyCode(currentCode)}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Gamepad Mapping */}
                <div className="bg-slate-900/80 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 font-display font-bold text-sm text-white">
                      <Gamepad2 className="w-4 h-4 text-cyan-400" />
                      <span>Mando PS4 / PS5 / Genérico</span>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      Botones activos: {liveSample?.rawGamepadButtons.join(', ') || 'Ninguno'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {GAMEPAD_ACTION_LABELS.map((item) => {
                      const isListening =
                        listeningTarget?.type === 'gamepad' &&
                        listeningTarget.playerIndex === selectedPlayer &&
                        listeningTarget.action === item.key;
                      const btnIdx = activeConfig.gamepad[item.key];
                      const isPressedNow = liveSample?.rawGamepadButtons.includes(btnIdx);

                      return (
                        <div
                          key={item.key}
                          className="flex items-center justify-between gap-2 bg-slate-950/80 border border-white/10 rounded-lg px-3 py-2"
                        >
                          <span className="text-xs text-slate-200">{item.label}</span>
                          {item.note ? (
                            <span className="px-2.5 py-1 rounded bg-slate-900 text-xs text-slate-400">
                              {item.note}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setListeningTarget({
                                  type: 'gamepad',
                                  playerIndex: selectedPlayer,
                                  action: item.key,
                                })
                              }
                              className={`px-3 py-1 rounded-md text-xs font-mono-tabular font-bold cursor-pointer transition-colors ${
                                isListening
                                  ? 'bg-amber-400 text-slate-950'
                                  : isPressedNow
                                    ? 'bg-cyan-400 text-slate-950'
                                    : 'bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-white/10'
                              }`}
                            >
                              {isListening ? 'Pulsa botón...' : `Botón ${btnIdx}`}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Reset Defaults */}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => onUpdateControls(structuredClone(DEFAULT_CONTROLS))}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 text-xs font-semibold cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restaurar Controles por Defecto</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
