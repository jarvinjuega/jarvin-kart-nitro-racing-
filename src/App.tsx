import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, MonitorDown, Sparkles, WifiOff, X } from 'lucide-react';
import {
  BOSS_MAP,
  CHARACTER_MAP,
  DEFAULT_PLAYER_SETUPS,
  TRACKS,
  detectMobileClient,
  evaluateRelicKey,
  loadControlConfigs,
  loadSaveProgress,
  persistControlConfigs,
  persistSaveProgress,
} from './game/constants';
import { usePWAInstall } from './hooks/usePWAInstall';
import { InputManager } from './game/input';
import { SoundEngine, type MusicTrackKey } from './game/audio';
import { KartGameEngine, type FreeCameraInfo } from './game/engine';
import { OnlineClient, type OpenRoomSummary } from './game/onlineClient';
import type {
  BattleResultSummary,
  BossCutsceneOutcome,
  BossSpec,
  CharacterSpec,
  GameScreen,
  HubPortalHint,
  LiveInputSnapshot,
  MatchSettings,
  OnlineRoomState,
  PlayableCharacterId,
  PlayerControlConfig,
  PlayerSetup,
  RaceHudSnapshot,
  RelicKeyTier,
  SaveProgress,
} from './game/types';
import type { TouchControlState } from './game/input';
import { IntroOverlay } from './components/IntroOverlay';
import { TitleScreen } from './components/TitleScreen';
import { GarageScreen } from './components/GarageScreen';
import { ControlsSettingsModal } from './components/ControlsSettingsModal';
import { RaceHUD } from './components/RaceHUD';
import { PodiumOverlay } from './components/PodiumOverlay';
import { OnlineLobbyModal } from './components/OnlineLobbyModal';
import { AppDownloadModal } from './components/AppDownloadModal';
import { AdventureHubOverlay } from './components/AdventureHubOverlay';
import { BossSelectModal } from './components/BossSelectModal';
import { BossCutsceneOverlay } from './components/BossCutsceneOverlay';
import { RelicModal } from './components/RelicModal';
import { BattleSetupModal } from './components/BattleSetupModal';
import { BattleWinOverlay } from './components/BattleWinOverlay';
import { HighscoreModal, getOrCreateClientId } from './components/HighscoreModal';
import { LoadingOverlay, type LoadingScreenState } from './components/LoadingOverlay';

declare global {
  interface Window {
    __kartEngine?: KartGameEngine;
  }
}

function getInitialRoomCode(): string {
  if (typeof window === 'undefined') return '';
  const raw = new URLSearchParams(window.location.search).get('sala') ?? '';
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function keyRank(t: RelicKeyTier | undefined): number {
  if (t === 'gold') return 3;
  if (t === 'metal') return 2;
  if (t === 'copper') return 1;
  return 0;
}

function resolveMusicTrack(
  screen: GameScreen,
  matchSettings: MatchSettings,
  activeBoss: BossSpec | null,
): MusicTrackKey {
  if (screen === 'adventure_hub') return 'hub';
  if (screen === 'boss_cutscene' && activeBoss) {
    if (activeBoss.id === 'jarvin_exe') return 'boss_jarvin';
    if (activeBoss.id === 'armagedon_boss') return 'boss_armagedon';
    if (activeBoss.id === 'nitros_oxide') return 'boss_oxide';
    return 'boss_crash';
  }
  if (screen === 'race') {
    if (matchSettings.mode === 'boss') {
      const bId = matchSettings.bossId ?? activeBoss?.id ?? 'jarvin_exe';
      if (bId === 'jarvin_exe') return 'boss_jarvin';
      if (bId === 'armagedon_boss') return 'boss_armagedon';
      if (bId === 'nitros_oxide') return 'boss_oxide';
      return 'boss_crash';
    }
    if (matchSettings.mode === 'battle') return 'tracks_21_30';
    const trk = TRACKS.find((t) => t.id === matchSettings.trackId);
    const ch = trk?.chapter ?? 1;
    if (ch <= 10) return 'tracks_1_10';
    if (ch <= 20) return 'tracks_11_20';
    return 'tracks_21_30';
  }
  return 'menu';
}

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<KartGameEngine | null>(null);
  const inputRef = useRef<InputManager | null>(null);
  const soundRef = useRef<SoundEngine | null>(null);
  const onlineClientRef = useRef<OnlineClient | null>(null);

  const [initialJoinCode] = useState<string>(() => getInitialRoomCode());

  const [save, setSave] = useState<SaveProgress>(() => loadSaveProgress());
  const [controlConfigs, setControlConfigs] = useState<PlayerControlConfig[]>(() =>
    loadControlConfigs(),
  );
  const [playerSetups, setPlayerSetups] = useState<PlayerSetup[]>(() =>
    structuredClone(DEFAULT_PLAYER_SETUPS),
  );
  const [matchSettings, setMatchSettings] = useState<MatchSettings>({
    mode: 'arcade',
    trackId: TRACKS[0].id,
    playerCount: 1,
    useAI: true,
    aiCount: 4,
    laps: 3,
    aiDifficulty: 'normal',
  });

  const [screen, setScreen] = useState<GameScreen>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('autostart') === '1') return 'race';
      if (params.get('sala') || params.get('install') === '1') return 'title';
    }
    return 'intro';
  });

  const pwa = usePWAInstall();
  const [installBannerDismissed, setInstallBannerDismissed] = useState(false);
  const [installPromptLaunched] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('install') === '1';
  });

  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [settingsModal, setSettingsModal] = useState<{
    open: boolean;
    tab: 'general' | 'controls';
  }>({ open: false, tab: 'general' });

  const [onlineModalOpen, setOnlineModalOpen] = useState<boolean>(() => Boolean(getInitialRoomCode()));
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [highscoreModalOpen, setHighscoreModalOpen] = useState(false);
  const [tokenToast, setTokenToast] = useState<string | null>(null);
  const [freeCamInfo, setFreeCamInfo] = useState<FreeCameraInfo>({
    active: false,
    visibleChunks: 0,
    builtChunks: 0,
    totalChunks: 12,
  });
  const [isMobileClient] = useState<boolean>(() => detectMobileClient());
  const [loadingState, setLoadingState] = useState<LoadingScreenState | null>(() => ({
    active: true,
    detail: 'Cargando motor 3D, texturas y circuito inicial...',
    stage: 'Inicializando WebGL y circuitos',
    progress: 24,
  }));
  const loadingSeqRef = useRef(0);
  const [bossModalOpen, setBossModalOpen] = useState(false);
  const [relicModalOpen, setRelicModalOpen] = useState(false);
  const [battleModalOpen, setBattleModalOpen] = useState(false);

  const [activeBoss, setActiveBoss] = useState<BossSpec | null>(null);
  const [bossCutsceneOutcome, setBossCutsceneOutcome] = useState<BossCutsceneOutcome>('intro');
  const [pendingBossPodium, setPendingBossPodium] = useState<{
    snap: RaceHudSnapshot;
    isNewRecord: boolean;
    defeatedBoss: BossSpec;
    unlockedChar: CharacterSpec | null;
  } | null>(null);
  const [nearbyPortal, setNearbyPortal] = useState<HubPortalHint | null>(null);
  const [battleResult, setBattleResult] = useState<BattleResultSummary | null>(null);

  const [onlineConnected, setOnlineConnected] = useState(false);
  const [onlineRoom, setOnlineRoom] = useState<OnlineRoomState | null>(null);
  const [onlinePlayerId, setOnlinePlayerId] = useState<string | null>(null);
  const [openRooms, setOpenRooms] = useState<OpenRoomSummary[]>([]);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [isOnlineMatch, setIsOnlineMatch] = useState(false);
  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  const [hudSnapshot, setHudSnapshot] = useState<RaceHudSnapshot | null>(null);
  const [podiumResults, setPodiumResults] = useState<RaceHudSnapshot | null>(null);
  const [isNewRecord, setIsNewRecord] = useState(false);
  const [unlockedNextChapter, setUnlockedNextChapter] = useState(false);
  const [earnedRelicKey, setEarnedRelicKey] = useState<RelicKeyTier | null>(null);
  const [unlockedBattleNow, setUnlockedBattleNow] = useState(false);
  const [defeatedBossResult, setDefeatedBossResult] = useState<BossSpec | null>(null);
  const [unlockedCharacterResult, setUnlockedCharacterResult] = useState<CharacterSpec | null>(null);
  const [liveInputs, setLiveInputs] = useState<LiveInputSnapshot[]>([]);
  const [connectedGamepads, setConnectedGamepads] = useState<Array<{ index: number; id: string }>>(
    [],
  );

  const matchSettingsRef = useRef(matchSettings);
  matchSettingsRef.current = matchSettings;
  const saveRef = useRef(save);
  saveRef.current = save;
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const controlConfigsRef = useRef(controlConfigs);
  controlConfigsRef.current = controlConfigs;
  const playerSetupsRef = useRef(playerSetups);
  playerSetupsRef.current = playerSetups;

  useEffect(() => {
    const onOnline = () => setIsBrowserOnline(true);
    const onOffline = () => setIsBrowserOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (
      screen === 'intro' ||
      screen === 'title' ||
      screen === 'garage' ||
      screen === 'adventure_hub' ||
      screen === 'boss_cutscene'
    ) {
      document.body.dataset.state = 'title';
    } else if (screen === 'race') {
      document.body.dataset.state = paused ? 'paused' : 'playing';
    } else if (screen === 'podium' || screen === 'battle_win') {
      document.body.dataset.state = 'gameover';
    }
  }, [screen, paused]);

  const runWithLoading = useCallback(
    (detail: string, stage: string, task: () => void, holdMs = 440) => {
      const seq = ++loadingSeqRef.current;
      setLoadingState({ active: true, detail, stage, progress: 28 });
      requestAnimationFrame(() => {
        if (loadingSeqRef.current !== seq) return;
        setLoadingState({ active: true, detail, stage: 'Construyendo mapa y modelos 3D...', progress: 64 });
        requestAnimationFrame(() => {
          if (loadingSeqRef.current !== seq) return;
          task();
          setLoadingState({ active: true, detail, stage: '¡Listo!', progress: 100 });
          window.setTimeout(() => {
            if (loadingSeqRef.current === seq) {
              setLoadingState(null);
            }
          }, holdMs);
        });
      });
    },
    [],
  );

  const goToTitleMenu = useCallback(() => {
    runWithLoading('Cargando menú principal y circuitos 3D...', 'Preparando pistas y corredores', () => {
      setScreen('title');
      engineRef.current?.setScreen('title');
    });
  }, [runWithLoading]);

  const launchRaceWithSettings = useCallback(
    (nextSettings: MatchSettings) => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      const isSolo =
        nextSettings.mode === 'timetrial' ||
        nextSettings.mode === 'relic' ||
        nextSettings.mode === 'boss';
      const maxLocalPlayers = isMobileClient
        ? 2
        : saveRef.current.specialModesUnlocked.eightPlayerPc
          ? 8
          : 4;
      const clampedCount =
        nextSettings.mode === 'elimination'
          ? 2
          : isSolo
            ? 1
            : Math.max(1, Math.min(maxLocalPlayers, nextSettings.playerCount));
      const activeSettings: MatchSettings = {
        ...nextSettings,
        playerCount: clampedCount,
        useAI: isSolo
          ? nextSettings.mode === 'boss'
          : clampedCount === 1
            ? true
            : nextSettings.useAI,
        aiDifficulty: 'normal',
      };
      const trkName = TRACKS.find((t) => t.id === activeSettings.trackId)?.name ?? 'Circuito';
      runWithLoading(
        `Cargando circuito: ${trkName}`,
        `Texturas, karts (${clampedCount}J) y shaders 3D`,
        () => {
          setMatchSettings(activeSettings);
          setIsOnlineMatch(false);
          setPaused(false);
          setPodiumResults(null);
          setBattleResult(null);
          setPendingBossPodium(null);
          engineRef.current?.clearTouchState();
          setScreen('race');
          const ghost = saveRef.current.bestGhosts[activeSettings.trackId];
          engineRef.current?.startRace(
            activeSettings,
            playerSetupsRef.current,
            controlConfigsRef.current,
            ghost,
          );
        },
        480,
      );
    },
    [isMobileClient, runWithLoading],
  );

  const handleRaceFinish = useCallback((finalSnap: RaceHudSnapshot) => {
    const engine = engineRef.current;
    const ms = matchSettingsRef.current;
    const curSave = saveRef.current;
    const trk = TRACKS.find((t) => t.id === ms.trackId) ?? TRACKS[0];

    const humanBest = finalSnap.players[0]?.finishTimeMs ?? finalSnap.raceTimeMs;
    const prevBest = ms.mode === 'relic' ? curSave.bestRelicTimes[trk.id] : curSave.bestTimes[trk.id];
    const beatRecord = ms.mode !== 'online' && humanBest > 0 && (!prevBest || humanBest < prevBest);
    const humanWon = finalSnap.standings[0]?.isPlayer ?? false;

    let unlockedNew = false;
    let nextUnlocked = curSave.unlockedChapters;
    let nextCompleted = curSave.adventureCompletedTracks;
    let triggerJarvinExeCutscene = false;

    if (ms.mode === 'adventure' && humanWon) {
      if (trk.chapter >= curSave.unlockedChapters && curSave.unlockedChapters < TRACKS.length) {
        nextUnlocked = trk.chapter + 1;
        unlockedNew = true;
      }
      if (!nextCompleted.includes(trk.id)) {
        nextCompleted = [...nextCompleted, trk.id];
      }
      if (nextCompleted.length >= 5 && !curSave.jarvinExeCutsceneSeen) {
        triggerJarvinExeCutscene = true;
      }
    }

    // Relic Keys Evaluation
    let newRelicTier: RelicKeyTier | null = null;
    let unlockedBattleThisRun = false;
    const nextRelicKeys = { ...curSave.relicKeys };
    if (ms.mode === 'relic') {
      newRelicTier = evaluateRelicKey(humanBest);
      if (newRelicTier && keyRank(newRelicTier) > keyRank(nextRelicKeys[trk.id])) {
        nextRelicKeys[trk.id] = newRelicTier;
      }
      if ((newRelicTier === 'gold' || newRelicTier === 'metal') && !curSave.battleUnlocked) {
        unlockedBattleThisRun = true;
      }
    }

    // Boss Defeat Evaluation & Playable Jarvin.exe Unlock
    let wonBoss: BossSpec | null = null;
    let unlockedCharNow: CharacterSpec | null = null;
    let nextDefeatedBosses = curSave.defeatedBosses;
    let nextUnlockedCharacters: PlayableCharacterId[] = curSave.unlockedCharacters;
    if (ms.mode === 'boss' && ms.bossId && humanWon) {
      wonBoss = BOSS_MAP[ms.bossId] ?? null;
      if (wonBoss && !nextDefeatedBosses.includes(wonBoss.id)) {
        nextDefeatedBosses = [...nextDefeatedBosses, wonBoss.id];
      }
      if (wonBoss?.id === 'jarvin_exe' && !nextUnlockedCharacters.includes('jarvin_exe')) {
        nextUnlockedCharacters = [...nextUnlockedCharacters, 'jarvin_exe'];
        unlockedCharNow = CHARACTER_MAP.jarvin_exe;
      }
    }

    const updatedSave: SaveProgress = {
      ...curSave,
      unlockedChapters: nextUnlocked,
      adventureCompletedTracks: nextCompleted,
      jarvinExeCutsceneSeen: curSave.jarvinExeCutsceneSeen || triggerJarvinExeCutscene,
      defeatedBosses: nextDefeatedBosses,
      unlockedCharacters: nextUnlockedCharacters,
      relicKeys: nextRelicKeys,
      battleUnlocked: curSave.battleUnlocked || unlockedBattleThisRun,
      bestTimes:
        ms.mode !== 'relic' && beatRecord
          ? { ...curSave.bestTimes, [trk.id]: humanBest }
          : curSave.bestTimes,
      bestRelicTimes:
        ms.mode === 'relic' && beatRecord
          ? { ...curSave.bestRelicTimes, [trk.id]: humanBest }
          : curSave.bestRelicTimes,
      bestGhosts:
        ms.mode === 'timetrial' && beatRecord && engine
          ? { ...curSave.bestGhosts, [trk.id]: engine.getRecordedGhost() }
          : curSave.bestGhosts,
    };

    persistSaveProgress(updatedSave);
    setSave(updatedSave);

    // Submit real human race time to Global Highscores API
    const p1 = finalSnap.players[0];
    if (
      p1 &&
      !p1.eliminated &&
      p1.finished &&
      humanBest >= 10000 &&
      ['arcade', 'adventure', 'relic', 'timetrial', 'madness', 'tokens', 'online'].includes(ms.mode)
    ) {
      void fetch('/api/highscores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: getOrCreateClientId(),
          playerName: curSave.playerNickname || 'Corredor',
          trackId: trk.id,
          characterId: p1.characterId,
          mode: ms.mode,
          timeMs: Math.round(humanBest),
          isMobile: isMobileClient,
        }),
      }).catch(() => {
        // Offline or server unavailable; ignore silently
      });
    }

    // Trigger Jarvin.exe 3D Boss Cutscene immediately on 5th Adventure win!
    if (triggerJarvinExeCutscene) {
      const jBoss = BOSS_MAP.jarvin_exe;
      setActiveBoss(jBoss);
      setBossCutsceneOutcome('intro');
      setPendingBossPodium(null);
      setPaused(false);
      setScreen('boss_cutscene');
      engine?.showBossCutscene(jBoss, 'intro', playerSetupsRef.current[0]);
      return;
    }

    // Real 3D Boss Cutscene on BOTH Boss Victory AND Boss Defeat!
    if (ms.mode === 'boss' && ms.bossId) {
      const bossSpec = BOSS_MAP[ms.bossId];
      if (bossSpec) {
        setActiveBoss(bossSpec);
        const outcome: BossCutsceneOutcome = humanWon ? 'victory' : 'defeat';
        setBossCutsceneOutcome(outcome);
        setUnlockedCharacterResult(unlockedCharNow);
        if (humanWon) {
          setPendingBossPodium({
            snap: finalSnap,
            isNewRecord: beatRecord,
            defeatedBoss: bossSpec,
            unlockedChar: unlockedCharNow,
          });
        } else {
          setPendingBossPodium(null);
        }
        setPaused(false);
        setScreen('boss_cutscene');
        engine?.showBossCutscene(bossSpec, outcome, playerSetupsRef.current[0]);
        return;
      }
    }

    setIsNewRecord(beatRecord);
    setUnlockedNextChapter(unlockedNew);
    setEarnedRelicKey(newRelicTier);
    setUnlockedBattleNow(unlockedBattleThisRun);
    setDefeatedBossResult(wonBoss);
    setUnlockedCharacterResult(unlockedCharNow);
    setPodiumResults(finalSnap);
    setPaused(false);
    setScreen('podium');
    engine?.showPodium(finalSnap.standings);
  }, []);

  const handleBattleFinish = useCallback((summary: BattleResultSummary) => {
    setBattleResult(summary);
    setPaused(false);
    setScreen('battle_win');
    engineRef.current?.showBattleWin(summary);
  }, []);

  const handleHubPortalEnter = useCallback(
    (trackId: string, isBossPortal: boolean) => {
      if (isBossPortal) {
        const jBoss = BOSS_MAP.jarvin_exe;
        setActiveBoss(jBoss);
        setBossCutsceneOutcome('intro');
        setPendingBossPodium(null);
        setScreen('boss_cutscene');
        engineRef.current?.showBossCutscene(jBoss, 'intro', playerSetupsRef.current[0]);
        return;
      }
      launchRaceWithSettings({
        ...matchSettingsRef.current,
        mode: 'adventure',
        trackId,
        playerCount: 1,
        useAI: true,
        aiCount: 4,
      });
    },
    [launchRaceWithSettings],
  );

  // Initialize Three.js WebGL engine once
  useEffect(() => {
    if (!mountRef.current) return;
    const input = new InputManager();
    const sound = new SoundEngine();
    sound.setVolume(saveRef.current.sfxVolume);
    sound.setMusicEnabled(saveRef.current.musicEnabled);
    sound.setMusicTrack(resolveMusicTrack(screenRef.current, matchSettingsRef.current, null));

    const engine = new KartGameEngine(mountRef.current, input, sound, {
      onHudUpdate: (snap) => setHudSnapshot(snap),
      onRaceFinish: handleRaceFinish,
      onBattleFinish: handleBattleFinish,
      onHubPortalProximity: (hint) => setNearbyPortal(hint),
      onHubPortalEnter: handleHubPortalEnter,
      onTokensCompleted: (trackId) => {
        const cur = saveRef.current;
        const collectedTracks = cur.collectedTokenTracks.includes(trackId)
          ? cur.collectedTokenTracks
          : [...cur.collectedTokenTracks, trackId];
        const nextSave: SaveProgress = {
          ...cur,
          collectedTokenTracks: collectedTracks,
          specialModesUnlocked: {
            ...cur.specialModesUnlocked,
            eightPlayerPc: true,
          },
        };
        persistSaveProgress(nextSave);
        setSave(nextSave);
        setTokenToast(
          isMobileClient
            ? '¡Reuniste J-K-T! El Modo 8 Jugadores quedó desbloqueado para cuando juegues en PC.'
            : '¡Reuniste las iniciales J-K-T! Modo 8 Jugadores (Solo PC) desbloqueado en Ajustes.',
        );
        window.setTimeout(() => setTokenToast(null), 6000);
      },
      onPauseRequested: () => {
        if (screenRef.current === 'race') {
          const nextPaused = !pausedRef.current;
          setPaused(nextPaused);
          engineRef.current?.setPaused(nextPaused);
        }
      },
      onIntroFinished: () => {
        if (screenRef.current === 'intro') {
          goToTitleMenu();
        }
      },
      onLiveInputSample: (samples) => {
        setLiveInputs(samples);
        const gps = input.getConnectedGamepads().map((g) => ({ index: g.index, id: g.id }));
        setConnectedGamepads(gps);
      },
      onFreeCamChange: (info) => {
        setFreeCamInfo(info);
      },
    });

    engine.setControlConfigs(loadControlConfigs());
    engine.setGraphicsMode(saveRef.current.graphicsMode);
    engine.setAudioMode(saveRef.current.audioMode);

    inputRef.current = input;
    soundRef.current = sound;
    engineRef.current = engine;
    window.__kartEngine = engine;

    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      engine.startRace(
        matchSettingsRef.current,
        DEFAULT_PLAYER_SETUPS,
        loadControlConfigs(),
      );
    } else if (params.get('sala') || params.get('install') === '1') {
      engine.setScreen('title');
    } else {
      engine.setScreen('intro');
    }

    const bootSeq = ++loadingSeqRef.current;
    setLoadingState({
      active: true,
      detail: 'Cargando circuitos 3D, karts y audio...',
      stage: 'Escena 3D lista',
      progress: 85,
    });
    window.setTimeout(() => {
      if (loadingSeqRef.current === bootSeq) {
        setLoadingState((prev) => (prev ? { ...prev, progress: 100, stage: '¡Listo!' } : null));
        window.setTimeout(() => {
          if (loadingSeqRef.current === bootSeq) {
            setLoadingState(null);
          }
        }, 260);
      }
    }, 260);

    return () => {
      delete window.__kartEngine;
      engine.dispose();
      sound.destroy();
      input.dispose();
    };
  }, [goToTitleMenu, handleBattleFinish, handleHubPortalEnter, handleRaceFinish]);

  // Sync background music track and toggle with active screen/boss/track
  useEffect(() => {
    soundRef.current?.setMusicEnabled(save.musicEnabled);
  }, [save.musicEnabled]);

  useEffect(() => {
    soundRef.current?.setMusicTrack(resolveMusicTrack(screen, matchSettings, activeBoss));
  }, [screen, matchSettings, activeBoss]);

  useEffect(() => {
    engineRef.current?.setLiveInputPollingEnabled(settingsModal.open && settingsModal.tab === 'controls');
  }, [settingsModal.open, settingsModal.tab]);

  // Initialize Online WebSocket Client
  useEffect(() => {
    const client = new OnlineClient();
    onlineClientRef.current = client;

    client.setHandlers({
      onConnectionChange: (conn) => setOnlineConnected(conn),
      onRoomsList: (rooms) => setOpenRooms(rooms),
      onJoined: (pid, room) => {
        setOnlineError(null);
        setOnlinePlayerId(pid);
        setOnlineRoom(room);
      },
      onRoomState: (room) => {
        setOnlineRoom(room);
      },
      onRaceStart: (room) => {
        const pid = client.getPlayerId();
        if (!pid) return;
        const trkName = TRACKS.find((t) => t.id === room.trackId)?.name ?? 'Sala Online';
        runWithLoading(`Cargando sala online: ${trkName}`, 'Sincronizando corredores y pista 3D', () => {
          setOnlineError(null);
          setOnlineRoom(room);
          setOnlineModalOpen(false);
          setDownloadModalOpen(false);
          setIsOnlineMatch(true);
          setPaused(false);
          setPodiumResults(null);
          setScreen('race');
          engineRef.current?.startOnlineRace(room, pid, controlConfigsRef.current, client);
        });
      },
      onRaceSnapshot: (karts) => {
        engineRef.current?.applyOnlineSnapshot(karts);
      },
      onAttackEvent: (ev) => {
        engineRef.current?.applyOnlineAttack(ev);
      },
      onError: (msg) => {
        setOnlineError(msg);
      },
    });

    if (initialJoinCode) {
      client.connect();
    }

    return () => {
      client.dispose();
      onlineClientRef.current = null;
    };
  }, [initialJoinCode]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (settingsModal.open || onlineModalOpen || downloadModalOpen || highscoreModalOpen || bossModalOpen || relicModalOpen || battleModalOpen) {
        if (e.code === 'Escape') {
          setSettingsModal((s) => ({ ...s, open: false }));
          setOnlineModalOpen(false);
          setDownloadModalOpen(false);
          setHighscoreModalOpen(false);
          setBossModalOpen(false);
          setRelicModalOpen(false);
          setBattleModalOpen(false);
        }
        return;
      }
      if (screen === 'intro' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape')) {
        e.preventDefault();
        goToTitleMenu();
      } else if (screen === 'title' && (e.code === 'Enter' || e.code === 'Space')) {
        if (document.activeElement?.tagName === 'BUTTON') return;
        e.preventDefault();
        openGarage();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const handleUpdateSave = (next: SaveProgress) => {
    setSave(next);
    persistSaveProgress(next);
    soundRef.current?.setVolume(next.sfxVolume);
    engineRef.current?.setGraphicsMode(next.graphicsMode);
    engineRef.current?.setAudioMode(next.audioMode);
  };

  const handleAppDownloaded = useCallback(() => {
    const cur = saveRef.current;
    const nextChars = new Set<PlayableCharacterId>(cur.unlockedCharacters);
    nextChars.add('celular_kart');
    nextChars.add('pc_gamer');
    if (cur.appDownloadedUnlocked && nextChars.size === cur.unlockedCharacters.length) return;
    const nextSave: SaveProgress = {
      ...cur,
      appDownloadedUnlocked: true,
      unlockedCharacters: Array.from(nextChars),
    };
    persistSaveProgress(nextSave);
    setSave(nextSave);
    setTokenToast('¡App instalada/descargada! Desbloqueaste a Celular Kart y PC Gamer en el Garaje.');
    window.setTimeout(() => setTokenToast(null), 5000);
  }, []);

  const handleDirectInstallApp = useCallback(async () => {
    if (pwa.isInstallable) {
      const ok = await pwa.install();
      if (ok) {
        handleAppDownloaded();
      }
      return;
    }
    setDownloadModalOpen(true);
  }, [handleAppDownloaded, pwa]);

  const handleTouchState = useCallback((partial: Partial<TouchControlState>) => {
    engineRef.current?.setTouchControlState(partial);
  }, []);

  const handleTouchPulse = useCallback((action: 'jump' | 'item' | 'pause') => {
    if (action === 'pause' && screenRef.current === 'race') {
      const nextPaused = !pausedRef.current;
      setPaused(nextPaused);
      engineRef.current?.setPaused(nextPaused);
      return;
    }
    engineRef.current?.triggerTouchPulse(action);
  }, []);

  const handleUpdateControls = (next: PlayerControlConfig[]) => {
    setControlConfigs(next);
    persistControlConfigs(next);
    engineRef.current?.setControlConfigs(next);
  };

  const handleChangeMatchSettings = (next: MatchSettings) => {
    const trackChanged = next.trackId !== matchSettings.trackId;
    setMatchSettings(next);
    if (trackChanged) {
      const trkName = TRACKS.find((t) => t.id === next.trackId)?.name ?? 'Mapa 3D';
      runWithLoading(
        `Cargando circuito: ${trkName}`,
        'Construyendo terreno, curvas y cascadas 3D',
        () => {
          engineRef.current?.loadTrack(next.trackId);
          if (screen === 'title' || screen === 'intro') {
            engineRef.current?.setScreen(screen);
          }
        },
        360,
      );
    }
  };

  const openGarage = () => {
    runWithLoading('Cargando Garaje 3D y personajes...', 'Preparando karts personalizables', () => {
      setScreen('garage');
      engineRef.current?.setScreen('garage');
      const p1 = playerSetups[0];
      engineRef.current?.updateGaragePreview(p1.characterId, p1.customization);
    }, 360);
  };

  const enterAdventureHub = () => {
    const curSave = saveRef.current;
    runWithLoading('Cargando Mapa 3D de Aventura...', 'Generando portales y mundo abierto', () => {
      setNearbyPortal(null);
      setMatchSettings((prev) => ({ ...prev, mode: 'adventure', playerCount: 1 }));
      setScreen('adventure_hub');
      engineRef.current?.enterAdventureHub(
        playerSetupsRef.current[0],
        controlConfigsRef.current,
        curSave.unlockedChapters,
        curSave.adventureCompletedTracks,
        curSave.adventureCompletedTracks.length >= 5,
      );
    });
  };

  const handleOpenOnline = () => {
    setOnlineError(null);
    onlineClientRef.current?.connect();
    onlineClientRef.current?.requestOpenRooms();
    setOnlineModalOpen(true);
  };

  const currentTrackIndex = TRACKS.findIndex((t) => t.id === matchSettings.trackId);
  const nextTrack = TRACKS[currentTrackIndex + 1];
  const effectivePlayerCount =
    isOnlineMatch ||
    matchSettings.mode === 'timetrial' ||
    matchSettings.mode === 'relic' ||
    matchSettings.mode === 'boss'
      ? 1
      : matchSettings.playerCount;

  return (
    <main
      className={`relative w-screen h-screen overflow-hidden bg-[#090d14] ${
        save.graphicsMode === 'ps1' ? 'ps1-mode' : ''
      }`}
    >
      <div
        ref={mountRef}
        data-testid="webgl-viewport"
        className="fixed inset-0 z-0 w-full h-full"
      />

      {!isBrowserOnline && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/95 text-slate-950 font-display font-bold text-xs shadow-lg">
          <WifiOff className="w-3.5 h-3.5" />
          <span>Sin conexión · Modo local disponible</span>
        </div>
      )}

      {tokenToast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-400 text-slate-950 border-2 border-white font-display font-bold text-xs sm:text-sm shadow-2xl">
          <Sparkles className="w-4 h-4 shrink-0" />
          <span>{tokenToast}</span>
        </div>
      )}

      {freeCamInfo.active && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 w-[94%] max-w-2xl bg-[#090d14]/92 border-2 border-cyan-400 rounded-2xl px-4 py-2.5 shadow-2xl flex flex-wrap items-center justify-between gap-2 pointer-events-auto">
          <div className="flex items-start gap-2.5 min-w-0">
            <Eye className="w-4 h-4 text-cyan-300 shrink-0 mt-0.5" />
            <div className="text-xs leading-snug">
              <div className="font-display font-bold text-cyan-300">
                CÁMARA LIBRE ACTIVA · Chunks visibles: {freeCamInfo.visibleChunks}/{freeCamInfo.totalChunks} · Generados: {freeCamInfo.builtChunks}/{freeCamInfo.totalChunks}
              </div>
              <div className="text-[11px] text-slate-300">
                Volar: <strong>WASD / Flechas</strong> · Subir/Bajar: <strong>E / Q</strong> · Rápido: <strong>Shift</strong> · Girar: <strong>Arrastrar ratón o I/J/K/L</strong>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => engineRef.current?.toggleFreeCamera()}
            className="px-3 py-1.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-display font-bold text-xs cursor-pointer shrink-0"
          >
            Salir (Shift + P)
          </button>
        </div>
      )}

      {installPromptLaunched && !pwa.isInstalled && !installBannerDismissed && screen === 'title' && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[94%] max-w-xl bg-[#090d14]/95 border-2 border-cyan-400 rounded-2xl p-3.5 shadow-2xl flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-display font-bold text-sm text-cyan-300">
              Instalar Jarvin Kart Turbo como App en tu PC
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              {pwa.isInstallable
                ? 'Haz clic en Instalar Ahora para abrirlo en ventana propia sin navegador.'
                : 'Pulsa Instalar Ahora o usa el ícono Instalar de la barra superior del navegador.'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleDirectInstallApp()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-display font-bold text-xs cursor-pointer"
            >
              <MonitorDown className="w-4 h-4" />
              <span>Instalar Ahora</span>
            </button>
            <button
              type="button"
              aria-label="Cerrar aviso de instalación"
              onClick={() => setInstallBannerDismissed(true)}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {screen === 'intro' && (
        <IntroOverlay
          onSkip={goToTitleMenu}
        />
      )}

      {screen === 'title' && (
        <TitleScreen
          settings={matchSettings}
          save={save}
          isMobileClient={isMobileClient}
          pwaInstalled={pwa.isInstalled}
          onChangeSettings={handleChangeMatchSettings}
          onEnterAdventureHub={enterAdventureHub}
          onOpenGarage={openGarage}
          onQuickStartRace={() => launchRaceWithSettings(matchSettings)}
          onOpenSettings={() => setSettingsModal({ open: true, tab: 'general' })}
          onOpenOnline={handleOpenOnline}
          onOpenBossMenu={() => setBossModalOpen(true)}
          onOpenRelicMenu={() => setRelicModalOpen(true)}
          onOpenBattleMenu={() => setBattleModalOpen(true)}
          onOpenDownload={() => setDownloadModalOpen(true)}
          onInstallApp={() => void handleDirectInstallApp()}
          onOpenHighscores={() => setHighscoreModalOpen(true)}
        />
      )}

      {screen === 'adventure_hub' && (
        <AdventureHubOverlay
          save={save}
          nearbyPortal={nearbyPortal}
          touchControls={save.touchControls}
          onTouchState={handleTouchState}
          onTouchPulse={handleTouchPulse}
          onEnterPortal={handleHubPortalEnter}
          onBackToMenu={() => {
            engineRef.current?.clearTouchState();
            goToTitleMenu();
          }}
        />
      )}

      {screen === 'boss_cutscene' && activeBoss && (
        <BossCutsceneOverlay
          boss={activeBoss}
          outcome={bossCutsceneOutcome}
          unlockedCharacter={unlockedCharacterResult}
          onStartBattle={() => {
            launchRaceWithSettings({
              ...matchSettings,
              mode: 'boss',
              trackId: activeBoss.trackId,
              bossId: activeBoss.id,
              playerCount: 1,
              laps: 3,
              useAI: true,
              aiDifficulty: 'normal',
            });
          }}
          onContinueToPodium={
            pendingBossPodium
              ? () => {
                  const p = pendingBossPodium;
                  setIsNewRecord(p.isNewRecord);
                  setUnlockedNextChapter(false);
                  setEarnedRelicKey(null);
                  setUnlockedBattleNow(false);
                  setDefeatedBossResult(p.defeatedBoss);
                  setUnlockedCharacterResult(p.unlockedChar);
                  setPodiumResults(p.snap);
                  setPendingBossPodium(null);
                  setScreen('podium');
                  engineRef.current?.showPodium(p.snap.standings);
                }
              : undefined
          }
          onCancel={() => {
            setPendingBossPodium(null);
            goToTitleMenu();
          }}
        />
      )}

      {screen === 'garage' && (
        <GarageScreen
          playerCount={effectivePlayerCount}
          setups={playerSetups}
          save={save}
          onUpdateSetup={(idx, nextSetup) => {
            const copy = [...playerSetups];
            copy[idx] = nextSetup;
            setPlayerSetups(copy);
          }}
          onPreviewChange={(cid, cust) => {
            engineRef.current?.updateGaragePreview(cid, cust);
          }}
          onBack={() => goToTitleMenu()}
          onStartRace={() => launchRaceWithSettings(matchSettings)}
        />
      )}

      {screen === 'race' && (
        <RaceHUD
          hud={hudSnapshot}
          playerCount={effectivePlayerCount}
          paused={paused}
          muted={muted}
          touchControls={save.touchControls}
          onTouchState={handleTouchState}
          onTouchPulse={handleTouchPulse}
          onTogglePause={() => {
            const next = !paused;
            setPaused(next);
            engineRef.current?.setPaused(next);
          }}
          onToggleMute={() => {
            const nextMuted = !muted;
            setMuted(nextMuted);
            soundRef.current?.setMuted(nextMuted);
          }}
          onToggleCamera={() => engineRef.current?.toggleFrontCamera()}
          onRestartRace={() => {
            if (isOnlineMatch) {
              if (onlineClientRef.current?.isHost()) {
                onlineClientRef.current.backToLobby();
              }
              setIsOnlineMatch(false);
              setScreen('title');
              engineRef.current?.setScreen('title');
              setOnlineModalOpen(true);
            } else {
              launchRaceWithSettings(matchSettings);
            }
          }}
          onOpenControlSettings={() => setSettingsModal({ open: true, tab: 'controls' })}
          onExitToMenu={() => {
            engineRef.current?.clearTouchState();
            if (isOnlineMatch) {
              onlineClientRef.current?.leaveRoom();
              setOnlineRoom(null);
              setOnlinePlayerId(null);
              setIsOnlineMatch(false);
            }
            setPaused(false);
            engineRef.current?.setPaused(false);
            if (matchSettings.mode === 'adventure') {
              enterAdventureHub();
            } else {
              goToTitleMenu();
            }
          }}
        />
      )}

      {screen === 'podium' && podiumResults && (
        <PodiumOverlay
          results={podiumResults}
          isNewRecord={isNewRecord}
          unlockedNextChapter={unlockedNextChapter}
          earnedRelicKey={earnedRelicKey}
          unlockedBattle={unlockedBattleNow}
          bossDefeated={defeatedBossResult}
          unlockedCharacter={unlockedCharacterResult}
          hasNextTrack={!isOnlineMatch && matchSettings.mode !== 'boss' && Boolean(nextTrack)}
          onNextTrack={() => {
            if (!isOnlineMatch && nextTrack) {
              launchRaceWithSettings({ ...matchSettings, trackId: nextTrack.id });
            }
          }}
          onReplay={() => {
            if (isOnlineMatch) {
              if (onlineClientRef.current?.isHost()) {
                onlineClientRef.current.backToLobby();
              }
              setIsOnlineMatch(false);
              setScreen('title');
              engineRef.current?.setScreen('title');
              setOnlineModalOpen(true);
            } else {
              launchRaceWithSettings(matchSettings);
            }
          }}
          onMainMenu={() => {
            if (isOnlineMatch) {
              onlineClientRef.current?.leaveRoom();
              setOnlineRoom(null);
              setOnlinePlayerId(null);
              setIsOnlineMatch(false);
            }
            if (matchSettings.mode === 'adventure') {
              enterAdventureHub();
            } else {
              goToTitleMenu();
            }
          }}
        />
      )}

      {screen === 'battle_win' && battleResult && (
        <BattleWinOverlay
          summary={battleResult}
          onRematch={() => launchRaceWithSettings(matchSettings)}
          onMainMenu={() => goToTitleMenu()}
        />
      )}

      <BossSelectModal
        isOpen={bossModalOpen}
        save={save}
        onClose={() => setBossModalOpen(false)}
        onSelectBoss={(boss) => {
          setBossModalOpen(false);
          setActiveBoss(boss);
          setBossCutsceneOutcome('intro');
          setPendingBossPodium(null);
          setScreen('boss_cutscene');
          engineRef.current?.showBossCutscene(boss, 'intro', playerSetupsRef.current[0]);
        }}
      />

      <RelicModal
        isOpen={relicModalOpen}
        save={save}
        defaultTrackId={matchSettings.trackId}
        onClose={() => setRelicModalOpen(false)}
        onLaunchTimeMode={(mode, trackId) => {
          setRelicModalOpen(false);
          launchRaceWithSettings({
            ...matchSettings,
            mode,
            trackId,
            playerCount: 1,
            useAI: false,
            laps: mode === 'relic' ? 2 : 3,
          });
        }}
      />

      <BattleSetupModal
        isOpen={battleModalOpen}
        save={save}
        onClose={() => setBattleModalOpen(false)}
        onGoToRelic={() => {
          setBattleModalOpen(false);
          setRelicModalOpen(true);
        }}
        onStartBattle={(cfg) => {
          setBattleModalOpen(false);
          const nextBattle: MatchSettings = {
            ...matchSettings,
            mode: 'battle',
            playerCount: cfg.playerCount,
            useAI: cfg.useAI,
            aiCount: cfg.aiCount,
            arenaId: cfg.arenaId,
            battleKillGoal: 5,
          };
          setMatchSettings(nextBattle);
          if (cfg.chooseKartsFirst) {
            openGarage();
          } else {
            launchRaceWithSettings(nextBattle);
          }
        }}
      />

      <OnlineLobbyModal
        isOpen={onlineModalOpen}
        connected={onlineConnected}
        room={onlineRoom}
        playerId={onlinePlayerId}
        openRooms={openRooms}
        errorMessage={onlineError}
        initialJoinCode={initialJoinCode}
        unlockedCharacters={save.unlockedCharacters}
        defaultCharacterId={playerSetups[0].characterId}
        defaultCustomization={playerSetups[0].customization}
        defaultTrackId={matchSettings.trackId}
        defaultLaps={matchSettings.laps}
        onClose={() => setOnlineModalOpen(false)}
        onRefreshRooms={() => onlineClientRef.current?.requestOpenRooms()}
        onCreateRoom={(params) => {
          setOnlineError(null);
          onlineClientRef.current?.createRoom(params);
        }}
        onJoinRoom={(params) => {
          setOnlineError(null);
          onlineClientRef.current?.joinRoom(params);
        }}
        onUpdatePlayer={(params) => onlineClientRef.current?.updatePlayer(params)}
        onUpdateRoomSettings={(params) => onlineClientRef.current?.updateRoomSettings(params)}
        onStartRace={() => onlineClientRef.current?.startRoomRace()}
        onLeaveRoom={() => {
          onlineClientRef.current?.leaveRoom();
          setOnlineRoom(null);
          setOnlinePlayerId(null);
        }}
      />

      <AppDownloadModal
        isOpen={downloadModalOpen}
        unlockedAlready={save.appDownloadedUnlocked}
        onAppDownloaded={handleAppDownloaded}
        onClose={() => setDownloadModalOpen(false)}
      />

      <HighscoreModal
        isOpen={highscoreModalOpen}
        defaultTrackId={matchSettings.trackId}
        playerNickname={save.playerNickname}
        onChangeNickname={(nextName) => handleUpdateSave({ ...save, playerNickname: nextName })}
        onClose={() => setHighscoreModalOpen(false)}
      />

      <ControlsSettingsModal
        isOpen={settingsModal.open}
        initialTab={settingsModal.tab}
        save={save}
        controlConfigs={controlConfigs}
        liveInputs={liveInputs}
        connectedGamepads={connectedGamepads}
        onClose={() => setSettingsModal((s) => ({ ...s, open: false }))}
        onUpdateSave={handleUpdateSave}
        onUpdateControls={handleUpdateControls}
      />

      <LoadingOverlay state={loadingState} />
    </main>
  );
}
