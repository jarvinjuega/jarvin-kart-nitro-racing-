import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {
  BattleArenaConfig,
  CharacterId,
  FacialExpression,
  KartCustomization,
  KartIdleAnimation,
  TrackConfig,
} from './types';
import { getTrackWumpaBoxLocations, type CompiledTrack } from './math';
import {
  createAntigravTexture,
  createAsphaltTexture,
  createBoostPadTexture,
  createCarPaintNormalMap,
  createCrateTexture,
  createFastSurfaceTexture,
  createFinishLineTexture,
  createGroundTexture,
  createRampTexture,
  createRockPBRTextures,
  createSkyscraperWindowTexture,
  createStartBannerTexture,
  createTireTreadTextures,
  createWoodPlankTextures,
} from './textures';
import { createAnimatedSurfaceShader, createExhaustFlameShader } from './shaders';

// Shared lightweight cached procedural PBR maps for karts so spawning multiple karts is instant
let cachedCarNormalMap: THREE.CanvasTexture | null = null;
let cachedTireTextures: { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } | null = null;

function getCarPaintNormal(): THREE.CanvasTexture {
  if (!cachedCarNormalMap) cachedCarNormalMap = createCarPaintNormalMap();
  return cachedCarNormalMap;
}

function getTireTextures(): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  if (!cachedTireTextures) cachedTireTextures = createTireTreadTextures();
  return cachedTireTextures;
}

export interface CharacterFaceRig {
  characterId: CharacterId;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  snoutCanvas?: HTMLCanvasElement;
  snoutCtx?: CanvasRenderingContext2D;
  snoutTexture?: THREE.CanvasTexture;
  lastKey: string;
  dizzyGroup: THREE.Group;
  phoneCanvas: HTMLCanvasElement;
  phoneCtx: CanvasRenderingContext2D;
  phoneTexture: THREE.CanvasTexture;
  phoneLastFrame: number;
}

export interface CharacterIdleProps {
  phoneGroup: THREE.Group;
  butterflyGroup: THREE.Group;
  butterflyWingL: THREE.Mesh;
  butterflyWingR: THREE.Mesh;
  zzzGroup: THREE.Group;
}

export interface CharacterRig {
  root: THREE.Group;
  bodyPivot: THREE.Group;
  head: THREE.Group;
  torso: THREE.Group;
  spineBones: THREE.Bone[];
  flexChains: THREE.Bone[][];
  eyelids: THREE.Mesh[];
  faceRig: CharacterFaceRig;
  idleProps: CharacterIdleProps;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftElbow?: THREE.Group;
  rightElbow?: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftKnee?: THREE.Group;
  rightKnee?: THREE.Group;
  crown?: THREE.Group;
}

export interface KartMeshRig {
  root: THREE.Group;
  chassisGroup: THREE.Group;
  engineBlock: THREE.Group;
  enginePistons: THREE.Mesh[];
  exhaustFlames: Array<{ mesh: THREE.Mesh; material: THREE.ShaderMaterial }>;
  bodyMat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
  rimMat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
  neonMat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
  wheels: THREE.Group[];
  frontWheelPivots: THREE.Group[];
  steeringWheel: THREE.Group;
  driverAnchor: THREE.Group;
  driverRig: CharacterRig;
  catCompanion?: THREE.Group;
  catTailBones?: THREE.Bone[];
  shieldMesh: THREE.Mesh;
  akuAkuGroup: THREE.Group;
  tntMountGroup: THREE.Group;
  burnFlameGroup: THREE.Group;
  contactShadow: THREE.Mesh;
}

function makeMat(
  color: string | number,
  roughness = 0.55,
  metalness = 0.1,
  emissive?: string | number,
  emissiveIntensity = 0,
  isMobile = false,
): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  if (isMobile) {
    return new THREE.MeshLambertMaterial({
      color,
      emissive: emissive ?? 0x000000,
      emissiveIntensity,
    });
  }
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    emissive: emissive ?? 0x000000,
    emissiveIntensity,
  });
}

/**
 * Builds a real skeletal THREE.SkinnedMesh chain with smooth multi-bone skin weights
 * so tails, ears, capes, scarves, and spires deform organically!
 */
function createSkinnedChainMesh(
  length: number,
  baseRadius: number,
  tipRadius: number,
  boneCount: number,
  material: THREE.Material,
  axis: 'y' | 'z' = 'y',
  isMobile = false,
): { mesh: THREE.Mesh; bones: THREE.Bone[]; rootBone?: THREE.Bone } {
  const radialSegs = isMobile ? 7 : 12;
  const heightSegs = isMobile ? 2 : Math.max(8, boneCount * 4);
  const geo = new THREE.CylinderGeometry(tipRadius, baseRadius, length, radialSegs, heightSegs, false);
  geo.translate(0, length * 0.5, 0);

  if (axis === 'z') {
    geo.rotateX(-Math.PI / 2);
  }

  if (isMobile) {
    const mesh = new THREE.Mesh(geo, material);
    return { mesh, bones: [] };
  }

  const pos = geo.attributes.position;
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const segLen = length / boneCount;

  for (let i = 0; i < pos.count; i++) {
    const coord = axis === 'z' ? Math.max(0, -pos.getZ(i)) : Math.max(0, pos.getY(i));
    const exactBone = Math.min(boneCount - 1, (coord / length) * (boneCount - 0.001));
    const idx0 = Math.floor(exactBone);
    const idx1 = Math.min(boneCount - 1, idx0 + 1);
    const w1 = exactBone - idx0;
    const w0 = 1 - w1;
    skinIndices.push(idx0, idx1, 0, 0);
    skinWeights.push(w0, w1, 0, 0);
  }

  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));

  const bones: THREE.Bone[] = [];
  for (let b = 0; b < boneCount; b++) {
    const bone = new THREE.Bone();
    if (b > 0) {
      if (axis === 'z') {
        bone.position.set(0, 0, -segLen);
      } else {
        bone.position.set(0, segLen, 0);
      }
      bones[b - 1].add(bone);
    }
    bones.push(bone);
  }

  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.castShadow = true;
  mesh.add(bones[0]);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  mesh.frustumCulled = false;

  return { mesh, bones, rootBone: bones[0] };
}

function createSkinnedRibbonCape(
  width: number,
  length: number,
  boneCount: number,
  material: THREE.Material,
  isMobile = false,
): { mesh: THREE.Mesh; bones: THREE.Bone[] } {
  const geo = new THREE.PlaneGeometry(width, length, isMobile ? 2 : 6, isMobile ? 2 : boneCount * 3);
  geo.translate(0, -length * 0.5, 0);
  if (isMobile) {
    return { mesh: new THREE.Mesh(geo, material), bones: [] };
  }
  const pos = geo.attributes.position;
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const segLen = length / boneCount;

  for (let i = 0; i < pos.count; i++) {
    const distDown = Math.max(0, -pos.getY(i));
    const exactBone = Math.min(boneCount - 1, (distDown / length) * (boneCount - 0.001));
    const idx0 = Math.floor(exactBone);
    const idx1 = Math.min(boneCount - 1, idx0 + 1);
    const w1 = exactBone - idx0;
    const w0 = 1 - w1;
    skinIndices.push(idx0, idx1, 0, 0);
    skinWeights.push(w0, w1, 0, 0);
  }

  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));

  const bones: THREE.Bone[] = [];
  for (let b = 0; b < boneCount; b++) {
    const bone = new THREE.Bone();
    if (b > 0) {
      bone.position.set(0, -segLen, 0);
      bones[b - 1].add(bone);
    }
    bones.push(bone);
  }

  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.castShadow = true;
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.frustumCulled = false;
  return { mesh, bones };
}

function createAkuAkuMaskModel(): THREE.Group {
  const mask = new THREE.Group();
  const woodMat = makeMat('#78350f', 0.68, 0.08);
  const beardMat = makeMat('#451a03', 0.8, 0.05);
  const eyeMat = makeMat('#fef08a', 0.15, 0.1, '#facc15', 1.4);
  const lipMat = makeMat('#facc15', 0.4, 0.15);

  const plankShape = new THREE.Shape();
  plankShape.moveTo(-0.32, 0.44);
  plankShape.lineTo(0.32, 0.44);
  plankShape.lineTo(0.24, -0.42);
  plankShape.lineTo(-0.24, -0.42);
  plankShape.closePath();

  const plankGeo = new THREE.ExtrudeGeometry(plankShape, {
    depth: 0.14,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 3,
  });
  plankGeo.center();
  const plank = new THREE.Mesh(plankGeo, woodMat);
  mask.add(plank);

  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), eyeMat);
  eyeL.position.set(-0.12, 0.12, 0.09);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.12;
  mask.add(eyeL, eyeR);

  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.12), beardMat);
  brow.position.set(0, 0.25, 0.1);
  mask.add(brow);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 8), makeMat('#ef4444', 0.45, 0.1));
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.02, 0.14);
  const mouth = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.18, 6, 10), lipMat);
  mouth.rotation.z = Math.PI / 2;
  mouth.position.set(0, -0.15, 0.11);
  const beard = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.28, 7), beardMat);
  beard.rotation.x = Math.PI;
  beard.position.set(0, -0.36, 0.05);
  mask.add(nose, mouth, beard);

  const featherColors = ['#ef4444', '#22c55e', '#facc15', '#38bdf8'];
  featherColors.forEach((col, i) => {
    const f = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.055, 0.28, 6, 8),
      makeMat(col, 0.45, 0.1, col, 0.35),
    );
    const spread = (i - 1.5) * 0.22;
    f.position.set(spread * 0.55, 0.56, 0);
    f.rotation.z = -spread;
    mask.add(f);
  });

  return mask;
}

export function createRocketProjectileModel(): THREE.Group {
  const rocket = new THREE.Group();
  const bodyMat = makeMat('#dc2626', 0.3, 0.5);
  const tipMat = makeMat('#f8fafc', 0.25, 0.4);
  const finMat = makeMat('#18181b', 0.4, 0.6);
  const flameMat = makeMat('#facc15', 0.1, 0.1, '#f97316', 2.2);

  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 1.15, 16), bodyMat);
  fuselage.rotation.x = Math.PI / 2;
  fuselage.castShadow = true;
  rocket.add(fuselage);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.55, 16), tipMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 0.84;
  rocket.add(nose);

  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.38, 0.35), finMat);
    const ang = (i * Math.PI) / 2;
    fin.position.set(Math.cos(ang) * 0.32, Math.sin(ang) * 0.32, -0.4);
    fin.rotation.z = ang + Math.PI / 2;
    rocket.add(fin);
  }

  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.65, 12), flameMat);
  flame.rotation.x = -Math.PI / 2;
  flame.position.z = -0.85;
  rocket.add(flame);

  return rocket;
}

export function createCharacterModel(characterId: CharacterId, isMobile = false): CharacterRig {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  const isJarvinBase = characterId === 'jarvin' || characterId === 'jarvin_exe';
  const isCrashBase = characterId === 'crash' || characterId === 'crash_exe';
  const isOxide = characterId === 'nitros_oxide';
  const isTropy = characterId === 'n_tropy';
  const isPenta = characterId === 'penta_penguin';
  const isFalso = characterId === 'falso_jarvin';
  const isPhoneChar = characterId === 'celular_kart';
  const isPcChar = characterId === 'pc_gamer';

  const skinColor =
    characterId === 'crash'
      ? '#f97316'
      : characterId === 'crash_exe'
        ? '#7f1d1d'
        : isOxide
          ? '#4ade80'
          : isTropy
            ? '#38bdf8'
            : isPenta
              ? '#0f172a'
              : isFalso
                ? '#9ca3af'
                : isPhoneChar
                  ? '#0f172a'
                  : isPcChar
                    ? '#cbd5e1'
                    : characterId === 'armagedon'
                      ? '#334155'
                      : characterId === 'joaquin'
                        ? '#eab68c'
                        : characterId === 'jason'
                          ? '#e5aa84'
                          : characterId === 'lucia'
                            ? '#d99a74'
                            : '#f5cfa0';

  const skinMat = makeMat(skinColor, isTropy || isPcChar || isPhoneChar ? 0.3 : 0.58, isTropy || isPcChar ? 0.35 : 0.03, undefined, 0, isMobile);
  const whiteMat = makeMat('#f8fafc', 0.34, 0.08, undefined, 0, isMobile);
  const darkMat = makeMat('#0f172a', 0.48, 0.18, undefined, 0, isMobile);
  const silverMat = makeMat('#cbd5e1', 0.22, 0.88, undefined, 0, isMobile);

  const outfitColor =
    characterId === 'jarvin'
      ? '#16a34a'
      : characterId === 'jarvin_exe'
        ? '#dc2626'
        : characterId === 'joaquin'
          ? '#dc2626'
          : characterId === 'crash'
            ? '#f97316'
            : characterId === 'crash_exe'
              ? '#450a0a'
              : isOxide
                ? '#15803d'
                : isTropy
                  ? '#1e3a8a'
                  : isPenta
                    ? '#0f172a'
                    : isFalso
                      ? '#84cc16'
                      : isPhoneChar
                        ? '#0284c7'
                        : isPcChar
                          ? '#1e293b'
                          : characterId === 'armagedon'
                            ? '#18181b'
                            : characterId === 'jason'
                              ? '#4d6b3c'
                              : characterId === 'lucia'
                                ? '#881337'
                                : '#7e22ce';

  const pantsColor =
    characterId === 'crash'
      ? '#2563eb'
      : characterId === 'jarvin' || characterId === 'crash_exe' || characterId === 'jarvin_exe'
        ? '#09090b'
        : isOxide
          ? '#1e1b4b'
          : isTropy
            ? '#0f172a'
            : isPenta
              ? '#090d14'
              : isFalso
                ? '#475569'
                : isPhoneChar
                  ? '#0369a1'
                  : isPcChar
                    ? '#0f172a'
                    : characterId === 'joaquin'
                      ? '#090d14'
                      : characterId === 'fedex'
                        ? '#4c1d95'
                        : characterId === 'armagedon'
                          ? '#090d14'
                          : characterId === 'jason'
                            ? '#1e3a5f'
                            : characterId === 'lucia'
                              ? '#1d4ed8'
                              : '#1e293b';

  const outfitMat = makeMat(
    outfitColor,
    characterId === 'armagedon' || isOxide || isTropy || isPcChar || isPhoneChar ? 0.26 : 0.54,
    characterId === 'armagedon' || isOxide || isTropy ? 0.72 : 0.14,
    undefined,
    0,
    isMobile,
  );
  const pantsMat = makeMat(pantsColor, 0.64, 0.08, undefined, 0, isMobile);
  const shoeMat = makeMat(
    isCrashBase
      ? '#dc2626'
      : characterId === 'jarvin'
        ? '#16a34a'
        : characterId === 'jarvin_exe' || characterId === 'armagedon'
          ? '#ef4444'
          : isOxide || isTropy
            ? '#facc15'
            : isPenta
              ? '#f97316'
              : isFalso
                ? '#94a3b8'
                : isPhoneChar
                  ? '#38bdf8'
                  : isPcChar
                    ? '#22c55e'
                    : characterId === 'fedex'
                      ? '#f97316'
                      : characterId === 'jason'
                        ? '#0f172a'
                        : characterId === 'lucia'
                          ? '#ec4899'
                          : '#f8fafc',
    0.34,
    0.16,
    undefined,
    0,
    isMobile,
  );

  // Flexible Spine Bone Hierarchy (disabled on mobile for zero bone-matrix shader overhead)
  const pelvisBone = new THREE.Bone();
  const lumbarBone = new THREE.Bone();
  lumbarBone.position.y = 0.24;
  const chestBone = new THREE.Bone();
  chestBone.position.y = 0.26;
  pelvisBone.add(lumbarBone);
  lumbarBone.add(chestBone);
  const spineBones = isMobile ? [] : [pelvisBone, lumbarBone, chestBone];
  const flexChains: THREE.Bone[][] = [];
  const eyelids: THREE.Mesh[] = [];

  // 1. Articulated Legs (streamlined segments & skip shoe laces/tabs on mobile)
  const makeLeg = (xOffset: number) => {
    const legGroup = new THREE.Group();
    legGroup.position.set(xOffset, 0.72, 0);

    const thighMat = pantsMat;
    const shinMat = characterId === 'crash' ? skinMat : pantsMat;

    if (!isMobile) {
      const hipJoint = new THREE.Mesh(new THREE.SphereGeometry(0.118, 16, 12), thighMat);
      legGroup.add(hipJoint);
    }

    const thigh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.112, 0.19, isMobile ? 4 : 12, isMobile ? 8 : 18),
      thighMat,
    );
    thigh.position.y = -0.14;
    thigh.castShadow = !isMobile;
    legGroup.add(thigh);

    if (!isMobile && characterId === 'crash') {
      const cuffDenim = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.024, 8, 18), makeMat('#1d4ed8', 0.72, 0.05));
      cuffDenim.rotation.x = Math.PI / 2;
      cuffDenim.position.y = -0.24;
      legGroup.add(cuffDenim);
    }

    const kneeGroup = new THREE.Group();
    kneeGroup.position.set(0, -0.28, 0);
    legGroup.add(kneeGroup);

    if (!isMobile) {
      const kneeCap = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 14, 12),
        characterId === 'armagedon' || characterId === 'fedex' ? darkMat : shinMat,
      );
      kneeGroup.add(kneeCap);
    }

    const shin = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.096, 0.2, isMobile ? 4 : 12, isMobile ? 8 : 18),
      shinMat,
    );
    shin.position.y = -0.15;
    shin.castShadow = !isMobile;
    kneeGroup.add(shin);

    if (!isMobile && characterId === 'joaquin') {
      const stripeT = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.17, 6, 10), whiteMat);
      stripeT.position.set(Math.sign(xOffset) * 0.098, -0.14, 0.03);
      const stripeS = new THREE.Mesh(new THREE.CapsuleGeometry(0.021, 0.17, 6, 10), whiteMat);
      stripeS.position.set(Math.sign(xOffset) * 0.088, -0.15, 0.03);
      const legPatch = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.075, 0.025), whiteMat);
      legPatch.position.set(Math.sign(xOffset) * 0.04, -0.12, 0.1);
      legPatch.rotation.y = Math.sign(xOffset) * 0.25;
      legGroup.add(stripeT, legPatch);
      kneeGroup.add(stripeS);
    }

    const shoeGroup = new THREE.Group();
    shoeGroup.position.set(0, -0.32, 0.04);
    kneeGroup.add(shoeGroup);

    const shoeBody = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.102, 0.16, isMobile ? 4 : 12, isMobile ? 8 : 18),
      shoeMat,
    );
    shoeBody.rotation.x = Math.PI / 2;
    shoeBody.position.set(0, -0.02, 0.03);
    shoeBody.castShadow = !isMobile;
    shoeGroup.add(shoeBody);

    if (!isMobile) {
      const ankleCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.108, 0.085, 18), shoeMat);
      ankleCuff.position.set(0, 0.035, -0.02);
      const toeCap = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 16, 14),
        characterId === 'crash' || characterId === 'jarvin' ? whiteMat : shoeMat,
      );
      toeCap.scale.set(1.02, 0.74, 1.08);
      toeCap.position.set(0, -0.03, 0.135);
      const tongue = new THREE.Mesh(new THREE.CapsuleGeometry(0.056, 0.065, 8, 12), whiteMat);
      tongue.rotation.x = -0.42;
      tongue.position.set(0, 0.045, 0.06);
      for (let l = 0; l < 3; l++) {
        const lace = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.09, 6, 8), whiteMat);
        lace.rotation.z = Math.PI / 2;
        lace.position.set(0, 0.065 - l * 0.018, 0.055 + l * 0.032);
        shoeGroup.add(lace);
      }
      const heelTab = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.025), darkMat);
      heelTab.position.set(0, 0.055, -0.105);
      const sole = new THREE.Mesh(new THREE.CapsuleGeometry(0.112, 0.175, 10, 16), whiteMat);
      sole.rotation.x = Math.PI / 2;
      sole.scale.set(1.03, 1.06, 0.44);
      sole.position.set(0, -0.08, 0.04);
      shoeGroup.add(ankleCuff, toeCap, tongue, heelTab, sole);
    }

    return { legGroup, kneeGroup };
  };

  const leftLegBuilt = makeLeg(-0.15);
  const rightLegBuilt = makeLeg(0.15);
  const leftLeg = leftLegBuilt.legGroup;
  const rightLeg = rightLegBuilt.legGroup;
  const leftKnee = leftLegBuilt.kneeGroup;
  const rightKnee = rightLegBuilt.kneeGroup;
  bodyPivot.add(leftLeg, rightLeg);

  // 2. Sculpted Torso (rigid on mobile, 3-bone skinned spine on desktop!)
  const torso = new THREE.Group();
  torso.position.set(0, 1.04, 0);
  bodyPivot.add(torso);

  const torsoProfile = [
    new THREE.Vector2(0.01, -0.34),
    new THREE.Vector2(0.22, -0.31),
    new THREE.Vector2(0.235, -0.14),
    new THREE.Vector2(0.28, 0.08),
    new THREE.Vector2(0.29, 0.24),
    new THREE.Vector2(0.185, 0.35),
    new THREE.Vector2(0.01, 0.36),
  ];
  const chestGeo = new THREE.LatheGeometry(torsoProfile, isMobile ? 12 : 30);
  if (isMobile) {
    const chestMesh = new THREE.Mesh(chestGeo, outfitMat);
    chestMesh.scale.set(1.08, 1, 0.76);
    torso.add(chestMesh);
  } else {
    const tPos = chestGeo.attributes.position;
    const tSkinIdx: number[] = [];
    const tSkinW: number[] = [];
    for (let i = 0; i < tPos.count; i++) {
      const yNorm = THREE.MathUtils.clamp((tPos.getY(i) + 0.34) / 0.7, 0, 1);
      if (yNorm < 0.5) {
        const w = yNorm * 2;
        tSkinIdx.push(0, 1, 0, 0);
        tSkinW.push(1 - w, w, 0, 0);
      } else {
        const w = (yNorm - 0.5) * 2;
        tSkinIdx.push(1, 2, 0, 0);
        tSkinW.push(1 - w, w, 0, 0);
      }
    }
    chestGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(tSkinIdx, 4));
    chestGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(tSkinW, 4));
    pelvisBone.position.set(0, -0.34, 0);

    const chestSkinned = new THREE.SkinnedMesh(chestGeo, outfitMat);
    chestSkinned.scale.set(1.08, 1, 0.76);
    chestSkinned.castShadow = true;
    chestSkinned.add(pelvisBone);
    chestSkinned.bind(new THREE.Skeleton(spineBones));
    chestSkinned.frustumCulled = false;
    torso.add(chestSkinned);
  }

  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.105, 0.128, 0.21, isMobile ? 8 : 20),
    characterId === 'armagedon' ? darkMat : skinMat,
  );
  neck.position.set(0, 0.39, 0);
  torso.add(neck);

  // Flexible Secondary Skinned Appendages per Character!
  if (characterId === 'jarvin') {
    const hoodRing = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.078, 14, 28), outfitMat);
    hoodRing.rotation.x = Math.PI / 2.2;
    hoodRing.position.set(0, 0.32, -0.04);

    // Skinned flexible hood drape behind shoulders
    const hoodCape = createSkinnedRibbonCape(0.36, 0.42, 3, new THREE.MeshStandardMaterial({
      color: '#15803d',
      roughness: 0.65,
      side: THREE.DoubleSide,
    }));
    hoodCape.mesh.position.set(0, 0.32, -0.2);
    hoodCape.mesh.rotation.x = 0.28;
    torso.add(hoodCape.mesh);
    flexChains.push(hoodCape.bones);

    const pocket = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.17, 10, 16), makeMat('#15803d', 0.68, 0.05));
    pocket.rotation.z = Math.PI / 2;
    pocket.scale.set(0.85, 1, 0.55);
    pocket.position.set(0, -0.14, 0.185);
    const chestZip = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.34, 0.02), silverMat);
    chestZip.position.set(0, 0.12, 0.215);
    const ribHem = new THREE.Mesh(new THREE.TorusGeometry(0.222, 0.04, 10, 24), makeMat('#15803d', 0.68, 0.05));
    ribHem.rotation.x = Math.PI / 2;
    ribHem.scale.set(1.06, 0.78, 1);
    ribHem.position.y = -0.29;

    // Flexible skinned hoodie drawstrings
    [-0.065, 0.065].forEach((dx) => {
      const cord = createSkinnedChainMesh(0.22, 0.015, 0.013, 3, whiteMat);
      cord.mesh.position.set(dx, 0.25, 0.215);
      cord.mesh.rotation.x = Math.PI;
      torso.add(cord.mesh);
      flexChains.push(cord.bones);
    });
    torso.add(hoodRing, pocket, chestZip, ribHem);
  } else if (characterId === 'jarvin_exe') {
    // Jarvin.exe: Saco rojo formal oscuro + corbata negra + capa sombría
    const innerShirt = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.36, 12, 18), darkMat);
    innerShirt.scale.set(0.92, 1, 0.45);
    innerShirt.position.set(0, 0.01, 0.168);
    const redCollar = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.058, 12, 24, Math.PI * 1.4), outfitMat);
    redCollar.rotation.x = Math.PI / 2;
    redCollar.rotation.z = Math.PI * 0.8;
    redCollar.position.set(0, 0.33, -0.02);

    const lapelL = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.36, 8, 14), makeMat('#991b1b', 0.4, 0.2));
    lapelL.position.set(-0.118, 0.04, 0.2);
    lapelL.rotation.z = -0.16;
    const lapelR = lapelL.clone();
    lapelR.position.x = 0.118;
    lapelR.rotation.z = 0.16;

    const exeCoatTail = createSkinnedRibbonCape(0.42, 0.56, 4, new THREE.MeshStandardMaterial({
      color: '#b91c1c',
      emissive: '#ef4444',
      emissiveIntensity: 0.25,
      roughness: 0.45,
      side: THREE.DoubleSide,
    }));
    exeCoatTail.mesh.position.set(0, 0.08, -0.22);
    exeCoatTail.mesh.rotation.x = 0.24;
    torso.add(exeCoatTail.mesh);
    flexChains.push(exeCoatTail.bones);

    torso.add(innerShirt, redCollar, lapelL, lapelR);
  } else if (characterId === 'joaquin') {
    const innerShirt = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.36, 12, 18), darkMat);
    innerShirt.scale.set(0.92, 1, 0.45);
    innerShirt.position.set(0, 0.01, 0.165);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.056, 12, 24, Math.PI * 1.4), outfitMat);
    collar.rotation.x = Math.PI / 2;
    collar.rotation.z = Math.PI * 0.8;
    collar.position.set(0, 0.33, -0.02);

    const lapelL = new THREE.Mesh(new THREE.CapsuleGeometry(0.044, 0.34, 8, 14), makeMat('#991b1b', 0.48, 0.12));
    lapelL.position.set(-0.118, 0.04, 0.198);
    lapelL.rotation.z = -0.16;
    const lapelR = lapelL.clone();
    lapelR.position.x = 0.118;
    lapelR.rotation.z = 0.16;

    const cmBadge = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.032, 20), whiteMat);
    cmBadge.rotation.x = Math.PI / 2;
    cmBadge.position.set(-0.168, 0.12, 0.208);
    const cmInner = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.068, 0.038), outfitMat);
    cmInner.position.set(-0.168, 0.12, 0.211);

    const crestR = new THREE.Mesh(new THREE.OctahedronGeometry(0.056, 0), silverMat);
    crestR.scale.set(1, 1.25, 0.42);
    crestR.position.set(0.168, 0.12, 0.208);

    // Flexible skinned jacket back tail
    const jacketTail = createSkinnedRibbonCape(0.38, 0.44, 3, new THREE.MeshStandardMaterial({
      color: '#dc2626',
      roughness: 0.45,
      side: THREE.DoubleSide,
    }));
    jacketTail.mesh.position.set(0, 0.06, -0.21);
    jacketTail.mesh.rotation.x = 0.22;
    torso.add(jacketTail.mesh);
    flexChains.push(jacketTail.bones);

    const hem = new THREE.Mesh(new THREE.TorusGeometry(0.224, 0.04, 10, 24), darkMat);
    hem.rotation.x = Math.PI / 2;
    hem.scale.set(1.06, 0.78, 1);
    hem.position.y = -0.28;

    torso.add(innerShirt, collar, lapelL, lapelR, cmBadge, cmInner, crestR, hem);
  } else if (isCrashBase) {
    const belly = new THREE.Mesh(
      new THREE.SphereGeometry(0.235, 24, 18),
      makeMat(characterId === 'crash_exe' ? '#fca5a5' : '#fed7aa', 0.72, 0.02),
    );
    belly.scale.set(0.92, 1.32, 0.54);
    belly.position.set(0, -0.01, 0.158);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.224, 0.044, 10, 24), makeMat('#78350f', 0.6, 0.1));
    belt.rotation.x = Math.PI / 2;
    belt.scale.set(1.06, 0.78, 1);
    belt.position.y = -0.27;
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.075, 0.04), makeMat('#facc15', 0.25, 0.85));
    buckle.position.set(0, -0.27, 0.185);
    torso.add(belly, belt, buckle);
  } else if (isOxide) {
    const chestArmor = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.24, 12, 18), makeMat('#166534', 0.28, 0.75));
    chestArmor.scale.set(1.12, 0.9, 0.76);
    chestArmor.position.set(0, 0.08, 0.04);
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.11, 0),
      makeMat('#84cc16', 0.1, 0.2, '#84cc16', 2.2),
    );
    core.position.set(0, 0.09, 0.22);
    const alienJet = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.34, 14), makeMat('#facc15', 0.25, 0.8));
    alienJet.position.set(0, 0.12, -0.24);
    torso.add(chestArmor, core, alienJet);
  } else if (characterId === 'armagedon') {
    const chestPlate = new THREE.Mesh(new THREE.CapsuleGeometry(0.245, 0.21, 12, 18), makeMat('#27272a', 0.26, 0.88));
    chestPlate.scale.set(1.15, 0.86, 0.74);
    chestPlate.position.set(0, 0.09, 0.06);
    const coreHousing = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.034, 12, 24), silverMat);
    coreHousing.position.set(0, 0.1, 0.228);
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.108, 1),
      makeMat('#ef4444', 0.1, 0.2, '#ef4444', 2.5),
    );
    core.position.set(0, 0.1, 0.232);
    const armorBelt = new THREE.Mesh(new THREE.TorusGeometry(0.248, 0.06, 12, 24), makeMat('#3f3f46', 0.25, 0.84));
    armorBelt.rotation.x = Math.PI / 2;
    armorBelt.scale.set(1.06, 0.78, 1);
    armorBelt.position.y = -0.22;

    // Flexible 4-bone Skinned Fiery Crimson Cape!
    const warCape = createSkinnedRibbonCape(0.56, 0.82, 4, new THREE.MeshStandardMaterial({
      color: '#991b1b',
      emissive: '#ef4444',
      emissiveIntensity: 0.35,
      roughness: 0.5,
      side: THREE.DoubleSide,
    }));
    warCape.mesh.position.set(0, 0.32, -0.21);
    warCape.mesh.rotation.x = 0.26;
    torso.add(warCape.mesh);
    flexChains.push(warCape.bones);

    torso.add(chestPlate, coreHousing, core, armorBelt);
  } else if (characterId === 'fedex') {
    const harnessL = new THREE.Mesh(new THREE.CapsuleGeometry(0.034, 0.42, 8, 12), makeMat('#f97316', 0.35, 0.25));
    harnessL.position.set(-0.11, 0.02, 0.2);
    harnessL.rotation.z = -0.15;
    const harnessR = harnessL.clone();
    harnessR.position.x = 0.11;
    harnessR.rotation.z = 0.15;
    const chestStrap = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.055, 0.04), whiteMat);
    chestStrap.position.set(0, 0.02, 0.215);
    const aeroHump = new THREE.Mesh(new THREE.CapsuleGeometry(0.145, 0.22, 12, 18), makeMat('#f97316', 0.3, 0.25));
    aeroHump.scale.set(0.9, 1.1, 0.72);
    aeroHump.position.set(0, 0.14, -0.185);

    // Twin flexible racing speed scarf ribbons!
    [-0.1, 0.1].forEach((sx) => {
      const scarf = createSkinnedRibbonCape(0.12, 0.68, 4, new THREE.MeshStandardMaterial({
        color: '#f97316',
        emissive: '#f97316',
        emissiveIntensity: 0.3,
        roughness: 0.4,
        side: THREE.DoubleSide,
      }));
      scarf.mesh.position.set(sx, 0.32, -0.22);
      scarf.mesh.rotation.x = 0.45;
      torso.add(scarf.mesh);
      flexChains.push(scarf.bones);
    });

    torso.add(harnessL, harnessR, chestStrap, aeroHump);
  } else if (characterId === 'jason') {
    // Jason (GTA 6): Olive tank top neckline + silver dog tags + Vice City belt
    const tankSkin = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 14), skinMat);
    tankSkin.scale.set(1.05, 0.7, 0.52);
    tankSkin.position.set(0, 0.27, 0.145);
    const chainRing = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.011, 8, 20), silverMat);
    chainRing.rotation.x = Math.PI / 2.4;
    chainRing.position.set(0, 0.28, 0.04);
    const dogTag1 = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, 0.012), silverMat);
    dogTag1.position.set(-0.02, 0.15, 0.22);
    dogTag1.rotation.z = 0.12;
    const dogTag2 = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, 0.012), silverMat);
    dogTag2.position.set(0.02, 0.135, 0.226);
    dogTag2.rotation.z = -0.15;
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.222, 0.036, 10, 24), darkMat);
    belt.rotation.x = Math.PI / 2;
    belt.scale.set(1.06, 0.78, 1);
    belt.position.y = -0.27;
    torso.add(tankSkin, chainRing, dogTag1, dogTag2, belt);
  } else if (characterId === 'lucia') {
    // Lucia (GTA 6): Burgundy Vice top + gold necklace chain + denim waist belt
    const neckSkin = new THREE.Mesh(new THREE.SphereGeometry(0.165, 18, 14), skinMat);
    neckSkin.scale.set(1.02, 0.65, 0.5);
    neckSkin.position.set(0, 0.28, 0.145);
    const goldMat = makeMat('#facc15', 0.2, 0.85, '#eab308', 0.2);
    const goldChain = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.016, 10, 22), goldMat);
    goldChain.rotation.x = Math.PI / 2.5;
    goldChain.position.set(0, 0.26, 0.055);
    const goldPendant = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.032, 0.016), goldMat);
    goldPendant.position.set(0, 0.155, 0.218);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 10, 24), makeMat('#1d4ed8', 0.6, 0.08));
    belt.rotation.x = Math.PI / 2;
    belt.scale.set(1.06, 0.78, 1);
    belt.position.y = -0.27;
    torso.add(neckSkin, goldChain, goldPendant, belt);
  } else if (isTropy) {
    // Dr. N. Tropy: Brass clockwork chest emblem + dual shoulder exhaust pipes!
    const brassMat = makeMat('#facc15', 0.2, 0.85, '#eab308', 0.25);
    const dialRing = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.028, 10, 20), brassMat);
    dialRing.position.set(0, 0.08, 0.225);
    const dialGlow = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), makeMat('#38bdf8', 0.1, 0.2, '#38bdf8', 1.8));
    dialGlow.position.set(0, 0.08, 0.228);
    torso.add(dialRing, dialGlow);
    [-0.18, 0.18].forEach((px) => {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.44, 12), brassMat);
      pipe.position.set(px, 0.34, -0.2);
      pipe.rotation.x = -0.24;
      torso.add(pipe);
    });
  } else if (isPenta) {
    // Penta Penguin: White penguin belly + bright red racing scarf!
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 14), whiteMat);
    belly.scale.set(0.9, 1.3, 0.56);
    belly.position.set(0, -0.02, 0.165);
    const scarfRing = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.055, 10, 20), makeMat('#dc2626', 0.55, 0.05));
    scarfRing.rotation.x = Math.PI / 2;
    scarfRing.position.set(0, 0.32, 0);
    const scarfTail = createSkinnedRibbonCape(0.14, 0.56, 3, new THREE.MeshStandardMaterial({
      color: '#dc2626',
      roughness: 0.5,
      side: THREE.DoubleSide,
    }));
    scarfTail.mesh.position.set(0.08, 0.32, -0.22);
    scarfTail.mesh.rotation.x = 0.38;
    torso.add(belly, scarfRing, scarfTail.mesh);
    flexChains.push(scarfTail.bones);
  } else if (isFalso) {
    // Falso Jarvin: Unfinished prototype torso with mismatched clay cube + criss-cross duct tape!
    const clayBox = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.28, 0.12), makeMat('#64748b', 0.85, 0.05));
    clayBox.position.set(-0.04, 0.06, 0.18);
    clayBox.rotation.z = 0.08;
    const tape1 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.065, 0.03), makeMat('#cbd5e1', 0.35, 0.25));
    tape1.position.set(0, 0.08, 0.24);
    tape1.rotation.z = 0.55;
    const tape2 = tape1.clone();
    tape2.rotation.z = -0.52;
    const exposedWire = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.015, 6, 12), makeMat('#facc15', 0.3, 0.4));
    exposedWire.position.set(0.18, -0.1, 0.16);
    torso.add(clayBox, tape1, tape2, exposedWire);
  } else if (isPhoneChar) {
    // Celular Kart: Glowing App Battery core chest
    const batteryPlate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.46, 0.14), makeMat('#0f172a', 0.2, 0.75));
    batteryPlate.position.set(0, 0.04, 0.14);
    const ledBar = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.04), makeMat('#22d3ee', 0.1, 0.2, '#22d3ee', 2.0));
    ledBar.position.set(0, 0.06, 0.21);
    torso.add(batteryPlate, ledBar);
  } else if (isPcChar) {
    // PC Gamer: Desktop Tower + RGB Fan chest + Mechanical Keyboard collar!
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.52, 0.28), makeMat('#0f172a', 0.25, 0.72));
    tower.position.set(0, 0.04, 0.06);
    const rgbFan = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 8, 18), makeMat('#22c55e', 0.1, 0.2, '#22c55e', 2.2));
    rgbFan.position.set(0, 0.08, 0.21);
    const kb = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.16), makeMat('#334155', 0.35, 0.4));
    kb.position.set(0, 0.3, 0.16);
    kb.rotation.x = 0.35;
    torso.add(tower, rgbFan, kb);
  }

  // 3. Articulated Arms (streamlined segments on mobile)
  const makeArm = (xOffset: number) => {
    const armGroup = new THREE.Group();
    armGroup.position.set(xOffset, 1.31, 0);

    const upperMat =
      characterId === 'crash' || characterId === 'jason' || characterId === 'lucia' ? skinMat : outfitMat;
    const lowerMat =
      characterId === 'crash' || characterId === 'jason' || characterId === 'lucia' ? skinMat : outfitMat;
    const gloveMat =
      characterId === 'crash'
        ? makeMat('#451a03', 0.65, 0.1, undefined, 0, isMobile)
        : characterId === 'armagedon'
          ? makeMat('#27272a', 0.28, 0.86, undefined, 0, isMobile)
          : characterId === 'fedex'
            ? makeMat('#f97316', 0.38, 0.2, undefined, 0, isMobile)
            : skinMat;

    const shoulder = new THREE.Mesh(
      new THREE.SphereGeometry(0.128, isMobile ? 8 : 18, isMobile ? 6 : 14),
      upperMat,
    );
    armGroup.add(shoulder);

    if (characterId === 'armagedon') {
      const pauldron = new THREE.Mesh(
        new THREE.ConeGeometry(0.185, 0.29, isMobile ? 7 : 14),
        makeMat('#ef4444', 0.26, 0.62, undefined, 0, isMobile),
      );
      pauldron.position.set(Math.sign(xOffset) * 0.055, 0.105, 0);
      pauldron.rotation.z = -Math.sign(xOffset) * 0.45;
      armGroup.add(pauldron);
    }

    const bicep = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.088, 0.19, isMobile ? 4 : 12, isMobile ? 8 : 18),
      upperMat,
    );
    bicep.position.y = -0.15;
    bicep.castShadow = !isMobile;
    armGroup.add(bicep);

    const elbowGroup = new THREE.Group();
    elbowGroup.position.set(0, -0.29, 0);
    armGroup.add(elbowGroup);

    if (!isMobile) {
      const elbowCap = new THREE.Mesh(new THREE.SphereGeometry(0.084, 14, 12), lowerMat);
      elbowGroup.add(elbowCap);
    }

    const forearm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.08, 0.19, isMobile ? 4 : 12, isMobile ? 8 : 18),
      lowerMat,
    );
    forearm.position.y = -0.15;
    forearm.castShadow = !isMobile;
    elbowGroup.add(forearm);

    if (!isMobile) {
      const cuff = new THREE.Mesh(
        new THREE.TorusGeometry(0.082, 0.024, 10, 18),
        characterId === 'crash' ? makeMat('#78350f', 0.58, 0.12) : whiteMat,
      );
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = -0.26;
      elbowGroup.add(cuff);
    }

    const handGroup = new THREE.Group();
    handGroup.position.set(0, -0.34, 0.02);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.094, isMobile ? 8 : 16, isMobile ? 6 : 14), gloveMat);
    palm.scale.set(0.96, 1.05, 1.1);
    handGroup.add(palm);
    if (!isMobile) {
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.029, 0.058, 8, 10), gloveMat);
      thumb.position.set(-Math.sign(xOffset) * 0.076, 0.02, 0.042);
      thumb.rotation.z = Math.sign(xOffset) * 0.6;
      const knuckles = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.024, 0.075, 6, 10),
        characterId === 'crash' ? makeMat('#78350f', 0.5, 0.15) : gloveMat,
      );
      knuckles.rotation.z = Math.PI / 2;
      knuckles.position.set(0, 0.015, 0.088);
      handGroup.add(thumb, knuckles);
    }
    elbowGroup.add(handGroup);

    return { armGroup, elbowGroup };
  };

  const leftArmBuilt = makeArm(-0.37);
  const rightArmBuilt = makeArm(0.37);
  const leftArm = leftArmBuilt.armGroup;
  const rightArm = rightArmBuilt.armGroup;
  const leftElbow = leftArmBuilt.elbowGroup;
  const rightElbow = rightArmBuilt.elbowGroup;
  bodyPivot.add(leftArm, rightArm);

  // 4. Expressive Head + Dynamic Facial Expressions!
  const head = new THREE.Group();
  head.position.set(0, 1.72, 0);
  bodyPivot.add(head);

  const segW = isMobile ? 12 : 34;
  const segH = isMobile ? 9 : 26;
  const craniumGeo = isPhoneChar
    ? new THREE.BoxGeometry(0.56, 0.76, 0.16)
    : isPcChar
      ? new THREE.BoxGeometry(0.64, 0.54, 0.48)
      : isFalso
        ? new THREE.BoxGeometry(0.54, 0.56, 0.52)
        : new THREE.SphereGeometry(0.288, segW, segH);
  const cranium = new THREE.Mesh(craniumGeo, skinMat);
  if (!isPhoneChar && !isPcChar && !isFalso) {
    cranium.scale.set(isOxide ? 0.96 : 1.0, isOxide ? 1.32 : isTropy ? 1.15 : 1.06, 0.97);
  }
  cranium.castShadow = !isMobile;
  head.add(cranium);

  if (!isMobile && !isCrashBase && !isPhoneChar && !isPcChar && !isPenta && !isFalso && characterId !== 'armagedon' && characterId !== 'fedex' && !isOxide) {
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.212, 24, 18), skinMat);
    jaw.scale.set(0.96, 0.72, 0.86);
    jaw.position.set(0, -0.145, 0.062);
    head.add(jaw);

    const blushMat = makeMat('#f4a688', 0.68, 0.02);
    [-0.145, 0.145].forEach((cx) => {
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.056, 10, 8), blushMat);
      cheek.scale.set(1.15, 0.72, 0.45);
      cheek.position.set(cx, -0.05, 0.228);
      head.add(cheek);
    });

    [-0.278, 0.278].forEach((ex) => {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.068, 12, 10), skinMat);
      ear.scale.set(0.45, 0.96, 0.78);
      ear.position.set(ex, -0.02, -0.01);
      const innerEar = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 6), makeMat('#d99b76', 0.7, 0.02));
      innerEar.scale.set(0.35, 0.75, 0.55);
      innerEar.position.set(ex + Math.sign(ex) * 0.014, -0.02, 0.005);
      head.add(ear, innerEar);
    });
  }

  // Curved or Flat 2D CanvasTexture Face Patch mapped onto the 3D character head!
  const faceCanvas = document.createElement('canvas');
  faceCanvas.width = isMobile ? 256 : 512;
  faceCanvas.height = isMobile ? 144 : 288;
  const faceCtx = faceCanvas.getContext('2d')!;
  const faceTexture = new THREE.CanvasTexture(faceCanvas);
  faceTexture.colorSpace = THREE.SRGBColorSpace;
  faceTexture.anisotropy = isMobile ? 1 : 4;

  const isHelmeted = characterId === 'armagedon' || characterId === 'fedex';
  const isFlatFace = isPhoneChar || isPcChar || isFalso;
  const facePatchR = isHelmeted ? 0.342 : 0.296;
  const facePhiSpan = Math.PI * 0.74;
  const faceThetaStart = Math.PI * 0.27;
  const faceThetaSpan = Math.PI * 0.56;
  const facePatchGeo = isFlatFace
    ? new THREE.PlaneGeometry(isPcChar ? 0.54 : 0.48, isPhoneChar ? 0.64 : 0.42)
    : new THREE.SphereGeometry(
        facePatchR,
        isMobile ? 18 : 30,
        isMobile ? 12 : 20,
        Math.PI * 0.5 - facePhiSpan * 0.5,
        facePhiSpan,
        faceThetaStart,
        faceThetaSpan,
      );
  const facePatchMat = new THREE.MeshBasicMaterial({
    map: faceTexture,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const facePatchMesh = new THREE.Mesh(facePatchGeo, facePatchMat);
  if (isFlatFace) {
    facePatchMesh.position.set(0, 0, isPhoneChar ? 0.09 : isPcChar ? 0.25 : 0.27);
  } else {
    facePatchMesh.scale.set(
      isOxide ? 0.96 : 1.0,
      isOxide ? 1.32 : isTropy ? 1.15 : isHelmeted ? 1.04 : 1.06,
      isHelmeted ? (characterId === 'fedex' ? 1.12 : 1.06) : 0.97,
    );
  }
  facePatchMesh.renderOrder = 2;
  head.add(facePatchMesh);

  let snoutCanvas: HTMLCanvasElement | undefined;
  let snoutCtx: CanvasRenderingContext2D | undefined;
  let snoutTexture: THREE.CanvasTexture | undefined;

  if (isCrashBase) {
    const snout = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 28, 20),
      makeMat(characterId === 'crash_exe' ? '#fca5a5' : '#fed7aa', 0.68, 0.02),
    );
    snout.scale.set(1.18, 0.78, 1.14);
    snout.position.set(0, -0.06, 0.248);

    const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.068, 18, 14), darkMat);
    noseTip.scale.set(1.18, 0.85, 1.0);
    noseTip.position.set(0, 0.012, 0.448);

    // Curved 2D mouth decal wrapped cleanly across Crash's 3D snout!
    snoutCanvas = document.createElement('canvas');
    snoutCanvas.width = 384;
    snoutCanvas.height = 192;
    snoutCtx = snoutCanvas.getContext('2d')!;
    snoutTexture = new THREE.CanvasTexture(snoutCanvas);
    snoutTexture.colorSpace = THREE.SRGBColorSpace;
    const snoutMouthGeo = new THREE.SphereGeometry(
      0.197,
      24,
      16,
      Math.PI * 0.5 - Math.PI * 0.36,
      Math.PI * 0.72,
      Math.PI * 0.44,
      Math.PI * 0.44,
    );
    const snoutMouthMesh = new THREE.Mesh(
      snoutMouthGeo,
      new THREE.MeshBasicMaterial({
        map: snoutTexture,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    snoutMouthMesh.scale.set(1.18, 0.78, 1.14);
    snoutMouthMesh.position.set(0, -0.06, 0.248);
    snoutMouthMesh.renderOrder = 3;

    // Flexible Skinned Bandicoot Ears!
    [-1, 1].forEach((side) => {
      const earSkinned = createSkinnedChainMesh(0.32, 0.095, 0.015, 3, skinMat);
      earSkinned.mesh.position.set(side * 0.25, 0.14, -0.02);
      earSkinned.mesh.rotation.z = -side * 0.58;
      head.add(earSkinned.mesh);
      flexChains.push(earSkinned.bones);
    });

    // Flexible Skinned Red Mohawk Crest!
    const mohawkMat = makeMat(characterId === 'crash_exe' ? '#991b1b' : '#dc2626', 0.54, 0.06);
    for (let i = 0; i < 4; i++) {
      const spikeSkinned = createSkinnedChainMesh(0.3, 0.075 - i * 0.008, 0.008, 3, mohawkMat);
      spikeSkinned.mesh.position.set(0, 0.26 - i * 0.03, 0.06 - i * 0.085);
      spikeSkinned.mesh.rotation.x = -0.35 - i * 0.22;
      head.add(spikeSkinned.mesh);
      flexChains.push(spikeSkinned.bones);
    }
    head.add(snout, noseTip, snoutMouthMesh);
  }

  // Orbiting Dizzy Stars Group above character head (shown when hurt/dizzy/TNT/slippery)
  const dizzyGroup = new THREE.Group();
  dizzyGroup.position.set(0, 0.62, 0);
  dizzyGroup.visible = false;
  const starMat = makeMat('#facc15', 0.15, 0.3, '#facc15', 1.6);
  for (let s = 0; s < 3; s++) {
    const ang = (s / 3) * Math.PI * 2;
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), starMat);
    star.position.set(Math.cos(ang) * 0.34, 0, Math.sin(ang) * 0.34);
    dizzyGroup.add(star);
  }
  head.add(dizzyGroup);

  let crown: THREE.Group | undefined;

  if (isJarvinBase) {
    const hairMat = makeMat(characterId === 'jarvin_exe' ? '#090d14' : '#3b2314', 0.76, 0.06);
    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.308, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.58),
      hairMat,
    );
    hairCap.position.set(0, 0.036, -0.02);
    head.add(hairCap);

    for (let i = 0; i < 22; i++) {
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.078, 0.23, 12), hairMat);
      const ang = (i / 22) * Math.PI * 2;
      const rad = i % 2 === 0 ? 0.235 : 0.165;
      tuft.position.set(Math.cos(ang) * rad, 0.215 + (i % 3) * 0.03, Math.sin(ang) * rad);
      tuft.rotation.set(Math.sin(ang) * 0.72, 0, -Math.cos(ang) * 0.72);
      head.add(tuft);
    }

    const hpMat = makeMat('#090d14', 0.24, 0.76);
    const padMat = makeMat('#1e293b', 0.78, 0.05);
    const hpColor = characterId === 'jarvin_exe' ? '#ef4444' : '#22c55e';
    const hpGlow = makeMat(hpColor, 0.15, 0.3, hpColor, 1.15);
    [-1, 1].forEach((side) => {
      const cushion = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.04, 12, 24), padMat);
      cushion.rotation.y = Math.PI / 2;
      cushion.position.set(side * 0.288, 0.01, 0);
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.128, 0.128, 0.078, 24), hpMat);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(side * 0.328, 0.01, 0);
      const ledRing = new THREE.Mesh(new THREE.TorusGeometry(0.098, 0.019, 12, 24), hpGlow);
      ledRing.rotation.y = Math.PI / 2;
      ledRing.position.set(side * 0.368, 0.01, 0);
      head.add(cushion, cup, ledRing);
    });
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.328, 0.036, 14, 32, Math.PI), hpMat);
    band.position.set(0, 0.06, 0);
    const micArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.16, 6, 8), hpMat);
    micArm.position.set(-0.27, -0.08, 0.12);
    micArm.rotation.set(0.95, 0, -0.5);
    head.add(band, micArm);

    crown = new THREE.Group();
    crown.position.set(-0.08, 0.56, 0);
    crown.rotation.z = 0.18;
    const goldMat =
      characterId === 'jarvin_exe'
        ? makeMat('#18181b', 0.2, 0.8, '#ef4444', 0.65)
        : makeMat('#facc15', 0.18, 0.84, '#eab308', 0.4);
    const velvetMat = makeMat('#dc2626', 0.72, 0.05);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.218, 0.178, 0.125, 24), goldMat);
    const velvetCap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), velvetMat);
    velvetCap.scale.set(1, 0.6, 1);
    velvetCap.position.y = 0.03;
    const baseRim = new THREE.Mesh(new THREE.TorusGeometry(0.182, 0.026, 12, 24), goldMat);
    baseRim.rotation.x = Math.PI / 2;
    baseRim.position.y = -0.05;
    crown.add(base, velvetCap, baseRim);
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.155, 12), goldMat);
      spike.position.set(Math.cos(ang) * 0.158, 0.12, Math.sin(ang) * 0.158);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), goldMat);
      orb.position.set(Math.cos(ang) * 0.158, 0.205, Math.sin(ang) * 0.158);
      const gemColor = characterId === 'jarvin_exe' ? '#ef4444' : i % 2 === 0 ? '#22c55e' : '#ef4444';
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.025, 0),
        makeMat(gemColor, 0.12, 0.3, gemColor, 0.95),
      );
      gem.position.set(Math.cos(ang) * 0.198, 0, Math.sin(ang) * 0.198);
      crown.add(spike, orb, gem);
    }
    head.add(crown);
  } else if (isOxide) {
    // Tall alien fins + neon crest + red racing goggles
    const finMat = makeMat('#facc15', 0.3, 0.4, '#84cc16', 0.45);
    [-1, 1].forEach((side) => {
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.34, 8), finMat);
      fin.position.set(side * 0.25, 0.3, -0.04);
      fin.rotation.z = -side * 0.55;
      head.add(fin);
    });
    const centerCrest = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.44), finMat);
    centerCrest.position.set(0, 0.38, -0.04);
    const goggleRim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.08, 22, 1, true, -Math.PI * 0.36, Math.PI * 0.72),
      makeMat('#ef4444', 0.15, 0.4, '#ef4444', 1.1),
    );
    goggleRim.position.set(0, 0.04, 0.025);
    head.add(centerCrest, goggleRim);
  } else if (characterId === 'joaquin') {
    const curlMat = makeMat('#0f172a', 0.84, 0.06);
    const baseHair = new THREE.Mesh(
      new THREE.SphereGeometry(0.298, 26, 18, 0, Math.PI * 2, 0, Math.PI * 0.56),
      curlMat,
    );
    baseHair.position.set(0, 0.03, -0.02);
    head.add(baseHair);

    for (let i = 0; i < 40; i++) {
      const ring = i < 18 ? 0 : i < 31 ? 1 : 2;
      const countInRing = ring === 0 ? 18 : ring === 1 ? 13 : 9;
      const idxInRing = ring === 0 ? i : ring === 1 ? i - 18 : i - 31;
      const ang = (idxInRing / countInRing) * Math.PI * 2 + ring * 0.35;
      const rad = ring === 0 ? 0.248 : ring === 1 ? 0.165 : 0.075;
      const yPos = ring === 0 ? 0.175 + (i % 3) * 0.022 : ring === 1 ? 0.288 : 0.348;
      const curl = new THREE.Mesh(new THREE.SphereGeometry(0.088 + (i % 3) * 0.011, 14, 12), curlMat);
      curl.position.set(Math.cos(ang) * rad, yPos, Math.sin(ang) * rad);
      head.add(curl);
    }

    crown = new THREE.Group();
    crown.position.set(-0.2, 0.49, 0.02);
    crown.rotation.z = 0.36;
    const darkCrownMat = makeMat('#18181b', 0.28, 0.74);
    const neonGreenMat = makeMat('#22c55e', 0.15, 0.3, '#22c55e', 1.35);
    const neonPurpleMat = makeMat('#a855f7', 0.15, 0.3, '#a855f7', 1.15);
    const cBase = new THREE.Mesh(new THREE.CylinderGeometry(0.198, 0.158, 0.125, 20), darkCrownMat);
    const cRim = new THREE.Mesh(new THREE.TorusGeometry(0.178, 0.021, 12, 24), neonGreenMat);
    cRim.rotation.x = Math.PI / 2;
    cRim.position.y = -0.05;
    const cTopRim = new THREE.Mesh(new THREE.TorusGeometry(0.198, 0.015, 10, 24), neonPurpleMat);
    cTopRim.rotation.x = Math.PI / 2;
    cTopRim.position.y = 0.05;
    crown.add(cBase, cRim, cTopRim);
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.145, 12), darkCrownMat);
      spike.position.set(Math.cos(ang) * 0.148, 0.115, Math.sin(ang) * 0.148);
      crown.add(spike);
    }

    const vBadgeGroup = new THREE.Group();
    vBadgeGroup.position.set(0.36, 0.36, 0.05);
    vBadgeGroup.rotation.z = -0.18;
    const vSquare = new THREE.Mesh(
      new THREE.BoxGeometry(0.125, 0.125, 0.038),
      makeMat('#2563eb', 0.2, 0.2, '#3b82f6', 0.75),
    );
    const checkShort = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.032, 6, 8), whiteMat);
    checkShort.position.set(-0.016, -0.008, 0.024);
    checkShort.rotation.z = 0.7;
    const checkLong = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.058, 6, 8), whiteMat);
    checkLong.position.set(0.015, 0.006, 0.024);
    checkLong.rotation.z = -0.65;
    vBadgeGroup.add(vSquare, checkShort, checkLong);

    head.add(crown, vBadgeGroup);
  } else if (characterId === 'armagedon') {
    const helmMat = makeMat('#18181b', 0.22, 0.88);
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.328, 32, 24), helmMat);
    helm.scale.set(1.02, 1.05, 1.05);
    const visorSlit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.33, 0.33, 0.085, 28, 1, true, -Math.PI * 0.32, Math.PI * 0.64),
      makeMat('#ef4444', 0.1, 0.2, '#ef4444', 2.4),
    );
    visorSlit.position.set(0, 0.02, 0.022);
    const mouthGrill = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.11, 12), silverMat);
    mouthGrill.position.set(0, -0.14, 0.14);
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.165, 0.45), makeMat('#ef4444', 0.28, 0.65));
    crest.position.set(0, 0.295, -0.02);
    [-1, 1].forEach((side) => {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.082, 0.4, 14), makeMat('#ef4444', 0.26, 0.68, '#ef4444', 0.45));
      horn.position.set(side * 0.255, 0.34, -0.02);
      horn.rotation.z = -side * 0.48;
      horn.rotation.x = -0.2;
      head.add(horn);
    });
    head.add(helm, visorSlit, mouthGrill, crest);
  } else if (characterId === 'fedex') {
    const helmetMat = makeMat('#7e22ce', 0.2, 0.48);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.328, 32, 24), helmetMat);
    helmet.scale.set(0.98, 1.04, 1.12);
    const visor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.332, 0.332, 0.165, 28, 1, true, -Math.PI * 0.38, Math.PI * 0.76),
      makeMat('#f97316', 0.08, 0.92, '#fb923c', 0.7),
    );
    visor.position.set(0, 0.02, 0.032);
    const chinGuard = new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.058, 12, 22, Math.PI), makeMat('#18181b', 0.38, 0.62));
    chinGuard.rotation.x = Math.PI / 2;
    chinGuard.position.set(0, -0.1, 0.085);
    const aeroFin = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.13, 0.38), makeMat('#f97316', 0.28, 0.32));
    aeroFin.position.set(0, 0.315, -0.08);
    head.add(helmet, visor, chinGuard, aeroFin);
  } else if (characterId === 'jason') {
    // Jason (GTA 6): Tousled brown hair + backwards dark Vice City cap!
    const brownHairMat = makeMat('#4a2c18', 0.78, 0.05);
    const hairBack = new THREE.Mesh(
      new THREE.SphereGeometry(0.298, 26, 18, 0, Math.PI * 2, 0, Math.PI * 0.54),
      brownHairMat,
    );
    hairBack.position.set(0, 0.02, -0.02);
    head.add(hairBack);

    // Tousled front bangs peeking out under backwards cap
    for (let b = -3; b <= 3; b++) {
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 10), brownHairMat);
      tuft.position.set(b * 0.065, 0.23, 0.22 - Math.abs(b) * 0.015);
      tuft.rotation.set(0.85, 0, -b * 0.18);
      head.add(tuft);
    }

    // Backwards cap dome + teal VC neon brim pointing backward (-Z)
    const capMat = makeMat('#18181b', 0.5, 0.15);
    const capDome = new THREE.Mesh(
      new THREE.SphereGeometry(0.315, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.5),
      capMat,
    );
    capDome.position.set(0, 0.07, -0.02);
    const capBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.026, 20, 1, false, -Math.PI * 0.4, Math.PI * 0.8), capMat);
    capBrim.position.set(0, 0.11, -0.25);
    capBrim.rotation.y = Math.PI;
    capBrim.rotation.x = 0.18;
    const capTrim = new THREE.Mesh(new THREE.TorusGeometry(0.305, 0.018, 8, 28), makeMat('#06b6d4', 0.2, 0.4, '#06b6d4', 0.7));
    capTrim.rotation.x = Math.PI / 2;
    capTrim.position.set(0, 0.1, -0.02);
    head.add(capDome, capBrim, capTrim);
  } else if (characterId === 'lucia') {
    // Lucia (GTA 6): Dark wavy hair + shiny gold hoop earrings + flexible skinned high ponytail!
    const darkHairMat = makeMat('#1a1016', 0.65, 0.08);
    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.302, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.58),
      darkHairMat,
    );
    hairCap.position.set(0, 0.03, -0.025);
    head.add(hairCap);

    // Side framing wavy strands
    [-1, 1].forEach((side) => {
      const strand = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.22, 8, 12), darkHairMat);
      strand.position.set(side * 0.24, -0.02, 0.16);
      strand.rotation.z = side * 0.14;
      strand.rotation.x = 0.12;
      head.add(strand);
    });

    // High ponytail scrunchie + flowing 4-bone flexible skinned ponytail!
    const scrunchie = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.026, 10, 18), makeMat('#ec4899', 0.35, 0.2));
    scrunchie.position.set(0, 0.28, -0.24);
    scrunchie.rotation.x = Math.PI / 3;
    const ponytail = createSkinnedChainMesh(0.56, 0.095, 0.028, 4, darkHairMat, 'z');
    ponytail.mesh.position.set(0, 0.28, -0.24);
    ponytail.mesh.rotation.x = -0.58;
    head.add(scrunchie, ponytail.mesh);
    flexChains.push(ponytail.bones);

    // Shiny Gold Hoop Earrings!
    const goldHoopMat = makeMat('#facc15', 0.16, 0.9, '#eab308', 0.25);
    [-1, 1].forEach((side) => {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.014, 10, 20), goldHoopMat);
      hoop.rotation.y = Math.PI / 2;
      hoop.position.set(side * 0.288, -0.095, 0.005);
      head.add(hoop);
    });
  } else if (isTropy) {
    // Golden Tuning-Fork Crest Helmet + Time Monocle Collar
    const brassMat = makeMat('#facc15', 0.18, 0.88, '#eab308', 0.25);
    const helmRim = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.045, 10, 22), makeMat('#1e3a8a', 0.25, 0.8));
    helmRim.rotation.x = Math.PI / 2;
    helmRim.position.set(0, 0.12, 0);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.044, 0.24, 10), brassMat);
    stem.position.set(0, 0.42, 0);
    const forkBase = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.055, 0.055), brassMat);
    forkBase.position.set(0, 0.54, 0);
    [-0.11, 0.11].forEach((fx) => {
      const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.032, 0.26, 10), brassMat);
      tine.position.set(fx, 0.67, 0);
      head.add(tine);
    });
    head.add(helmRim, stem, forkBase);
  } else if (isPenta) {
    // Cool Penguin Orange Beak + Dark Racing Shades!
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.24, 10), makeMat('#f97316', 0.42, 0.08));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, -0.05, 0.34);
    const shades = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.12), makeMat('#090d14', 0.15, 0.8));
    shades.position.set(0, 0.08, 0.26);
    head.add(beak, shades);
  } else if (isFalso) {
    // Unfinished Prototype Head: mismatched green tuft, crooked clay ear, half-built helmet crown!
    const roughCap = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.42), makeMat('#ef4444', 0.85, 0.05));
    roughCap.position.set(0.04, 0.32, -0.02);
    roughCap.rotation.z = -0.18;
    const clayEar = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.28, 5), makeMat('#94a3b8', 0.9, 0.02));
    clayEar.position.set(0.32, 0.26, 0);
    clayEar.rotation.z = -0.52;
    const greenPatch = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.32, 0.04), makeMat('#4ade80', 0.8, 0.05));
    greenPatch.position.set(-0.16, 0.02, 0.255);
    const wireCrown = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.14, 0.12, 6),
      new THREE.MeshBasicMaterial({ color: '#facc15', wireframe: true }),
    );
    wireCrown.position.set(-0.08, 0.46, 0);
    wireCrown.rotation.z = 0.22;
    head.add(roughCap, clayEar, greenPatch, wireCrown);
  } else if (isPhoneChar) {
    // Sleek Smartphone Camera Bump + Cute Antenna Halo
    const glassBezel = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.7, 0.04), makeMat('#020617', 0.12, 0.9));
    glassBezel.position.set(0, 0, 0.072);
    const camBump = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.04), makeMat('#1e293b', 0.3, 0.8));
    camBump.position.set(-0.14, 0.22, -0.09);
    const miniHelmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      makeMat('#f97316', 0.3, 0.4),
    );
    miniHelmet.position.set(0, 0.38, 0);
    head.add(glassBezel, camBump, miniHelmet);
  } else if (isPcChar) {
    // CRT Gaming Monitor Bezel + Dual Wi-Fi Antennas + Glowing Green Glass Frame!
    const screenFrame = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.46, 0.04), makeMat('#020617', 0.15, 0.5));
    screenFrame.position.set(0, 0, 0.235);
    const rgbStrip = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.02, 6, 4), makeMat('#22c55e', 0.1, 0.2, '#a855f7', 1.8));
    rgbStrip.rotation.z = Math.PI / 4;
    rgbStrip.scale.set(1.25, 0.95, 1);
    rgbStrip.position.set(0, 0, 0.24);
    [-0.18, 0.18].forEach((ax) => {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.022, 0.28, 6), silverMat);
      ant.position.set(ax, 0.38, -0.08);
      ant.rotation.z = -Math.sign(ax) * 0.22;
      head.add(ant);
    });
    head.add(screenFrame, rgbStrip);
  }

  // 3D Idle Animation Props attached to CharacterRig!
  // A) Smartphone with live animated 2D CanvasTexture video player
  const phoneCanvas = document.createElement('canvas');
  phoneCanvas.width = 160;
  phoneCanvas.height = 256;
  const phoneCtx = phoneCanvas.getContext('2d')!;
  const phoneTexture = new THREE.CanvasTexture(phoneCanvas);
  phoneTexture.colorSpace = THREE.SRGBColorSpace;

  const phoneGroup = new THREE.Group();
  phoneGroup.position.set(0.05, 1.32, 0.34);
  phoneGroup.visible = false;
  const phoneBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.42, 0.032),
    makeMat('#090d14', 0.25, 0.8),
  );
  const phoneScreenFront = new THREE.Mesh(
    new THREE.PlaneGeometry(0.205, 0.36),
    new THREE.MeshBasicMaterial({ map: phoneTexture }),
  );
  phoneScreenFront.position.z = -0.018;
  phoneScreenFront.rotation.y = Math.PI;
  // Also display video feed on front/rear mirror bezel so chase camera sees videos playing too!
  const phoneScreenBack = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.3),
    new THREE.MeshBasicMaterial({ map: phoneTexture }),
  );
  phoneScreenBack.position.z = 0.018;
  phoneGroup.add(phoneBody, phoneScreenFront, phoneScreenBack);
  bodyPivot.add(phoneGroup);

  // B) Colorful Animated 3D Butterfly
  const butterflyGroup = new THREE.Group();
  butterflyGroup.position.set(0.32, 1.92, 0.42);
  butterflyGroup.visible = false;
  const bBody = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.016, 0.1, 6, 8),
    makeMat('#0f172a', 0.4, 0.2),
  );
  bBody.rotation.x = Math.PI / 2;
  const wingMat = makeMat('#f472b6', 0.25, 0.15, '#ec4899', 0.9);
  wingMat.side = THREE.DoubleSide;
  const wingGeo = new THREE.CircleGeometry(0.12, 12);
  wingGeo.scale(1.15, 0.78, 1);
  const butterflyWingL = new THREE.Mesh(wingGeo, wingMat);
  butterflyWingL.position.set(-0.075, 0.02, 0);
  butterflyWingL.rotation.x = -Math.PI / 2;
  const butterflyWingR = new THREE.Mesh(wingGeo, wingMat);
  butterflyWingR.position.set(0.075, 0.02, 0);
  butterflyWingR.rotation.x = -Math.PI / 2;
  butterflyGroup.add(bBody, butterflyWingL, butterflyWingR);
  bodyPivot.add(butterflyGroup);

  // C) Floating 3D Sleeping 'Zzz' Ribbons
  const zzzGroup = new THREE.Group();
  zzzGroup.position.set(0.18, 2.08, 0.15);
  zzzGroup.visible = false;
  for (let zi = 0; zi < 3; zi++) {
    const zTex = makeLabeledCanvasTexture('#0f172a', '#38bdf8', 'Z', '#38bdf8', 150);
    const zMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14 + zi * 0.04, 0.14 + zi * 0.04),
      new THREE.MeshBasicMaterial({ map: zTex, transparent: true, side: THREE.DoubleSide }),
    );
    zMesh.position.set(zi * 0.13, zi * 0.18, 0);
    zzzGroup.add(zMesh);
  }
  bodyPivot.add(zzzGroup);

  const faceRig: CharacterFaceRig = {
    characterId,
    canvas: faceCanvas,
    ctx: faceCtx,
    texture: faceTexture,
    snoutCanvas,
    snoutCtx,
    snoutTexture,
    lastKey: '',
    dizzyGroup,
    phoneCanvas,
    phoneCtx,
    phoneTexture,
    phoneLastFrame: -1,
  };

  const rig: CharacterRig = {
    root,
    bodyPivot,
    head,
    torso,
    spineBones,
    flexChains,
    eyelids,
    faceRig,
    idleProps: {
      phoneGroup,
      butterflyGroup,
      butterflyWingL,
      butterflyWingR,
      zzzGroup,
    },
    leftArm,
    rightArm,
    leftElbow,
    rightElbow,
    leftLeg,
    rightLeg,
    leftKnee,
    rightKnee,
    crown,
  };

  // Paint initial 2D face right away so thumbnails/first frames show crisp 2D faces!
  applyCharacterFacialExpression(rig, 'normal', 0);
  return rig;
}

function draw2DPortraitCanvas(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  characterId: CharacterId,
  expression: FacialExpression,
  phase: number,
  isBlinking: boolean,
): void {
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  if (w !== 512 || h !== 288) {
    ctx.scale(w / 512, h / 288);
  }
  const cw = 512;

  const isCrashBase = characterId === 'crash' || characterId === 'crash_exe';
  const isExe = characterId === 'jarvin_exe' || characterId === 'crash_exe';
  const isOxide = characterId === 'nitros_oxide';
  const isTropy = characterId === 'n_tropy';
  const isPenta = characterId === 'penta_penguin';
  const isFalso = characterId === 'falso_jarvin';
  const isDigitalScreen = characterId === 'celular_kart' || characterId === 'pc_gamer';
  const isHelmet = characterId === 'armagedon' || characterId === 'fedex' || isDigitalScreen;

  // Special Screen / Prototype Backdrop
  if (characterId === 'celular_kart') {
    ctx.fillStyle = '#071b34';
    ctx.fillRect(0, 0, 512, 288);
  } else if (characterId === 'pc_gamer') {
    ctx.fillStyle = '#051b0e';
    ctx.fillRect(0, 0, 512, 288);
  } else if (isFalso) {
    // Wireframe grid + mismatched duct-tape half
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 3;
    for (let gx = 260; gx < 512; gx += 32) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, 288);
      ctx.stroke();
    }
    for (let gy = 0; gy < 288; gy += 32) {
      ctx.beginPath();
      ctx.moveTo(260, gy);
      ctx.lineTo(512, gy);
      ctx.stroke();
    }
  }

  const irisCol = isExe
    ? '#ef4444'
    : characterId === 'jarvin'
      ? '#16a34a'
      : characterId === 'armagedon'
        ? '#facc15'
        : characterId === 'fedex'
          ? '#fff7ed'
          : isOxide
            ? '#facc15'
            : isTropy
              ? '#00f0ff'
              : characterId === 'celular_kart'
                ? '#38bdf8'
                : characterId === 'pc_gamer'
                  ? '#22c55e'
                  : characterId === 'crash'
                    ? '#16a34a'
                    : characterId === 'jason'
                      ? '#78350f'
                      : characterId === 'lucia'
                        ? '#451a03'
                        : '#1e293b';

  const eyeY = isCrashBase ? 132 : isHelmet ? 112 : 122;
  const eyeOffsetX = isCrashBase ? 78 : isDigitalScreen ? 88 : 82;
  const eyeRx = isCrashBase ? 42 : isDigitalScreen ? 38 : 34;
  const eyeRy = isCrashBase ? 52 : 44;

  // Jason light Vice City jawline stubble
  if (characterId === 'jason') {
    ctx.fillStyle = 'rgba(69, 26, 3, 0.22)';
    for (let sx = -76; sx <= 76; sx += 14) {
      for (let sy = 198; sy <= 254; sy += 13) {
        if (Math.abs(sx) < 50 || sy < 236) {
          ctx.beginPath();
          ctx.arc(cw / 2 + sx + ((sy % 2) * 4), sy, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // Cheek blush for expressive non-helmet characters
  if (!isHelmet && !isExe && !isOxide && !isFalso && !isPenta && (expression === 'normal' || expression === 'win' || expression === 'laughing' || expression === 'phone')) {
    ctx.fillStyle = 'rgba(244, 114, 182, 0.35)';
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cw / 2 + dir * 126, eyeY + 52, 26, 13, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Draw Left & Right 2D Eyes
  for (let i = 0; i < 2; i++) {
    const dir = i === 0 ? -1 : 1;
    const cx = cw / 2 + dir * eyeOffsetX;
    const cy = isFalso && dir > 0 ? eyeY + 12 : eyeY;

    if (expression === 'sleep' || isBlinking) {
      ctx.strokeStyle = isDigitalScreen ? irisCol : '#090d14';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy + 8, eyeRx * 0.85, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      continue;
    }

    if (expression === 'win' || expression === 'laughing') {
      if (isHelmet) {
        ctx.strokeStyle = irisCol;
        ctx.lineWidth = 11;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(cx, cy + 12, eyeRx * 0.8, 1.15 * Math.PI, 1.85 * Math.PI);
        ctx.stroke();
      } else {
        ctx.fillStyle = isExe ? '#09090b' : '#ffffff';
        ctx.strokeStyle = '#090d14';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.ellipse(cx, cy, eyeRx, eyeRy * 0.92, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = irisCol;
        ctx.beginPath();
        ctx.arc(cx, cy + 4, eyeRx * 0.62, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx - 10, cy - 10, 10, 0, Math.PI * 2);
        ctx.fill();
      }
      continue;
    }

    if (expression === 'dizzy') {
      if (!isHelmet) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#090d14';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.ellipse(cx, cy, eyeRx, eyeRy, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.strokeStyle = isHelmet ? irisCol : '#090d14';
      ctx.lineWidth = 6;
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 4.4; a += 0.35) {
        const rr = 3 + a * 2.1;
        const sx = cx + Math.cos(a + phase * dir) * rr;
        const sy = cy + Math.sin(a + phase * dir) * rr;
        if (a === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      continue;
    }

    if (expression === 'hurt') {
      ctx.strokeStyle = isHelmet ? irisCol : '#090d14';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (dir < 0) {
        ctx.moveTo(cx - 26, cy - 18);
        ctx.lineTo(cx + 22, cy);
        ctx.lineTo(cx - 26, cy + 18);
      } else {
        ctx.moveTo(cx + 26, cy - 18);
        ctx.lineTo(cx - 22, cy);
        ctx.lineTo(cx + 26, cy + 18);
      }
      ctx.stroke();
      continue;
    }

    const wideScale = expression === 'turbo' || expression === 'scared' ? 1.18 : isFalso && dir < 0 ? 1.2 : 1.0;
    const heightScale = expression === 'bored' ? 0.56 : expression === 'angry' || expression === 'serious' ? 0.78 : wideScale;

    if (isHelmet) {
      ctx.save();
      ctx.translate(cx, cy);
      if (expression === 'angry' || characterId === 'pc_gamer') ctx.rotate(dir * -0.2);
      else if (expression === 'serious') ctx.rotate(dir * -0.14);
      ctx.fillStyle = irisCol;
      ctx.shadowColor = irisCol;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      if (characterId === 'celular_kart') {
        ctx.ellipse(0, 0, eyeRx * 0.78, eyeRy * 0.86 * heightScale, 0, 0, Math.PI * 2);
      } else {
        ctx.roundRect(-eyeRx * 0.85, -eyeRy * 0.45 * heightScale, eyeRx * 1.7, eyeRy * 0.9 * heightScale, 10);
      }
      ctx.fill();
      ctx.restore();
      continue;
    }

    // Falso Jarvin mismatched glitch right eye!
    if (isFalso && dir > 0) {
      ctx.fillStyle = '#090d14';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 5;
      ctx.strokeRect(cx - 28, cy - 28, 56, 56);
      ctx.fillRect(cx - 24, cy - 24, 48, 48);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(cx - 10, cy - 10, 16, 16);
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(cx + 6, cy - 18, 10, 10);
      continue;
    }

    // Sclera
    ctx.fillStyle = isExe ? '#09090b' : '#ffffff';
    ctx.strokeStyle = '#090d14';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(cx, cy, eyeRx * wideScale, eyeRy * heightScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const lookDownY = expression === 'phone' ? 12 : 0;
    const pupilRadius = expression === 'scared' ? 10 : expression === 'turbo' ? 16 : 14;
    ctx.fillStyle = irisCol;
    ctx.beginPath();
    ctx.ellipse(cx, cy + lookDownY, 21 * wideScale, 26 * heightScale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isExe ? '#ef4444' : '#090d14';
    ctx.beginPath();
    ctx.arc(cx, cy + lookDownY, pupilRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isExe ? '#fca5a5' : '#ffffff';
    ctx.beginPath();
    ctx.arc(cx - 8, cy + lookDownY - 10, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 8, cy + lookDownY + 8, 3.5, 0, Math.PI * 2);
    ctx.fill();

    if (expression === 'bored') {
      ctx.fillStyle = '#090d14';
      ctx.fillRect(cx - eyeRx - 4, cy - eyeRy * heightScale - 4, eyeRx * 2 + 8, 10);
    }
    if (isExe) {
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(cx - 5, cy + eyeRy * heightScale - 2, 10, 26);
    }
  }

  // Draw 2D Expressive Eyebrows
  if (!isHelmet && !isPenta) {
    ctx.strokeStyle = isTropy ? '#00f0ff' : characterId === 'joaquin' || isExe ? '#09090b' : '#2c1810';
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const dir = i === 0 ? -1 : 1;
      const bx = cw / 2 + dir * eyeOffsetX;
      let by = eyeY - 58;
      let tilt = 0;
      if (expression === 'turbo' || expression === 'laughing' || expression === 'win' || expression === 'scared') {
        by -= 16;
        tilt = dir * -0.22;
      } else if (expression === 'angry' || isExe || isTropy) {
        by += 10;
        tilt = dir * 0.34;
      } else if (expression === 'serious') {
        by += 4;
        tilt = dir * 0.2;
      } else if (expression === 'bored' || expression === 'sleep') {
        by += 10;
        tilt = 0;
      }
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(tilt);
      ctx.beginPath();
      ctx.moveTo(-30, 0);
      ctx.lineTo(30, 0);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (isDigitalScreen) {
    // Glowing neon pixel mouth on screen!
    ctx.strokeStyle = irisCol;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cw / 2 - 48, eyeY + 78);
    ctx.quadraticCurveTo(cw / 2, eyeY + (expression === 'hurt' ? 62 : 108), cw / 2 + 48, eyeY + 78);
    ctx.stroke();
  } else if (!isCrashBase && !isHelmet && !isPenta) {
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cw / 2 - 4, eyeY + 46);
    ctx.lineTo(cw / 2 + 4, eyeY + 56);
    ctx.lineTo(cw / 2 - 3, eyeY + 62);
    ctx.stroke();
    draw2DMouth(ctx, cw / 2, eyeY + 102, 1.0, expression, phase, isExe);
  }
  ctx.restore();
}

function draw2DMouth(
  ctx: CanvasRenderingContext2D,
  mx: number,
  my: number,
  scale: number,
  expression: FacialExpression,
  phase: number,
  isExe: boolean,
): void {
  ctx.save();
  ctx.translate(mx, my);
  ctx.scale(scale, scale);

  if (expression === 'turbo' || expression === 'laughing' || expression === 'win') {
    // Huge ecstatic open mouth + crisp upper teeth + vivid 2D pink tongue out!
    const wag = expression === 'turbo' ? Math.sin(phase) * 8 : 0;
    ctx.fillStyle = '#450a0a';
    ctx.strokeStyle = '#090d14';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-58, -14);
    ctx.quadraticCurveTo(0, -18, 58, -14);
    ctx.quadraticCurveTo(54, 48, 0, 50);
    ctx.quadraticCurveTo(-54, 48, -58, -14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Teeth strip
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(-48, -12, 96, 17, 6);
    ctx.fill();

    // Pink Tongue Sticking Out
    ctx.fillStyle = '#fb7185';
    ctx.strokeStyle = '#9f1239';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(wag * 0.4, 34, 30, 26, wag * 0.02, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(wag * 0.4, 16);
    ctx.lineTo(wag * 0.4, 44);
    ctx.stroke();
  } else if (expression === 'angry' || isExe) {
    // Clenched jagged angry mouth!
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#090d14';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(-50, -12, 100, 28, 8);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    for (let tx = -34; tx <= 34; tx += 17) {
      ctx.moveTo(tx, -12);
      ctx.lineTo(tx, 16);
    }
    ctx.moveTo(-50, 2);
    ctx.lineTo(50, 2);
    ctx.stroke();
  } else if (expression === 'bored' || expression === 'serious') {
    ctx.strokeStyle = '#090d14';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-38, 4);
    ctx.quadraticCurveTo(0, expression === 'serious' ? -3 : 6, 38, 2);
    ctx.stroke();
  } else if (expression === 'sleep') {
    // Soft open sleeping mouth / bubble
    ctx.fillStyle = '#7f1d1d';
    ctx.strokeStyle = '#090d14';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(0, 6, 16, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (expression === 'dizzy' || expression === 'hurt' || expression === 'scared') {
    // Shocked / Dizzy 'O' Scream Mouth!
    ctx.fillStyle = '#450a0a';
    ctx.strokeStyle = '#090d14';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(0, 6, expression === 'scared' ? 28 : 22, expression === 'scared' ? 32 : 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    // Confident Cartoon Grin ('normal' or 'phone')
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#090d14';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-46, -6);
    ctx.quadraticCurveTo(0, 2, 46, -6);
    ctx.quadraticCurveTo(36, 24, 0, 24);
    ctx.quadraticCurveTo(-36, 24, -46, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function drawPhoneVideoFrame(ctx: CanvasRenderingContext2D, t: number): void {
  const w = 160;
  const h = 256;
  const clip = Math.floor(t / 3.0) % 3;
  const localT = t % 3.0;

  // Clip background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  if (clip === 0) {
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(1, '#14532d');
  } else if (clip === 1) {
    grad.addColorStop(0, '#311042');
    grad.addColorStop(1, '#0c4a6e');
  } else {
    grad.addColorStop(0, '#451a03');
    grad.addColorStop(1, '#7c2d12');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  if (clip === 0) {
    // Video 1: Orange Cat doing Skateboard Kickflips!
    ctx.fillStyle = '#22c55e';
    const flipY = 148 + Math.sin(localT * 6) * 24;
    ctx.save();
    ctx.translate(80, flipY);
    ctx.rotate(Math.sin(localT * 6) * 0.45);
    ctx.fillRect(-34, 8, 68, 10);
    // Cat
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.arc(0, -14, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-14, -10, 28, 18);
    ctx.restore();
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GATO PRO #1', 80, 38);
  } else if (clip === 1) {
    // Video 2: Neon Racing Road Speed Lines
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(80, 56);
    ctx.lineTo(14, 210);
    ctx.moveTo(80, 56);
    ctx.lineTo(146, 210);
    ctx.stroke();
    ctx.fillStyle = '#facc15';
    for (let s = 0; s < 4; s++) {
      const sy = 70 + ((s * 42 + localT * 110) % 140);
      ctx.fillRect(76, sy, 8, 20);
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TURBO CLIPS', 80, 38);
  } else {
    // Video 3: Glowing Victory Crown Party
    const pulse = 1 + Math.sin(localT * 8) * 0.14;
    ctx.save();
    ctx.translate(80, 122);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(-32, 20);
    ctx.lineTo(-36, -20);
    ctx.lineTo(-14, 0);
    ctx.lineTo(0, -28);
    ctx.lineTo(14, 0);
    ctx.lineTo(36, -20);
    ctx.lineTo(32, 20);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fde047';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('JARVIN WIN', 80, 38);
  }

  // Video Player UI Overlay (Heart reaction + Red Scrubber Bar!)
  ctx.fillStyle = '#f43f5e';
  ctx.beginPath();
  ctx.arc(136, 178 + Math.sin(localT * 5) * 8, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(10, 224, 140, 10);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(10, 224, 140 * (localT / 3.0), 10);
}

export function applyCharacterFacialExpression(
  rig: CharacterRig,
  expression: FacialExpression,
  elapsed: number,
): void {
  const f = rig.faceRig;
  f.dizzyGroup.visible = expression === 'dizzy' || expression === 'hurt';
  if (f.dizzyGroup.visible) {
    f.dizzyGroup.rotation.y = elapsed * 7.2;
    f.dizzyGroup.position.y = 0.64 + Math.sin(elapsed * 8) * 0.045;
  }

  // Natural blink every ~3.4s when resting/bored/serious
  const blinkPhase = (elapsed + (rig.root.id % 5) * 0.43) % 3.4;
  const isBlinking =
    (expression === 'normal' || expression === 'bored' || expression === 'serious' || expression === 'phone') &&
    ((blinkPhase > 3.14 && blinkPhase < 3.24) || (blinkPhase > 3.28 && blinkPhase < 3.36));

  const isAnimatedExpr = expression === 'turbo' || expression === 'dizzy' || expression === 'hurt';
  const frameBucket = isAnimatedExpr ? Math.floor(elapsed * 12) : 0;
  const key = `${expression}:${isBlinking ? 1 : 0}:${frameBucket}`;
  if (key === f.lastKey) return;
  f.lastKey = key;

  const phase = frameBucket * 0.55;
  draw2DPortraitCanvas(f.ctx, f.canvas.width, f.canvas.height, f.characterId, expression, phase, isBlinking);
  f.texture.needsUpdate = true;

  if (f.snoutCtx && f.snoutCanvas && f.snoutTexture) {
    f.snoutCtx.clearRect(0, 0, f.snoutCanvas.width, f.snoutCanvas.height);
    draw2DMouth(
      f.snoutCtx,
      f.snoutCanvas.width / 2,
      f.snoutCanvas.height * 0.52,
      1.32,
      expression,
      phase,
      f.characterId === 'crash_exe',
    );
    f.snoutTexture.needsUpdate = true;
  }
}

export function applyCharacterIdleAnimation(
  rig: CharacterRig,
  idleAnim: KartIdleAnimation,
  idleAnimTimer: number,
  elapsed: number,
): void {
  const { phoneGroup, butterflyGroup, butterflyWingL, butterflyWingR, zzzGroup } = rig.idleProps;

  // Reset idle overlays by default
  phoneGroup.visible = false;
  butterflyGroup.visible = false;
  zzzGroup.visible = false;

  if (idleAnim === 'none') {
    // Ensure seated arm/elbow posture stays normal while driving
    if (rig.leftElbow) rig.leftElbow.rotation.set(-0.55, 0.32, 0);
    if (rig.rightElbow) rig.rightElbow.rotation.set(-0.55, -0.32, 0);
    rig.head.rotation.x = THREE.MathUtils.damp(rig.head.rotation.x, 0, 10, 0.05);
    return;
  }

  if (idleAnim === 'sleep') {
    if (idleAnimTimer < 5.0) {
      // Slumped forward asleep on steering wheel + floating Zzz!
      rig.torso.rotation.x = 0.24;
      rig.head.rotation.x = 0.55 + Math.sin(elapsed * 2.2) * 0.04;
      rig.head.rotation.y = Math.sin(elapsed * 1.1) * 0.08;
      rig.leftArm.rotation.set(-0.95, 0, 0.22);
      rig.rightArm.rotation.set(-0.95, 0, -0.22);
      zzzGroup.visible = true;
      zzzGroup.position.y = 2.02 + Math.sin(elapsed * 3) * 0.08;
      zzzGroup.rotation.y = Math.sin(elapsed * 1.5) * 0.25;
    } else {
      // Startled awake!
      const jolt = Math.max(0, 1 - (idleAnimTimer - 5.0) * 1.2);
      rig.torso.rotation.x = -0.14 * jolt;
      rig.head.rotation.x = -0.18 * jolt;
      rig.head.rotation.y = Math.sin(elapsed * 16) * 0.25 * jolt;
      rig.leftArm.rotation.set(-1.3 * jolt - 0.65 * (1 - jolt), 0, 0.35);
      rig.rightArm.rotation.set(-1.3 * jolt - 0.65 * (1 - jolt), 0, -0.35);
    }
    return;
  }

  if (idleAnim === 'butterfly') {
    if (idleAnimTimer < 1.6) {
      // Looking around admiring scenery
      rig.head.rotation.y = Math.sin(idleAnimTimer * 2.6) * 0.65;
      rig.head.rotation.x = -0.08;
    } else if (idleAnimTimer < 4.2) {
      // Happy butterfly hovering gently!
      butterflyGroup.visible = true;
      const u = idleAnimTimer - 1.6;
      const bx = 0.28 + Math.sin(u * 2.2) * 0.14;
      const by = 1.9 + Math.cos(u * 3.1) * 0.08;
      const bz = 0.48 + Math.sin(u * 1.8) * 0.08;
      butterflyGroup.position.set(bx, by, bz);
      butterflyGroup.rotation.y = Math.sin(u * 2) * 0.4;
      rig.head.rotation.y = -0.28 + Math.sin(u * 2.2) * 0.12;
      rig.head.rotation.x = -0.15;
    } else if (idleAnimTimer < 5.6) {
      // Butterfly darts right in front of nose -> Scared jump back!
      butterflyGroup.visible = true;
      const u = idleAnimTimer - 4.2;
      butterflyGroup.position.set(Math.sin(u * 14) * 0.08, 1.82 + Math.cos(u * 12) * 0.06, 0.36);
      rig.head.rotation.x = -0.28;
      rig.head.rotation.y = Math.sin(u * 18) * 0.22;
      rig.torso.rotation.x = -0.16;
      rig.leftArm.rotation.set(-1.35, 0, 0.32);
      rig.rightArm.rotation.set(-1.35, 0, -0.32);
    } else {
      // Butterfly flies away -> Serious focused return to race!
      butterflyGroup.visible = idleAnimTimer < 7.2;
      if (butterflyGroup.visible) {
        const fly = idleAnimTimer - 5.6;
        butterflyGroup.position.set(0.4 + fly * 0.55, 2.0 + fly * 0.85, 0.4 - fly * 0.4);
      }
      rig.torso.rotation.x = 0.05;
      rig.head.rotation.set(0.05, 0, 0);
    }
    const flap = Math.sin(elapsed * 26) * 0.85;
    butterflyWingL.rotation.z = flap;
    butterflyWingR.rotation.z = -flap;
    return;
  }

  if (idleAnim === 'bored') {
    rig.torso.rotation.x = 0.06;
    rig.head.rotation.y = Math.sin(idleAnimTimer * 1.35) * 0.46;
    rig.head.rotation.z = Math.sin(idleAnimTimer * 0.95) * 0.16;
    rig.head.rotation.x = 0.12;
    return;
  }

  if (idleAnim === 'angry') {
    rig.torso.rotation.x = 0.1;
    rig.head.rotation.z = Math.sin(elapsed * 14) * 0.1;
    rig.head.rotation.y = Math.sin(elapsed * 5) * 0.25;
    rig.leftArm.rotation.set(-1.35 + Math.sin(elapsed * 14) * 0.38, 0, 0.25);
    rig.rightArm.rotation.set(-1.35 - Math.sin(elapsed * 14) * 0.38, 0, -0.25);
    return;
  }

  if (idleAnim === 'phone') {
    // Watching real animated video clips on smartphone until player moves!
    phoneGroup.visible = true;
    phoneGroup.position.set(0.02, 1.34 + Math.sin(elapsed * 2.5) * 0.012, 0.44);
    phoneGroup.rotation.set(-0.36, Math.sin(elapsed * 1.2) * 0.08, 0);

    rig.head.rotation.x = 0.34;
    rig.head.rotation.y = Math.sin(elapsed * 1.4) * 0.07;
    rig.leftArm.rotation.set(-0.92, 0, -0.18);
    rig.rightArm.rotation.set(-0.92, 0, 0.18);
    if (rig.leftElbow) rig.leftElbow.rotation.set(-0.95, 0.48, 0);
    if (rig.rightElbow) rig.rightElbow.rotation.set(-0.95, -0.48, 0);

    const frame = Math.floor(elapsed * 12);
    if (frame !== rig.faceRig.phoneLastFrame) {
      rig.faceRig.phoneLastFrame = frame;
      drawPhoneVideoFrame(rig.faceRig.phoneCtx, elapsed);
      rig.faceRig.phoneTexture.needsUpdate = true;
    }
  }
}

export function createOrangeCatSkateboardCompanion(): { group: THREE.Group; tailBones: THREE.Bone[] } {
  const catGroup = new THREE.Group();

  const deckShape = new THREE.Shape();
  deckShape.moveTo(-0.18, -0.35);
  deckShape.quadraticCurveTo(0, -0.46, 0.18, -0.35);
  deckShape.lineTo(0.18, 0.35);
  deckShape.quadraticCurveTo(0, 0.46, -0.18, 0.35);
  deckShape.closePath();

  const boardGeo = new THREE.ExtrudeGeometry(deckShape, {
    depth: 0.04,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 2,
  });
  boardGeo.rotateX(Math.PI / 2);
  const board = new THREE.Mesh(boardGeo, makeMat('#22c55e', 0.3, 0.2, '#16a34a', 0.35));
  board.position.y = 0.09;
  catGroup.add(board);

  const wheelMat = makeMat('#f8fafc', 0.35, 0.2);
  [
    [-0.14, 0.045, 0.24],
    [0.14, 0.045, 0.24],
    [-0.14, 0.045, -0.24],
    [0.14, 0.045, -0.24],
  ].forEach(([x, y, z]) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.045, 14), wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, y, z);
    catGroup.add(w);
  });

  const orangeMat = makeMat('#f97316', 0.65, 0.05);
  const creamMat = makeMat('#fed7aa', 0.72, 0.02);

  const catBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.16, 8, 14), orangeMat);
  catBody.rotation.x = Math.PI / 2.6;
  catBody.position.set(0, 0.22, -0.02);
  catGroup.add(catBody);

  const catHead = new THREE.Mesh(new THREE.SphereGeometry(0.145, 16, 14), orangeMat);
  catHead.position.set(0, 0.39, 0.12);
  catGroup.add(catHead);

  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), creamMat);
  snout.scale.set(1.2, 0.85, 0.8);
  snout.position.set(0, 0.35, 0.24);
  catGroup.add(snout);

  const earL = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.11, 8), orangeMat);
  earL.position.set(-0.09, 0.52, 0.12);
  earL.rotation.z = 0.25;
  const earR = earL.clone();
  earR.position.x = 0.09;
  earR.rotation.z = -0.25;
  catGroup.add(earL, earR);

  const eyeMat = makeMat('#0f172a', 0.2, 0.1);
  const cEyeL = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), eyeMat);
  cEyeL.position.set(-0.055, 0.41, 0.25);
  const cEyeR = cEyeL.clone();
  cEyeR.position.x = 0.055;
  catGroup.add(cEyeL, cEyeR);

  // Flexible 3-bone Skinned Cat Tail!
  const tailSkinned = createSkinnedChainMesh(0.32, 0.036, 0.016, 3, orangeMat);
  tailSkinned.mesh.position.set(0, 0.24, -0.15);
  tailSkinned.mesh.rotation.x = -0.65;
  catGroup.add(tailSkinned.mesh);

  return { group: catGroup, tailBones: tailSkinned.bones };
}

export function createKartModel(
  characterId: CharacterId,
  customization: KartCustomization,
  shadowTex: THREE.CanvasTexture,
  isMobile = false,
): KartMeshRig {
  const root = new THREE.Group();
  const chassisGroup = new THREE.Group();
  root.add(chassisGroup);

  const paintNormal = isMobile ? null : getCarPaintNormal();
  const tireTex = getTireTextures();

  const bodyMat = isMobile
    ? new THREE.MeshLambertMaterial({
        color: customization.bodyColor,
      })
    : new THREE.MeshPhysicalMaterial({
        color: customization.bodyColor,
        normalMap: paintNormal,
        normalScale: new THREE.Vector2(0.18, 0.18),
        metalness: 0.48,
        roughness: 0.18,
        clearcoat: 1.0,
        clearcoatRoughness: 0.08,
        envMapIntensity: 1.35,
      });

  const rimMat = makeMat(customization.rimColor, 0.16, 0.88, undefined, 0, isMobile);
  const neonMat = makeMat(customization.neonColor, 0.18, 0.1, customization.neonColor, 1.5, isMobile);

  const darkMetal = makeMat('#111827', 0.34, 0.82, undefined, 0, isMobile);
  const chromeMat = makeMat('#e2e8f0', 0.12, 0.94, undefined, 0, isMobile);
  const carbonMat = makeMat('#1e293b', 0.44, 0.58, undefined, 0, isMobile);
  const tireMat = isMobile
    ? new THREE.MeshLambertMaterial({ color: '#111827' })
    : new THREE.MeshStandardMaterial({
        color: '#ffffff',
        map: tireTex.map,
        normalMap: tireTex.normalMap,
        normalScale: new THREE.Vector2(1.1, 1.1),
        roughness: 0.82,
        metalness: 0.08,
      });

  // 1. Beveled Extruded Aero Floorpan & Nosecone Silhouette
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-0.78, -1.35);
  hullShape.lineTo(0.78, -1.35);
  hullShape.quadraticCurveTo(0.86, -0.2, 0.62, 0.85);
  hullShape.quadraticCurveTo(0.42, 1.48, 0, 1.56);
  hullShape.quadraticCurveTo(-0.42, 1.48, -0.62, 0.85);
  hullShape.quadraticCurveTo(-0.86, -0.2, -0.78, -1.35);

  const floorGeo = new THREE.ExtrudeGeometry(hullShape, {
    depth: 0.16,
    bevelEnabled: !isMobile,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: isMobile ? 1 : 3,
    curveSegments: isMobile ? 7 : 16,
  });
  floorGeo.rotateX(Math.PI / 2);
  const floorpan = new THREE.Mesh(floorGeo, darkMetal);
  floorpan.position.set(0, 0.42, 0);
  floorpan.castShadow = !isMobile;
  floorpan.receiveShadow = !isMobile;
  chassisGroup.add(floorpan);

  // 2. Sculpted Nose Cowling + Aero Sidepods
  const noseShape = new THREE.Shape();
  noseShape.moveTo(-0.48, -0.2);
  noseShape.lineTo(0.48, -0.2);
  noseShape.quadraticCurveTo(0.44, 0.9, 0.24, 1.32);
  noseShape.quadraticCurveTo(0, 1.44, -0.24, 1.32);
  noseShape.quadraticCurveTo(-0.44, 0.9, -0.48, -0.2);

  const noseGeo = new THREE.ExtrudeGeometry(noseShape, {
    depth: 0.24,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.06,
    bevelSegments: isMobile ? 1 : 4,
    curveSegments: isMobile ? 7 : 16,
  });
  noseGeo.rotateX(Math.PI / 2);
  const nose = new THREE.Mesh(noseGeo, bodyMat);
  nose.position.set(0, 0.72, 0.1);
  nose.castShadow = !isMobile;
  chassisGroup.add(nose);

  const frontWing = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.1, 1.65, isMobile ? 4 : 8, isMobile ? 8 : 16),
    bodyMat,
  );
  frontWing.rotation.z = Math.PI / 2;
  frontWing.scale.set(0.65, 1, 1.45);
  frontWing.position.set(0, 0.35, 1.42);
  frontWing.castShadow = !isMobile;
  chassisGroup.add(frontWing);

  const podGeo = new THREE.CapsuleGeometry(0.22, 1.05, isMobile ? 4 : 10, isMobile ? 8 : 16);
  const podL = new THREE.Mesh(podGeo, bodyMat);
  podL.rotation.x = Math.PI / 2;
  podL.scale.set(0.85, 1, 0.72);
  podL.position.set(-0.76, 0.52, -0.1);
  podL.castShadow = !isMobile;
  const podR = podL.clone();
  podR.position.x = 0.76;
  chassisGroup.add(podL, podR);

  // 3. Neon Underglow Rails
  const neonRailGeo = new THREE.CapsuleGeometry(0.04, 1.35, isMobile ? 3 : 6, isMobile ? 6 : 10);
  const neonL = new THREE.Mesh(neonRailGeo, neonMat);
  neonL.rotation.x = Math.PI / 2;
  neonL.position.set(-0.88, 0.29, -0.05);
  const neonR = neonL.clone();
  neonR.position.x = 0.88;
  const neonBack = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 1.1, isMobile ? 3 : 6, isMobile ? 6 : 10), neonMat);
  neonBack.rotation.z = Math.PI / 2;
  neonBack.position.set(0, 0.29, -1.4);
  chassisGroup.add(neonL, neonR, neonBack);

  // 4. Bucket Seat & Tubular Rollbar
  const seatBack = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.45, isMobile ? 4 : 8, isMobile ? 8 : 16),
    carbonMat,
  );
  seatBack.scale.set(1.05, 1, 0.42);
  seatBack.position.set(0, 0.84, -0.52);
  seatBack.rotation.x = -0.22;
  const rollBar = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, isMobile ? 5 : 10, isMobile ? 10 : 20, Math.PI), rimMat);
  rollBar.position.set(0, 1.05, -0.56);
  chassisGroup.add(seatBack, rollBar);

  // 5. Real Visible CTR V-Twin Engine Block with Pumping Pistons
  const engineBlock = new THREE.Group();
  engineBlock.position.set(0, 0.58, -1.04);
  chassisGroup.add(engineBlock);

  const crankcase = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.44), darkMetal);
  crankcase.castShadow = !isMobile;
  const supercharger = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.42, isMobile ? 8 : 16), chromeMat);
  supercharger.rotation.z = Math.PI / 2;
  supercharger.position.set(0, 0.22, -0.02);
  const intakeScoop = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.15, 0.26), makeMat('#ef4444', 0.3, 0.5, undefined, 0, isMobile));
  intakeScoop.position.set(0, 0.34, 0.04);
  engineBlock.add(crankcase, supercharger, intakeScoop);

  const enginePistons: THREE.Mesh[] = [];
  [-1, 1].forEach((side) => {
    const cylGroup = new THREE.Group();
    cylGroup.position.set(side * 0.24, 0.16, 0.02);
    cylGroup.rotation.z = -side * 0.46;

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.105, 0.26, isMobile ? 7 : 14), chromeMat);
    barrel.castShadow = !isMobile;
    const piston = new THREE.Mesh(
      new THREE.CylinderGeometry(0.088, 0.088, 0.16, isMobile ? 7 : 14),
      makeMat('#facc15', 0.2, 0.85, undefined, 0, isMobile),
    );
    piston.position.y = 0.12;
    enginePistons.push(piston);
    cylGroup.add(barrel, piston);

    if (!isMobile) {
      const finRing = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.015, 6, 16), darkMetal);
      finRing.rotation.x = Math.PI / 2;
      finRing.position.y = 0.04;
      const finRing2 = finRing.clone();
      finRing2.position.y = -0.04;
      cylGroup.add(finRing, finRing2);

      const header = new THREE.Mesh(new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * 0.26, 0.18, -0.06),
          new THREE.Vector3(side * 0.38, 0.08, -0.24),
          new THREE.Vector3(side * 0.34, -0.02, -0.42),
        ]),
        10,
        0.048,
        8,
        false,
      ), chromeMat);
      engineBlock.add(header);
    }

    engineBlock.add(cylGroup);
  });

  // 6. Swept Rear Wing & Twin Chrome Exhausts
  const wingPillarL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.48, 0.26), darkMetal);
  wingPillarL.position.set(-0.48, 0.88, -1.2);
  wingPillarL.rotation.x = -0.15;
  const wingPillarR = wingPillarL.clone();
  wingPillarR.position.x = 0.48;
  const spoiler = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.09, 1.56, isMobile ? 4 : 8, isMobile ? 8 : 16),
    bodyMat,
  );
  spoiler.rotation.z = Math.PI / 2;
  spoiler.scale.set(0.45, 1, 1.9);
  spoiler.position.set(0, 1.14, -1.26);
  spoiler.castShadow = !isMobile;
  const endPlateL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.44), darkMetal);
  endPlateL.position.set(-0.84, 1.14, -1.26);
  const endPlateR = endPlateL.clone();
  endPlateR.position.x = 0.84;
  chassisGroup.add(wingPillarL, wingPillarR, spoiler, endPlateL, endPlateR);

  const exhaustFlames: KartMeshRig['exhaustFlames'] = [];
  [-0.34, 0.34].forEach((exX) => {
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.145, 0.44, isMobile ? 8 : 18), rimMat);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(exX, 0.56, -1.46);
    exhaust.castShadow = !isMobile;

    const exhaustGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.06, isMobile ? 8 : 14), neonMat);
    exhaustGlow.rotation.x = Math.PI / 2;
    exhaustGlow.position.set(exX, 0.56, -1.66);

    if (isMobile) {
      const basicFlameGeo = new THREE.ConeGeometry(0.13, 0.45, 7, 1, true);
      basicFlameGeo.translate(0, -0.22, 0);
      basicFlameGeo.rotateX(Math.PI / 2);
      const basicFlameMat = new THREE.MeshBasicMaterial({
        color: customization.neonColor,
        transparent: true,
        opacity: 0.72,
      });
      const flameMesh = new THREE.Mesh(basicFlameGeo, basicFlameMat);
      flameMesh.position.set(exX, 0.56, -1.68);
      chassisGroup.add(exhaust, exhaustGlow, flameMesh);
    } else {
      const flameMat = createExhaustFlameShader(customization.neonColor);
      const flameGeo = new THREE.ConeGeometry(0.16, 0.95, 14, 6, true);
      flameGeo.translate(0, -0.47, 0);
      flameGeo.rotateX(Math.PI / 2);
      const flameMesh = new THREE.Mesh(flameGeo, flameMat);
      flameMesh.position.set(exX, 0.56, -1.68);
      exhaustFlames.push({ mesh: flameMesh, material: flameMat });
      chassisGroup.add(exhaust, exhaustGlow, flameMesh);
    }
  });

  // 7. Rounded LED Headlights
  const headMat = makeMat('#fef9c3', 0.1, 0.1, '#fef08a', 1.6, isMobile);
  const hlL = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.14, isMobile ? 3 : 6, isMobile ? 6 : 12), headMat);
  hlL.rotation.z = Math.PI / 2;
  hlL.position.set(-0.4, 0.56, 1.24);
  const hlR = hlL.clone();
  hlR.position.x = 0.4;
  chassisGroup.add(hlL, hlR);

  // 8. Spoked Racing Steering Wheel & Column
  const steeringCol = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.048, 0.44, isMobile ? 6 : 10), darkMetal);
  steeringCol.rotation.x = 0.72;
  steeringCol.position.set(0, 0.84, 0.36);

  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(0, 1.02, 0.23);
  steeringWheel.rotation.order = 'XYZ';
  steeringWheel.rotation.x = -0.52;

  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.032, isMobile ? 5 : 10, isMobile ? 12 : 22), darkMetal);
  const topMarker = new THREE.Mesh(
    new THREE.TorusGeometry(0.18, 0.036, isMobile ? 5 : 8, isMobile ? 6 : 10, 0.42),
    makeMat(customization.neonColor, 0.2, 0.3, customization.neonColor, 1.1, isMobile),
  );
  topMarker.rotation.z = Math.PI * 0.5 - 0.21;
  const spokeH = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.032), rimMat);
  const spokeV = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.16, 0.032), rimMat);
  spokeV.position.y = -0.08;
  const wheelHub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.052, isMobile ? 8 : 14), bodyMat);
  wheelHub.rotation.x = Math.PI / 2;
  steeringWheel.add(wheelRim, topMarker, spokeH, spokeV, wheelHub);
  chassisGroup.add(steeringCol, steeringWheel);

  // 9. Tires & Alloy Rims (streamlined on mobile)
  const wheels: THREE.Group[] = [];
  const frontWheelPivots: THREE.Group[] = [];
  const wheelPositions: Array<{ x: number; y: number; z: number; front: boolean; scale: number }> = [
    { x: -1.0, y: 0.38, z: 0.98, front: true, scale: 0.94 },
    { x: 1.0, y: 0.38, z: 0.98, front: true, scale: 0.94 },
    { x: -1.06, y: 0.42, z: -0.94, front: false, scale: 1.08 },
    { x: 1.06, y: 0.42, z: -0.94, front: false, scale: 1.08 },
  ];

  const isFalsoKart = characterId === 'falso_jarvin';
  if (isFalsoKart) {
    frontWing.rotation.y = 0.09;
    frontWing.rotation.z = Math.PI / 2 + 0.06;
    spoiler.rotation.x = 0.14;
    spoiler.rotation.y = -0.07;
    const tapeMat = makeMat('#94a3b8', 0.55, 0.2, undefined, 0, isMobile);
    const tapePatch = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.24), tapeMat);
    tapePatch.position.set(0.15, 0.78, 0.65);
    tapePatch.rotation.y = 0.35;
    const cardboard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.35, 0.7), makeMat('#a16207', 0.9, 0.02, undefined, 0, isMobile));
    cardboard.position.set(-0.88, 0.62, -0.2);
    cardboard.rotation.z = -0.18;
    chassisGroup.add(tapePatch, cardboard);
  }

  wheelPositions.forEach((wp, wIdx) => {
    const tireScale = isFalsoKart
      ? wIdx === 0 ? 0.76 : wIdx === 3 ? 1.2 : wp.scale
      : wp.scale;
    if (!isMobile) {
      const wishbone = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.055, 0.16), darkMetal);
      wishbone.position.set(wp.x * 0.68, wp.y + 0.02, wp.z);
      chassisGroup.add(wishbone);

      const coilSpring = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.28, 10), makeMat('#ef4444', 0.35, 0.5));
      coilSpring.position.set(wp.x * 0.74, wp.y + 0.15, wp.z);
      coilSpring.rotation.z = -Math.sign(wp.x) * 0.35;
      chassisGroup.add(coilSpring);
    }

    const pivot = new THREE.Group();
    pivot.position.set(wp.x, wp.y, wp.z);
    if (isFalsoKart) {
      pivot.rotation.z = wIdx % 2 === 0 ? 0.09 : -0.07;
    }
    const spinGroup = new THREE.Group();
    pivot.add(spinGroup);

    const tire = new THREE.Mesh(
      new THREE.TorusGeometry(0.24 * tireScale, 0.135 * tireScale, isMobile ? 6 : 16, isMobile ? 12 : 28),
      tireMat,
    );
    tire.rotation.y = Math.PI / 2;
    tire.castShadow = !isMobile;
    spinGroup.add(tire);

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18 * tireScale, 0.18 * tireScale, 0.24 * tireScale, isMobile ? 8 : 20),
      rimMat,
    );
    hub.rotation.z = Math.PI / 2;
    spinGroup.add(hub);

    if (!isMobile) {
      const rotor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14 * tireScale, 0.14 * tireScale, 0.28 * tireScale, 16),
        chromeMat,
      );
      rotor.rotation.z = Math.PI / 2;
      spinGroup.add(rotor);

      for (let sp = 0; sp < 5; sp++) {
        const spoke = new THREE.Mesh(
          new THREE.BoxGeometry(0.28 * tireScale, 0.04 * tireScale, 0.34 * tireScale),
          darkMetal,
        );
        spoke.rotation.x = (sp / 5) * Math.PI;
        spinGroup.add(spoke);
      }
    }

    chassisGroup.add(pivot);
    wheels.push(spinGroup);
    if (wp.front) frontWheelPivots.push(pivot);
  });

  // 10. Seated HD Driver Character — hands visibly grip the steering wheel rim!
  const driverAnchor = new THREE.Group();
  driverAnchor.position.set(0, 0.32, -0.10);
  driverAnchor.scale.setScalar(0.88);
  const driverRig = createCharacterModel(characterId, isMobile);
  driverRig.leftLeg.rotation.x = -0.95;
  driverRig.rightLeg.rotation.x = -0.95;
  if (driverRig.leftKnee) driverRig.leftKnee.rotation.x = 0.95;
  if (driverRig.rightKnee) driverRig.rightKnee.rotation.x = 0.95;
  driverRig.leftArm.rotation.set(-0.78, 0, 0.22);
  driverRig.rightArm.rotation.set(-0.78, 0, -0.22);
  if (driverRig.leftElbow) driverRig.leftElbow.rotation.set(-0.42, 0.24, 0);
  if (driverRig.rightElbow) driverRig.rightElbow.rotation.set(-0.42, -0.24, 0);
  driverAnchor.add(driverRig.root);
  chassisGroup.add(driverAnchor);

  // 11. Jarvin's Orange Cat on Green Skateboard companion
  let catCompanion: THREE.Group | undefined;
  let catTailBones: THREE.Bone[] | undefined;
  if (characterId === 'jarvin') {
    const builtCat = createOrangeCatSkateboardCompanion();
    catCompanion = builtCat.group;
    catTailBones = builtCat.tailBones;
    catCompanion.position.set(0, 1.2, -1.24);
    catCompanion.scale.setScalar(0.76);
    chassisGroup.add(catCompanion);
  }

  // Nitro's Oxide hover-thruster side fins on his kart!
  if (characterId === 'nitros_oxide') {
    const hoverFinMat = makeMat('#84cc16', 0.22, 0.5, '#84cc16', 0.95);
    [-1.12, 1.12].forEach((fx) => {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 1.35), hoverFinMat);
      fin.position.set(fx, 0.68, -0.15);
      fin.rotation.z = Math.sign(fx) * 0.28;
      chassisGroup.add(fin);
    });
  }

  // 11b. TNT Mounted Box above Kart + Burn Flame Cones
  const tntMountGroup = createTntCrateModel();
  tntMountGroup.position.set(0, 2.25, -0.15);
  tntMountGroup.scale.setScalar(0.75);
  tntMountGroup.visible = false;
  root.add(tntMountGroup);

  const burnFlameGroup = new THREE.Group();
  burnFlameGroup.visible = false;
  const fMatA = makeMat('#f97316', 0.1, 0.1, '#ef4444', 2.0);
  const fMatB = makeMat('#facc15', 0.1, 0.1, '#f97316', 2.2);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 8), i % 2 === 0 ? fMatA : fMatB);
    cone.position.set(Math.cos(ang) * 0.95, 0.72, Math.sin(ang) * 1.15);
    burnFlameGroup.add(cone);
  }
  root.add(burnFlameGroup);

  // 12. Shield bubble
  const shieldMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.95, 22, 16),
    new THREE.MeshBasicMaterial({
      color: '#facc15',
      transparent: true,
      opacity: 0.26,
      wireframe: true,
    }),
  );
  shieldMesh.position.y = 0.88;
  shieldMesh.visible = false;
  root.add(shieldMesh);

  // 13. Orbiting Aku Aku Mask group
  const akuAkuGroup = new THREE.Group();
  const mask = createAkuAkuMaskModel();
  mask.position.set(1.65, 1.25, 0);
  mask.scale.setScalar(1.05);
  akuAkuGroup.add(mask);
  akuAkuGroup.visible = false;
  root.add(akuAkuGroup);

  // 14. Soft contact shadow disc
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.3, 4.3),
    new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.68,
    }),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.03;
  root.add(contactShadow);

  return {
    root,
    chassisGroup,
    engineBlock,
    enginePistons,
    exhaustFlames,
    bodyMat,
    rimMat,
    neonMat,
    wheels,
    frontWheelPivots,
    steeringWheel,
    driverAnchor,
    driverRig,
    catCompanion,
    catTailBones,
    shieldMesh,
    akuAkuGroup,
    tntMountGroup,
    burnFlameGroup,
    contactShadow,
  };
}

function makeLabeledCanvasTexture(
  bgColor: string,
  borderColor: string,
  text: string,
  textColor = '#ffffff',
  fontSize = 96,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 18;
  ctx.strokeRect(9, 9, 238, 238);
  ctx.fillStyle = textColor;
  ctx.font = `900 ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 134);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createTntCrateModel(): THREE.Group {
  const grp = new THREE.Group();
  const tex = makeLabeledCanvasTexture('#dc2626', '#7f1d1d', 'TNT', '#fef08a', 82);
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, 1.45, 1.45),
    new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.55,
      emissive: '#ef4444',
      emissiveIntensity: 0.32,
    }),
  );
  box.castShadow = true;
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 8), makeMat('#18181b', 0.6, 0.1));
  fuse.position.y = 0.85;
  const spark = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 8),
    makeMat('#facc15', 0.1, 0.1, '#f97316', 2.4),
  );
  spark.position.y = 1.04;
  grp.add(box, fuse, spark);
  return grp;
}

export function createPotionModel(juiced = false): THREE.Group {
  const grp = new THREE.Group();
  const mainCol = juiced ? '#e11d48' : '#22c55e';
  const neckCol = juiced ? '#fb7185' : '#4ade80';
  const flask = new THREE.Mesh(
    new THREE.SphereGeometry(0.68, 14, 12),
    makeMat(mainCol, 0.15, 0.25, mainCol, juiced ? 1.8 : 1.4),
  );
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.26, 0.5, 10),
    makeMat(neckCol, 0.2, 0.2, mainCol, 0.95),
  );
  neck.position.y = 0.65;
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.22, 10), makeMat('#92400e', 0.7, 0.05));
  cork.position.y = 0.92;
  grp.add(flask, neck, cork);
  if (juiced) grp.scale.setScalar(1.32);
  return grp;
}

export function createLightningBoltModel(): THREE.Group {
  const grp = new THREE.Group();
  const boltMat = makeMat('#facc15', 0.1, 0.2, '#38bdf8', 2.4);
  const seg1 = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 1.35), boltMat);
  seg1.rotation.y = 0.42;
  seg1.position.set(0.2, 0, -0.45);
  const seg2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 1.35), boltMat);
  seg2.rotation.y = -0.45;
  seg2.position.set(-0.2, 0, 0.45);
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.55, 0),
    makeMat('#e0f2fe', 0.1, 0.1, '#38bdf8', 2.8),
  );
  grp.add(seg1, seg2, core);
  return grp;
}

export function createTimeCrateModel(seconds: 1 | 2 | 3): THREE.Group {
  const tex = makeLabeledCanvasTexture('#facc15', '#b45309', `${seconds}s`, '#0f172a', 110);
  const grp = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1.75, 1.75, 1.75),
    new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.28,
      metalness: 0.35,
      emissive: '#eab308',
      emissiveIntensity: 0.45,
    }),
  );
  box.castShadow = true;
  grp.add(box);
  return grp;
}

export function createBowlingBombModel(): THREE.Group {
  const grp = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.75, 16, 14),
    makeMat('#18181b', 0.22, 0.65),
  );
  const stripe = new THREE.Mesh(
    new THREE.TorusGeometry(0.73, 0.08, 8, 20),
    makeMat('#ef4444', 0.2, 0.3, '#dc2626', 1.2),
  );
  stripe.rotation.x = Math.PI / 2;
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.36, 8), makeMat('#71717a', 0.5, 0.5));
  fuse.position.y = 0.82;
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), makeMat('#facc15', 0.1, 0.1, '#f97316', 2.8));
  spark.position.y = 1.05;
  grp.add(shell, stripe, fuse, spark);
  return grp;
}

export function createWarpOrbModel(): THREE.Group {
  const grp = new THREE.Group();
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.68, 16, 14),
    makeMat('#38bdf8', 0.1, 0.2, '#0284c7', 2.2),
  );
  const ring1 = new THREE.Mesh(
    new THREE.TorusGeometry(0.92, 0.08, 8, 20),
    makeMat('#a855f7', 0.2, 0.3, '#c084fc', 1.8),
  );
  ring1.rotation.x = Math.PI * 0.35;
  const ring2 = ring1.clone();
  ring2.rotation.y = Math.PI * 0.5;
  grp.add(orb, ring1, ring2);
  return grp;
}

export function createTimeClockModel(): THREE.Group {
  const grp = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.65, 0.65, 0.26, 18),
    makeMat('#facc15', 0.25, 0.8),
  );
  body.rotation.x = Math.PI / 2;
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.54, 18),
    makeMat('#f8fafc', 0.2, 0.1, '#e2e8f0', 0.4),
  );
  face.position.z = 0.14;
  const hand1 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.36, 0.04), makeMat('#0f172a', 0.4, 0.2));
  hand1.position.set(0, 0.14, 0.16);
  const bellMat = makeMat('#f59e0b', 0.2, 0.8);
  const bellL = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), bellMat);
  bellL.position.set(-0.52, 0.62, 0);
  const bellR = bellL.clone();
  bellR.position.x = 0.52;
  grp.add(body, face, hand1, bellL, bellR);
  return grp;
}

export function createTokenLetterModel(letter: 'J' | 'K' | 'T'): THREE.Group {
  const grp = new THREE.Group();
  const tex = makeLabeledCanvasTexture('#facc15', '#b45309', letter, '#0f172a', 142);
  const coin = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.1, 0.32, 16),
    new THREE.MeshStandardMaterial({
      color: '#fde047',
      metalness: 0.85,
      roughness: 0.22,
      emissive: '#f59e0b',
      emissiveIntensity: 0.45,
    }),
  );
  coin.rotation.x = Math.PI / 2;
  const badgeMat = new THREE.MeshBasicMaterial({ map: tex });
  const front = new THREE.Mesh(new THREE.CircleGeometry(0.95, 16), badgeMat);
  front.position.z = 0.18;
  const back = new THREE.Mesh(new THREE.CircleGeometry(0.95, 16), badgeMat);
  back.rotation.y = Math.PI;
  back.position.z = -0.18;
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(1.38, 0.09, 8, 22),
    makeMat('#38bdf8', 0.1, 0.2, '#38bdf8', 2.0),
  );
  grp.add(coin, front, back, halo);
  return grp;
}

export function createTrophyModel(): THREE.Group {
  const grp = new THREE.Group();
  const goldMat = makeMat('#facc15', 0.16, 0.9, '#ca8a04', 0.35);
  const baseMat = makeMat('#1e293b', 0.35, 0.65);

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.26, 16), baseMat);
  plinth.position.y = 0.13;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.1, 16), goldMat);
  collar.position.y = 0.3;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.34, 12), goldMat);
  stem.position.y = 0.52;
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.22, 0.58, 18, 1, false), goldMat);
  cup.position.y = 0.95;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.055, 8, 20), goldMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 1.24;

  const handleL = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 8, 14, Math.PI), goldMat);
  handleL.rotation.z = Math.PI / 2;
  handleL.position.set(-0.44, 0.96, 0);
  const handleR = handleL.clone();
  handleR.rotation.z = -Math.PI / 2;
  handleR.position.x = 0.44;

  const starGem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.18, 0),
    makeMat('#fef08a', 0.1, 0.2, '#f59e0b', 1.8),
  );
  starGem.position.set(0, 1.44, 0);
  grp.add(plinth, collar, stem, cup, rim, handleL, handleR, starGem);
  return grp;
}

export interface CtrIntroStageRig {
  stageGroup: THREE.Group;
  jarvinRig: CharacterRig;
  trophyGroup: THREE.Group;
  titleGroup: THREE.Group;
}

export function buildCtrIntroStage(isMobile = false): CtrIntroStageRig {
  const stageGroup = new THREE.Group();

  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(11, 12, 0.6, 28),
    makeMat('#0f172a', 0.35, 0.55),
  );
  floor.position.y = -0.3;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(5.6, 0.15, 8, 36),
    makeMat('#facc15', 0.2, 0.3, '#facc15', 1.6),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.04;
  const backdrop = new THREE.Mesh(
    new THREE.CylinderGeometry(20, 20, 16, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: '#050810', side: THREE.BackSide, roughness: 0.9 }),
  );
  backdrop.position.y = 7;

  const keySpot = new THREE.PointLight(0xfef08a, 34, 34);
  keySpot.position.set(2.5, 7.5, 6);
  const fillSpot = new THREE.PointLight(0x38bdf8, 22, 30);
  fillSpot.position.set(-5.5, 5.0, 5);
  stageGroup.add(floor, ring, backdrop, keySpot, fillSpot);

  const jarvinRig = createCharacterModel('jarvin', isMobile);
  jarvinRig.root.position.set(0, 0, 0);
  jarvinRig.root.scale.setScalar(1.38);
  stageGroup.add(jarvinRig.root);

  const trophyGroup = createTrophyModel();
  trophyGroup.position.set(0.75, 1.35, 0.78);
  trophyGroup.scale.setScalar(0.88);
  stageGroup.add(trophyGroup);

  // Big 3D Arcade Slam Banner: "JARVIN KART TURBO 3D"
  const titleGroup = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 768;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#1e3a8a');
  grad.addColorStop(0.55, '#0f172a');
  grad.addColorStop(1, '#7c2d12');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 768, 256);
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 14;
  ctx.strokeRect(10, 10, 748, 236);
  ctx.fillStyle = '#090d14';
  ctx.font = '900 72px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('JARVIN KART', 388, 114);
  ctx.fillStyle = '#facc15';
  ctx.fillText('JARVIN KART', 384, 108);
  ctx.fillStyle = '#38bdf8';
  ctx.font = '900 84px sans-serif';
  ctx.fillText('TURBO 3D', 384, 204);

  const titleTex = new THREE.CanvasTexture(c);
  titleTex.colorSpace = THREE.SRGBColorSpace;
  const plaque = new THREE.Mesh(
    new THREE.BoxGeometry(6.6, 2.2, 0.36),
    makeMat('#1e293b', 0.3, 0.7),
  );
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(6.35, 2.0),
    new THREE.MeshBasicMaterial({ map: titleTex }),
  );
  face.position.z = 0.19;
  titleGroup.add(plaque, face);
  titleGroup.position.set(0, 6.2, -1.2);
  stageGroup.add(titleGroup);

  return { stageGroup, jarvinRig, trophyGroup, titleGroup };
}

export interface AnimatedMinecart {
  mesh: THREE.Group | null;
  chunkIndex: number;
  x: number;
  y: number;
  z: number;
  tStart: number;
  tEnd: number;
  phase: number;
  speed: number;
  lateral: number;
}

export interface TrackChunk {
  index: number;
  tStart: number;
  tEnd: number;
  center: THREE.Vector3;
  radius: number;
  built: boolean;
  group: THREE.Group | null;
  build: () => THREE.Group;
}

export interface BuiltTrackScene {
  group: THREE.Group;
  envGroup: THREE.Group;
  chunks: TrackChunk[];
  itemBoxes: Array<{
    mesh: THREE.Mesh | null;
    chunkIndex: number;
    x: number;
    y: number;
    z: number;
    t: number;
    offset: number;
    respawnTimer: number;
  }>;
  wumpaBoxes: Array<{
    mesh: THREE.Mesh | null;
    chunkIndex: number;
    x: number;
    y: number;
    z: number;
    t: number;
    offset: number;
    respawnTimer: number;
  }>;
  minecarts: AnimatedMinecart[];
  animatedShaderMaterials: THREE.ShaderMaterial[];
  disposables: Array<{ dispose: () => void }>;
}

export function applyPs1FilterToObject(root: THREE.Object3D, enabled: boolean): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      const std = mat as THREE.MeshStandardMaterial;
      if (typeof std.flatShading === 'boolean') {
        std.flatShading = enabled;
        std.needsUpdate = true;
      }
      const texProps: Array<'map' | 'normalMap' | 'roughnessMap'> = ['map', 'normalMap', 'roughnessMap'];
      for (const prop of texProps) {
        const tex = std[prop];
        if (tex && tex instanceof THREE.Texture) {
          tex.minFilter = enabled ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
          tex.magFilter = enabled ? THREE.NearestFilter : THREE.LinearFilter;
          tex.generateMipmaps = !enabled;
          tex.needsUpdate = true;
        }
      }
    }
  });
}

export function buildTrackGeometryAndProps(
  track: CompiledTrack,
  maxAnisotropy: number,
  isMobile = false,
): BuiltTrackScene {
  const CHUNK_COUNT = 12;
  const group = new THREE.Group();
  const envGroup = new THREE.Group();
  group.add(envGroup);

  const disposables: Array<{ dispose: () => void }> = [];
  const animatedShaderMaterials: THREE.ShaderMaterial[] = [];
  const minecarts: AnimatedMinecart[] = [];
  const chunks: TrackChunk[] = [];
  const cfg = track.config;
  const n = track.samples.length;
  const halfW = cfg.roadWidth / 2;

  const wrapTVal = (v: number) => {
    const r = v % 1;
    return r < 0 ? r + 1 : r;
  };
  const chunkIndexForT = (tVal: number) =>
    Math.min(CHUNK_COUNT - 1, Math.max(0, Math.floor(wrapTVal(tVal) * CHUNK_COUNT)));

  const colA = new THREE.Color(cfg.curbColorA);
  const colB = new THREE.Color(cfg.curbColorB);

  const isInAbyssGap = (tVal: number) => {
    if (!cfg.abyssGaps || cfg.abyssGaps.length === 0) return false;
    for (const g of cfg.abyssGaps) {
      const hit = g.tStart <= g.tEnd ? tVal >= g.tStart && tVal <= g.tEnd : tVal >= g.tStart || tVal <= g.tEnd;
      if (hit) return true;
    }
    return false;
  };

  const isBlockedByShortcut = (tVal: number, sideSign: number) => {
    if (!cfg.shortcuts) return false;
    for (const sc of cfg.shortcuts) {
      if (Math.sign(sc.lateralCenter) !== sideSign) continue;
      if (sc.tStart <= sc.tEnd ? tVal >= sc.tStart && tVal <= sc.tEnd : tVal >= sc.tStart || tVal <= sc.tEnd) {
        return true;
      }
    }
    return false;
  };

  // Shared Track Materials & Textures (created once per track, used lazily by visible chunks)
  const { map: asphaltMap, normalMap: asphaltNormal, roughnessMap: asphaltRough } = createAsphaltTexture(
    cfg.roadColor,
    cfg.accentColor,
    maxAnisotropy,
    isMobile,
  );
  const roadMat = isMobile
    ? new THREE.MeshLambertMaterial({
        color: 0xffffff,
        map: asphaltMap,
        side: THREE.DoubleSide,
      })
    : new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: asphaltMap,
        normalMap: asphaltNormal,
        normalScale: new THREE.Vector2(0.32, 0.32),
        roughnessMap: asphaltRough,
        roughness: 0.86,
        metalness: 0.04,
        envMapIntensity: 0.32,
        side: THREE.DoubleSide,
      });
  const curbMat = isMobile
    ? new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
      })
    : new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.6,
        metalness: 0.12,
        side: THREE.DoubleSide,
      });
  const guardMat = isMobile
    ? new THREE.MeshLambertMaterial({
        color: '#475569',
        emissive: cfg.accentColor,
        emissiveIntensity: 0.14,
        side: THREE.DoubleSide,
      })
    : new THREE.MeshStandardMaterial({
        color: '#475569',
        emissive: cfg.accentColor,
        emissiveIntensity: 0.14,
        roughness: 0.45,
        metalness: 0.65,
        side: THREE.DoubleSide,
      });
  disposables.push(roadMat, asphaltMap, asphaltNormal, asphaltRough, curbMat, guardMat);

  // Environment Ocean / Lava Sea & Island Floor (2 triangles total, fades smoothly into horizon fog)
  if (cfg.theme === 'cove' || cfg.theme === 'cave') {
    const deep = cfg.theme === 'cove' ? '#0369a1' : '#0f172a';
    const bright = cfg.theme === 'cove' ? '#22d3ee' : '#38bdf8';
    const seaGeo = new THREE.PlaneGeometry(1600, 1600, isMobile ? 1 : 28, isMobile ? 1 : 28);
    if (isMobile) {
      const seaTex = createFastSurfaceTexture(deep, bright, 28);
      const seaMat = new THREE.MeshBasicMaterial({ map: seaTex });
      const seaMesh = new THREE.Mesh(seaGeo, seaMat);
      seaMesh.rotation.x = -Math.PI / 2;
      seaMesh.position.y = -2.8;
      envGroup.add(seaMesh);
      disposables.push(seaGeo, seaTex, seaMat);
    } else {
      const waterMat = createAnimatedSurfaceShader('water', deep, bright);
      const seaMesh = new THREE.Mesh(seaGeo, waterMat);
      seaMesh.rotation.x = -Math.PI / 2;
      seaMesh.position.y = -2.8;
      envGroup.add(seaMesh);
      animatedShaderMaterials.push(waterMat);
      disposables.push(seaGeo, waterMat);
    }
  } else if (cfg.theme === 'volcano' || cfg.theme === 'castle') {
    const lavaGeo = new THREE.PlaneGeometry(1600, 1600, isMobile ? 1 : 24, isMobile ? 1 : 24);
    if (isMobile) {
      const lavaTex = createFastSurfaceTexture('#7f1d1d', '#f97316', 24);
      const lavaMat = new THREE.MeshBasicMaterial({ map: lavaTex });
      const lavaMesh = new THREE.Mesh(lavaGeo, lavaMat);
      lavaMesh.rotation.x = -Math.PI / 2;
      lavaMesh.position.y = -3.6;
      envGroup.add(lavaMesh);
      disposables.push(lavaGeo, lavaTex, lavaMat);
    } else {
      const lavaMat = createAnimatedSurfaceShader('lava', '#7f1d1d', '#f97316');
      const lavaMesh = new THREE.Mesh(lavaGeo, lavaMat);
      lavaMesh.rotation.x = -Math.PI / 2;
      lavaMesh.position.y = -3.6;
      envGroup.add(lavaMesh);
      animatedShaderMaterials.push(lavaMat);
      disposables.push(lavaGeo, lavaMat);
    }
  }

  const groundTex = createGroundTexture(cfg.groundColor, maxAnisotropy, isMobile);
  const groundMat = isMobile
    ? new THREE.MeshLambertMaterial({ color: 0xffffff, map: groundTex })
    : new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: groundTex,
        roughness: 0.9,
        metalness: 0.05,
      });
  const groundGeo = new THREE.PlaneGeometry(1800, 1800);
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y =
    cfg.theme === 'cove' || cfg.theme === 'cave' || cfg.theme === 'castle' || cfg.theme === 'volcano'
      ? -6.5
      : -2.2;
  groundMesh.receiveShadow = !isMobile;
  envGroup.add(groundMesh);
  disposables.push(groundGeo, groundMat, groundTex);

  // Shared Prop & Scenery Geometries/Materials (allocated once, instanced lazily per visible chunk)
  const hazardMat = makeMat('#facc15', 0.28, 0.4, '#f97316', 1.15, isMobile);
  const cliffMat = makeMat('#1e293b', 0.85, 0.1, undefined, 0, isMobile);
  const bridgePillarMat = makeMat(cfg.theme === 'mines' ? '#78350f' : '#334155', 0.72, 0.15, undefined, 0, isMobile);
  const pillarGeo = new THREE.CylinderGeometry(1.1, 1.5, 1, 8);
  disposables.push(hazardMat, cliffMat, bridgePillarMat, pillarGeo);

  // Waterfalls shared materials
  const wfCliffMat = makeMat(cfg.theme === 'ice' ? '#334155' : '#475569', 0.85, 0.08, undefined, 0, isMobile);
  const wfDeep = cfg.theme === 'volcano' ? '#ea580c' : '#0284c7';
  const wfBright = cfg.theme === 'volcano' ? '#fde047' : '#e0f2fe';
  let wfWaterMat: THREE.Material;
  if (isMobile) {
    const wfTex = createFastSurfaceTexture(wfDeep, wfBright, 4);
    wfWaterMat = new THREE.MeshBasicMaterial({ map: wfTex });
    disposables.push(wfTex);
  } else {
    const wfShader = createAnimatedSurfaceShader('water', wfDeep, wfBright);
    animatedShaderMaterials.push(wfShader);
    wfWaterMat = wfShader;
  }
  const wfFoamMat = makeMat(
    cfg.theme === 'volcano' ? '#facc15' : '#e0f2fe',
    0.2,
    0.1,
    cfg.theme === 'volcano' ? '#f97316' : '#38bdf8',
    1.3,
    isMobile,
  );
  disposables.push(wfCliffMat, wfWaterMat, wfFoamMat);

  // Caves / Mines shared geometries & materials
  let rockMat: THREE.Material | null = null;
  let woodMat: THREE.Material | null = null;
  let vaultGeo: THREE.BufferGeometry | null = null;
  let postGeo: THREE.BufferGeometry | null = null;
  let beamGeo: THREE.BufferGeometry | null = null;
  let lanternGeo: THREE.BufferGeometry | null = null;
  let railGeo: THREE.BufferGeometry | null = null;
  let stalactiteGeo: THREE.BufferGeometry | null = null;
  let crystalGeo: THREE.BufferGeometry | null = null;
  let railSteelMat: THREE.Material | null = null;
  let oreCartMat: THREE.Material | null = null;
  let lanternMat: THREE.Material | null = null;
  const caveCrystalMats: THREE.Material[] = [];

  if (cfg.caves && cfg.caves.length > 0) {
    const rockTextures = createRockPBRTextures(
      cfg.theme === 'mines' ? '#3f2e21' : '#1e293b',
      maxAnisotropy,
      isMobile,
    );
    rockMat = isMobile
      ? new THREE.MeshLambertMaterial({ color: 0xffffff, map: rockTextures.map, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: rockTextures.map,
          normalMap: rockTextures.normalMap,
          normalScale: new THREE.Vector2(1.4, 1.4),
          roughness: 0.88,
          metalness: 0.06,
          side: THREE.DoubleSide,
        });
    const woodTextures = createWoodPlankTextures(maxAnisotropy, isMobile);
    woodMat = isMobile
      ? new THREE.MeshLambertMaterial({ color: 0xffffff, map: woodTextures.map })
      : new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: woodTextures.map,
          normalMap: woodTextures.normalMap,
          roughness: 0.82,
          metalness: 0.05,
        });
    vaultGeo = new THREE.TorusGeometry(halfW + 3.2, 2.5, isMobile ? 4 : 7, isMobile ? 10 : 16, Math.PI);
    postGeo = new THREE.BoxGeometry(1.15, 12.2, 1.15);
    beamGeo = new THREE.BoxGeometry(cfg.roadWidth + 4.4, 1.25, 1.25);
    lanternGeo = new THREE.SphereGeometry(0.45, 6, 6);
    railGeo = new THREE.BoxGeometry(0.2, 0.18, 9.0);
    stalactiteGeo = new THREE.ConeGeometry(1.1, 4.4, 5);
    crystalGeo = new THREE.OctahedronGeometry(1.5, 0);
    railSteelMat = makeMat('#94a3b8', 0.3, 0.85, undefined, 0, isMobile);
    oreCartMat = makeMat('#78350f', 0.7, 0.25, undefined, 0, isMobile);
    lanternMat = makeMat('#fef08a', 0.2, 0.1, '#f59e0b', 2.0, isMobile);
    disposables.push(
      rockTextures.map,
      rockTextures.normalMap,
      rockMat,
      woodTextures.map,
      woodTextures.normalMap,
      woodMat,
      vaultGeo,
      postGeo,
      beamGeo,
      lanternGeo,
      railGeo,
      stalactiteGeo,
      crystalGeo,
      railSteelMat,
      oreCartMat,
      lanternMat,
    );

    cfg.caves.forEach((cave, cIdx) => {
      const crystalMat = makeMat(cave.color, 0.15, 0.35, cave.color, 1.6, isMobile);
      caveCrystalMats.push(crystalMat);
      disposables.push(crystalMat);
      if (cave.mineShaft) {
        const midT = wrapTVal((cave.tStart + cave.tEnd) * 0.5);
        const ownerChunk = chunkIndexForT(midT);
        for (let mc = 0; mc < (isMobile ? 1 : 2); mc++) {
          const smp = track.samples[Math.floor(midT * n) % n];
          const lateral = halfW - 0.95;
          minecarts.push({
            mesh: null,
            chunkIndex: ownerChunk,
            x: smp.point.x + smp.right.x * lateral,
            y: smp.point.y + 0.06,
            z: smp.point.z + smp.right.z * lateral,
            tStart: cave.tStart,
            tEnd: cave.tEnd,
            phase: (mc * 0.5 + cIdx * 0.3) % 1,
            speed: 0.16 + mc * 0.05,
            lateral,
          });
        }
      }
    });
  }

  // Ramps, Boost Pads & Crates shared materials/geometries
  const rampTex = createRampTexture(cfg.accentColor, maxAnisotropy);
  const rampMat = isMobile
    ? new THREE.MeshLambertMaterial({
        color: 0xffffff,
        map: rampTex,
        emissive: '#f59e0b',
        emissiveIntensity: 0.25,
        side: THREE.DoubleSide,
      })
    : new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: rampTex,
        emissive: '#f59e0b',
        emissiveIntensity: 0.25,
        roughness: 0.35,
        metalness: 0.25,
        side: THREE.DoubleSide,
      });
  const rampSideMat = makeMat('#0f172a', 0.45, 0.5, cfg.accentColor, 0.35, isMobile);
  const boostTex = createBoostPadTexture(cfg.accentColor, maxAnisotropy);
  const boostMat = new THREE.MeshBasicMaterial({
    map: boostTex,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const boostGeo = new THREE.PlaneGeometry(5.2, 7.4);
  const pylonGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.4, 6);
  const pylonMat = makeMat(cfg.accentColor, 0.2, 0.3, cfg.accentColor, 1.8, isMobile);

  const questionCrateTex = createCrateTexture('question', cfg.accentColor, maxAnisotropy);
  const boxGeo = new THREE.BoxGeometry(1.75, 1.75, 1.75);
  const boxMat = isMobile
    ? new THREE.MeshLambertMaterial({
        color: 0xffffff,
        map: questionCrateTex,
        emissive: cfg.accentColor,
        emissiveIntensity: 0.35,
      })
    : new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: questionCrateTex,
        emissive: cfg.accentColor,
        emissiveIntensity: 0.35,
        roughness: 0.3,
        metalness: 0.25,
      });

  const wumpaCrateTex = createCrateTexture('wumpa', cfg.accentColor, maxAnisotropy);
  const wumpaGeo = new THREE.BoxGeometry(1.66, 1.66, 1.66);
  const wumpaMat = isMobile
    ? new THREE.MeshLambertMaterial({
        color: 0xffffff,
        map: wumpaCrateTex,
        emissive: '#ea580c',
        emissiveIntensity: 0.28,
      })
    : new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: wumpaCrateTex,
        emissive: '#ea580c',
        emissiveIntensity: 0.28,
        roughness: 0.42,
        metalness: 0.14,
      });
  disposables.push(
    rampTex,
    rampMat,
    rampSideMat,
    boostTex,
    boostMat,
    boostGeo,
    pylonGeo,
    pylonMat,
    questionCrateTex,
    boxGeo,
    boxMat,
    wumpaCrateTex,
    wumpaGeo,
    wumpaMat,
  );

  // Pre-register Item Boxes & Wumpa Crates with world positions (physics works even when chunk isn't built yet!)
  const itemBoxes: BuiltTrackScene['itemBoxes'] = [];
  cfg.itemBoxLocations.forEach((loc) => {
    const cIdx = chunkIndexForT(loc.t);
    const smp = track.samples[Math.floor(wrapTVal(loc.t) * n) % n];
    loc.offsets.forEach((offset) => {
      itemBoxes.push({
        mesh: null,
        chunkIndex: cIdx,
        x: smp.point.x + smp.right.x * offset,
        y: smp.point.y + 1.38,
        z: smp.point.z + smp.right.z * offset,
        t: loc.t,
        offset,
        respawnTimer: 0,
      });
    });
  });

  const wumpaBoxes: BuiltTrackScene['wumpaBoxes'] = [];
  getTrackWumpaBoxLocations(cfg).forEach((loc) => {
    const cIdx = chunkIndexForT(loc.t);
    const smp = track.samples[Math.floor(wrapTVal(loc.t) * n) % n];
    loc.offsets.forEach((offset) => {
      wumpaBoxes.push({
        mesh: null,
        chunkIndex: cIdx,
        x: smp.point.x + smp.right.x * offset,
        y: smp.point.y + 1.3,
        z: smp.point.z + smp.right.z * offset,
        t: loc.t,
        offset,
        respawnTimer: 0,
      });
    });
  });

  // Scenery & Foliage Shared Materials
  const sceneryCount = isMobile ? 22 : 84;
  const trunkGeo = new THREE.CylinderGeometry(0.42, 0.72, 4.8, isMobile ? 5 : 7);
  const isTowerTheme = cfg.theme === 'urban' || cfg.theme === 'neon' || cfg.theme === 'castle';
  let crownGeo: THREE.BufferGeometry;
  let propMat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;

  if (isTowerTheme) {
    const lower = new THREE.BoxGeometry(7.6, 18, 7.6);
    const upper = new THREE.BoxGeometry(5.0, 10, 5.0);
    upper.translate(0, 13.5, 0);
    crownGeo = mergeGeometries([lower, upper], false) ?? lower;
    const facadeTex = createSkyscraperWindowTexture(
      cfg.theme === 'urban' ? '#1e293b' : cfg.theme === 'neon' ? '#1e1b4b' : '#31102f',
      cfg.theme === 'urban' ? '#bae6fd' : cfg.theme === 'neon' ? '#22d3ee' : '#f59e0b',
      isMobile,
    );
    facadeTex.repeat.set(1, 2);
    propMat = isMobile
      ? new THREE.MeshLambertMaterial({
          color: 0xffffff,
          map: facadeTex,
          emissive: cfg.theme === 'neon' ? '#06b6d4' : cfg.theme === 'castle' ? '#b45309' : '#38bdf8',
          emissiveIntensity: cfg.theme === 'urban' ? 0.2 : 0.45,
        })
      : new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: facadeTex,
          emissive: cfg.theme === 'neon' ? '#06b6d4' : cfg.theme === 'castle' ? '#b45309' : '#38bdf8',
          emissiveIntensity: cfg.theme === 'urban' ? 0.2 : 0.45,
          roughness: 0.42,
          metalness: 0.35,
        });
    disposables.push(facadeTex, crownGeo, propMat);
  } else {
    crownGeo =
      cfg.theme === 'space' || cfg.theme === 'oxide'
        ? new THREE.TorusGeometry(6, 0.75, 6, isMobile ? 10 : 22)
        : cfg.theme === 'ice'
          ? new THREE.ConeGeometry(4.2, 16, isMobile ? 5 : 7)
          : cfg.theme === 'canyon' || cfg.theme === 'mines' || cfg.theme === 'cave'
            ? new THREE.ConeGeometry(5.2, 15, isMobile ? 5 : 7)
            : cfg.theme === 'jungle' || cfg.theme === 'cove'
              ? new THREE.CylinderGeometry(0.65, 1.0, 12, isMobile ? 5 : 7)
              : new THREE.DodecahedronGeometry(3.8, 0);

    propMat = makeMat(
      cfg.theme === 'space'
        ? '#a855f7'
        : cfg.theme === 'oxide'
          ? '#84cc16'
          : cfg.theme === 'ice'
            ? '#bae6fd'
            : cfg.theme === 'canyon'
              ? '#c2410c'
              : cfg.theme === 'mines'
                ? '#7c2d12'
                : cfg.theme === 'cave'
                  ? '#1e293b'
                  : cfg.theme === 'cove'
                    ? '#78350f'
                    : cfg.theme === 'jungle'
                      ? '#78350f'
                      : '#3f3f46',
      0.46,
      cfg.theme === 'space' || cfg.theme === 'oxide' ? 0.45 : 0.12,
      cfg.theme === 'space'
        ? '#22d3ee'
        : cfg.theme === 'oxide'
          ? '#84cc16'
          : cfg.theme === 'cave'
            ? '#10b981'
            : cfg.theme === 'volcano'
              ? '#ef4444'
              : 0x000000,
      cfg.theme === 'space' || cfg.theme === 'oxide' || cfg.theme === 'volcano' || cfg.theme === 'cave' ? 0.42 : 0,
      isMobile,
    );
    disposables.push(crownGeo, propMat);
  }

  const trunkMat = makeMat(
    cfg.theme === 'volcano' ? '#27272a' : cfg.theme === 'ice' ? '#475569' : '#78350f',
    0.85,
    0.05,
    undefined,
    0,
    isMobile,
  );
  const foliageTier1 = new THREE.ConeGeometry(2.6, 2.8, isMobile ? 5 : 7);
  const foliageTier2 = new THREE.ConeGeometry(1.9, 2.5, isMobile ? 5 : 7);
  foliageTier2.translate(0, 1.75, 0);
  const foliageGeo = mergeGeometries([foliageTier1, foliageTier2], false) ?? foliageTier1;
  const foliageMat = makeMat(
    cfg.theme === 'canyon'
      ? '#65a30d'
      : cfg.theme === 'ice'
        ? '#e0f2fe'
        : cfg.theme === 'cove'
          ? '#22c55e'
          : cfg.theme === 'jungle'
            ? '#15803d'
            : '#16a34a',
    0.72,
    0.05,
    undefined,
    0,
    isMobile,
  );
  const showTrees =
    cfg.theme !== 'volcano' &&
    cfg.theme !== 'space' &&
    cfg.theme !== 'oxide' &&
    cfg.theme !== 'mines' &&
    cfg.theme !== 'cave';
  disposables.push(trunkGeo, trunkMat, foliageGeo, foliageMat);

  // Build CHUNK_COUNT lazy spatial chunks along the track
  for (let c = 0; c < CHUNK_COUNT; c++) {
    const iStart = Math.floor((c * n) / CHUNK_COUNT);
    const iEnd = c === CHUNK_COUNT - 1 ? n : Math.floor(((c + 1) * n) / CHUNK_COUNT);
    const tStart = c / CHUNK_COUNT;
    const tEnd = (c + 1) / CHUNK_COUNT;

    // Fast bounding sphere calculation over chunk samples + lateral scenery margin
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const latPad = halfW + 36;
    for (let i = iStart; i <= iEnd; i++) {
      const s = track.samples[i % n];
      minX = Math.min(minX, s.point.x - latPad);
      maxX = Math.max(maxX, s.point.x + latPad);
      minY = Math.min(minY, s.point.y - 12);
      maxY = Math.max(maxY, s.point.y + 28);
      minZ = Math.min(minZ, s.point.z - latPad);
      maxZ = Math.max(maxZ, s.point.z + latPad);
    }

    // Expand bounding box if a shortcut, tunnel, or ramp starts inside this chunk
    cfg.shortcuts?.forEach((sc) => {
      if (chunkIndexForT(sc.tStart) !== c) return;
      const span = sc.tEnd >= sc.tStart ? sc.tEnd - sc.tStart : 1 - sc.tStart + sc.tEnd;
      for (let k = 0; k <= 4; k++) {
        const pt = track.curve.getPointAt(wrapTVal(sc.tStart + (span * k) / 4));
        minX = Math.min(minX, pt.x - sc.halfWidth - 20);
        maxX = Math.max(maxX, pt.x + sc.halfWidth + 20);
        minZ = Math.min(minZ, pt.z - sc.halfWidth - 20);
        maxZ = Math.max(maxZ, pt.z + sc.halfWidth + 20);
      }
    });
    cfg.tunnels.forEach((tun) => {
      if (chunkIndexForT(tun.tStart) !== c) return;
      for (let k = 0; k <= 4; k++) {
        const pt = track.curve.getPointAt(wrapTVal(tun.tStart + ((tun.tEnd - tun.tStart) * k) / 4));
        minX = Math.min(minX, pt.x - halfW - 8);
        maxX = Math.max(maxX, pt.x + halfW + 8);
        minZ = Math.min(minZ, pt.z - halfW - 8);
        maxZ = Math.max(maxZ, pt.z + halfW + 8);
      }
    });
    cfg.antigravityZones?.forEach((zone) => {
      if (chunkIndexForT(zone.tStart) !== c) return;
      const span = zone.tEnd >= zone.tStart ? zone.tEnd - zone.tStart : 1 - zone.tStart + zone.tEnd;
      for (let k = 0; k <= 4; k++) {
        const pt = track.curve.getPointAt(wrapTVal(zone.tStart + (span * k) / 4));
        minX = Math.min(minX, pt.x - halfW - 8);
        maxX = Math.max(maxX, pt.x + halfW + 8);
        minZ = Math.min(minZ, pt.z - halfW - 8);
        maxZ = Math.max(maxZ, pt.z + halfW + 8);
      }
    });

    const center = new THREE.Vector3((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
    const radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 0.5;

    const chunkObj: TrackChunk = {
      index: c,
      tStart,
      tEnd,
      center,
      radius,
      built: false,
      group: null,
      build: () => {
        if (chunkObj.built && chunkObj.group) return chunkObj.group;
        const cGroup = new THREE.Group();
        cGroup.name = `track_chunk_${c}`;

        // 1. Road, Curb & Outer Guardrail Ribbons for [iStart .. iEnd]
        const roadPos: number[] = [];
        const roadUvs: number[] = [];
        const roadIdx: number[] = [];
        const curbPos: number[] = [];
        const curbColors: number[] = [];
        const curbIdx: number[] = [];
        const guardPos: number[] = [];
        const guardIdx: number[] = [];
        const railHeight = 0.95;
        const railOffset = halfW + 1.4;
        const outerHalf = halfW + 1.55;

        for (let i = iStart; i <= iEnd; i++) {
          const s = track.samples[i % n];
          const nextS = track.samples[(i + 1) % n];
          const vCoord = (i / n) * 56;
          const localV = i - iStart;

          roadPos.push(
            s.point.x - s.right.x * halfW, s.point.y + 0.02, s.point.z - s.right.z * halfW,
            s.point.x + s.right.x * halfW, s.point.y + 0.02, s.point.z + s.right.z * halfW,
          );
          roadUvs.push(0, vCoord, 1, vCoord);

          const inGap = isInAbyssGap(s.t) || isInAbyssGap(nextS.t);
          if (i < iEnd && !inGap) {
            const base = localV * 2;
            roadIdx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
          }

          const col = i % 2 === 0 ? colA : colB;
          curbPos.push(
            s.point.x - s.right.x * outerHalf, s.point.y + 0.28, s.point.z - s.right.z * outerHalf,
            s.point.x - s.right.x * halfW, s.point.y + 0.04, s.point.z - s.right.z * halfW,
            s.point.x + s.right.x * halfW, s.point.y + 0.04, s.point.z + s.right.z * halfW,
            s.point.x + s.right.x * outerHalf, s.point.y + 0.28, s.point.z + s.right.z * outerHalf,
          );
          for (let k = 0; k < 4; k++) curbColors.push(col.r, col.g, col.b);

          if (i < iEnd && !inGap) {
            const cb = localV * 4;
            curbIdx.push(cb, cb + 1, cb + 4, cb + 1, cb + 5, cb + 4);
            curbIdx.push(cb + 2, cb + 3, cb + 6, cb + 3, cb + 7, cb + 6);
          }

          if (i < iEnd && !inGap) {
            for (const sideSign of [-1, 1]) {
              if (isBlockedByShortcut(s.t, sideSign)) continue;
              const base = guardPos.length / 3;
              const ox0 = s.point.x + s.right.x * sideSign * railOffset;
              const oz0 = s.point.z + s.right.z * sideSign * railOffset;
              const ox1 = nextS.point.x + nextS.right.x * sideSign * railOffset;
              const oz1 = nextS.point.z + nextS.right.z * sideSign * railOffset;
              guardPos.push(
                ox0, s.point.y + 0.15, oz0,
                ox0, s.point.y + 0.15 + railHeight, oz0,
                ox1, nextS.point.y + 0.15, oz1,
                ox1, nextS.point.y + 0.15 + railHeight, oz1,
              );
              guardIdx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
            }
          }
        }

        if (roadIdx.length > 0) {
          const roadGeo = new THREE.BufferGeometry();
          roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPos, 3));
          roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
          roadGeo.setIndex(roadIdx);
          roadGeo.computeVertexNormals();
          const roadMesh = new THREE.Mesh(roadGeo, roadMat);
          roadMesh.receiveShadow = !isMobile;
          cGroup.add(roadMesh);
          disposables.push(roadGeo);
        }

        if (curbIdx.length > 0) {
          const curbGeo = new THREE.BufferGeometry();
          curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(curbPos, 3));
          curbGeo.setAttribute('color', new THREE.Float32BufferAttribute(curbColors, 3));
          curbGeo.setIndex(curbIdx);
          curbGeo.computeVertexNormals();
          const curbMesh = new THREE.Mesh(curbGeo, curbMat);
          curbMesh.receiveShadow = !isMobile;
          cGroup.add(curbMesh);
          disposables.push(curbGeo);
        }

        if (guardIdx.length > 0) {
          const guardGeo = new THREE.BufferGeometry();
          guardGeo.setAttribute('position', new THREE.Float32BufferAttribute(guardPos, 3));
          guardGeo.setIndex(guardIdx);
          guardGeo.computeVertexNormals();
          const guardMesh = new THREE.Mesh(guardGeo, guardMat);
          cGroup.add(guardMesh);
          disposables.push(guardGeo);
        }

        // 2. Abyss Hazard Edge Beams belonging to this chunk
        if (cfg.abyssGaps && cfg.abyssGaps.length > 0) {
          cfg.abyssGaps.forEach((gap) => {
            [gap.tStart, gap.tEnd].forEach((edgeT) => {
              if (chunkIndexForT(edgeT) !== c) return;
              const pt = track.curve.getPointAt(edgeT);
              const tan = track.curve.getTangentAt(edgeT).normalize();
              const yaw = Math.atan2(tan.x, tan.z);
              const beam = new THREE.Mesh(new THREE.BoxGeometry(cfg.roadWidth + 2.8, 0.55, 1.25), hazardMat);
              beam.position.set(pt.x, pt.y - 0.12, pt.z);
              beam.rotation.y = yaw;
              const cliff = new THREE.Mesh(new THREE.BoxGeometry(cfg.roadWidth + 2.4, 8.5, 1.4), cliffMat);
              cliff.position.set(pt.x, pt.y - 4.4, pt.z);
              cliff.rotation.y = yaw;
              cGroup.add(beam, cliff);
              disposables.push(beam.geometry, cliff.geometry);
            });
          });
        }

        // 3. Shortcut Bridges starting in this chunk
        if (cfg.shortcuts && cfg.shortcuts.length > 0) {
          cfg.shortcuts.forEach((sc) => {
            if (chunkIndexForT(sc.tStart) !== c) return;
            const span = sc.tEnd >= sc.tStart ? sc.tEnd - sc.tStart : 1 - sc.tStart + sc.tEnd;
            const steps = isMobile ? 10 : 16;
            const scPos: number[] = [];
            const scUvs: number[] = [];
            const scIdx: number[] = [];
            for (let k = 0; k <= steps; k++) {
              const u = k / steps;
              const t = wrapTVal(sc.tStart + span * u);
              const smp = track.curve.getPointAt(t);
              const tan = track.curve.getTangentAt(t).normalize();
              const right = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize();
              const lift = (sc.heightOffset ?? 0.5) * Math.sin(u * Math.PI);
              const cx = smp.x + right.x * sc.lateralCenter;
              const cy = smp.y + lift + 0.06;
              const cz = smp.z + right.z * sc.lateralCenter;
              scPos.push(
                cx - right.x * sc.halfWidth, cy, cz - right.z * sc.halfWidth,
                cx + right.x * sc.halfWidth, cy, cz + right.z * sc.halfWidth,
              );
              scUvs.push(0, u * 4, 1, u * 4);
              if (k < steps) {
                const b = k * 2;
                scIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
              }
            }
            const scGeo = new THREE.BufferGeometry();
            scGeo.setAttribute('position', new THREE.Float32BufferAttribute(scPos, 3));
            scGeo.setAttribute('uv', new THREE.Float32BufferAttribute(scUvs, 2));
            scGeo.setIndex(scIdx);
            scGeo.computeVertexNormals();
            const scMat = makeMat('#1e293b', 0.5, 0.1, sc.color ?? '#4ade80', 0.28, isMobile);
            scMat.side = THREE.DoubleSide;
            const scMesh = new THREE.Mesh(scGeo, scMat);
            cGroup.add(scMesh);

            const entPt = track.curve.getPointAt(sc.tStart);
            const entTan = track.curve.getTangentAt(sc.tStart).normalize();
            const entRight = new THREE.Vector3().crossVectors(entTan, new THREE.Vector3(0, 1, 0)).normalize();
            const gate = new THREE.Mesh(
              new THREE.TorusGeometry(sc.halfWidth * 0.85, 0.28, 6, isMobile ? 10 : 18, Math.PI),
              makeMat(sc.color ?? '#4ade80', 0.2, 0.3, sc.color ?? '#4ade80', 1.6, isMobile),
            );
            gate.position.set(
              entPt.x + entRight.x * sc.lateralCenter,
              entPt.y + 0.3,
              entPt.z + entRight.z * sc.lateralCenter,
            );
            gate.rotation.y = Math.atan2(entTan.x, entTan.z);
            cGroup.add(gate);
            disposables.push(scGeo, scMat, gate.geometry, gate.material as THREE.Material);
          });
        }

        // 4. Antigravity Magnetic Strips starting in this chunk
        if (cfg.antigravityZones && cfg.antigravityZones.length > 0) {
          cfg.antigravityZones.forEach((zone) => {
            if (chunkIndexForT(zone.tStart) !== c) return;
            const zColor = zone.color ?? '#22d3ee';
            const agTex = createAntigravTexture(zColor, maxAnisotropy);
            const agSpan = zone.tEnd >= zone.tStart ? zone.tEnd - zone.tStart : 1 - zone.tStart + zone.tEnd;
            const steps = isMobile ? 12 : 18;
            const agPos: number[] = [];
            const agUvs: number[] = [];
            const agIdx: number[] = [];
            const agHalf = halfW * 0.88;
            for (let k = 0; k <= steps; k++) {
              const u = k / steps;
              const t = wrapTVal(zone.tStart + agSpan * u);
              const smp = track.curve.getPointAt(t);
              const tan = track.curve.getTangentAt(t).normalize();
              const right = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize();
              agPos.push(
                smp.x - right.x * agHalf, smp.y + 0.06, smp.z - right.z * agHalf,
                smp.x + right.x * agHalf, smp.y + 0.06, smp.z + right.z * agHalf,
              );
              agUvs.push(0, u * 6, 1, u * 6);
              if (k < steps) {
                const b = k * 2;
                agIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
              }
              if (k % (isMobile ? 6 : 5) === 0) {
                const agArch = new THREE.Mesh(
                  new THREE.TorusGeometry(halfW + 0.8, 0.22, 6, isMobile ? 10 : 20, Math.PI),
                  makeMat(zColor, 0.2, 0.3, zColor, 1.8, isMobile),
                );
                agArch.position.copy(smp);
                agArch.rotation.y = Math.atan2(tan.x, tan.z);
                cGroup.add(agArch);
                disposables.push(agArch.geometry, agArch.material as THREE.Material);
              }
            }
            const agGeo = new THREE.BufferGeometry();
            agGeo.setAttribute('position', new THREE.Float32BufferAttribute(agPos, 3));
            agGeo.setAttribute('uv', new THREE.Float32BufferAttribute(agUvs, 2));
            agGeo.setIndex(agIdx);
            agGeo.computeVertexNormals();
            const agMat = new THREE.MeshBasicMaterial({
              map: agTex,
              transparent: true,
              opacity: 0.85,
              polygonOffset: true,
              polygonOffsetFactor: -1,
              side: THREE.DoubleSide,
            });
            const agMesh = new THREE.Mesh(agGeo, agMat);
            cGroup.add(agMesh);
            disposables.push(agTex, agGeo, agMat);
          });
        }

        // 5. Scenic 3D Waterfalls in this chunk
        if (cfg.waterfalls && cfg.waterfalls.length > 0) {
          cfg.waterfalls.forEach((wf) => {
            if (chunkIndexForT(wf.t) !== c) return;
            const smp = track.samples[Math.floor(wrapTVal(wf.t) * n) % n];
            const wW = wf.width ?? 11;
            const wH = wf.height ?? 19;
            const wx = smp.point.x + smp.right.x * wf.lateralOffset;
            const wy = smp.point.y;
            const wz = smp.point.z + smp.right.z * wf.lateralOffset;
            const wfGroup = new THREE.Group();
            wfGroup.position.set(wx, wy, wz);
            wfGroup.lookAt(smp.point.x, wy, smp.point.z);

            const cliff = new THREE.Mesh(new THREE.BoxGeometry(wW + 5, wH + 6, 6), wfCliffMat);
            cliff.position.set(0, wH * 0.4, -3.5);
            const stream = new THREE.Mesh(
              new THREE.PlaneGeometry(wW, wH + 2, isMobile ? 1 : 8, isMobile ? 1 : 12),
              wfWaterMat,
            );
            stream.position.set(0, wH * 0.42, 0.05);
            const foam = new THREE.Mesh(
              new THREE.CylinderGeometry(wW * 0.65, wW * 0.85, 0.7, isMobile ? 7 : 12),
              wfFoamMat,
            );
            foam.position.set(0, -1.6, 1.4);
            wfGroup.add(cliff, stream, foam);
            cGroup.add(wfGroup);
            disposables.push(cliff.geometry, stream.geometry, foam.geometry);
          });
        }

        // 6. Elevated Bridge Support Pillars in this chunk
        const pillarSpots: Array<{ x: number; y: number; z: number; h: number }> = [];
        for (let i = iStart; i < iEnd; i++) {
          if (i % 10 !== 0) continue;
          const smp = track.samples[i % n];
          if (smp.point.y > 3.2 && !isInAbyssGap(smp.t)) {
            const h = smp.point.y + 4;
            pillarSpots.push({ x: smp.point.x, y: smp.point.y - h * 0.5 - 0.1, z: smp.point.z, h });
          }
        }
        if (pillarSpots.length > 0) {
          const pillarInst = new THREE.InstancedMesh(pillarGeo, bridgePillarMat, pillarSpots.length);
          const pDummy = new THREE.Object3D();
          pillarSpots.forEach((p, idx) => {
            pDummy.position.set(p.x, p.y, p.z);
            pDummy.scale.set(1, p.h, 1);
            pDummy.rotation.set(0, 0, 0);
            pDummy.updateMatrix();
            pillarInst.setMatrixAt(idx, pDummy.matrix);
          });
          pillarInst.computeBoundingSphere();
          cGroup.add(pillarInst);
        }

        // 7. Caves & Underground Mines inside this chunk
        if (cfg.caves && cfg.caves.length > 0 && rockMat && woodMat && vaultGeo && postGeo && beamGeo && lanternGeo && railGeo && stalactiteGeo && crystalGeo && railSteelMat && oreCartMat && lanternMat) {
          const cDummy = new THREE.Object3D();
          const pushLocalMatrix = (
            arr: THREE.Matrix4[],
            origin: THREE.Vector3,
            yaw: number,
            lx: number,
            ly: number,
            lz: number,
            rx = 0,
            ry = 0,
            rz = 0,
          ) => {
            const cos = Math.cos(yaw);
            const sin = Math.sin(yaw);
            cDummy.position.set(
              origin.x + lx * cos + lz * sin,
              origin.y + ly,
              origin.z - lx * sin + lz * cos,
            );
            cDummy.rotation.order = 'YXZ';
            cDummy.rotation.set(rx, yaw + ry, rz);
            cDummy.scale.set(1, 1, 1);
            cDummy.updateMatrix();
            arr.push(cDummy.matrix.clone());
          };

          cfg.caves.forEach((cave, cIdx) => {
            const crystalMat = caveCrystalMats[cIdx];
            const span = cave.tEnd - cave.tStart;
            const steps = Math.max(8, Math.round(span * (isMobile ? 36 : 100)));
            const vaultMats: THREE.Matrix4[] = [];
            const postMats: THREE.Matrix4[] = [];
            const beamMats: THREE.Matrix4[] = [];
            const lanternMats: THREE.Matrix4[] = [];
            const railMats: THREE.Matrix4[] = [];
            const stalMats: THREE.Matrix4[] = [];
            const crystalMats: THREE.Matrix4[] = [];

            for (let s = 0; s <= steps; s++) {
              const t = cave.tStart + (span * s) / steps;
              if (chunkIndexForT(t) !== c) continue;
              const smp = track.samples[Math.floor(wrapTVal(t) * n) % n];
              const yaw = Math.atan2(smp.tangent.x, smp.tangent.z);

              pushLocalMatrix(vaultMats, smp.point, yaw, 0, 0.2, 0);
              if (cave.mineShaft && s % 2 === 0) {
                pushLocalMatrix(postMats, smp.point, yaw, -halfW - 0.85, 5.8, 0);
                pushLocalMatrix(postMats, smp.point, yaw, halfW + 0.85, 5.8, 0);
                pushLocalMatrix(beamMats, smp.point, yaw, 0, 11.7, 0);
                pushLocalMatrix(lanternMats, smp.point, yaw, s % 4 === 0 ? -halfW + 0.6 : halfW - 0.6, 10.2, 0);
                pushLocalMatrix(railMats, smp.point, yaw, halfW - 1.35, 0.14, 0);
                pushLocalMatrix(railMats, smp.point, yaw, halfW - 0.55, 0.14, 0);
              }
              if (s % 2 === 1) {
                pushLocalMatrix(stalMats, smp.point, yaw, ((s % 3) - 1) * (halfW * 0.48), 11.2, 0, Math.PI, 0, 0);
              }
              const sideSign = s % 2 === 0 ? -1 : 1;
              pushLocalMatrix(
                crystalMats,
                smp.point,
                yaw,
                sideSign * (halfW + 0.9),
                2.5 + (s % 3) * 1.1,
                0,
                0.3,
                s * 0.8,
                sideSign * 0.45,
              );
            }

            const addBatch = (mats: THREE.Matrix4[], geo: THREE.BufferGeometry, mat: THREE.Material) => {
              if (mats.length === 0) return;
              const inst = new THREE.InstancedMesh(geo, mat, mats.length);
              mats.forEach((m, idx) => inst.setMatrixAt(idx, m));
              inst.computeBoundingSphere();
              cGroup.add(inst);
            };
            addBatch(vaultMats, vaultGeo!, rockMat!);
            addBatch(postMats, postGeo!, woodMat!);
            addBatch(beamMats, beamGeo!, woodMat!);
            addBatch(lanternMats, lanternGeo!, lanternMat!);
            addBatch(railMats, railGeo!, railSteelMat!);
            addBatch(stalMats, stalactiteGeo!, rockMat!);
            if (crystalMat) addBatch(crystalMats, crystalGeo!, crystalMat);
          });

          // Build patrolling minecart meshes assigned to this chunk
          for (const mc of minecarts) {
            if (mc.chunkIndex !== c || mc.mesh) continue;
            const cartGrp = new THREE.Group();
            const tub = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.05, 2.2), oreCartMat);
            tub.position.y = 0.78;
            const rimTop = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.16, 2.35), railSteelMat);
            rimTop.position.y = 1.3;
            const cMat = caveCrystalMats[0] ?? lanternMat;
            const ore1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), cMat);
            ore1.position.set(-0.25, 1.5, 0.25);
            const ore2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.48, 0), lanternMat);
            ore2.position.set(0.3, 1.48, -0.3);
            const wheelGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.14, 7);
            wheelGeo.rotateZ(Math.PI / 2);
            [
              [-0.68, 0.24, 0.72],
              [0.68, 0.24, 0.72],
              [-0.68, 0.24, -0.72],
              [0.68, 0.24, -0.72],
            ].forEach(([wx, wy, wz]) => {
              const w = new THREE.Mesh(wheelGeo, railSteelMat!);
              w.position.set(wx, wy, wz);
              cartGrp.add(w);
            });
            cartGrp.add(tub, rimTop, ore1, ore2);
            cartGrp.position.set(mc.x, mc.y, mc.z);
            cGroup.add(cartGrp);
            mc.mesh = cartGrp;
            disposables.push(tub.geometry, rimTop.geometry, ore1.geometry, ore2.geometry, wheelGeo);
          }
        }

        // 8. Start / Finish Line Banner Arch (Chunk 0 only)
        if (c === 0) {
          const startSample = track.samples[0];
          const startYaw = Math.atan2(startSample.tangent.x, startSample.tangent.z);
          const finishTex = createFinishLineTexture(maxAnisotropy);
          const finishStrip = new THREE.Mesh(
            new THREE.PlaneGeometry(cfg.roadWidth - 0.5, 4.2),
            isMobile
              ? new THREE.MeshBasicMaterial({
                  map: finishTex,
                  polygonOffset: true,
                  polygonOffsetFactor: -1,
                  polygonOffsetUnits: -1,
                })
              : new THREE.MeshStandardMaterial({
                  color: 0xffffff,
                  map: finishTex,
                  roughness: 0.4,
                  polygonOffset: true,
                  polygonOffsetFactor: -1,
                  polygonOffsetUnits: -1,
                }),
          );
          finishStrip.rotation.x = -Math.PI / 2;
          finishStrip.rotation.z = -startYaw;
          finishStrip.position.set(startSample.point.x, startSample.point.y + 0.05, startSample.point.z);
          finishStrip.receiveShadow = !isMobile;
          cGroup.add(finishStrip);

          const archGroup = new THREE.Group();
          archGroup.position.copy(startSample.point);
          archGroup.rotation.y = startYaw;
          const pillarMat = makeMat('#0f172a', 0.35, 0.7, undefined, 0, isMobile);
          const bannerGlowMat = makeMat(cfg.accentColor, 0.25, 0.3, cfg.accentColor, 0.95, isMobile);
          const bannerSignTex = createStartBannerTexture(cfg.accentColor);
          const bannerSignMat = new THREE.MeshBasicMaterial({ map: bannerSignTex });

          const pL = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.95, 11.2, isMobile ? 7 : 12), pillarMat);
          pL.position.set(-halfW - 1.2, 5.6, 0);
          pL.castShadow = !isMobile;
          const pR = pL.clone();
          pR.position.x = halfW + 1.2;
          const crossbar = new THREE.Mesh(new THREE.BoxGeometry(cfg.roadWidth + 4, 2.8, 1.5), pillarMat);
          crossbar.position.set(0, 10.6, 0);
          crossbar.castShadow = !isMobile;
          const bannerFront = new THREE.Mesh(new THREE.PlaneGeometry(cfg.roadWidth + 1.4, 2.4), bannerSignMat);
          bannerFront.position.set(0, 10.6, -0.78);
          bannerFront.rotation.y = Math.PI;
          const bannerBack = new THREE.Mesh(new THREE.PlaneGeometry(cfg.roadWidth + 1.4, 2.4), bannerSignMat);
          bannerBack.position.set(0, 10.6, 0.78);
          const topTrim = new THREE.Mesh(new THREE.BoxGeometry(cfg.roadWidth + 4.4, 0.35, 1.75), bannerGlowMat);
          topTrim.position.set(0, 12.1, 0);
          archGroup.add(pL, pR, crossbar, bannerFront, bannerBack, topTrim);
          cGroup.add(archGroup);
          disposables.push(
            finishTex,
            finishStrip.geometry,
            finishStrip.material as THREE.Material,
            pillarMat,
            bannerGlowMat,
            bannerSignTex,
            bannerSignMat,
            pL.geometry,
            crossbar.geometry,
            bannerFront.geometry,
            topTrim.geometry,
          );
        }

        // 9. Vaulted Tunnels starting in this chunk
        cfg.tunnels.forEach((tun) => {
          if (chunkIndexForT(tun.tStart) !== c) return;
          const tunnelGlow = makeMat(tun.color, 0.2, 0.3, tun.color, 1.5, isMobile);
          const shellMat = isMobile
            ? new THREE.MeshLambertMaterial({
                color: '#0f172a',
                emissive: tun.color,
                emissiveIntensity: 0.14,
                side: THREE.DoubleSide,
              })
            : new THREE.MeshStandardMaterial({
                color: '#0f172a',
                emissive: tun.color,
                emissiveIntensity: 0.14,
                roughness: 0.55,
                metalness: 0.45,
                side: THREE.DoubleSide,
              });
          const steps = isMobile ? 8 : 18;
          const arcSegs = isMobile ? 5 : 10;
          const tunRadius = halfW + 1.8;
          const tunPos: number[] = [];
          const tunIdx: number[] = [];
          const ringMatrices: THREE.Matrix4[] = [];
          const tDummy = new THREE.Object3D();

          for (let s = 0; s <= steps; s++) {
            const t = tun.tStart + ((tun.tEnd - tun.tStart) * s) / steps;
            const smp = track.samples[Math.floor(wrapTVal(t) * n) % n];
            const yaw = Math.atan2(smp.tangent.x, smp.tangent.z);
            for (let a = 0; a <= arcSegs; a++) {
              const theta = (a / arcSegs) * Math.PI;
              const lat = -Math.cos(theta) * tunRadius;
              const height = Math.sin(theta) * (tunRadius * 0.72) + 0.15;
              tunPos.push(
                smp.point.x + smp.right.x * lat,
                smp.point.y + height,
                smp.point.z + smp.right.z * lat,
              );
            }
            if (s < steps) {
              const rowStride = arcSegs + 1;
              const r0 = s * rowStride;
              const r1 = (s + 1) * rowStride;
              for (let a = 0; a < arcSegs; a++) {
                tunIdx.push(r0 + a, r1 + a, r0 + a + 1, r0 + a + 1, r1 + a, r1 + a + 1);
              }
            }
            if (s % 2 === 0) {
              tDummy.position.set(smp.point.x, smp.point.y + 0.35, smp.point.z);
              tDummy.rotation.set(0, yaw, 0);
              tDummy.scale.set(1, 0.72, 1);
              tDummy.updateMatrix();
              ringMatrices.push(tDummy.matrix.clone());
            }
          }

          const shellGeo = new THREE.BufferGeometry();
          shellGeo.setAttribute('position', new THREE.Float32BufferAttribute(tunPos, 3));
          shellGeo.setIndex(tunIdx);
          shellGeo.computeVertexNormals();
          cGroup.add(new THREE.Mesh(shellGeo, shellMat));

          const neonRibGeo = new THREE.TorusGeometry(halfW + 0.9, 0.18, 5, isMobile ? 10 : 20, Math.PI);
          const ribInst = new THREE.InstancedMesh(neonRibGeo, tunnelGlow, ringMatrices.length);
          ringMatrices.forEach((m, idx) => ribInst.setMatrixAt(idx, m));
          ribInst.computeBoundingSphere();
          cGroup.add(ribInst);
          disposables.push(shellGeo, shellMat, neonRibGeo, tunnelGlow);
        });

        // 10. Ramps in this chunk
        cfg.ramps.forEach((ramp) => {
          if (chunkIndexForT(ramp.t) !== c) return;
          const rLat = ramp.lateralOffset ?? 0;
          const rHalfW = (ramp.width ?? cfg.roadWidth * 0.45) * 0.5;
          const segs = isMobile ? 6 : 10;
          const deckPos: number[] = [];
          const deckUvs: number[] = [];
          const deckIdx: number[] = [];
          const sidePos: number[] = [];
          const sideIdx: number[] = [];

          for (let s = 0; s <= segs; s++) {
            const u = s / segs;
            const t = wrapTVal(ramp.t + u * ramp.length);
            const pt = track.curve.getPointAt(t);
            const tan = track.curve.getTangentAt(t).normalize();
            const right = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize();
            const cx = pt.x + right.x * rLat;
            const cz = pt.z + right.z * rLat;
            const baseY = pt.y + 0.04;
            const topY = pt.y + u * ramp.height + 0.06;
            deckPos.push(
              cx - right.x * rHalfW, topY, cz - right.z * rHalfW,
              cx + right.x * rHalfW, topY, cz + right.z * rHalfW,
            );
            deckUvs.push(0, u * 2.5, 1, u * 2.5);
            sidePos.push(
              cx - right.x * rHalfW, baseY, cz - right.z * rHalfW,
              cx - right.x * rHalfW, topY, cz - right.z * rHalfW,
              cx + right.x * rHalfW, baseY, cz + right.z * rHalfW,
              cx + right.x * rHalfW, topY, cz + right.z * rHalfW,
            );
            if (s < segs) {
              const db = s * 2;
              deckIdx.push(db, db + 1, db + 2, db + 1, db + 3, db + 2);
              const sb = s * 4;
              sideIdx.push(sb, sb + 1, sb + 4, sb + 1, sb + 5, sb + 4);
              sideIdx.push(sb + 2, sb + 3, sb + 6, sb + 3, sb + 7, sb + 6);
            }
          }
          const lastB = segs * 4;
          sideIdx.push(lastB, lastB + 1, lastB + 2, lastB + 1, lastB + 3, lastB + 2);

          const deckGeo = new THREE.BufferGeometry();
          deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(deckPos, 3));
          deckGeo.setAttribute('uv', new THREE.Float32BufferAttribute(deckUvs, 2));
          deckGeo.setIndex(deckIdx);
          deckGeo.computeVertexNormals();
          const deckMesh = new THREE.Mesh(deckGeo, rampMat);
          deckMesh.receiveShadow = !isMobile;

          const sideGeo = new THREE.BufferGeometry();
          sideGeo.setAttribute('position', new THREE.Float32BufferAttribute(sidePos, 3));
          sideGeo.setIndex(sideIdx);
          sideGeo.computeVertexNormals();
          cGroup.add(deckMesh, new THREE.Mesh(sideGeo, rampSideMat));
          disposables.push(deckGeo, sideGeo);
        });

        // 11. Boost Pads & Side Pylons in this chunk
        const chunkPads = cfg.boostPads.filter((pad) => chunkIndexForT(pad.t) === c);
        if (chunkPads.length > 0) {
          const pylonInst = new THREE.InstancedMesh(pylonGeo, pylonMat, chunkPads.length * 2);
          const padDummy = new THREE.Object3D();
          let pIdx = 0;
          chunkPads.forEach((pad) => {
            const smp = track.samples[Math.floor(wrapTVal(pad.t) * n) % n];
            const yaw = Math.atan2(smp.tangent.x, smp.tangent.z);
            const mesh = new THREE.Mesh(boostGeo, boostMat);
            mesh.position.set(
              smp.point.x + smp.right.x * pad.lateralOffset,
              smp.point.y + 0.08,
              smp.point.z + smp.right.z * pad.lateralOffset,
            );
            mesh.rotation.order = 'YXZ';
            mesh.rotation.y = yaw;
            mesh.rotation.x = -Math.PI / 2;
            cGroup.add(mesh);

            [-2.8, 2.8].forEach((side) => {
              padDummy.position.set(
                smp.point.x + smp.right.x * (pad.lateralOffset + side),
                smp.point.y + 0.72,
                smp.point.z + smp.right.z * (pad.lateralOffset + side),
              );
              padDummy.rotation.set(0, 0, 0);
              padDummy.scale.set(1, 1, 1);
              padDummy.updateMatrix();
              pylonInst.setMatrixAt(pIdx++, padDummy.matrix);
            });
          });
          pylonInst.computeBoundingSphere();
          cGroup.add(pylonInst);
        }

        // 12. Item Boxes & Wumpa Crates inside this chunk
        itemBoxes.forEach((box) => {
          if (box.chunkIndex !== c || box.mesh) return;
          const m = new THREE.Mesh(boxGeo, boxMat);
          m.position.set(box.x, box.y, box.z);
          m.visible = box.respawnTimer <= 0;
          cGroup.add(m);
          box.mesh = m;
        });

        wumpaBoxes.forEach((wb) => {
          if (wb.chunkIndex !== c || wb.mesh) return;
          const m = new THREE.Mesh(wumpaGeo, wumpaMat);
          m.position.set(wb.x, wb.y, wb.z);
          m.visible = wb.respawnTimer <= 0;
          cGroup.add(m);
          wb.mesh = m;
        });

        // 13. Landmarks & Trees belonging to this chunk
        const sceneryIndices: number[] = [];
        for (let i = 0; i < sceneryCount; i++) {
          if (chunkIndexForT(i / sceneryCount) === c) {
            sceneryIndices.push(i);
          }
        }
        if (sceneryIndices.length > 0) {
          const landmarkInst = new THREE.InstancedMesh(crownGeo, propMat, sceneryIndices.length);
          landmarkInst.receiveShadow = !isMobile;
          const treeTrunkInst = showTrees
            ? new THREE.InstancedMesh(trunkGeo, trunkMat, sceneryIndices.length)
            : null;
          const treeTopInst = showTrees
            ? new THREE.InstancedMesh(foliageGeo, foliageMat, sceneryIndices.length)
            : null;

          const dummy = new THREE.Object3D();
          const tint = new THREE.Color();

          sceneryIndices.forEach((i, localIdx) => {
            const t = i / sceneryCount;
            const smp = track.samples[Math.floor(t * n) % n];
            const side = i % 2 === 0 ? 1 : -1;
            const dist = halfW + 11 + (i % 5) * 7.5;

            const px = smp.point.x + smp.right.x * side * (dist + 18);
            const pz = smp.point.z + smp.right.z * side * (dist + 18);
            const scaleY = 0.75 + ((i * 17) % 10) * 0.14;
            dummy.position.set(px, -2.2 + (isTowerTheme ? 9.5 * scaleY : 5 * scaleY), pz);
            dummy.scale.set(0.9 + (i % 3) * 0.2, scaleY, 0.9 + (i % 4) * 0.15);
            dummy.rotation.y = (i * 0.7) % Math.PI;
            dummy.updateMatrix();
            landmarkInst.setMatrixAt(localIdx, dummy.matrix);

            if (isTowerTheme) {
              tint.setHSL(0.55 + (i % 4) * 0.08, 0.28, cfg.theme === 'urban' ? 0.85 : 0.78);
              landmarkInst.setColorAt(localIdx, tint);
            }

            if (treeTrunkInst && treeTopInst) {
              const tx = smp.point.x - smp.right.x * side * dist;
              const tz = smp.point.z - smp.right.z * side * dist;
              const tScale = 0.85 + ((i * 7) % 5) * 0.1;
              dummy.position.set(tx, smp.point.y + 1.5, tz);
              dummy.scale.setScalar(tScale);
              dummy.rotation.y = i * 1.1;
              dummy.updateMatrix();
              treeTrunkInst.setMatrixAt(localIdx, dummy.matrix);

              dummy.position.set(tx, smp.point.y + 4.4 * tScale, tz);
              dummy.scale.set(tScale * 1.25, tScale * 1.35, tScale * 1.25);
              dummy.updateMatrix();
              treeTopInst.setMatrixAt(localIdx, dummy.matrix);
            }
          });

          landmarkInst.computeBoundingSphere();
          cGroup.add(landmarkInst);
          if (treeTrunkInst && treeTopInst) {
            treeTrunkInst.computeBoundingSphere();
            treeTopInst.computeBoundingSphere();
            cGroup.add(treeTrunkInst, treeTopInst);
          }
        }

        chunkObj.built = true;
        chunkObj.group = cGroup;
        group.add(cGroup);
        return cGroup;
      },
    };

    chunks.push(chunkObj);
  }

  return { group, envGroup, chunks, itemBoxes, wumpaBoxes, minecarts, animatedShaderMaterials, disposables };
}

export interface BuiltAdventureHubScene {
  group: THREE.Group;
  portals: Array<{
    trackId: string;
    trackName: string;
    chapter: number;
    x: number;
    z: number;
    radius: number;
    unlocked: boolean;
    completed: boolean;
    isBossPortal: boolean;
    ringMesh: THREE.Mesh;
  }>;
  disposables: Array<{ dispose: () => void }>;
}

function makePortalBannerTexture(title: string, badge: string, accent: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#090d14';
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 504, 152);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title.slice(0, 26), 256, 68);
  ctx.fillStyle = accent;
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(badge, 256, 120);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildAdventureHubStage(
  tracks: TrackConfig[],
  unlockedChapters: number,
  completedTracks: string[],
  bossUnlocked: boolean,
): BuiltAdventureHubScene {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const portals: BuiltAdventureHubScene['portals'] = [];

  const plazaMat = makeMat('#1e293b', 0.72, 0.14);
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(82, 84, 1.2, 48), plazaMat);
  plaza.position.y = -0.6;
  plaza.receiveShadow = true;
  group.add(plaza);

  const grassMat = makeMat('#15803d', 0.88, 0.04);
  const lawn = new THREE.Mesh(new THREE.CylinderGeometry(68, 68, 0.15, 48), grassMat);
  lawn.position.y = -0.04;
  lawn.receiveShadow = true;
  group.add(lawn);

  const wallMat = makeMat('#334155', 0.55, 0.35);
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(82, 82, 5.5, 48, 1, true), wallMat);
  wall.material.side = THREE.DoubleSide;
  wall.position.y = 2.6;
  group.add(wall);

  const centerEmblem = new THREE.Mesh(
    new THREE.RingGeometry(4.5, 6.2, 32),
    makeMat('#facc15', 0.25, 0.4, '#facc15', 0.8),
  );
  centerEmblem.rotation.x = -Math.PI / 2;
  centerEmblem.position.y = 0.05;
  group.add(centerEmblem);

  // Place 24 track portals around spacious plaza ring (radius 60m)
  const portalCount = tracks.length;
  tracks.forEach((trk, idx) => {
    const angle = (idx / portalCount) * Math.PI * 2 + Math.PI * 0.15;
    const px = Math.sin(angle) * 60;
    const pz = Math.cos(angle) * 60;
    const unlocked = trk.chapter <= unlockedChapters;
    const completed = completedTracks.includes(trk.id);

    const stoneColor = unlocked ? trk.accentColor : '#475569';
    const ringMat = makeMat(stoneColor, 0.22, 0.35, stoneColor, unlocked ? 1.4 : 0.15);
    const frameMat = makeMat('#0f172a', 0.45, 0.5);

    const portalGroup = new THREE.Group();
    portalGroup.position.set(px, 0, pz);
    portalGroup.lookAt(0, 0, 0);

    const arch = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.42, 10, 22, Math.PI), frameMat);
    arch.position.y = 0.6;
    const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(2.85, 0.22, 10, 22), ringMat);
    ringMesh.position.y = 2.9;

    const badge = completed ? '★ GANADA (1°)' : unlocked ? `CAP. ${trk.chapter} · ENTRAR` : `BLOQUEADA (CAP. ${trk.chapter})`;
    const bTex = makePortalBannerTexture(trk.name, badge, unlocked ? trk.accentColor : '#94a3b8');
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(7.2, 2.2),
      new THREE.MeshBasicMaterial({ map: bTex, side: THREE.DoubleSide }),
    );
    sign.position.set(0, 6.2, 0);

    // Cobblestone road path from center hub toward this portal
    const pathLen = 50;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(3.4, pathLen), makeMat('#475569', 0.8, 0.1));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.04, pathLen * 0.5 + 3.5);

    portalGroup.add(arch, ringMesh, sign, road);
    group.add(portalGroup);
    disposables.push(bTex, ringMat);

    portals.push({
      trackId: trk.id,
      trackName: trk.name,
      chapter: trk.chapter,
      x: px,
      z: pz,
      radius: 4.5,
      unlocked,
      completed,
      isBossPortal: false,
      ringMesh,
    });
  });

  // Special Crimson Boss Portal for Jarvin.exe! (Unlocks after 5 Adventure wins)
  const bx = 0;
  const bz = -24;
  const bossGroup = new THREE.Group();
  bossGroup.position.set(bx, 0, bz);
  const bossColor = bossUnlocked ? '#ef4444' : '#64748b';
  const bossRingMat = makeMat(bossColor, 0.2, 0.4, bossColor, bossUnlocked ? 1.8 : 0.2);
  const bossArch = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.55, 14, 28, Math.PI), makeMat('#18181b', 0.3, 0.7));
  bossArch.position.y = 0.6;
  const bossRing = new THREE.Mesh(new THREE.TorusGeometry(3.5, 0.28, 12, 28), bossRingMat);
  bossRing.position.y = 3.6;
  const bossTex = makePortalBannerTexture(
    'JEFE: JARVIN.EXE',
    bossUnlocked ? '¡PORTAL DE JEFE ABIERTO!' : 'GANA 5 CARRERAS PARA ABRIR',
    bossColor,
  );
  const bossSign = new THREE.Mesh(
    new THREE.PlaneGeometry(8.4, 2.5),
    new THREE.MeshBasicMaterial({ map: bossTex, side: THREE.DoubleSide }),
  );
  bossSign.position.set(0, 7.2, 0);
  bossGroup.add(bossArch, bossRing, bossSign);
  group.add(bossGroup);
  disposables.push(bossTex, bossRingMat);

  portals.push({
    trackId: 'neon_metropolis',
    trackName: 'Duelo contra Jarvin.exe',
    chapter: 99,
    x: bx,
    z: bz,
    radius: 5.0,
    unlocked: bossUnlocked,
    completed: false,
    isBossPortal: true,
    ringMesh: bossRing,
  });

  return { group, portals, disposables };
}

export interface BuiltBattleArenaScene {
  group: THREE.Group;
  itemBoxes: Array<{ mesh: THREE.Mesh; x: number; z: number; respawnTimer: number }>;
  disposables: Array<{ dispose: () => void }>;
}

export function buildBattleArenaStage(
  arena: BattleArenaConfig,
  maxAnisotropy: number,
): BuiltBattleArenaScene {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const itemBoxes: BuiltBattleArenaScene['itemBoxes'] = [];

  const groundTex = createGroundTexture(arena.floorColor, maxAnisotropy);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: groundTex,
    roughness: 0.55,
    metalness: 0.25,
  });
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(arena.radius, arena.radius, 1.4, 48), floorMat);
  floor.position.y = -0.7;
  floor.receiveShadow = true;
  group.add(floor);
  disposables.push(groundTex, floorMat);

  // Central jump dome
  const dome = new THREE.Mesh(
    new THREE.ConeGeometry(12, 1.4, 32),
    makeMat(arena.accentColor, 0.35, 0.4, arena.accentColor, 0.35),
  );
  dome.position.y = 0.7;
  dome.receiveShadow = true;
  group.add(dome);

  // Enclosed Perimeter Armor Wall + Neon Rim
  const wallMat = makeMat(arena.wallColor, 0.45, 0.55);
  wallMat.side = THREE.DoubleSide;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(arena.radius, arena.radius, 7.5, 48, 1, true), wallMat);
  wall.position.y = 3.7;
  const wallNeon = new THREE.Mesh(
    new THREE.TorusGeometry(arena.radius - 0.3, 0.35, 10, 48),
    makeMat(arena.accentColor, 0.2, 0.3, arena.accentColor, 1.5),
  );
  wallNeon.rotation.x = Math.PI / 2;
  wallNeon.position.y = 7.4;
  group.add(wall, wallNeon);

  // Pillars
  const pillarMat = makeMat('#334155', 0.4, 0.65);
  arena.pillars.forEach((p) => {
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(p.radius, p.radius * 1.08, 10, 18), pillarMat);
    pil.position.set(p.x, 5, p.z);
    pil.castShadow = true;
    pil.receiveShadow = true;
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(p.radius + 0.15, 0.2, 8, 18),
      makeMat(arena.accentColor, 0.2, 0.3, arena.accentColor, 1.4),
    );
    collar.rotation.x = Math.PI / 2;
    collar.position.set(p.x, 2.2, p.z);
    group.add(pil, collar);
  });

  // Boost Pads
  const boostTex = createBoostPadTexture(arena.accentColor, maxAnisotropy);
  const boostMat = new THREE.MeshBasicMaterial({ map: boostTex });
  const boostGeo = new THREE.PlaneGeometry(4.5, 5.8);
  arena.boostSpots.forEach((bp) => {
    const pad = new THREE.Mesh(boostGeo, boostMat);
    pad.position.set(bp.x, 0.08, bp.z);
    pad.rotation.order = 'YXZ';
    pad.rotation.y = bp.heading;
    pad.rotation.x = -Math.PI / 2;
    group.add(pad);
  });
  disposables.push(boostTex, boostGeo, boostMat);

  // Rocket-Only Fiery Red Item Boxes!
  const boxGeo = new THREE.OctahedronGeometry(1.25, 1);
  const boxMat = new THREE.MeshPhysicalMaterial({
    color: '#ef4444',
    emissive: '#dc2626',
    emissiveIntensity: 1.3,
    roughness: 0.14,
    metalness: 0.4,
    transparent: true,
    opacity: 0.92,
  });
  arena.itemSpots.forEach((spot) => {
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.set(spot.x, 1.45, spot.z);
    box.castShadow = true;
    group.add(box);
    itemBoxes.push({ mesh: box, x: spot.x, z: spot.z, respawnTimer: 0 });
  });
  disposables.push(boxGeo, boxMat);

  return { group, itemBoxes, disposables };
}
