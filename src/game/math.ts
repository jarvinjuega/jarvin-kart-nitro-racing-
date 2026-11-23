import * as THREE from 'three';
import type {
  BattleArenaConfig,
  GameMode,
  KartIdleAnimation,
  KartPhysicsState,
  LiveInputSnapshot,
  PowerUpType,
  TrackConfig,
} from './types';
import { CHARACTER_MAP } from './constants';

export interface TrackSample {
  t: number;
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  aiOffset: number;
}

export interface CompiledTrack {
  config: TrackConfig;
  curve: THREE.CatmullRomCurve3;
  samples: TrackSample[];
  totalLength: number;
}

const _up = new THREE.Vector3(0, 1, 0);

export function compileTrack(config: TrackConfig, sampleCount = 360): CompiledTrack {
  const vectors = config.controlPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const curve = new THREE.CatmullRomCurve3(vectors, true, 'catmullrom', 0.5);
  const totalLength = curve.getLength();
  const samples: TrackSample[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleCount;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const right = new THREE.Vector3().crossVectors(tangent, _up).normalize();
    samples.push({ t, point, tangent, right, aiOffset: 0 });
  }

  // Generate optimal smooth AI racing path (apexes + boost pads)
  const halfRoad = config.roadWidth * 0.5 - 2.6;
  const rawOffsets = new Array<number>(sampleCount).fill(0);
  for (let i = 0; i < sampleCount; i++) {
    const prev = samples[(i - 5 + sampleCount) % sampleCount];
    const next = samples[(i + 9) % sampleCount];
    const h1 = Math.atan2(prev.tangent.x, prev.tangent.z);
    const h2 = Math.atan2(next.tangent.x, next.tangent.z);
    const curveAngle = shortestAngleDelta(h1, h2);
    let off = 0;
    if (Math.abs(curveAngle) > 0.12) {
      off = -Math.sign(curveAngle) * Math.min(halfRoad * 0.65, Math.abs(curveAngle) * 4.5);
    }

    const tCurr = samples[i].t;
    for (const pad of config.boostPads) {
      const distT = Math.abs(wrapT(pad.t - tCurr + 0.5) - 0.5);
      if (distT < 0.035) {
        const blend = 1 - distT / 0.035;
        off = THREE.MathUtils.lerp(off, pad.lateralOffset, blend);
      }
    }
    rawOffsets[i] = THREE.MathUtils.clamp(off, -halfRoad, halfRoad);
  }

  // Multi-pass circular smoothing for clean continuous AI path
  let smoothed = rawOffsets;
  for (let pass = 0; pass < 4; pass++) {
    const nextArr = new Array<number>(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      const a = smoothed[(i - 1 + sampleCount) % sampleCount];
      const b = smoothed[i];
      const c = smoothed[(i + 1) % sampleCount];
      nextArr[i] = (a + 2 * b + c) * 0.25;
    }
    smoothed = nextArr;
  }
  for (let i = 0; i < sampleCount; i++) {
    samples[i].aiOffset = smoothed[i];
  }

  return { config, curve, samples, totalLength };
}

export function wrapT(t: number): number {
  const mod = t % 1;
  return mod < 0 ? mod + 1 : mod;
}

export function findNearestTrackSample(
  track: CompiledTrack,
  x: number,
  z: number,
  hintT?: number,
): {
  sample: TrackSample;
  lateralOffset: number;
  distSq: number;
  t: number;
} {
  const samples = track.samples;
  const n = samples.length;
  let bestIdx = 0;
  let bestDistSq = Infinity;

  if (typeof hintT === 'number') {
    const centerIdx = Math.floor(wrapT(hintT) * n);
    const windowRadius = Math.floor(n * 0.12);
    for (let offset = -windowRadius; offset <= windowRadius; offset++) {
      const idx = (centerIdx + offset + n) % n;
      const s = samples[idx];
      const dx = x - s.point.x;
      const dz = z - s.point.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestIdx = idx;
      }
    }
  }

  if (bestDistSq > 45 * 45 || typeof hintT !== 'number') {
    bestDistSq = Infinity;
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      const dx = x - s.point.x;
      const dz = z - s.point.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestIdx = i;
      }
    }
  }

  const sample = samples[bestIdx];
  const dx = x - sample.point.x;
  const dz = z - sample.point.z;
  const lateralOffset = dx * sample.right.x + dz * sample.right.z;

  return {
    sample,
    lateralOffset,
    distSq: bestDistSq,
    t: sample.t,
  };
}

export function getActiveAntigravityZone(track: CompiledTrack, t: number) {
  const zones = track.config.antigravityZones;
  if (!zones || zones.length === 0) return null;
  const wrapped = wrapT(t);
  for (const z of zones) {
    if (z.tStart <= z.tEnd) {
      if (wrapped >= z.tStart && wrapped <= z.tEnd) return z;
    } else if (wrapped >= z.tStart || wrapped <= z.tEnd) {
      return z;
    }
  }
  return null;
}

export function getShortcutSpan(track: CompiledTrack, t: number) {
  const shortcuts = track.config.shortcuts;
  if (!shortcuts || shortcuts.length === 0) return null;
  const wrapped = wrapT(t);
  for (const sc of shortcuts) {
    const inWin =
      sc.tStart <= sc.tEnd
        ? wrapped >= sc.tStart && wrapped <= sc.tEnd
        : wrapped >= sc.tStart || wrapped <= sc.tEnd;
    if (inWin) return sc;
  }
  return null;
}

export function getAbyssGapSpan(track: CompiledTrack, t: number) {
  const gaps = track.config.abyssGaps;
  if (!gaps || gaps.length === 0) return null;
  const wrapped = wrapT(t);
  for (const g of gaps) {
    const inWin =
      g.tStart <= g.tEnd
        ? wrapped >= g.tStart && wrapped <= g.tEnd
        : wrapped >= g.tStart || wrapped <= g.tEnd;
    if (inWin) return g;
  }
  return null;
}

export function evaluateSurfaceHeight(
  track: CompiledTrack,
  t: number,
  baseY: number,
  lateralOffset = 0,
): { height: number; slopePitch: number; onRamp: boolean; onShortcut: boolean } {
  let extraHeight = 0;
  let slopePitch = 0;
  let onRamp = false;
  let onShortcut = false;

  const sc = getShortcutSpan(track, t);
  if (sc && Math.abs(lateralOffset - sc.lateralCenter) <= sc.halfWidth + 1.2) {
    const span = Math.max(0.01, wrapT(sc.tEnd - sc.tStart));
    const u = THREE.MathUtils.clamp(wrapT(t - sc.tStart) / span, 0, 1);
    const smoothArch = Math.sin(u * Math.PI);
    extraHeight = Math.max(extraHeight, (sc.heightOffset ?? 0.5) * smoothArch);
    onShortcut = true;
  }

  for (const ramp of track.config.ramps) {
    const start = ramp.t;
    const rel = wrapT(t - start);
    if (rel >= 0 && rel <= ramp.length) {
      const rampLat = ramp.lateralOffset ?? 0;
      const rampHalfW = (ramp.width ?? track.config.roadWidth * 0.45) * 0.5;
      if (Math.abs(lateralOffset - rampLat) <= rampHalfW + 0.85) {
        const u = rel / ramp.length;
        extraHeight = Math.max(extraHeight, u * ramp.height);
        const rampLen = Math.max(4, ramp.length * track.totalLength);
        // Negative X rotation lifts kart nose (+Z) upward (+Y) to align with the ramp incline
        slopePitch = -Math.atan2(ramp.height, rampLen);
        onRamp = true;
      }
    }
  }

  return { height: baseY + extraHeight, slopePitch, onRamp, onShortcut };
}

export function shortestAngleDelta(from: number, to: number): number {
  let diff = (to - from + Math.PI) % (Math.PI * 2);
  if (diff < 0) diff += Math.PI * 2;
  return diff - Math.PI;
}

/**
 * Impact hit: 2-second flame burn + stops the kart for 2 seconds before getting back up!
 */
export function applyKartBurnHit(
  kart: KartPhysicsState,
  slowSeconds = 0,
): boolean {
  if (kart.shieldTimer > 0 || kart.akuAkuTimer > 0) {
    return false;
  }
  kart.burnTimer = Math.max(kart.burnTimer, 2.0);
  kart.stunTimer = Math.max(kart.stunTimer, 2.0);
  kart.hurtTimer = Math.max(kart.hurtTimer, 2.0);
  kart.turboActiveTimer = 0;
  kart.drifting = false;
  kart.driftCharge = 0;
  if (slowSeconds > 0) {
    kart.slowTimer = Math.max(kart.slowTimer, slowSeconds);
  }
  kart.vy = Math.max(kart.vy, 5.8);
  kart.grounded = false;
  kart.speed = 0;
  kart.vx = 0;
  kart.vz = 0;
  return true;
}

/**
 * Potion hit: makes kart slippery & low-grip for 5 seconds!
 */
export function applyKartSlipperyHit(
  kart: KartPhysicsState,
  durationSeconds = 5.0,
): boolean {
  if (kart.shieldTimer > 0 || kart.akuAkuTimer > 0) {
    return false;
  }
  kart.slipperyTimer = Math.max(kart.slipperyTimer, durationSeconds);
  kart.hurtTimer = Math.max(kart.hurtTimer, 1.0);
  return true;
}

export function computeAiControlInput(
  kart: KartPhysicsState,
  track: CompiledTrack,
  _difficulty: 'normal' | 'hard' = 'normal',
  dt: number,
  karts: KartPhysicsState[] = [],
  heavyPowerSpam = false,
): LiveInputSnapshot {
  kart.aiReactionTimer -= dt;
  kart.aiItemCooldown = Math.max(0, kart.aiItemCooldown - dt);

  const n = track.samples.length;
  const halfRoad = track.config.roadWidth * 0.5 - 2.3;

  const currSmp = track.samples[Math.floor(wrapT(kart.nearestT) * n) % n];
  const currTangentHeading = Math.atan2(currSmp.tangent.x, currSmp.tangent.z);
  const wrongWayAngle = Math.abs(shortestAngleDelta(kart.heading, currTangentHeading));

  const lookAheadDist = wrongWayAngle > 0.9 ? 0.018 : 0.026;
  const targetT = wrapT(kart.nearestT + lookAheadDist);
  const targetSmp = track.samples[Math.floor(targetT * n) % n];

  let goalOffset = targetSmp.aiOffset;
  const laneSlot = ((kart.id.charCodeAt(kart.id.length - 1) % 3) - 1) * 1.6;
  goalOffset += laneSlot * 0.5;

  // Seek Item Boxes if not holding an item
  if (!kart.heldItem) {
    for (const loc of track.config.itemBoxLocations) {
      const dtAhead = wrapT(loc.t - kart.nearestT);
      if (dtAhead > 0.002 && dtAhead < 0.05) {
        const curLat =
          (kart.x - currSmp.point.x) * currSmp.right.x +
          (kart.z - currSmp.point.z) * currSmp.right.z;
        let bestOff = goalOffset;
        let bestD = Infinity;
        for (const off of loc.offsets) {
          const d = Math.abs(off - curLat);
          if (d < bestD) {
            bestD = d;
            bestOff = off;
          }
        }
        goalOffset = bestOff;
        break;
      }
    }
  }

  // Pursue nearby opponent with Aku Aku / Shockwave
  let chasingTarget = false;
  if (kart.akuAkuTimer > 0 || kart.heldItem === 'aku_aku' || kart.heldItem === 'shockwave') {
    let closestAhead: KartPhysicsState | null = null;
    let minD2 = 20 * 20;
    for (const other of karts) {
      if (other.id === kart.id || other.finished) continue;
      const dtAhead = wrapT(other.nearestT - kart.nearestT);
      if (dtAhead > 0.001 && dtAhead < 0.05) {
        const d2 = (other.x - kart.x) ** 2 + (other.z - kart.z) ** 2;
        if (d2 < minD2) {
          minD2 = d2;
          closestAhead = other;
        }
      }
    }
    if (closestAhead) {
      const targetLat =
        (closestAhead.x - targetSmp.point.x) * targetSmp.right.x +
        (closestAhead.z - targetSmp.point.z) * targetSmp.right.z;
      goalOffset = targetLat;
      chasingTarget = true;
    }
  }

  // Overtaking
  if (!chasingTarget) {
    for (const other of karts) {
      if (other.id === kart.id || other.finished) continue;
      const dtAhead = wrapT(other.nearestT - kart.nearestT);
      if (dtAhead > 0.001 && dtAhead < 0.03) {
        const dx = other.x - kart.x;
        const dz = other.z - kart.z;
        if (dx * dx + dz * dz < 14 * 14) {
          const otherLat =
            (other.x - targetSmp.point.x) * targetSmp.right.x +
            (other.z - targetSmp.point.z) * targetSmp.right.z;
          if (Math.abs(otherLat - goalOffset) < 3.4) {
            goalOffset = otherLat >= 0 ? -Math.min(halfRoad, 5.2) : Math.min(halfRoad, 5.2);
          }
        }
      }
    }
  }

  goalOffset = THREE.MathUtils.clamp(goalOffset, -halfRoad, halfRoad);
  kart.aiTargetOffset = THREE.MathUtils.damp(kart.aiTargetOffset, goalOffset, 5.5, dt);

  const targetX = targetSmp.point.x + targetSmp.right.x * kart.aiTargetOffset;
  const targetZ = targetSmp.point.z + targetSmp.right.z * kart.aiTargetOffset;

  const desiredHeading = Math.atan2(targetX - kart.x, targetZ - kart.z);
  const angleErr = shortestAngleDelta(kart.heading, desiredHeading);
  const steer = THREE.MathUtils.clamp(-angleErr * 2.25, -1, 1);

  const shouldTurbo =
    kart.infiniteTurbo ||
    (kart.turboEnergy > 64 && Math.abs(angleErr) < 0.25 && kart.speed > 14);

  // Jump at ramp crest OR jump to shake off TNT crate!
  let jumpJustPressed = false;
  if (kart.tntTimer > 0 && kart.grounded && kart.aiReactionTimer <= 0) {
    jumpJustPressed = true;
  } else if (kart.grounded && kart.speed > 16) {
    for (const ramp of track.config.ramps) {
      const end = ramp.t + ramp.length;
      const dtEnd = wrapT(end - kart.nearestT);
      if (dtEnd < 0.004) {
        jumpJustPressed = true;
        break;
      }
    }
  }

  // Strictly close-range tactical AI attacks — NEVER snipe players from far away!
  let itemJustPressed = false;
  if (kart.heldItem && kart.aiItemCooldown <= 0) {
    const item = kart.heldItem;
    if (item === 'turbo_boost' || item === 'shield') {
      itemJustPressed = true;
    } else if (item === 'tnt' || item === 'potion') {
      const rivalBehind = karts.some((o) => {
        if (o.id === kart.id || o.finished) return false;
        const dtBehind = wrapT(kart.nearestT - o.nearestT);
        const d2 = (o.x - kart.x) ** 2 + (o.z - kart.z) ** 2;
        return dtBehind > 0.001 && dtBehind < 0.08 && d2 < 26 * 26;
      });
      if (rivalBehind) {
        itemJustPressed = true;
      }
    } else if (item === 'aku_aku' || item === 'shockwave') {
      const nearRival = karts.some(
        (o) =>
          o.id !== kart.id &&
          !o.finished &&
          (o.x - kart.x) ** 2 + (o.z - kart.z) ** 2 < 18 * 18,
      );
      if (nearRival) {
        itemJustPressed = true;
      }
    } else if (item === 'homing_rocket' || item === 'bowling_bomb') {
      const targetAhead = karts.some((o) => {
        if (o.id === kart.id || o.finished || o.eliminated) return false;
        const d2 = (o.x - kart.x) ** 2 + (o.z - kart.z) ** 2;
        if (d2 > 38 * 38) return false;
        const hTo = Math.atan2(o.x - kart.x, o.z - kart.z);
        return Math.abs(shortestAngleDelta(kart.heading, hTo)) < 0.55;
      });
      if (targetAhead) {
        itemJustPressed = true;
      }
    } else if (item === 'warp_orb' || item === 'time_clock') {
      if (kart.rank > 1) {
        itemJustPressed = true;
      }
    } else if (item === 'bolt') {
      const closeTarget =
        kart.rank > 1 &&
        karts.some(
          (o) =>
            o.id !== kart.id &&
            !o.finished &&
            !o.eliminated &&
            (o.x - kart.x) ** 2 + (o.z - kart.z) ** 2 < 42 * 42,
        );
      if (closeTarget) {
        itemJustPressed = true;
      }
    }

    if (itemJustPressed) {
      kart.aiItemCooldown = heavyPowerSpam ? 2.2 : 4.2;
    }
  }

  if (kart.aiReactionTimer <= 0) {
    kart.aiReactionTimer = heavyPowerSpam ? 0.55 + Math.random() * 0.4 : 0.85 + Math.random() * 0.6;
  }

  return {
    accelerate: true,
    brake: Math.abs(angleErr) > 1.55 && kart.speed > 20,
    steer,
    turbo: shouldTurbo,
    jumpJustPressed,
    itemJustPressed,
    pauseJustPressed: false,
    rawPressedKeys: [],
    rawGamepadButtons: [],
    rawGamepadAxes: [],
    activeDeviceLabel: 'IA',
  };
}

export interface PhysicsStepEvents {
  jumped: boolean;
  landed: boolean;
  turboStarted: boolean;
  boostPadHit: boolean;
  itemUsed: PowerUpType;
  itemJuiced?: boolean;
  wallHit: boolean;
  lapCompleted: boolean;
  tntShakenOff: boolean;
  tntExploded: boolean;
  fallRespawn?: boolean;
}

export function getTrackWumpaBoxLocations(
  config: TrackConfig,
): Array<{ t: number; offsets: number[] }> {
  if (config.wumpaBoxLocations && config.wumpaBoxLocations.length > 0) {
    return config.wumpaBoxLocations;
  }
  const lat = Math.min(6.2, Math.max(3.6, config.roadWidth * 0.22));
  return [
    { t: 0.06, offsets: [-lat, lat] },
    { t: 0.21, offsets: [0] },
    { t: 0.36, offsets: [-lat, lat] },
    { t: 0.53, offsets: [0] },
    { t: 0.70, offsets: [-lat, lat] },
    { t: 0.86, offsets: [0] },
  ];
}

export function collectWumpaBox(kart: KartPhysicsState): number {
  const next = Math.min(10, (kart.wumpas ?? 0) + 5);
  kart.wumpas = next;
  return next;
}

const IDLE_ANIMS: KartIdleAnimation[] = ['sleep', 'butterfly', 'bored', 'angry', 'phone'];

export function updateKartIdleState(
  kart: KartPhysicsState,
  input: LiveInputSnapshot,
  dt: number,
): void {
  const hasInput =
    input.accelerate ||
    input.brake ||
    Math.abs(input.steer) > 0.08 ||
    input.turbo ||
    input.jumpJustPressed ||
    input.itemJustPressed;
  const isAffected =
    kart.stunTimer > 0 ||
    kart.burnTimer > 0 ||
    kart.slipperyTimer > 0 ||
    kart.tntTimer > 0 ||
    !kart.grounded;

  if (!kart.isPlayer || hasInput || isAffected || Math.abs(kart.speed) > 1.8) {
    kart.idleWaitTimer = 0;
    kart.idleAnim = 'none';
    kart.idleAnimTimer = 0;
    return;
  }

  if (kart.idleAnim === 'none') {
    kart.idleWaitTimer += dt;
    if (kart.idleWaitTimer >= 10.0) {
      kart.idleAnim = IDLE_ANIMS[Math.floor(Math.random() * IDLE_ANIMS.length)];
      kart.idleAnimTimer = 0;
      kart.idleWaitTimer = 0;
    }
  } else {
    kart.idleAnimTimer += dt;
    if (kart.idleAnim === 'sleep' && kart.idleAnimTimer >= 6.4) {
      kart.idleAnim = 'none';
      kart.idleAnimTimer = 0;
      kart.idleWaitTimer = 0;
    }
  }
}

export function resolveIdleExpression(anim: KartIdleAnimation, animTimer: number): KartPhysicsState['expression'] {
  if (anim === 'sleep') {
    if (animTimer < 5.0) return 'sleep';
    if (animTimer < 5.8) return 'scared';
    return 'normal';
  }
  if (anim === 'butterfly') {
    if (animTimer < 1.6) return 'normal';
    if (animTimer < 4.2) return 'win';
    if (animTimer < 5.6) return 'scared';
    return 'serious';
  }
  if (anim === 'bored') return 'bored';
  if (anim === 'angry') return 'angry';
  if (anim === 'phone') return 'phone';
  return 'normal';
}

function updateKartExpression(kart: KartPhysicsState): void {
  if (kart.hurtTimer > 0 || kart.burnTimer > 0 || kart.stunTimer > 0 || kart.tntTimer > 0) {
    kart.expression = kart.tntTimer > 0 || kart.hurtTimer > 0.45 ? 'dizzy' : 'hurt';
  } else if (kart.slipperyTimer > 0) {
    kart.expression = 'dizzy';
  } else if (kart.laughTimer > 0) {
    kart.expression = 'laughing';
  } else if (kart.turboActiveTimer > 0) {
    kart.expression = 'turbo';
  } else if (kart.idleAnim !== 'none') {
    kart.expression = resolveIdleExpression(kart.idleAnim, kart.idleAnimTimer);
  } else {
    kart.expression = 'normal';
  }
}

export function stepKartPhysics(
  kart: KartPhysicsState,
  input: LiveInputSnapshot,
  track: CompiledTrack,
  totalLaps: number,
  raceTimeMs: number,
  dt: number,
  _difficulty: 'normal' | 'hard' = 'normal',
  paceMultiplier = 1,
  mode: GameMode = 'arcade',
): PhysicsStepEvents {
  const events: PhysicsStepEvents = {
    jumped: false,
    landed: false,
    turboStarted: false,
    boostPadHit: false,
    itemUsed: null,
    wallHit: false,
    lapCompleted: false,
    tntShakenOff: false,
    tntExploded: false,
    fallRespawn: false,
  };

  if (kart.eliminated) {
    kart.speed = 0;
    kart.vx = 0;
    kart.vz = 0;
    kart.vy = 0;
    kart.turboActiveTimer = 0;
    return events;
  }

  const charStats = CHARACTER_MAP[kart.characterId].stats;
  const madnessFactor = mode === 'madness' ? 1.32 : 1.0;
  const aiMultiplier = (kart.isPlayer ? 1 : 0.85 * paceMultiplier) * madnessFactor;

  const antigravZone = getActiveAntigravityZone(track, kart.nearestT);
  kart.inAntigravity = Boolean(antigravZone);

  const antigravSpeedBonus = antigravZone ? 1.12 : 1.0;
  const baseMaxSpeed = (24.5 + charStats.topSpeed * 0.72) * aiMultiplier * antigravSpeedBonus;
  const accelRate = (17.5 + charStats.acceleration * 0.85) * aiMultiplier * (antigravZone ? 1.1 : 1.0);
  const turnAgility = (2.15 + charStats.handling * 0.095) * (antigravZone ? 1.16 : 1.0);
  const turboGainRate = 12 + charStats.turbo * 0.95;

  // Timers
  kart.shieldTimer = Math.max(0, kart.shieldTimer - dt);
  kart.akuAkuTimer = Math.max(0, kart.akuAkuTimer - dt);
  kart.stunTimer = Math.max(0, kart.stunTimer - dt);
  kart.burnTimer = Math.max(0, kart.burnTimer - dt);
  kart.slowTimer = Math.max(0, kart.slowTimer - dt);
  kart.slipperyTimer = Math.max(0, kart.slipperyTimer - dt);
  kart.timeSlowTimer = Math.max(0, (kart.timeSlowTimer ?? 0) - dt);
  kart.fallRespawnTimer = Math.max(0, (kart.fallRespawnTimer ?? 0) - dt);
  kart.laughTimer = Math.max(0, kart.laughTimer - dt);
  kart.hurtTimer = Math.max(0, kart.hurtTimer - dt);
  kart.boostPadCooldown = Math.max(0, kart.boostPadCooldown - dt);
  kart.jumpSquash = THREE.MathUtils.damp(kart.jumpSquash, 1, 12, dt);

  updateKartIdleState(kart, input, dt);

  // TNT Countdown above kart! Jumping 2 times shakes it off; otherwise 3s -> EXPLOSION + 3s SLOW!
  if (kart.tntTimer > 0) {
    if (input.jumpJustPressed) {
      kart.tntShakeJumps += 1;
      if (kart.tntShakeJumps >= 2) {
        kart.tntTimer = 0;
        kart.tntShakeJumps = 0;
        events.tntShakenOff = true;
      }
    }
    if (kart.tntTimer > 0) {
      kart.tntTimer = Math.max(0, kart.tntTimer - dt);
      if (kart.tntTimer <= 0) {
        kart.tntShakeJumps = 0;
        applyKartBurnHit(kart, 3.0);
        events.tntExploded = true;
      }
    }
  }

  // Turbo activation (with infiniteTurbo + antigravity magnetic recharge!)
  const wasTurbo = kart.turboActiveTimer > 0;
  if (antigravZone && !input.turbo) {
    kart.turboEnergy = Math.min(100, kart.turboEnergy + 18 * dt);
  }
  if (kart.infiniteTurbo) {
    kart.turboEnergy = 100;
    kart.turboActiveTimer = Math.max(kart.turboActiveTimer, 0.25);
    if (!wasTurbo) events.turboStarted = true;
  } else if (input.turbo && kart.turboEnergy >= 18) {
    if (!wasTurbo) {
      events.turboStarted = true;
    }
    kart.turboActiveTimer = Math.max(kart.turboActiveTimer, 0.24);
    kart.turboEnergy = Math.max(0, kart.turboEnergy - 28 * dt);
  } else {
    kart.turboActiveTimer = Math.max(0, kart.turboActiveTimer - dt);
    if (!input.turbo) {
      kart.turboEnergy = Math.min(100, kart.turboEnergy + turboGainRate * 0.42 * dt);
    }
  }

  // Item trigger (never blocked by burnTimer! In Modo Locura, throwing instantly reloads another power!)
  if (input.itemJustPressed && kart.heldItem) {
    const juiced = (kart.wumpas ?? 0) >= 10;
    events.itemUsed = kart.heldItem;
    events.itemJuiced = juiced;
    kart.laughTimer = 1.35;
    if (kart.heldItem === 'turbo_boost') {
      kart.turboEnergy = 100;
      kart.turboActiveTimer = juiced ? 3.8 : 2.6;
      kart.speed = Math.max(kart.speed, baseMaxSpeed * (juiced ? 1.44 : 1.28));
      events.turboStarted = true;
    } else if (kart.heldItem === 'shield') {
      kart.shieldTimer = juiced ? 11.0 : 7.0;
    } else if (kart.heldItem === 'aku_aku') {
      kart.akuAkuTimer = juiced ? 20.0 : 10.0;
      kart.turboActiveTimer = Math.max(kart.turboActiveTimer, juiced ? 2.6 : 1.8);
      events.turboStarted = true;
    }
    kart.heldItem = mode === 'madness' ? getRandomPowerUp(kart.rank, 15, 'madness') : null;
  }

  // Steering & 3-Stage CTR Drift-Boost feel (or Slippery 5s potion slide / 2s stun stop)
  const isStunned = kart.stunTimer > 0;
  const isSlippery = kart.slipperyTimer > 0;
  const slipSway = isSlippery ? Math.sin(kart.slipperyTimer * 7.5) * 0.56 : 0;
  const targetSteer = isStunned ? 0 : THREE.MathUtils.clamp(-input.steer + slipSway, -1.25, 1.25);
  kart.steerAngle = THREE.MathUtils.damp(kart.steerAngle, targetSteer, isSlippery ? 6 : 14, dt);

  const speedNorm = Math.min(1, Math.abs(kart.speed) / 14);
  const reverseFlip = kart.speed < -1 ? -1 : 1;
  const isSharpTurn = !isStunned && Math.abs(targetSteer) > 0.58 && kart.speed > 15 && kart.grounded;

  if (isSharpTurn) {
    kart.drifting = true;
    kart.driftDir = Math.sign(targetSteer);
    kart.driftCharge += dt;
    kart.turboEnergy = Math.min(100, kart.turboEnergy + 20 * dt);
  } else {
    if (kart.drifting && kart.driftCharge > 0.25 && !isStunned) {
      const boostDur = kart.driftCharge > 1.1 ? 1.5 : kart.driftCharge > 0.65 ? 1.05 : 0.65;
      const bonusEnergy = kart.driftCharge > 1.1 ? 26 : kart.driftCharge > 0.65 ? 16 : 8;
      kart.turboActiveTimer = Math.max(kart.turboActiveTimer, boostDur);
      kart.turboEnergy = Math.min(100, kart.turboEnergy + bonusEnergy);
      events.turboStarted = true;
    }
    kart.drifting = false;
    kart.driftCharge = 0;
  }

  const driftTurnBonus = kart.drifting ? 1.26 : isSlippery ? 1.45 : 1.0;
  if (!isStunned) {
    kart.heading += kart.steerAngle * turnAgility * driftTurnBonus * speedNorm * reverseFlip * dt;
  }

  // Acceleration / Braking
  const akuBoost = kart.akuAkuTimer > 0 ? 1.16 : 1.0;
  const timeSlowFactor = (kart.timeSlowTimer ?? 0) > 0 ? 0.56 : 1.0;
  const slowFactor = (kart.slowTimer > 0 ? 0.62 : isSlippery ? 0.85 : 1.0) * timeSlowFactor;
  const maxSpeed = (kart.turboActiveTimer > 0 ? baseMaxSpeed * 1.3 : baseMaxSpeed) * akuBoost * slowFactor;

  if (isStunned) {
    kart.speed = 0;
    kart.turboActiveTimer = 0;
  } else if (input.accelerate) {
    const boostAccel = kart.turboActiveTimer > 0 ? accelRate * 1.5 : accelRate;
    kart.speed += boostAccel * slowFactor * dt;
  } else if (input.brake) {
    if (kart.speed > 2) {
      kart.speed -= accelRate * 1.9 * dt;
    } else {
      kart.speed -= accelRate * 0.75 * dt;
    }
  } else {
    kart.speed *= Math.exp((isSlippery ? -0.9 : -1.9) * dt);
  }

  kart.speed = isStunned ? 0 : THREE.MathUtils.clamp(kart.speed, -baseMaxSpeed * 0.35, maxSpeed);

  // Jump physics (L1 or R1 or Space)
  if (!isStunned && input.jumpJustPressed && kart.grounded) {
    kart.vy = 10.6;
    kart.grounded = false;
    kart.jumpSquash = 1.2;
    events.jumped = true;
  }

  const prevNearest = findNearestTrackSample(track, kart.x, kart.z, kart.nearestT);
  const prevSurf = evaluateSurfaceHeight(
    track,
    prevNearest.t,
    prevNearest.sample.point.y,
    prevNearest.lateralOffset,
  );

  const forwardX = Math.sin(kart.heading);
  const forwardZ = Math.cos(kart.heading);
  kart.vx = forwardX * kart.speed;
  kart.vz = forwardZ * kart.speed;

  kart.x += kart.vx * dt;
  kart.z += kart.vz * dt;

  // Track surface, shortcuts & strict guardrail wall boundaries
  const nextNearest = findNearestTrackSample(track, kart.x, kart.z, prevNearest.t);
  const halfRoad = track.config.roadWidth * 0.5 - 1.25;
  const sc = getShortcutSpan(track, nextNearest.t);
  let minAllowedLat = -halfRoad;
  let maxAllowedLat = halfRoad;
  if (sc) {
    minAllowedLat = Math.min(-halfRoad, sc.lateralCenter - sc.halfWidth + 1.0);
    maxAllowedLat = Math.max(halfRoad, sc.lateralCenter + sc.halfWidth - 1.0);
  }

  if (nextNearest.lateralOffset < minAllowedLat) {
    const excess = minAllowedLat - nextNearest.lateralOffset;
    kart.x += nextNearest.sample.right.x * excess;
    kart.z += nextNearest.sample.right.z * excess;
    if (kart.speed > 14) events.wallHit = true;
    kart.speed *= 0.88;
  } else if (nextNearest.lateralOffset > maxAllowedLat) {
    const excess = nextNearest.lateralOffset - maxAllowedLat;
    kart.x -= nextNearest.sample.right.x * excess;
    kart.z -= nextNearest.sample.right.z * excess;
    if (kart.speed > 14) events.wallHit = true;
    kart.speed *= 0.88;
  }

  const clampedLat = THREE.MathUtils.clamp(nextNearest.lateralOffset, minAllowedLat, maxAllowedLat);
  const nextSurf = evaluateSurfaceHeight(track, nextNearest.t, nextNearest.sample.point.y, clampedLat);
  const abyssGap = getAbyssGapSpan(track, nextNearest.t);
  const overAbyss = Boolean(abyssGap && !nextSurf.onShortcut && !nextSurf.onRamp);

  if (prevSurf.onRamp && !nextSurf.onRamp && kart.grounded && kart.speed > 14) {
    kart.vy = Math.max(kart.vy, 12.2 + (kart.speed / baseMaxSpeed) * 4.8);
    kart.grounded = false;
    events.jumped = true;
  }

  const gravity = antigravZone ? 23 : 28;
  kart.vy -= gravity * dt;
  kart.y += kart.vy * dt;

  if (overAbyss) {
    kart.grounded = false;
    if (kart.y < nextNearest.sample.point.y - 7.5 && abyssGap) {
      const safeT = wrapT(abyssGap.tEnd + 0.01);
      const safeSample = track.samples[Math.floor(safeT * track.samples.length) % track.samples.length];
      kart.x = safeSample.point.x;
      kart.y = safeSample.point.y + 2.2;
      kart.z = safeSample.point.z;
      kart.heading = Math.atan2(safeSample.tangent.x, safeSample.tangent.z);
      kart.vy = 0;
      kart.speed = Math.max(10, baseMaxSpeed * 0.45);
      kart.fallRespawnTimer = 1.4;
      kart.hurtTimer = Math.max(kart.hurtTimer, 1.0);
      events.fallRespawn = true;
    }
  } else if (kart.y <= nextSurf.height) {
    if (!kart.grounded && kart.vy < -5) {
      events.landed = true;
      kart.jumpSquash = 0.78;
    }
    kart.y = nextSurf.height;
    kart.vy = 0;
    kart.grounded = true;
  } else if (kart.y > nextSurf.height + 0.15) {
    kart.grounded = false;
  }

  // Boost pad detection
  if (kart.boostPadCooldown <= 0 && kart.grounded) {
    for (const pad of track.config.boostPads) {
      const dtPad = Math.abs(wrapT(nextNearest.t - pad.t + 0.5) - 0.5);
      if (dtPad < 0.014 && Math.abs(clampedLat - pad.lateralOffset) < 3.6) {
        kart.turboActiveTimer = 1.6;
        kart.turboEnergy = Math.min(100, kart.turboEnergy + 30);
        kart.speed = Math.max(kart.speed, baseMaxSpeed * 1.3);
        kart.boostPadCooldown = 1.1;
        events.boostPadHit = true;
        events.turboStarted = true;
        break;
      }
    }
  }

  const bankTarget = antigravZone?.bankAngle ?? 0;
  const targetPitch = kart.grounded
    ? nextSurf.slopePitch
    : THREE.MathUtils.clamp(-kart.vy * 0.025, -0.35, 0.35);
  const targetRoll = kart.steerAngle * 0.14 * speedNorm + bankTarget;
  kart.pitch = THREE.MathUtils.damp(kart.pitch, targetPitch, 10, dt);
  kart.roll = THREE.MathUtils.damp(kart.roll, targetRoll, 10, dt);

  const prevT = kart.nearestT;
  const newT = nextNearest.t;
  kart.nearestT = newT;

  const deltaT = newT - prevT;
  const wasPreStart = kart.lap === 1 && kart.maxProgress < 0.15 && prevT > 0.8;
  if (deltaT < -0.75 && prevT > 0.8 && newT < 0.2) {
    if (!wasPreStart && kart.maxProgress >= kart.lap - 0.32) {
      kart.lap += 1;
      events.lapCompleted = true;
      if (kart.lap > totalLaps && !kart.finished) {
        kart.finished = true;
        kart.finishTimeMs = raceTimeMs;
        kart.lap = totalLaps;
      }
    }
  }

  const isPreStart = kart.lap === 1 && kart.maxProgress < 0.15 && newT > 0.8;
  const effectiveT = isPreStart ? newT - 1 : newT;
  const currentTotalProgress = kart.finished
    ? totalLaps + 1 + Math.max(0, 10000000 - kart.finishTimeMs) / 10000000
    : (kart.lap - 1) + effectiveT;

  if (Math.abs(newT - prevT) < 0.5 || deltaT < -0.75) {
    kart.maxProgress = Math.max(kart.maxProgress, currentTotalProgress);
  }

  updateKartExpression(kart);
  return events;
}

/**
 * Free-roaming Arena / Battle Physics inside an enclosed circular 3D Arena!
 */
export function stepBattleKartPhysics(
  kart: KartPhysicsState,
  input: LiveInputSnapshot,
  arena: BattleArenaConfig,
  dt: number,
  isBattleMode: boolean,
): PhysicsStepEvents {
  const events: PhysicsStepEvents = {
    jumped: false,
    landed: false,
    turboStarted: false,
    boostPadHit: false,
    itemUsed: null,
    wallHit: false,
    lapCompleted: false,
    tntShakenOff: false,
    tntExploded: false,
  };

  const charStats = CHARACTER_MAP[kart.characterId].stats;
  const baseMaxSpeed = 23.5 + charStats.topSpeed * 0.65;
  const accelRate = 17.5 + charStats.acceleration * 0.85;
  const turnAgility = 2.4 + charStats.handling * 0.1;

  kart.shieldTimer = Math.max(0, kart.shieldTimer - dt);
  kart.akuAkuTimer = Math.max(0, kart.akuAkuTimer - dt);
  kart.stunTimer = Math.max(0, kart.stunTimer - dt);
  kart.burnTimer = Math.max(0, kart.burnTimer - dt);
  kart.slowTimer = Math.max(0, kart.slowTimer - dt);
  kart.slipperyTimer = Math.max(0, kart.slipperyTimer - dt);
  kart.laughTimer = Math.max(0, kart.laughTimer - dt);
  kart.hurtTimer = Math.max(0, kart.hurtTimer - dt);
  kart.boostPadCooldown = Math.max(0, kart.boostPadCooldown - dt);
  kart.jumpSquash = THREE.MathUtils.damp(kart.jumpSquash, 1, 12, dt);

  updateKartIdleState(kart, input, dt);

  const wasTurbo = kart.turboActiveTimer > 0;
  const isStunned = kart.stunTimer > 0;
  const isSlippery = kart.slipperyTimer > 0;
  if (!isStunned && input.turbo && kart.turboEnergy >= 18) {
    if (!wasTurbo) events.turboStarted = true;
    kart.turboActiveTimer = Math.max(kart.turboActiveTimer, 0.24);
    kart.turboEnergy = Math.max(0, kart.turboEnergy - 28 * dt);
  } else {
    kart.turboActiveTimer = Math.max(0, kart.turboActiveTimer - dt);
    if (!input.turbo) {
      kart.turboEnergy = Math.min(100, kart.turboEnergy + 14 * dt);
    }
  }

  if (input.itemJustPressed && kart.heldItem) {
    events.itemUsed = kart.heldItem;
    events.itemJuiced = (kart.wumpas ?? 0) >= 10;
    kart.laughTimer = 1.3;
    kart.heldItem = null;
  }

  const slipSway = isSlippery ? Math.sin(kart.slipperyTimer * 7.5) * 0.56 : 0;
  const targetSteer = isStunned ? 0 : THREE.MathUtils.clamp(-input.steer + slipSway, -1.25, 1.25);
  kart.steerAngle = THREE.MathUtils.damp(kart.steerAngle, targetSteer, isSlippery ? 6 : 14, dt);
  const speedNorm = Math.min(1, Math.abs(kart.speed) / 10);
  const reverseFlip = kart.speed < -1 ? -1 : 1;
  if (!isStunned) {
    kart.heading += kart.steerAngle * turnAgility * (isSlippery ? 1.45 : 1.0) * Math.max(0.45, speedNorm) * reverseFlip * dt;
  }

  const slowFactor = kart.slowTimer > 0 ? 0.65 : isSlippery ? 0.85 : 1.0;
  const maxSpeed = (kart.turboActiveTimer > 0 ? baseMaxSpeed * 1.3 : baseMaxSpeed) * slowFactor;

  if (isStunned) {
    kart.speed = 0;
    kart.turboActiveTimer = 0;
  } else if (input.accelerate) {
    kart.speed += accelRate * (kart.turboActiveTimer > 0 ? 1.4 : 1.0) * dt;
  } else if (input.brake) {
    kart.speed -= accelRate * 1.4 * dt;
  } else {
    kart.speed *= Math.exp((isSlippery ? -0.9 : -2.6) * dt);
  }
  kart.speed = isStunned ? 0 : THREE.MathUtils.clamp(kart.speed, -baseMaxSpeed * 0.45, maxSpeed);

  if (!isStunned && input.jumpJustPressed && kart.grounded) {
    kart.vy = 10.2;
    kart.grounded = false;
    kart.jumpSquash = 1.2;
    events.jumped = true;
  }

  kart.vx = Math.sin(kart.heading) * kart.speed;
  kart.vz = Math.cos(kart.heading) * kart.speed;
  kart.x += kart.vx * dt;
  kart.z += kart.vz * dt;

  // Circular arena outer wall bounce
  const maxR = arena.radius - 2.2;
  const rDist = Math.hypot(kart.x, kart.z);
  if (rDist > maxR && rDist > 0.001) {
    const nx = kart.x / rDist;
    const nz = kart.z / rDist;
    kart.x = nx * maxR;
    kart.z = nz * maxR;
    kart.speed *= 0.72;
    if (Math.abs(kart.speed) > 10) events.wallHit = true;
  }

  // Pillar collisions
  for (const pil of arena.pillars) {
    const dx = kart.x - pil.x;
    const dz = kart.z - pil.z;
    const minD = pil.radius + 1.5;
    const d2 = dx * dx + dz * dz;
    if (d2 < minD * minD && d2 > 0.001) {
      const d = Math.sqrt(d2);
      kart.x = pil.x + (dx / d) * minD;
      kart.z = pil.z + (dz / d) * minD;
      kart.speed *= 0.75;
    }
  }

  // Boost pads in battle arena
  if (isBattleMode && kart.boostPadCooldown <= 0 && kart.grounded) {
    for (const bp of arena.boostSpots) {
      const dx = kart.x - bp.x;
      const dz = kart.z - bp.z;
      if (dx * dx + dz * dz < 16) {
        kart.turboActiveTimer = 1.4;
        kart.turboEnergy = Math.min(100, kart.turboEnergy + 30);
        kart.speed = Math.max(kart.speed, baseMaxSpeed * 1.25);
        kart.boostPadCooldown = 1.2;
        events.boostPadHit = true;
        events.turboStarted = true;
        break;
      }
    }
  }

  // Gentle floor elevation (small central dome ramp in battle arena)
  const floorY = isBattleMode && rDist < 12 ? Math.max(0, (1 - rDist / 12) * 1.4) : 0;
  kart.vy -= 28 * dt;
  kart.y += kart.vy * dt;
  if (kart.y <= floorY) {
    if (!kart.grounded && kart.vy < -5) {
      events.landed = true;
      kart.jumpSquash = 0.78;
    }
    kart.y = floorY;
    kart.vy = 0;
    kart.grounded = true;
  }

  kart.pitch = THREE.MathUtils.damp(kart.pitch, 0, 10, dt);
  kart.roll = THREE.MathUtils.damp(kart.roll, kart.steerAngle * 0.14 * speedNorm, 10, dt);
  updateKartExpression(kart);

  return events;
}

export function computeBattleAiControlInput(
  kart: KartPhysicsState,
  arena: BattleArenaConfig,
  karts: KartPhysicsState[],
  dt: number,
): LiveInputSnapshot {
  kart.aiItemCooldown = Math.max(0, kart.aiItemCooldown - dt);
  kart.aiReactionTimer -= dt;

  // If no rocket, steer toward closest active item spot; otherwise hunt closest enemy kart!
  let targetX = 0;
  let targetZ = 0;
  let foundTarget = false;

  if (!kart.heldItem && arena.itemSpots.length > 0) {
    let bestD2 = Infinity;
    for (const spot of arena.itemSpots) {
      const d2 = (spot.x - kart.x) ** 2 + (spot.z - kart.z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        targetX = spot.x;
        targetZ = spot.z;
        foundTarget = true;
      }
    }
  } else {
    let bestD2 = Infinity;
    for (const other of karts) {
      if (other.id === kart.id) continue;
      const d2 = (other.x - kart.x) ** 2 + (other.z - kart.z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        targetX = other.x;
        targetZ = other.z;
        foundTarget = true;
      }
    }
  }

  if (!foundTarget) {
    targetX = Math.sin(kart.id.length + kart.heading) * 20;
    targetZ = Math.cos(kart.id.length + kart.heading) * 20;
  }

  const desiredHeading = Math.atan2(targetX - kart.x, targetZ - kart.z);
  const angleErr = shortestAngleDelta(kart.heading, desiredHeading);
  const steer = THREE.MathUtils.clamp(-angleErr * 2.1, -1, 1);

  let itemJustPressed = false;
  if (kart.heldItem && kart.aiItemCooldown <= 0) {
    const hasAimedEnemy = karts.some((other) => {
      if (other.id === kart.id) return false;
      const d2 = (other.x - kart.x) ** 2 + (other.z - kart.z) ** 2;
      if (d2 > 38 * 38) return false;
      const hTo = Math.atan2(other.x - kart.x, other.z - kart.z);
      return Math.abs(shortestAngleDelta(kart.heading, hTo)) < 0.55;
    });
    if (hasAimedEnemy) {
      itemJustPressed = true;
      kart.aiItemCooldown = 3.0;
    }
  }

  if (kart.aiReactionTimer <= 0) {
    kart.aiReactionTimer = 0.85 + Math.random() * 0.5;
  }

  return {
    accelerate: true,
    brake: false,
    steer,
    turbo: kart.turboEnergy > 70 && Math.abs(angleErr) < 0.25,
    jumpJustPressed: false,
    itemJustPressed,
    pauseJustPressed: false,
    rawPressedKeys: [],
    rawGamepadButtons: [],
    rawGamepadAxes: [],
    activeDeviceLabel: 'IA',
  };
}

export function getKartRaceProgress(k: KartPhysicsState): number {
  const preStart = k.lap === 1 && k.maxProgress < 0.15 && k.nearestT > 0.8;
  return (k.lap - 1) + (preStart ? k.nearestT - 1 : k.nearestT);
}

export function updateRaceStandings(karts: KartPhysicsState[], mode: GameMode = 'arcade'): void {
  if (mode === 'battle') {
    const sorted = [...karts].sort((a, b) => {
      if (b.battleKills !== a.battleKills) return b.battleKills - a.battleKills;
      return a.hurtTimer - b.hurtTimer;
    });
    sorted.forEach((k, idx) => {
      k.rank = idx + 1;
    });
    return;
  }

  const sorted = [...karts].sort((a, b) => {
    if (Boolean(a.eliminated) !== Boolean(b.eliminated)) {
      return a.eliminated ? 1 : -1;
    }
    if (a.eliminated && b.eliminated) {
      return (b.eliminatedAtMs ?? 0) - (a.eliminatedAtMs ?? 0);
    }
    if (a.finished && b.finished) return a.finishTimeMs - b.finishTimeMs;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return getKartRaceProgress(b) - getKartRaceProgress(a);
  });

  sorted.forEach((k, idx) => {
    k.rank = idx + 1;
  });
}

export function getRandomPowerUp(
  rank: number,
  totalRacers: number,
  mode: GameMode = 'arcade',
): PowerUpType {
  if (mode === 'battle') {
    // Battle Mode boxes ONLY give Homing Rockets!
    return 'homing_rocket';
  }
  const pool: PowerUpType[] =
    mode === 'madness'
      ? [
          'aku_aku',
          'homing_rocket',
          'bowling_bomb',
          'warp_orb',
          'time_clock',
          'bolt',
          'turbo_boost',
          'tnt',
          'potion',
          'shockwave',
          'shield',
        ]
      : rank >= Math.ceil(totalRacers * 0.6)
        ? ['aku_aku', 'homing_rocket', 'bowling_bomb', 'warp_orb', 'time_clock', 'bolt', 'turbo_boost', 'tnt', 'potion', 'shockwave']
        : ['homing_rocket', 'bowling_bomb', 'bolt', 'potion', 'tnt', 'aku_aku', 'shield', 'turbo_boost', 'shockwave', 'time_clock'];
  return pool[Math.floor(Math.random() * pool.length)];
}
