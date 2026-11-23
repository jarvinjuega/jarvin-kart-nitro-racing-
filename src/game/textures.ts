import * as THREE from 'three';

function heightCanvasToNormalMap(
  heightData: Float32Array,
  size: number,
  strength: number,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const nCanvas = document.createElement('canvas');
  nCanvas.width = size;
  nCanvas.height = size;
  const ctx = nCanvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const sample = (x: number, y: number) => {
    const wx = ((x % size) + size) % size;
    const wy = ((y % size) + size) % size;
    return heightData[wy * size + wx];
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hL = sample(x - 1, y);
      const hR = sample(x + 1, y);
      const hU = sample(x, y - 1);
      const hD = sample(x, y + 1);
      const dx = (hL - hR) * strength;
      const dy = (hU - hD) * strength;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const idx = (y * size + x) * 4;
      data[idx] = Math.round(((dx / len) * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const normalMap = new THREE.CanvasTexture(nCanvas);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = maxAnisotropy;
  return normalMap;
}

export function createAsphaltTexture(
  roadColor: string,
  accentColor: string,
  maxAnisotropy: number,
  lowDetail = false,
): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const size = lowDetail ? 128 : 512;
  const scale = size / 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = roadColor;
  ctx.fillRect(0, 0, size, size);

  // Subtle asphalt tonal gradient across road width (smooth even on mobile, no noisy pixel speckle)
  const shoulderGrad = ctx.createLinearGradient(0, 0, size, 0);
  shoulderGrad.addColorStop(0, 'rgba(0,0,0,0.22)');
  shoulderGrad.addColorStop(0.14, 'rgba(255,255,255,0.03)');
  shoulderGrad.addColorStop(0.32, 'rgba(0,0,0,0.14)');
  shoulderGrad.addColorStop(0.5, 'rgba(255,255,255,0.04)');
  shoulderGrad.addColorStop(0.68, 'rgba(0,0,0,0.14)');
  shoulderGrad.addColorStop(0.86, 'rgba(255,255,255,0.03)');
  shoulderGrad.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = shoulderGrad;
  ctx.fillRect(0, 0, size, size);

  const dots = lowDetail ? 180 : 3800;
  for (let i = 0; i < dots; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const alpha = lowDetail ? 0.02 + Math.random() * 0.03 : 0.035 + Math.random() * 0.055;
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    ctx.fillRect(x, y, Math.max(1, Math.round(2 * scale)), Math.max(1, Math.round(4 * scale)));
  }

  // Crisp edge accent racing lines
  ctx.fillStyle = accentColor;
  ctx.fillRect(Math.round(14 * scale), 0, Math.max(3, Math.round(12 * scale)), size);
  ctx.fillRect(Math.round(486 * scale), 0, Math.max(3, Math.round(12 * scale)), size);

  // Clean dashed centerline
  ctx.fillStyle = 'rgba(248, 250, 252, 0.92)';
  const stepY = Math.max(32, Math.round(128 * scale));
  for (let y = Math.round(16 * scale); y < size; y += stepY) {
    ctx.fillRect(Math.round(250 * scale), y, Math.max(3, Math.round(12 * scale)), Math.max(16, Math.round(72 * scale)));
  }

  const targetAniso = Math.min(Math.max(maxAnisotropy || 1, 1), lowDetail ? 2 : 8);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = targetAniso;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;

  if (lowDetail) {
    return { map, normalMap: map, roughnessMap: map };
  }

  const nSize = 256;
  const hData = new Float32Array(nSize * nSize);
  for (let y = 0; y < nSize; y++) {
    for (let x = 0; x < nSize; x++) {
      const grain = (Math.sin(x * 1.9 + y * 0.7) * Math.cos(y * 2.3 - x * 0.5) + 1) * 0.12;
      const noise = (Math.random() - 0.5) * 0.16;
      const trackGroove = Math.sin((x / nSize) * Math.PI * 4) * 0.03;
      hData[y * nSize + x] = grain + noise + trackGroove;
    }
  }
  const normalMap = heightCanvasToNormalMap(hData, nSize, 0.55, targetAniso);

  const rSize = 256;
  const rCanvas = document.createElement('canvas');
  rCanvas.width = rSize;
  rCanvas.height = rSize;
  const rCtx = rCanvas.getContext('2d')!;
  const grad = rCtx.createLinearGradient(0, 0, rSize, 0);
  grad.addColorStop(0, '#c2c2c2');
  grad.addColorStop(0.25, '#7c7c7c');
  grad.addColorStop(0.5, '#626262');
  grad.addColorStop(0.75, '#7c7c7c');
  grad.addColorStop(1, '#c2c2c2');
  rCtx.fillStyle = grad;
  rCtx.fillRect(0, 0, rSize, rSize);

  for (let i = 0; i < 650; i++) {
    rCtx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)';
    rCtx.fillRect(Math.random() * rSize, Math.random() * rSize, 4, 16);
  }

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = targetAniso;

  return { map, normalMap, roughnessMap };
}

export function createRockPBRTextures(
  baseHex: string,
  maxAnisotropy: number,
  lowDetail = false,
): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  const size = lowDetail ? 128 : 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, size, size);

  // Smooth horizontal geological rock strata bands
  for (let band = 0; band < 10; band++) {
    const y = (band / 10) * size;
    ctx.fillStyle = band % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, y, size, size / 14);
  }

  const flecks = lowDetail ? 80 : 360;
  for (let i = 0; i < flecks; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(0,0,0,0.11)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(Math.random() * size, Math.random() * size, 6 + Math.random() * 14, 2 + Math.random() * 3);
  }

  const targetAniso = Math.min(Math.max(maxAnisotropy || 1, 1), lowDetail ? 4 : 8);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 2);
  map.anisotropy = targetAniso;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;

  if (lowDetail) {
    return { map, normalMap: map };
  }

  const hData = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const strata = Math.sin(y * 0.14 + Math.sin(x * 0.08) * 1.8) * 0.45;
      const crack = Math.cos(x * 0.11 - y * 0.09) * 0.35;
      const grit = (Math.random() - 0.5) * 0.3;
      hData[y * size + x] = strata + crack + grit;
    }
  }

  const normalMap = heightCanvasToNormalMap(hData, size, 2.4, targetAniso);
  normalMap.repeat.set(2, 2);
  return { map, normalMap };
}

export function createWoodPlankTextures(
  maxAnisotropy: number,
  lowDetail = false,
): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  const size = lowDetail ? 128 : 256;
  const plankW = size / 4;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#5c3419';
  ctx.fillRect(0, 0, size, size);

  for (let p = 0; p < 4; p++) {
    const x0 = p * plankW;
    ctx.fillStyle = p % 2 === 0 ? '#6b3e1f' : '#532f17';
    ctx.fillRect(x0 + 1, 0, plankW - 2, size);
    ctx.fillStyle = '#291509';
    ctx.fillRect(x0, 0, 2, size);
    for (let g = 0; g < (lowDetail ? 6 : 18); g++) {
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      ctx.fillRect(x0 + 2 + Math.random() * (plankW - 4), 0, 1.5, size);
    }
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = Math.min(Math.max(maxAnisotropy || 1, 1), lowDetail ? 2 : 6);

  if (lowDetail) {
    return { map, normalMap: map };
  }

  const hData = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const seam = x % 64 < 3 ? -0.9 : 0.1;
      const grain = Math.sin(x * 0.6 + Math.sin(y * 0.04) * 2.5) * 0.25;
      hData[y * size + x] = seam + grain;
    }
  }

  const normalMap = heightCanvasToNormalMap(hData, size, 2.1, maxAnisotropy);
  return { map, normalMap };
}

export function createCarPaintNormalMap(): THREE.CanvasTexture {
  const size = 128;
  const hData = new Float32Array(size * size);
  for (let i = 0; i < hData.length; i++) {
    hData[i] = (Math.random() - 0.5) * 0.18;
  }
  const nMap = heightCanvasToNormalMap(hData, size, 0.75, 4);
  nMap.repeat.set(4, 4);
  return nMap;
}

export function createTireTreadTextures(): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0a0e17';
  ctx.fillRect(0, 0, size, size);

  const hData = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const chevron = Math.sin((y + Math.abs(x - size * 0.5) * 1.4) * 0.42);
      const groove = chevron > 0.35 ? -0.65 : 0.25;
      hData[y * size + x] = groove;
      if (chevron > 0.35) {
        ctx.fillStyle = '#030508';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1, 6);

  const normalMap = heightCanvasToNormalMap(hData, size, 2.2, 4);
  normalMap.repeat.set(1, 6);
  return { map, normalMap };
}

export function createFinishLineTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const cols = 16;
  const rows = 4;
  const cw = canvas.width / cols;
  const ch = canvas.height / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#f8fafc' : '#0f172a';
      ctx.fillRect(c * cw, r * ch, cw, ch);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createBoostPadTexture(accentColor: string, maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#090d14';
  ctx.fillRect(0, 0, 256, 256);

  const colors = ['#facc15', accentColor, '#38bdf8'];
  for (let i = 0; i < 3; i++) {
    const y = 40 + i * 74;
    ctx.strokeStyle = colors[i % colors.length];
    ctx.lineWidth = 22;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(34, y + 48);
    ctx.lineTo(128, y);
    ctx.lineTo(222, y + 48);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createRampTexture(accentColor: string, maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 256, 256);

  // Side hazard rails
  ctx.fillStyle = '#facc15';
  ctx.fillRect(0, 0, 20, 256);
  ctx.fillRect(236, 0, 20, 256);
  ctx.fillStyle = '#18181b';
  for (let y = 0; y < 256; y += 32) {
    ctx.fillRect(0, y, 20, 14);
    ctx.fillRect(236, y, 20, 14);
  }

  // Forward launch chevrons
  for (let i = 0; i < 4; i++) {
    const y = 26 + i * 58;
    ctx.strokeStyle = i % 2 === 0 ? accentColor : '#facc15';
    ctx.lineWidth = 18;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(46, y + 34);
    ctx.lineTo(128, y);
    ctx.lineTo(210, y + 34);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createAntigravTexture(color: string, maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#071324';
  ctx.fillRect(0, 0, 256, 256);

  // Magnetic track glowing neon bars
  ctx.fillStyle = color;
  ctx.fillRect(10, 0, 14, 256);
  ctx.fillRect(232, 0, 14, 256);

  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  for (let y = 16; y < 256; y += 64) {
    ctx.globalAlpha = 0.72;
    ctx.beginPath();
    ctx.moveTo(40, y + 32);
    ctx.lineTo(128, y);
    ctx.lineTo(216, y + 32);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(122, 0, 12, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createGroundTexture(baseColor: string, maxAnisotropy: number, lowDetail = false): THREE.CanvasTexture {
  const size = lowDetail ? 128 : 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // Smooth diagonal tonal bands for clean distance readability without pixel grain
  const bandGrad = ctx.createLinearGradient(0, 0, size, size);
  bandGrad.addColorStop(0, 'rgba(255,255,255,0.05)');
  bandGrad.addColorStop(0.5, 'rgba(0,0,0,0.06)');
  bandGrad.addColorStop(1, 'rgba(255,255,255,0.05)');
  ctx.fillStyle = bandGrad;
  ctx.fillRect(0, 0, size, size);

  const patchCount = lowDetail ? 26 : 64;
  for (let i = 0; i < patchCount; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = (lowDetail ? 8 : 14) + Math.random() * (lowDetail ? 14 : 24);
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, i % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const targetAniso = Math.min(Math.max(maxAnisotropy || 1, 1), lowDetail ? 4 : 8);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(42, 42);
  tex.anisotropy = targetAniso;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
  grad.addColorStop(0.65, 'rgba(0, 0, 0, 0.28)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSkyDomeTexture(topHex: string, bottomHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, topHex);
  grad.addColorStop(0.65, bottomHex);
  grad.addColorStop(1, bottomHex);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCrateTexture(
  kind: 'question' | 'wumpa',
  accentColor: string,
  maxAnisotropy = 4,
): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  if (kind === 'wumpa') {
    // Rich warm timber crate with metal corner trim and bold Wumpa emblem
    ctx.fillStyle = '#9a3412';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#c2410c' : '#b45309';
      ctx.fillRect(14, 14 + i * 57, size - 28, 50);
    }
    ctx.strokeStyle = '#451a03';
    ctx.lineWidth = 14;
    ctx.strokeRect(7, 7, size - 14, size - 14);
    ctx.beginPath();
    ctx.moveTo(14, 14);
    ctx.lineTo(size - 14, size - 14);
    ctx.lineWidth = 10;
    ctx.stroke();

    // Glowing Wumpa fruit silhouette inside crate center
    const grad = ctx.createRadialGradient(122, 120, 12, 128, 132, 68);
    grad.addColorStop(0, '#fde047');
    grad.addColorStop(0.45, '#f97316');
    grad.addColorStop(0.82, '#dc2626');
    grad.addColorStop(1, '#7e22ce');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(128, 136, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#fef08a';
    ctx.stroke();

    // Green leaf tuft
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.ellipse(116, 74, 22, 10, -0.45, 0, Math.PI * 2);
    ctx.ellipse(142, 74, 20, 9, 0.45, 0, Math.PI * 2);
    ctx.fill();

    // "+5" crisp tag
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#450a0a';
    ctx.lineWidth = 7;
    ctx.strokeText('+5', 128, 142);
    ctx.fillText('+5', 128, 142);
  } else {
    // Classic arcade "?" wooden/metallic neon crate
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, size, size);
    const bgGrad = ctx.createLinearGradient(0, 0, size, size);
    bgGrad.addColorStop(0, '#0284c7');
    bgGrad.addColorStop(0.5, '#1e3a8a');
    bgGrad.addColorStop(1, '#0c4a6e');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(16, 16, size - 32, size - 32);

    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 14;
    ctx.strokeRect(10, 10, size - 20, size - 20);

    // Corner rivets
    ctx.fillStyle = '#facc15';
    for (const [rx, ry] of [
      [28, 28],
      [size - 28, 28],
      [28, size - 28],
      [size - 28, size - 28],
    ]) {
      ctx.beginPath();
      ctx.arc(rx, ry, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.font = '900 144px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#090d14';
    ctx.strokeText('?', 128, 138);
    ctx.fillStyle = '#fde047';
    ctx.fillText('?', 128, 138);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(Math.max(maxAnisotropy || 1, 1), 4);
  return tex;
}

export function createSkyscraperWindowTexture(
  facadeHex: string,
  windowGlowHex: string,
  lowDetail = false,
): THREE.CanvasTexture {
  const size = lowDetail ? 128 : 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = facadeHex;
  ctx.fillRect(0, 0, size, size);

  // Subtle vertical architectural ribs
  const cols = 6;
  const rows = 10;
  const cellW = size / cols;
  const cellH = size / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = ((r * 7 + c * 13) % 5) !== 0;
      ctx.fillStyle = lit ? windowGlowHex : 'rgba(9, 13, 20, 0.78)';
      ctx.globalAlpha = lit ? (((r + c) % 3) === 0 ? 0.88 : 0.56) : 1;
      ctx.fillRect(
        c * cellW + cellW * 0.2,
        r * cellH + cellH * 0.24,
        cellW * 0.6,
        cellH * 0.52,
      );
    }
  }
  ctx.globalAlpha = 1;
  // Glowing roof beacon stripe
  ctx.fillStyle = windowGlowHex;
  ctx.fillRect(0, 0, size, Math.max(4, size * 0.04));

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createStartBannerTexture(accentColor: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#090d14';
  ctx.fillRect(0, 0, 512, 128);

  // Checkered left/right flags
  const sq = 16;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 4; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#f8fafc' : '#0f172a';
      ctx.fillRect(c * sq, r * sq, sq, sq);
      ctx.fillRect(512 - (c + 1) * sq, r * sq, sq, sq);
    }
  }

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 6;
  ctx.strokeRect(66, 6, 380, 116);

  ctx.fillStyle = '#fde047';
  ctx.font = '900 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('JARVIN KART TURBO', 256, 48);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 22px sans-serif';
  ctx.fillText('★ LÍNEA DE META ★', 256, 88);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createFastSurfaceTexture(
  deepHex: string,
  brightHex: string,
  repeatCount = 24,
): THREE.CanvasTexture {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = deepHex;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = brightHex;
  ctx.globalAlpha = 0.38;
  ctx.lineWidth = 4;
  for (let y = 12; y < size; y += 24) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.33, y - 8, size * 0.66, y + 8, size, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatCount, repeatCount);
  return tex;
}

