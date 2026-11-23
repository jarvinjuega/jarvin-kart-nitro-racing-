import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const CRC_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tbl[n] = c >>> 0;
  }
  return tbl;
})();

export function computeCrc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntryInput {
  name: string;
  data: Buffer;
}

export function buildZipBuffer(entries: ZipEntryInput[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const cleanName = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBuf = Buffer.from(cleanName, 'utf8');
    const uncompressed = entry.data;
    const crc = computeCrc32(uncompressed);
    const ext = path.extname(cleanName).toLowerCase();
    const alreadyCompressed = ['.mp3', '.ogg', '.jpg', '.jpeg', '.png', '.webp'].includes(ext);
    let payload = uncompressed;
    let method = 0;
    if (!alreadyCompressed) {
      const deflated = zlib.deflateRawSync(uncompressed, { level: 6 });
      if (deflated.length < uncompressed.length) {
        payload = deflated;
        method = 8;
      }
    }

    // Local File Header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x5421, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBuf, payload);

    // Central Directory Header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5421, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDirBuf, eocd]);
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(computeCrc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodeRgbaPng(width: number, height: number, pixelAt: (x: number, y: number) => [number, number, number, number]): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowOff = y * stride;
    raw[rowOff] = 0; // filter None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      const p = rowOff + 1 + x * 4;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
      raw[p + 3] = a;
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function generateGamePngTextures(): ZipEntryInput[] {
  const S = 64;
  return [
    {
      name: 'asfalto_pista.png',
      data: encodeRgbaPng(S, S, (x, y) => {
        const noise = (((x * 73 + y * 139) ^ (x * y)) & 15) - 7;
        if (x < 4 || x >= S - 4) {
          return y % 16 < 8 ? [220, 38, 38, 255] : [248, 250, 252, 255];
        }
        if (Math.abs(x - S / 2) < 2 && y % 16 < 10) {
          return [250, 204, 21, 255];
        }
        const base = 44 + noise;
        return [base, base + 3, base + 8, 255];
      }),
    },
    {
      name: 'turbo_pad.png',
      data: encodeRgbaPng(S, S, (x, y) => {
        const dx = Math.abs(x - S / 2);
        const chevron = ((y + dx) % 20) < 9;
        if (x < 3 || x >= S - 3) return [34, 211, 238, 255];
        return chevron ? [6, 182, 212, 255] : [250, 204, 21, 255];
      }),
    },
    {
      name: 'caja_misterio.png',
      data: encodeRgbaPng(S, S, (x, y) => {
        const border = x < 5 || x >= S - 5 || y < 5 || y >= S - 5;
        if (border) return [120, 53, 15, 255];
        const qTop = y >= 14 && y <= 26 && x >= 22 && x <= 42 && (y <= 19 || x >= 36);
        const qMid = y >= 26 && y <= 38 && x >= 28 && x <= 36;
        const qDot = y >= 43 && y <= 50 && x >= 28 && x <= 36;
        if (qTop || qMid || qDot) return [250, 204, 21, 255];
        const plank = y % 16 === 0 ? -18 : 0;
        return [180 + plank, 102 + plank, 34, 255];
      }),
    },
    {
      name: 'caja_wumpa.png',
      data: encodeRgbaPng(S, S, (x, y) => {
        const border = x < 5 || x >= S - 5 || y < 5 || y >= S - 5;
        if (border) return [124, 45, 18, 255];
        const cx = x - S / 2;
        const cy = y - S / 2 - 2;
        if (cx * cx + cy * cy < 220) return [249, 115, 22, 255];
        if (y >= 11 && y <= 18 && x >= 28 && x <= 38) return [34, 197, 94, 255];
        return [217, 119, 6, 255];
      }),
    },
    {
      name: 'meta_bandera.png',
      data: encodeRgbaPng(S, S, (x, y) => {
        const isWhite = ((x >> 3) + (y >> 3)) % 2 === 0;
        return isWhite ? [248, 250, 252, 255] : [15, 23, 42, 255];
      }),
    },
    {
      name: 'rampa_neon.png',
      data: encodeRgbaPng(S, S, (x, y) => {
        const stripe = ((x + y) % 16) < 4;
        if (stripe) return [236, 72, 153, 255];
        return [30, 27, 75, 255];
      }),
    },
  ];
}

function walkSourceFiles(dir: string, rootDir: string, out: ZipEntryInput[], prefix: string): void {
  if (!fs.existsSync(dir)) return;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    if (item.name === 'node_modules' || item.name === 'dist' || item.name === '.git' || item.name === 'data') {
      continue;
    }
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      walkSourceFiles(fullPath, rootDir, out, prefix);
    } else if (item.isFile()) {
      const ext = path.extname(item.name).toLowerCase();
      if (['.ts', '.tsx', '.css', '.html', '.json', '.cjs', '.mjs'].includes(ext)) {
        const rel = path.relative(rootDir, fullPath).replace(/\\/g, '/');
        out.push({
          name: `${prefix}/${rel}`,
          data: fs.readFileSync(fullPath),
        });
      }
    }
  }
}

function walkPublicFiles(dir: string, rootDir: string, out: ZipEntryInput[], prefix: string): void {
  if (!fs.existsSync(dir)) return;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      walkPublicFiles(fullPath, rootDir, out, prefix);
    } else if (item.isFile()) {
      const ext = path.extname(item.name).toLowerCase();
      // Skip large duplicate .mp3 files inside codigo-libre/public because open-format .ogg tracks are already in audio/
      if (['.ogg', '.jpg', '.jpeg', '.png', '.webp', '.svg', '.json', '.js', '.css'].includes(ext)) {
        const rel = path.relative(rootDir, fullPath).replace(/\\/g, '/');
        out.push({
          name: `${prefix}/${rel}`,
          data: fs.readFileSync(fullPath),
        });
      }
    }
  }
}

export function buildOpenSourcePackageEntries(rootDir: string): ZipEntryInput[] {
  const rootFolder = 'JarvinKartTurbo_CodigoLibre';
  const codePrefix = `${rootFolder}/codigo-libre`;
  const entries: ZipEntryInput[] = [];

  const readme = [
    '# Jarvin Kart Turbo 3D — Carpeta Libre de Código, Audios .ogg, Texturas .png y Librerías .dll',
    '',
    'Paquete libre oficial bajo licencia **MIT** sin dependencias ocultas.',
    '',
    '## Estructura de carpetas',
    '- `LICENSE` — Licencia MIT de código libre.',
    '- `audio/` — Pistas musicales y efectos convertidos a formato abierto **Ogg Vorbis (`.ogg`)**.',
    '- `texturas/` — Texturas 3D del juego e íconos en formato **`.png`** (asfalto, turbo pad, cajas ?, wumpa, meta, rampa).',
    '- `dll/` — Manifiesto y script PowerShell para obtener las librerías **`.dll`** oficiales de Windows (Electron/Chromium/ANGLE GPU) al compilar el ejecutable.',
    '- `codigo-libre/` — Código fuente completo (React + TypeScript + Three.js + Express + Electron) para modificar o compilar `app.exe`.',
    '',
    '## Cómo ejecutar o compilar la App PC (sin navegador)',
    '```bash',
    'cd codigo-libre',
    'npm install',
    'npm install --save-dev electron electron-builder',
    'npm run build',
    'npm run desktop',
    '```',
    '',
    '## Generar instalador .exe con sus .dll en Windows',
    '```bash',
    'cd codigo-libre',
    'npm run build:exe',
    '```',
    '',
  ].join('\r\n');

  const mitLicense = [
    'MIT License (Código Libre)',
    '',
    'Copyright (c) 2026 Jarvin Kart Turbo 3D',
    '',
    'Permission is hereby granted, free of charge, to any person obtaining a copy',
    'of this software and associated documentation files (the "Software"), to deal',
    'in the Software without restriction, including without limitation the rights',
    'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
    'copies of the Software, and to permit persons to whom the Software is',
    'furnished to do so, subject to the following conditions:',
    '',
    'The above copyright notice and this permission notice shall be included in all',
    'copies or substantial portions of the Software.',
    '',
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
    'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
    'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
    'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
    'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
    'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
    'SOFTWARE.',
    '',
  ].join('\r\n');

  const dllReadme = [
    '# Librerías .dll Requeridas en Windows (Electron / WebGL ANGLE)',
    '',
    'Para evitar archivos binarios falsos o bloqueados por Windows SmartScreen, las librerías .dll oficiales',
    'y firmadas se descargan automáticamente al instalar Electron o ejecutar el script de esta carpeta.',
    '',
    '## DLLs oficiales incluidas al compilar el juego PC (`app.exe`):',
    '- ffmpeg.dll           (Decodificación de audio .ogg y .mp3)',
    '- d3dcompiler_47.dll   (Compilador Direct3D de shaders WebGL)',
    '- libEGL.dll           (Contexto OpenGL ES / ANGLE en Windows)',
    '- libGLESv2.dll        (Renderizado Three.js WebGL2 acelerado por GPU)',
    '- vulkan-1.dll         (Backend gráfico Vulkan opcional)',
    '- vk_swiftshader.dll   (Renderizado de respaldo por CPU si no hay GPU)',
    '- chrome_elf.dll       (Motor de arranque seguro del proceso Electron)',
    '',
    '## Cómo copiar las .dll oficiales a esta carpeta en Windows:',
    'Ejecuta en PowerShell:',
    '  powershell -ExecutionPolicy Bypass -File .\\descargar_dlls_windows.ps1',
    '',
  ].join('\r\n');

  const dllFetchScript = [
    '$ErrorActionPreference = "Stop"',
    '$codeDir = Resolve-Path (Join-Path $PSScriptRoot "..\\codigo-libre")',
    '$dllOut = $PSScriptRoot',
    'Push-Location $codeDir',
    'if (!(Test-Path "node_modules\\electron\\dist")) {',
    '  Write-Host "Instalando runtime oficial de Electron para obtener .dll firmadas..."',
    '  npm install --save-dev electron',
    '}',
    '$distDir = Join-Path $codeDir "node_modules\\electron\\dist"',
    'Get-ChildItem -Path $distDir -Filter "*.dll" | ForEach-Object {',
    '  Copy-Item $_.FullName -Destination (Join-Path $dllOut $_.Name) -Force',
    '}',
    'Pop-Location',
    'Write-Host "Listo: librerias .dll copiadas en $dllOut"',
    '',
  ].join('\r\n');

  const dllManifest = JSON.stringify(
    {
      runtime: 'electron-win32-x64',
      requiredDlls: [
        'ffmpeg.dll',
        'd3dcompiler_47.dll',
        'libEGL.dll',
        'libGLESv2.dll',
        'vulkan-1.dll',
        'vk_swiftshader.dll',
        'chrome_elf.dll',
      ],
      notes: 'Ejecuta dll/descargar_dlls_windows.ps1 en Windows para poblar los binarios oficiales.',
    },
    null,
    2,
  );

  const electronMain = `const { app, BrowserWindow } = require('electron');
const path = require('path');

function createGameWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 960,
    minHeight: 600,
    title: 'Jarvin Kart Turbo 3D',
    backgroundColor: '#090d14',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'dist', 'index.html'));
}

app.whenReady().then(() => {
  createGameWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createGameWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
`;

  // Read package.json and augment it with real Electron standalone & NSIS Windows .exe build config
  const pkgPath = path.join(rootDir, 'package.json');
  let desktopPkg = '{}';
  if (fs.existsSync(pkgPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
      const scripts = (parsed.scripts as Record<string, string> | undefined) ?? {};
      const augmented = {
        ...parsed,
        name: 'jarvin-kart-turbo-3d',
        main: 'electron-main.cjs',
        scripts: {
          ...scripts,
          desktop: 'electron .',
          'build:exe': 'npm run build && electron-builder --win nsis',
        },
        build: {
          appId: 'com.jarvinkart.turbo3d',
          productName: 'JarvinKartTurbo3D',
          files: ['dist/**/*', 'public/**/*', 'electron-main.cjs', 'package.json'],
          win: {
            target: ['nsis'],
            executableName: 'app',
          },
          nsis: {
            oneClick: false,
            allowToChangeInstallationDirectory: true,
            perMachine: false,
            displayLanguageSelector: true,
            installerLanguages: ['es', 'en'],
          },
        },
      };
      desktopPkg = JSON.stringify(augmented, null, 2);
    } catch {
      desktopPkg = fs.readFileSync(pkgPath, 'utf8');
    }
  }

  entries.push(
    { name: `${rootFolder}/README.md`, data: Buffer.from(readme, 'utf8') },
    { name: `${rootFolder}/LICENSE`, data: Buffer.from(mitLicense, 'utf8') },
    { name: `${rootFolder}/dll/README_DLL.txt`, data: Buffer.from(dllReadme, 'utf8') },
    { name: `${rootFolder}/dll/descargar_dlls_windows.ps1`, data: Buffer.from(dllFetchScript, 'utf8') },
    { name: `${rootFolder}/dll/dll_manifest.json`, data: Buffer.from(dllManifest, 'utf8') },
    { name: `${codePrefix}/electron-main.cjs`, data: Buffer.from(electronMain, 'utf8') },
    { name: `${codePrefix}/package.json`, data: Buffer.from(desktopPkg, 'utf8') },
  );

  // Open-format Ogg Vorbis audio folder (`audio/*.ogg`)
  const oggDir = path.join(rootDir, 'data', 'audio_ogg');
  if (fs.existsSync(oggDir)) {
    for (const file of fs.readdirSync(oggDir)) {
      if (file.toLowerCase().endsWith('.ogg')) {
        entries.push({
          name: `${rootFolder}/audio/${file}`,
          data: fs.readFileSync(path.join(oggDir, file)),
        });
      }
    }
  }

  // Open PNG textures folder (`texturas/*.png`): generated game PNGs + public PNG icons
  for (const tex of generateGamePngTextures()) {
    entries.push({
      name: `${rootFolder}/texturas/${tex.name}`,
      data: tex.data,
    });
  }
  const publicDir = path.join(rootDir, 'public');
  if (fs.existsSync(publicDir)) {
    for (const file of fs.readdirSync(publicDir)) {
      if (file.toLowerCase().endsWith('.png')) {
        entries.push({
          name: `${rootFolder}/texturas/${file}`,
          data: fs.readFileSync(path.join(publicDir, file)),
        });
      }
    }
  }

  // Open-source build files inside `codigo-libre/`
  const rootConfigFiles = ['index.html', 'tsconfig.json', 'vite.config.ts', 'server.ts', 'metadata.json'];
  for (const file of rootConfigFiles) {
    const full = path.join(rootDir, file);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      entries.push({
        name: `${codePrefix}/${file}`,
        data: fs.readFileSync(full),
      });
    }
  }

  walkSourceFiles(path.join(rootDir, 'src'), rootDir, entries, codePrefix);
  walkSourceFiles(path.join(rootDir, 'server'), rootDir, entries, codePrefix);
  walkPublicFiles(path.join(rootDir, 'public'), rootDir, entries, codePrefix);

  return entries;
}
