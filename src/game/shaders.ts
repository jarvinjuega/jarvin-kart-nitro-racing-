import * as THREE from 'three';

export function createAtmosphericSkyMaterial(
  topHex: string,
  bottomHex: string,
  accentHex: string,
  isNightOrCave: boolean,
  lowDetail = false,
): THREE.ShaderMaterial {
  const fragmentShader = lowDetail
    ? /* glsl */ `
      uniform vec3 uTopColor;
      uniform vec3 uBottomColor;
      uniform vec3 uAccentColor;
      uniform vec3 uSunDir;
      uniform float uNight;
      varying vec3 vWorldDir;

      void main() {
        vec3 dir = normalize(vWorldDir);
        float horizonBlend = pow(clamp(dir.y, 0.0, 1.0), 0.58);
        vec3 horizonTint = mix(uBottomColor, uAccentColor, 0.16);
        vec3 sky = mix(horizonTint, uTopColor, horizonBlend);
        float haze = exp(-abs(dir.y) * 7.0);
        sky += uAccentColor * haze * 0.22;
        float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
        float sunGlow = pow(sunDot, 16.0) * 0.45;
        sky += mix(vec3(1.0, 0.92, 0.72), uAccentColor, uNight * 0.45) * sunGlow;
        if (dir.y < 0.0) {
          sky = mix(sky, uBottomColor * 0.45, clamp(-dir.y * 3.5, 0.0, 0.85));
        }
        gl_FragColor = vec4(sky, 1.0);
      }
    `
    : /* glsl */ `
      uniform float uTime;
      uniform vec3 uTopColor;
      uniform vec3 uBottomColor;
      uniform vec3 uAccentColor;
      uniform vec3 uSunDir;
      uniform float uNight;
      varying vec3 vWorldDir;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      void main() {
        vec3 dir = normalize(vWorldDir);
        float horizonBlend = pow(clamp(dir.y, 0.0, 1.0), 0.58);

        vec3 horizonTint = mix(uBottomColor, uAccentColor, 0.18);
        vec3 sky = mix(horizonTint, uTopColor, horizonBlend);

        // Warm atmospheric horizon haze band
        float haze = exp(-abs(dir.y) * 7.5);
        sky += uAccentColor * haze * 0.24;

        // Animated procedural volumetric cloud wisps
        if (dir.y > 0.02) {
          vec2 cloudUv = dir.xz / (dir.y + 0.25) * 1.45 + vec2(uTime * 0.012, uTime * 0.005);
          float c1 = noise(cloudUv * 2.2);
          float c2 = noise(cloudUv * 4.8 + vec2(3.1, -1.7));
          float clouds = smoothstep(0.46, 0.85, c1 * 0.65 + c2 * 0.35);
          float cloudFade = smoothstep(0.02, 0.25, dir.y);
          vec3 cloudCol = mix(vec3(1.0, 0.96, 0.9), uAccentColor, uNight * 0.55);
          sky = mix(sky, cloudCol, clouds * cloudFade * (0.42 - uNight * 0.16));
        }

        // Solar / Moon scattering halo
        float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
        float sunDisc = smoothstep(0.9965, 0.9992, sunDot);
        float sunGlow = pow(sunDot, 24.0) * 0.55 + pow(sunDot, 4.0) * 0.16;
        vec3 sunCol = mix(vec3(1.0, 0.92, 0.72), uAccentColor, uNight * 0.45);
        sky += sunCol * (sunGlow + sunDisc * 2.2);

        // Twinkling stars on night / space / underground tracks
        if (uNight > 0.5 && dir.y > 0.05) {
          vec2 starGrid = floor(dir.xz / max(0.18, dir.y) * 58.0);
          float starRnd = hash(starGrid);
          if (starRnd > 0.986) {
            float twinkle = 0.55 + 0.45 * sin(uTime * 4.0 + starRnd * 80.0);
            sky += vec3(0.9, 0.96, 1.0) * twinkle * smoothstep(0.05, 0.35, dir.y);
          }
        }

        // Slightly darken below horizon
        if (dir.y < 0.0) {
          sky = mix(sky, uBottomColor * 0.45, clamp(-dir.y * 4.0, 0.0, 0.85));
        }

        gl_FragColor = vec4(sky, 1.0);
      }
    `;

  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uTopColor: { value: new THREE.Color(topHex) },
      uBottomColor: { value: new THREE.Color(bottomHex) },
      uAccentColor: { value: new THREE.Color(accentHex) },
      uSunDir: { value: new THREE.Vector3(0.45, 0.55, 0.65).normalize() },
      uNight: { value: isNightOrCave ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader,
  });
}

export function createAnimatedSurfaceShader(
  kind: 'water' | 'lava',
  deepHex: string,
  brightHex: string,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDeepColor: { value: new THREE.Color(deepHex) },
      uBrightColor: { value: new THREE.Color(brightHex) },
      uIsLava: { value: kind === 'lava' ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uIsLava;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vec3 pos = position;
        float wave = sin(pos.x * 0.09 + uTime * 2.2) * cos(pos.y * 0.09 + uTime * 1.7);
        pos.z += wave * (uIsLava > 0.5 ? 0.35 : 0.55);
        vec4 world = modelMatrix * vec4(pos, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uDeepColor;
      uniform vec3 uBrightColor;
      uniform float uIsLava;
      varying vec2 vUv;
      varying vec3 vWorldPos;

      float caustic(vec2 p, float t) {
        float v = sin(p.x * 1.7 + t) * cos(p.y * 1.5 - t * 0.8);
        v += sin((p.x + p.y) * 1.3 - t * 1.2) * 0.65;
        return v * 0.5 + 0.5;
      }

      void main() {
        vec2 p = vWorldPos.xz * 0.095;
        float c1 = caustic(p, uTime * 1.6);
        float c2 = caustic(p * 1.9 + vec2(2.3, -1.4), -uTime * 1.15);
        float pattern = pow(clamp(c1 * 0.55 + c2 * 0.45, 0.0, 1.0), uIsLava > 0.5 ? 2.1 : 2.8);

        vec3 col = mix(uDeepColor, uBrightColor, pattern);
        if (uIsLava > 0.5) {
          float hotCore = smoothstep(0.58, 0.94, pattern);
          col = mix(col, vec3(1.0, 0.94, 0.45), hotCore * 0.85);
        } else {
          float foam = smoothstep(0.66, 0.96, pattern);
          col += vec3(0.75, 0.95, 1.0) * foam * 0.52;
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

export function createExhaustFlameShader(colorHex: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0.2 },
      uFlameColor: { value: new THREE.Color(colorHex) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 pos = position;
        float tipFactor = clamp(1.0 - uv.y, 0.0, 1.0);
        float flicker = sin(uTime * 42.0 + pos.y * 8.0) * 0.045 * tipFactor * (0.4 + uIntensity);
        pos.x += flicker;
        pos.z += cos(uTime * 36.0 + pos.y * 7.0) * 0.045 * tipFactor * (0.4 + uIntensity);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      uniform vec3 uFlameColor;
      varying vec2 vUv;
      void main() {
        float axial = clamp(vUv.y, 0.0, 1.0);
        float pulse = 0.78 + 0.22 * sin(uTime * 48.0 - axial * 12.0);
        vec3 core = vec3(1.0, 0.97, 0.85);
        vec3 col = mix(uFlameColor, core, smoothstep(0.45, 0.98, axial));
        float alpha = smoothstep(0.02, 0.55, axial) * pulse * clamp(uIntensity, 0.0, 1.35);
        gl_FragColor = vec4(col * (1.2 + uIntensity * 0.8), alpha);
      }
    `,
  });
}
