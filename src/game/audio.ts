import type { AudioChannelMode } from './types';

export type MusicTrackKey =
  | 'menu'
  | 'hub'
  | 'tracks_1_10'
  | 'tracks_11_20'
  | 'tracks_21_30'
  | 'boss_jarvin'
  | 'boss_armagedon'
  | 'boss_oxide'
  | 'boss_crash';

const MUSIC_URLS: Record<Exclude<MusicTrackKey, 'boss_crash'>, string> = {
  menu: '/assets/aistudio/03._Title_-_Menu_9a66ed29.mp3',
  hub: '/assets/aistudio/06._N_Sanity_Beach_Map_b0d971dd.mp3',
  tracks_1_10: '/assets/aistudio/16._Crash_Cove_acd19aa7.mp3',
  tracks_11_20: '/assets/aistudio/31._Mystery_Caves_769c9cd2.mp3',
  tracks_21_30: '/assets/aistudio/54._Skull_Rock_06613072.mp3',
  boss_jarvin: '/assets/aistudio/81._Papu_Papu_6d85cb71.mp3',
  boss_armagedon: '/assets/aistudio/134._Cortex_Castle__Church__-_Final_Lap_04eda3b8.mp3',
  boss_oxide: '/assets/aistudio/153._Nitros_Oxide_49f5abb2.mp3',
};

const AKU_AKU_AUDIO_URL = '/assets/aistudio/253._Invincibility___Aku_Aku_17b81a9c.mp3';

// Original procedural D-Phrygian / dark arcade rock boss loop for Crash Bandicoot.exe!
const CRASH_BOSS_BASS_PATTERN = [
  146.83, 146.83, 155.56, 146.83, 174.61, 146.83, 164.81, 155.56,
  146.83, 146.83, 196.0, 146.83, 220.0, 196.0, 174.61, 155.56,
];
const CRASH_BOSS_LEAD_PATTERN = [
  587.33, 0, 622.25, 587.33, 698.46, 0, 622.25, 587.33,
  880.0, 0, 783.99, 698.46, 622.25, 698.46, 783.99, 932.33,
  587.33, 698.46, 880.0, 0, 932.33, 880.0, 783.99, 698.46,
  622.25, 587.33, 523.25, 587.33, 698.46, 622.25, 466.16, 523.25,
];

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineSubOsc: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private volume = 0.65;
  private muted = false;
  private musicEnabled = true;
  private audioMode: AudioChannelMode = 'stereo';
  private lastImpactTime = 0;

  // Music & Aku Aku loop playback state
  private currentMusicTrack: MusicTrackKey | null = null;
  private bgmAudio: HTMLAudioElement | null = null;
  private bgmUrl: string | null = null;
  private akuAkuAudio: HTMLAudioElement | null = null;
  private akuAkuLoopActive = false;
  private crashBossTimer: number | null = null;
  private crashBossStep = 0;
  private unlockBound = false;

  constructor() {
    this.bindAutoplayUnlock();
  }

  private bindAutoplayUnlock(): void {
    if (this.unlockBound || typeof window === 'undefined') return;
    this.unlockBound = true;
    const handleGesture = () => {
      this.ensureContext();
      this.syncMusicPlayback();
    };
    window.addEventListener('pointerdown', handleGesture, { passive: true });
    window.addEventListener('keydown', handleGesture, { passive: true });
    window.addEventListener('touchstart', handleGesture, { passive: true });
  }

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.masterGain) {
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1;
      this.applyChannelConfig();
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private applyChannelConfig(): void {
    if (!this.masterGain) return;
    if (this.audioMode === 'mono') {
      this.masterGain.channelCount = 1;
      this.masterGain.channelCountMode = 'explicit';
      this.masterGain.channelInterpretation = 'speakers';
    } else {
      this.masterGain.channelCount = 2;
      this.masterGain.channelCountMode = 'max';
      this.masterGain.channelInterpretation = 'speakers';
    }
  }

  public setAudioMode(mode: AudioChannelMode): void {
    this.audioMode = mode;
    this.applyChannelConfig();
  }

  public getAudioMode(): AudioChannelMode {
    return this.audioMode;
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    this.applyMusicVolumes();
  }

  public setMusicEnabled(enabled: boolean): void {
    if (this.musicEnabled === enabled) return;
    this.musicEnabled = enabled;
    this.syncMusicPlayback();
  }

  public isMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted && this.engineGain && this.ctx) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
    this.syncMusicPlayback();
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMusicTrack(track: MusicTrackKey | null): void {
    if (this.currentMusicTrack === track) {
      this.syncMusicPlayback();
      return;
    }
    this.currentMusicTrack = track;
    this.syncMusicPlayback();
  }

  public setAkuAkuLoopActive(active: boolean): void {
    if (this.akuAkuLoopActive === active) return;
    this.akuAkuLoopActive = active;
    if (active && this.akuAkuAudio) {
      try {
        this.akuAkuAudio.currentTime = 0;
      } catch {
        // Ignore seek timing if metadata not ready
      }
    }
    this.syncMusicPlayback();
  }

  public getMusicDebugState(): {
    currentTrack: MusicTrackKey | null;
    akuAkuActive: boolean;
    musicEnabled: boolean;
    muted: boolean;
    bgmUrl: string | null;
    crashBossActive: boolean;
  } {
    return {
      currentTrack: this.currentMusicTrack,
      akuAkuActive: this.akuAkuLoopActive,
      musicEnabled: this.musicEnabled,
      muted: this.muted,
      bgmUrl: this.bgmUrl,
      crashBossActive: this.crashBossTimer !== null,
    };
  }

  private applyMusicVolumes(): void {
    const canHear = !this.muted && this.musicEnabled;
    if (this.bgmAudio) {
      this.bgmAudio.volume = Math.max(0, Math.min(1, this.volume * 0.48));
      this.bgmAudio.muted = !canHear;
    }
    if (this.akuAkuAudio) {
      this.akuAkuAudio.volume = Math.max(0, Math.min(1, this.volume * 0.62));
      this.akuAkuAudio.muted = !canHear;
    }
  }

  private syncMusicPlayback(): void {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
    const shouldPlay = !this.muted && this.musicEnabled;

    // 1. Aku Aku invincibility theme overrides background music until timer ends
    if (this.akuAkuLoopActive && shouldPlay) {
      if (this.bgmAudio && !this.bgmAudio.paused) {
        this.bgmAudio.pause();
      }
      this.stopCrashBossSynth();

      if (!this.akuAkuAudio) {
        this.akuAkuAudio = new Audio(AKU_AKU_AUDIO_URL);
        this.akuAkuAudio.loop = true;
        this.akuAkuAudio.preload = 'auto';
      }
      this.applyMusicVolumes();
      if (this.akuAkuAudio.paused) {
        this.akuAkuAudio.play().catch(() => {});
      }
      return;
    }

    if (this.akuAkuAudio && !this.akuAkuAudio.paused) {
      this.akuAkuAudio.pause();
      try {
        this.akuAkuAudio.currentTime = 0;
      } catch {
        // Ignore seek before ready
      }
    }

    if (!shouldPlay || !this.currentMusicTrack) {
      if (this.bgmAudio && !this.bgmAudio.paused) {
        this.bgmAudio.pause();
      }
      this.stopCrashBossSynth();
      return;
    }

    // 2. Crash Bandicoot.exe procedural custom boss song
    if (this.currentMusicTrack === 'boss_crash') {
      if (this.bgmAudio && !this.bgmAudio.paused) {
        this.bgmAudio.pause();
      }
      this.bgmUrl = 'procedural:crash_exe_boss';
      this.startCrashBossSynth();
      return;
    }

    this.stopCrashBossSynth();
    const targetUrl = MUSIC_URLS[this.currentMusicTrack];
    if (!this.bgmAudio) {
      this.bgmAudio = new Audio(targetUrl);
      this.bgmAudio.loop = true;
      this.bgmAudio.preload = 'auto';
      this.bgmUrl = targetUrl;
    } else if (this.bgmUrl !== targetUrl) {
      this.bgmAudio.pause();
      this.bgmAudio.src = targetUrl;
      this.bgmAudio.loop = true;
      try {
        this.bgmAudio.currentTime = 0;
      } catch {
        // Ignore
      }
      this.bgmUrl = targetUrl;
    }

    this.applyMusicVolumes();
    if (this.bgmAudio.paused) {
      this.bgmAudio.play().catch(() => {});
    }
  }

  private startCrashBossSynth(): void {
    if (this.crashBossTimer !== null || typeof window === 'undefined') return;
    this.crashBossStep = 0;
    this.crashBossTimer = window.setInterval(() => {
      if (this.muted || !this.musicEnabled || this.akuAkuLoopActive || this.currentMusicTrack !== 'boss_crash') {
        return;
      }
      const ctx = this.ctx;
      if (!ctx || !this.masterGain || ctx.state !== 'running') return;

      const step = this.crashBossStep++;
      const bassFreq = CRASH_BOSS_BASS_PATTERN[step % CRASH_BOSS_BASS_PATTERN.length];
      const leadFreq = CRASH_BOSS_LEAD_PATTERN[step % CRASH_BOSS_LEAD_PATTERN.length];

      // Driving boss bassline on every 16th step
      this.playTone(bassFreq, 0.11, 'sawtooth', 0.085, bassFreq * 0.96, 520, 0);

      // Fiery boss lead melody
      if (leadFreq > 0) {
        const pan = step % 4 === 0 ? -0.28 : step % 4 === 2 ? 0.28 : 0;
        this.playTone(leadFreq, 0.13, 'square', 0.052, undefined, 2600, pan);
      }

      // Punchy kick on beats 0, 4, 8, 12 and aggressive double kick
      if (step % 4 === 0 || step % 16 === 14) {
        this.playTone(132, 0.1, 'sine', 0.11, 42, 240, 0);
      }
      // Crisp snare accent on beats 2, 6, 10, 14 (steps 4, 12)
      if (step % 8 === 4) {
        this.playTone(220, 0.075, 'triangle', 0.085, 95, 1600, 0);
      }
    }, 105);
  }

  private stopCrashBossSynth(): void {
    if (this.crashBossTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.crashBossTimer);
      this.crashBossTimer = null;
    }
  }

  public updateEngineHum(speedRatio: number, turboActive: boolean, active: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.masterGain || this.muted || !active) {
      if (this.engineGain && ctx) {
        this.engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      }
      return;
    }

    if (!this.engineOsc || !this.engineSubOsc || !this.engineGain || !this.engineFilter) {
      this.engineOsc = ctx.createOscillator();
      this.engineSubOsc = ctx.createOscillator();
      this.engineGain = ctx.createGain();
      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 260;
      this.engineFilter.Q.value = 2.2;
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 52;
      this.engineSubOsc.type = 'triangle';
      this.engineSubOsc.frequency.value = 26;
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineFilter);
      this.engineSubOsc.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);
      this.engineOsc.start();
      this.engineSubOsc.start();
    }

    const rpm = Math.min(1.4, Math.abs(speedRatio));
    const freq = 46 + rpm * 84 + (turboActive ? 34 : 0);
    this.engineOsc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.05);
    this.engineSubOsc.frequency.setTargetAtTime(freq * 0.5, ctx.currentTime, 0.05);
    this.engineFilter.frequency.setTargetAtTime(
      220 + rpm * 440 + (turboActive ? 260 : 0),
      ctx.currentTime,
      0.06,
    );
    this.engineGain.gain.setTargetAtTime((0.032 + rpm * 0.025) * this.volume, ctx.currentTime, 0.08);
  }

  public stopEngine(): void {
    if (this.engineGain && this.ctx) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
  }

  public playTone(
    freq: number,
    duration: number,
    type: OscillatorType = 'triangle',
    gainLevel = 0.14,
    slideToFreq?: number,
    lowpassHz?: number,
    pan = 0,
  ): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideToFreq) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, slideToFreq),
        ctx.currentTime + duration,
      );
    }
    gain.gain.setValueAtTime(gainLevel * this.volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    let lastNode: AudioNode = osc;
    if (lowpassHz) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lowpassHz;
      lastNode.connect(filter);
      lastNode = filter;
    }

    lastNode.connect(gain);

    if (this.audioMode === 'stereo' && Math.abs(pan) > 0.02 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      gain.connect(panner);
      panner.connect(this.masterGain);
    } else {
      gain.connect(this.masterGain);
    }

    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  public playCountdownBeep(isGo: boolean): void {
    this.playTone(isGo ? 880 : 440, isGo ? 0.32 : 0.14, 'triangle', 0.11);
  }

  public playJump(): void {
    this.playTone(230, 0.15, 'sine', 0.13, 520);
  }

  public playTurbo(): void {
    this.playTone(190, 0.34, 'triangle', 0.13, 680, 900);
  }

  public playAntigravZap(): void {
    this.playTone(320, 0.2, 'sine', 0.11, 780, 1400);
  }

  public playItemPickup(): void {
    this.playTone(523, 0.08, 'triangle', 0.13);
    setTimeout(() => this.playTone(784, 0.12, 'triangle', 0.13), 70);
  }

  public playWumpaPickup(isJuicedMax: boolean): void {
    this.playTone(587.33, 0.08, 'sine', 0.14);
    setTimeout(() => this.playTone(783.99, 0.1, 'sine', 0.14), 60);
    if (isJuicedMax) {
      setTimeout(() => this.playTone(1046.5, 0.18, 'triangle', 0.15), 120);
    }
  }

  public playAkuAku(): void {
    this.playTone(260, 0.11, 'sine', 0.15, 340);
    setTimeout(() => this.playTone(392, 0.13, 'sine', 0.15, 480), 95);
    setTimeout(() => this.playTone(587, 0.18, 'triangle', 0.14), 190);
  }

  public playRocketLaunch(pan = 0): void {
    this.playTone(320, 0.25, 'triangle', 0.13, 760, 1100, pan);
  }

  public playExplosion(pan = 0): void {
    this.playTone(145, 0.28, 'sawtooth', 0.15, 38, 360, pan);
  }

  public playImpact(pan = 0): void {
    const now = performance.now();
    if (now - this.lastImpactTime < 340) return;
    this.lastImpactTime = now;
    this.playTone(115, 0.11, 'sine', 0.12, 46, 260, pan);
  }

  public playVictoryFanfare(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      setTimeout(() => this.playTone(n, 0.25, 'triangle', 0.15), idx * 110);
    });
  }

  public playTimeClock(): void {
    this.playTone(880, 0.14, 'sine', 0.14, 340);
    setTimeout(() => this.playTone(620, 0.22, 'triangle', 0.13, 210), 110);
  }

  public playTokenCollect(): void {
    this.playTone(660, 0.1, 'triangle', 0.15);
    setTimeout(() => this.playTone(880, 0.12, 'triangle', 0.15), 80);
    setTimeout(() => this.playTone(1174, 0.18, 'triangle', 0.15), 160);
  }

  public playEliminationKO(): void {
    this.playTone(190, 0.35, 'sawtooth', 0.16, 48, 420);
  }

  public destroy(): void {
    this.stopCrashBossSynth();
    this.stopEngine();
    if (this.bgmAudio) {
      this.bgmAudio.pause();
      this.bgmAudio.src = '';
    }
    if (this.akuAkuAudio) {
      this.akuAkuAudio.pause();
      this.akuAkuAudio.src = '';
    }
  }
}
