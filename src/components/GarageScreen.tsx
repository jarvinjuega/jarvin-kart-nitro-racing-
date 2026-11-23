import React, { useState } from 'react';
import { ArrowLeft, Flag, Lock, Palette, Sparkles } from 'lucide-react';
import type {
  CharacterId,
  KartCustomization,
  PlayableCharacterId,
  PlayerSetup,
  SaveProgress,
} from '../game/types';
import { CHARACTERS, CHARACTER_MAP, COLOR_SWATCHES } from '../game/constants';
import { CharacterExpressionAvatar } from './CharacterExpressionAvatar';

interface GarageScreenProps {
  playerCount: number;
  setups: PlayerSetup[];
  save: SaveProgress;
  onUpdateSetup: (playerIndex: number, setup: PlayerSetup) => void;
  onBack: () => void;
  onStartRace: () => void;
  onPreviewChange: (characterId: CharacterId, customization: KartCustomization) => void;
}

export const GarageScreen: React.FC<GarageScreenProps> = ({
  playerCount,
  setups,
  save,
  onUpdateSetup,
  onBack,
  onStartRace,
  onPreviewChange,
}) => {
  const [activePlayerIdx, setActivePlayerIdx] = useState(0);
  const [lockNotice, setLockNotice] = useState<string | null>(null);
  const currentSetup = setups[activePlayerIdx] ?? setups[0];
  const activeChar = CHARACTER_MAP[currentSetup.characterId];
  const unlockedSet = new Set<PlayableCharacterId>(save.unlockedCharacters);
  const unlockedCount = CHARACTERS.filter(
    (c) => !c.unlockRequirement || unlockedSet.has(c.id as PlayableCharacterId),
  ).length;
  const lockedCount = CHARACTERS.length - unlockedCount;

  const handleSelectPlayerTab = (idx: number) => {
    setActivePlayerIdx(idx);
    setLockNotice(null);
    const s = setups[idx];
    if (s) onPreviewChange(s.characterId, s.customization);
  };

  const handleSelectCharacter = (cid: CharacterId) => {
    const spec = CHARACTER_MAP[cid];
    if (spec.unlockRequirement && !unlockedSet.has(cid as PlayableCharacterId)) {
      setLockNotice(spec.unlockRequirement.hint);
      return;
    }
    setLockNotice(null);
    const nextSetup: PlayerSetup = {
      ...currentSetup,
      characterId: cid as PlayableCharacterId,
      customization: { ...spec.defaultCustomization },
    };
    onUpdateSetup(activePlayerIdx, nextSetup);
    onPreviewChange(cid, nextSetup.customization);
  };

  const handleColorChange = (key: keyof KartCustomization, color: string) => {
    const nextCust: KartCustomization = {
      ...currentSetup.customization,
      [key]: color,
    };
    onUpdateSetup(activePlayerIdx, {
      ...currentSetup,
      customization: nextCust,
    });
    onPreviewChange(currentSetup.characterId, nextCust);
  };

  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between gap-3 p-3 sm:p-5 md:p-7 overflow-y-auto lg:overflow-hidden">
      {/* Top Bar: Back + Player Tabs + Start Race */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="pointer-events-auto flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#090d14]/90 hover:bg-slate-800 text-white border border-white/15 font-semibold text-sm cursor-pointer transition-colors whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Menú</span>
          </button>
          <div className="bg-[#090d14]/90 border border-white/15 rounded-xl px-4 py-2">
            <h1 className="font-display text-lg font-bold text-white">
              Selección de Corredor y Kart 3D
            </h1>
          </div>
        </div>

        {/* Player Tabs (1..8) */}
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 bg-[#090d14]/95 p-1.5 rounded-xl border border-white/15 max-w-full">
          {Array.from({ length: playerCount }).map((_, idx) => {
            const active = idx === activePlayerIdx;
            const pSetup = setups[idx] ?? setups[0];
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleSelectPlayerTab(idx)}
                className={`px-3 py-1.5 rounded-lg text-xs font-display font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-emerald-500 text-slate-950'
                    : 'text-slate-300 hover:text-white bg-slate-900/60'
                }`}
              >
                J{idx + 1} · {CHARACTER_MAP[pSetup.characterId].name}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          data-start="true"
          onClick={onStartRace}
          className="pointer-events-auto inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-sm shadow-xl cursor-pointer transition-colors whitespace-nowrap"
        >
          <Flag className="w-4 h-4" />
          <span>¡Iniciar Carrera!</span>
        </button>
      </div>

      {/* Left & Right Flanks keeping Center 3D Turntable Unobstructed */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-end justify-between gap-4 my-auto lg:my-0">
        {/* Left: Full 13-Character Roster */}
        <div className="pointer-events-auto w-full lg:w-[395px] bg-[#090d14]/92 border border-white/15 rounded-2xl p-4 shadow-2xl">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-2.5">
            <span>Corredores Disponibles ({unlockedCount}/{CHARACTERS.length})</span>
            {lockedCount > 0 && (
              <span className="text-[11px] text-amber-300">{lockedCount} Bloqueados</span>
            )}
          </div>

          {lockNotice && (
            <div className="mb-2.5 px-3 py-2 rounded-xl bg-red-500/15 border border-red-400/40 text-red-200 text-xs font-semibold flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-red-400 shrink-0" />
              <span>{lockNotice}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 max-h-[240px] lg:max-h-[340px] overflow-y-auto pr-1">
            {CHARACTERS.map((char) => {
              const selected = currentSetup.characterId === char.id;
              const isLocked = Boolean(
                char.unlockRequirement && !unlockedSet.has(char.id as PlayableCharacterId),
              );
              return (
                <button
                  key={char.id}
                  type="button"
                  data-testid={`garage-char-${char.id}`}
                  onClick={() => handleSelectCharacter(char.id)}
                  className={`flex items-center gap-3 p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                    isLocked
                      ? 'bg-slate-950/90 border-red-500/25 text-slate-400 opacity-85 hover:border-red-400/50'
                      : selected
                        ? 'bg-emerald-500/20 border-emerald-400 text-white'
                        : 'bg-slate-900/80 border-white/10 text-slate-300 hover:border-white/25'
                  }`}
                >
                  <div className={isLocked ? 'opacity-50 grayscale' : ''}>
                    <CharacterExpressionAvatar
                      characterId={char.id}
                      sizeClass="w-11 h-11"
                      glitch={char.id === 'jarvin_exe' || char.id === 'falso_jarvin'}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-display font-bold text-sm flex items-center justify-between gap-2">
                      <span className="truncate">{char.name}</span>
                      {isLocked ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-300 bg-red-500/15 border border-red-400/35 px-2 py-0.5 rounded-md shrink-0">
                          <Lock className="w-3 h-3" />
                          <span>Bloqueado</span>
                        </span>
                      ) : (
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: char.accentColor }}
                        />
                      )}
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      {isLocked ? char.unlockRequirement?.hint : char.role}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected Character Stats */}
          <div className="mt-3 pt-3 border-t border-white/10">
            <p className="text-xs text-slate-300 mb-2.5">{activeChar.tagline}</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              {[
                { label: 'Velocidad', val: activeChar.stats.topSpeed },
                { label: 'Aceleración', val: activeChar.stats.acceleration },
                { label: 'Manejo', val: activeChar.stats.handling },
                { label: 'Turbo', val: activeChar.stats.turbo },
              ].map((st) => (
                <div key={st.label}>
                  <div className="flex justify-between text-slate-400 mb-0.5">
                    <span>{st.label}</span>
                    <span className="font-mono-tabular text-white">{st.val}/10</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-400 rounded-full"
                      style={{ width: `${st.val * 10}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Kart Paint, Rims, and Neon Customization */}
        <div className="pointer-events-auto w-full lg:w-[350px] bg-[#090d14]/92 border border-white/15 rounded-2xl p-4 shadow-2xl flex flex-col gap-3.5">
          <div className="flex items-center gap-2 text-sm font-display font-bold text-white">
            <Palette className="w-4 h-4 text-amber-400" />
            <span>Personalizar Kart · Jugador {activePlayerIdx + 1}</span>
          </div>

          {[
            { key: 'bodyColor' as const, label: 'Color de Carrocería' },
            { key: 'rimColor' as const, label: 'Color de Rines' },
            { key: 'neonColor' as const, label: 'Neón y Estela de Turbo' },
          ].map((group) => (
            <div key={group.key}>
              <div className="flex items-center justify-between text-xs text-slate-300 mb-1.5">
                <span>{group.label}</span>
                <span className="font-mono-tabular text-slate-400">
                  {currentSetup.customization[group.key]}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {COLOR_SWATCHES.map((hex) => {
                  const isSelected = currentSetup.customization[group.key] === hex;
                  return (
                    <button
                      key={hex}
                      type="button"
                      aria-label={`${group.label} ${hex}`}
                      onClick={() => handleColorChange(group.key, hex)}
                      className={`h-8 rounded-lg border-2 transition-transform cursor-pointer ${
                        isSelected
                          ? 'border-white scale-105'
                          : 'border-white/15 hover:border-white/50'
                      }`}
                      style={{ backgroundColor: hex }}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          {(activeChar.id === 'jarvin' ||
            activeChar.id === 'jarvin_exe' ||
            activeChar.id === 'falso_jarvin' ||
            activeChar.id === 'celular_kart' ||
            activeChar.id === 'pc_gamer') && (
            <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-2.5">
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>
                {activeChar.id === 'jarvin_exe'
                  ? 'Edición oscura con saco rojo carmesí, corona carmesí y mirada malévola.'
                  : activeChar.id === 'falso_jarvin'
                    ? 'Versión beta sin terminar de Jarvin: kart chueco de cartón, cinta adhesiva y ojos disparejos.'
                    : activeChar.id === 'celular_kart'
                      ? '¡Personaje exclusivo desbloqueado al descargar la App!'
                      : activeChar.id === 'pc_gamer'
                        ? 'Torre RGB + Monitor CRT clásico · ¡Exclusivo para PC!'
                        : 'Incluye corona flotante y gato naranja en patineta verde en el alerón.'}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="h-1" />
    </div>
  );
};
