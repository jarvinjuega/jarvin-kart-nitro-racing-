import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type {
  AudioChannelMode,
  BattleArenaConfig,
  BattleResultSummary,
  BossCutsceneOutcome,
  BossSpec,
  CharacterId,
  GraphicsMode,
  HubPortalHint,
  KartCustomization,
  KartIdleAnimation,
  KartPhysicsState,
  LiveInputSnapshot,
  MatchSettings,
  MinimapSnapshot,
  OnlineRoomState,
  PlayerControlConfig,
  PlayerHudSnapshot,
  PlayerSetup,
  RaceHudSnapshot,
  RemoteKartTelemetry,
  GameScreen,
} from './types';
import { BATTLE_ARENAS, BOSS_MAP, CHARACTERS, CHARACTER_MAP, TRACKS } from './constants';
import {
  CompiledTrack,
  applyKartBurnHit,
  applyKartSlipperyHit,
  collectWumpaBox,
  compileTrack,
  computeAiControlInput,
  computeBattleAiControlInput,
  findNearestTrackSample,
  getKartRaceProgress,
  getRandomPowerUp,
  getShortcutSpan,
  resolveIdleExpression,
  stepBattleKartPhysics,
  stepKartPhysics,
  updateRaceStandings,
  wrapT,
} from './math';
import {
  BuiltAdventureHubScene,
  BuiltBattleArenaScene,
  BuiltTrackScene,
  CharacterRig,
  CtrIntroStageRig,
  KartMeshRig,
  applyCharacterFacialExpression,
  applyCharacterIdleAnimation,
  applyPs1FilterToObject,
  buildAdventureHubStage,
  buildBattleArenaStage,
  buildCtrIntroStage,
  buildTrackGeometryAndProps,
  createBowlingBombModel,
  createCharacterModel,
  createKartModel,
  createLightningBoltModel,
  createPotionModel,
  createRocketProjectileModel,
  createTimeClockModel,
  createTimeCrateModel,
  createTntCrateModel,
  createTokenLetterModel,
  createWarpOrbModel,
} from './models';
import { createContactShadowTexture } from './textures';
import { createAtmosphericSkyMaterial } from './shaders';
import { InputManager, type TouchControlState } from './input';
import { SoundEngine } from './audio';
import type { OnlineAttackEvent, OnlineClient } from './onlineClient';

// Reusable scratch math objects (Zero-GC in render loop)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _frustum = new THREE.Frustum();
const _projMatrix = new THREE.Matrix4();
const _chunkSphere = new THREE.Sphere();
const _objSphere = new THREE.Sphere();

interface ParticleSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
}

export interface FreeCameraInfo {
  active: boolean;
  visibleChunks: number;
  builtChunks: number;
  totalChunks: number;
}

export interface EngineCallbacks {
  onHudUpdate: (snapshot: RaceHudSnapshot) => void;
  onRaceFinish: (snapshot: RaceHudSnapshot) => void;
  onBattleFinish?: (summary: BattleResultSummary) => void;
  onHubPortalProximity?: (hint: HubPortalHint | null) => void;
  onHubPortalEnter?: (trackId: string, isBossPortal: boolean) => void;
  onTokensCompleted?: (trackId: string) => void;
  onPauseRequested: () => void;
  onIntroFinished: () => void;
  onLiveInputSample?: (samples: LiveInputSnapshot[]) => void;
  onFreeCamChange?: (info: FreeCameraInfo) => void;
}

export class KartGameEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private isSoftwareGl: boolean;
  private isMobileDevice: boolean;
  private scene: THREE.Scene;
  private envRenderTarget: THREE.WebGLRenderTarget | null = null;
  private graphicsMode: GraphicsMode = 'optimized';
  private skyMesh: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private hemiLight: THREE.HemisphereLight;
  private keyLight: THREE.DirectionalLight;
  private cameras: THREE.PerspectiveCamera[] = [];
  private studioCamera: THREE.PerspectiveCamera;
  private shadowTex: THREE.CanvasTexture;

  private input: InputManager;
  private sound: SoundEngine;
  private callbacks: EngineCallbacks;

  private screen: GameScreen = 'intro';
  private paused = false;
  private frontCameraView = false;
  private freeCamActive = false;
  private freeCamPos = new THREE.Vector3();
  private freeCamYaw = 0;
  private freeCamPitch = -0.18;
  private freeCamDragging = false;
  private freeCamLastX = 0;
  private freeCamLastY = 0;
  private lastFreeCamSig = '';
  private snapCameraCut = false;
  private wasPlayerAntigravity = false;
  private clock = new THREE.Clock();
  private elapsed = 0;
  private frameId = 0;
  private disposed = false;

  // Track & Racers
  private currentTrackId = TRACKS[0].id;
  private compiledTrack: CompiledTrack;
  private builtTrack: BuiltTrackScene | null = null;
  private visibleChunkSet = new Set<number>();
  private visibleKartSet = new Set<string>();
  private minimapPath: Array<{ x: number; y: number }> = [];
  private minimapBounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };

  private karts: KartPhysicsState[] = [];
  private kartMeshes: Map<string, KartMeshRig> = new Map();
  private ghostMesh: KartMeshRig | null = null;
  private ghostData: Array<{ t: number; x: number; y: number; z: number; h: number }> = [];
  private recordedGhost: Array<{ t: number; x: number; y: number; z: number; h: number }> = [];
  private lastGhostRecordTime = 0;

  // Garage Showcase Rig & 10s Idle Animations
  private garageGroup: THREE.Group;
  private garageKart: KartMeshRig | null = null;
  private garageCharId: CharacterId = 'jarvin';
  private garageIdleWaitTimer = 0;
  private garageIdleAnim: KartIdleAnimation = 'none';
  private garageIdleAnimTimer = 0;

  // Podium 3D Stage
  private podiumGroup: THREE.Group;
  private podiumRigs: Array<{ rig: CharacterRig; rank: number }> = [];

  // 3D Adventure Hub World (with portals)
  private hubScene: BuiltAdventureHubScene | null = null;
  private hubKart: KartPhysicsState | null = null;
  private hubRig: KartMeshRig | null = null;
  private hubPortalCooldown = 0;
  private hubLastHintKey = '';

  // Battle Arena 3D Stage
  private battleScene: BuiltBattleArenaScene | null = null;
  private activeArena: BattleArenaConfig = BATTLE_ARENAS[0];

  // Boss Cutscene, Dark Battle WIN & CTR 3D Intro Stages
  private bossStageGroup: THREE.Group;
  private bossCutsceneRig: CharacterRig | null = null;
  private bossCutsceneBossKart: KartMeshRig | null = null;
  private bossCutscenePlayerKart: KartMeshRig | null = null;
  private bossCutsceneOutcome: BossCutsceneOutcome = 'intro';
  private bossCutsceneSpec: BossSpec | null = null;

  private battleWinGroup: THREE.Group;
  private battleWinWinnerRig: CharacterRig | null = null;
  private battleWinWinnerKart: KartMeshRig | null = null;
  private battleWinLoserRig: CharacterRig | null = null;

  private ctrIntroRig: CtrIntroStageRig | null = null;
  private introSlamPlayed = false;
  private introPickupPlayed = false;

  // Pooled InstancedMesh Particles (Turbo flames, drift sparks, confetti)
  private particleMesh: THREE.InstancedMesh;
  private particles: ParticleSlot[] = [];
  private particleCursor = 0;
  private readonly MAX_PARTICLES: number;

  // Active 3D Homing Rockets, Bowling Bombs, Warp Orbs, Lightnings, TNT Crates, Potions, Time Crates & J-K-T Tokens
  private activeRockets: Array<{
    ownerId: string;
    mesh: THREE.Group;
    x: number;
    y: number;
    z: number;
    heading: number;
    life: number;
    juiced?: boolean;
  }> = [];
  private activeBombs: Array<{
    ownerId: string;
    mesh: THREE.Group;
    x: number;
    y: number;
    z: number;
    heading: number;
    life: number;
    juiced?: boolean;
  }> = [];
  private activeWarpOrbs: Array<{
    ownerId: string;
    mesh: THREE.Group;
    t: number;
    lateral: number;
    life: number;
    juiced?: boolean;
  }> = [];
  private activeLightnings: Array<{
    ownerId: string;
    mesh: THREE.Group;
    x: number;
    y: number;
    z: number;
    targets: string[];
    life: number;
    juiced?: boolean;
  }> = [];
  private activeTntCrates: Array<{
    ownerId: string;
    mesh: THREE.Group;
    x: number;
    y: number;
    z: number;
    grace: number;
    juiced?: boolean;
  }> = [];
  private activePotions: Array<{
    ownerId: string;
    mesh: THREE.Group;
    x: number;
    y: number;
    z: number;
    grace: number;
    juiced?: boolean;
  }> = [];
  private activeTimeCrates: Array<{
    mesh: THREE.Group;
    x: number;
    y: number;
    z: number;
    seconds: 1 | 2 | 3;
    collected: boolean;
  }> = [];
  private activeTokens: Array<{
    letter: 'J' | 'K' | 'T';
    mesh: THREE.Group;
    x: number;
    y: number;
    z: number;
    collected: boolean;
  }> = [];
  private collectedTokens: Array<'J' | 'K' | 'T'> = [];
  private tokensCompletedNotified = false;
  private timeFreezeTimer = 0;
  private timeBonusSavedSec = 0;
  private eliminationTimer = 22.0;
  private eliminationRound = 1;

  // Match & Control Refs
  private matchSettings: MatchSettings = {
    mode: 'arcade',
    trackId: TRACKS[0].id,
    playerCount: 1,
    useAI: true,
    laps: 3,
    aiDifficulty: 'normal',
  };
  private playerSetups: PlayerSetup[] = [];
  private controlConfigs: PlayerControlConfig[] = [];

  private countdownTimer = 3.2;
  private lastCountdownInt = 4;
  private raceTimeMs = 0;
  private hudThrottleTimer = 0;
  private inputSampleTimer = 0;
  private liveInputPollingEnabled = false;
  private introTimer = 0;

  // Online Multiplayer State
  private onlineClient: OnlineClient | null = null;
  private isOnlineRace = false;
  private isOnlineHost = false;
  private remoteHumanIds: Set<string> = new Set();
  private onlineTelemetryTimer = 0;
  private localFinishSent = false;

  constructor(
    container: HTMLElement,
    input: InputManager,
    sound: SoundEngine,
    callbacks: EngineCallbacks,
  ) {
    this.container = container;
    this.input = input;
    this.sound = sound;
    this.callbacks = callbacks;

    this.isMobileDevice =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches ||
        /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
        window.innerWidth < 820);
    this.MAX_PARTICLES = this.isMobileDevice ? 28 : 200;

    // Detect software WebGL (SwiftShader / llvmpipe / WARP)
    this.isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl && !this.isMobileDevice,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = this.isMobileDevice ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.isMobileDevice ? 1.0 : 1.12;
    this.renderer.setPixelRatio(
      this.isMobileDevice
        ? 0.58
        : this.isSoftwareGl
          ? 0.85
          : Math.min(window.devicePixelRatio || 1, 1.25),
    );
    this.renderer.domElement.style.imageRendering = 'auto';
    const allowShadows = !this.isSoftwareGl && !this.isMobileDevice;
    this.renderer.shadowMap.enabled = allowShadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);

    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    if (!this.isMobileDevice && !this.isSoftwareGl) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const envScene = new RoomEnvironment();
      this.envRenderTarget = pmrem.fromScene(envScene, 0.04);
      this.scene.environment = this.envRenderTarget.texture;
      (this.scene as THREE.Scene & { environmentIntensity?: number }).environmentIntensity = 0.65;
      envScene.dispose();
      pmrem.dispose();
    }

    // Warm/Cool CTR Lighting Contrast & Lightweight Follow Shadow Frustum
    this.hemiLight = new THREE.HemisphereLight(0xbae6fd, 0x334155, this.isMobileDevice ? 1.12 : 1.15);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff7ed, this.isMobileDevice ? 1.55 : 1.9);
    this.keyLight.position.set(55, 95, 45);
    this.keyLight.castShadow = allowShadows;
    this.keyLight.shadow.mapSize.set(allowShadows ? 1024 : 512, allowShadows ? 1024 : 512);
    this.keyLight.shadow.camera.near = 8;
    this.keyLight.shadow.camera.far = 220;
    const d = 56;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.03;
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    // Custom Atmospheric Sky GLSL Shader Dome (lightweight on mobile)
    this.skyMat = createAtmosphericSkyMaterial(
      TRACKS[0].skyTop,
      TRACKS[0].skyBottom,
      TRACKS[0].accentColor,
      false,
      this.isMobileDevice,
    );
    this.skyMesh = new THREE.Mesh(
      new THREE.SphereGeometry(this.isMobileDevice ? 245 : 395, this.isMobileDevice ? 12 : 24, this.isMobileDevice ? 8 : 16),
      this.skyMat,
    );
    this.scene.add(this.skyMesh);

    this.shadowTex = createContactShadowTexture();

    // Cameras (up to 8 player cameras for PC + 1 studio/intro/podium camera)
    const w0 = container.clientWidth || 1280;
    const h0 = container.clientHeight || 720;
    const aspect = w0 / h0;
    const camFar = this.isMobileDevice ? 265 : 415;
    for (let i = 0; i < 8; i++) {
      this.cameras.push(new THREE.PerspectiveCamera(65, aspect, 0.25, camFar));
    }
    this.studioCamera = new THREE.PerspectiveCamera(52, aspect, 0.25, camFar);

    // Garage, Podium, Boss Cutscene, Battle Win & CTR Intro staging groups
    this.garageGroup = new THREE.Group();
    this.garageGroup.position.set(0, -100, 0);
    this.buildGarageStage();
    this.scene.add(this.garageGroup);

    this.podiumGroup = new THREE.Group();
    this.podiumGroup.position.set(300, -100, 0);
    this.buildPodiumStage();
    this.scene.add(this.podiumGroup);

    this.bossStageGroup = new THREE.Group();
    this.bossStageGroup.position.set(600, -100, 0);
    this.buildBossCutsceneStage();
    this.scene.add(this.bossStageGroup);

    this.battleWinGroup = new THREE.Group();
    this.battleWinGroup.position.set(900, -100, 0);
    this.buildBattleWinStage();
    this.scene.add(this.battleWinGroup);

    this.ctrIntroRig = buildCtrIntroStage(this.isMobileDevice);
    this.ctrIntroRig.stageGroup.position.set(1200, -100, 0);
    this.scene.add(this.ctrIntroRig.stageGroup);

    // Pooled InstancedMesh particles
    const pGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleMesh = new THREE.InstancedMesh(pGeo, pMat, this.MAX_PARTICLES);
    this.particleMesh.frustumCulled = false;
    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: -999,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size: 0,
        r: 1,
        g: 1,
        b: 1,
      });
      _dummy.position.set(0, -999, 0);
      _dummy.scale.setScalar(0);
      _dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, _dummy.matrix);
      this.particleMesh.setColorAt(i, _color.setHex(0xffffff));
    }
    this.scene.add(this.particleMesh);

    // Load initial track
    this.compiledTrack = compileTrack(TRACKS[0], this.isMobileDevice ? 120 : 340);
    this.loadTrack(TRACKS[0].id);

    window.addEventListener('resize', this.handleResize);
    this.renderer.domElement.addEventListener('pointerdown', this.handleFreeCamPointerDown);
    window.addEventListener('pointermove', this.handleFreeCamPointerMove);
    window.addEventListener('pointerup', this.handleFreeCamPointerUp);
    window.addEventListener('pointercancel', this.handleFreeCamPointerUp);
    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.studioCamera);
    }

    this.startLoop();
  }

  private buildGarageStage(): void {
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(7, 7.5, 0.5, 32),
      new THREE.MeshStandardMaterial({ color: '#111827', metalness: 0.75, roughness: 0.22 }),
    );
    floor.position.y = -0.25;
    floor.receiveShadow = true;
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(6.8, 0.12, 8, 48),
      new THREE.MeshStandardMaterial({
        color: '#22c55e',
        emissive: '#22c55e',
        emissiveIntensity: 1.5,
      }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.04;
    const backdrop = new THREE.Mesh(
      new THREE.CylinderGeometry(18, 18, 14, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: '#090d14', side: THREE.BackSide, roughness: 0.9 }),
    );
    backdrop.position.y = 6;
    const spot = new THREE.PointLight(0xffffff, 24, 30);
    spot.position.set(4, 7, 5);
    const rimSpot = new THREE.PointLight(0x22c55e, 18, 25);
    rimSpot.position.set(-5, 4, -4);
    this.garageGroup.add(floor, rim, backdrop, spot, rimSpot);
  }

  private buildPodiumStage(): void {
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(12, 13, 0.5, 32),
      new THREE.MeshStandardMaterial({ color: '#0f172a', metalness: 0.25, roughness: 0.62 }),
    );
    floor.position.y = -0.25;

    const backdrop = new THREE.Mesh(
      new THREE.CylinderGeometry(20, 20, 16, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: '#090d14', side: THREE.BackSide, roughness: 0.9 }),
    );
    backdrop.position.y = 7;

    // 1st (Center, tall), 2nd (Left, medium), 3rd (Right, low)
    const makePedestal = (x: number, h: number, color: string) => {
      const ped = new THREE.Mesh(
        new THREE.CylinderGeometry(1.5, 1.7, h, 24),
        new THREE.MeshStandardMaterial({
          color,
          metalness: 0.65,
          roughness: 0.25,
          emissive: color,
          emissiveIntensity: 0.25,
        }),
      );
      ped.position.set(x, h / 2, 0);
      return ped;
    };

    const ped1 = makePedestal(0, 2.2, '#facc15');
    const ped2 = makePedestal(-3.4, 1.4, '#94a3b8');
    const ped3 = makePedestal(3.4, 0.9, '#d97706');

    const goldLight = new THREE.PointLight(0xfde047, 30, 35);
    goldLight.position.set(0, 8, 5);
    const fill = new THREE.PointLight(0x38bdf8, 16, 30);
    fill.position.set(-6, 5, 4);

    this.podiumGroup.add(floor, backdrop, ped1, ped2, ped3, goldLight, fill);
  }

  private buildBossCutsceneStage(): void {
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(11, 12, 0.6, 32),
      new THREE.MeshStandardMaterial({ color: '#110b12', metalness: 0.45, roughness: 0.4 }),
    );
    floor.position.y = -0.3;
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(6.5, 0.14, 10, 40),
      new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: '#ef4444', emissiveIntensity: 1.5 }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.05;
    const backdrop = new THREE.Mesh(
      new THREE.CylinderGeometry(20, 20, 16, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: '#090408', side: THREE.BackSide, roughness: 0.92 }),
    );
    backdrop.position.y = 7;
    const redSpot = new THREE.PointLight(0xef4444, 34, 32);
    redSpot.position.set(3, 6, 5);
    const rimSpot = new THREE.PointLight(0xfacc15, 18, 28);
    rimSpot.position.set(-5, 4, -3);
    this.bossStageGroup.add(floor, rim, backdrop, redSpot, rimSpot);
  }

  private buildBattleWinStage(): void {
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(12, 12, 0.6, 32),
      new THREE.MeshStandardMaterial({ color: '#07090f', metalness: 0.5, roughness: 0.45 }),
    );
    floor.position.y = -0.3;
    const spotlightRing = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.0, 32),
      new THREE.MeshStandardMaterial({ color: '#facc15', emissive: '#facc15', emissiveIntensity: 1.2 }),
    );
    spotlightRing.rotation.x = -Math.PI / 2;
    spotlightRing.position.set(-1.1, 0.04, 0.2);
    const backdrop = new THREE.Mesh(
      new THREE.CylinderGeometry(22, 22, 16, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: '#04060a', side: THREE.BackSide, roughness: 0.95 }),
    );
    backdrop.position.y = 7;
    const keySpot = new THREE.PointLight(0xfde047, 32, 32);
    keySpot.position.set(-1.5, 7.5, 5);
    const dizzySpot = new THREE.PointLight(0x64748b, 14, 24);
    dizzySpot.position.set(4.5, 5.5, 4);
    this.battleWinGroup.add(floor, spotlightRing, backdrop, keySpot, dizzySpot);
  }

  public setGraphicsMode(mode: GraphicsMode): void {
    this.graphicsMode = mode;
    if (mode === 'ps1') {
      this.renderer.setPixelRatio(this.isMobileDevice ? 0.36 : 0.45);
      this.renderer.shadowMap.enabled = false;
      this.keyLight.castShadow = false;
      this.renderer.domElement.style.imageRendering = 'pixelated';
      applyPs1FilterToObject(this.scene, true);
    } else {
      const dpr = this.isMobileDevice
        ? 0.58
        : this.isSoftwareGl
          ? 0.85
          : Math.min(window.devicePixelRatio || 1, 1.25);
      const allowShadows = !this.isSoftwareGl && !this.isMobileDevice;
      this.renderer.setPixelRatio(dpr);
      this.renderer.shadowMap.enabled = allowShadows;
      this.keyLight.castShadow = allowShadows;
      this.renderer.domElement.style.imageRendering = 'auto';
      applyPs1FilterToObject(this.scene, false);
    }
    this.handleResize();
  }

  public setAudioMode(mode: AudioChannelMode): void {
    this.sound.setAudioMode(mode);
  }

  public setTouchControlState(partial: Partial<TouchControlState>): void {
    this.input.setTouchControlState(partial);
  }

  public triggerTouchPulse(action: 'jump' | 'item' | 'pause'): void {
    this.input.triggerTouchPulse(action);
  }

  public clearTouchState(): void {
    this.input.clearTouchState();
  }

  private computeMinimapCache(): void {
    const samples = this.compiledTrack.samples;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of samples) {
      if (s.point.x < minX) minX = s.point.x;
      if (s.point.x > maxX) maxX = s.point.x;
      if (s.point.z < minZ) minZ = s.point.z;
      if (s.point.z > maxZ) maxZ = s.point.z;
    }
    const pad = 18;
    minX -= pad;
    maxX += pad;
    minZ -= pad;
    maxZ += pad;
    const span = Math.max(maxX - minX, maxZ - minZ, 1);
    const midX = (minX + maxX) * 0.5;
    const midZ = (minZ + maxZ) * 0.5;
    this.minimapBounds = {
      minX: midX - span * 0.5,
      maxX: midX + span * 0.5,
      minZ: midZ - span * 0.5,
      maxZ: midZ + span * 0.5,
    };

    const pts: Array<{ x: number; y: number }> = [];
    const count = 64;
    for (let i = 0; i < count; i++) {
      const s = samples[Math.floor((i / count) * samples.length) % samples.length];
      pts.push(this.worldToMinimap(s.point.x, s.point.z));
    }
    this.minimapPath = pts;
  }

  private worldToMinimap(wx: number, wz: number): { x: number; y: number } {
    const { minX, maxX, minZ, maxZ } = this.minimapBounds;
    return {
      x: Number((((wx - minX) / (maxX - minX)) * 100).toFixed(1)),
      y: Number((((wz - minZ) / (maxZ - minZ)) * 100).toFixed(1)),
    };
  }

  public loadTrack(trackId: string): void {
    const cfg = TRACKS.find((t) => t.id === trackId) ?? TRACKS[0];
    this.currentTrackId = cfg.id;
    this.compiledTrack = compileTrack(cfg, this.isMobileDevice ? 120 : 340);
    this.computeMinimapCache();

    if (this.builtTrack) {
      this.scene.remove(this.builtTrack.group);
      this.builtTrack.disposables.forEach((d) => d.dispose());
    }

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.builtTrack = buildTrackGeometryAndProps(this.compiledTrack, maxAniso, this.isMobileDevice);
    this.visibleChunkSet.clear();
    if (this.graphicsMode === 'ps1') {
      applyPs1FilterToObject(this.builtTrack.envGroup, true);
    }
    this.scene.add(this.builtTrack.group);

    // Update Atmospheric GLSL Sky Shader uniforms
    const isNightOrCave =
      cfg.theme === 'neon' ||
      cfg.theme === 'space' ||
      cfg.theme === 'volcano' ||
      cfg.theme === 'cave' ||
      cfg.theme === 'mines' ||
      cfg.theme === 'castle';
    this.skyMat.uniforms.uTopColor.value.set(cfg.skyTop);
    this.skyMat.uniforms.uBottomColor.value.set(cfg.skyBottom);
    this.skyMat.uniforms.uAccentColor.value.set(cfg.accentColor);
    this.skyMat.uniforms.uNight.value = isNightOrCave ? 1.0 : 0.0;

    // Linear Horizon Fog finishes BEFORE chunkHorizon so distant chunks appear seamlessly in mist
    this.scene.background = new THREE.Color(cfg.fogColor);
    const fogNear = this.isMobileDevice ? (isNightOrCave ? 40 : 48) : (isNightOrCave ? 78 : 90);
    const fogFar = this.isMobileDevice ? (isNightOrCave ? 185 : 198) : (isNightOrCave ? 305 : 325);
    this.scene.fog = new THREE.Fog(cfg.fogColor, fogNear, fogFar);

    if (isNightOrCave) {
      this.hemiLight.intensity = 1.0;
      this.keyLight.intensity = this.isMobileDevice ? 1.4 : 1.65;
    } else {
      this.hemiLight.intensity = this.isMobileDevice ? 1.12 : 1.18;
      this.keyLight.intensity = this.isMobileDevice ? 1.55 : 1.95;
    }
  }

  public setControlConfigs(configs: PlayerControlConfig[]): void {
    this.controlConfigs = configs;
  }

  public setLiveInputPollingEnabled(enabled: boolean): void {
    this.liveInputPollingEnabled = enabled;
  }

  private applyScreenAtmosphere(screen: GameScreen): void {
    const cfg = TRACKS.find((t) => t.id === this.currentTrackId) ?? TRACKS[0];
    const inTrackView =
      screen === 'title' ||
      (screen === 'race' && this.matchSettings.mode !== 'battle');
    const inBattleView = screen === 'race' && this.matchSettings.mode === 'battle';
    const inHubView = screen === 'adventure_hub';
    const inOutdoorWorld = inTrackView || inBattleView || inHubView;

    if (this.builtTrack) {
      this.builtTrack.group.visible = inTrackView;
    }
    if (this.battleScene) {
      this.battleScene.group.visible = inBattleView;
    }
    if (this.hubScene) {
      this.hubScene.group.visible = inHubView;
    }
    if (this.hubRig) {
      this.hubRig.root.visible = inHubView;
    }
    if (this.ctrIntroRig) {
      this.ctrIntroRig.stageGroup.visible = screen === 'intro';
    }
    this.kartMeshes.forEach((rig) => {
      rig.root.visible = inTrackView || inBattleView;
    });

    if (!inOutdoorWorld) {
      this.scene.fog = null;
      this.scene.background = new THREE.Color('#090d14');
      this.skyMesh.visible = false;
    } else if (inBattleView) {
      this.skyMat.uniforms.uTopColor.value.set(this.activeArena.skyTop);
      this.skyMat.uniforms.uBottomColor.value.set(this.activeArena.skyBottom);
      this.skyMat.uniforms.uAccentColor.value.set(this.activeArena.accentColor);
      this.skyMat.uniforms.uNight.value = 1.0;
      this.scene.fog = new THREE.Fog(this.activeArena.skyTop, 48, this.isMobileDevice ? 190 : 310);
      this.scene.background = new THREE.Color(this.activeArena.skyTop);
      this.skyMesh.visible = true;
    } else if (inHubView) {
      this.skyMat.uniforms.uTopColor.value.set('#0284c7');
      this.skyMat.uniforms.uBottomColor.value.set('#bae6fd');
      this.skyMat.uniforms.uAccentColor.value.set('#facc15');
      this.skyMat.uniforms.uNight.value = 0.0;
      this.scene.fog = new THREE.Fog('#93c5fd', 55, this.isMobileDevice ? 200 : 320);
      this.scene.background = new THREE.Color('#93c5fd');
      this.skyMesh.visible = true;
    } else {
      const isNight =
        cfg.theme === 'neon' ||
        cfg.theme === 'space' ||
        cfg.theme === 'volcano' ||
        cfg.theme === 'cave' ||
        cfg.theme === 'mines' ||
        cfg.theme === 'castle' ||
        cfg.theme === 'oxide';
      this.skyMat.uniforms.uTopColor.value.set(cfg.skyTop);
      this.skyMat.uniforms.uBottomColor.value.set(cfg.skyBottom);
      this.skyMat.uniforms.uAccentColor.value.set(cfg.accentColor);
      this.skyMat.uniforms.uNight.value = isNight ? 1.0 : 0.0;
      const fogNear = this.isMobileDevice ? (isNight ? 40 : 48) : (isNight ? 78 : 90);
      const fogFar = this.isMobileDevice ? (isNight ? 185 : 198) : (isNight ? 305 : 325);
      this.scene.fog = new THREE.Fog(cfg.fogColor, fogNear, fogFar);
      this.scene.background = new THREE.Color(cfg.fogColor);
      this.skyMesh.visible = true;
    }
  }

  public setScreen(screen: GameScreen): void {
    this.screen = screen;
    if (screen !== 'race' && screen !== 'title' && screen !== 'adventure_hub' && this.freeCamActive) {
      this.freeCamActive = false;
      this.freeCamDragging = false;
      this.notifyFreeCamStats(true);
    }
    this.applyScreenAtmosphere(screen);
    if (screen !== 'race') {
      this.sound.stopEngine();
      this.sound.setAkuAkuLoopActive(false);
    }
    if (screen === 'intro') {
      this.introTimer = 0;
      this.introSlamPlayed = false;
      this.introPickupPlayed = false;
      this.clearRaceKarts();
      this.studioCamera.position.set(1200, -98.0, 7.6);
      this.studioCamera.lookAt(1200, -98.35, 0);
    } else if (screen === 'title') {
      this.spawnDemoRacers();
    } else if (screen === 'garage') {
      this.stepGarage(0.016);
    }
    this.renderCurrentView();
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.sound.stopEngine();
      this.sound.setAkuAkuLoopActive(false);
      this.input.clearInputs();
    }
  }

  public toggleFrontCamera(): boolean {
    this.frontCameraView = !this.frontCameraView;
    this.snapCameraCut = true;
    if (this.screen === 'race') {
      this.callbacks.onHudUpdate(this.buildHudSnapshot());
    }
    return this.frontCameraView;
  }

  public isFrontCamera(): boolean {
    return this.frontCameraView;
  }

  public toggleFreeCamera(): boolean {
    this.freeCamActive = !this.freeCamActive;
    this.freeCamDragging = false;
    if (this.freeCamActive) {
      const srcCam = this.screen === 'race' ? (this.cameras[0] ?? this.studioCamera) : this.studioCamera;
      this.freeCamPos.copy(srcCam.position);
      _v1.set(0, 0, -1).applyQuaternion(srcCam.quaternion);
      this.freeCamYaw = Math.atan2(-_v1.x, -_v1.z);
      this.freeCamPitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(_v1.y, -0.99, 0.99)), -1.42, 1.42);
    } else {
      this.snapCameraCut = true;
    }
    this.notifyFreeCamStats(true);
    return this.freeCamActive;
  }

  private handleFreeCamPointerDown = (e: PointerEvent): void => {
    if (!this.freeCamActive) return;
    this.freeCamDragging = true;
    this.freeCamLastX = e.clientX;
    this.freeCamLastY = e.clientY;
  };

  private handleFreeCamPointerMove = (e: PointerEvent): void => {
    if (!this.freeCamActive || !this.freeCamDragging) return;
    const dx = e.clientX - this.freeCamLastX;
    const dy = e.clientY - this.freeCamLastY;
    this.freeCamLastX = e.clientX;
    this.freeCamLastY = e.clientY;
    this.freeCamYaw -= dx * 0.0048;
    this.freeCamPitch = THREE.MathUtils.clamp(this.freeCamPitch - dy * 0.0048, -1.42, 1.42);
  };

  private handleFreeCamPointerUp = (): void => {
    this.freeCamDragging = false;
  };

  private stepFreeCamera(dt: number): void {
    if (!this.freeCamActive) return;
    const lookSpeed = 1.9 * dt;
    if (this.input.isKeyPressed('KeyJ')) this.freeCamYaw += lookSpeed;
    if (this.input.isKeyPressed('KeyL')) this.freeCamYaw -= lookSpeed;
    if (this.input.isKeyPressed('KeyI')) this.freeCamPitch = THREE.MathUtils.clamp(this.freeCamPitch + lookSpeed * 0.75, -1.42, 1.42);
    if (this.input.isKeyPressed('KeyK')) this.freeCamPitch = THREE.MathUtils.clamp(this.freeCamPitch - lookSpeed * 0.75, -1.42, 1.42);

    const cosP = Math.cos(this.freeCamPitch);
    const fx = -Math.sin(this.freeCamYaw) * cosP;
    const fy = Math.sin(this.freeCamPitch);
    const fz = -Math.cos(this.freeCamYaw) * cosP;
    const rx = Math.cos(this.freeCamYaw);
    const rz = -Math.sin(this.freeCamYaw);

    const moveSpeed = (this.input.isShiftPressed() ? 98 : 38) * dt;
    const fwd =
      (this.input.isKeyPressed('KeyW') || this.input.isKeyPressed('ArrowUp') ? 1 : 0) -
      (this.input.isKeyPressed('KeyS') || this.input.isKeyPressed('ArrowDown') ? 1 : 0);
    const strafe =
      (this.input.isKeyPressed('KeyD') || this.input.isKeyPressed('ArrowRight') ? 1 : 0) -
      (this.input.isKeyPressed('KeyA') || this.input.isKeyPressed('ArrowLeft') ? 1 : 0);
    const vert =
      (this.input.isKeyPressed('KeyE') || this.input.isKeyPressed('Space') ? 1 : 0) -
      (this.input.isKeyPressed('KeyQ') || this.input.isKeyPressed('KeyC') ? 1 : 0);

    this.freeCamPos.x += (fx * fwd + rx * strafe) * moveSpeed;
    this.freeCamPos.y += (fy * fwd + vert) * moveSpeed;
    this.freeCamPos.z += (fz * fwd + rz * strafe) * moveSpeed;

    const cam = this.screen === 'race' ? (this.cameras[0] ?? this.studioCamera) : this.studioCamera;
    cam.position.copy(this.freeCamPos);
    _v2.set(this.freeCamPos.x + fx * 10, this.freeCamPos.y + fy * 10, this.freeCamPos.z + fz * 10);
    cam.lookAt(_v2);
    cam.updateMatrixWorld();
  }

  private notifyFreeCamStats(force = false): void {
    if (!this.callbacks.onFreeCamChange) return;
    const totalChunks = this.builtTrack?.chunks.length ?? 0;
    const builtChunks = this.builtTrack ? this.builtTrack.chunks.filter((c) => c.built).length : 0;
    const visibleChunks = this.visibleChunkSet.size;
    const sig = `${this.freeCamActive}|${visibleChunks}|${builtChunks}|${totalChunks}`;
    if (!force && sig === this.lastFreeCamSig) return;
    this.lastFreeCamSig = sig;
    this.callbacks.onFreeCamChange({
      active: this.freeCamActive,
      visibleChunks,
      builtChunks,
      totalChunks,
    });
  }

  public updateGaragePreview(characterId: CharacterId, customization: KartCustomization): void {
    if (this.garageKart && this.garageCharId === characterId) {
      this.garageKart.bodyMat.color.set(customization.bodyColor);
      this.garageKart.rimMat.color.set(customization.rimColor);
      this.garageKart.neonMat.color.set(customization.neonColor);
      this.garageKart.neonMat.emissive.set(customization.neonColor);
      this.garageKart.exhaustFlames.forEach((f) => {
        f.material.uniforms.uFlameColor.value.set(customization.neonColor);
      });
      return;
    }

    if (this.garageKart) {
      this.garageGroup.remove(this.garageKart.root);
    }

    this.garageCharId = characterId;
    this.garageIdleWaitTimer = 0;
    this.garageIdleAnim = 'none';
    this.garageIdleAnimTimer = 0;
    this.garageKart = createKartModel(characterId, customization, this.shadowTex, this.isMobileDevice);
    this.garageKart.root.position.set(0, 0, 0);
    if (this.graphicsMode === 'ps1') {
      applyPs1FilterToObject(this.garageKart.root, true);
    }
    this.garageGroup.add(this.garageKart.root);
    if (this.screen === 'garage') {
      this.stepGarage(0.016);
      this.renderCurrentView();
    }
  }

  private clearRaceKarts(): void {
    this.kartMeshes.forEach((rig) => this.scene.remove(rig.root));
    this.kartMeshes.clear();
    this.activeRockets.forEach((r) => this.scene.remove(r.mesh));
    this.activeRockets = [];
    this.activeBombs.forEach((b) => this.scene.remove(b.mesh));
    this.activeBombs = [];
    this.activeWarpOrbs.forEach((w) => this.scene.remove(w.mesh));
    this.activeWarpOrbs = [];
    this.activeLightnings.forEach((l) => this.scene.remove(l.mesh));
    this.activeLightnings = [];
    this.activeTntCrates.forEach((c) => this.scene.remove(c.mesh));
    this.activeTntCrates = [];
    this.activePotions.forEach((p) => this.scene.remove(p.mesh));
    this.activePotions = [];
    this.activeTimeCrates.forEach((tc) => this.scene.remove(tc.mesh));
    this.activeTimeCrates = [];
    this.activeTokens.forEach((tk) => this.scene.remove(tk.mesh));
    this.activeTokens = [];
    this.collectedTokens = [];
    this.tokensCompletedNotified = false;
    this.timeFreezeTimer = 0;
    this.timeBonusSavedSec = 0;
    this.eliminationTimer = 22.0;
    this.eliminationRound = 1;
    if (this.ghostMesh) {
      this.scene.remove(this.ghostMesh.root);
      this.ghostMesh = null;
    }
    this.karts = [];
  }

  private makeKartState(params: {
    id: string;
    name: string;
    characterId: CharacterId;
    isPlayer: boolean;
    playerIndex: number;
    customization: KartCustomization;
    x: number;
    y: number;
    z: number;
    heading: number;
    speed?: number;
    nearestT?: number;
    maxProgress?: number;
    rank?: number;
    aiTargetOffset?: number;
    infiniteTurbo?: boolean;
  }): KartPhysicsState {
    return {
      id: params.id,
      name: params.name,
      characterId: params.characterId,
      isPlayer: params.isPlayer,
      playerIndex: params.playerIndex,
      customization: params.customization,
      x: params.x,
      y: params.y,
      z: params.z,
      vx: 0,
      vy: 0,
      vz: 0,
      heading: params.heading,
      speed: params.speed ?? 0,
      steerAngle: 0,
      grounded: true,
      pitch: 0,
      roll: 0,
      drifting: false,
      driftDir: 0,
      driftCharge: 0,
      turboEnergy: 65,
      turboActiveTimer: 0,
      infiniteTurbo: params.infiniteTurbo ?? false,
      wumpas: 0,
      heldItem: null,
      shieldTimer: 0,
      akuAkuTimer: 0,
      spinoutTimer: 0,
      stunTimer: 0,
      burnTimer: 0,
      slowTimer: 0,
      timeSlowTimer: 0,
      slipperyTimer: 0,
      tntTimer: 0,
      tntShakeJumps: 0,
      fallRespawnTimer: 0,
      eliminated: false,
      eliminatedAtMs: 0,
      laughTimer: 0,
      hurtTimer: 0,
      expression: 'normal',
      idleWaitTimer: 0,
      idleAnim: 'none',
      idleAnimTimer: 0,
      boostPadCooldown: 0,
      jumpSquash: 1,
      battleKills: 0,
      nearestT: params.nearestT ?? 0,
      lap: 1,
      maxProgress: params.maxProgress ?? 0,
      finished: false,
      finishTimeMs: 0,
      rank: params.rank ?? 1,
      aiTargetOffset: params.aiTargetOffset ?? 0,
      aiReactionTimer: 0.6,
      aiItemCooldown: 2.2,
    };
  }

  private spawnDemoRacers(): void {
    this.clearRaceKarts();
    const charIds: CharacterId[] = this.isMobileDevice
      ? ['jarvin', 'joaquin', 'crash']
      : ['jarvin', 'joaquin', 'crash', 'n_tropy', 'penta_penguin'];
    const n = this.compiledTrack.samples.length;

    charIds.forEach((cid, i) => {
      const t = (0.02 + i * 0.015) % 1;
      const smp = this.compiledTrack.samples[Math.floor(t * n) % n];
      const lateral = (i % 2 === 0 ? -1 : 1) * 3.5;
      const heading = Math.atan2(smp.tangent.x, smp.tangent.z);
      const spec = CHARACTER_MAP[cid];

      const state = this.makeKartState({
        id: `demo_${cid}`,
        name: spec.name,
        characterId: cid,
        isPlayer: false,
        playerIndex: -1,
        customization: { ...spec.defaultCustomization },
        x: smp.point.x + smp.right.x * lateral,
        y: smp.point.y,
        z: smp.point.z + smp.right.z * lateral,
        heading,
        speed: 25,
        nearestT: t,
        maxProgress: t,
        rank: i + 1,
        aiTargetOffset: lateral,
      });
      state.turboEnergy = 85;
      state.turboActiveTimer = i === 0 ? 1.5 : 0;

      this.karts.push(state);
      const rig = createKartModel(cid, state.customization, this.shadowTex, this.isMobileDevice);
      if (this.graphicsMode === 'ps1') applyPs1FilterToObject(rig.root, true);
      this.kartMeshes.set(state.id, rig);
      this.scene.add(rig.root);
    });

    const lead = this.karts[0];
    if (lead) {
      this.studioCamera.position.set(
        lead.x - Math.sin(lead.heading) * 12,
        lead.y + 5.2,
        lead.z - Math.cos(lead.heading) * 12,
      );
      this.studioCamera.lookAt(lead.x, lead.y + 1.1, lead.z);
    }
  }

  public startRace(
    settings: MatchSettings,
    setups: PlayerSetup[],
    controls: PlayerControlConfig[],
    ghostRecording?: Array<{ t: number; x: number; y: number; z: number; h: number }>,
  ): void {
    const isElimination = settings.mode === 'elimination';
    const isSoloTimeMode = settings.mode === 'timetrial' || settings.mode === 'relic';
    const isBossMode = settings.mode === 'boss';
    const clampedPlayers = isElimination
      ? 2
      : isSoloTimeMode || isBossMode
        ? 1
        : this.isMobileDevice
          ? Math.max(1, Math.min(2, settings.playerCount))
          : Math.max(1, Math.min(8, settings.playerCount));

    const resolvedSettings: MatchSettings = {
      ...settings,
      playerCount: clampedPlayers,
      laps: settings.mode === 'relic' ? 2 : settings.mode === 'elimination' ? 99 : settings.laps,
      battleKillGoal: settings.battleKillGoal ?? 5,
    };
    this.matchSettings = resolvedSettings;
    this.playerSetups = setups;
    this.controlConfigs = controls;
    this.paused = false;
    this.frontCameraView = false;
    this.snapCameraCut = true;

    this.clearRaceKarts();
    this.recordedGhost = [];
    this.lastGhostRecordTime = 0;
    this.ghostData = ghostRecording ?? [];

    this.isOnlineRace = false;
    this.isOnlineHost = false;
    this.onlineClient = null;
    this.remoteHumanIds.clear();
    this.localFinishSent = false;

    // Battle Mode Setup (Enclosed 3D Deathmatch Arena)
    if (resolvedSettings.mode === 'battle') {
      const arena = BATTLE_ARENAS.find((a) => a.id === resolvedSettings.arenaId) ?? BATTLE_ARENAS[0];
      this.activeArena = arena;
      if (this.battleScene) {
        this.scene.remove(this.battleScene.group);
        this.battleScene.disposables.forEach((d) => d.dispose());
      }
      this.battleScene = buildBattleArenaStage(arena, this.renderer.capabilities.getMaxAnisotropy());
      if (this.graphicsMode === 'ps1') applyPs1FilterToObject(this.battleScene.group, true);
      this.scene.add(this.battleScene.group);

      const totalHuman = Math.max(1, Math.min(8, resolvedSettings.playerCount));
      const requestedAi = typeof resolvedSettings.aiCount === 'number' ? resolvedSettings.aiCount : 2;
      const includeAI = totalHuman === 1 || (resolvedSettings.useAI && requestedAi > 0);
      const racers: Array<{
        id: string;
        name: string;
        characterId: CharacterId;
        isPlayer: boolean;
        playerIndex: number;
        customization: KartCustomization;
      }> = [];

      for (let p = 0; p < totalHuman; p++) {
        const setup = setups[p] ?? setups[0];
        const spec = CHARACTER_MAP[setup.characterId];
        racers.push({
          id: `p_${p}`,
          name: totalHuman > 1 ? `J${p + 1} · ${spec.name}` : spec.name,
          characterId: setup.characterId,
          isPlayer: true,
          playerIndex: p,
          customization: { ...setup.customization },
        });
      }
      if (includeAI) {
        const usedChars = new Set(racers.map((r) => r.characterId));
        const allChars: CharacterId[] = ['jarvin', 'joaquin', 'crash', 'armagedon', 'fedex', 'jason', 'lucia', 'n_tropy', 'penta_penguin', 'falso_jarvin'];
        const aiPool = allChars.filter((c) => !usedChars.has(c));
        const needed = totalHuman === 1 ? Math.max(1, Math.min(3, requestedAi)) : Math.min(requestedAi, Math.max(0, 6 - racers.length));
        for (let i = 0; i < needed; i++) {
          const cid = aiPool[i] ?? allChars[(i + racers.length) % allChars.length];
          const spec = CHARACTER_MAP[cid];
          racers.push({
            id: `ai_${i}`,
            name: `${spec.name} (IA)`,
            characterId: cid,
            isPlayer: false,
            playerIndex: -1,
            customization: { ...spec.defaultCustomization },
          });
        }
      }

      racers.forEach((r, idx) => {
        const ang = (idx / Math.max(1, racers.length)) * Math.PI * 2;
        const spawnR = arena.radius * 0.68;
        const sx = Math.sin(ang) * spawnR;
        const sz = Math.cos(ang) * spawnR;
        const heading = Math.atan2(-sx, -sz);
        const state = this.makeKartState({
          id: r.id,
          name: r.name,
          characterId: r.characterId,
          isPlayer: r.isPlayer,
          playerIndex: r.playerIndex,
          customization: r.customization,
          x: sx,
          y: 0,
          z: sz,
          heading,
          rank: idx + 1,
        });
        this.karts.push(state);
        const rig = createKartModel(r.characterId, r.customization, this.shadowTex, this.isMobileDevice);
        if (this.graphicsMode === 'ps1') applyPs1FilterToObject(rig.root, true);
        this.kartMeshes.set(state.id, rig);
        this.scene.add(rig.root);

        if (r.isPlayer && this.cameras[r.playerIndex]) {
          const cam = this.cameras[r.playerIndex];
          cam.position.set(sx - Math.sin(heading) * 8, 3.8, sz - Math.cos(heading) * 8);
          cam.lookAt(sx, 1.3, sz);
        }
      });

      this.countdownTimer = 2.6;
      this.lastCountdownInt = 3;
      this.raceTimeMs = 0;
      this.screen = 'race';
      this.applyScreenAtmosphere('race');
      this.input.clearInputs();
      this.renderCurrentView();
      this.callbacks.onHudUpdate(this.buildHudSnapshot());
      return;
    }

    // Standard / Adventure / Relic / Boss / Madness / Elimination / Tokens Track Mode
    const targetTrackId =
      resolvedSettings.mode === 'boss' && resolvedSettings.bossId && BOSS_MAP[resolvedSettings.bossId]
        ? BOSS_MAP[resolvedSettings.bossId].trackId
        : resolvedSettings.trackId;
    if (this.currentTrackId !== targetTrackId) {
      this.loadTrack(targetTrackId);
    }

    const isMadness = resolvedSettings.mode === 'madness';
    const totalHuman = resolvedSettings.playerCount;
    const requestedAi = typeof resolvedSettings.aiCount === 'number' ? resolvedSettings.aiCount : 4;
    const includeAI =
      !isSoloTimeMode &&
      !isBossMode &&
      (totalHuman === 1 || isMadness || isElimination || (resolvedSettings.useAI && requestedAi > 0));

    const racers: Array<{
      id: string;
      name: string;
      characterId: CharacterId;
      isPlayer: boolean;
      playerIndex: number;
      customization: KartCustomization;
      infiniteTurbo?: boolean;
    }> = [];

    for (let p = 0; p < totalHuman; p++) {
      const setup = setups[p] ?? setups[0];
      const spec = CHARACTER_MAP[setup.characterId];
      racers.push({
        id: `p_${p}`,
        name: totalHuman > 1 ? `J${p + 1} · ${spec.name}` : spec.name,
        characterId: setup.characterId,
        isPlayer: true,
        playerIndex: p,
        customization: { ...setup.customization },
        infiniteTurbo: isMadness,
      });
    }

    if (isBossMode && resolvedSettings.bossId) {
      const bossSpec = BOSS_MAP[resolvedSettings.bossId] ?? BOSS_MAP.jarvin_exe;
      const bChar = CHARACTER_MAP[bossSpec.characterId];
      racers.push({
        id: `boss_${bossSpec.id}`,
        name: `${bossSpec.name} (JEFE)`,
        characterId: bossSpec.characterId,
        isPlayer: false,
        playerIndex: -1,
        customization: { ...bChar.defaultCustomization },
        infiniteTurbo: bossSpec.infiniteTurbo,
      });
    } else if (isMadness) {
      // MODO LOCURA: ALL characters (plus bosses!) race together with unlimited power-ups & insane speed!
      const usedChars = new Set(racers.map((r) => r.characterId));
      const allMadnessChars = CHARACTERS.map((c) => c.id).filter((id) => !usedChars.has(id));
      const limit = this.isMobileDevice ? 8 : allMadnessChars.length;
      for (let i = 0; i < limit; i++) {
        const cid = allMadnessChars[i];
        const spec = CHARACTER_MAP[cid];
        racers.push({
          id: `mad_${i}_${cid}`,
          name: `${spec.name} (LOCURA)`,
          characterId: cid,
          isPlayer: false,
          playerIndex: -1,
          customization: { ...spec.defaultCustomization },
          infiniteTurbo: true,
        });
      }
    } else if (includeAI) {
      const usedChars = new Set(racers.map((r) => r.characterId));
      const allChars: CharacterId[] = ['jarvin', 'joaquin', 'crash', 'armagedon', 'fedex', 'jason', 'lucia', 'n_tropy', 'penta_penguin', 'falso_jarvin'];
      const aiPool = allChars.filter((c) => !usedChars.has(c));
      const targetGrid = isElimination ? 6 : Math.max(5, racers.length + 2);
      const maxSlots = Math.max(0, targetGrid - racers.length);
      const neededAi = isElimination ? 4 : totalHuman === 1 ? Math.max(1, Math.min(requestedAi, maxSlots)) : Math.min(requestedAi, maxSlots);
      for (let i = 0; i < neededAi; i++) {
        const cid = aiPool[i] ?? allChars[(i + racers.length) % allChars.length];
        const spec = CHARACTER_MAP[cid];
        racers.push({
          id: `ai_${i}`,
          name: spec.name,
          characterId: cid,
          isPlayer: false,
          playerIndex: -1,
          customization: { ...spec.defaultCustomization },
        });
      }
    }

    const n = this.compiledTrack.samples.length;
    racers.forEach((r, idx) => {
      const row = Math.floor(idx / 2);
      const col = idx % 2 === 0 ? -1 : 1;
      const startT = wrapT(0.988 - row * 0.011);
      const smp = this.compiledTrack.samples[Math.floor(startT * n) % n];
      const lateral = col * (racers.length > 6 ? 4.2 : 3.6);
      const heading = Math.atan2(smp.tangent.x, smp.tangent.z);

      const state = this.makeKartState({
        id: r.id,
        name: r.name,
        characterId: r.characterId,
        isPlayer: r.isPlayer,
        playerIndex: r.playerIndex,
        customization: r.customization,
        x: smp.point.x + smp.right.x * lateral,
        y: smp.point.y,
        z: smp.point.z + smp.right.z * lateral,
        heading,
        nearestT: startT,
        maxProgress: startT - 1,
        rank: idx + 1,
        aiTargetOffset: lateral * 0.7,
        infiniteTurbo: r.infiniteTurbo,
      });

      if (isMadness) {
        state.heldItem = getRandomPowerUp(state.rank, racers.length, 'madness');
      }

      this.karts.push(state);
      const rig = createKartModel(r.characterId, r.customization, this.shadowTex, this.isMobileDevice);
      if (this.graphicsMode === 'ps1') applyPs1FilterToObject(rig.root, true);
      this.kartMeshes.set(state.id, rig);
      this.scene.add(rig.root);

      if (r.isPlayer && this.cameras[r.playerIndex]) {
        const cam = this.cameras[r.playerIndex];
        cam.position.set(
          state.x - Math.sin(heading) * 9,
          state.y + 4.4,
          state.z - Math.cos(heading) * 9,
        );
        cam.lookAt(state.x, state.y + 1.4, state.z);
      }
    });

    // Spawn golden J - K - T collectible tokens on track for Modo Tokens!
    if (resolvedSettings.mode === 'tokens') {
      const tokenSpecs = this.compiledTrack.config.tokens ?? [
        { letter: 'J' as const, t: 0.24, lateralOffset: -3.5, heightOffset: 1.4 },
        { letter: 'K' as const, t: 0.56, lateralOffset: 3.5, heightOffset: 1.5 },
        { letter: 'T' as const, t: 0.84, lateralOffset: 0, heightOffset: 1.8 },
      ];
      tokenSpecs.forEach((ts) => {
        const smp = this.compiledTrack.samples[Math.floor(ts.t * n) % n];
        const tx = smp.point.x + smp.right.x * ts.lateralOffset;
        const ty = smp.point.y + (ts.heightOffset ?? 1.4);
        const tz = smp.point.z + smp.right.z * ts.lateralOffset;
        const mesh = createTokenLetterModel(ts.letter);
        mesh.position.set(tx, ty, tz);
        if (this.graphicsMode === 'ps1') applyPs1FilterToObject(mesh, true);
        this.scene.add(mesh);
        this.activeTokens.push({ letter: ts.letter, mesh, x: tx, y: ty, z: tz, collected: false });
      });
    }

    // Spawn Time-Freeze Crates (1s / 2s / 3s) for Carrera Reliquia mode!
    if (resolvedSettings.mode === 'relic') {
      const crateSpots = [
        { t: 0.09, offset: -3.2, seconds: 1 as const },
        { t: 0.17, offset: 3.4, seconds: 2 as const },
        { t: 0.25, offset: 0, seconds: 1 as const },
        { t: 0.33, offset: -4.0, seconds: 3 as const },
        { t: 0.41, offset: 2.8, seconds: 1 as const },
        { t: 0.49, offset: 0, seconds: 2 as const },
        { t: 0.57, offset: -3.5, seconds: 1 as const },
        { t: 0.65, offset: 3.8, seconds: 3 as const },
        { t: 0.73, offset: -1.5, seconds: 2 as const },
        { t: 0.81, offset: 3.2, seconds: 1 as const },
        { t: 0.88, offset: -3.0, seconds: 2 as const },
        { t: 0.94, offset: 0, seconds: 3 as const },
      ];
      crateSpots.forEach((spot) => {
        const smp = this.compiledTrack.samples[Math.floor(spot.t * n) % n];
        const cx = smp.point.x + smp.right.x * spot.offset;
        const cy = smp.point.y + 1.15;
        const cz = smp.point.z + smp.right.z * spot.offset;
        const mesh = createTimeCrateModel(spot.seconds);
        mesh.position.set(cx, cy, cz);
        this.scene.add(mesh);
        this.activeTimeCrates.push({ mesh, x: cx, y: cy, z: cz, seconds: spot.seconds, collected: false });
      });
    }

    // Spawn Ghost Kart in Time Trial mode if ghost recording exists
    if (resolvedSettings.mode === 'timetrial' && this.ghostData.length > 1) {
      const ghostSetup = setups[0];
      this.ghostMesh = createKartModel(
        ghostSetup.characterId,
        { bodyColor: '#38bdf8', rimColor: '#f8fafc', neonColor: '#06b6d4' },
        this.shadowTex,
        this.isMobileDevice,
      );
      this.ghostMesh.root.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mat = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (mat && mat.clone) {
            const ghostMat = mat.clone();
            ghostMat.transparent = true;
            ghostMat.opacity = 0.42;
            (obj as THREE.Mesh).material = ghostMat;
          }
        }
      });
      this.scene.add(this.ghostMesh.root);
    }

    // Reset item boxes & Wumpa crates
    this.sound.setAkuAkuLoopActive(false);
    const showBoxes = resolvedSettings.mode !== 'timetrial' && resolvedSettings.mode !== 'relic';
    this.builtTrack?.itemBoxes.forEach((b) => {
      b.respawnTimer = 0;
      if (b.mesh) b.mesh.visible = showBoxes;
    });
    this.builtTrack?.wumpaBoxes.forEach((b) => {
      b.respawnTimer = 0;
      if (b.mesh) b.mesh.visible = showBoxes;
    });

    this.countdownTimer = 3.1;
    this.lastCountdownInt = 4;
    this.raceTimeMs = 0;
    this.screen = 'race';
    this.applyScreenAtmosphere('race');
    this.input.clearInputs();
    this.renderCurrentView();
    this.callbacks.onHudUpdate(this.buildHudSnapshot());
  }

  public startOnlineRace(
    room: OnlineRoomState,
    localPlayerId: string,
    controlConfigs: PlayerControlConfig[],
    onlineClient: OnlineClient,
  ): void {
    this.paused = false;
    this.frontCameraView = false;
    this.snapCameraCut = true;
    this.controlConfigs = controlConfigs;
    this.matchSettings = {
      mode: 'online',
      trackId: room.trackId,
      playerCount: 1,
      useAI: room.includeAI,
      aiCount: room.aiCount,
      laps: room.laps,
      aiDifficulty: 'normal',
    };

    if (this.currentTrackId !== room.trackId) {
      this.loadTrack(room.trackId);
    }

    this.clearRaceKarts();
    this.recordedGhost = [];
    this.ghostData = [];
    this.isOnlineRace = true;
    this.isOnlineHost = room.hostId === localPlayerId;
    this.onlineClient = onlineClient;
    this.remoteHumanIds.clear();
    this.onlineTelemetryTimer = 0;
    this.localFinishSent = false;

    const racers: Array<{
      id: string;
      name: string;
      characterId: CharacterId;
      isPlayer: boolean;
      playerIndex: number;
      customization: KartCustomization;
    }> = [];

    room.players.forEach((p) => {
      const isLocal = p.id === localPlayerId;
      if (!isLocal) {
        this.remoteHumanIds.add(p.id);
      }
      racers.push({
        id: p.id,
        name: p.name,
        characterId: p.characterId,
        isPlayer: isLocal,
        playerIndex: isLocal ? 0 : -1,
        customization: { ...p.customization },
      });
    });

    if (room.includeAI && room.aiCount > 0) {
      const usedChars = new Set(racers.map((r) => r.characterId));
      const allChars: CharacterId[] = ['jarvin', 'joaquin', 'crash', 'armagedon', 'fedex', 'jason', 'lucia'];
      const aiPool = allChars.filter((c) => !usedChars.has(c));
      const count = Math.min(room.aiCount, Math.max(0, 5 - racers.length));
      for (let i = 0; i < count; i++) {
        const cid = aiPool[i] ?? allChars[(i + racers.length) % allChars.length];
        const spec = CHARACTER_MAP[cid];
        racers.push({
          id: `ai_${i}`,
          name: `${spec.name} (IA)`,
          characterId: cid,
          isPlayer: false,
          playerIndex: -1,
          customization: { ...spec.defaultCustomization },
        });
      }
    }

    const n = this.compiledTrack.samples.length;
    racers.forEach((r, idx) => {
      const row = Math.floor(idx / 2);
      const col = idx % 2 === 0 ? -1 : 1;
      const startT = wrapT(0.988 - row * 0.013);
      const smp = this.compiledTrack.samples[Math.floor(startT * n) % n];
      const lateral = col * 3.6;
      const heading = Math.atan2(smp.tangent.x, smp.tangent.z);

      const state = this.makeKartState({
        id: r.id,
        name: r.name,
        characterId: r.characterId,
        isPlayer: r.isPlayer,
        playerIndex: r.playerIndex,
        customization: r.customization,
        x: smp.point.x + smp.right.x * lateral,
        y: smp.point.y,
        z: smp.point.z + smp.right.z * lateral,
        heading,
        nearestT: startT,
        maxProgress: startT - 1,
        rank: idx + 1,
        aiTargetOffset: lateral * 0.7,
      });

      this.karts.push(state);
      const rig = createKartModel(r.characterId, r.customization, this.shadowTex, this.isMobileDevice);
      if (this.graphicsMode === 'ps1') applyPs1FilterToObject(rig.root, true);
      this.kartMeshes.set(state.id, rig);
      this.scene.add(rig.root);

      if (r.isPlayer && this.cameras[0]) {
        const cam = this.cameras[0];
        cam.position.set(
          state.x - Math.sin(heading) * 9,
          state.y + 4.4,
          state.z - Math.cos(heading) * 9,
        );
        cam.lookAt(state.x, state.y + 1.4, state.z);
      }
    });

    this.builtTrack?.itemBoxes.forEach((b) => {
      b.respawnTimer = 0;
      if (b.mesh) b.mesh.visible = true;
    });

    this.countdownTimer = 3.1;
    this.lastCountdownInt = 4;
    this.raceTimeMs = 0;
    this.screen = 'race';
    this.applyScreenAtmosphere('race');
    this.input.clearInputs();
    this.renderCurrentView();
    this.callbacks.onHudUpdate(this.buildHudSnapshot());
  }

  public applyOnlineSnapshot(remoteKarts: RemoteKartTelemetry[]): void {
    if (!this.isOnlineRace || this.screen !== 'race') return;
    for (const rk of remoteKarts) {
      const local = this.karts.find((k) => k.id === rk.id);
      if (!local) continue;
      if (local.isPlayer) continue;
      if (this.isOnlineHost && local.id.startsWith('ai_')) continue;

      local.x = THREE.MathUtils.lerp(local.x, rk.x, 0.55);
      local.y = THREE.MathUtils.lerp(local.y, rk.y, 0.55);
      local.z = THREE.MathUtils.lerp(local.z, rk.z, 0.55);
      local.vx = rk.vx;
      local.vy = rk.vy;
      local.vz = rk.vz;
      local.heading = rk.heading;
      local.speed = rk.speed;
      local.steerAngle = rk.steerAngle;
      local.nearestT = rk.nearestT;
      local.lap = rk.lap;
      local.maxProgress = rk.maxProgress;
      local.turboActiveTimer = rk.turboActiveTimer;
      local.akuAkuTimer = rk.akuAkuTimer;
      local.shieldTimer = rk.shieldTimer;
      local.burnTimer = rk.burnTimer ?? 0;
      local.slowTimer = rk.slowTimer ?? 0;
      local.slipperyTimer = rk.slipperyTimer ?? 0;
      local.tntTimer = rk.tntTimer ?? 0;
      local.heldItem = rk.heldItem;
      local.finished = rk.finished;
      local.finishTimeMs = rk.finishTimeMs;
    }
  }

  public applyOnlineAttack(ev: OnlineAttackEvent): void {
    if (!this.isOnlineRace || this.screen !== 'race') return;
    const localPlayer = this.karts.find((k) => k.isPlayer);
    if (!localPlayer) return;

    if (ev.attackType === 'homing_rocket') {
      const rocketMesh = createRocketProjectileModel();
      rocketMesh.position.set(ev.x, ev.y, ev.z);
      rocketMesh.rotation.y = ev.heading;
      this.scene.add(rocketMesh);
      this.activeRockets.push({
        ownerId: ev.senderId,
        mesh: rocketMesh,
        x: ev.x,
        y: ev.y,
        z: ev.z,
        heading: ev.heading,
        life: 3.4,
      });
      this.sound.playRocketLaunch();
    } else if (ev.attackType === 'bolt') {
      if (!ev.targetId || ev.targetId === localPlayer.id) {
        if (applyKartBurnHit(localPlayer, 0)) this.sound.playImpact();
      }
    } else if (ev.attackType === 'shockwave') {
      const d2 = (localPlayer.x - ev.x) ** 2 + (localPlayer.z - ev.z) ** 2;
      if (d2 < 22 * 22 && applyKartBurnHit(localPlayer, 0)) {
        this.sound.playImpact();
      }
    } else if (ev.attackType === 'aku_aku_ram' && ev.targetId === localPlayer.id) {
      if (applyKartBurnHit(localPlayer, 0)) {
        this.sound.playImpact();
      }
    }
  }

  public enterAdventureHub(
    setup: PlayerSetup,
    controls: PlayerControlConfig[],
    unlockedChapters: number,
    completedTracks: string[],
    bossUnlocked: boolean,
  ): void {
    this.controlConfigs = controls;
    this.paused = false;
    this.frontCameraView = false;
    this.snapCameraCut = true;
    this.clearRaceKarts();

    if (this.hubScene) {
      this.scene.remove(this.hubScene.group);
      this.hubScene.disposables.forEach((d) => d.dispose());
    }
    this.hubScene = buildAdventureHubStage(TRACKS, unlockedChapters, completedTracks, bossUnlocked);
    if (this.graphicsMode === 'ps1') applyPs1FilterToObject(this.hubScene.group, true);
    this.scene.add(this.hubScene.group);

    if (this.hubRig) {
      this.scene.remove(this.hubRig.root);
    }
    this.hubKart = this.makeKartState({
      id: 'hub_p0',
      name: CHARACTER_MAP[setup.characterId].name,
      characterId: setup.characterId,
      isPlayer: true,
      playerIndex: 0,
      customization: { ...setup.customization },
      x: 0,
      y: 0,
      z: 10,
      heading: Math.PI,
    });
    this.hubRig = createKartModel(setup.characterId, setup.customization, this.shadowTex, this.isMobileDevice);
    if (this.graphicsMode === 'ps1') applyPs1FilterToObject(this.hubRig.root, true);
    this.scene.add(this.hubRig.root);

    this.hubPortalCooldown = 1.4;
    this.hubLastHintKey = '';
    this.screen = 'adventure_hub';
    this.applyScreenAtmosphere('adventure_hub');
    this.studioCamera.position.set(0, 6.2, 22);
    this.studioCamera.lookAt(0, 1.5, 0);
    this.input.clearInputs();
    this.renderCurrentView();
  }

  public showBossCutscene(
    boss: BossSpec,
    outcome: BossCutsceneOutcome = 'intro',
    playerSetup?: PlayerSetup,
  ): void {
    this.bossCutsceneSpec = boss;
    this.bossCutsceneOutcome = outcome;
    this.screen = 'boss_cutscene';
    this.applyScreenAtmosphere('boss_cutscene');
    this.sound.stopEngine();
    if (outcome === 'victory') {
      this.sound.playVictoryFanfare();
    } else if (outcome === 'defeat') {
      this.sound.playExplosion(0);
    }

    if (this.bossCutsceneRig) {
      this.bossStageGroup.remove(this.bossCutsceneRig.root);
      this.bossCutsceneRig = null;
    }
    if (this.bossCutsceneBossKart) {
      this.bossStageGroup.remove(this.bossCutsceneBossKart.root);
      this.bossCutsceneBossKart = null;
    }
    if (this.bossCutscenePlayerKart) {
      this.bossStageGroup.remove(this.bossCutscenePlayerKart.root);
      this.bossCutscenePlayerKart = null;
    }

    const pSetup = playerSetup ?? this.playerSetups[0] ?? {
      playerIndex: 0,
      characterId: 'jarvin' as const,
      customization: { ...CHARACTER_MAP.jarvin.defaultCustomization },
    };
    const bChar = CHARACTER_MAP[boss.characterId];
    const bossKart = createKartModel(boss.characterId, bChar.defaultCustomization, this.shadowTex, this.isMobileDevice);
    const playerKart = createKartModel(pSetup.characterId, pSetup.customization, this.shadowTex, this.isMobileDevice);

    if (outcome === 'victory') {
      playerKart.root.position.set(-1.35, 0, 1.15);
      playerKart.root.rotation.y = 0.42;
      bossKart.root.position.set(1.85, 0, -0.75);
      bossKart.root.rotation.y = -0.55;
      bossKart.burnFlameGroup.visible = true;
    } else if (outcome === 'defeat') {
      bossKart.root.position.set(1.1, 0, 1.35);
      bossKart.root.rotation.y = -0.35;
      playerKart.root.position.set(-1.85, 0, -0.7);
      playerKart.root.rotation.y = 0.52;
      playerKart.burnFlameGroup.visible = true;
    } else {
      bossKart.root.position.set(1.45, 0, 1.0);
      bossKart.root.rotation.y = -0.45;
      playerKart.root.position.set(-1.75, 0, -0.45);
      playerKart.root.rotation.y = 0.48;
    }

    if (this.graphicsMode === 'ps1') {
      applyPs1FilterToObject(bossKart.root, true);
      applyPs1FilterToObject(playerKart.root, true);
    }

    this.bossStageGroup.add(bossKart.root, playerKart.root);
    this.bossCutsceneBossKart = bossKart;
    this.bossCutscenePlayerKart = playerKart;
    this.bossCutsceneRig = bossKart.driverRig;

    this.studioCamera.position.set(600, -97.4, 6.8);
    this.studioCamera.lookAt(600, -98.7, 0.2);
    this.renderCurrentView();
  }

  public showBattleWin(summary: BattleResultSummary): void {
    this.screen = 'battle_win';
    this.applyScreenAtmosphere('battle_win');
    this.sound.stopEngine();
    this.sound.playVictoryFanfare();

    if (this.battleWinWinnerKart) this.battleWinGroup.remove(this.battleWinWinnerKart.root);
    if (this.battleWinWinnerRig) this.battleWinGroup.remove(this.battleWinWinnerRig.root);
    if (this.battleWinLoserRig) this.battleWinGroup.remove(this.battleWinLoserRig.root);

    const wKart = createKartModel(summary.winner.characterId, summary.winner.customization, this.shadowTex, this.isMobileDevice);
    wKart.driverRig.root.visible = false;
    wKart.root.position.set(-2.3, 0, -0.4);
    wKart.root.rotation.y = 0.55;
    if (this.graphicsMode === 'ps1') applyPs1FilterToObject(wKart.root, true);
    this.battleWinGroup.add(wKart.root);
    this.battleWinWinnerKart = wKart;

    const wChar = createCharacterModel(summary.winner.characterId, this.isMobileDevice);
    wChar.root.position.set(0.5, 0, 0.7);
    wChar.root.scale.setScalar(1.22);
    if (this.graphicsMode === 'ps1') applyPs1FilterToObject(wChar.root, true);
    this.battleWinGroup.add(wChar.root);
    this.battleWinWinnerRig = wChar;

    const lChar = createCharacterModel(summary.loser.characterId, this.isMobileDevice);
    lChar.root.position.set(3.9, 0, 0.3);
    lChar.root.rotation.y = -0.35;
    lChar.root.scale.setScalar(1.12);
    if (this.graphicsMode === 'ps1') applyPs1FilterToObject(lChar.root, true);
    this.battleWinGroup.add(lChar.root);
    this.battleWinLoserRig = lChar;

    this.studioCamera.position.set(900.8, -97.4, 8.2);
    this.studioCamera.lookAt(900.8, -98.4, 0);
    this.renderCurrentView();
  }

  public showPodium(standings: RaceHudSnapshot['standings']): void {
    this.screen = 'podium';
    this.applyScreenAtmosphere('podium');
    this.sound.stopEngine();
    this.sound.playVictoryFanfare();

    // Clear previous podium rigs
    this.podiumRigs.forEach((entry) => this.podiumGroup.remove(entry.rig.root));
    this.podiumRigs = [];

    const spots = [
      { rank: 1, x: 0, y: 2.2 },
      { rank: 2, x: -3.4, y: 1.4 },
      { rank: 3, x: 3.4, y: 0.9 },
    ];

    spots.forEach((spot, idx) => {
      const racer = standings[idx];
      if (!racer) return;
      const rig = createCharacterModel(racer.characterId, this.isMobileDevice);
      rig.root.position.set(spot.x, spot.y, 0);
      rig.root.scale.setScalar(1.18);
      if (this.graphicsMode === 'ps1') applyPs1FilterToObject(rig.root, true);
      this.podiumGroup.add(rig.root);
      this.podiumRigs.push({ rig, rank: spot.rank });
    });

    // Spawn confetti burst
    for (let i = 0; i < 110; i++) {
      this.spawnParticle(
        300 + (Math.random() - 0.5) * 9,
        -100 + 4.5 + Math.random() * 4.5,
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 3,
        -1.5 - Math.random() * 2,
        (Math.random() - 0.5) * 3,
        2.8 + Math.random() * 2,
        0.22,
        Math.random() > 0.5 ? 0xfacc15 : Math.random() > 0.5 ? 0x22c55e : 0x38bdf8,
      );
    }
    this.stepPodium(0.016);
    this.renderCurrentView();
  }

  public getRecordedGhost(): Array<{ t: number; x: number; y: number; z: number; h: number }> {
    return this.recordedGhost;
  }

  public debugFinishRaceNow(): void {
    if (this.screen !== 'race' || this.karts.length === 0) return;
    if (this.matchSettings.mode === 'battle') {
      const killGoal = this.matchSettings.battleKillGoal ?? 5;
      const topKiller = this.karts[0];
      topKiller.battleKills = killGoal;
      updateRaceStandings(this.karts, 'battle');
      const sorted = [...this.karts].sort((a, b) => b.battleKills - a.battleKills);
      const loser = sorted[sorted.length - 1] ?? sorted[0];
      const snap = this.buildHudSnapshot();
      this.callbacks.onBattleFinish?.({
        winner: {
          id: topKiller.id,
          name: topKiller.name,
          characterId: topKiller.characterId,
          kills: topKiller.battleKills,
          customization: topKiller.customization,
        },
        loser: {
          id: loser.id,
          name: loser.name,
          characterId: loser.characterId,
          kills: loser.battleKills,
          customization: loser.customization,
        },
        arenaName: this.activeArena.name,
        standings: snap.standings,
      });
      return;
    }
    const baseMs = Math.max(61240, this.raceTimeMs);
    this.karts.forEach((k, idx) => {
      k.finished = true;
      k.lap = this.matchSettings.laps;
      k.finishTimeMs = baseMs + idx * 1840;
    });
    updateRaceStandings(this.karts);
    const snap = this.buildHudSnapshot();
    this.callbacks.onRaceFinish(snap);
  }

  private spawnParticle(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    maxLife: number,
    size: number,
    hexColor: number | string,
  ): void {
    const slot = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % this.MAX_PARTICLES;
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.vx = vx;
    slot.vy = vy;
    slot.vz = vz;
    slot.life = maxLife;
    slot.maxLife = maxLife;
    slot.size = size;
    _color.set(hexColor);
    slot.r = _color.r;
    slot.g = _color.g;
    slot.b = _color.b;
  }

  private updateParticles(dt: number): void {
    let anyChanged = false;
    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyChanged = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        _dummy.position.set(0, -999, 0);
        _dummy.scale.setScalar(0);
        _dummy.updateMatrix();
        this.particleMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const scale = p.size * (p.life / p.maxLife);
      _dummy.position.set(p.x, p.y, p.z);
      _dummy.rotation.set(p.life * 4, p.life * 3, 0);
      _dummy.scale.setScalar(scale);
      _dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, _dummy.matrix);
      _color.setRGB(p.r, p.g, p.b);
      this.particleMesh.setColorAt(i, _color);
    }

    if (anyChanged) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
      if (this.particleMesh.instanceColor) {
        this.particleMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  private animateDriverAndEngine(
    rig: KartMeshRig,
    speed: number,
    steerAngle: number,
    turboActive: boolean,
    isIdle: boolean,
    dt: number,
  ): void {
    const t = this.elapsed;

    // 1. Real Engine Vibration + Moving Chrome Pistons + GLSL Exhaust Flames
    const rpmSpeed = turboActive ? 42 : Math.abs(speed) > 2 ? 22 + Math.abs(speed) * 0.75 : 14;
    const vibAmp = turboActive ? 0.022 : Math.abs(speed) > 2 ? 0.013 : 0.008;
    rig.chassisGroup.position.y = Math.sin(t * 52) * vibAmp + Math.cos(t * 37) * (vibAmp * 0.5);
    rig.chassisGroup.position.x = Math.sin(t * 64) * (vibAmp * 0.35);
    rig.engineBlock.position.y = 0.58 + Math.sin(t * 68) * (vibAmp * 1.45);
    rig.engineBlock.rotation.z = Math.cos(t * 58) * (vibAmp * 1.6);

    rig.enginePistons.forEach((piston, pIdx) => {
      piston.position.y = 0.1 + Math.sin(t * rpmSpeed + pIdx * Math.PI) * 0.055;
    });

    const flameIntensity = turboActive ? 1.25 : Math.abs(speed) > 6 ? 0.52 : isIdle ? 0.22 : 0.12;
    rig.exhaustFlames.forEach((ef, idx) => {
      ef.material.uniforms.uTime.value = t + idx * 0.37;
      ef.material.uniforms.uIntensity.value = flameIntensity;
      const lenScale = turboActive ? 1.55 : Math.abs(speed) > 6 ? 0.75 : 0.36;
      ef.mesh.scale.set(1, 1, lenScale);
    });

    // 2. Flexible Spine, Secondary Skeletal Bone Chains, Blinking & Character Idle Animation
    const dRig = rig.driverRig;
    const swaySpeed = isIdle ? 2.6 : 4.2 + Math.abs(speed) * 0.12;

    if (dRig.spineBones.length >= 3) {
      // Lumbar & Chest breathing + cornering lean
      dRig.spineBones[1].rotation.x = Math.sin(t * swaySpeed) * (isIdle ? 0.045 : 0.025);
      dRig.spineBones[2].rotation.x = Math.cos(t * swaySpeed) * 0.03 + Math.min(0.16, Math.abs(speed) * 0.004);
      dRig.spineBones[2].rotation.z = -steerAngle * 0.18;
    }

    // Flexible skeletal appendage chains (ears, mohawk, cape, scarves, jacket tails)
    dRig.flexChains.forEach((chain, cIdx) => {
      chain.forEach((bone, bIdx) => {
        if (bIdx === 0) {
          bone.rotation.x = Math.min(0.45, Math.abs(speed) * 0.012) + Math.sin(t * 3.1 + cIdx) * 0.08;
        } else {
          bone.rotation.x = Math.sin(t * (4.5 + Math.abs(speed) * 0.2) - bIdx * 0.75 + cIdx) * 0.14;
          bone.rotation.z = -steerAngle * 0.16 + Math.cos(t * 3.4 - bIdx * 0.6 + cIdx) * 0.07;
        }
      });
    });

    // Periodic realistic double-blink every ~3.4 seconds
    const blinkPhase = (t + (rig.root.id % 5) * 0.43) % 3.4;
    const isBlinking = (blinkPhase > 3.12 && blinkPhase < 3.24) || (blinkPhase > 3.28 && blinkPhase < 3.38);
    dRig.eyelids.forEach((lid) => {
      lid.rotation.x = isBlinking ? 0.05 : -Math.PI * 0.45;
    });

    // Driver head scan (idle) or active steering wheel grip + arm kinematics!
    if (isIdle) {
      dRig.head.rotation.y = Math.sin(t * 1.45) * 0.24;
      dRig.head.rotation.z = Math.sin(t * 2.1) * 0.06;
      dRig.torso.rotation.y = Math.sin(t * 1.2) * 0.05;
      dRig.leftArm.rotation.set(-0.78 + Math.sin(t * 2.6) * 0.05, 0, 0.22);
      dRig.rightArm.rotation.set(-0.78 - Math.sin(t * 2.6) * 0.05, 0, -0.22);
      if (dRig.leftElbow) dRig.leftElbow.rotation.set(-0.42, 0.24, 0);
      if (dRig.rightElbow) dRig.rightElbow.rotation.set(-0.42, -0.24, 0);
    } else {
      dRig.head.rotation.y = steerAngle * 0.38;
      dRig.head.rotation.z = steerAngle * 0.09;
      dRig.torso.rotation.y = steerAngle * 0.14;
      dRig.leftArm.rotation.set(-0.78 - steerAngle * 0.26, -steerAngle * 0.18, 0.22);
      dRig.rightArm.rotation.set(-0.78 + steerAngle * 0.26, -steerAngle * 0.18, -0.22);
      if (dRig.leftElbow) dRig.leftElbow.rotation.set(-0.42 + steerAngle * 0.22, 0.24, 0);
      if (dRig.rightElbow) dRig.rightElbow.rotation.set(-0.42 - steerAngle * 0.22, -0.24, 0);
    }

    if (dRig.crown) {
      dRig.crown.position.y = 0.56 + Math.sin(t * 4.5) * 0.06;
      dRig.crown.rotation.y += dt * 1.4;
    }
    if (rig.catCompanion) {
      rig.catCompanion.position.y = 1.18 + Math.sin(t * 6) * 0.03;
      rig.catCompanion.rotation.z = steerAngle * 0.25;
      if (rig.catTailBones) {
        rig.catTailBones.forEach((bone, bIdx) => {
          bone.rotation.z = Math.sin(t * 6.5 - bIdx * 0.7) * 0.22;
        });
      }
    }
  }

  private syncKartMesh(kart: KartPhysicsState, dt: number, isIdle = false, focusDistSq = 0): void {
    const rig = this.kartMeshes.get(kart.id);
    if (!rig) return;

    const antigravHover = kart.inAntigravity ? 0.16 + Math.sin(this.elapsed * 9 + kart.x * 0.2) * 0.04 : 0;
    rig.root.position.set(kart.x, kart.y + antigravHover, kart.z);
    rig.root.rotation.y = kart.heading;

    rig.chassisGroup.rotation.x = kart.pitch;
    rig.chassisGroup.rotation.z = kart.roll;
    rig.chassisGroup.scale.set(
      1 + (1 - kart.jumpSquash) * 0.25,
      kart.jumpSquash,
      1 + (1 - kart.jumpSquash) * 0.15,
    );

    const wheelDelta = kart.speed * dt * 2.4;
    rig.wheels.forEach((w, idx) => {
      w.rotation.x += wheelDelta;
      const sideSign = idx % 2 === 0 ? 1 : -1;
      w.rotation.z = THREE.MathUtils.damp(w.rotation.z, kart.inAntigravity ? sideSign * 0.88 : 0, 12, dt);
    });
    rig.frontWheelPivots.forEach((p) => {
      p.rotation.y = kart.steerAngle * 0.52;
    });
    rig.steeringWheel.rotation.z = -kart.steerAngle * 1.45;
    rig.neonMat.emissiveIntensity = kart.inAntigravity ? 2.2 : 1.0;

    const isCulledOffscreen =
      !isIdle &&
      (this.screen === 'race' || this.screen === 'title') &&
      this.visibleKartSet.size > 0 &&
      !this.visibleKartSet.has(kart.id);
    const skipDistantAnim = isCulledOffscreen || (this.isMobileDevice && !kart.isPlayer && focusDistSq > 38 * 38);
    if (!skipDistantAnim) {
      this.animateDriverAndEngine(rig, kart.speed, kart.steerAngle, kart.turboActiveTimer > 0, isIdle, dt);
      applyCharacterIdleAnimation(rig.driverRig, kart.idleAnim, kart.idleAnimTimer, this.elapsed);
      applyCharacterFacialExpression(rig.driverRig, kart.expression, this.elapsed);
    }

    rig.shieldMesh.visible = kart.shieldTimer > 0;
    if (rig.shieldMesh.visible) {
      rig.shieldMesh.rotation.y += dt * 2.5;
      const sMat = rig.shieldMesh.material as THREE.MeshStandardMaterial;
      if (kart.shieldTimer > 7.2) {
        sMat.color.set('#22d3ee');
        sMat.emissive.set('#06b6d4');
      } else {
        sMat.color.set('#38bdf8');
        sMat.emissive.set('#0284c7');
      }
    }

    rig.akuAkuGroup.visible = kart.akuAkuTimer > 0;
    if (rig.akuAkuGroup.visible) {
      rig.akuAkuGroup.rotation.y += dt * 5.2;
    }

    rig.tntMountGroup.visible = kart.tntTimer > 0;
    if (rig.tntMountGroup.visible) {
      const pulseSpeed = kart.tntTimer < 1.1 ? 22 : 10;
      const pulseScale = 1 + Math.sin(this.elapsed * pulseSpeed) * 0.15;
      rig.tntMountGroup.scale.setScalar(pulseScale);
      rig.tntMountGroup.rotation.y += dt * 3.5;
    }

    rig.burnFlameGroup.visible = kart.burnTimer > 0;
    if (rig.burnFlameGroup.visible) {
      rig.burnFlameGroup.rotation.y += dt * 11;
      rig.burnFlameGroup.scale.y = 0.85 + Math.sin(this.elapsed * 28) * 0.25;
      if (!isCulledOffscreen && Math.random() < 0.8) {
        this.spawnParticle(
          kart.x + (Math.random() - 0.5) * 1.2,
          kart.y + 0.6 + Math.random() * 0.6,
          kart.z + (Math.random() - 0.5) * 1.2,
          (Math.random() - 0.5) * 2,
          2.6,
          (Math.random() - 0.5) * 2,
          0.26,
          0.42,
          Math.random() > 0.4 ? '#f97316' : '#ef4444',
        );
      }
    }

    const allowFxParticles =
      !isCulledOffscreen && !(this.isMobileDevice && !kart.isPlayer && focusDistSq > 55 * 55);

    if (allowFxParticles && kart.slipperyTimer > 0 && Math.random() < 0.65) {
      this.spawnParticle(
        kart.x + (Math.random() - 0.5) * 1.5,
        kart.y + 0.35 + Math.random() * 0.4,
        kart.z + (Math.random() - 0.5) * 1.5,
        (Math.random() - 0.5) * 3,
        1.8,
        (Math.random() - 0.5) * 3,
        0.35,
        0.36,
        Math.random() > 0.35 ? '#84cc16' : '#22c55e',
      );
    }

    if (allowFxParticles && kart.inAntigravity && Math.random() < 0.6) {
      this.spawnParticle(
        kart.x + (Math.random() - 0.5) * 2.1,
        kart.y + 0.22,
        kart.z + (Math.random() - 0.5) * 2.1,
        (Math.random() - 0.5) * 2.5,
        1.2 + Math.random() * 1.4,
        (Math.random() - 0.5) * 2.5,
        0.32,
        0.34,
        '#22d3ee',
      );
    }

    const samples = this.compiledTrack.samples;
    const sampleIdx = Math.floor(wrapT(kart.nearestT) * samples.length) % samples.length;
    const groundY =
      this.matchSettings.mode === 'battle'
        ? 0
        : (samples[sampleIdx]?.point.y ?? kart.y);
    const heightAbove = Math.max(0, kart.y - groundY);
    rig.contactShadow.position.y = -heightAbove - antigravHover + 0.04;
    rig.contactShadow.scale.setScalar(Math.max(0.5, 1 - heightAbove * 0.08));

    if (!allowFxParticles) return;

    if (kart.turboActiveTimer > 0 && Math.random() < (this.isMobileDevice ? 0.38 : 0.78)) {
      const bx = kart.x - Math.sin(kart.heading) * 1.65;
      const bz = kart.z - Math.cos(kart.heading) * 1.65;
      this.spawnParticle(
        bx + (Math.random() - 0.5) * 0.5,
        kart.y + 0.5,
        bz + (Math.random() - 0.5) * 0.5,
        -Math.sin(kart.heading) * 6,
        1.2 + Math.random(),
        -Math.cos(kart.heading) * 6,
        0.35,
        0.55,
        kart.customization.neonColor,
      );
    } else if (kart.drifting && Math.random() < (this.isMobileDevice ? 0.36 : 0.72)) {
      const bx = kart.x - Math.sin(kart.heading) * 1.1;
      const bz = kart.z - Math.cos(kart.heading) * 1.1;
      const sparkColor =
        kart.driftCharge > 1.1 ? '#ef4444' : kart.driftCharge > 0.65 ? '#facc15' : '#22c55e';
      this.spawnParticle(
        bx + (Math.random() - 0.5) * 0.9,
        kart.y + 0.25,
        bz + (Math.random() - 0.5) * 0.9,
        (Math.random() - 0.5) * 3,
        1.8,
        (Math.random() - 0.5) * 3,
        0.28,
        0.4,
        sparkColor,
      );
    } else if (!this.isMobileDevice && kart.grounded && Math.abs(kart.speed) > 19 && Math.random() < 0.3) {
      const theme = this.compiledTrack.config.theme;
      const dustColor =
        theme === 'ice'
          ? '#e0f2fe'
          : theme === 'volcano'
            ? '#fb923c'
            : theme === 'neon' || theme === 'space'
              ? '#38bdf8'
              : '#cbd5e1';
      this.spawnParticle(
        kart.x - Math.sin(kart.heading) * 1.15 + (Math.random() - 0.5) * 1.1,
        kart.y + 0.18,
        kart.z - Math.cos(kart.heading) * 1.15 + (Math.random() - 0.5) * 1.1,
        (Math.random() - 0.5) * 1.6,
        0.9 + Math.random() * 0.8,
        (Math.random() - 0.5) * 1.6,
        0.26,
        0.24,
        dustColor,
      );
    }
  }

  private buildHudSnapshot(): RaceHudSnapshot {
    const isBattle = this.matchSettings.mode === 'battle';
    const players: PlayerHudSnapshot[] = this.karts
      .filter((k) => k.isPlayer)
      .sort((a, b) => a.playerIndex - b.playerIndex)
      .map((k) => {
        let wrongWay = false;
        if (!isBattle) {
          const smp = findNearestTrackSample(this.compiledTrack, k.x, k.z, k.nearestT).sample;
          const dot = Math.sin(k.heading) * smp.tangent.x + Math.cos(k.heading) * smp.tangent.z;
          wrongWay = k.speed > 10 && dot < -0.45;
        }
        const driftStage = !k.drifting
          ? 0
          : k.driftCharge > 1.1
            ? 3
            : k.driftCharge > 0.65
              ? 2
              : 1;
        return {
          playerIndex: k.playerIndex,
          characterId: k.characterId,
          name: k.name,
          speedKmh: Math.round(Math.abs(k.speed) * 4.2),
          rank: k.rank,
          totalRacers: this.karts.length,
          lap: Math.min(k.lap, this.matchSettings.laps),
          totalLaps: this.matchSettings.laps,
          turboEnergy: Math.round(k.turboEnergy),
          turboActive: k.turboActiveTimer > 0,
          inAntigravity: Boolean(k.inAntigravity),
          driftStage,
          wumpas: k.wumpas ?? 0,
          juicedPowers: (k.wumpas ?? 0) >= 10,
          heldItem: k.heldItem,
          shieldActive: k.shieldTimer > 0,
          akuAkuActive: k.akuAkuTimer > 0,
          akuAkuTimer: Number(k.akuAkuTimer.toFixed(1)),
          stunned: k.burnTimer > 0 || k.stunTimer > 0 || Boolean(k.fallRespawnTimer && k.fallRespawnTimer > 0),
          burnActive: k.burnTimer > 0,
          slowActive: k.slowTimer > 0,
          timeSlowActive: Boolean(k.timeSlowTimer && k.timeSlowTimer > 0),
          slipperyActive: k.slipperyTimer > 0,
          tntTimer: k.tntTimer,
          tntShakeJumps: k.tntShakeJumps,
          eliminated: Boolean(k.eliminated),
          expression: k.expression,
          idleAnim: k.idleAnim,
          battleKills: k.battleKills,
          finished: k.finished,
          finishTimeMs: k.finishTimeMs,
          wrongWay,
        };
      });

    const standings = [...this.karts]
      .sort((a, b) => a.rank - b.rank)
      .map((k) => ({
        id: k.id,
        name: k.name,
        characterId: k.characterId,
        isPlayer: k.isPlayer,
        playerIndex: k.playerIndex,
        rank: k.rank,
        lap: Math.min(k.lap, this.matchSettings.laps),
        progress: (k.lap - 1) + k.nearestT,
        battleKills: k.battleKills,
        eliminated: Boolean(k.eliminated),
        finished: k.finished,
        finishTimeMs: k.finishTimeMs,
        customization: k.customization,
      }));

    let minimap: MinimapSnapshot;
    if (isBattle) {
      const r = this.activeArena.radius;
      const ringPath = Array.from({ length: 24 }, (_, idx) => {
        const a = (idx / 24) * Math.PI * 2;
        return { x: Number((50 + Math.cos(a) * 42).toFixed(1)), y: Number((50 + Math.sin(a) * 42).toFixed(1)) };
      });
      minimap = {
        path: ringPath,
        markers: this.karts.map((k) => ({
          id: k.id,
          characterId: k.characterId,
          x: Number((50 + (k.x / r) * 42).toFixed(1)),
          y: Number((50 + (k.z / r) * 42).toFixed(1)),
          color: k.customization.bodyColor,
          isPlayer: k.isPlayer,
          playerIndex: k.playerIndex,
        })),
      };
    } else {
      minimap = {
        path: this.minimapPath,
        markers: this.karts.map((k) => {
          const pos = this.worldToMinimap(k.x, k.z);
          return {
            id: k.id,
            characterId: k.characterId,
            x: pos.x,
            y: pos.y,
            color: k.customization.bodyColor,
            isPlayer: k.isPlayer,
            playerIndex: k.playerIndex,
          };
        }),
      };
    }

    const aliveRacers = this.karts.filter((k) => !k.eliminated).length;

    return {
      mode: this.matchSettings.mode,
      countdown: Math.ceil(this.countdownTimer),
      raceTimeMs: Math.round(this.raceTimeMs),
      timeFreezeTimer: this.timeFreezeTimer,
      timeBonusSavedSec: this.timeBonusSavedSec,
      eliminationTimer: this.matchSettings.mode === 'elimination' ? Math.max(0, this.eliminationTimer) : undefined,
      eliminationRound: this.matchSettings.mode === 'elimination' ? this.eliminationRound : undefined,
      aliveRacers: this.matchSettings.mode === 'elimination' ? aliveRacers : undefined,
      tokensCollected: this.matchSettings.mode === 'tokens' ? [...this.collectedTokens] : undefined,
      tokensCompleted: this.matchSettings.mode === 'tokens' ? this.tokensCompletedNotified : undefined,
      battleKillGoal: this.matchSettings.battleKillGoal ?? 5,
      bossId: this.matchSettings.bossId,
      frontCamera: this.frontCameraView,
      players,
      standings,
      minimap,
    };
  }

  private renderCurrentView(): void {
    if (this.screen === 'race') {
      this.renderSplitScreenRace();
    } else {
      this.renderSingleCamera(this.studioCamera);
    }
  }

  private handleResize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.studioCamera.aspect = w / h;
    this.studioCamera.updateProjectionMatrix();
    this.renderCurrentView();
  };

  private startLoop(): void {
    const tick = () => {
      if (this.disposed) return;

      const rawDt = this.clock.getDelta();
      const clampedTotal = Math.min(rawDt, 0.25);
      this.elapsed += clampedTotal;

      // Update GLSL Shaders time uniforms (sky clouds/stars + animated ocean/lava/waterfalls)
      this.skyMat.uniforms.uTime.value = this.elapsed;
      if (this.builtTrack) {
        for (const mat of this.builtTrack.animatedShaderMaterials) {
          mat.uniforms.uTime.value = this.elapsed;
        }
      }

      // Poll live inputs only when Settings Controls Tester is open (avoids 16Hz React re-renders during races)
      this.inputSampleTimer += clampedTotal;
      if (
        this.liveInputPollingEnabled &&
        this.callbacks.onLiveInputSample &&
        this.inputSampleTimer >= 0.06 &&
        this.controlConfigs.length >= 4
      ) {
        this.inputSampleTimer = 0;
        const samples = this.controlConfigs.map((cfg) => this.input.samplePlayerInput(cfg));
        this.callbacks.onLiveInputSample(samples);
      }

      // Spin visible item boxes, Wumpa crates, patrolling minecarts, battle boxes, time crates, tokens and hub portal rings
      if (this.builtTrack && this.builtTrack.group.visible) {
        const showBoxes = this.matchSettings.mode !== 'timetrial' && this.matchSettings.mode !== 'relic';
        for (const box of this.builtTrack.itemBoxes) {
          if (box.respawnTimer > 0) {
            box.respawnTimer -= clampedTotal;
            if (box.respawnTimer <= 0 && box.mesh) {
              box.mesh.visible = showBoxes;
            }
          } else if (box.mesh && this.visibleChunkSet.has(box.chunkIndex)) {
            box.mesh.rotation.y += clampedTotal * 2.2;
            box.mesh.rotation.x += clampedTotal * 1.1;
          }
        }
        for (const wb of this.builtTrack.wumpaBoxes) {
          if (wb.respawnTimer > 0) {
            wb.respawnTimer -= clampedTotal;
            if (wb.respawnTimer <= 0 && wb.mesh) {
              wb.mesh.visible = showBoxes;
            }
          } else if (wb.mesh && this.visibleChunkSet.has(wb.chunkIndex)) {
            wb.mesh.rotation.y += clampedTotal * 2.0;
          }
        }
        const nSamples = this.compiledTrack.samples.length;
        for (const mc of this.builtTrack.minecarts) {
          const pingPong = 0.5 + 0.5 * Math.sin(this.elapsed * mc.speed + mc.phase);
          const span = mc.tEnd >= mc.tStart ? mc.tEnd - mc.tStart : 1 - mc.tStart + mc.tEnd;
          const tPos = wrapT(mc.tStart + span * pingPong);
          const smp = this.compiledTrack.samples[Math.floor(tPos * nSamples) % nSamples];
          mc.x = smp.point.x + smp.right.x * mc.lateral;
          mc.y = smp.point.y + 0.06;
          mc.z = smp.point.z + smp.right.z * mc.lateral;
          if (mc.mesh && this.visibleChunkSet.has(mc.chunkIndex)) {
            mc.mesh.position.set(mc.x, mc.y, mc.z);
            mc.mesh.rotation.y = Math.atan2(smp.tangent.x, smp.tangent.z);
          }
        }
      }
      if (this.battleScene && this.battleScene.group.visible) {
        for (const box of this.battleScene.itemBoxes) {
          if (box.respawnTimer > 0) {
            box.respawnTimer -= clampedTotal;
            if (box.respawnTimer <= 0) box.mesh.visible = true;
          } else {
            box.mesh.rotation.y += clampedTotal * 2.6;
            box.mesh.rotation.x += clampedTotal * 1.4;
          }
        }
      }
      for (const tc of this.activeTimeCrates) {
        if (!tc.collected) {
          tc.mesh.rotation.y += clampedTotal * 1.8;
          tc.mesh.position.y = tc.y + Math.sin(this.elapsed * 3 + tc.x) * 0.2;
        }
      }
      for (const tk of this.activeTokens) {
        if (!tk.collected) {
          tk.mesh.rotation.y += clampedTotal * 2.4;
          tk.mesh.position.y = tk.y + Math.sin(this.elapsed * 3.4 + tk.x) * 0.24;
        }
      }
      if (this.hubScene && this.hubScene.group.visible) {
        for (const p of this.hubScene.portals) {
          p.ringMesh.rotation.z += clampedTotal * (p.unlocked ? 1.4 : 0.25);
        }
      }

      this.updateParticles(clampedTotal);

      if (
        (this.screen === 'race' || this.screen === 'title' || this.screen === 'adventure_hub') &&
        this.input.isShiftPressed() &&
        this.input.wasKeyJustPressed('KeyP')
      ) {
        this.toggleFreeCamera();
      }

      if (
        (this.screen === 'race' || this.screen === 'adventure_hub') &&
        !this.paused &&
        !this.freeCamActive &&
        this.input.wasKeyJustPressed('KeyV')
      ) {
        this.toggleFrontCamera();
      }

      const subSteps = Math.max(1, Math.ceil(clampedTotal / 0.04));
      const subDt = clampedTotal / subSteps;

      if (this.screen === 'intro' || this.screen === 'title') {
        for (let s = 0; s < subSteps; s++) this.stepIntroOrTitle(subDt);
        this.stepFreeCamera(clampedTotal);
        this.updateShadowLightAnchor();
        this.renderSingleCamera(this.studioCamera);
      } else if (this.screen === 'garage') {
        this.stepGarage(clampedTotal);
        this.updateShadowLightAnchor();
        this.renderSingleCamera(this.studioCamera);
      } else if (this.screen === 'adventure_hub') {
        for (let s = 0; s < subSteps; s++) this.stepAdventureHub(subDt);
        this.stepFreeCamera(clampedTotal);
        this.updateShadowLightAnchor();
        this.renderSingleCamera(this.studioCamera);
      } else if (this.screen === 'boss_cutscene') {
        this.stepBossCutscene(clampedTotal);
        this.updateShadowLightAnchor();
        this.renderSingleCamera(this.studioCamera);
      } else if (this.screen === 'battle_win') {
        this.stepBattleWin(clampedTotal);
        this.updateShadowLightAnchor();
        this.renderSingleCamera(this.studioCamera);
      } else if (this.screen === 'podium') {
        this.stepPodium(clampedTotal);
        this.updateShadowLightAnchor();
        this.renderSingleCamera(this.studioCamera);
      } else if (this.screen === 'race') {
        for (let s = 0; s < subSteps; s++) this.stepRace(subDt);
        this.stepFreeCamera(clampedTotal);
        this.updateShadowLightAnchor();
        this.renderSplitScreenRace();
      }

      this.input.endFrame();

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    tick();
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private stepIntroOrTitle(dt: number): void {
    if (this.screen === 'intro') {
      this.introTimer += dt;
      const t = this.introTimer;

      // Check Gamepad X / Start / Enter / Space to enter menu (never auto-skips on its own!)
      if (
        this.input.wasIntroGamepadPressed() ||
        this.input.wasKeyJustPressed('Space') ||
        this.input.wasKeyJustPressed('Enter')
      ) {
        this.callbacks.onIntroFinished();
        return;
      }

      if (this.ctrIntroRig) {
        const { jarvinRig, trophyGroup, titleGroup } = this.ctrIntroRig;

        // 1. Slamming "JARVIN KART TURBO 3D" title plaque from the sky!
        if (t < 0.55) {
          titleGroup.position.set(0, 6.8, -1.2);
          titleGroup.rotation.z = 0;
        } else if (t < 0.9) {
          const u = (t - 0.55) / 0.35;
          titleGroup.position.set(0, 6.8 - (6.8 - 3.65) * (u * u), -1.2);
          titleGroup.rotation.z = Math.sin(u * Math.PI) * 0.05;
        } else if (t < 1.25) {
          if (!this.introSlamPlayed) {
            this.introSlamPlayed = true;
            this.sound.playImpact();
          }
          const u = (t - 0.9) / 0.35;
          titleGroup.position.set(0, 3.65 + Math.sin(u * Math.PI) * 0.36, -1.2);
          titleGroup.rotation.z = Math.sin(t * 24) * 0.04 * (1 - u);
        } else {
          titleGroup.position.set(0, 3.65 + Math.sin(t * 2.2) * 0.06, -1.2);
          titleGroup.rotation.z = Math.sin(t * 1.4) * 0.015;
        }

        // 2. Jarvin & Trophy Choreography (holds trophy -> startled & drops it -> picks it up again!)
        if (t < 0.72) {
          applyCharacterFacialExpression(jarvinRig, 'win', t);
          jarvinRig.bodyPivot.position.set(0, Math.abs(Math.sin(t * 3.5)) * 0.06, 0);
          jarvinRig.torso.rotation.set(0, 0, 0);
          jarvinRig.leftArm.rotation.set(-0.4, 0, -0.25);
          jarvinRig.rightArm.rotation.set(-1.55, 0, 0.35);
          trophyGroup.position.set(0.75, 1.38 + Math.abs(Math.sin(t * 3.5)) * 0.06, 0.78);
          trophyGroup.rotation.set(0, t * 0.8, 0);
        } else if (t < 1.55) {
          // Title slam startles Jarvin -> he leaps & drops trophy onto floor!
          const u = Math.min(1, (t - 0.72) / 0.55);
          applyCharacterFacialExpression(jarvinRig, 'scared', t);
          jarvinRig.bodyPivot.position.set(0, Math.sin(u * Math.PI) * 0.6, -u * 0.3);
          jarvinRig.torso.rotation.x = -0.18 * (1 - u);
          jarvinRig.leftArm.rotation.set(-2.2, 0, 0.45);
          jarvinRig.rightArm.rotation.set(-2.2, 0, -0.45);
          const bounceY = Math.abs(Math.sin(u * Math.PI * 2)) * (1 - u) * 0.75;
          trophyGroup.position.set(0.75 + 0.15 * u, 1.38 * (1 - u) + 0.26 * u + bounceY, 0.78 + u * 1.15);
          trophyGroup.rotation.set(0.65 * u, t * 2.5, 0.72 * u);
        } else if (t < 2.45) {
          // Jarvin hurries forward and picks his trophy back up!
          const u = (t - 1.55) / 0.9;
          applyCharacterFacialExpression(jarvinRig, u < 0.7 ? 'serious' : 'win', t);
          const bend = Math.sin(u * Math.PI);
          jarvinRig.bodyPivot.position.set(0.2 * bend, 0, -0.3 + u * 0.8 - Math.max(0, u - 0.6) * 0.5);
          jarvinRig.torso.rotation.x = bend * 0.48;
          jarvinRig.leftArm.rotation.set(-0.6, 0, -0.2);
          jarvinRig.rightArm.rotation.set(-1.1 - u * 0.5, 0, 0.3);
          if (u > 0.58 && !this.introPickupPlayed) {
            this.introPickupPlayed = true;
            this.sound.playItemPickup();
          }
          const lift = Math.max(0, (u - 0.38) / 0.62);
          trophyGroup.position.set(0.9 - lift * 0.15, 0.26 + lift * 1.15, 1.93 - lift * 1.15);
          trophyGroup.rotation.set(0.65 * (1 - lift), t * 1.2, 0.72 * (1 - lift));
        } else {
          // Proud CTR loop holding golden trophy cleanly at his side while waiting for Left Click / Touch / X!
          applyCharacterFacialExpression(jarvinRig, 'win', t);
          const hop = Math.abs(Math.sin((t - 2.45) * 4.2)) * 0.12;
          jarvinRig.bodyPivot.position.set(0, hop, 0);
          jarvinRig.torso.rotation.set(0, 0, 0);
          jarvinRig.leftArm.rotation.set(-0.35, 0, -0.22);
          jarvinRig.rightArm.rotation.set(-1.62, 0, 0.36);
          trophyGroup.position.set(0.76, 1.42 + hop, 0.76);
          trophyGroup.rotation.set(0, t * 1.1, 0);
          if (Math.random() < (this.isMobileDevice ? 0.12 : 0.28)) {
            this.spawnParticle(
              1200 + (Math.random() - 0.5) * 1.8,
              -98.2 + Math.random() * 1.4,
              0.7 + (Math.random() - 0.5) * 1.0,
              (Math.random() - 0.5) * 2.0,
              1.6 + Math.random() * 1.4,
              (Math.random() - 0.5) * 2.0,
              0.65,
              0.2,
              '#facc15',
            );
          }
        }
      }

      const camSway = Math.sin(t * 0.6) * 0.45;
      this.studioCamera.position.set(1200 + camSway, -97.1, 9.6);
      this.studioCamera.lookAt(1200, -98.1, 0);
      return;
    }

    // AI demo karts racing around the track on Title Screen!
    for (const k of this.karts) {
      const aiInput = computeAiControlInput(k, this.compiledTrack, 'normal', dt, this.karts);
      stepKartPhysics(k, aiInput, this.compiledTrack, 99, 0, dt, 'normal', 1.0);
      this.syncKartMesh(k, dt);
    }

    const lead = this.karts[0];
    if (lead && !this.freeCamActive) {
      // Title screen: Dynamic hero chase camera focusing on a moving kart!
      const orbitAngle = Math.sin(this.elapsed * 0.45) * 0.65;
      const dist = 8.8;
      _v1.set(
        lead.x - Math.sin(lead.heading + orbitAngle) * dist,
        lead.y + 3.6,
        lead.z - Math.cos(lead.heading + orbitAngle) * dist,
      );
      this.studioCamera.position.lerp(_v1, 1 - Math.exp(-6 * dt));
      this.studioCamera.lookAt(
        lead.x + Math.sin(lead.heading) * 2.5,
        lead.y + 1.1,
        lead.z + Math.cos(lead.heading) * 2.5,
      );
    }
  }

  private updateShadowLightAnchor(): void {
    if (this.screen === 'intro') {
      this.keyLight.position.set(1216, -72, 18);
      this.keyLight.target.position.set(1200, -100, 0);
      this.keyLight.target.updateMatrixWorld();
      return;
    }
    if (this.screen === 'garage') {
      this.keyLight.position.set(16, -72, 18);
      this.keyLight.target.position.set(0, -100, 0);
      this.keyLight.target.updateMatrixWorld();
      return;
    }
    if (this.screen === 'podium') {
      this.keyLight.position.set(316, -72, 18);
      this.keyLight.target.position.set(300, -100, 0);
      this.keyLight.target.updateMatrixWorld();
      return;
    }
    if (this.screen === 'boss_cutscene') {
      this.keyLight.position.set(616, -72, 18);
      this.keyLight.target.position.set(600, -100, 0);
      this.keyLight.target.updateMatrixWorld();
      return;
    }
    if (this.screen === 'battle_win') {
      this.keyLight.position.set(916, -72, 18);
      this.keyLight.target.position.set(900, -100, 0);
      this.keyLight.target.updateMatrixWorld();
      return;
    }
    if (this.screen === 'adventure_hub' && this.hubKart) {
      this.keyLight.position.set(this.hubKart.x + 30, 58, this.hubKart.z + 25);
      this.keyLight.target.position.set(this.hubKart.x, 0, this.hubKart.z);
      this.keyLight.target.updateMatrixWorld();
      return;
    }
    const anchor = this.karts.find((k) => k.isPlayer) ?? this.karts[0];
    if (anchor) {
      this.keyLight.position.set(anchor.x + 38, anchor.y + 68, anchor.z + 32);
      this.keyLight.target.position.set(anchor.x, anchor.y, anchor.z);
      this.keyLight.target.updateMatrixWorld();
    }
  }

  private stepAdventureHub(dt: number): void {
    if (!this.hubKart || !this.hubRig || !this.hubScene) return;
    const cfg = this.controlConfigs[0];
    const inp = cfg ? this.input.samplePlayerInput(cfg) : {
      accelerate: false,
      brake: false,
      steer: 0,
      turbo: false,
      jumpJustPressed: false,
      itemJustPressed: false,
      pauseJustPressed: false,
      rawPressedKeys: [],
      rawGamepadButtons: [],
      rawGamepadAxes: [],
      activeDeviceLabel: 'Teclado',
    };

    const hubArena: BattleArenaConfig = {
      id: 'hub',
      name: 'Plaza Aventura',
      subtitle: 'Hub',
      radius: 80,
      floorColor: '#1e293b',
      wallColor: '#334155',
      accentColor: '#facc15',
      skyTop: '#0284c7',
      skyBottom: '#bae6fd',
      pillars: [],
      itemSpots: [],
      boostSpots: [],
    };
    stepBattleKartPhysics(this.hubKart, inp, hubArena, dt, false);

    // Sync hub kart visual
    this.hubRig.root.position.set(this.hubKart.x, this.hubKart.y, this.hubKart.z);
    this.hubRig.root.rotation.y = this.hubKart.heading;
    this.hubRig.chassisGroup.rotation.z = this.hubKart.roll;
    this.hubRig.wheels.forEach((w) => {
      w.rotation.x += this.hubKart!.speed * dt * 2.4;
    });
    this.hubRig.frontWheelPivots.forEach((p) => {
      p.rotation.y = this.hubKart!.steerAngle * 0.52;
    });
    this.hubRig.steeringWheel.rotation.z = -this.hubKart.steerAngle * 1.45;
    this.animateDriverAndEngine(this.hubRig, this.hubKart.speed, this.hubKart.steerAngle, this.hubKart.turboActiveTimer > 0, false, dt);
    applyCharacterIdleAnimation(this.hubRig.driverRig, this.hubKart.idleAnim, this.hubKart.idleAnimTimer, this.elapsed);
    applyCharacterFacialExpression(this.hubRig.driverRig, this.hubKart.expression, this.elapsed);

    // Camera follow (V toggles front portrait vs default rear chase camera)
    if (this.freeCamActive) return;
    const snapHub = this.snapCameraCut;
    this.snapCameraCut = false;
    if (this.frontCameraView) {
      _v1.set(
        this.hubKart.x + Math.sin(this.hubKart.heading) * 4.2,
        this.hubKart.y + 2.15,
        this.hubKart.z + Math.cos(this.hubKart.heading) * 4.2,
      );
      if (snapHub) {
        this.studioCamera.position.copy(_v1);
      } else {
        this.studioCamera.position.lerp(_v1, 1 - Math.exp(-14 * dt));
      }
      this.studioCamera.lookAt(
        this.hubKart.x - Math.sin(this.hubKart.heading) * 0.25,
        this.hubKart.y + 1.52,
        this.hubKart.z - Math.cos(this.hubKart.heading) * 0.25,
      );
    } else {
      _v1.set(
        this.hubKart.x - Math.sin(this.hubKart.heading) * 8.2,
        this.hubKart.y + 4.1,
        this.hubKart.z - Math.cos(this.hubKart.heading) * 8.2,
      );
      if (snapHub) {
        this.studioCamera.position.copy(_v1);
      } else {
        this.studioCamera.position.lerp(_v1, 1 - Math.exp(-8 * dt));
      }
      this.studioCamera.lookAt(
        this.hubKart.x + Math.sin(this.hubKart.heading) * 3.5,
        this.hubKart.y + 1.4,
        this.hubKart.z + Math.cos(this.hubKart.heading) * 3.5,
      );
    }

    // Check portal proximity & entry
    this.hubPortalCooldown = Math.max(0, this.hubPortalCooldown - dt);
    let nearestPortal: (typeof this.hubScene.portals)[number] | null = null;
    let nearestDistSq = 8.5 * 8.5;
    for (const p of this.hubScene.portals) {
      const d2 = (this.hubKart.x - p.x) ** 2 + (this.hubKart.z - p.z) ** 2;
      if (d2 < nearestDistSq) {
        nearestDistSq = d2;
        nearestPortal = p;
      }
    }

    const hintKey = nearestPortal ? `${nearestPortal.trackId}:${nearestPortal.unlocked}:${nearestPortal.isBossPortal}` : 'none';
    if (hintKey !== this.hubLastHintKey) {
      this.hubLastHintKey = hintKey;
      this.callbacks.onHubPortalProximity?.(
        nearestPortal
          ? {
              trackId: nearestPortal.trackId,
              trackName: nearestPortal.trackName,
              chapter: nearestPortal.chapter,
              unlocked: nearestPortal.unlocked,
              completed: nearestPortal.completed,
              isBossPortal: nearestPortal.isBossPortal,
            }
          : null,
      );
    }

    if (nearestPortal && nearestPortal.unlocked && this.hubPortalCooldown <= 0) {
      if (nearestDistSq < nearestPortal.radius * nearestPortal.radius) {
        this.hubPortalCooldown = 2.0;
        this.callbacks.onHubPortalEnter?.(nearestPortal.trackId, nearestPortal.isBossPortal);
      }
    }
  }

  private stepBossCutscene(dt: number): void {
    const t = this.elapsed;
    const bKart = this.bossCutsceneBossKart;
    const pKart = this.bossCutscenePlayerKart;
    const out = this.bossCutsceneOutcome;

    if (bKart) {
      const bossTurbo = out !== 'victory';
      this.animateDriverAndEngine(bKart, out === 'victory' ? 0 : 12, Math.sin(t * 2) * 0.25, bossTurbo, true, dt);
      const bRig = bKart.driverRig;
      if (out === 'victory') {
        applyCharacterFacialExpression(bRig, 'dizzy', t);
        bKart.chassisGroup.rotation.z = Math.sin(t * 9) * 0.08;
        bRig.head.rotation.y = Math.sin(t * 6) * 0.4;
        bRig.leftArm.rotation.x = -0.45;
        bRig.rightArm.rotation.x = -0.45;
        if (Math.random() < 0.45) {
          this.spawnParticle(
            600 + 1.85 + (Math.random() - 0.5) * 1.4,
            -99.1 + Math.random() * 1.1,
            -0.75 + (Math.random() - 0.5) * 1.4,
            (Math.random() - 0.5) * 2.5,
            2.4,
            (Math.random() - 0.5) * 2.5,
            0.4,
            0.34,
            Math.random() > 0.5 ? '#ef4444' : '#f97316',
          );
        }
      } else if (out === 'defeat') {
        applyCharacterFacialExpression(bRig, 'laughing', t);
        bRig.bodyPivot.position.y = Math.abs(Math.sin(t * 7)) * 0.18;
        bRig.leftArm.rotation.x = -Math.PI * 0.72 + Math.sin(t * 9) * 0.32;
        bRig.rightArm.rotation.x = -Math.PI * 0.72 - Math.sin(t * 9) * 0.32;
      } else {
        applyCharacterFacialExpression(bRig, 'angry', t);
        bRig.bodyPivot.position.y = Math.abs(Math.sin(t * 4)) * 0.11;
        bRig.leftArm.rotation.x = -1.1 + Math.sin(t * 7) * 0.3;
        bRig.rightArm.rotation.x = -1.1 - Math.sin(t * 7) * 0.3;
      }
    }

    if (pKart) {
      const playerTurbo = out === 'victory';
      this.animateDriverAndEngine(pKart, out === 'defeat' ? 0 : 10, Math.cos(t * 1.6) * 0.2, playerTurbo, true, dt);
      const pRig = pKart.driverRig;
      if (out === 'victory') {
        applyCharacterFacialExpression(pRig, 'win', t);
        pRig.bodyPivot.position.y = Math.abs(Math.sin(t * 7.5)) * 0.22;
        pRig.leftArm.rotation.x = -Math.PI * 0.78 + Math.sin(t * 9) * 0.32;
        pRig.rightArm.rotation.x = -Math.PI * 0.78 - Math.sin(t * 9) * 0.32;
        if (Math.random() < 0.35) {
          this.spawnParticle(
            600 - 1.35 + (Math.random() - 0.5) * 2.2,
            -97.2,
            1.15 + (Math.random() - 0.5) * 1.5,
            (Math.random() - 0.5) * 1.4,
            -1.2,
            (Math.random() - 0.5) * 1.4,
            1.1,
            0.18,
            Math.random() > 0.5 ? '#facc15' : '#22c55e',
          );
        }
      } else if (out === 'defeat') {
        applyCharacterFacialExpression(pRig, 'hurt', t);
        pKart.chassisGroup.rotation.z = Math.sin(t * 8) * 0.08;
        pRig.head.rotation.y = Math.sin(t * 4.5) * 0.35;
        pRig.leftArm.rotation.x = -0.35;
        pRig.rightArm.rotation.x = -0.35;
        if (Math.random() < 0.45) {
          this.spawnParticle(
            600 - 1.85 + (Math.random() - 0.5) * 1.4,
            -99.1 + Math.random() * 1.1,
            -0.7 + (Math.random() - 0.5) * 1.4,
            (Math.random() - 0.5) * 2.2,
            2.2,
            (Math.random() - 0.5) * 2.2,
            0.4,
            0.34,
            Math.random() > 0.5 ? '#64748b' : '#f97316',
          );
        }
      } else {
        applyCharacterFacialExpression(pRig, 'serious', t);
      }
    }

    this.studioCamera.position.set(600 + Math.sin(t * 0.55) * 1.25, -97.35, 6.7);
    this.studioCamera.lookAt(600, -98.7, 0.25);
  }

  private stepBattleWin(dt: number): void {
    const t = this.elapsed;
    if (this.battleWinWinnerKart) {
      this.animateDriverAndEngine(this.battleWinWinnerKart, 0, 0.15, true, true, dt);
    }
    if (this.battleWinWinnerRig) {
      const rig = this.battleWinWinnerRig;
      applyCharacterFacialExpression(rig, 'win', t);
      rig.bodyPivot.position.y = Math.abs(Math.sin(t * 6.5)) * 0.24;
      rig.leftArm.rotation.x = -Math.PI * 0.75 + Math.sin(t * 8) * 0.3;
      rig.rightArm.rotation.x = -Math.PI * 0.75 - Math.sin(t * 8) * 0.3;
    }
    if (this.battleWinLoserRig) {
      const rig = this.battleWinLoserRig;
      applyCharacterFacialExpression(rig, 'dizzy', t);
      rig.bodyPivot.rotation.z = Math.sin(t * 3.8) * 0.16;
      rig.head.rotation.y = Math.sin(t * 5.2) * 0.38;
      rig.leftArm.rotation.x = -0.35;
      rig.rightArm.rotation.x = -0.35;
    }
    this.studioCamera.position.set(900.8 + Math.sin(t * 0.4) * 0.8, -97.3, 8.2);
    this.studioCamera.lookAt(900.8, -98.4, 0);
  }

  private stepGarage(dt: number): void {
    if (this.garageKart) {
      this.garageKart.root.rotation.y += dt * 0.65;
      this.animateDriverAndEngine(this.garageKart, 0, Math.sin(this.elapsed * 1.4) * 0.25, false, true, dt);

      if (this.garageIdleAnim === 'none') {
        this.garageIdleWaitTimer += dt;
        if (this.garageIdleWaitTimer >= 10.0) {
          const choices: KartIdleAnimation[] = ['sleep', 'butterfly', 'bored', 'angry', 'phone'];
          this.garageIdleAnim = choices[Math.floor(Math.random() * choices.length)];
          this.garageIdleAnimTimer = 0;
          this.garageIdleWaitTimer = 0;
        }
      } else {
        this.garageIdleAnimTimer += dt;
        const maxDuration = this.garageIdleAnim === 'sleep' ? 6.4 : 8.5;
        if (this.garageIdleAnimTimer >= maxDuration) {
          this.garageIdleAnim = 'none';
          this.garageIdleAnimTimer = 0;
          this.garageIdleWaitTimer = 0;
        }
      }

      applyCharacterIdleAnimation(
        this.garageKart.driverRig,
        this.garageIdleAnim,
        this.garageIdleAnimTimer,
        this.elapsed,
      );
      const garageExpr =
        this.garageIdleAnim === 'none'
          ? 'normal'
          : resolveIdleExpression(this.garageIdleAnim, this.garageIdleAnimTimer);
      applyCharacterFacialExpression(this.garageKart.driverRig, garageExpr, this.elapsed);
    }
    this.studioCamera.position.set(3.2, -98.0, 4.1);
    this.studioCamera.lookAt(0, -99.1, 0);
  }

  private stepPodium(dt: number): void {
    const t = this.elapsed;
    for (const entry of this.podiumRigs) {
      const { rig, rank } = entry;
      const blinkPhase = (t + rank * 0.7) % 3.4;
      const isBlinking = blinkPhase > 3.16 && blinkPhase < 3.34;
      rig.eyelids.forEach((lid) => {
        lid.rotation.x = isBlinking ? 0.05 : -Math.PI * 0.45;
      });
      rig.flexChains.forEach((chain, cIdx) => {
        chain.forEach((bone, bIdx) => {
          bone.rotation.x = Math.sin(t * 5.2 - bIdx * 0.7 + cIdx) * 0.16;
        });
      });
      if (rank === 1) {
        applyCharacterFacialExpression(rig, 'win', t);
        rig.bodyPivot.position.y = Math.abs(Math.sin(t * 7.5)) * 0.34;
        rig.bodyPivot.rotation.y = Math.sin(t * 3.8) * 0.45;
        rig.leftArm.rotation.x = -Math.PI * 0.75 + Math.sin(t * 10) * 0.4;
        rig.rightArm.rotation.x = -Math.PI * 0.75 - Math.sin(t * 10) * 0.4;
        rig.leftArm.rotation.z = -0.35;
        rig.rightArm.rotation.z = 0.35;
        rig.leftLeg.rotation.x = Math.sin(t * 7.5) * 0.35;
        rig.rightLeg.rotation.x = -Math.sin(t * 7.5) * 0.35;
        if (rig.crown) {
          rig.crown.position.y = 0.58 + Math.sin(t * 6) * 0.08;
          rig.crown.rotation.y += dt * 3;
        }
        if (Math.random() < 0.3) {
          this.spawnParticle(
            300 + (Math.random() - 0.5) * 2.2,
            -100 + 3 + Math.random() * 1.6,
            (Math.random() - 0.5) * 1.5,
            (Math.random() - 0.5) * 1.2,
            1.4,
            (Math.random() - 0.5) * 1.2,
            0.8,
            0.16,
            '#facc15',
          );
        }
      } else if (rank === 2) {
        applyCharacterFacialExpression(rig, 'bored', t);
        rig.bodyPivot.position.y = -0.05 + Math.sin(t * 1.5) * 0.02;
        rig.torso.rotation.x = 0.08;
        rig.head.rotation.y = Math.sin(t * 0.9) * 0.4;
        rig.head.rotation.x = 0.14;
        rig.leftArm.rotation.x = -0.45;
        rig.leftArm.rotation.z = 0.55;
        rig.rightArm.rotation.x = -0.45;
        rig.rightArm.rotation.z = -0.55;
      } else if (rank === 3) {
        applyCharacterFacialExpression(rig, 'angry', t);
        rig.bodyPivot.position.y = Math.abs(Math.sin(t * 12)) * 0.08;
        rig.torso.rotation.x = 0.15;
        rig.head.rotation.z = Math.sin(t * 18) * 0.12;
        rig.leftArm.rotation.x = -1.6 + Math.sin(t * 16) * 0.5;
        rig.rightArm.rotation.x = -1.6 - Math.sin(t * 16) * 0.5;
        rig.leftLeg.rotation.x = Math.sin(t * 12) * 0.45;
        rig.rightLeg.rotation.x = -Math.sin(t * 12) * 0.45;
        if (Math.random() < 0.2) {
          this.spawnParticle(
            303.4 + (Math.random() - 0.5) * 0.8,
            -100 + 2.8,
            0,
            (Math.random() - 0.5) * 0.8,
            1.8,
            0,
            0.5,
            0.16,
            '#ef4444',
          );
        }
      }
    }

    if (Math.random() < 0.45) {
      this.spawnParticle(
        300 + (Math.random() - 0.5) * 10,
        -100 + 8.5,
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 1.5,
        -2.2 - Math.random(),
        (Math.random() - 0.5) * 1.5,
        3.2,
        0.18,
        Math.random() > 0.5 ? '#facc15' : Math.random() > 0.5 ? '#22c55e' : '#ec4899',
      );
    }

    const camAngle = Math.sin(t * 0.35) * 0.28;
    this.studioCamera.position.set(300 + Math.sin(camAngle) * 10.5, -96.2, Math.cos(camAngle) * 10.5);
    this.studioCamera.lookAt(300, -97.6, 0);
  }

  private stepRace(dt: number): void {
    if (this.paused) return;

    // Check pause button for all human players
    for (let i = 0; i < this.matchSettings.playerCount; i++) {
      const cfg = this.controlConfigs[i];
      if (!cfg) continue;
      const inp = this.input.samplePlayerInput(cfg);
      if (inp.pauseJustPressed) {
        this.callbacks.onPauseRequested();
        return;
      }
    }

    // Countdown
    if (this.countdownTimer > 0) {
      this.countdownTimer -= dt;
      const currentInt = Math.ceil(this.countdownTimer);
      if (currentInt < this.lastCountdownInt && currentInt >= 0) {
        this.lastCountdownInt = currentInt;
        this.sound.playCountdownBeep(currentInt === 0);
      }
      this.updateRaceCameras(dt);
      this.karts.forEach((k) => this.syncKartMesh(k, dt, true));
      this.hudThrottleTimer += dt;
      if (this.hudThrottleTimer >= 0.1) {
        this.hudThrottleTimer = 0;
        this.callbacks.onHudUpdate(this.buildHudSnapshot());
      }
      return;
    }

    // Relic Time-Freeze Clock logic!
    if (this.timeFreezeTimer > 0) {
      this.timeFreezeTimer = Math.max(0, this.timeFreezeTimer - dt);
    } else {
      this.raceTimeMs += dt * 1000;
    }

    const isBattleMode = this.matchSettings.mode === 'battle';
    const bossSpec =
      this.matchSettings.mode === 'boss' && this.matchSettings.bossId
        ? BOSS_MAP[this.matchSettings.bossId] ?? null
        : null;

    // Record ghost in Time Trial
    if (this.matchSettings.mode === 'timetrial' && this.karts[0]) {
      const p1 = this.karts[0];
      if (this.raceTimeMs - this.lastGhostRecordTime >= 100) {
        this.lastGhostRecordTime = this.raceTimeMs;
        this.recordedGhost.push({
          t: Math.round(this.raceTimeMs),
          x: Number(p1.x.toFixed(2)),
          y: Number(p1.y.toFixed(2)),
          z: Number(p1.z.toFixed(2)),
          h: Number(p1.heading.toFixed(3)),
        });
      }
    }

    if (this.ghostMesh && this.ghostData.length > 1) {
      let idx = 0;
      while (idx < this.ghostData.length - 2 && this.ghostData[idx + 1].t < this.raceTimeMs) {
        idx++;
      }
      const a = this.ghostData[idx];
      const b = this.ghostData[idx + 1] ?? a;
      const span = Math.max(1, b.t - a.t);
      const alpha = THREE.MathUtils.clamp((this.raceTimeMs - a.t) / span, 0, 1);
      this.ghostMesh.root.position.set(
        THREE.MathUtils.lerp(a.x, b.x, alpha),
        THREE.MathUtils.lerp(a.y, b.y, alpha),
        THREE.MathUtils.lerp(a.z, b.z, alpha),
      );
      this.ghostMesh.root.rotation.y = a.h;
    }

    let leadHumanProgress = -1;
    let focusHumanKart: KartPhysicsState | undefined;
    for (const k of this.karts) {
      if (k.isPlayer) {
        leadHumanProgress = Math.max(leadHumanProgress, getKartRaceProgress(k));
        if (!focusHumanKart || k.playerIndex === 0) focusHumanKart = k;
      }
    }

    // Step Physics for every Kart
    for (const k of this.karts) {
      const focusDistSq =
        focusHumanKart && !k.isPlayer
          ? (k.x - focusHumanKart.x) ** 2 + (k.z - focusHumanKart.z) ** 2
          : 0;
      const isRemoteControlled =
        this.isOnlineRace &&
        (this.remoteHumanIds.has(k.id) || (!this.isOnlineHost && k.id.startsWith('ai_')));

      if (isRemoteControlled) {
        this.syncKartMesh(k, dt, false, focusDistSq);
        continue;
      }

      let inputSnap: LiveInputSnapshot;
      let paceMultiplier = 1;

      if (isBattleMode) {
        if (k.isPlayer) {
          if (this.freeCamActive) {
            inputSnap = { accelerate: false, brake: false, steer: 0, turbo: false, jumpJustPressed: false, itemJustPressed: false, pauseJustPressed: false, rawPressedKeys: [], rawGamepadButtons: [], rawGamepadAxes: [], activeDeviceLabel: 'Cámara Libre' };
          } else {
            const cfg = this.controlConfigs[k.playerIndex] ?? this.controlConfigs[0];
            inputSnap = this.input.samplePlayerInput(cfg);
          }
        } else {
          inputSnap = computeBattleAiControlInput(k, this.activeArena, this.karts, dt);
        }
        const ev = stepBattleKartPhysics(k, inputSnap, this.activeArena, dt, true);

        if (k.isPlayer && k.playerIndex === 0) {
          this.sound.updateEngineHum(k.speed / 40, k.turboActiveTimer > 0, true);
          if (ev.jumped) this.sound.playJump();
          if (ev.turboStarted) this.sound.playTurbo();
          if (ev.wallHit) this.sound.playImpact();
        }
        if (ev.itemUsed === 'homing_rocket') {
          this.spawnRocketFromKart(k, ev.itemJuiced);
        }

        // Rocket-only battle boxes
        if (this.battleScene && !k.heldItem) {
          for (const box of this.battleScene.itemBoxes) {
            if (box.respawnTimer > 0) continue;
            const dx = k.x - box.x;
            const dz = k.z - box.z;
            if (dx * dx + dz * dz < 8.5) {
              box.respawnTimer = 2.6;
              box.mesh.visible = false;
              k.heldItem = 'homing_rocket';
              if (k.isPlayer) this.sound.playItemPickup();
              break;
            }
          }
        }
        this.syncKartMesh(k, dt, false, focusDistSq);
        continue;
      }

      // Standard / Relic / Boss / Madness / Elimination / Tokens Track Mode
      if (k.isPlayer && !k.finished && !k.eliminated) {
        if (this.freeCamActive) {
          inputSnap = { accelerate: false, brake: false, steer: 0, turbo: false, jumpJustPressed: false, itemJustPressed: false, pauseJustPressed: false, rawPressedKeys: [], rawGamepadButtons: [], rawGamepadAxes: [], activeDeviceLabel: 'Cámara Libre' };
        } else {
          const cfg = this.controlConfigs[k.playerIndex] ?? this.controlConfigs[0];
          inputSnap = this.input.samplePlayerInput(cfg);
        }
      } else {
        const heavySpam = Boolean(bossSpec && k.id.startsWith('boss_') && bossSpec.heavyPowerSpam);
        inputSnap = computeAiControlInput(
          k,
          this.compiledTrack,
          this.matchSettings.aiDifficulty,
          dt,
          this.karts,
          heavySpam,
        );
        if (bossSpec && k.id.startsWith('boss_')) {
          paceMultiplier = bossSpec.paceMultiplier;
          if (heavySpam && !k.heldItem && !k.finished && Math.random() < 0.48 * dt) {
            k.heldItem = getRandomPowerUp(k.rank, this.karts.length, 'boss');
          }
        } else if (this.matchSettings.mode === 'madness') {
          paceMultiplier = 1.05;
          if (!k.heldItem && !k.finished) {
            k.heldItem = getRandomPowerUp(k.rank, this.karts.length, 'madness');
          }
        } else {
          const aiProg = getKartRaceProgress(k);
          const gap = leadHumanProgress - aiProg;
          paceMultiplier = THREE.MathUtils.clamp(0.88 + gap * 0.24, 0.8, 0.96);
          if (!k.heldItem && !k.finished && Math.random() < 0.08 * dt) {
            k.heldItem = getRandomPowerUp(k.rank, this.karts.length, this.matchSettings.mode);
          }
        }
      }

      const ev = stepKartPhysics(
        k,
        inputSnap,
        this.compiledTrack,
        this.matchSettings.laps,
        this.raceTimeMs,
        dt,
        this.matchSettings.aiDifficulty,
        paceMultiplier,
        this.matchSettings.mode,
      );

      if (k.isPlayer && k.playerIndex === 0) {
        this.sound.updateEngineHum(k.speed / 40, k.turboActiveTimer > 0, true);
        if (k.inAntigravity && !this.wasPlayerAntigravity) {
          this.sound.playAntigravZap();
        }
        this.wasPlayerAntigravity = Boolean(k.inAntigravity);
        if (ev.jumped) this.sound.playJump();
        if (ev.turboStarted) this.sound.playTurbo();
        if (ev.wallHit || ev.fallRespawn) this.sound.playImpact();
        if (ev.itemUsed === 'aku_aku') this.sound.playAkuAku();
        if (ev.itemUsed === 'homing_rocket') this.sound.playRocketLaunch();
        if (ev.itemUsed === 'bowling_bomb' || ev.itemUsed === 'warp_orb') this.sound.playRocketLaunch();
        if (ev.itemUsed === 'time_clock') this.sound.playTimeClock();
        if (ev.tntExploded) this.sound.playExplosion(0);
        if (ev.tntShakenOff) this.sound.playJump();
      }

      // Patrolling minecart cave hazards collision
      if (this.builtTrack && this.builtTrack.minecarts.length > 0 && !k.finished && !k.eliminated) {
        for (const mc of this.builtTrack.minecarts) {
          const dx = k.x - mc.x;
          const dz = k.z - mc.z;
          const dy = Math.abs(k.y - mc.y);
          if (dx * dx + dz * dz < 2.25 * 2.25 && dy < 2.4) {
            if (applyKartBurnHit(k, 0)) {
              this.sound.playExplosion(0);
              for (let s = 0; s < 10; s++) {
                this.spawnParticle(
                  k.x,
                  k.y + 0.8,
                  k.z,
                  (Math.random() - 0.5) * 10,
                  3 + Math.random() * 4,
                  (Math.random() - 0.5) * 10,
                  0.45,
                  0.4,
                  s % 2 === 0 ? '#f97316' : '#facc15',
                );
              }
            }
          }
        }
      }

      if (ev.itemUsed === 'homing_rocket') {
        this.spawnRocketFromKart(k, ev.itemJuiced);
      } else if (ev.itemUsed === 'bowling_bomb') {
        const juiced = Boolean(ev.itemJuiced);
        const bMesh = createBowlingBombModel();
        if (juiced) bMesh.scale.setScalar(1.3);
        if (this.graphicsMode === 'ps1') applyPs1FilterToObject(bMesh, true);
        const bx = k.x + Math.sin(k.heading) * 2.4;
        const by = k.y + 0.78;
        const bz = k.z + Math.cos(k.heading) * 2.4;
        bMesh.position.set(bx, by, bz);
        this.scene.add(bMesh);
        this.activeBombs.push({ ownerId: k.id, mesh: bMesh, x: bx, y: by, z: bz, heading: k.heading, life: juiced ? 4.4 : 3.5, juiced });
      } else if (ev.itemUsed === 'warp_orb') {
        const juiced = Boolean(ev.itemJuiced);
        const orbMesh = createWarpOrbModel();
        if (juiced) orbMesh.scale.setScalar(1.3);
        if (this.graphicsMode === 'ps1') applyPs1FilterToObject(orbMesh, true);
        orbMesh.position.set(k.x, k.y + 1.2, k.z);
        this.scene.add(orbMesh);
        this.activeWarpOrbs.push({ ownerId: k.id, mesh: orbMesh, t: k.nearestT, lateral: 0, life: 7.5, juiced });
      } else if (ev.itemUsed === 'time_clock') {
        const juiced = Boolean(ev.itemJuiced);
        const clockMesh = createTimeClockModel();
        clockMesh.position.set(k.x, k.y + 2.4, k.z);
        this.scene.add(clockMesh);
        setTimeout(() => this.scene.remove(clockMesh), 650);
        for (const other of this.karts) {
          if (other.id === k.id || other.finished || other.eliminated) continue;
          if (other.akuAkuTimer > 0 || other.shieldTimer > 0) continue;
          other.timeSlowTimer = juiced ? 6.5 : 4.2;
          for (let b = 0; b < 6; b++) {
            this.spawnParticle(other.x, other.y + 1.2, other.z, (Math.random() - 0.5) * 4, 2.2, (Math.random() - 0.5) * 4, 0.45, 0.35, juiced ? '#22d3ee' : '#facc15');
          }
        }
      } else if (ev.itemUsed === 'tnt') {
        const juiced = Boolean(ev.itemJuiced);
        const tx = k.x - Math.sin(k.heading) * 2.4;
        const tz = k.z - Math.cos(k.heading) * 2.4;
        const ty = findNearestTrackSample(this.compiledTrack, tx, tz, k.nearestT).sample.point.y;
        const mesh = createTntCrateModel();
        if (juiced) mesh.scale.setScalar(1.25);
        mesh.position.set(tx, ty + 0.55, tz);
        this.scene.add(mesh);
        this.activeTntCrates.push({ ownerId: k.id, mesh, x: tx, y: ty + 0.55, z: tz, grace: 0.55, juiced });
      } else if (ev.itemUsed === 'potion') {
        const juiced = Boolean(ev.itemJuiced);
        const px = k.x - Math.sin(k.heading) * 2.4;
        const pz = k.z - Math.cos(k.heading) * 2.4;
        const py = findNearestTrackSample(this.compiledTrack, px, pz, k.nearestT).sample.point.y;
        const mesh = createPotionModel(juiced);
        mesh.position.set(px, py + 0.5, pz);
        this.scene.add(mesh);
        this.activePotions.push({ ownerId: k.id, mesh, x: px, y: py + 0.5, z: pz, grace: 0.55, juiced });
      } else if (ev.itemUsed === 'bolt') {
        const juiced = Boolean(ev.itemJuiced);
        // Order all active opponents 1x1 greedily by proximity so the lightning chases and downs every rival!
        const remaining = this.karts.filter((other) => other.id !== k.id && !other.finished && !other.eliminated);
        const orderedTargets: string[] = [];
        let curX = k.x;
        let curZ = k.z;
        while (remaining.length > 0) {
          let bestIdx = 0;
          let bestD2 = Infinity;
          for (let idx = 0; idx < remaining.length; idx++) {
            const o = remaining[idx];
            const d2 = (o.x - curX) ** 2 + (o.z - curZ) ** 2;
            if (d2 < bestD2) {
              bestD2 = d2;
              bestIdx = idx;
            }
          }
          const picked = remaining.splice(bestIdx, 1)[0];
          orderedTargets.push(picked.id);
          curX = picked.x;
          curZ = picked.z;
        }
        if (orderedTargets.length > 0) {
          const boltMesh = createLightningBoltModel();
          if (juiced) boltMesh.scale.setScalar(1.3);
          boltMesh.position.set(k.x, k.y + 1.8, k.z);
          this.scene.add(boltMesh);
          this.activeLightnings.push({
            ownerId: k.id,
            mesh: boltMesh,
            x: k.x,
            y: k.y + 1.8,
            z: k.z,
            targets: orderedTargets,
            life: 7.0,
            juiced,
          });
          if (k.isPlayer) this.sound.playImpact();
        }
      } else if (ev.itemUsed === 'shockwave') {
        const juiced = Boolean(ev.itemJuiced);
        const radiusSq = (juiced ? 30 : 20) ** 2;
        let hitAny = false;
        for (const other of this.karts) {
          if (other.id === k.id) continue;
          const distSq = (other.x - k.x) ** 2 + (other.z - k.z) ** 2;
          if (distSq < radiusSq && applyKartBurnHit(other, juiced ? 2.5 : 0)) {
            hitAny = true;
          }
        }
        if (this.isOnlineRace && (k.isPlayer || this.isOnlineHost)) {
          this.onlineClient?.sendAttack({
            attackType: 'shockwave',
            x: k.x,
            y: k.y,
            z: k.z,
            heading: k.heading,
          });
        }
        if (hitAny) this.sound.playImpact();
      }

      // Modo Tokens: Collect hidden J - K - T letters across track!
      if (this.matchSettings.mode === 'tokens' && k.isPlayer) {
        for (const tk of this.activeTokens) {
          if (tk.collected) continue;
          const d2 = (k.x - tk.x) ** 2 + (k.z - tk.z) ** 2;
          if (d2 < 3.4 * 3.4 && Math.abs(k.y - tk.y) < 3.6) {
            tk.collected = true;
            tk.mesh.visible = false;
            if (!this.collectedTokens.includes(tk.letter)) {
              this.collectedTokens.push(tk.letter);
            }
            this.sound.playTokenCollect();
            for (let b = 0; b < 14; b++) {
              this.spawnParticle(tk.x, tk.y + 0.3, tk.z, (Math.random() - 0.5) * 7, 3 + Math.random() * 4, (Math.random() - 0.5) * 7, 0.55, 0.42, b % 2 === 0 ? '#facc15' : '#38bdf8');
            }
            if (this.collectedTokens.length >= 3 && !this.tokensCompletedNotified) {
              this.tokensCompletedNotified = true;
              this.callbacks.onTokensCompleted?.(this.currentTrackId);
            }
          }
        }
      }

      // Relic Time-Freeze Crate Pickup
      if (this.matchSettings.mode === 'relic' && k.isPlayer) {
        for (const tc of this.activeTimeCrates) {
          if (tc.collected) continue;
          const d2 = (k.x - tc.x) ** 2 + (k.z - tc.z) ** 2;
          if (d2 < 8.5) {
            tc.collected = true;
            tc.mesh.visible = false;
            this.timeFreezeTimer += tc.seconds;
            this.timeBonusSavedSec += tc.seconds;
            this.sound.playItemPickup();
            for (let b = 0; b < 10; b++) {
              this.spawnParticle(tc.x, tc.y + 0.5, tc.z, (Math.random() - 0.5) * 6, 3 + Math.random() * 3, (Math.random() - 0.5) * 6, 0.45, 0.4, '#facc15');
            }
          }
        }
      }

      // Wumpa Fruit Crate Pickup Collision (+5 Wumpas per crate, 2 crates = 10 Max -> 20s Aku Aku + Juiced Powers!)
      if (
        this.builtTrack &&
        this.matchSettings.mode !== 'timetrial' &&
        this.matchSettings.mode !== 'relic'
      ) {
        for (const wb of this.builtTrack.wumpaBoxes) {
          if (wb.respawnTimer > 0) continue;
          const dx = k.x - wb.x;
          const dy = k.y + 0.6 - wb.y;
          const dz = k.z - wb.z;
          if (dx * dx + dy * dy + dz * dz < 8.5) {
            wb.respawnTimer = 4.5;
            if (wb.mesh) wb.mesh.visible = false;
            collectWumpaBox(k);
            if (k.isPlayer) {
              this.sound.playWumpaPickup((k.wumpas ?? 0) >= 10);
            }
            for (let p = 0; p < 8; p++) {
              this.spawnParticle(
                wb.x,
                wb.y + 0.4,
                wb.z,
                (Math.random() - 0.5) * 7,
                2.5 + Math.random() * 3,
                (Math.random() - 0.5) * 7,
                0.45,
                0.38,
                p % 2 === 0 ? '#f97316' : '#facc15',
              );
            }
            break;
          }
        }
      }

      // Track Item box pickup collision
      if (
        this.builtTrack &&
        !k.heldItem &&
        this.matchSettings.mode !== 'timetrial' &&
        this.matchSettings.mode !== 'relic'
      ) {
        for (const box of this.builtTrack.itemBoxes) {
          if (box.respawnTimer > 0) continue;
          const dx = k.x - box.x;
          const dy = k.y + 0.6 - box.y;
          const dz = k.z - box.z;
          if (dx * dx + dy * dy + dz * dz < 8.5) {
            box.respawnTimer = 2.4;
            if (box.mesh) box.mesh.visible = false;
            k.heldItem = getRandomPowerUp(k.rank, this.karts.length, this.matchSettings.mode);
            if (k.isPlayer) this.sound.playItemPickup();
            break;
          }
        }
      }

      this.syncKartMesh(k, dt, false, focusDistSq);
    }

    // Sync Aku Aku invincibility loop override for local human players
    const anyHumanAku = this.karts.some(
      (kt) => kt.isPlayer && kt.akuAkuTimer > 0 && !kt.finished && !kt.eliminated,
    );
    this.sound.setAkuAkuLoopActive(anyHumanAku);

    // Active Dropped TNT Crates -> mount on touching kart's roof with 3s countdown!
    for (let i = this.activeTntCrates.length - 1; i >= 0; i--) {
      const crate = this.activeTntCrates[i];
      crate.grace = Math.max(0, crate.grace - dt);
      crate.mesh.rotation.y += dt * 1.5;
      let consumed = false;
      for (const k of this.karts) {
        if (k.finished) continue;
        if (k.id === crate.ownerId && crate.grace > 0) continue;
        const hitRadius = crate.juiced ? 3.2 : 2.6;
        const d2 = (k.x - crate.x) ** 2 + (k.z - crate.z) ** 2;
        if (d2 < hitRadius * hitRadius) {
          if (k.shieldTimer <= 0 && k.akuAkuTimer <= 0 && k.tntTimer <= 0) {
            k.tntTimer = crate.juiced ? 2.1 : 3.0;
            k.tntShakeJumps = 0;
          }
          if (k.isPlayer) this.sound.playImpact();
          consumed = true;
          break;
        }
      }
      if (consumed) {
        this.scene.remove(crate.mesh);
        this.activeTntCrates.splice(i, 1);
      }
    }

    // Active Chained Rayos -> chases & strikes all opponents 1x1!
    for (let i = this.activeLightnings.length - 1; i >= 0; i--) {
      const bolt = this.activeLightnings[i];
      bolt.life -= dt;
      const targetId = bolt.targets[0];
      const victim = targetId ? this.karts.find((k) => k.id === targetId && !k.finished) : undefined;
      if (!victim || bolt.life <= 0) {
        if (targetId && !victim) {
          bolt.targets.shift();
        }
        if (bolt.targets.length === 0 || bolt.life <= 0) {
          this.scene.remove(bolt.mesh);
          this.activeLightnings.splice(i, 1);
          continue;
        }
      } else {
        const tx = victim.x;
        const ty = victim.y + 1.35;
        const tz = victim.z;
        const dx = tx - bolt.x;
        const dy = ty - bolt.y;
        const dz = tz - bolt.z;
        const dist = Math.hypot(dx, dy, dz);
        const speed = bolt.juiced ? 150 : 115;
        const step = speed * dt;
        if (dist <= Math.max(3.2, step)) {
          bolt.x = tx;
          bolt.y = ty;
          bolt.z = tz;
          if (applyKartBurnHit(victim, bolt.juiced ? 2.5 : 0)) {
            this.sound.playImpact();
            if (isBattleMode) {
              const owner = this.karts.find((k) => k.id === bolt.ownerId);
              if (owner) owner.battleKills += 1;
            }
            if (this.isOnlineRace && (bolt.ownerId.startsWith('p_') || this.isOnlineHost)) {
              this.onlineClient?.sendAttack({
                attackType: 'bolt',
                targetId: victim.id,
                x: victim.x,
                y: victim.y,
                z: victim.z,
                heading: 0,
              });
            }
          }
          for (let s = 0; s < 14; s++) {
            this.spawnParticle(
              victim.x,
              victim.y + 1.3,
              victim.z,
              (Math.random() - 0.5) * 10,
              2 + Math.random() * 5,
              (Math.random() - 0.5) * 10,
              0.5,
              0.48,
              s % 2 === 0 ? '#38bdf8' : '#facc15',
            );
          }
          bolt.targets.shift();
          if (bolt.targets.length === 0) {
            this.scene.remove(bolt.mesh);
            this.activeLightnings.splice(i, 1);
            continue;
          }
        } else {
          bolt.x += (dx / dist) * step;
          bolt.y += (dy / dist) * step;
          bolt.z += (dz / dist) * step;
        }
        bolt.mesh.position.set(bolt.x, bolt.y, bolt.z);
        bolt.mesh.rotation.y = Math.atan2(dx, dz);
        bolt.mesh.rotation.z += dt * 16;
        if (Math.random() < 0.85) {
          this.spawnParticle(
            bolt.x,
            bolt.y,
            bolt.z,
            (Math.random() - 0.5) * 3,
            (Math.random() - 0.5) * 3,
            (Math.random() - 0.5) * 3,
            0.25,
            0.38,
            Math.random() > 0.4 ? '#38bdf8' : '#facc15',
          );
        }
      }
    }

    // Active Dropped Potions -> 5s (or 7.5s + slow when Juiced!) slippery effect!
    for (let i = this.activePotions.length - 1; i >= 0; i--) {
      const pot = this.activePotions[i];
      pot.grace = Math.max(0, pot.grace - dt);
      let consumed = false;
      for (const k of this.karts) {
        if (k.finished) continue;
        if (k.id === pot.ownerId && pot.grace > 0) continue;
        const pRad = pot.juiced ? 2.9 : 2.5;
        const d2 = (k.x - pot.x) ** 2 + (k.z - pot.z) ** 2;
        if (d2 < pRad * pRad) {
          if (applyKartSlipperyHit(k, pot.juiced ? 7.5 : 5.0)) {
            if (pot.juiced) k.slowTimer = Math.max(k.slowTimer, 2.5);
            if (k.isPlayer) this.sound.playImpact();
            for (let b = 0; b < 12; b++) {
              this.spawnParticle(
                k.x,
                k.y + 0.7,
                k.z,
                (Math.random() - 0.5) * 8,
                2 + Math.random() * 4,
                (Math.random() - 0.5) * 8,
                0.55,
                0.42,
                pot.juiced ? (b % 2 === 0 ? '#e879f9' : '#ef4444') : (b % 2 === 0 ? '#84cc16' : '#22c55e'),
              );
            }
          }
          consumed = true;
          break;
        }
      }
      if (consumed) {
        this.scene.remove(pot.mesh);
        this.activePotions.splice(i, 1);
      }
    }

    // Step Close-Range Homing Rockets (max lock 38m, or 55m + 68m/s when Juiced!)
    const p1Kart = this.karts.find((k) => k.isPlayer && k.playerIndex === 0);
    for (let rIdx = this.activeRockets.length - 1; rIdx >= 0; rIdx--) {
      const r = this.activeRockets[rIdx];
      r.life -= dt;

      let nearestTarget: KartPhysicsState | null = null;
      let nearestDistSq = (r.juiced ? 55 : 38) ** 2;
      for (const candidate of this.karts) {
        if (candidate.id === r.ownerId || candidate.finished) continue;
        const dx = candidate.x - r.x;
        const dz = candidate.z - r.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < nearestDistSq) {
          if (!isBattleMode && d2 > 4) {
            const dist = Math.sqrt(d2);
            const dot = (dx / dist) * Math.sin(r.heading) + (dz / dist) * Math.cos(r.heading);
            if (dot < -0.15) continue;
          }
          nearestDistSq = d2;
          nearestTarget = candidate;
        }
      }

      if (nearestTarget) {
        const desiredHeading = Math.atan2(nearestTarget.x - r.x, nearestTarget.z - r.z);
        let diff = (desiredHeading - r.heading + Math.PI) % (Math.PI * 2);
        if (diff < 0) diff += Math.PI * 2;
        diff -= Math.PI;
        const maxTurn = (r.juiced ? 3.8 : 2.8) * dt;
        r.heading += THREE.MathUtils.clamp(diff, -maxTurn, maxTurn);
      }

      const rocketSpeed = r.juiced ? 68 : 54;
      const subSteps = 3;
      const subStepDist = (rocketSpeed * dt) / subSteps;
      let hit = false;

      for (let st = 0; st < subSteps; st++) {
        r.x += Math.sin(r.heading) * subStepDist;
        r.z += Math.cos(r.heading) * subStepDist;

        if (isBattleMode) {
          r.y = 0.95;
          if (Math.hypot(r.x, r.z) > this.activeArena.radius - 1.2) {
            hit = true;
          } else {
            for (const pil of this.activeArena.pillars) {
              if ((r.x - pil.x) ** 2 + (r.z - pil.z) ** 2 < (pil.radius + 0.7) ** 2) {
                hit = true;
                break;
              }
            }
          }
        } else {
          const surf = findNearestTrackSample(this.compiledTrack, r.x, r.z);
          r.y = surf.sample.point.y + 0.95;
          const sc = getShortcutSpan(this.compiledTrack, surf.t);
          const halfRoad = this.compiledTrack.config.roadWidth * 0.5 + 1.05;
          const inShortcut =
            sc !== null && Math.abs(surf.lateralOffset - sc.lateralCenter) <= sc.halfWidth + 0.9;
          if (!inShortcut && Math.abs(surf.lateralOffset) > halfRoad) {
            hit = true;
          }
        }

        if (!hit && nearestTarget) {
          const hitRad = r.juiced ? 4.5 : 2.9;
          const postD2 = (nearestTarget.x - r.x) ** 2 + (nearestTarget.z - r.z) ** 2;
          if (postD2 < hitRad * hitRad) {
            hit = true;
            applyKartBurnHit(nearestTarget, r.juiced ? 2.5 : 0);
            if (isBattleMode) {
              const ownerKart = this.karts.find((k) => k.id === r.ownerId);
              if (ownerKart) ownerKart.battleKills += 1;
            }
          }
        }

        if (hit) break;
      }

      r.mesh.position.set(r.x, r.y, r.z);
      r.mesh.rotation.y = r.heading;

      if (!hit && Math.random() < 0.7) {
        this.spawnParticle(
          r.x - Math.sin(r.heading) * 1.1,
          r.y,
          r.z - Math.cos(r.heading) * 1.1,
          (Math.random() - 0.5) * 2,
          1.2,
          (Math.random() - 0.5) * 2,
          0.32,
          0.42,
          r.juiced ? '#facc15' : '#f97316',
        );
      }

      if (hit) {
        let pan = 0;
        if (p1Kart) {
          const rx = r.x - p1Kart.x;
          const rz = r.z - p1Kart.z;
          const rightX = Math.cos(p1Kart.heading);
          const rightZ = -Math.sin(p1Kart.heading);
          pan = THREE.MathUtils.clamp((rx * rightX + rz * rightZ) / 22, -1, 1);
        }
        this.sound.playExplosion(pan);
        for (let b = 0; b < 14; b++) {
          this.spawnParticle(
            r.x,
            r.y + 0.4,
            r.z,
            (Math.random() - 0.5) * 12,
            3 + Math.random() * 6,
            (Math.random() - 0.5) * 12,
            0.55,
            0.5,
            b % 2 === 0 ? '#facc15' : '#ef4444',
          );
        }
      }

      if (hit || r.life <= 0) {
        this.scene.remove(r.mesh);
        this.activeRockets.splice(rIdx, 1);
      }
    }

    // Step Bouncing Bowling Bombs!
    for (let bIdx = this.activeBombs.length - 1; bIdx >= 0; bIdx--) {
      const b = this.activeBombs[bIdx];
      b.life -= dt;
      const bSpeed = b.juiced ? 78 : 62;
      b.x += Math.sin(b.heading) * bSpeed * dt;
      b.z += Math.cos(b.heading) * bSpeed * dt;
      const surf = findNearestTrackSample(this.compiledTrack, b.x, b.z);
      b.y = surf.sample.point.y + 0.78;
      const halfRoad = this.compiledTrack.config.roadWidth * 0.5;
      if (Math.abs(surf.lateralOffset) > halfRoad) {
        const trackYaw = Math.atan2(surf.sample.tangent.x, surf.sample.tangent.z);
        b.heading = trackYaw * 2 - b.heading;
        b.x = surf.sample.point.x + surf.sample.right.x * Math.sign(surf.lateralOffset) * (halfRoad - 0.5);
        b.z = surf.sample.point.z + surf.sample.right.z * Math.sign(surf.lateralOffset) * (halfRoad - 0.5);
      }
      b.mesh.position.set(b.x, b.y, b.z);
      b.mesh.rotation.x += dt * 14;
      let exploded = false;
      const bRadSq = (b.juiced ? 4.6 : 3.0) ** 2;
      for (const candidate of this.karts) {
        if (candidate.id === b.ownerId || candidate.finished || candidate.eliminated) continue;
        if ((candidate.x - b.x) ** 2 + (candidate.z - b.z) ** 2 < bRadSq) {
          applyKartBurnHit(candidate, b.juiced ? 2.5 : 0);
          exploded = true;
          break;
        }
      }
      if (exploded || b.life <= 0) {
        if (exploded) this.sound.playExplosion(0);
        this.scene.remove(b.mesh);
        this.activeBombs.splice(bIdx, 1);
      }
    }

    // Step Track-Following Plasma Warp Orbs!
    for (let wIdx = this.activeWarpOrbs.length - 1; wIdx >= 0; wIdx--) {
      const orb = this.activeWarpOrbs[wIdx];
      orb.life -= dt;
      const leader =
        this.karts
          .filter((c) => c.id !== orb.ownerId && !c.finished && !c.eliminated)
          .sort((a, b) => a.rank - b.rank)[0] ?? null;

      orb.t = wrapT(orb.t + ((orb.juiced ? 98 : 78) * dt) / this.compiledTrack.totalLength);
      const smp = this.compiledTrack.samples[Math.floor(orb.t * this.compiledTrack.samples.length) % this.compiledTrack.samples.length];
      if (leader) {
        const lSurf = findNearestTrackSample(this.compiledTrack, leader.x, leader.z, leader.nearestT);
        orb.lateral = THREE.MathUtils.lerp(orb.lateral, lSurf.lateralOffset, Math.min(1, dt * 6));
      }
      const ox = smp.point.x + smp.right.x * orb.lateral;
      const oy = smp.point.y + 1.25;
      const oz = smp.point.z + smp.right.z * orb.lateral;
      orb.mesh.position.set(ox, oy, oz);
      orb.mesh.rotation.y += dt * 10;
      orb.mesh.rotation.z += dt * 8;
      if (Math.random() < 0.6) {
        this.spawnParticle(ox, oy, oz, (Math.random() - 0.5) * 2, 1.0, (Math.random() - 0.5) * 2, 0.25, 0.35, '#38bdf8');
      }
      let hitLeader = false;
      if (leader && (leader.x - ox) ** 2 + (leader.z - oz) ** 2 < 3.4 * 3.4) {
        applyKartBurnHit(leader, orb.juiced ? 2.5 : 0);
        this.sound.playExplosion(0);
        hitLeader = true;
      }
      if (hitLeader || orb.life <= 0) {
        this.scene.remove(orb.mesh);
        this.activeWarpOrbs.splice(wIdx, 1);
      }
    }

    // Kart-to-kart collision separation + Aku Aku / Armagedon Boss collision
    for (let i = 0; i < this.karts.length; i++) {
      for (let j = i + 1; j < this.karts.length; j++) {
        const a = this.karts[i];
        const b = this.karts[j];
        if (a.eliminated || b.eliminated) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const distSq = dx * dx + dz * dz;
        const minDist = 2.6;
        if (distSq > 0.001 && distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq);
          const push = (minDist - dist) * 0.5;
          const nx = dx / dist;
          const nz = dz / dist;
          a.x -= nx * push;
          a.z -= nz * push;
          b.x += nx * push;
          b.z += nz * push;

          if (a.akuAkuTimer > 0 && b.akuAkuTimer <= 0 && b.burnTimer <= 0) {
            if (applyKartBurnHit(b, 0)) this.sound.playImpact();
            if (this.isOnlineRace && (a.isPlayer || this.isOnlineHost) && this.remoteHumanIds.has(b.id)) {
              this.onlineClient?.sendAttack({ attackType: 'aku_aku_ram', targetId: b.id, x: b.x, y: b.y, z: b.z, heading: a.heading });
            }
          } else if (b.akuAkuTimer > 0 && a.akuAkuTimer <= 0 && a.burnTimer <= 0) {
            if (applyKartBurnHit(a, 0)) this.sound.playImpact();
            if (this.isOnlineRace && (b.isPlayer || this.isOnlineHost) && this.remoteHumanIds.has(a.id)) {
              this.onlineClient?.sendAttack({ attackType: 'aku_aku_ram', targetId: a.id, x: a.x, y: a.y, z: a.z, heading: b.heading });
            }
          }

          // Armagedón Boss special collision: bumping him slows player briefly!
          if (bossSpec?.bumpSlowsPlayer) {
            if (a.id.startsWith('boss_') && b.isPlayer && b.slowTimer <= 0) {
              b.slowTimer = 2.2;
              this.sound.playImpact();
            } else if (b.id.startsWith('boss_') && a.isPlayer && a.slowTimer <= 0) {
              a.slowTimer = 2.2;
              this.sound.playImpact();
            }
          }
        }
      }
    }

    updateRaceStandings(this.karts, this.matchSettings.mode);

    // Modo Eliminación (2J): Knock out last living racer when countdown reaches 0!
    if (this.matchSettings.mode === 'elimination') {
      this.eliminationTimer -= dt;
      const alive = this.karts.filter((k) => !k.eliminated);
      if (this.eliminationTimer <= 0 && alive.length > 1) {
        const victim = [...alive].sort((a, b) => b.rank - a.rank)[0];
        if (victim) {
          victim.eliminated = true;
          victim.eliminatedAtMs = Math.round(this.raceTimeMs);
          victim.finished = true;
          victim.finishTimeMs = Math.round(this.raceTimeMs);
          this.sound.playEliminationKO();
          for (let s = 0; s < 16; s++) {
            this.spawnParticle(victim.x, victim.y + 1.0, victim.z, (Math.random() - 0.5) * 12, 4 + Math.random() * 4, (Math.random() - 0.5) * 12, 0.65, 0.5, '#ef4444');
          }
          updateRaceStandings(this.karts, 'elimination');
        }
        this.eliminationRound += 1;
        this.eliminationTimer = 18.0;
      }
      const survivors = this.karts.filter((k) => !k.eliminated);
      const humansAlive = survivors.some((k) => k.isPlayer);
      if (survivors.length <= 1 || !humansAlive) {
        survivors.forEach((s) => {
          if (!s.finished) {
            s.finished = true;
            s.finishTimeMs = Math.round(this.raceTimeMs);
          }
        });
        updateRaceStandings(this.karts, 'elimination');
        this.sound.setAkuAkuLoopActive(false);
        this.callbacks.onRaceFinish(this.buildHudSnapshot());
        return;
      }
    }

    this.updateRaceCameras(dt);

    // Check Battle Deathmatch Win Condition (first to 5 kills!)
    if (isBattleMode) {
      const killGoal = this.matchSettings.battleKillGoal ?? 5;
      const topKiller = this.karts.find((k) => k.battleKills >= killGoal);
      if (topKiller) {
        const sorted = [...this.karts].sort((a, b) => b.battleKills - a.battleKills);
        const loser = sorted[sorted.length - 1] ?? sorted[0];
        const snap = this.buildHudSnapshot();
        this.sound.setAkuAkuLoopActive(false);
        this.callbacks.onBattleFinish?.({
          winner: {
            id: topKiller.id,
            name: topKiller.name,
            characterId: topKiller.characterId,
            kills: topKiller.battleKills,
            customization: topKiller.customization,
          },
          loser: {
            id: loser.id,
            name: loser.name,
            characterId: loser.characterId,
            kills: loser.battleKills,
            customization: loser.customization,
          },
          arenaName: this.activeArena.name,
          standings: snap.standings,
        });
        return;
      }
      this.hudThrottleTimer += dt;
      if (this.hudThrottleTimer >= (this.isMobileDevice ? 0.2 : 0.1)) {
        this.hudThrottleTimer = 0;
        this.callbacks.onHudUpdate(this.buildHudSnapshot());
      }
      return;
    }

    // Send 20 Hz online telemetry
    if (this.isOnlineRace && this.onlineClient) {
      this.onlineTelemetryTimer += dt;
      if (this.onlineTelemetryTimer >= 0.05) {
        this.onlineTelemetryTimer = 0;
        const localK = this.karts.find((k) => k.isPlayer);
        if (localK) {
          const serialize = (kt: KartPhysicsState): RemoteKartTelemetry => ({
            id: kt.id,
            isAI: kt.id.startsWith('ai_'),
            x: Number(kt.x.toFixed(2)),
            y: Number(kt.y.toFixed(2)),
            z: Number(kt.z.toFixed(2)),
            vx: Number(kt.vx.toFixed(2)),
            vy: Number(kt.vy.toFixed(2)),
            vz: Number(kt.vz.toFixed(2)),
            heading: Number(kt.heading.toFixed(3)),
            speed: Number(kt.speed.toFixed(2)),
            steerAngle: Number(kt.steerAngle.toFixed(3)),
            nearestT: Number(kt.nearestT.toFixed(4)),
            lap: kt.lap,
            maxProgress: Number(kt.maxProgress.toFixed(4)),
            turboActiveTimer: Number(kt.turboActiveTimer.toFixed(2)),
            akuAkuTimer: Number(kt.akuAkuTimer.toFixed(2)),
            shieldTimer: Number(kt.shieldTimer.toFixed(2)),
            spinoutTimer: 0,
            stunTimer: 0,
            burnTimer: Number(kt.burnTimer.toFixed(2)),
            slowTimer: Number(kt.slowTimer.toFixed(2)),
            slipperyTimer: Number(kt.slipperyTimer.toFixed(2)),
            tntTimer: Number(kt.tntTimer.toFixed(2)),
            heldItem: kt.heldItem,
            finished: kt.finished,
            finishTimeMs: kt.finishTimeMs,
          });
          const aiPayloads = this.isOnlineHost
            ? this.karts.filter((k) => k.id.startsWith('ai_')).map(serialize)
            : undefined;
          this.onlineClient.sendTelemetry(serialize(localK), aiPayloads);
        }
      }
    }

    // Check if ALL local human players have finished
    const humanKarts = this.karts.filter((k) => k.isPlayer);
    const allHumansFinished = humanKarts.length > 0 && humanKarts.every((k) => k.finished);
    if (allHumansFinished) {
      if (this.isOnlineRace && !this.localFinishSent && humanKarts[0]) {
        this.localFinishSent = true;
        this.onlineClient?.sendPlayerFinished(humanKarts[0].finishTimeMs);
      }
      this.karts.forEach((k) => {
        if (!k.finished) {
          const remaining = Math.max(0.05, this.matchSettings.laps - ((k.lap - 1) + k.nearestT));
          k.finishTimeMs = this.raceTimeMs + remaining * 32000;
        }
      });
      updateRaceStandings(this.karts, this.matchSettings.mode);
      this.sound.setAkuAkuLoopActive(false);
      const finalSnap = this.buildHudSnapshot();
      this.callbacks.onRaceFinish(finalSnap);
      return;
    }

    this.hudThrottleTimer += dt;
    if (this.hudThrottleTimer >= (this.isMobileDevice ? 0.2 : 0.1)) {
      this.hudThrottleTimer = 0;
      this.callbacks.onHudUpdate(this.buildHudSnapshot());
    }
  }

  private spawnRocketFromKart(k: KartPhysicsState, juiced = false): void {
    const rocketMesh = createRocketProjectileModel();
    if (juiced) rocketMesh.scale.setScalar(1.35);
    if (this.graphicsMode === 'ps1') applyPs1FilterToObject(rocketMesh, true);
    const rx = k.x + Math.sin(k.heading) * 2.4;
    const ry = k.y + 0.9;
    const rz = k.z + Math.cos(k.heading) * 2.4;
    rocketMesh.position.set(rx, ry, rz);
    rocketMesh.rotation.y = k.heading;
    this.scene.add(rocketMesh);
    const isBattle = this.matchSettings.mode === 'battle';
    this.activeRockets.push({
      ownerId: k.id,
      mesh: rocketMesh,
      x: rx,
      y: ry,
      z: rz,
      heading: k.heading,
      life: isBattle ? 2.6 : juiced ? 2.2 : 1.55,
      juiced,
    });
    if (this.isOnlineRace && (k.isPlayer || this.isOnlineHost)) {
      this.onlineClient?.sendAttack({
        attackType: 'homing_rocket',
        x: rx,
        y: ry,
        z: rz,
        heading: k.heading,
      });
    }
  }

  private updateRaceCameras(dt: number): void {
    const humanKarts = this.karts
      .filter((k) => k.isPlayer)
      .sort((a, b) => a.playerIndex - b.playerIndex);
    const isSplitScreen = humanKarts.length >= 2;
    const snap = this.snapCameraCut;
    this.snapCameraCut = false;

    humanKarts.forEach((k) => {
      if (this.freeCamActive && k.playerIndex === 0) return;
      const cam = this.cameras[k.playerIndex];
      if (!cam) return;

      if (this.frontCameraView) {
        const frontDist = isSplitScreen ? 3.4 : 4.2;
        const frontHeight = isSplitScreen ? 1.95 : 2.15;
        _v1.set(
          k.x + Math.sin(k.heading) * frontDist,
          k.y + frontHeight,
          k.z + Math.cos(k.heading) * frontDist,
        );
        if (snap) {
          cam.position.copy(_v1);
        } else {
          cam.position.lerp(_v1, 1 - Math.exp(-16 * dt));
        }
        _v2.set(
          k.x - Math.sin(k.heading) * 0.25,
          k.y + 1.52,
          k.z - Math.cos(k.heading) * 0.25,
        );
        cam.lookAt(_v2);

        const frontFov = isSplitScreen ? 50 : 52;
        if (Math.abs(cam.fov - frontFov) > 0.2) {
          cam.fov = snap ? frontFov : THREE.MathUtils.damp(cam.fov, frontFov, 10, dt);
          cam.updateProjectionMatrix();
        }
        return;
      }

      const turboPull = k.turboActiveTimer > 0 ? (isSplitScreen ? 0.85 : 1.45) : 0;
      const dist = (isSplitScreen ? 5.35 : 7.6) + turboPull;
      const height = isSplitScreen ? 2.75 : 3.75;
      const lookAhead = isSplitScreen ? 4.2 : 5.6;
      const lookHeight = isSplitScreen ? 1.18 : 1.35;

      _v1.set(
        k.x - Math.sin(k.heading) * dist,
        k.y + height,
        k.z - Math.cos(k.heading) * dist,
      );

      if (snap) {
        cam.position.copy(_v1);
      } else {
        cam.position.lerp(_v1, 1 - Math.exp(-9.5 * dt));
      }
      _v2.set(
        k.x + Math.sin(k.heading) * lookAhead,
        k.y + lookHeight,
        k.z + Math.cos(k.heading) * lookAhead,
      );
      cam.lookAt(_v2);

      const baseFov = isSplitScreen ? 60 : 64;
      const targetFov = k.turboActiveTimer > 0 ? baseFov + 12 : baseFov + Math.min(7, Math.abs(k.speed) * 0.14);
      if (Math.abs(cam.fov - targetFov) > 0.2) {
        cam.fov = snap ? targetFov : THREE.MathUtils.damp(cam.fov, targetFov, 7, dt);
        cam.updateProjectionMatrix();
      }
    });
  }

  private updateCameraVisibilityCulling(cam: THREE.PerspectiveCamera, resetVisibleSet = true): void {
    if (this.skyMesh.visible) {
      this.skyMesh.position.copy(cam.position);
    }

    const inTrackView =
      this.screen === 'title' ||
      (this.screen === 'race' && this.matchSettings.mode !== 'battle');
    if (!inTrackView || !this.builtTrack) return;

    cam.updateMatrixWorld();
    _projMatrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projMatrix);

    // Horizon far beyond fogFar so chunks stream inside mist without visible popping
    const chunkHorizon = this.isMobileDevice ? 240 : 385;
    const objHorizonSq = (this.isMobileDevice ? 225 : 350) ** 2;
    const safetyBuildDist = 48;

    if (resetVisibleSet) {
      this.visibleChunkSet.clear();
      this.visibleKartSet.clear();
    }

    const showBoxes = this.matchSettings.mode !== 'timetrial' && this.matchSettings.mode !== 'relic';

    for (const chunk of this.builtTrack.chunks) {
      const distEdge = cam.position.distanceTo(chunk.center) - chunk.radius;
      const visible =
        distEdge <= chunkHorizon &&
        (distEdge <= safetyBuildDist || _frustum.intersectsSphere(_chunkSphere.set(chunk.center, chunk.radius)));

      if (visible) {
        if (!chunk.built) {
          const builtGroup = chunk.build();
          if (this.graphicsMode === 'ps1') {
            applyPs1FilterToObject(builtGroup, true);
          }
          for (const box of this.builtTrack.itemBoxes) {
            if (box.chunkIndex === chunk.index && box.mesh) {
              box.mesh.visible = showBoxes && box.respawnTimer <= 0;
            }
          }
          for (const wb of this.builtTrack.wumpaBoxes) {
            if (wb.chunkIndex === chunk.index && wb.mesh) {
              wb.mesh.visible = showBoxes && wb.respawnTimer <= 0;
            }
          }
        }
        if (chunk.group) chunk.group.visible = true;
        this.visibleChunkSet.add(chunk.index);
      } else if (chunk.group) {
        chunk.group.visible = false;
      }
    }

    // Frustum + horizon cull karts
    for (const k of this.karts) {
      const rig = this.kartMeshes.get(k.id);
      if (!rig) continue;
      _v1.set(k.x, k.y + 1.0, k.z);
      const d2 = cam.position.distanceToSquared(_v1);
      const vis =
        d2 <= objHorizonSq &&
        (d2 <= 49 || _frustum.intersectsSphere(_objSphere.set(_v1, 3.6)));
      rig.root.visible = vis;
      if (vis) this.visibleKartSet.add(k.id);
    }

    // Frustum cull ghost & dynamic projectiles/pickups
    if (this.ghostMesh) {
      _v1.copy(this.ghostMesh.root.position);
      const d2 = cam.position.distanceToSquared(_v1);
      this.ghostMesh.root.visible = d2 <= objHorizonSq && _frustum.intersectsSphere(_objSphere.set(_v1, 3.2));
    }
    for (const r of this.activeRockets) {
      _v1.set(r.x, r.y, r.z);
      r.mesh.visible = cam.position.distanceToSquared(_v1) <= objHorizonSq && _frustum.intersectsSphere(_objSphere.set(_v1, 2.5));
    }
    for (const b of this.activeBombs) {
      _v1.set(b.x, b.y, b.z);
      b.mesh.visible = cam.position.distanceToSquared(_v1) <= objHorizonSq && _frustum.intersectsSphere(_objSphere.set(_v1, 2.5));
    }
    for (const o of this.activeWarpOrbs) {
      _v1.copy(o.mesh.position);
      o.mesh.visible = cam.position.distanceToSquared(_v1) <= objHorizonSq && _frustum.intersectsSphere(_objSphere.set(_v1, 2.8));
    }
    for (const l of this.activeLightnings) {
      _v1.set(l.x, l.y, l.z);
      l.mesh.visible = cam.position.distanceToSquared(_v1) <= objHorizonSq && _frustum.intersectsSphere(_objSphere.set(_v1, 3.0));
    }
    for (const c of this.activeTntCrates) {
      _v1.set(c.x, c.y, c.z);
      c.mesh.visible = cam.position.distanceToSquared(_v1) <= objHorizonSq && _frustum.intersectsSphere(_objSphere.set(_v1, 2.2));
    }
    for (const p of this.activePotions) {
      _v1.set(p.x, p.y, p.z);
      p.mesh.visible = cam.position.distanceToSquared(_v1) <= objHorizonSq && _frustum.intersectsSphere(_objSphere.set(_v1, 2.2));
    }
    for (const tc of this.activeTimeCrates) {
      if (tc.collected) {
        tc.mesh.visible = false;
        continue;
      }
      _v1.set(tc.x, tc.y, tc.z);
      tc.mesh.visible = cam.position.distanceToSquared(_v1) <= objHorizonSq && _frustum.intersectsSphere(_objSphere.set(_v1, 2.6));
    }
    for (const tk of this.activeTokens) {
      if (tk.collected) {
        tk.mesh.visible = false;
        continue;
      }
      _v1.set(tk.x, tk.y, tk.z);
      tk.mesh.visible = cam.position.distanceToSquared(_v1) <= objHorizonSq && _frustum.intersectsSphere(_objSphere.set(_v1, 2.8));
    }
  }

  private renderSingleCamera(cam: THREE.PerspectiveCamera): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, w, h);
    if (Math.abs(cam.aspect - w / h) > 0.01) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    this.updateCameraVisibilityCulling(cam, true);
    if (this.freeCamActive) this.notifyFreeCamStats(false);
    this.renderer.render(this.scene, cam);
  }

  private renderSplitScreenRace(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const isSingle =
      this.matchSettings.mode === 'timetrial' ||
      this.matchSettings.mode === 'relic' ||
      this.matchSettings.mode === 'boss';
    const count = isSingle ? 1 : Math.min(8, this.matchSettings.playerCount);

    if (count === 1) {
      this.renderSingleCamera(this.cameras[0]);
      return;
    }

    this.renderer.setScissorTest(true);

    if (count === 2) {
      const halfH = Math.floor(h / 2);
      const rects = [
        { x: 0, y: halfH, vw: w, vh: h - halfH },
        { x: 0, y: 0, vw: w, vh: halfH },
      ];
      rects.forEach((r, idx) => {
        const cam = this.cameras[idx];
        cam.aspect = r.vw / Math.max(1, r.vh);
        cam.updateProjectionMatrix();
        this.renderer.setViewport(r.x, r.y, r.vw, r.vh);
        this.renderer.setScissor(r.x, r.y, r.vw, r.vh);
        this.updateCameraVisibilityCulling(cam, idx === 0);
        this.renderer.render(this.scene, cam);
      });
    } else if (count <= 4) {
      const halfW = Math.floor(w / 2);
      const halfH = Math.floor(h / 2);
      const rects = [
        { x: 0, y: halfH, vw: halfW, vh: h - halfH },
        { x: halfW, y: halfH, vw: w - halfW, vh: h - halfH },
        { x: 0, y: 0, vw: halfW, vh: halfH },
        { x: halfW, y: 0, vw: w - halfW, vh: halfH },
      ];
      for (let idx = 0; idx < count; idx++) {
        const r = rects[idx];
        const cam = this.cameras[idx];
        cam.aspect = r.vw / Math.max(1, r.vh);
        cam.updateProjectionMatrix();
        this.renderer.setViewport(r.x, r.y, r.vw, r.vh);
        this.renderer.setScissor(r.x, r.y, r.vw, r.vh);
        this.updateCameraVisibilityCulling(cam, idx === 0);
        this.renderer.render(this.scene, cam);
      }
    } else {
      // 5–8 Players (PC Only!): 4x2 Viewport Split-Screen Grid!
      const cols = 4;
      const rows = 2;
      const cellW = Math.floor(w / cols);
      const cellH = Math.floor(h / rows);
      for (let idx = 0; idx < count; idx++) {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const rx = col * cellW;
        const ry = row === 0 ? cellH : 0; // Top row first (P1-P4), Bottom row (P5-P8)
        const rvw = col === cols - 1 ? w - rx : cellW;
        const rvh = row === 0 ? h - cellH : cellH;
        const cam = this.cameras[idx];
        cam.aspect = rvw / Math.max(1, rvh);
        cam.updateProjectionMatrix();
        this.renderer.setViewport(rx, ry, rvw, rvh);
        this.renderer.setScissor(rx, ry, rvw, rvh);
        this.updateCameraVisibilityCulling(cam, idx === 0);
        this.renderer.render(this.scene, cam);
      }
    }
    if (this.freeCamActive) this.notifyFreeCamStats(false);
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    window.removeEventListener('resize', this.handleResize);
    this.renderer.domElement.removeEventListener('pointerdown', this.handleFreeCamPointerDown);
    window.removeEventListener('pointermove', this.handleFreeCamPointerMove);
    window.removeEventListener('pointerup', this.handleFreeCamPointerUp);
    window.removeEventListener('pointercancel', this.handleFreeCamPointerUp);
    this.sound.stopEngine();
    this.sound.setAkuAkuLoopActive(false);
    this.envRenderTarget?.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
