import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildOpenSourcePackageEntries, buildZipBuffer } from './zipBuilder.ts';

test('JarvinKartTurbo_CodigoLibre zip includes audio/*.ogg, texturas/*.png, dll/, LICENSE, codigo-libre/, zero GameJarvinTurbo, zero .bat, and passes unzip -t', () => {
  const entries = buildOpenSourcePackageEntries(process.cwd());
  const names = entries.map((e) => e.name);

  assert.ok(names.every((n) => n.startsWith('JarvinKartTurbo_CodigoLibre/')));
  assert.ok(!names.some((n) => /GameJarvinTurbo/i.test(n)), 'Must not contain GameJarvinTurbo anywhere in paths');
  assert.ok(names.includes('JarvinKartTurbo_CodigoLibre/LICENSE'));
  assert.ok(names.includes('JarvinKartTurbo_CodigoLibre/README.md'));
  assert.ok(names.includes('JarvinKartTurbo_CodigoLibre/codigo-libre/electron-main.cjs'));
  assert.ok(names.includes('JarvinKartTurbo_CodigoLibre/codigo-libre/package.json'));
  assert.ok(names.includes('JarvinKartTurbo_CodigoLibre/codigo-libre/server.ts'));
  assert.ok(names.includes('JarvinKartTurbo_CodigoLibre/codigo-libre/src/App.tsx'));
  assert.ok(names.includes('JarvinKartTurbo_CodigoLibre/dll/README_DLL.txt'));
  assert.ok(names.includes('JarvinKartTurbo_CodigoLibre/dll/descargar_dlls_windows.ps1'));
  assert.ok(names.includes('JarvinKartTurbo_CodigoLibre/dll/dll_manifest.json'));
  assert.ok(names.some((n) => n.startsWith('JarvinKartTurbo_CodigoLibre/audio/') && n.endsWith('.ogg')), 'Must include .ogg audio files');
  assert.ok(names.includes('JarvinKartTurbo_CodigoLibre/audio/16_Crash_Cove.ogg'));
  assert.ok(names.some((n) => n.startsWith('JarvinKartTurbo_CodigoLibre/texturas/') && n.endsWith('.png')), 'Must include .png textures');
  assert.ok(names.includes('JarvinKartTurbo_CodigoLibre/texturas/asfalto_pista.png'));
  assert.ok(names.includes('JarvinKartTurbo_CodigoLibre/texturas/turbo_pad.png'));
  assert.ok(!names.some((n) => n.toLowerCase().endsWith('.bat')), 'Must not include any .bat file');

  // Verify PNG magic signature on synthesized PNG texture
  const asphaltPng = entries.find((e) => e.name === 'JarvinKartTurbo_CodigoLibre/texturas/asfalto_pista.png');
  assert.ok(asphaltPng);
  assert.deepEqual(Array.from(asphaltPng.data.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);

  const pkgEntry = entries.find((e) => e.name === 'JarvinKartTurbo_CodigoLibre/codigo-libre/package.json');
  assert.ok(pkgEntry);
  const pkgJson = JSON.parse(pkgEntry.data.toString('utf8')) as Record<string, any>;
  assert.equal(pkgJson.main, 'electron-main.cjs');
  assert.equal(pkgJson.build?.productName, 'JarvinKartTurbo3D');
  assert.equal(pkgJson.build?.win?.executableName, 'app');
  assert.equal(pkgJson.build?.nsis?.displayLanguageSelector, true);

  const zipBuf = buildZipBuffer(entries);
  assert.ok(zipBuf.length < 20 * 1024 * 1024, `ZIP size (${zipBuf.length}) must stay well under Cloud Run 32MB limit`);
  const tmpZip = path.join(os.tmpdir(), `jkt3d_pkg_${Date.now()}.zip`);
  fs.writeFileSync(tmpZip, zipBuf);
  try {
    const out = execFileSync('unzip', ['-t', tmpZip], { encoding: 'utf8' });
    assert.match(out, /No errors detected in compressed data/);
  } finally {
    fs.rmSync(tmpZip, { force: true });
  }
});
