export type PlayableCharacterId =
  | 'jarvin'
  | 'joaquin'
  | 'armagedon'
  | 'fedex'
  | 'crash'
  | 'jason'
  | 'lucia'
  | 'jarvin_exe'
  | 'n_tropy'
  | 'penta_penguin'
  | 'falso_jarvin'
  | 'celular_kart'
  | 'pc_gamer';

export type BossCharacterId = 'crash_exe' | 'nitros_oxide';

export type CharacterId = PlayableCharacterId | BossCharacterId;

export type FacialExpression =
  | 'normal'
  | 'turbo'
  | 'laughing'
  | 'dizzy'
  | 'hurt'
  | 'win'
  | 'bored'
  | 'angry'
  | 'sleep'
  | 'scared'
  | 'serious'
  | 'phone';

export type KartIdleAnimation =
  | 'none'
  | 'sleep'
  | 'butterfly'
  | 'bored'
  | 'angry'
  | 'phone';

export type GameScreen =
  | 'intro'
  | 'title'
  | 'garage'
  | 'adventure_hub'
  | 'boss_cutscene'
  | 'race'
  | 'podium'
  | 'battle_win';

export type GameMode =
  | 'adventure'
  | 'arcade'
  | 'timetrial'
  | 'relic'
  | 'boss'
  | 'battle'
  | 'online'
  | 'madness'
  | 'elimination'
  | 'tokens';

export type RelicKeyTier = 'gold' | 'metal' | 'copper';

export type PowerUpType =
  | 'aku_aku'
  | 'homing_rocket'
  | 'tnt'
  | 'potion'
  | 'turbo_boost'
  | 'shield'
  | 'bolt'
  | 'shockwave'
  | 'bowling_bomb'
  | 'warp_orb'
  | 'time_clock'
  | null;

export interface KartCustomization {
  bodyColor: string;
  rimColor: string;
  neonColor: string;
}

export interface CharacterSpec {
  id: CharacterId;
  name: string;
  role: string;
  tagline: string;
  avatarUrl?: string;
  isBossOnly?: boolean;
  unlockRequirement?: {
    bossId: string;
    hint: string;
  };
  stats: {
    topSpeed: number; // 1-10
    acceleration: number; // 1-10
    handling: number; // 1-10
    turbo: number; // 1-10
  };
  defaultCustomization: KartCustomization;
  accentColor: string;
}

export type GraphicsMode = 'optimized' | 'ps1';
export type AudioChannelMode = 'stereo' | 'mono';
export type TouchControlsMode = 'auto' | 'on' | 'off';
export type BossCutsceneOutcome = 'intro' | 'victory' | 'defeat';

export interface BossSpec {
  id: string;
  characterId: CharacterId;
  name: string;
  title: string;
  trackId: string;
  description: string;
  paceMultiplier: number;
  infiniteTurbo: boolean;
  heavyPowerSpam: boolean;
  bumpSlowsPlayer: boolean;
  glitchOnDefeat: boolean;
  accentColor: string;
  tauntLines: string[];
  defeatLine: string;
  loseTauntLines?: string[];
}

export interface SplinePoint3D {
  x: number;
  y: number;
  z: number;
}

export type TrackTheme =
  | 'urban'
  | 'canyon'
  | 'neon'
  | 'volcano'
  | 'jungle'
  | 'ice'
  | 'space'
  | 'mines'
  | 'cave'
  | 'cove'
  | 'castle'
  | 'oxide';

export interface TrackConfig {
  id: string;
  chapter: number;
  name: string;
  subtitle: string;
  theme: TrackTheme;
  skyTop: string;
  skyBottom: string;
  fogColor: string;
  roadColor: string;
  curbColorA: string;
  curbColorB: string;
  groundColor: string;
  accentColor: string;
  roadWidth: number;
  defaultLaps: number;
  parTimeMs: number;
  bossId: CharacterId;
  controlPoints: SplinePoint3D[];
  tunnels: Array<{ tStart: number; tEnd: number; color: string }>;
  caves?: Array<{ tStart: number; tEnd: number; color: string; mineShaft?: boolean }>;
  ramps: Array<{ t: number; height: number; length: number; lateralOffset?: number; width?: number }>;
  boostPads: Array<{ t: number; lateralOffset: number }>;
  antigravityZones?: Array<{ tStart: number; tEnd: number; bankAngle?: number; color?: string }>;
  shortcuts?: Array<{
    tStart: number;
    tEnd: number;
    lateralCenter: number;
    halfWidth: number;
    heightOffset?: number;
    color?: string;
  }>;
  abyssGaps?: Array<{ tStart: number; tEnd: number; rampT?: number }>;
  waterfalls?: Array<{ t: number; lateralOffset: number; width?: number; height?: number }>;
  tokens?: Array<{ letter: 'J' | 'K' | 'T'; t: number; lateralOffset: number; heightOffset?: number }>;
  wumpaBoxLocations?: Array<{ t: number; offsets: number[] }>;
  itemBoxLocations: Array<{ t: number; offsets: number[] }>;
}

export interface BattleArenaConfig {
  id: string;
  name: string;
  subtitle: string;
  radius: number;
  floorColor: string;
  wallColor: string;
  accentColor: string;
  skyTop: string;
  skyBottom: string;
  pillars: Array<{ x: number; z: number; radius: number }>;
  itemSpots: Array<{ x: number; z: number }>;
  boostSpots: Array<{ x: number; z: number; heading: number }>;
}

export type InputDeviceMode = 'auto' | 'keyboard' | 'gamepad';

export interface KeyboardBindingSet {
  accelerate: string;
  brake: string;
  left: string;
  right: string;
  turbo: string;
  jump: string;
  item: string;
}

export interface GamepadBindingSet {
  accelerate: number; // Default 0 (X)
  item: number;       // Default 1 (Circle)
  square: number;     // Default 2 (No action)
  pause: number;      // Default 3 (Triangle)
  jumpL1: number;     // Default 4 (L1)
  jumpR1: number;     // Default 5 (R1)
  brake: number;      // Default 6 (L2)
}

export interface PlayerControlConfig {
  playerIndex: number; // 0..7
  deviceMode: InputDeviceMode;
  gamepadIndex: number | null; // 0..7 or null for auto-assign
  keyboard: KeyboardBindingSet;
  gamepad: GamepadBindingSet;
}

export interface PlayerSetup {
  playerIndex: number;
  characterId: PlayableCharacterId;
  customization: KartCustomization;
}

export interface MatchSettings {
  mode: GameMode;
  trackId: string;
  playerCount: number; // 1..8 (5..8 PC only)
  useAI: boolean;
  aiCount?: number; // 0..12
  laps: number;
  aiDifficulty: 'normal';
  bossId?: string;
  arenaId?: string;
  battleKillGoal?: number;
}

export interface OnlinePlayerInfo {
  id: string;
  name: string;
  characterId: PlayableCharacterId;
  customization: KartCustomization;
  ready: boolean;
  isHost: boolean;
  slotIndex: number;
}

export interface OnlineRoomState {
  code: string;
  trackId: string;
  laps: number;
  includeAI: boolean;
  aiCount: number;
  status: 'lobby' | 'racing' | 'finished';
  hostId: string;
  players: OnlinePlayerInfo[];
}

export interface RemoteKartTelemetry {
  id: string;
  isAI?: boolean;
  characterId?: CharacterId;
  name?: string;
  customization?: KartCustomization;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  speed: number;
  steerAngle: number;
  nearestT: number;
  lap: number;
  maxProgress: number;
  turboActiveTimer: number;
  akuAkuTimer: number;
  shieldTimer: number;
  spinoutTimer: number;
  stunTimer: number;
  burnTimer?: number;
  slowTimer?: number;
  slipperyTimer?: number;
  tntTimer?: number;
  heldItem: PowerUpType;
  finished: boolean;
  finishTimeMs: number;
}

export interface KartPhysicsState {
  id: string;
  name: string;
  characterId: CharacterId;
  isPlayer: boolean;
  playerIndex: number; // 0..3 if human, -1 if AI
  isGhost?: boolean;
  customization: KartCustomization;
  // Spatial kinematics
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number; // radians, 0 = +Z, PI/2 = +X
  speed: number; // signed forward speed (m/s)
  steerAngle: number;
  grounded: boolean;
  inAntigravity?: boolean;
  pitch: number;
  roll: number;
  // Drift & Turbo
  drifting: boolean;
  driftDir: number;
  driftCharge: number;
  turboEnergy: number; // 0..100
  turboActiveTimer: number; // seconds remaining
  infiniteTurbo?: boolean;
  // Powerups & Effects
  wumpas: number; // 0..10 (1 crate = +5, 2 crates = 10 -> Juiced powers & 20s Aku Aku)
  heldItem: PowerUpType;
  shieldTimer: number;
  akuAkuTimer: number;
  spinoutTimer: number; // Legacy kept at 0; hits use burnTimer + stunTimer
  stunTimer: number; // 2.0s stop-and-burn impact before getting back up
  burnTimer: number; // 2.0s flame aura on hit!
  slowTimer: number; // 3.0s slow after TNT explosion or Armagedon boss collision
  slipperyTimer: number; // 5.0s slippery low-grip control from Potion hit
  timeSlowTimer?: number; // N. Tropy clock slow timer
  fallRespawnTimer?: number; // Abyss respawn invulnerability/drop recovery
  tntTimer: number; // 3.0s ticking TNT crate mounted on kart roof
  tntShakeJumps: number; // 2 jumps shake the TNT crate off!
  laughTimer: number; // Brief joyful expression when throwing power-up
  hurtTimer: number; // Brief hurt/dizzy expression on impact
  expression: FacialExpression;
  idleWaitTimer: number;
  idleAnim: KartIdleAnimation;
  idleAnimTimer: number;
  boostPadCooldown: number;
  jumpSquash: number;
  // Battle Mode & Elimination
  battleKills: number;
  eliminated?: boolean;
  eliminatedAtMs?: number;
  // Race progress
  nearestT: number; // 0..1 along spline
  lap: number; // 1..totalLaps
  maxProgress: number; // monotonic (lap - 1) + t
  finished: boolean;
  finishTimeMs: number;
  rank: number; // 1..N
  // AI state
  aiTargetOffset: number;
  aiReactionTimer: number;
  aiItemCooldown: number;
}

export interface PlayerHudSnapshot {
  playerIndex: number;
  characterId: CharacterId;
  name: string;
  speedKmh: number;
  rank: number;
  totalRacers: number;
  lap: number;
  totalLaps: number;
  turboEnergy: number;
  turboActive: boolean;
  inAntigravity?: boolean;
  driftStage: number; // 0..3 CTR drift charge stage
  wumpas: number; // 0..10
  juicedPowers: boolean;
  heldItem: PowerUpType;
  shieldActive: boolean;
  akuAkuActive: boolean;
  akuAkuTimer: number;
  stunned: boolean;
  burnActive: boolean;
  slowActive: boolean;
  slipperyActive?: boolean;
  timeSlowActive?: boolean;
  eliminated?: boolean;
  tntTimer: number;
  tntShakeJumps: number;
  expression: FacialExpression;
  idleAnim?: KartIdleAnimation;
  battleKills: number;
  finished: boolean;
  finishTimeMs: number;
  wrongWay: boolean;
}

export interface MinimapSnapshot {
  path: Array<{ x: number; y: number }>;
  markers: Array<{
    id: string;
    characterId: CharacterId;
    x: number;
    y: number;
    color: string;
    isPlayer: boolean;
    playerIndex: number;
  }>;
}

export interface RaceHudSnapshot {
  mode: GameMode;
  countdown: number; // > 0 means 3,2,1,0(GO!)
  raceTimeMs: number;
  frontCamera?: boolean;
  timeFreezeTimer?: number;
  timeBonusSavedSec?: number;
  eliminationTimer?: number;
  eliminationRound?: number;
  aliveRacers?: number;
  tokensCollected?: Array<'J' | 'K' | 'T'>;
  tokensCompleted?: boolean;
  battleKillGoal?: number;
  bossId?: string;
  players: PlayerHudSnapshot[];
  standings: Array<{
    id: string;
    name: string;
    characterId: CharacterId;
    isPlayer: boolean;
    playerIndex: number;
    rank: number;
    lap: number;
    progress: number;
    battleKills: number;
    eliminated?: boolean;
    finished: boolean;
    finishTimeMs: number;
    customization: KartCustomization;
  }>;
  minimap?: MinimapSnapshot;
  ghostTargetMs?: number;
}

export interface HubPortalHint {
  trackId: string;
  trackName: string;
  chapter: number;
  unlocked: boolean;
  completed: boolean;
  isBossPortal?: boolean;
}

export interface BattleResultSummary {
  winner: {
    id: string;
    name: string;
    characterId: CharacterId;
    kills: number;
    customization: KartCustomization;
  };
  loser: {
    id: string;
    name: string;
    characterId: CharacterId;
    kills: number;
    customization: KartCustomization;
  };
  arenaName: string;
  standings: RaceHudSnapshot['standings'];
}

export interface SpecialModesUnlockState {
  madness: boolean;
  elimination: boolean;
  tokens: boolean;
  eightPlayerPc: boolean;
}

export interface SaveProgress {
  unlockedChapters: number; // 1..30
  adventureCompletedTracks: string[];
  jarvinExeCutsceneSeen: boolean;
  defeatedBosses: string[];
  unlockedCharacters: PlayableCharacterId[];
  relicKeys: Record<string, RelicKeyTier>;
  battleUnlocked: boolean;
  specialModesUnlocked: SpecialModesUnlockState;
  collectedTokenTracks: string[];
  appDownloadedUnlocked: boolean;
  playerNickname: string;
  bestTimes: Record<string, number>; // trackId -> ms
  bestRelicTimes: Record<string, number>; // trackId -> ms
  bestGhosts: Record<string, Array<{ t: number; x: number; y: number; z: number; h: number }>>;
  sfxVolume: number;
  musicEnabled: boolean;
  graphicsMode: GraphicsMode;
  audioMode: AudioChannelMode;
  touchControls: TouchControlsMode;
}

export interface LiveInputSnapshot {
  accelerate: boolean;
  brake: boolean;
  steer: number; // -1 (left) .. +1 (right)
  turbo: boolean;
  jumpJustPressed: boolean;
  itemJustPressed: boolean;
  pauseJustPressed: boolean;
  rawPressedKeys: string[];
  rawGamepadButtons: number[];
  rawGamepadAxes: number[];
  activeDeviceLabel: string;
}
