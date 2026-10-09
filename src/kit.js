/* 3D 공용 도구 — 모든 인물의 장면이 같이 쓴다 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const rnd = (a, b) => a + Math.random() * (b - a);
export const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
export function hash2(x, y) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

const BASE = { top: '#2a3150', horizon: '#c9875a', sun: '#ffb07a', fog: '#84604b', fogD: .0062, sunEl: 5, sunAz: 26, sunI: 2.4, hemiI: .55, stars: .08, storm: .05, ash: .14, wind: .2, camH: 1.65, camP: .02, camY: 0, camX: 0, camZ: 0, camR: 0, exposure: 1, fire: 0, sing: 0, shake: 0, waves: 0 };

/* 성경 인물 캐릭터 (assets/chars, PLAN 6장 1번). 게시본은 window.CHAR_GLB에 GLB가 base64로 들어 있다.
   게시된 페이지는 fetch로 data URI를 읽지 못하므로 직접 풀어 parse한다. 없거나 실패하면 figure()가 person()으로 대신한다 */
let figSrc = null;
async function loadFigs(GLTFLoader) {
  const D = window.CHAR_GLB; if (!D) return null;
  const buf = u => Uint8Array.from(atob(u.slice(u.indexOf(',') + 1)), c => c.charCodeAt(0)).buffer;
  const ld = new GLTFLoader();
  const [m, f, a] = await Promise.all([D.char_m, D.char_f, D.anims].map(u => ld.parseAsync(buf(u), '')));
  return { m, f, clips: Object.fromEntries(a.animations.map(c => [c.name, c])), outfits: window.OUTFITS };
}

export async function createKit(canvas, { presets = {}, initial = 'start', audio } = {}) {
  const PRE = {};
  for (const k in presets) PRE[k] = presets[k];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const PR = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(PR);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const fog = new THREE.FogExp2(0x000000, .006);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, .05, 3000);
  camera.rotation.order = 'YXZ';

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(PR);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), .6, .55, .85);
  composer.addPass(bloom);
  const grain = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        vec2 q = vUv - .5;
        c.rgb *= clamp(1.0 - dot(q, q) * 1.35, 0.0, 1.0);
        float g = h(vUv * vec2(1931.0, 1087.0) + fract(uTime) * 97.0) - .5;
        c.rgb += g * .045 * (.25 + c.rgb);
        gl_FragColor = c;
      }`
  });
  composer.addPass(grain);
  composer.addPass(new OutputPass());

  /* --- 하늘 --- */
  const skyU = {
    uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunColor: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, .1, -1) }, uStars: { value: 0 }, uStorm: { value: 0 }, uTime: { value: 0 }, uFlash: { value: 0 }, uSing: { value: 0 }, uFog: { value: new THREE.Color() }
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), new THREE.ShaderMaterial({
    uniforms: skyU, side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunColor; uniform vec3 uSunDir;
      uniform float uStars; uniform float uStorm; uniform float uTime; uniform float uFlash; uniform float uSing; uniform vec3 uFog;
      varying vec3 vDir;
      float hash13(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
        return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
      float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= .5; } return v; }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0., 1.), .42));
        col = mix(uFog, col, smoothstep(-.03, .16, h));
        vec3 sd3 = normalize(uSunDir);
        float sd = max(dot(d, sd3), 0.);
        float clear = 1. - uStorm * .9;
        col += uSunColor * (pow(sd, 5.) * .28 + pow(sd, 48.) * .55) * clear * smoothstep(-.25, .05, sd3.y);
        col += uSunColor * smoothstep(.99955, .9998, sd) * 6. * clear * step(-.01, h);
        vec3 mwAxis = normalize(vec3(.35, .55, .76));
        float band = exp(-pow(dot(d, mwAxis), 2.) * 14.);
        float mw = band * (.35 + .65 * fbm(d.xz * 6. + d.y * 3.));
        vec3 sp = d * 95.; vec3 ci = floor(sp); vec3 cf = fract(sp) - .5;
        float r = hash13(ci);
        float thresh = 1. - .011 * uStars - mw * .012 * uStars;
        float s = step(thresh, r) * smoothstep(.17, 0., length(cf));
        float tw = .65 + .35 * sin(uTime * (1.5 + r * 3.) + r * 60.);
        tw += uSing * .9 * (.5 + .5 * sin(uTime * 2.1 + r * 20.));
        vec3 starCol = mix(vec3(.75, .82, 1.), vec3(1., .88, .72), fract(r * 13.));
        float vis = smoothstep(0., .08, h) * (1. - uStorm);
        col += starCol * s * tw * uStars * vis * 2.4;
        col += vec3(.5, .56, .75) * mw * .09 * uStars * vis;
        vec2 cuv = d.xz / (h + .18);
        float c = fbm(cuv * .9 + vec2(uTime * .012, uTime * .004));
        float cloud = smoothstep(.42, .82, c) * smoothstep(-.02, .2, h);
        vec3 cloudCol = mix(uHorizon * .3, uTop * .55 + uHorizon * .15, smoothstep(.4, .9, c));
        cloudCol += uFlash * vec3(.55, .6, .78) * smoothstep(.4, .8, c);
        col = mix(col, cloudCol, cloud * clamp(uStorm * 1.1, 0., 1.));
        col = mix(col, col * .85 + uSunColor * .06, cloud * .25 * (1. - uStorm));
        col += uFlash * .16 * vec3(.7, .75, .95);
        gl_FragColor = vec4(col, 1.);
      }`
  }));
  sky.renderOrder = -1; scene.add(sky);

  /* --- 빛 --- */
  const sun = new THREE.DirectionalLight('#ffffff', 2); scene.add(sun);
  const hemi = new THREE.HemisphereLight('#ffffff', '#332211', .6); scene.add(hemi);

  /* --- 입자 풀 (불꽃, 흙먼지, 연기) --- */
  const PV = `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; uniform float uPR;
    varying vec3 vC; varying float vA;
    void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * uPR * (320.0 / max(.1, -mv.z)); gl_Position = projectionMatrix * mv; }`;
  const PF = `varying vec3 vC; varying float vA;
    void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, 0., d); gl_FragColor = vec4(vC, a * a * vA); }`;
  function pool(n, additive) {
    const P = new Float32Array(n * 3), C = new Float32Array(n * 3), S = new Float32Array(n), A = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    const aP = new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage), aC = new THREE.BufferAttribute(C, 3).setUsage(THREE.DynamicDrawUsage);
    const aS = new THREE.BufferAttribute(S, 1).setUsage(THREE.DynamicDrawUsage), aA = new THREE.BufferAttribute(A, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', aP); geo.setAttribute('aColor', aC); geo.setAttribute('aSize', aS); geo.setAttribute('aAlpha', aA);
    const pts = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: { uPR: { value: PR } }, vertexShader: PV, fragmentShader: PF, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    pts.frustumCulled = false; scene.add(pts);
    const vel = new Float32Array(n * 3), base = new Float32Array(n * 3), life = new Float32Array(n), age = new Float32Array(n).fill(1e9), s0 = new Float32Array(n), grow = new Float32Array(n), grav = new Float32Array(n), drag = new Float32Array(n), a0 = new Float32Array(n);
    let head = 0, alive = 0;
    return {
      emit(x, y, z, o) {
        const i = head; head = (head + 1) % n;
        P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
        vel[i * 3] = o.vx; vel[i * 3 + 1] = o.vy; vel[i * 3 + 2] = o.vz;
        base[i * 3] = o.c[0]; base[i * 3 + 1] = o.c[1]; base[i * 3 + 2] = o.c[2];
        life[i] = o.life; age[i] = 0; s0[i] = o.size; grow[i] = o.grow || 0; grav[i] = o.g || 0; drag[i] = o.drag || 0; a0[i] = o.alpha == null ? 1 : o.alpha;
        alive = 1;
      },
      update(dt) {
        if (!alive) return;
        let any = 0;
        for (let i = 0; i < n; i++) {
          if (age[i] >= life[i]) { if (A[i] !== 0) { A[i] = 0; any = 1; } continue; }
          any = 1; age[i] += dt; const k = age[i] / life[i];
          const dr = Math.max(0, 1 - drag[i] * dt);
          vel[i * 3] *= dr; vel[i * 3 + 1] = (vel[i * 3 + 1] + grav[i] * dt) * dr; vel[i * 3 + 2] *= dr;
          P[i * 3] += vel[i * 3] * dt; P[i * 3 + 1] += vel[i * 3 + 1] * dt; P[i * 3 + 2] += vel[i * 3 + 2] * dt;
          A[i] = a0[i] * (k < .12 ? k / .12 : 1 - (k - .12) / .88);
          S[i] = s0[i] * (1 + k * grow[i]);
          const f = additive ? 1 - k * .75 : 1;
          C[i * 3] = base[i * 3] * f; C[i * 3 + 1] = base[i * 3 + 1] * f * (additive ? 1 - k * .4 : 1); C[i * 3 + 2] = base[i * 3 + 2] * f * (additive ? 1 - k * .6 : 1);
        }
        aP.needsUpdate = aC.needsUpdate = aS.needsUpdate = aA.needsUpdate = true;
        if (!any) alive = 0;
      },
      clear() { age.fill(1e9); A.fill(0); aA.needsUpdate = true; }
    };
  }
  const sparks = pool(3000, true), dust = pool(2600, false);

  /* --- 떠다니는 재·먼지 --- */
  const ashN = 2400, ashSeed = new Float32Array(ashN * 3);
  for (let i = 0; i < ashN * 3; i++) ashSeed[i] = Math.random();
  const ashGeo = new THREE.BufferGeometry();
  ashGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ashN * 3), 3));
  ashGeo.setAttribute('aSeed', new THREE.BufferAttribute(ashSeed, 3));
  const ashU = { uTime: { value: 0 }, uAmt: { value: 0 }, uPR: { value: PR }, uWind: { value: 0 }, uTint: { value: new THREE.Color() }, uCam: { value: new THREE.Vector3() } };
  const ashPts = new THREE.Points(ashGeo, new THREE.ShaderMaterial({
    uniforms: ashU, transparent: true, depthWrite: false,
    vertexShader: `attribute vec3 aSeed; uniform float uTime, uAmt, uPR, uWind; uniform vec3 uCam; varying float vA;
      void main(){
        vec3 box = vec3(36., 16., 36.);
        vec3 p = aSeed * box;
        p.y = mod(p.y - uTime * (.22 + aSeed.x * .35), box.y);
        p.x = mod(p.x + uTime * (.3 + uWind * 3.) * (.5 + aSeed.z) + sin(uTime * .7 + aSeed.y * 20.) * .6, box.x);
        p.z = mod(p.z + sin(uTime * .5 + aSeed.x * 30.) * .5 + uTime * .15, box.z);
        p -= vec3(box.x * .5, 2., box.z * .5); p += vec3(uCam.x, 0., uCam.z);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        float dist = -mv.z;
        gl_PointSize = (.03 + aSeed.z * .05) * uPR * (320. / max(.2, dist));
        gl_Position = projectionMatrix * mv;
        vA = uAmt * smoothstep(30., 4., dist) * smoothstep(.2, 1., dist);
      }`,
    fragmentShader: `uniform vec3 uTint; varying float vA;
      void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(uTint, smoothstep(.5, .1, d) * vA * .8); }`
  }));
  ashPts.frustumCulled = false; scene.add(ashPts);

  /* --- 환경 상태와 보간 --- */
  const isColorKey = k => k === 'top' || k === 'horizon' || k === 'sun' || k === 'fog';
  const env = {};
  for (const k in BASE) env[k] = isColorKey(k) ? new THREE.Color(BASE[k]) : BASE[k];
  const tw = {};
  let clock = 0;
  function stepTweens() {
    for (const k in tw) {
      const t = tw[k], kk = t.dur <= 0 ? 1 : clamp((clock - t.t0) / t.dur, 0, 1), e = ease(kk);
      if (isColorKey(k)) env[k].copy(t.from).lerp(t.to, e); else env[k] = t.from + (t.to - t.from) * e;
      if (kk >= 1) delete tw[k];
    }
  }
  function setEnv(name, dur = 3, extra) {
    const src = typeof name === 'string' ? Object.assign({}, BASE, PRE[name] || {}) : name;
    const patch = Object.assign({}, src, extra || {});
    for (const k in patch) {
      if (!(k in env)) continue;
      tw[k] = isColorKey(k) ? { from: env[k].clone(), to: new THREE.Color(patch[k]), t0: clock, dur } : { from: env[k], to: patch[k], t0: clock, dur };
    }
    if (dur <= 0) stepTweens();
    return sleep(Math.max(0, dur) * 1000);
  }

  /* --- 여러 날의 낮과 밤 --- */
  let cyc = null;
  function stepCycle() {
    const k = clamp((clock - cyc.t0) / cyc.dur, 0, 1), ph = k * cyc.n * Math.PI * 2;
    const el = -50 * Math.cos(ph), day = smooth(-8, 14, el);
    env.sunEl = el; env.sunAz = -80 + 160 * ((ph / (Math.PI * 2)) % 1);
    for (const key of ['top', 'horizon', 'fog', 'sun']) env[key].copy(cyc.N[key]).lerp(cyc.D[key], day);
    env.stars = 1 - day; env.sunI = lerp(cyc.N.sunI, cyc.D.sunI, day); env.hemiI = lerp(cyc.N.hemiI, cyc.D.hemiI, day); env.fogD = lerp(cyc.N.fogD, cyc.D.fogD, day); env.storm = lerp(cyc.N.storm, cyc.D.storm, day);
    const count = ph >= Math.PI ? Math.floor((ph - Math.PI) / (Math.PI * 2)) + 1 : 0;
    if (count > cyc.last) { cyc.last = count; cyc.onDay && cyc.onDay(count); }
    if (k >= 1) { const r = cyc.res; cyc = null; r(); }
  }
  function cycleDays(n, secs, onDay, nightName = 'night', dayName = 'day') {
    const pick = nm => { const p = Object.assign({}, BASE, PRE[nm] || {}); return { top: new THREE.Color(p.top), horizon: new THREE.Color(p.horizon), fog: new THREE.Color(p.fog), sun: new THREE.Color(p.sun), sunI: p.sunI, hemiI: p.hemiI, fogD: p.fogD, storm: p.storm }; };
    return new Promise(res => { cyc = { t0: clock, dur: secs, n, onDay, last: 0, res, N: pick(nightName), D: pick(dayName) }; });
  }

  /* --- 일반 숫자 보간 (사람의 고개, 무리의 이동 등) --- */
  const tweens = [];
  function tween(obj, to, dur = 1, onDone) {
    const from = {}; for (const k in to) from[k] = obj[k];
    for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].obj === obj) for (const k in to) delete tweens[i].to[k];
    return new Promise(res => tweens.push({ obj, from, to: Object.assign({}, to), t0: clock, dur: Math.max(.001, dur), res: () => { onDone && onDone(); res(); } }));
  }
  function stepNumTweens() {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const t = tweens[i], k = clamp((clock - t.t0) / t.dur, 0, 1), e = ease(k);
      for (const key in t.to) t.obj[key] = t.from[key] + (t.to[key] - t.from[key]) * e;
      if (k >= 1) { tweens.splice(i, 1); t.res(); }
    }
  }

  /* --- 지형 --- */
  function terrain({ height, size = 900, seg = 240, lo = '#5f4738', hi = '#b8936a', yMul = .055, grain = .3, at = [0, 0] } = {}) {
    const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2); g.translate(at[0], 0, at[1]);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    const cLo = new THREE.Color(lo), cHi = new THREE.Color(hi), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), y = height(x, z); p.setY(i, y);
      c.copy(cLo).lerp(cHi, clamp(.5 + y * yMul + (vnoise(x * .35, z * .35) - .5) * grain, 0, 1));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
    scene.add(m); return m;
  }
  function disc({ r = 12, c0 = '#6d5846', c1 = '#8a7058', at = [0, 0], y = .02, height } = {}) {
    const g = new THREE.CircleGeometry(r, 72); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    const a = new THREE.Color(c0), b = new THREE.Color(c1), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + at[0], z = p.getZ(i) + at[1];
      if (height) p.setY(i, height(x, z));
      c.copy(a).lerp(b, vnoise(x * .8, z * .8)); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })); m.position.set(at[0], y, at[1]); scene.add(m); return m;
  }
  function rocks({ n = 160, height, color = '#7b6856', rMin = 4, rMax = 110, center = [0, 0], avoid, big = .08, sMin = .12, sMax = .8 } = {}) {
    const m = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }), n);
    const d = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      let x, z, tries = 0;
      do { const a = Math.random() * Math.PI * 2, r = rMin + Math.pow(Math.random(), 1.6) * (rMax - rMin); x = center[0] + Math.cos(a) * r; z = center[1] + Math.sin(a) * r; tries++; }
      while (avoid && avoid(x, z) && tries < 30);
      const s = rnd(sMin, sMax) * (Math.random() < big ? 2.2 : 1);
      d.position.set(x, (height ? height(x, z) : 0) - s * .25, z);
      d.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3)); d.scale.set(s * rnd(.8, 1.6), s * rnd(.5, 1), s * rnd(.8, 1.4));
      d.updateMatrix(); m.setMatrixAt(i, d.matrix);
    }
    scene.add(m); return m;
  }
  function box(w, h, d, color, x = 0, y = 0, z = 0, parent = scene, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || new THREE.MeshStandardMaterial({ color, roughness: 1 }));
    m.position.set(x, y, z); parent.add(m); return m;
  }
  const glowMat = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), fog: false });
  function glow(w, h, r, g, b, x, y, z, parent = scene) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glowMat(r, g, b)); m.position.set(x, y, z); parent.add(m); return m; }

  /* --- 사람 --- */
  const standProf = [[0, 0], [.34, 0], [.31, .3], [.25, .85], [.21, 1.25], [.16, 1.4], [.06, 1.46], [0, 1.46]];
  const seatProf = [[0, 0], [.55, 0], [.5, .18], [.32, .5], [.22, .78], [.12, .86], [0, .88]];
  const kneelProf = [[0, 0], [.42, 0], [.4, .2], [.27, .55], [.2, .92], [.13, 1.04], [0, 1.06]];
  const profGeo = {};
  const getProf = kind => profGeo[kind] || (profGeo[kind] = new THREE.LatheGeometry((kind === 'seat' ? seatProf : kind === 'kneel' ? kneelProf : standProf).map(p => new THREE.Vector2(p[0], p[1])), 18));
  const headGeo = new THREE.SphereGeometry(.12, 16, 12), hoodGeo = new THREE.SphereGeometry(.15, 16, 12, 0, Math.PI * 2, 0, Math.PI * .62);
  const skinMats = {};
  function person(color, { pose = 'stand', scale = 1, skin = '#5a4535', hood = true, visible = false, emissive } = {}) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 1 });
    if (emissive) { mat.emissive = new THREE.Color(emissive); mat.emissiveIntensity = 1; }
    g.add(new THREE.Mesh(getProf(pose), mat));
    const top = pose === 'seat' ? .88 : pose === 'kneel' ? 1.06 : 1.46;
    const head = new THREE.Mesh(headGeo, skinMats[skin] || (skinMats[skin] = new THREE.MeshStandardMaterial({ color: skin, roughness: .9 }))); head.position.y = top + .1; g.add(head);
    if (hood) { const h = new THREE.Mesh(hoodGeo, mat); h.position.set(0, top + .11, -.025); g.add(h); }
    g.userData.head = head; g.userData.mat = mat;
    g.scale.setScalar(scale); g.visible = visible; scene.add(g);
    return g;
  }
  // 이름 있는 인물: 옷 입은 마네킹 + 동작. person()과 같은 자리에 쓴다. role은 outfits.json의 신분, tint는 겉옷 색
  if (!figSrc) figSrc = await loadFigs(GLTFLoader).catch(e => { console.warn('인물 캐릭터를 불러오지 못했습니다:', e); return null; });
  const POSE_CLIP = { stand: 'Idle_Loop', seat: 'Sitting_Idle_Loop', kneel: 'Fixing_Kneeling' };
  const UNDER = ['under_chest', 'under_body', 'under_arm', 'under_thigh', 'under_calf'];
  const TINT = [['dress', 'dress'], ['royal_mantle', 'royal'], ['mantle', 'mantle'], ['tunic_long', 'tunic'], ['tunic_short', 'tunic']];
  const figs = [];
  function figure(role, { tint, colors, pose = 'stand', clip, scale = 1, visible = false, seatDrop = .3 } = {}) {
    const spec = figSrc && figSrc.outfits.roles[role];
    if (!spec) return person(tint || '#4a3c30', { pose, scale, visible });
    const d = figSrc.outfits.default_colors, col = { ...d };  // 색 규칙은 tools/chars/build_chars.py role_colors와 같다
    for (const u of UNDER) col[u] = spec.under || d.tunic;
    for (const u of spec.bare || []) col[u] = d.M_Main;
    Object.assign(col, spec.colors || {});
    const t = tint && TINT.find(([w]) => spec.wear.includes(w)); if (t) col[t[1]] = tint;
    Object.assign(col, colors || {});
    const g = new THREE.Group(), body = SkeletonUtils.clone((spec.body === 'f' ? figSrc.f : figSrc.m).scene);
    body.traverse(o => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      if (!o.name.startsWith('Mannequin')) o.visible = spec.wear.includes(o.name);
      o.material = o.material.clone();
      const c = col[o.material.name]; if (c) o.material.color.set(c);
      if (o.material.metalness > .5) { o.material.metalness = .35; o.material.roughness = .45; }  // 반사 환경이 없어도 금빛이 보이게
    });
    if (pose === 'seat' && !clip) body.position.y = -seatDrop;  // 의자 높이로 앉는 동작을 땅·배 위에 맞춘다
    g.add(body);
    const mixer = new THREE.AnimationMixer(body);
    const F = { mixer, base: clip || POSE_CLIP[pose] || 'Idle_Loop', cur: null,
      play(name, fade = .3, speed = 1) {
        const c = figSrc.clips[name]; if (!c) return;
        const a = mixer.clipAction(c); a.timeScale = speed; if (F.cur === a) return;
        a.reset().play(); if (F.cur && fade) F.cur.crossFadeTo(a, fade, false); else if (F.cur) F.cur.stop();
        F.cur = a;
      } };
    F.play(F.base, 0); mixer.update(Math.random() * 3);  // 여러 사람이 같은 박자로 움직이지 않게
    g.userData.fig = F; g.userData.head = body.getObjectByName('Head');
    g.scale.setScalar(scale * .92); g.visible = visible; scene.add(g); figs.push(g);
    return g;
  }
  const stepFigs = dt => { for (const g of figs) if (g.visible) g.userData.fig.mixer.update(dt); };
  // 많은 사람을 한 번에 (무리, 군대)
  function throng({ n, place, height, colors = ['#3a3029', '#4a3c30', '#2e2925', '#5a4a3a'], scale = [.92, 1.06], pose = 'stand' }) {
    const g = new THREE.Group();
    const body = new THREE.InstancedMesh(getProf(pose), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), n);
    const head = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: '#5a4535', roughness: .9 }), n);
    const d = new THREE.Object3D(), c = new THREE.Color(), top = pose === 'seat' ? .88 : 1.46;
    const items = [];
    for (let i = 0; i < n; i++) {
      const [x, z, ry] = place(i), s = rnd(scale[0], scale[1]);
      const y = height ? height(x, z) : 0;
      items.push({ x, y, z, ry: ry == null ? rnd(0, 6.3) : ry, s });
    }
    function draw(k = 1) {
      items.forEach((o, i) => {
        d.position.set(o.x, o.y, o.z); d.rotation.set(0, o.ry, 0); d.scale.setScalar(o.s * k + .0001); d.updateMatrix(); body.setMatrixAt(i, d.matrix);
        d.position.y = o.y + (top + .1) * o.s * k; d.updateMatrix(); head.setMatrixAt(i, d.matrix);
      });
      body.instanceMatrix.needsUpdate = head.instanceMatrix.needsUpdate = true;
    }
    items.forEach((o, i) => { c.set(colors[i % colors.length]).multiplyScalar(rnd(.8, 1.1)); body.setColorAt(i, c); });
    draw();
    g.add(body, head); scene.add(g);
    g.userData.items = items; g.userData.draw = draw;
    return g;
  }
  const walkers = [];
  function walker(g, { height, pace = 11, amp = .09, lean = .22, standLean = .3 } = {}) {
    const F = g.userData.fig; if (F) { amp = 0; lean = 0; standLean = 0; }  // 캐릭터는 걷기 동작이 몸을 움직인다
    const o = { g, height: height || (() => 0), pace, amp, lean, standLean, state: 'idle', t0: 0, dur: 1, from: new THREE.Vector3(), to: new THREE.Vector3(), res: null, seed: Math.random() * 6 };
    o.go = (from, to, dur) => {
      if (from) o.from.copy(from); if (to) o.to.copy(to); o.dur = dur || o.dur; g.visible = true; o.state = 'run'; o.t0 = clock; g.position.copy(o.from);
      if (F) { const sp = Math.hypot(o.to.x - o.from.x, o.to.z - o.from.z) / o.dur / g.scale.x, run = sp > 2.4 || pace >= 10; F.play(run ? 'Jog_Fwd_Loop' : 'Walk_Loop', .25, clamp(sp / (run ? 3 : 1.25), .6, 1.7)); }
      return new Promise(r => { o.res = r; });
    };
    o.idle = () => { o.state = 'idle'; };
    walkers.push(o); return o;
  }
  function stepWalkers() {
    walkers.forEach(o => {
      if (o.state === 'run') {
        const k = clamp((clock - o.t0) / o.dur, 0, 1), e = 1 - (1 - k) * (1 - k);
        const x = lerp(o.from.x, o.to.x, e), z = lerp(o.from.z, o.to.z, e);
        o.g.position.set(x, o.height(x, z) + Math.abs(Math.sin(clock * o.pace)) * o.amp * (1 - k * .5), z);
        o.g.rotation.x = o.lean;
        o.g.rotation.y = Math.atan2(o.to.x - o.from.x, o.to.z - o.from.z);
        if (k >= 1) { o.state = 'stand'; o.g.userData.fig && o.g.userData.fig.play(o.g.userData.fig.base); o.g.rotation.y = Math.atan2(camera.position.x - o.g.position.x, camera.position.z - o.g.position.z); const r = o.res; o.res = null; r && r(); }
      } else if (o.state === 'stand') {
        const b = Math.sin(clock * 2.2 + o.seed);
        o.g.position.y = o.height(o.g.position.x, o.g.position.z) + b * .012;
        o.g.rotation.x = o.g.userData.fig ? 0 : o.standLean + b * .03;
      }
    });
  }
  // 사람이 당신 쪽을 돌아본다
  function faceCamera(g, dur = 1.2, tilt) {
    const wp = g.getWorldPosition(new THREE.Vector3());
    const a = Math.atan2(camera.position.x - wp.x, camera.position.z - wp.z);
    let cur = g.rotation.y; while (a - cur > Math.PI) cur += Math.PI * 2; while (a - cur < -Math.PI) cur -= Math.PI * 2; g.rotation.y = cur;
    const to = { y: a }; if (tilt != null) to.x = tilt;
    return tween(g.rotation, to, dur);
  }

  /* --- 가축 떼 --- */
  const ANIMALS = {
    sheep: { color: '#d8cfc0', dark: '#3a3028', parts: [['s', [0, .42, 0], [.42, .34, .62]], ['s', [0, .55, .55], [.13, .13, .17], 1], ...legs(.2, .3, .3, .035, 1)] },
    goat: { color: '#3b3029', dark: '#241c17', parts: [['s', [0, .44, 0], [.34, .3, .58]], ['s', [0, .66, .52], [.11, .12, .16], 1], ['c', [0, .82, .5], [.02, .14, .02], 1, [-.5, 0, 0]], ...legs(.16, .34, .3, .03, 1)] },
    ox: { color: '#6b4e38', dark: '#2a1e15', parts: [['s', [0, .82, 0], [.55, .5, 1.05]], ['s', [0, .9, 1.02], [.24, .24, .3]], ['c', [.18, 1.1, 1.0], [.025, .16, .025], 1, [0, 0, -1.1]], ['c', [-.18, 1.1, 1.0], [.025, .16, .025], 1, [0, 0, 1.1]], ...legs(.32, .56, .5, .07, 1)] },
    donkey: { color: '#7c7266', dark: '#2d2721', parts: [['s', [0, .82, 0], [.34, .36, .72]], ['c', [0, 1.08, .58], [.1, .32, .1], 0, [.7, 0, 0]], ['s', [0, 1.22, .86], [.11, .12, .24]], ['c', [.06, 1.42, .8], [.02, .13, .02], 1], ['c', [-.06, 1.42, .8], [.02, .13, .02], 1], ...legs(.2, .56, .42, .05, 1)] },
    camel: { color: '#b08a5e', dark: '#4a3826', parts: [['s', [0, 1.55, 0], [.48, .48, .95]], ['s', [0, 2.02, -.05], [.3, .32, .38]], ['c', [0, 1.85, .95], [.1, .55, .1], 0, [.55, 0, 0]], ['s', [0, 2.3, 1.32], [.13, .14, .3]], ...legs(.26, 1.05, .6, .07, 0)] }
  };
  function legs(x, h, z, r, dark) { return [[x, z], [-x, z], [x, -z], [-x, -z]].map(([lx, lz]) => ['c', [lx, h / 2, lz], [r, h, r], dark]); }
  const animalGeo = { s: new THREE.SphereGeometry(1, 10, 8), c: new THREE.CylinderGeometry(1, 1, 1, 6), b: new THREE.BoxGeometry(1, 1, 1) };
  function herd(kind, { n, center, rx = 15, rz = 12, height, scale = [.85, 1.15], placer, color } = {}) {
    const def = ANIMALS[kind], g = new THREE.Group(); g.position.set(center[0], 0, center[1]);
    const items = [];
    for (let i = 0; i < n; i++) {
      let x, z; if (placer) [x, z] = placer(i); else { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()); x = Math.cos(a) * r * rx; z = Math.sin(a) * r * rz; }
      items.push({ x, z, ry: rnd(0, 6.3), s: rnd(scale[0], scale[1]), tint: rnd(.8, 1.05), on: true });
    }
    const body = new THREE.Color(color || def.color), dark = new THREE.Color(def.dark), tmp = new THREE.Color();
    const meshes = def.parts.map(pt => {
      const m = new THREE.InstancedMesh(animalGeo[pt[0]], new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), n);
      m.userData.pt = pt; g.add(m); return m;
    });
    const base = new THREE.Object3D(), part = new THREE.Object3D(), mtx = new THREE.Matrix4();
    function draw() {
      items.forEach((o, i) => {
        const y = height ? height(center[0] + o.x, center[1] + o.z) : 0;
        base.position.set(o.x, y, o.z); base.rotation.set(0, o.ry, 0); base.scale.setScalar(o.on ? o.s : .0001); base.updateMatrix();
        meshes.forEach(m => {
          const pt = m.userData.pt;
          part.position.set(pt[1][0], pt[1][1], pt[1][2]); part.scale.set(pt[2][0], pt[2][1], pt[2][2]);
          part.rotation.set(pt[4] ? pt[4][0] : 0, pt[4] ? pt[4][1] : 0, pt[4] ? pt[4][2] : 0); part.updateMatrix();
          mtx.multiplyMatrices(base.matrix, part.matrix); m.setMatrixAt(i, mtx);
          tmp.copy(pt[3] ? dark : body).multiplyScalar(o.tint); m.setColorAt(i, tmp);
        });
      });
      meshes.forEach(m => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    }
    draw(); scene.add(g);
    g.userData.items = items; g.userData.draw = draw;
    // 일부만 남기기 (0~1)
    g.userData.keep = frac => { const k = Math.round(items.length * frac); items.forEach((o, i) => { o.on = i < k; }); draw(); };
    return g;
  }

  /* --- 불 (모닥불, 숯불, 제단 불) --- */
  const fires = [];
  function fire(pos, { logs = true, ring = true, level = 0, useEnv = false, smoke = false, coals = false, size = 1, light = 7 } = {}) {
    const g = new THREE.Group(); g.position.set(pos[0], pos[1] || .05, pos[2]); scene.add(g);
    if (logs) { const logM = new THREE.MeshStandardMaterial({ color: '#2a1d14', roughness: 1 }); [0, 1.2, 2.3].forEach(a => { const l = new THREE.Mesh(new THREE.CylinderGeometry(.05, .06, .72, 6), logM); l.rotation.set(Math.PI / 2 - .2, a, 0); l.position.y = .07; l.scale.setScalar(size); g.add(l); }); }
    if (ring) { const sm = new THREE.MeshStandardMaterial({ color: '#5b5048', roughness: 1, flatShading: true }); for (let i = 0; i < 9; i++) { const s = new THREE.Mesh(new THREE.DodecahedronGeometry(.09 * size, 0), sm); const a = i / 9 * Math.PI * 2; s.position.set(Math.cos(a) * .42 * size, .04, Math.sin(a) * .42 * size); g.add(s); } }
    let coalMat = null;
    if (coals) { coalMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) }); for (let i = 0; i < 14; i++) { const c = new THREE.Mesh(new THREE.DodecahedronGeometry(.06 * size, 0), coalMat); c.position.set(rnd(-.25, .25) * size, .05, rnd(-.25, .25) * size); g.add(c); } }
    const L = new THREE.PointLight('#ff8240', 0, 24, 2); L.position.set(0, .6, 0); g.add(L);
    const f = { g, level, useEnv, smoke, coals, size, light, L, coalMat };
    fires.push(f); return f;
  }
  function stepFires(dt) {
    fires.forEach(f => {
      const amt = (f.useEnv ? env.fire : 1) * f.level;
      if (!f.g.visible || amt < .02) { f.L.intensity = 0; if (f.coalMat) f.coalMat.color.setRGB(.05, .03, .02); return; }
      const p = f.g.position, s = f.size;
      if (f.coals) {
        f.coalMat.color.setRGB(2.2 * amt * (.8 + Math.sin(clock * 3) * .2), .55 * amt, .12 * amt);
        if (Math.random() < amt * dt * 6) sparks.emit(p.x + rnd(-.2, .2) * s, p.y + .1, p.z + rnd(-.2, .2) * s, { vx: rnd(-.1, .1), vy: rnd(.5, 1.2), vz: rnd(-.1, .1), c: [2.6, 1.2, .4], life: rnd(.8, 1.6), size: .03, g: -.1, drag: .3 });
      } else {
        const cnt = perFrame(f, amt * 70 * dt * s);
        for (let i = 0; i < cnt; i++) sparks.emit(p.x + rnd(-.18, .18) * s, p.y + .1, p.z + rnd(-.18, .18) * s, { vx: rnd(-.15, .15), vy: rnd(.6, 1.5) * s, vz: rnd(-.15, .15), c: [2.4, 1.05, .32], life: rnd(.5, 1.1), size: rnd(.12, .26) * (.6 + amt * .5) * s, grow: -.6, g: .4, drag: .5 });
        if (Math.random() < amt * dt * 3) sparks.emit(p.x, p.y + .3, p.z, { vx: rnd(-.3, .3), vy: rnd(1.5, 3), vz: rnd(-.3, .3), c: [3, 1.6, .5], life: rnd(1.5, 3), size: .035, g: -.2, drag: .2 });
      }
      if (f.smoke && Math.random() < dt * 9 * amt) dust.emit(p.x + rnd(-.2, .2), p.y + .8 * s, p.z + rnd(-.2, .2), { vx: rnd(-.2, .2) + env.wind * .8, vy: rnd(1.2, 2.2), vz: rnd(-.2, .2), c: [.42, .4, .38], life: rnd(4, 7), size: rnd(.8, 1.6) * s, grow: 2.2, g: .05, drag: .1, alpha: .32 });
      f.L.intensity = amt * (f.light + Math.sin(clock * 13) * 1.2 + Math.sin(clock * 7.3) * 1.5 + Math.random()) * (f.coals ? .6 : 1);
    });
  }
  const acc = new Map();
  function perFrame(key, r) { const v = (acc.get(key) || 0) + r, n = Math.floor(v); acc.set(key, v - n); return n; }

  /* --- 물 (호수, 시내) --- */
  const waters = [];
  const WAVES = [[.86, .5, .21, .62, 1.1], [-.4, .92, .33, .38, 1.5], [.2, -.98, .52, .22, 2.1], [-.96, -.27, .9, .1, 2.9]];
  function waveH(x, z, amp) {
    let h = 0; for (const [dx, dz, f, a, s] of WAVES) h += a * Math.sin((dx * x + dz * z) * f + clock * s);
    return h * (.06 + amp);
  }
  function water({ y = 0, size = 1400, seg = 220, deep = '#16303a', at = [0, 0] } = {}) {
    const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2); g.translate(at[0], 0, at[1]);
    const u = { uTime: { value: 0 }, uAmp: { value: 0 }, uY: { value: y }, uDeep: { value: new THREE.Color(deep) }, uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSun: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uFog: { value: new THREE.Color() }, uFogD: { value: .006 }, uCam: { value: new THREE.Vector3() }, uStars: { value: 0 } };
    const wl = WAVES.map(w => `h += ${w[3].toFixed(2)} * sin(dot(vec2(${w[0].toFixed(2)}, ${w[1].toFixed(2)}), p) * ${w[2].toFixed(2)} + uTime * ${w[4].toFixed(2)}); d += ${w[3].toFixed(2)} * ${w[2].toFixed(2)} * cos(dot(vec2(${w[0].toFixed(2)}, ${w[1].toFixed(2)}), p) * ${w[2].toFixed(2)} + uTime * ${w[4].toFixed(2)}) * vec2(${w[0].toFixed(2)}, ${w[1].toFixed(2)});`).join('\n');
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: `uniform float uTime, uAmp, uY; varying vec3 vW; varying vec3 vN;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.); vec2 p = w.xz; float h = 0.; vec2 d = vec2(0.);
          ${wl}
          float k = .06 + uAmp; w.y = uY + h * k; vN = normalize(vec3(-d.x * k, 1., -d.y * k)); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform vec3 uDeep, uTop, uHorizon, uSun, uSunDir, uFog, uCam; uniform float uFogD, uTime, uStars; varying vec3 vW; varying vec3 vN;
        void main(){ vec3 v = normalize(uCam - vW);
          vec3 n = normalize(vN + vec3(sin(vW.x * 1.7 + uTime * 1.3) * .035, 0., cos(vW.z * 1.9 + uTime * 1.1) * .035));
          float fr = pow(1. - max(dot(v, n), 0.), 4.) * .9 + .05;
          vec3 r = reflect(-v, n); vec3 sky = mix(uHorizon, uTop, clamp(r.y * 1.6, 0., 1.));
          vec3 col = mix(uDeep * (.35 + .65 * length(uHorizon)), sky, fr);
          vec3 sd = normalize(uSunDir); col += uSun * pow(max(dot(r, sd), 0.), 220.) * 4. * step(-.02, sd.y);
          col += uSun * pow(max(dot(r, sd), 0.), 18.) * .12 * step(-.02, sd.y);
          float dd = length(uCam - vW); float f = 1. - exp(-uFogD * uFogD * dd * dd); col = mix(col, uFog, f);
          gl_FragColor = vec4(col, 1.); }`
    }));
    scene.add(m); waters.push({ m, u }); return m;
  }
  const floaters = [];
  // 물 위에 뜬 것 (배): 물결 따라 오르내리고 흔들린다
  function float(obj, { y = 0, roll = 1, draft = .1 } = {}) { const o = { obj, y, roll, draft, on: true }; floaters.push(o); return o; }

  /* --- 배 --- */
  function boat({ len = 7, color = '#4b3a2c', at = [0, 0, 0], ry = 0 } = {}) {
    const g = new THREE.Group(); g.position.set(at[0], at[1], at[2]); g.rotation.y = ry;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: .95, side: THREE.DoubleSide });
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, len, 18, 1, true, Math.PI / 2, Math.PI), mat);
    hull.rotation.x = Math.PI / 2; hull.rotation.y = Math.PI; hull.scale.set(1.15, 1, .75); hull.position.y = .55; g.add(hull);
    const cap = new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    [-1, 1].forEach(s => { const c = new THREE.Mesh(cap, mat); c.scale.set(1.15, .75, 1.3); c.position.set(0, .55, s * len / 2); g.add(c); });
    const bench = new THREE.MeshStandardMaterial({ color: '#5e4a37', roughness: 1 });
    [-len * .25, 0, len * .25].forEach(z => { const b = new THREE.Mesh(new THREE.BoxGeometry(2, .08, .3), bench); b.position.set(0, .42, z); g.add(b); });
    const rail = new THREE.MeshStandardMaterial({ color: '#3a2c21', roughness: 1 });
    [-1, 1].forEach(s => { const r = new THREE.Mesh(new THREE.BoxGeometry(.08, .1, len), rail); r.position.set(s * 1.13, .58, 0); g.add(r); });
    scene.add(g); return g;
  }
  function net({ w = 3, d = 2, color = '#8a7b62', at = [0, 0, 0] } = {}) {
    const g = new THREE.PlaneGeometry(w, d, 10, 8); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, Math.sin(p.getX(i) * 3) * .04 + Math.cos(p.getZ(i) * 4) * .03);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 1, wireframe: true, transparent: true, opacity: .85 }));
    m.position.set(at[0], at[1], at[2]); scene.add(m); return m;
  }

  /* --- 장막 --- */
  function tent({ w = 5, d = 4, h = 2.3, color = '#3d322b', at = [0, 0, 0], ry = 0, open = true } = {}) {
    const g = new THREE.Group(); g.position.set(at[0], at[1], at[2]); g.rotation.y = ry;
    const shape = new THREE.Shape(); shape.moveTo(-w / 2, 0); shape.lineTo(-w / 2, h * .45); shape.lineTo(0, h); shape.lineTo(w / 2, h * .45); shape.lineTo(w / 2, 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }); geo.translate(0, 0, -d / 2);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide });
    const body = new THREE.Mesh(geo, mat); g.add(body);
    if (open) { const door = new THREE.Mesh(new THREE.PlaneGeometry(w * .3, h * .55), new THREE.MeshBasicMaterial({ color: '#0a0806' })); door.position.set(0, h * .28, d / 2 + .01); g.add(door); g.userData.door = door; }
    scene.add(g); return g;
  }

  /* --- 돌 제단 --- */
  function altar({ at = [0, 0, 0], w = 1.6, h = .9 } = {}) {
    const g = new THREE.Group(); g.position.set(at[0], at[1], at[2]);
    const m = new THREE.MeshStandardMaterial({ color: '#8b7a66', roughness: 1, flatShading: true });
    for (let y = 0; y < 3; y++) for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + y * .4, s = new THREE.Mesh(new THREE.DodecahedronGeometry(.26, 0), m);
      s.position.set(Math.cos(a) * w * .38, .16 + y * h / 3, Math.sin(a) * w * .3); s.scale.set(rnd(.9, 1.3), rnd(.7, 1), rnd(.9, 1.2)); s.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3)); g.add(s);
    }
    const top = new THREE.Mesh(new THREE.CylinderGeometry(w * .45, w * .5, .2, 10), m); top.position.y = h; g.add(top);
    scene.add(g);
    g.userData.fire = fire([at[0], at[1] + h + .1, at[2]], { ring: false, smoke: true, size: 1.4, light: 10 });
    return g;
  }

  /* --- 시점 --- */
  let lookX = 0, lookY = 0, tLookX = 0, tLookY = 0, dragging = null;
  const onMove = e => {
    if (e.pointerType === 'mouse') { tLookX = e.clientX / innerWidth * 2 - 1; tLookY = e.clientY / innerHeight * 2 - 1; }
    else if (dragging && e.pointerId === dragging.id) {
      tLookX = clamp(dragging.lx - (e.clientX - dragging.x) / innerWidth * 2.4, -1, 1);
      tLookY = clamp(dragging.ly - (e.clientY - dragging.y) / innerHeight * 2.4, -1, 1);
    }
  };
  const onDown = e => { if (e.pointerType !== 'mouse') dragging = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: tLookX, ly: tLookY }; };
  const onUp = e => { if (dragging && e.pointerId === dragging.id) dragging = null; };
  window.addEventListener('pointermove', onMove, { passive: true });
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h; camera.fov = w / h < 1 ? 74 : 60; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();

  /* --- 매 프레임 --- */
  const fx = { flash: 0 };
  const frameFns = [], resetFns = [];
  const sunDir = new THREE.Vector3();
  let last = performance.now(), raf = 0, dead = false;
  function frame(now) {
    if (dead) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now; clock += dt;
    stepTweens(); if (cyc) stepCycle(); stepNumTweens();

    const el = THREE.MathUtils.degToRad(env.sunEl), az = THREE.MathUtils.degToRad(env.sunAz);
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    skyU.uSunDir.value.copy(sunDir); skyU.uTop.value.copy(env.top); skyU.uHorizon.value.copy(env.horizon); skyU.uSunColor.value.copy(env.sun);
    skyU.uStars.value = env.stars; skyU.uStorm.value = env.storm; skyU.uSing.value = env.sing; skyU.uTime.value = clock;
    fog.color.copy(env.fog); fog.density = env.fogD; skyU.uFog.value.copy(env.fog);
    sun.color.copy(env.sun); sun.intensity = env.sunI * clamp(env.sunEl / 6 + .35, 0, 1); sun.position.copy(sunDir).multiplyScalar(100);
    hemi.color.copy(env.top).lerp(env.horizon, .55); hemi.groundColor.copy(env.fog).multiplyScalar(.6); hemi.intensity = env.hemiI + fx.flash * 1.6;
    renderer.toneMappingExposure = env.exposure;
    ashU.uTime.value = clock; ashU.uAmt.value = env.ash; ashU.uWind.value = env.wind; ashU.uTint.value.copy(env.fog).multiplyScalar(1.5).addScalar(.06); ashU.uCam.value.copy(camera.position);
    waters.forEach(({ u }) => {
      u.uTime.value = clock; u.uAmp.value = env.waves; u.uTop.value.copy(env.top); u.uHorizon.value.copy(env.horizon); u.uSun.value.copy(env.sun);
      u.uSunDir.value.copy(sunDir); u.uFog.value.copy(env.fog); u.uFogD.value = env.fogD; u.uCam.value.copy(camera.position);
    });
    floaters.forEach(f => {
      if (!f.on) return; const p = f.obj.position;
      p.y = f.y + waveH(p.x, p.z, env.waves) - f.draft;
      f.obj.rotation.z = (waveH(p.x + 1, p.z, env.waves) - waveH(p.x - 1, p.z, env.waves)) * .5 * f.roll;
      f.obj.rotation.x = (waveH(p.x, p.z + 2, env.waves) - waveH(p.x, p.z - 2, env.waves)) * .25 * f.roll;
    });

    stepWalkers(); stepFires(dt); stepFigs(dt);
    for (const fn of frameFns) fn(dt, clock);
    fx.flash *= Math.exp(-dt * 6);
    skyU.uFlash.value = fx.flash;
    sparks.update(dt); dust.update(dt);

    const lk = Math.min(1, dt * 2.5); lookX += (tLookX - lookX) * lk; lookY += (tLookY - lookY) * lk;
    const sway = reduceMotion ? 0 : 1, sh = env.shake * (reduceMotion ? .15 : 1);
    camera.position.set(env.camX + Math.sin(clock * 13.1) * .02 * sh, env.camH + Math.sin(clock * .9) * .012 * sway + Math.sin(clock * 17.3) * .02 * sh, env.camZ);
    if (camWater.on) camera.position.y += waveH(env.camX, env.camZ, env.waves) * camWater.k;
    camera.rotation.set(env.camP - lookY * .22 + Math.sin(clock * .6) * .004 * sway, env.camY - lookX * .55, env.camR + Math.sin(clock * .37) * .004 * sway + Math.sin(clock * 11) * .004 * sh + (camWater.on ? (waveH(env.camX + 1, env.camZ, env.waves) - waveH(env.camX - 1, env.camZ, env.waves)) * .3 * camWater.k : 0));
    sky.position.copy(camera.position);
    grain.uniforms.uTime.value = clock;

    composer.render(dt);
    raf = requestAnimationFrame(frame);
  }
  const camWater = { on: false, k: 1 };
  setEnv(initial, 0);
  raf = requestAnimationFrame(frame);

  return {
    THREE, scene, camera, renderer, PR, env, fx, sparks, dust,
    u: { clamp, lerp, ease, rnd, smooth, vnoise, hash2, sleep, reduceMotion },
    get clock() { return clock; },
    setEnv, cycleDays, tween, perFrame,
    focus(azDeg, dur = 2.5) { return setEnv({ camY: -azDeg * Math.PI / 180 }, dur); },
    onFrame(fn) { frameFns.push(fn); },
    onReset(fn) { resetFns.push(fn); },
    camOnWater(on, k = 1) { camWater.on = on; camWater.k = k; },
    waveH: (x, z) => waveH(x, z, env.waves),
    terrain, disc, rocks, box, glow, glowMat, person, figure, throng, walker, faceCamera, herd, fire, water, float, boat, net, tent, altar,
    reset() {
      for (const k in tw) delete tw[k];
      tweens.length = 0; cyc = null; camWater.on = false;
      setEnv(initial, 0); env.camY = 0; env.camX = 0; env.camZ = 0; env.camR = 0;
      walkers.forEach(w => { w.state = 'idle'; w.g.visible = false; });
      figs.forEach(g => g.userData.fig.play(g.userData.fig.base, 0));
      fires.forEach(f => { f.level = 0; });
      sparks.clear(); dust.clear(); fx.flash = 0;
      resetFns.forEach(fn => fn());
    },
    dispose() {
      dead = true; cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('resize', resize);
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
      composer.dispose && composer.dispose(); renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss();
    }
  };
}
