import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTLE_ARENAS,
  BOSSES,
  CHARACTERS,
  CHARACTER_MAP,
  DEFAULT_CONTROLS,
  TRACKS,
  evaluateRelicKey,
} from './constants';
import {
  applyKartBurnHit,
  applyKartSlipperyHit,
  collectWumpaBox,
  compileTrack,
  computeAiControlInput,
  computeBattleAiControlInput,
  findNearestTrackSample,
  getAbyssGapSpan,
  getActiveAntigravityZone,
  getRandomPowerUp,
  getTrackWumpaBoxLocations,
  resolveIdleExpression,
  stepBattleKartPhysics,
  stepKartPhysics,
  updateKartIdleState,
  updateRaceStandings,
} from './math';
import type { KartPhysicsState, LiveInputSnapshot, PowerUpType } from './types';

function makeKart(overrides: Partial<KartPhysicsState> = {}): KartPhysicsState {
  return {
    id: 'p1',
    name: 'Jarvin',
    characterId: 'jarvin',
    isPlayer: true,
    playerIndex: 0,
    customization: { ...CHARACTER_MAP.jarvin.defaultCustomization },
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    heading: 0,
    speed: 0,
    steerAngle: 0,
    grounded: true,
    pitch: 0,
    roll: 0,
    drifting: false,
    driftDir: 0,
    driftCharge: 0,
    turboEnergy: 100,
    turboActiveTimer: 0,
    wumpas: 0,
    heldItem: null,
    shieldTimer: 0,
    akuAkuTimer: 0,
    spinoutTimer: 0,
    stunTimer: 0,
    burnTimer: 0,
    slowTimer: 0,
    slipperyTimer: 0,
    tntTimer: 0,
    tntShakeJumps: 0,
    laughTimer: 0,
    hurtTimer: 0,
    expression: 'normal',
    idleWaitTimer: 0,
    idleAnim: 'none',
    idleAnimTimer: 0,
    boostPadCooldown: 0,
    jumpSquash: 1,
    battleKills: 0,
    nearestT: 0,
    lap: 1,
    maxProgress: 0,
    finished: false,
    finishTimeMs: 0,
    rank: 1,
    aiTargetOffset: 0,
    aiReactionTimer: 0,
    aiItemCooldown: 0,
    ...overrides,
  };
}

function makeInput(overrides: Partial<LiveInputSnapshot> = {}): LiveInputSnapshot {
  return {
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
    ...overrides,
  };
}

test('roster includes 13 playable racers (incl. N. Tropy, Penta, Falso Jarvin, Celular Kart, PC Gamer), 4 bosses, 8 controls, and 24 tracks with abysses/waterfalls', () => {
  assert.equal(CHARACTERS.length, 13);
  assert.ok(CHARACTER_MAP.crash);
  assert.equal(CHARACTER_MAP.crash.name, 'Crash Bandicoot');
  assert.ok(CHARACTER_MAP.jason);
  assert.ok(CHARACTER_MAP.lucia);
  assert.ok(CHARACTER_MAP.jarvin_exe);
  assert.ok(CHARACTER_MAP.n_tropy);
  assert.ok(CHARACTER_MAP.penta_penguin);
  assert.ok(CHARACTER_MAP.falso_jarvin);
  assert.ok(CHARACTER_MAP.celular_kart);
  assert.ok(CHARACTER_MAP.pc_gamer);
  assert.equal(CHARACTER_MAP.jarvin_exe.unlockRequirement?.bossId, 'jarvin_exe');
  assert.equal(DEFAULT_CONTROLS.length, 8);
  for (const ch of CHARACTERS) {
    assert.ok(ch.avatarUrl && ch.avatarUrl.length > 5, `Character ${ch.id} should have real avatarUrl`);
  }
  assert.equal(TRACKS.length, 30);
  assert.ok(TRACKS.some((t) => t.id === 'skull_rock_cove' && t.chapter === 25));
  assert.ok(TRACKS.some((t) => t.id === 'galaxy_oxide_finale' && t.chapter === 30));
  assert.ok(TRACKS.some((t) => t.id === 'oxide_station'));
  assert.ok(TRACKS.some((t) => t.id === 'vice_city_beach'));
  assert.ok(TRACKS.some((t) => t.id === 'turbo_track'));
  assert.ok(TRACKS.some((t) => (t.abyssGaps?.length ?? 0) > 0), 'Tracks should feature abyss ramps');
  assert.ok(TRACKS.some((t) => (t.waterfalls?.length ?? 0) > 0), 'Tracks should feature waterfalls');
  assert.ok(TRACKS.some((t) => (t.tokens?.length ?? 0) === 3), 'Tracks should define J-K-T tokens');
  for (const t of TRACKS) {
    assert.ok(t.roadWidth >= 28, `Track ${t.id} should be wide (>=28m), got ${t.roadWidth}`);
  }
  assert.equal(BOSSES.length, 4);
  const jBoss = BOSSES.find((b) => b.id === 'jarvin_exe');
  assert.ok(jBoss && jBoss.glitchOnDefeat && jBoss.paceMultiplier === 1.07);
  assert.ok(jBoss.loseTauntLines && jBoss.loseTauntLines.length > 0);
  assert.ok(BOSSES.some((b) => b.id === 'nitros_oxide' && b.infiniteTurbo));
});

test('compileTrack generates closed long spline with valid samples and smooth aiOffset paths for all 24 tracks', () => {
  for (const cfg of TRACKS) {
    const compiled = compileTrack(cfg, 240);
    assert.ok(compiled.totalLength > 700, `Track ${cfg.id} should be long (>700m), got ${compiled.totalLength}`);
    assert.equal(compiled.samples.length, 240);
    const maxOffset = cfg.roadWidth * 0.5 - 2.5;
    for (const s of compiled.samples) {
      assert.ok(Number.isFinite(s.aiOffset), `aiOffset must be finite on ${cfg.id}`);
      assert.ok(Math.abs(s.aiOffset) <= maxOffset + 0.01, `aiOffset ${s.aiOffset} exceeds road on ${cfg.id}`);
    }
    const nearest = findNearestTrackSample(compiled, cfg.controlPoints[0].x, cfg.controlPoints[0].z);
    assert.ok(nearest.distSq < 25);
  }
});

test('stepKartPhysics accelerates at controlled speed, jumps, and activates turbo', () => {
  const track = compileTrack(TRACKS[0]);
  const start = track.samples[0];
  const kart = makeKart({
    x: start.point.x,
    y: start.point.y,
    z: start.point.z,
    heading: Math.atan2(start.tangent.x, start.tangent.z),
  });

  // Accelerate for many steps to reach top cruise speed
  for (let i = 0; i < 120; i++) {
    stepKartPhysics(kart, makeInput({ accelerate: true }), track, 3, i * 16, 0.016);
  }
  assert.ok(kart.speed > 20, 'Kart should accelerate forward');
  assert.ok(kart.speed < 48, `Kart cruise speed should stay moderated (<48 m/s), got ${kart.speed}`);

  // Trigger Jump
  const jumpEvents = stepKartPhysics(
    kart,
    makeInput({ accelerate: true, jumpJustPressed: true }),
    track,
    3,
    2000,
    0.016,
  );
  assert.equal(jumpEvents.jumped, true);
  assert.equal(kart.grounded, false);
  assert.ok(kart.vy > 8);

  // Trigger Turbo
  const turboEvents = stepKartPhysics(
    kart,
    makeInput({ accelerate: true, turbo: true }),
    track,
    3,
    2016,
    0.016,
  );
  assert.equal(turboEvents.turboStarted, true);
  assert.ok(kart.turboActiveTimer > 0);
});

test('aku_aku activates mask protection and applyKartBurnHit burns + stops kart for 2s then resumes', () => {
  const track = compileTrack(TRACKS[0]);
  const start = track.samples[0];
  const kart = makeKart({
    x: start.point.x,
    y: start.point.y,
    z: start.point.z,
    heading: Math.atan2(start.tangent.x, start.tangent.z),
    heldItem: 'aku_aku',
    speed: 25,
  });

  const itemEv = stepKartPhysics(
    kart,
    makeInput({ accelerate: true, itemJustPressed: true }),
    track,
    3,
    100,
    0.016,
  );
  assert.equal(itemEv.itemUsed, 'aku_aku');
  assert.ok(kart.akuAkuTimer > 5);
  assert.equal(kart.heldItem, null);

  // Protected by Aku Aku -> hit blocked
  assert.equal(applyKartBurnHit(kart), false);

  // Unprotected hit -> 2.0s burn + 2.0s stop (speed = 0), then gets back up cleanly!
  kart.akuAkuTimer = 0;
  kart.shieldTimer = 0;
  kart.speed = 25;
  assert.equal(applyKartBurnHit(kart), true);
  assert.equal(kart.burnTimer, 2.0);
  assert.equal(kart.stunTimer, 2.0);
  assert.equal(kart.speed, 0);
  assert.ok(kart.vy >= 5.8);
  assert.equal(kart.grounded, false);

  // During 2s stun, kart stays stopped
  stepKartPhysics(kart, makeInput({ accelerate: true }), track, 3, 200, 0.5);
  assert.equal(kart.speed, 0);
  assert.ok(kart.stunTimer > 1.0);

  // Once 2s expire, kart gets back up and accelerates again
  for (let i = 0; i < 4; i++) {
    stepKartPhysics(kart, makeInput({ accelerate: true }), track, 3, 2500 + i * 500, 0.5);
  }
  assert.equal(kart.stunTimer, 0);
  assert.ok(kart.speed > 5, 'Kart should accelerate again once 2s burn+stop finishes');
});

test('applyKartSlipperyHit triggers 5s slippery timer and updateKartIdleState activates idle every 10s until moving', () => {
  const kart = makeKart({ isPlayer: true, speed: 0 });
  assert.equal(applyKartSlipperyHit(kart, 5.0), true);
  assert.equal(kart.slipperyTimer, 5.0);
  kart.slipperyTimer = 0;

  // Standing still for 10 seconds triggers a random idle animation
  for (let i = 0; i < 20; i++) {
    updateKartIdleState(kart, makeInput(), 0.5);
  }
  assert.notEqual(kart.idleAnim, 'none');

  // Force phone idle -> persists even after another 20s until input moves
  kart.idleAnim = 'phone';
  kart.idleAnimTimer = 0;
  for (let i = 0; i < 40; i++) {
    updateKartIdleState(kart, makeInput(), 0.5);
  }
  assert.equal(kart.idleAnim, 'phone');
  assert.equal(resolveIdleExpression('phone', 12), 'phone');

  // Moving clears idle immediately
  updateKartIdleState(kart, makeInput({ accelerate: true }), 0.016);
  assert.equal(kart.idleAnim, 'none');
  assert.equal(kart.idleWaitTimer, 0);

  // Sleep wakes up automatically after ~6.4s even without input
  kart.idleAnim = 'sleep';
  kart.idleAnimTimer = 6.35;
  updateKartIdleState(kart, makeInput(), 0.1);
  assert.equal(kart.idleAnim, 'none');
});

test('TNT crate can be shaken off by jumping twice or explodes after 3s with burn + slow', () => {
  const track = compileTrack(TRACKS[0]);
  const start = track.samples[0];
  const heading = Math.atan2(start.tangent.x, start.tangent.z);

  // Case 1: Shake off with 2 jumps before 3s elapse
  const jumper = makeKart({
    x: start.point.x,
    y: start.point.y,
    z: start.point.z,
    heading,
    tntTimer: 3.0,
    tntShakeJumps: 0,
    speed: 20,
  });
  stepKartPhysics(jumper, makeInput({ accelerate: true, jumpJustPressed: true }), track, 3, 100, 0.016);
  assert.equal(jumper.tntShakeJumps, 1);
  assert.ok(jumper.tntTimer > 0);
  const ev2 = stepKartPhysics(jumper, makeInput({ accelerate: true, jumpJustPressed: true }), track, 3, 120, 0.016);
  assert.equal(ev2.tntShakenOff, true);
  assert.equal(jumper.tntTimer, 0);
  assert.equal(jumper.slowTimer, 0);

  // Case 2: Timer runs down to 0 -> explodes for 2s burn + 3s slow
  const victim = makeKart({
    x: start.point.x,
    y: start.point.y,
    z: start.point.z,
    heading,
    tntTimer: 0.05,
    speed: 22,
  });
  const evExp = stepKartPhysics(victim, makeInput({ accelerate: true }), track, 3, 200, 0.1);
  assert.equal(evExp.tntExploded, true);
  assert.equal(victim.tntTimer, 0);
  assert.equal(victim.burnTimer, 2.0);
  assert.equal(victim.stunTimer, 2.0);
  assert.equal(victim.slowTimer, 3.0);
});

test('evaluateRelicKey awards gold <=59s, metal <=1:20, copper <=2:20 and battle crates only yield homing_rocket', () => {
  assert.equal(evaluateRelicKey(58900), 'gold');
  assert.equal(evaluateRelicKey(59000), 'gold');
  assert.equal(evaluateRelicKey(60000), 'metal');
  assert.equal(evaluateRelicKey(80000), 'metal');
  assert.equal(evaluateRelicKey(125000), 'copper');
  assert.equal(evaluateRelicKey(140000), 'copper');
  assert.equal(evaluateRelicKey(145000), null);

  for (let i = 0; i < 12; i++) {
    assert.equal(getRandomPowerUp(1, 4, 'battle'), 'homing_rocket');
  }

  const arena = BATTLE_ARENAS[0];
  const fighter = makeKart({ id: 'f1', x: arena.radius + 10, z: 0, speed: 24, battleKills: 5 });
  const rival = makeKart({ id: 'f2', x: 0, z: 0, battleKills: 2 });
  const bAi = computeBattleAiControlInput(rival, arena, [fighter, rival], 0.016);
  assert.equal(bAi.accelerate, true);

  stepBattleKartPhysics(fighter, makeInput({ accelerate: true }), arena, 0.016, true);
  assert.ok(Math.hypot(fighter.x, fighter.z) <= arena.radius - 2.1, 'Arena walls should clamp kart inside');

  updateRaceStandings([rival, fighter], 'battle');
  assert.equal(fighter.rank, 1);
  assert.equal(rival.rank, 2);
});

test('computeAiControlInput only fires rockets/bolts at close range and seeks boost pads smoothly', () => {
  const track = compileTrack(TRACKS[0]);
  const smp = track.samples[18];
  const closeSmp = track.samples[22];
  const farSmp = track.samples[65];

  const aiKart = makeKart({
    id: 'ai_0',
    isPlayer: false,
    x: smp.point.x,
    y: smp.point.y,
    z: smp.point.z,
    nearestT: smp.t,
    heading: Math.atan2(smp.tangent.x, smp.tangent.z),
    speed: 28,
    heldItem: 'homing_rocket',
    aiReactionTimer: 0.5,
    aiItemCooldown: 0,
  });

  const farRival = makeKart({
    id: 'p_far',
    isPlayer: true,
    x: farSmp.point.x,
    y: farSmp.point.y,
    z: farSmp.point.z,
    nearestT: farSmp.t,
    heading: Math.atan2(farSmp.tangent.x, farSmp.tangent.z),
  });

  const farDist = Math.hypot(farRival.x - aiKart.x, farRival.z - aiKart.z);
  assert.ok(farDist > 50, `Expected far rival > 50m away, got ${farDist}`);
  const farInput = computeAiControlInput(aiKart, track, 'normal', 0.016, [aiKart, farRival]);
  assert.equal(farInput.itemJustPressed, false, 'AI must NOT fire rocket when rival is far away');

  aiKart.heldItem = 'bolt';
  const farBoltInput = computeAiControlInput(aiKart, track, 'normal', 0.016, [aiKart, farRival]);
  assert.equal(farBoltInput.itemJustPressed, false, 'AI must NOT fire bolt when all rivals are far away');

  const closeRival = makeKart({
    id: 'p_close',
    isPlayer: true,
    x: closeSmp.point.x,
    y: closeSmp.point.y,
    z: closeSmp.point.z,
    nearestT: closeSmp.t,
    heading: Math.atan2(closeSmp.tangent.x, closeSmp.tangent.z),
  });

  aiKart.heldItem = 'homing_rocket';
  const input = computeAiControlInput(aiKart, track, 'normal', 0.016, [aiKart, closeRival]);
  assert.equal(input.accelerate, true);
  assert.equal(input.itemJustPressed, true, 'AI should fire homing rocket when rival is closely directly ahead');
  assert.equal(input.turbo, true, 'AI should use turbo on straight segment');
});

test('antigravity zones activate inAntigravity flag, raise top speed, and recharge turbo energy', () => {
  const agTrackCfg = TRACKS.find((t) => (t.antigravityZones?.length ?? 0) > 0);
  assert.ok(agTrackCfg, 'Expected at least one track with antigravityZones');
  const track = compileTrack(agTrackCfg);
  const zone = agTrackCfg.antigravityZones![0];
  assert.ok(getActiveAntigravityZone(track, (zone.tStart + zone.tEnd) * 0.5));

  const idx = Math.floor(((zone.tStart + zone.tEnd) * 0.5) * track.samples.length) % track.samples.length;
  const smp = track.samples[idx];
  const kart = makeKart({
    x: smp.point.x,
    y: smp.point.y,
    z: smp.point.z,
    nearestT: smp.t,
    heading: Math.atan2(smp.tangent.x, smp.tangent.z),
    turboEnergy: 20,
    speed: 30,
  });

  stepKartPhysics(kart, makeInput({ accelerate: true }), track, 3, 1000, 0.5);
  assert.equal(kart.inAntigravity, true);
  assert.ok(kart.turboEnergy > 20, 'Antigravity should passively recharge turbo energy');
});

test('AI steers toward target heading and drives forward smoothly along track curves without spinning or wrong-way', () => {
  for (const trackCfg of [TRACKS[0], TRACKS[2], TRACKS[11], TRACKS[20]]) {
    const track = compileTrack(trackCfg);
    const start = track.samples[0];
    const startHeading = Math.atan2(start.tangent.x, start.tangent.z);

    // Check steering sign correction: if kart points slightly right (-heading) of track tangent,
    // target is toward +heading (left), so input.steer must be negative (< 0) because stepKartPhysics flips sign.
    const misaligned = makeKart({
      id: 'ai_sign',
      isPlayer: false,
      x: start.point.x,
      y: start.point.y,
      z: start.point.z,
      nearestT: start.t,
      heading: startHeading - 0.35,
      speed: 25,
    });
    const signInput = computeAiControlInput(misaligned, track, 'normal', 0.016, [misaligned]);
    assert.ok(signInput.steer < -0.1, `Expected negative steer to turn +heading toward target, got ${signInput.steer}`);

    // Run 450 simulation steps (~7.2 seconds) along the track
    const bot = makeKart({
      id: 'ai_loop',
      isPlayer: false,
      x: start.point.x,
      y: start.point.y,
      z: start.point.z,
      nearestT: start.t,
      heading: startHeading,
      speed: 0,
    });

    let totalProgress = 0;
    let prevT = bot.nearestT;
    let maxWrongWay = 0;

    for (let step = 0; step < 600; step++) {
      const inp = computeAiControlInput(bot, track, 'normal', 0.016, [bot]);
      stepKartPhysics(bot, inp, track, 3, step * 16, 0.016, 'normal', 1.0);

      let dt = bot.nearestT - prevT;
      if (dt < -0.5) dt += 1;
      if (dt > 0.5) dt -= 1;
      totalProgress += dt;
      prevT = bot.nearestT;

      if (step > 45) {
        const smp = track.samples[Math.floor((bot.nearestT % 1) * track.samples.length) % track.samples.length];
        const tanH = Math.atan2(smp.tangent.x, smp.tangent.z);
        let diff = Math.abs(((tanH - bot.heading + Math.PI) % (Math.PI * 2)) - Math.PI);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        maxWrongWay = Math.max(maxWrongWay, diff);
      }
    }

    assert.ok(totalProgress > 0.11, `Bot on ${trackCfg.id} should make steady forward progress, got ${totalProgress}`);
    assert.ok(bot.speed > 20, `Bot on ${trackCfg.id} should maintain strong speed, got ${bot.speed}`);
    assert.ok(maxWrongWay < 0.75, `Bot on ${trackCfg.id} should stay aligned with track tangent, max angle diff=${maxWrongWay}`);
  }
});

test('updateRaceStandings ranks finished and furthest karts accurately', () => {
  const k1 = makeKart({ id: 'k1', lap: 2, nearestT: 0.2, maxProgress: 1.2 });
  const k2 = makeKart({ id: 'k2', lap: 2, nearestT: 0.8, maxProgress: 1.8 });
  const k3 = makeKart({ id: 'k3', finished: true, finishTimeMs: 81000, lap: 3, maxProgress: 3 });

  updateRaceStandings([k1, k2, k3]);
  assert.equal(k3.rank, 1);
  assert.equal(k2.rank, 2);
  assert.equal(k1.rank, 3);
});

test('crossing start line from pre-start grid keeps lap at 1 and ranks ahead of trailing karts', () => {
  const track = compileTrack(TRACKS[0]);
  const startSmp = track.samples[Math.floor(0.988 * track.samples.length)];
  const kart = makeKart({
    x: startSmp.point.x,
    y: startSmp.point.y,
    z: startSmp.point.z,
    nearestT: 0.988,
    lap: 1,
    maxProgress: 0.988 - 1,
    heading: Math.atan2(startSmp.tangent.x, startSmp.tangent.z),
  });

  for (let i = 0; i < 160; i++) {
    stepKartPhysics(kart, makeInput({ accelerate: true }), track, 3, i * 16, 0.016);
  }
  assert.equal(kart.lap, 1, 'Crossing start line from grid should remain on Lap 1');
  assert.ok(kart.nearestT < 0.25, 'Kart should have crossed t=0 into Lap 1');

  const behindKart = makeKart({ id: 'k2', lap: 1, nearestT: 0.992, maxProgress: -0.008 });
  updateRaceStandings([kart, behindKart]);
  assert.equal(kart.rank, 1);
  assert.equal(behindKart.rank, 2);
});

test('exact default control bindings match user specification', () => {
  const p1 = DEFAULT_CONTROLS[0];
  const p2 = DEFAULT_CONTROLS[1];

  assert.equal(p1.keyboard.accelerate, 'KeyW');
  assert.equal(p1.keyboard.left, 'KeyA');
  assert.equal(p1.keyboard.brake, 'KeyS');
  assert.equal(p1.keyboard.right, 'KeyD');
  assert.equal(p1.keyboard.turbo, 'ShiftLeft');

  assert.equal(p2.keyboard.turbo, 'NumpadEnter');

  // PS4/PS5 Gamepad defaults
  assert.equal(p1.gamepad.accelerate, 0); // X
  assert.equal(p1.gamepad.item, 1);       // Circle
  assert.equal(p1.gamepad.square, 2);     // Square (no action)
  assert.equal(p1.gamepad.pause, 3);      // Triangle
  assert.equal(p1.gamepad.jumpL1, 4);     // L1
  assert.equal(p1.gamepad.jumpR1, 5);     // R1
});

test('abyss gaps cause kart to fall and respawn cleanly past the chasm', () => {
  const gapTrackCfg = TRACKS.find((t) => (t.abyssGaps?.length ?? 0) > 0);
  assert.ok(gapTrackCfg, 'Expected track with abyssGaps');
  const track = compileTrack(gapTrackCfg);
  const gap = gapTrackCfg.abyssGaps![0];
  const midT = gap.tEnd - 0.003;
  assert.ok(getAbyssGapSpan(track, midT));

  const smp = track.samples[Math.floor(midT * track.samples.length) % track.samples.length];
  const fallingKart = makeKart({
    x: smp.point.x,
    y: smp.point.y - 8.2,
    z: smp.point.z,
    nearestT: midT,
    heading: Math.atan2(smp.tangent.x, smp.tangent.z),
    grounded: false,
    speed: 4,
  });

  const ev = stepKartPhysics(fallingKart, makeInput({ accelerate: true }), track, 3, 500, 0.016);
  assert.equal(ev.fallRespawn, true);
  assert.ok((fallingKart.fallRespawnTimer ?? 0) > 1.0);
  assert.ok(fallingKart.y > smp.point.y - 2.0, 'Kart should respawn safely above track height');
});

test('Modo Locura grants 1.32x super speed and instant power-up reload; time_clock slows opponents; elimination ranks survivors first', () => {
  const track = compileTrack(TRACKS[0]);
  const start = track.samples[0];
  const heading = Math.atan2(start.tangent.x, start.tangent.z);

  const normalKart = makeKart({
    x: start.point.x,
    y: start.point.y,
    z: start.point.z,
    heading,
  });
  const madnessKart = makeKart({
    x: start.point.x,
    y: start.point.y,
    z: start.point.z,
    heading,
    heldItem: 'bowling_bomb',
  });

  for (let i = 0; i < 150; i++) {
    stepKartPhysics(normalKart, makeInput({ accelerate: true }), track, 3, i * 16, 0.016, 'normal', 1, 'arcade');
    stepKartPhysics(
      madnessKart,
      makeInput({ accelerate: true, itemJustPressed: i === 5 }),
      track,
      3,
      i * 16,
      0.016,
      'normal',
      1,
      'madness',
    );
  }
  assert.ok(madnessKart.speed > normalKart.speed * 1.2, 'Modo Locura should race substantially faster than normal mode');
  assert.notEqual(madnessKart.heldItem, null, 'Modo Locura should instantly reload a new power-up after firing');

  // Verify new power-ups appear in pool
  const seen = new Set<PowerUpType>();
  for (let i = 0; i < 400; i++) {
    seen.add(getRandomPowerUp(3, 6, 'madness'));
  }
  assert.ok(seen.has('bowling_bomb'), 'Pool should include bowling_bomb');
  assert.ok(seen.has('warp_orb'), 'Pool should include warp_orb');
  assert.ok(seen.has('time_clock'), 'Pool should include time_clock');

  // Elimination ranking places alive karts ahead of eliminated karts, and later KO ahead of earlier KO
  const aliveLow = makeKart({ id: 'a1', maxProgress: 0.4, eliminated: false });
  const koLate = makeKart({ id: 'k2', maxProgress: 0.9, eliminated: true, eliminatedAtMs: 44000 });
  const koEarly = makeKart({ id: 'k1', maxProgress: 0.95, eliminated: true, eliminatedAtMs: 22000 });
  updateRaceStandings([koEarly, aliveLow, koLate], 'elimination');
  assert.equal(aliveLow.rank, 1);
  assert.equal(koLate.rank, 2);
  assert.equal(koEarly.rank, 3);
});

test('Wumpa Crates grant +5 Wumpas (2 crates = 10 max), scaling Aku Aku from 10s to 20s and triggering Juiced powers', () => {
  const track = compileTrack(TRACKS[0]);
  const start = track.samples[0];
  const heading = Math.atan2(start.tangent.x, start.tangent.z);

  assert.ok(getTrackWumpaBoxLocations(TRACKS[0]).length >= 6);

  // 0 or 5 Wumpas -> Aku Aku lasts 10.0s, itemJuiced = false
  const kLow = makeKart({
    x: start.point.x,
    y: start.point.y,
    z: start.point.z,
    heading,
    wumpas: 0,
    heldItem: 'aku_aku',
  });
  collectWumpaBox(kLow);
  assert.equal(kLow.wumpas, 5);
  const ev5 = stepKartPhysics(kLow, makeInput({ accelerate: true, itemJustPressed: true }), track, 3, 100, 0.016);
  assert.equal(ev5.itemUsed, 'aku_aku');
  assert.equal(ev5.itemJuiced, false);
  assert.ok(Math.abs(kLow.akuAkuTimer - 10.0) < 0.05, `Expected ~10s Aku Aku at 5 Wumpas, got ${kLow.akuAkuTimer}`);

  // 2nd crate -> caps at 10 -> Aku Aku lasts 20.0s & itemJuiced = true
  collectWumpaBox(kLow);
  assert.equal(kLow.wumpas, 10);
  collectWumpaBox(kLow);
  assert.equal(kLow.wumpas, 10, 'Wumpas must cap at 10');

  kLow.heldItem = 'aku_aku';
  const ev10 = stepKartPhysics(kLow, makeInput({ accelerate: true, itemJustPressed: true }), track, 3, 200, 0.016);
  assert.equal(ev10.itemUsed, 'aku_aku');
  assert.equal(ev10.itemJuiced, true);
  assert.ok(Math.abs(kLow.akuAkuTimer - 20.0) < 0.05, `Expected ~20s Aku Aku at 10 Wumpas, got ${kLow.akuAkuTimer}`);

  // Juiced shield lasts 11s vs normal 7s
  const kShield = makeKart({
    x: start.point.x,
    y: start.point.y,
    z: start.point.z,
    heading,
    wumpas: 10,
    heldItem: 'shield',
  });
  const evShield = stepKartPhysics(kShield, makeInput({ accelerate: true, itemJustPressed: true }), track, 3, 300, 0.016);
  assert.equal(evShield.itemJuiced, true);
  assert.ok(Math.abs(kShield.shieldTimer - 11.0) < 0.05);
});


