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
let figSrc = null, T3 = null;  // T3: createKit이 넘겨주는 THREE (게시본에서는 createKit 안에서 불러온다)
async function loadFigs(GLTFLoader) {
  const D = window.CHAR_GLB; if (!D) return null;
  const buf = u => Uint8Array.from(atob(u.slice(u.indexOf(',') + 1)), c => c.charCodeAt(0)).buffer;
  const ld = new GLTFLoader();
  const keys = Object.keys(D), G = {};
  (await Promise.all(keys.map(k => ld.parseAsync(buf(D[k]), '')))).forEach((g, i) => { G[keys[i]] = g; });
  const animals = {};
  for (const k of keys) if (k.startsWith('an_')) animals[k.slice(3)] = prepAnimal(G[k]);
  return { m: G.char_m, f: G.char_f, clips: Object.fromEntries(G.anims.animations.map(c => [c.name, c])), outfits: window.OUTFITS, props: G.props, animals };
}
// 양자화된 위치·법선을 실수로 풀어 둔다 (변환 행렬을 굽기 위해)
function floatGeo(geo) {
  for (const k of ['position', 'normal']) {
    const a = geo.getAttribute(k); if (!a || a.array instanceof Float32Array) continue;
    const f = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) { f[i * 3] = a.getX(i); f[i * 3 + 1] = a.getY(i); f[i * 3 + 2] = a.getZ(i); }
    geo.setAttribute(k, new T3.BufferAttribute(f, 3));
  }
  return geo;
}
// 메시 조각들을 장면 기준 좌표로 모은다: [{ geo, mat }]. 소품 노드 자체의 변환(quantize가 넣은 크기)도 함께 굽는다
function bakeParts(obj) {
  obj.updateWorldMatrix(true, true);
  const parts = [];
  obj.traverse(m => { if (m.isMesh) parts.push({ geo: floatGeo(m.geometry.clone()).applyMatrix4(m.matrixWorld), mat: m.material }); });
  return parts;
}
function prepAnimal(g) {  // 뼈대(가까이 한두 마리), 굳힌 자세(무리)
  const rig = g.scene.getObjectByName('Armature');
  const poses = ['pose_a', 'pose_b', 'pose_c'].map(n => g.scene.getObjectByName(n)).filter(Boolean).map(o => { g.scene.updateWorldMatrix(true, true); const parts = []; o.traverse(m => { if (m.isMesh) parts.push({ geo: floatGeo(m.geometry.clone()).applyMatrix4(m.matrixWorld), mat: m.material }); }); return parts; });
  return { rig, poses, clips: Object.fromEntries(g.animations.map(c => [c.name, c])) };
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
  const moon = new THREE.AmbientLight('#9aa8d0', 0); scene.add(moon);  // 어두운 장면에서도 사람과 사물이 보이게 하는 고른 빛

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
    // 이름으로 부르는 프리셋은 하늘·빛·날씨를 바꾼다. 서 있는 자리(camX, camZ)와 눈높이(camH)는 프리셋에 직접 적힌 경우만 바꾸고, 아니면 place()가 정한 대로 둔다
    if (typeof name === 'string') for (const k of ['camX', 'camZ', 'camH']) if (!(PRE[name] && k in PRE[name])) delete src[k];
    const patch = Object.assign({}, src, extra || {});
    if ('camH' in patch) camGround.on = false;  // 눈높이를 직접 정하면 땅 따라가기를 끈다
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

  /* --- 장소 묶음: kit.into(group) 뒤에 만드는 것은 그 묶음에 들어간다. 장소를 숨기면 안의 것도 그리지·움직이지 않는다 --- */
  let intoTarget = null;
  const R = () => intoTarget || scene;
  function into(g) { intoTarget = g || null; return g; }
  function site(x = 0, z = 0) { const g = new THREE.Group(); g.position.set(0, 0, 0); g.userData.at = [x, z]; scene.add(g); return g; }
  const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };

  /* --- 땅 높이: 지형, 바닥, 배가 알려 준다. 카메라와 내 몸이 땅속으로 들어가지 않게 쓴다 --- */
  const grounds = [];
  function groundAt(x, z) {
    let g = -Infinity;
    for (const fn of grounds) { const h = fn(x, z); if (h != null && h > g) g = h; }
    return g === -Infinity ? 0 : g;
  }
  // 바닥 하나 더하기: kit.addGround((x, z) => 안이면 높이, 아니면 null)
  function addGround(fn) { grounds.push(fn); return fn; }
  function addFloor(cx, cz, w, d, y = 0, obj) { return addGround((x, z) => (!obj || shown(obj)) && Math.abs(x - cx) <= w / 2 && Math.abs(z - cz) <= d / 2 ? y : null); }

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
    R().add(m);
    addGround((x, z) => shown(m) && Math.abs(x - at[0]) <= size / 2 && Math.abs(z - at[1]) <= size / 2 ? height(x, z) : null);
    return m;
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
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })); m.position.set(at[0], y, at[1]); R().add(m); return m;
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
    R().add(m); return m;
  }
  function box(w, h, d, color, x = 0, y = 0, z = 0, parent = R(), mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || new THREE.MeshStandardMaterial({ color, roughness: 1 }));
    m.position.set(x, y, z); parent.add(m); return m;
  }
  const glowMat = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), fog: false });
  function glow(w, h, r, g, b, x, y, z, parent = R()) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glowMat(r, g, b)); m.position.set(x, y, z); parent.add(m); return m; }

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
    g.scale.setScalar(scale); g.visible = visible; R().add(g);
    return g;
  }
  // 이름 있는 인물: 옷 입은 마네킹 + 동작. person()과 같은 자리에 쓴다. role은 outfits.json의 신분, tint는 겉옷 색
  T3 = THREE;
  if (!figSrc) figSrc = await loadFigs(GLTFLoader).catch(e => { console.warn('인물 캐릭터를 불러오지 못했습니다:', e); return null; });
  const POSE_CLIP = { stand: 'Idle_Loop', seat: 'Sitting_Idle_Loop', kneel: 'Fixing_Kneeling' };
  const UNDER = ['under_chest', 'under_body', 'under_arm', 'under_thigh', 'under_calf'];
  const TINT = [['dress', 'dress'], ['royal_mantle', 'royal'], ['mantle', 'mantle'], ['tunic_long', 'tunic'], ['tunic_short', 'tunic']];
  const figs = [];
  // 예수님(연출: 성경에는 생김새가 없어 전통 그림을 따른다): 흰 옷, 붉은 겉옷, 어깨까지 오는 머리, 수염, 인자한 눈과 입
  const JESUS = { name: '예수 (연출)', body: 'm', wear: ['tunic_long', 'belt', 'sandals', 'beard'], under: '#eee9de', colors: { tunic: '#eee9de', belt: '#c8b896', beard: '#4a3122' } };
  const JESUS_RED = '#a3292a', JESUS_HAIR = '#3f2a1c';
  function dressJesus(body) {
    body.updateMatrixWorld(true);  // 지금 동작 자세 그대로 머리·가슴 뼈에 붙인다 (skeleton.pose()는 뼈 크기가 달라진다)
    const head = body.getObjectByName('Head'), chest = body.getObjectByName('spine_03'), hp = head.getWorldPosition(new THREE.Vector3()), cp = chest.getWorldPosition(new THREE.Vector3());
    const M = c => new THREE.MeshStandardMaterial({ color: c, roughness: .85 });
    const put = (bone, mesh, base, [x, y, z], rot, sc) => { mesh.position.set(base.x + x, base.y + y, base.z + z); if (rot) mesh.rotation.set(...rot); if (sc) mesh.scale.set(...sc); mesh.frustumCulled = false; body.add(mesh); mesh.updateMatrixWorld(true); bone.attach(mesh); return mesh; };
    const eyeM = M('#24160f'), browM = M('#3a2618'), lipM = M('#7a4433'), skinM = M('#b4876a'), hairM = new THREE.MeshStandardMaterial({ color: JESUS_HAIR, roughness: .95, side: THREE.DoubleSide });
    // 눈: 짙은 눈동자 위로 살짝 내려온 눈꺼풀 (웃는 눈매)
    for (const sx of [-1, 1]) {
      put(head, new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), eyeM), hp, [sx * .039, .122, .136], null, [.012, .0075, .006]);
      put(head, new THREE.Mesh(new THREE.TorusGeometry(.013, .0026, 4, 10, Math.PI), browM), hp, [sx * .039, .121, .139], [0, 0, 0], [1, .55, 1]);  // 눈꺼풀 선
      put(head, new THREE.Mesh(new THREE.BoxGeometry(.03, .0045, .006), browM), hp, [sx * .04, .142, .136], [0, 0, sx * -.12]);  // 눈썹 (안쪽이 살짝 올라간 온화한 모양)
    }
    put(head, new THREE.Mesh(new THREE.ConeGeometry(.012, .034, 6), skinM), hp, [0, .097, .147], [Math.PI / 2 + .35, 0, 0]);  // 코
    put(head, new THREE.Mesh(new THREE.TorusGeometry(.019, .0032, 4, 12, Math.PI * .8), lipM), hp, [0, .068, .138], [0, 0, Math.PI + Math.PI * .1]);  // 미소 짓는 입
    // 머리카락: 정수리를 덮고, 옆과 뒤로 어깨까지 내려온다. 가운데 가르마
    put(head, new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * .5), hairM), hp, [0, .105, .03], [-.55, 0, 0], [.118, .172, .142]);  // 정수리 (이마 선은 높고 뒤는 낮게)
    put(head, new THREE.Mesh(new THREE.CylinderGeometry(.1, .118, .21, 18, 1, true, Math.PI * .3, Math.PI * 1.4), hairM), hp, [0, .005, .03], null, [1, 1, 1.05]);  // 옆과 뒤로 어깨까지 (얼굴 쪽은 트였다)
    // 붉은 겉옷: 왼쪽 어깨에서 오른쪽 허리로 비스듬히 두른 띠, 그리고 등 뒤로 늘어진 자락
    const red = new THREE.MeshStandardMaterial({ color: JESUS_RED, roughness: .9, side: THREE.DoubleSide });
    put(chest, new THREE.Mesh(new THREE.CylinderGeometry(1, 1, .3, 24, 1, true), red), cp, [0, -.06, .01], [0, 0, .62], [.215, 1, .15]);
    put(chest, new THREE.Mesh(new THREE.PlaneGeometry(.3, .62), red), cp, [.05, -.26, -.155], [.08, 0, .1]);
  }
  function figure(role, { tint, colors, pose = 'stand', clip, scale = 1, visible = false, seatDrop = .3 } = {}) {
    const spec = role === 'jesus' ? (figSrc && JESUS) : figSrc && figSrc.outfits.roles[role];
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
    if (role === 'jesus') { F.play('Idle_Loop', 0); mixer.update(0); dressJesus(body); }
    F.play(F.base, 0); mixer.update(Math.random() * 3);  // 여러 사람이 같은 박자로 움직이지 않게
    const bones = {}; F.bone = n => bones[n] || (bones[n] = body.getObjectByName(n));
    g.userData.fig = F; g.userData.head = body.getObjectByName('Head');
    g.scale.setScalar(scale * .92); g.visible = visible; R().add(g); figs.push(g);
    return g;
  }
  /* --- 내 몸 (1인칭): 아래를 보면 다리와 발, 옷자락이 보인다. 머리는 숨기고, 눈이 카메라 자리에 오게 몸을 옮긴다 --- */
  const me = { g: null, head: null, on: true, pose: '', yaw: 0, sp: 0, lx: 0, lz: 0, clips: {}, clipKey: '' };  // clips: { walk: 'Walk_Carry_Loop' } 처럼 자세별 동작을 바꾼다
  function selfBody(role, opts = {}) {
    const key = role + JSON.stringify(opts);
    if (me.g && me.key === key) return me.g;
    if (me.g) { scene.remove(me.g); const i = figs.indexOf(me.g); if (i >= 0) figs.splice(i, 1); me.g = null; }
    me.key = key;
    if (!role) return null;
    const g = figure(role, { ...opts, visible: true });
    if (!g.userData.fig) { g.parent && g.parent.remove(g); return null; }  // 캐릭터가 없으면 몸을 그리지 않는다
    scene.add(g);
    me.g = g; me.head = g.userData.fig.bone('Head'); me.neck = g.userData.fig.bone('neck_01'); me.pose = ''; me.lx = env.camX; me.lz = env.camZ; me.yaw = env.camY + Math.PI;
    return g;
  }
  const _e = new THREE.Vector3();
  function stepSelf(dt) {
    const g = me.g; if (!g) return;
    const F = g.userData.fig, cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const h = cy - groundAt(cx, cz), id = 1 / Math.max(dt, 1e-3);
    const vx = (env.camX - me.lx) * id, vz = (env.camZ - me.lz) * id; me.lx = env.camX; me.lz = env.camZ;
    me.sp += (Math.min(8, Math.hypot(vx, vz)) - me.sp) * Math.min(1, dt * 5);
    const pose = !me.on || h < .72 ? 'hide' : h < 1.38 ? 'sit' : me.sp > .35 ? 'walk' : 'stand';
    g.visible = pose !== 'hide'; if (!g.visible) return;
    if (pose !== me.pose || me.clipKey !== (me.clips[pose] || '')) { me.pose = pose; me.clipKey = me.clips[pose] || ''; F.play(me.clips[pose] || (pose === 'sit' ? 'Sitting_Idle_Loop' : pose === 'walk' ? 'Walk_Loop' : 'Idle_Loop'), .35); }
    if (pose === 'walk' && F.cur) F.cur.timeScale = clamp(me.sp / 1.25, .6, 1.8);
    // 몸이 향하는 쪽: 이야기가 정한 방향, 걸을 때는 가는 방향 (둘러보기로는 몸이 돌지 않는다)
    let want = pose === 'walk' ? Math.atan2(vx, vz) : env.camY + Math.PI;
    while (want - me.yaw > Math.PI) want -= Math.PI * 2; while (want - me.yaw < -Math.PI) want += Math.PI * 2;
    me.yaw += (want - me.yaw) * Math.min(1, dt * 4);
    g.rotation.set(0, me.yaw, 0); g.position.set(cx, cy, cz); g.updateMatrixWorld(true);
    me.head.getWorldPosition(_e);
    const fx = Math.sin(me.yaw), fz = Math.cos(me.yaw), s = g.scale.x;
    // 눈 = 머리 뼈 + 위로 0.11. 카메라를 머리보다 0.24 앞에 두어, 아래를 보면 배에 가리지 않고 다리와 발이 보이게 한다
    const fwd = me.pose === 'sit' ? .2 : .24;
    g.position.x += cx - (_e.x + fx * fwd * s); g.position.z += cz - (_e.z + fz * fwd * s); g.position.y += cy - (_e.y + .11 * s);
    me.head.scale.setScalar(.001); me.neck.scale.setScalar(.35); g.updateMatrixWorld(true);
  }
  const stepFigs = dt => {
    for (const g of figs) if (shown(g)) { const F = g.userData.fig; F.mixer.update(dt); if (F.gest) applyGesture(g, F, dt); }
    for (const o of herdMixers) if (o.on && shown(o.obj)) o.mixer.update(dt);
  };
  // 애니메이션이 없는 몸짓을 코드로 만든다: 뼈를 인물 기준 방향(+Z 앞, +Y 위, +X 왼쪽)으로 돌린다. 오른쪽은 x를 뒤집는다
  // [몸짓 안의 위치 0~1, { 뼈: 방향 }]
  const GEST = {
    dust: [[0, { upperarm: [.3, .92, .25], lowerarm: [.1, 1, .15] }], [.55, { upperarm: [.55, .75, .35], lowerarm: [-.6, .45, .25] }]],  // 티끌을 하늘로 날려 머리에 (욥 2:12)
    tear: [[0, { upperarm: [.25, -.5, .8], lowerarm: [-.8, .5, .2] }], [.45, { upperarm: [.75, -.35, .55], lowerarm: [.95, .1, .3] }]],  // 겉옷을 찢고
    weep: [[0, { upperarm: [.2, -.45, .85], lowerarm: [-.3, .85, .4], neck: [0, .72, .7] }]],  // 얼굴을 감싸고 운다
    cross: [[0, { upperarm: [1, .16, -.05], lowerarm: [1, .22, -.05], neck: [0, .97, .2] }]],  // 십자가에 두 팔을 벌리고
    crossDead: [[0, { upperarm: [1, .1, -.05], lowerarm: [1, .14, -.05], neck: [.15, .35, .92] }]],  // 머리를 숙이고 (요 19:30)
    pray: [[0, { upperarm: [.18, -.55, .8], lowerarm: [-.55, .6, .58], neck: [0, .8, .6] }]],  // 두 손을 모으고
    lift: [[0, { upperarm: [.45, .75, .5], lowerarm: [.35, .88, .3] }]],  // 손을 들어 (눅 24:50)
    show: [[0, { upperarm: [.35, -.35, .87], lowerarm: [.3, .15, .94] }]],  // 손을 내밀어 보이신다 (요 20:20, 27)
    reach: [[0, { upperarm_r: [-.15, .1, .98], lowerarm_r: [-.1, .05, 1], upperarm_l: [.2, -.95, .1], lowerarm_l: [.15, -.98, .1] }]],  // 오른손을 앞으로 내미신다
    give: [[0, { upperarm: [.25, -.6, .76], lowerarm: [.1, .05, 1] }]],  // 두 손으로 건넨다
    bow: [[0, { neck: [0, .3, .95] }]],  // 고개를 떨군다
    carry: [[0, { upperarm_r: [-.55, .55, .62], lowerarm_r: [.55, .78, -.3], upperarm_l: [.35, .25, .9], lowerarm_l: [-.5, .65, .55] }]]  // 어깨에 진 나무를 붙든다
  };
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
  function aimBone(root, bone, child, dir, w) {
    bone.getWorldPosition(_a); child.getWorldPosition(_b);
    _b.sub(_a).normalize(); _d.copy(dir).transformDirection(root.matrixWorld);
    _q.setFromUnitVectors(_b, _d); _q2.identity().slerp(_q, w);
    bone.getWorldQuaternion(_q3); _q2.multiply(_q3);
    bone.parent.getWorldQuaternion(_q3).invert(); bone.quaternion.copy(_q3.multiply(_q2));
    bone.updateMatrixWorld(true);
  }
  function applyGesture(g, F, dt) {
    const G = F.gest, t = clock - G.t0;
    if (t >= G.total) { F.gest = null; return; }
    let s = 0, name, k; for (const [nm, d] of G.seq) { if (t < s + d) { name = nm; k = (t - s) / d; break; } s += d; }
    const keys = GEST[name]; let pose = keys[0][1], at = 0; for (const [a, p] of keys) if (k >= a) { pose = p; at = a; }
    if (name === 'dust' && at > 0 && !G.thrown) { G.thrown = true; for (const sd of ['l', 'r']) { const h = F.bone('hand_' + sd).getWorldPosition(new THREE.Vector3()); for (let i = 0; i < 26; i++) dust.emit(h.x, h.y, h.z, { vx: rnd(-.5, .5), vy: rnd(1.4, 2.6), vz: rnd(-.5, .5), c: [.52, .46, .38], life: rnd(1.6, 2.6), size: rnd(.05, .11), g: 2.4, drag: .5, alpha: .75 }); } }
    if (name !== 'dust') G.thrown = false;
    const w = Math.min(1, t / .4, (G.total - t) / .6), lk = 1 - Math.exp(-dt * 7);
    g.updateMatrixWorld(true);
    for (const sd of ['l', 'r']) for (const b of ['upperarm', 'lowerarm']) {
      const own = pose[b + '_' + sd], v = own || pose[b]; if (!v) continue;
      const key = b + sd, sg = own ? 1 : sd === 'l' ? 1 : -1, cur = G.dir[key] || (G.dir[key] = new THREE.Vector3(v[0] * sg, v[1], v[2]));
      cur.lerp(_d.set(v[0] * sg, v[1] + (name === 'weep' ? Math.sin(clock * 15 + (sd === 'l' ? 0 : 1)) * .06 : 0), v[2]), lk);
      aimBone(g, F.bone(`${b}_${sd}`), F.bone(b === 'upperarm' ? `lowerarm_${sd}` : `hand_${sd}`), cur.clone(), w);
    }
    if (pose.neck) { const cur = G.dir.neck || (G.dir.neck = new THREE.Vector3(...pose.neck)); cur.lerp(_d.set(...pose.neck), lk); aimBone(g, F.bone('neck_01'), F.bone('Head'), cur.clone(), w); }
  }
  // 몸짓 순서대로 하기: kit.gesture(g, [['dust', 3], ['tear', 2.6], ['weep', 7]])
  function gesture(g, seq) {
    const F = g.userData.fig; if (!F) return;
    if (!seq) { F.gest = null; return; }
    F.gest = { seq, t0: clock, total: seq.reduce((a, [, d]) => a + d, 0), dir: {} };
  }
  // 몸짓을 계속 하고 있기 (끝나지 않음): kit.hold(g, 'cross'), kit.hold(g) 로 풀기
  function hold(g, name) { gesture(g, name ? [[name, 1e7]] : null); }
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
    g.add(body, head); R().add(g);
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
  // 가축 떼: 동물 모델이 있으면 그것으로, 없으면 단순한 모양으로
  const herdMixers = [];
  function herd(kind, opts = {}) {
    const A = figSrc && figSrc.animals && figSrc.animals[kind];
    if (A && A.poses.length) return herdModel(A, opts);
    const alt = { ram: ['goat', '#cfc4b0'], colt: ['donkey'], pig: ['ox', '#2b2523'] }[kind];  // 단순한 모양에 없는 종류
    return alt && !ANIMALS[kind] ? herdSimple(alt[0], { color: alt[1], ...opts }) : herdSimple(kind, opts);
  }
  function herdModel(A, { n, center, rx = 15, rz = 12, height, scale = [.85, 1.15], placer, color } = {}) {
    const g = new THREE.Group(); g.position.set(center[0], 0, center[1]);
    const items = [];
    for (let i = 0; i < n; i++) {
      let x, z; if (placer) [x, z] = placer(i); else { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()); x = Math.cos(a) * r * rx; z = Math.sin(a) * r * rz; }
      items.push({ x, z, ry: rnd(0, 6.3), s: rnd(scale[0], scale[1]), tint: rnd(.82, 1.05), on: true, pose: Math.floor(Math.random() * A.poses.length) });
    }
    const body = color ? new THREE.Color(color) : null;
    const mat = m => { const c = m.clone(); if (body && m.name === 'body') c.color.copy(body); return c; };
    const ground = o => height ? height(center[0] + o.x, center[1] + o.z) : 0;
    let draw;
    if (n <= 3) {  // 한두 마리는 실제로 숨 쉬고 고개를 움직인다
      items.forEach(o => {
        o.obj = SkeletonUtils.clone(A.rig); o.base = o.obj.scale.x; o.obj.traverse(m => { if (m.isMesh) { m.material = mat(m.material); m.frustumCulled = false; } });
        o.mixer = new THREE.AnimationMixer(o.obj); A.clips.Idle && o.mixer.clipAction(A.clips.Idle).play(); o.mixer.update(rnd(0, 5));
        g.add(o.obj); herdMixers.push(o);
      });
      draw = () => items.forEach(o => { o.obj.position.set(o.x, ground(o), o.z); o.obj.rotation.set(0, o.ry, 0); o.obj.scale.setScalar(o.s * o.base); o.obj.visible = o.on; });  // 모델 자체의 크기(뼈대 노드의 scale)를 지킨다
    } else {  // 무리는 세 가지 굳힌 자세를 한꺼번에 그린다
      const tmp = new THREE.Color(), base = new THREE.Object3D();
      const buckets = A.poses.map((parts, p) => {
        const idx = items.map((o, i) => o.pose === p ? i : -1).filter(i => i >= 0);
        return { idx, meshes: parts.map(pt => { const m = new THREE.InstancedMesh(pt.geo, mat(pt.mat), Math.max(1, idx.length)); m.frustumCulled = false; if (!idx.length) m.count = 0; g.add(m); return m; }) };
      });
      draw = () => buckets.forEach(b => {
        b.idx.forEach((i, k) => {
          const o = items[i];
          base.position.set(o.x, ground(o), o.z); base.rotation.set(0, o.ry, 0); base.scale.setScalar(o.on ? o.s : .0001); base.updateMatrix();
          tmp.setScalar(o.tint); b.meshes.forEach(m => { m.setMatrixAt(k, base.matrix); m.setColorAt(k, tmp); });
        });
        b.meshes.forEach(m => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
      });
    }
    draw(); R().add(g);
    g.userData.items = items; g.userData.draw = draw;
    g.userData.keep = frac => { const k = Math.round(items.length * frac); items.forEach((o, i) => { o.on = i < k; }); draw(); };
    return g;
  }
  // 생선, 떡 같은 소품 (assets/chars/props.glb). 없으면 null
  function prop(name, { colors } = {}) {
    const o = figSrc && figSrc.props && figSrc.props.scene.getObjectByName(name); if (!o) return null;
    const g = new THREE.Group();
    bakeParts(o).forEach(p => { const m = new THREE.Mesh(p.geo, p.mat.clone()); const c = colors && colors[p.mat.name]; if (c) m.material.color.set(c); g.add(m); });
    return g;
  }
  function instancedProp(name, n, { colors } = {}) {  // 같은 소품 여럿 (고기 떼). setMatrixAt, instanceMatrix.needsUpdate를 InstancedMesh처럼 쓴다
    const o = figSrc && figSrc.props && figSrc.props.scene.getObjectByName(name); if (!o) return null;
    const g = new THREE.Group();
    const ms = bakeParts(o).map(p => { const m = new THREE.InstancedMesh(p.geo, p.mat.clone(), n); const c = colors && colors[p.mat.name]; if (c) m.material.color.set(c); m.frustumCulled = false; g.add(m); return m; });
    g.setMatrixAt = (i, mx) => ms.forEach(m => m.setMatrixAt(i, mx));
    g.instanceMatrix = { set needsUpdate(v) { ms.forEach(m => { m.instanceMatrix.needsUpdate = v; }); } };
    return g;
  }
  function herdSimple(kind, { n, center, rx = 15, rz = 12, height, scale = [.85, 1.15], placer, color } = {}) {
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
    draw(); R().add(g);
    g.userData.items = items; g.userData.draw = draw;
    // 일부만 남기기 (0~1)
    g.userData.keep = frac => { const k = Math.round(items.length * frac); items.forEach((o, i) => { o.on = i < k; }); draw(); };
    return g;
  }

  /* --- 불 (모닥불, 숯불, 제단 불) --- */
  const fires = [];
  function fire(pos, { logs = true, ring = true, level = 0, useEnv = false, smoke = false, coals = false, size = 1, light = 7 } = {}) {
    const g = new THREE.Group(); g.position.set(pos[0], pos[1] || .05, pos[2]); R().add(g);
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
      if (!shown(f.g) || amt < .02) { f.L.intensity = 0; if (f.coalMat) f.coalMat.color.setRGB(.05, .03, .02); return; }
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
    const u = { uBoat: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uBoatL: { value: [0, 0, 0, 0] }, uBoatN: { value: 0 }, uTime: { value: 0 }, uAmp: { value: 0 }, uY: { value: y }, uDeep: { value: new THREE.Color(deep) }, uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSun: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uFog: { value: new THREE.Color() }, uFogD: { value: .006 }, uCam: { value: new THREE.Vector3() }, uStars: { value: 0 } };
    const wl = WAVES.map(w => `h += ${w[3].toFixed(2)} * sin(dot(vec2(${w[0].toFixed(2)}, ${w[1].toFixed(2)}), p) * ${w[2].toFixed(2)} + uTime * ${w[4].toFixed(2)}); d += ${w[3].toFixed(2)} * ${w[2].toFixed(2)} * cos(dot(vec2(${w[0].toFixed(2)}, ${w[1].toFixed(2)}), p) * ${w[2].toFixed(2)} + uTime * ${w[4].toFixed(2)}) * vec2(${w[0].toFixed(2)}, ${w[1].toFixed(2)});`).join('\n');
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: `uniform float uTime, uAmp, uY; varying vec3 vW; varying vec3 vN;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.); vec2 p = w.xz; float h = 0.; vec2 d = vec2(0.);
          ${wl}
          float k = .06 + uAmp; w.y = uY + h * k; vN = normalize(vec3(-d.x * k, 1., -d.y * k)); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform vec3 uDeep, uTop, uHorizon, uSun, uSunDir, uFog, uCam; uniform float uFogD, uTime, uStars; varying vec3 vW; varying vec3 vN;
        uniform vec4 uBoat[4]; uniform float uBoatL[4]; uniform int uBoatN;
        void main(){
          for (int i = 0; i < 4; i++) { if (i >= uBoatN) break;
            vec2 d = vW.xz - uBoat[i].xy; float lx = d.x * uBoat[i].z - d.y * uBoat[i].w, lz = d.x * uBoat[i].w + d.y * uBoat[i].z;
            float az = abs(lz), hw = ${BOAT_HW.toFixed(2)}, e = (az - uBoatL[i]) / ${BOAT_END.toFixed(2)};
            if ((az <= uBoatL[i] && abs(lx) < hw) || (az > uBoatL[i] && e * e + (lx / hw) * (lx / hw) < 1.)) discard;  // 배 안에는 물이 없다
          }
          vec3 v = normalize(uCam - vW);
          vec3 n = normalize(vN + vec3(sin(vW.x * 1.7 + uTime * 1.3) * .035, 0., cos(vW.z * 1.9 + uTime * 1.1) * .035));
          float fr = pow(1. - max(dot(v, n), 0.), 4.) * .9 + .05;
          vec3 r = reflect(-v, n); vec3 sky = mix(uHorizon, uTop, clamp(r.y * 1.6, 0., 1.));
          vec3 col = mix(uDeep * (.35 + .65 * length(uHorizon)), sky, fr);
          vec3 sd = normalize(uSunDir); col += uSun * pow(max(dot(r, sd), 0.), 220.) * 4. * step(-.02, sd.y);
          col += uSun * pow(max(dot(r, sd), 0.), 18.) * .12 * step(-.02, sd.y);
          float dd = length(uCam - vW); float f = 1. - exp(-uFogD * uFogD * dd * dd); col = mix(col, uFog, f);
          gl_FragColor = vec4(col, 1.); }`
    }));
    R().add(m); waters.push({ m, u }); return m;
  }
  const floaters = [];
  // 물 위에 뜬 것 (배): 물결 따라 오르내리고 흔들린다
  function float(obj, { y = 0, roll = 1, draft = .1 } = {}) { const o = { obj, y, roll, draft, on: true }; floaters.push(o); return o; }

  /* --- 배 --- */
  // 배 안쪽(배 기준 좌표): 가운데는 너비 ±HW, 길이 ±len/2, 양 끝은 둥글게 1.25m 더
  const boats = [], BOAT_HW = 1.1, BOAT_END = 1.25;
  function boatLocal(b, x, z) { const dx = x - b.position.x, dz = z - b.position.z, c = Math.cos(b.rotation.y), s = Math.sin(b.rotation.y); return [dx * c - dz * s, dx * s + dz * c]; }
  function insideBoat(b, lx, lz, m = 0) {
    const hw = BOAT_HW + m, hl = b.userData.len / 2, az = Math.abs(lz);
    if (az <= hl) return Math.abs(lx) < hw;
    const e = (az - hl) / (BOAT_END + m), q = lx / hw; return e * e + q * q < 1;
  }
  function boatAt(x, z, m = 0) { for (const b of boats) { if (!shown(b)) continue; const [lx, lz] = boatLocal(b, x, z); if (insideBoat(b, lx, lz, m)) return b; } return null; }
  // 배 안에 들어온 점을 가까운 뱃전 밖으로 밀어낸다 (고기, 물보라)
  function outsideBoats(v, m = .25) {
    for (const b of boats) {
      if (!shown(b)) continue;
      const [lx, lz] = boatLocal(b, v.x, v.z); if (!insideBoat(b, lx, lz, m)) continue;
      const nx = (lx >= 0 ? 1 : -1) * (BOAT_HW + m + .02), c = Math.cos(b.rotation.y), s = Math.sin(b.rotation.y);
      v.x = b.position.x + nx * c + lz * s; v.z = b.position.z - nx * s + lz * c;
    }
    return v;
  }
  addGround((x, z) => { const b = boatAt(x, z); return b ? b.position.y + .1 : null; });
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
    g.userData.len = len; boats.push(g);
    R().add(g); return g;
  }
  function net({ w = 3, d = 2, color = '#8a7b62', at = [0, 0, 0] } = {}) {
    const g = new THREE.PlaneGeometry(w, d, 10, 8); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, Math.sin(p.getX(i) * 3) * .04 + Math.cos(p.getZ(i) * 4) * .03);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 1, wireframe: true, transparent: true, opacity: .85 }));
    m.position.set(at[0], at[1], at[2]); R().add(m); return m;
  }

  /* --- 장막 --- */
  function tent({ w = 5, d = 4, h = 2.3, color = '#3d322b', at = [0, 0, 0], ry = 0, open = true } = {}) {
    const g = new THREE.Group(); g.position.set(at[0], at[1], at[2]); g.rotation.y = ry;
    const shape = new THREE.Shape(); shape.moveTo(-w / 2, 0); shape.lineTo(-w / 2, h * .45); shape.lineTo(0, h); shape.lineTo(w / 2, h * .45); shape.lineTo(w / 2, 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }); geo.translate(0, 0, -d / 2);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide });
    const body = new THREE.Mesh(geo, mat); g.add(body);
    if (open) { const door = new THREE.Mesh(new THREE.PlaneGeometry(w * .3, h * .55), new THREE.MeshBasicMaterial({ color: '#0a0806' })); door.position.set(0, h * .28, d / 2 + .01); g.add(door); g.userData.door = door; }
    R().add(g); return g;
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
    R().add(g);
    g.userData.fire = fire([at[0], at[1] + h + .1, at[2]], { ring: false, smoke: true, size: 1.4, light: 10 });
    return g;
  }

  /* --- 마을과 건물, 나무, 십자가, 무덤 (여러 인물이 같이 쓴다) --- */
  const MAT = {};
  const mat = (c, o) => { const k = c + (o ? JSON.stringify(o) : ''); return MAT[k] || (MAT[k] = new THREE.MeshStandardMaterial({ color: c, roughness: 1, ...(o || {}) })); };
  // 흙벽돌 집: 앞(+z)에 문, 평평한 지붕, 바깥 계단(지붕으로). 안에서도 벽이 보인다
  function house({ at = [0, 0, 0], w = 5, d = 4, h = 2.8, ry = 0, color = '#a48a69', door = true, stairs = false, roof = true, win = true } = {}) {
    const g = new THREE.Group(); g.position.set(at[0], at[1], at[2]); g.rotation.y = ry;
    const m = mat(color), t = .3, dw = 1.05;
    box(w, h, t, null, 0, h / 2, -d / 2, g, m); box(t, h, d, null, -w / 2, h / 2, 0, g, m); box(t, h, d, null, w / 2, h / 2, 0, g, m);
    if (door) { box((w - dw) / 2, h, t, null, -(w + dw) / 4, h / 2, d / 2, g, m); box((w - dw) / 2, h, t, null, (w + dw) / 4, h / 2, d / 2, g, m); box(dw, h - 2, t, null, 0, 2 + (h - 2) / 2, d / 2, g, m); }
    else box(w, h, t, null, 0, h / 2, d / 2, g, m);
    if (win) [-1, 1].forEach(sx => box(.5, .4, .05, '#1a130e', sx * w * .28, h * .66, d / 2 + .16, g));
    if (roof) { box(w + .3, .22, d + .3, null, 0, h + .11, 0, g, mat('#6e5a44')); box(w + .3, .35, .12, null, 0, h + .38, d / 2 + .1, g, m); }
    if (stairs) for (let i = 0; i < 9; i++) box(.75, .32, .32, null, w / 2 + .38, (i + .5) * h / 9, d / 2 - .4 - i * (d - .8) / 9, g, m);
    R().add(g); return g;
  }
  // 집이 늘어선 마을: kit.village({ center, n, r, height, avoid })
  function village({ center = [0, 0], n = 12, rMin = 8, rMax = 40, height, avoid, colors = ['#a48a69', '#9a8062', '#b09574', '#8f7558'], seed = 1 } = {}) {
    const g = new THREE.Group(); R().add(g); const prev = intoTarget; intoTarget = g;
    for (let i = 0, tries = 0; i < n && tries < n * 20; tries++) {
      const a = hash2(i + seed, tries) * Math.PI * 2, r = rMin + hash2(tries + seed, i * 3) * (rMax - rMin), x = center[0] + Math.cos(a) * r, z = center[1] + Math.sin(a) * r;
      if (avoid && avoid(x, z)) continue;
      const w = 3.5 + hash2(i, 7) * 3, d = 3 + hash2(i, 9) * 2.5, h = 2.4 + hash2(i, 11) * 1.2;
      house({ at: [x, height ? height(x, z) : 0, z], w, d, h, ry: Math.atan2(center[0] - x, center[1] - z) + (hash2(i, 13) - .5) * .5, color: colors[i % colors.length], stairs: i % 3 === 0 });
      i++;
    }
    intoTarget = prev; return g;
  }
  // 안이 보이는 방: 바닥·벽·천장·등잔. 바닥을 땅으로 알려 준다
  function room({ at = [0, 0, 0], w = 10, d = 8, h = 3.6, color = '#4a3d33', floor = '#3a2f27', lamps = [], ceiling = true, door = null } = {}) {
    const g = new THREE.Group(); g.position.set(at[0], at[1], at[2]);
    const m = mat(color);
    box(w, .1, d, floor, 0, -.05, 0, g);
    box(w, h, .3, null, 0, h / 2, -d / 2, g, m); box(.3, h, d, null, -w / 2, h / 2, 0, g, m); box(.3, h, d, null, w / 2, h / 2, 0, g, m);
    if (door != null && door !== false) { const dw = 1.2; box((w - dw) / 2, h, .3, null, -(w + dw) / 4 + door, h / 2, d / 2, g, m); box((w - dw) / 2, h, .3, null, (w + dw) / 4 + door, h / 2, d / 2, g, m); box(dw, h - 2.1, .3, null, door, 2.1 + (h - 2.1) / 2, d / 2, g, m); }
    else box(w, h, .3, null, 0, h / 2, d / 2, g, m);
    if (ceiling) box(w, .3, d, null, 0, h, 0, g, m);
    g.userData.lights = lamps.map(([x, z, y = .6]) => { glow(.07, .1, 4, 2, .7, x, y - .1, z, g); const L = new THREE.PointLight('#ffb070', 3, 9, 2); L.position.set(x, y, z); g.add(L); return L; });
    R().add(g); addFloor(at[0], at[2], w, d, at[1], g); return g;
  }
  // 성벽: from → to, 망대와 성가퀴
  function cityWall({ from, to, h = 9, t = 2.4, color = '#b7a07c', towers = 40, height } = {}) {
    const g = new THREE.Group(), m = mat(color, { flatShading: true });
    const dx = to[0] - from[0], dz = to[1] - from[1], L = Math.hypot(dx, dz), ry = Math.atan2(dx, dz), n = Math.max(1, Math.round(L / 12));
    for (let i = 0; i < n; i++) {
      const k = (i + .5) / n, x = from[0] + dx * k, z = from[1] + dz * k, y = height ? height(x, z) : 0;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(t, h + 3, L / n + .05), m); seg.position.set(x, y + (h + 3) / 2 - 3, z); seg.rotation.y = ry; g.add(seg);
      for (let j = 0; j < 4; j++) { const b = new THREE.Mesh(new THREE.BoxGeometry(t * .5, .9, .9), m); const kk = (i + (j + .5) / 4) / n; b.position.set(from[0] + dx * kk, y + h + .45, from[1] + dz * kk); b.rotation.y = ry; g.add(b); }
      if (towers && i % Math.max(1, Math.round(towers / 12)) === 0) { const tw = new THREE.Mesh(new THREE.BoxGeometry(t * 2.2, h + 6, t * 2.2), m); tw.position.set(x, y + (h + 6) / 2 - 3, z); tw.rotation.y = ry; g.add(tw); }
    }
    R().add(g); return g;
  }
  // 성전 (헤롯 성전): 넓은 단, 주랑, 흰 돌과 금빛 성소
  function temple({ at = [0, 0, 0], ry = 0, s = 1 } = {}) {
    const g = new THREE.Group(); g.position.set(at[0], at[1], at[2]); g.rotation.y = ry; g.scale.setScalar(s);
    const stone = mat('#d9ccb0', { flatShading: true }), white = mat('#efe8d8'), gold = mat('#c9a23a', { metalness: .4, roughness: .45 });
    box(120, 14, 90, null, 0, 7, 0, g, stone);  // 성전 산의 단
    for (let i = 0; i < 24; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, 9, 8), white); c.position.set(-57 + i * 5, 18.5, 44); g.add(c); }  // 주랑
    box(120, 1.2, 6, null, 0, 23.6, 43, g, white);
    box(40, 8, 40, null, 0, 18, -5, g, stone);  // 안뜰
    box(22, 26, 30, null, 0, 35, -8, g, white);  // 성소
    box(30, 30, 4, null, 0, 37, 8, g, white);  // 현관
    box(31, 1.4, 5, null, 0, 52.7, 8, g, gold); box(23, 1.2, 31, null, 0, 48.6, -8, g, gold);
    box(8, 14, .5, '#3a2a1c', 0, 29, 10.3, g);  // 들어가는 문
    R().add(g); return g;
  }
  // 나무: 감람나무, 종려나무, 무화과나무, 위성류. 같은 종류는 한꺼번에 그린다
  const TREE = {
    olive: { trunk: '#5a4a3a', leaf: '#7b8a63', h: 3.2, crown: [[0, 3.2, 0, 1.7], [.9, 2.8, .4, 1.1], [-.8, 2.9, -.3, 1.2]] },
    fig: { trunk: '#6a5a48', leaf: '#4f6b34', h: 2.6, crown: [[0, 2.8, 0, 1.9], [1, 2.4, .5, 1.2], [-1, 2.5, -.4, 1.2]] },
    palm: { trunk: '#7a6248', leaf: '#5d7a3c', h: 8, palm: true },
    tamarisk: { trunk: '#5e4e3e', leaf: '#8a9470', h: 4, crown: [[0, 4.2, 0, 2], [.8, 3.6, .6, 1.4]] },
    bare: { trunk: '#5a4a3a', leaf: '#5a4a3a', h: 2.6, crown: [[0, 2.7, 0, .5], [.6, 2.4, .3, .35], [-.5, 2.3, -.2, .3]] }  // 잎이 없는 (마른) 나무
  };
  function trees(kind, { n = 20, place, height, s = [.8, 1.25] } = {}) {
    const T = TREE[kind], g = new THREE.Group(), d = new THREE.Object3D(), pts = [];
    for (let i = 0; i < n; i++) { const [x, z] = place(i); pts.push([x, height ? height(x, z) : 0, z, rnd(s[0], s[1]), rnd(0, 6.3)]); }
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(T.palm ? .16 : .2, T.palm ? .24 : .32, T.h, 7), mat(T.trunk), n);
    pts.forEach(([x, y, z, sc, r], i) => { d.position.set(x, y + T.h * sc / 2, z); d.rotation.set(T.palm ? .08 : .1, r, 0); d.scale.setScalar(sc); d.updateMatrix(); trunk.setMatrixAt(i, d.matrix); });
    g.add(trunk);
    if (T.palm) {
      const fr = new THREE.InstancedMesh(new THREE.ConeGeometry(.35, 3.6, 4), mat(T.leaf, { side: THREE.DoubleSide }), n * 9);
      pts.forEach(([x, y, z, sc, r], i) => { for (let j = 0; j < 9; j++) { const a = r + j / 9 * Math.PI * 2; d.position.set(x + Math.sin(a) * 1.4 * sc, y + T.h * sc + .2, z + Math.cos(a) * 1.4 * sc); d.rotation.set(Math.cos(a) * 1.25, 0, -Math.sin(a) * 1.25); d.scale.set(sc, sc, .25 * sc); d.updateMatrix(); fr.setMatrixAt(i * 9 + j, d.matrix); } });
      g.add(fr);
    } else {
      const cr = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mat(T.leaf, { flatShading: true }), n * T.crown.length);
      pts.forEach(([x, y, z, sc, r], i) => T.crown.forEach(([cx, cy, cz, cs], j) => { d.position.set(x + (cx * Math.cos(r) + cz * Math.sin(r)) * sc, y + cy * sc, z + (cz * Math.cos(r) - cx * Math.sin(r)) * sc); d.rotation.set(r, r * 2, 0); d.scale.set(cs * sc, cs * sc * .72, cs * sc); d.updateMatrix(); cr.setMatrixAt(i * T.crown.length + j, d.matrix); }));
      g.add(cr); g.userData.crown = cr;
    }
    R().add(g); return g;
  }
  // 풀밭과 갈대: 작은 잎을 흩뿌린다 (요 6:10 "잔디가 많은지라")
  function grass({ center = [0, 0], rx = 20, rz = 20, n = 1500, height, color = '#5f7a3a', h = .35, reeds = false } = {}) {
    const m = new THREE.InstancedMesh(new THREE.ConeGeometry(reeds ? .03 : .06, reeds ? 1.6 : h, 3), mat(color), n), d = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()), x = center[0] + Math.cos(a) * r * rx, z = center[1] + Math.sin(a) * r * rz;
      d.position.set(x, (height ? height(x, z) : 0) + (reeds ? .8 : h / 2), z); d.rotation.set(rnd(-.25, .25), rnd(0, 6), rnd(-.25, .25)); d.scale.setScalar(rnd(.6, 1.3)); d.updateMatrix(); m.setMatrixAt(i, d.matrix);
    }
    m.frustumCulled = false; R().add(m); return m;
  }
  // 십자가: 세로 기둥, 가로 들보, 죄패 (요 19:19). userData.hang = 매달린 사람이 설 자리
  function cross({ at = [0, 0, 0], h = 4.2, ry = 0, titulus = false } = {}) {
    const g = new THREE.Group(); g.position.set(at[0], at[1], at[2]); g.rotation.y = ry;
    const wood = mat('#4d3a28', { flatShading: true });
    box(.22, h + .6, .2, null, 0, (h + .6) / 2 - .6, 0, g, wood); box(2.1, .2, .2, null, 0, h - .55, 0, g, wood);
    if (titulus) { box(.75, .32, .04, '#c9bea3', 0, h - .05, .12, g); }
    box(.3, .06, .22, null, 0, h - 1.92, .14, g, wood);  // 발판 (두 팔이 가로 들보에 닿는 높이)
    g.userData.hang = new THREE.Vector3(0, h - 1.89, .16);
    R().add(g); return g;
  }
  // 바위 무덤: 바위벽에 판 굴과 굴리는 돌 (요 20:1, 막 16:4). 안으로 들어갈 수 있는 방이다 (앞이 +z)
  function tomb({ at = [0, 0, 0], ry = 0 } = {}) {
    const g = new THREE.Group(); g.position.set(at[0], at[1], at[2]); g.rotation.y = ry;
    const rock = mat('#9a8a74', { flatShading: true }), inner = mat('#6e6252');
    box(4.2, 5, 1, null, -3.2, 2.5, 0, g, rock); box(4.2, 5, 1, null, 3.2, 2.5, 0, g, rock); box(2.2, 2.6, 1, null, 0, 3.7, 0, g, rock);  // 앞벽과 문 (너비 2.2, 높이 2.4)
    box(1, 2.8, 5, null, -1.7, 1.4, -3, g, inner); box(1, 2.8, 5, null, 1.7, 1.4, -3, g, inner); box(4.4, 2.8, 1, null, 0, 1.4, -5.4, g, inner); box(4.4, .8, 6, null, 0, 3.2, -3, g, inner);  // 안쪽 방
    box(4, 6, 7, null, -4.4, 3, -3.4, g, rock); box(4, 6, 7, null, 4.4, 3, -3.4, g, rock); box(12, 2.6, 7.4, null, 0, 4.8, -3.4, g, rock);  // 바깥 바위 덩어리
    box(1, .6, 3.6, '#8a7b66', .75, .3, -3.2, g);  // 시체를 뉘던 자리
    const L = new THREE.PointLight('#d8c8a8', 1.2, 7, 2); L.position.set(0, 2, -1.2); g.add(L);
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, .45, 18), mat('#8c7d68', { flatShading: true })); stone.rotation.x = Math.PI / 2; stone.position.set(0, 1.4, .8); g.add(stone);
    g.userData.stone = stone; g.userData.shelf = new THREE.Vector3(.75, .62, -3.2);
    R().add(g);
    addGround((x, z) => { if (!shown(g)) return null; const p = g.worldToLocal(new THREE.Vector3(x, 0, z)); return Math.abs(p.x) < 1.2 && p.z < .6 && p.z > -4.9 ? at[1] : null; });
    return g;
  }
  // 수염 없는 단순한 닭 (눅 22:60): 몸, 볏, 꼬리
  function rooster({ at = [0, 0, 0], ry = 0 } = {}) {
    const g = new THREE.Group(); g.position.set(at[0], at[1], at[2]); g.rotation.y = ry;
    const body = new THREE.Mesh(new THREE.SphereGeometry(.13, 10, 8), mat('#7a3d1e')); body.scale.set(1, .9, 1.3); body.position.y = .3; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.06, 8, 6), mat('#8a4a24')); head.position.set(0, .48, .12); g.add(head);
    const comb = new THREE.Mesh(new THREE.BoxGeometry(.015, .06, .08), mat('#b0181c')); comb.position.set(0, .55, .12); g.add(comb);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(.018, .05, 4), mat('#c9a23a')); beak.rotation.x = Math.PI / 2; beak.position.set(0, .47, .19); g.add(beak);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(.09, .3, 5), mat('#1e2a1e')); tail.position.set(0, .42, -.18); tail.rotation.x = -.7; g.add(tail);
    [-.05, .05].forEach(x => box(.015, .2, .015, '#c9a23a', x, .1, 0, g));
    g.userData.head = head; R().add(g); return g;
  }

  /* --- 시점: 마우스나 손가락으로 끌어서 둘러본다 (움직이지는 않는다). 가만히 두면 천천히 이야기의 방향으로 돌아온다 --- */
  let lookX = 0, lookY = 0, tLookX = 0, tLookY = 0, dragging = null, lastDrag = -99;
  const onMove = e => {
    if (!dragging || e.pointerId !== dragging.id) return;
    tLookX = clamp(dragging.lx - (e.clientX - dragging.x) / innerWidth * 2.2, -1, 1);
    tLookY = clamp(dragging.ly - (e.clientY - dragging.y) / innerHeight * 2.4, -1, 1);
    lastDrag = clock;
  };
  const onDown = e => { if (e.pointerType === 'mouse' && e.button !== 0) return; dragging = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: tLookX, ly: tLookY }; lastDrag = clock; };
  const onUp = e => { if (dragging && e.pointerId === dragging.id) { dragging = null; lastDrag = clock; } };
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
    // 어두운 장면일수록(해가 지고 하늘빛이 약할수록) 고른 빛과 노출을 더한다
    const dark = clamp(1 - (sun.intensity * .4 + hemi.intensity) / .8, 0, 1);
    moon.intensity = dark * .7;
    renderer.toneMappingExposure = env.exposure * (1.15 + dark * .35);
    ashU.uTime.value = clock; ashU.uAmt.value = env.ash; ashU.uWind.value = env.wind; ashU.uTint.value.copy(env.fog).multiplyScalar(1.5).addScalar(.06); ashU.uCam.value.copy(camera.position);
    let bn = 0;
    for (const b of boats) { if (bn >= 4 || !shown(b)) continue; waters[0] && waters.forEach(({ u }) => { u.uBoat.value[bn].set(b.position.x, b.position.z, Math.cos(b.rotation.y), Math.sin(b.rotation.y)); u.uBoatL.value[bn] = b.userData.len / 2; }); bn++; }
    waters.forEach(({ u }) => {
      u.uBoatN.value = bn;
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

    if (!dragging && clock - lastDrag > 5) { const k = 1 - Math.exp(-dt * .7); tLookX -= tLookX * k; tLookY -= tLookY * k; }
    const lk = Math.min(1, dt * 4); lookX += (tLookX - lookX) * lk; lookY += (tLookY - lookY) * lk;
    const sway = reduceMotion ? 0 : 1, sh = env.shake * (reduceMotion ? .15 : 1);
    if (camGround.on) env.camH = groundAt(env.camX, env.camZ) + camGround.eye;  // 걸을 때 눈높이를 땅에 맞춘다
    camera.position.set(env.camX + Math.sin(clock * 13.1) * .02 * sh, env.camH + Math.sin(clock * .9) * .012 * sway + Math.sin(clock * 17.3) * .02 * sh, env.camZ);
    if (camWater.on) camera.position.y += waveH(env.camX, env.camZ, env.waves) * camWater.k;
    { const gy = groundAt(camera.position.x, camera.position.z) + .28; if (camera.position.y < gy) camera.position.y = gy; }  // 땅·배 바닥 아래로는 내려가지 않는다
    camera.rotation.set(Math.max(-1.45, env.camP - lookY * (lookY > 0 ? 1.3 : .45)) + Math.sin(clock * .6) * .004 * sway, env.camY - lookX * 1.4, env.camR + Math.sin(clock * .37) * .004 * sway + Math.sin(clock * 11) * .004 * sh + (camWater.on ? (waveH(env.camX + 1, env.camZ, env.waves) - waveH(env.camX - 1, env.camZ, env.waves)) * .3 * camWater.k : 0));
    sky.position.copy(camera.position);
    stepSelf(dt);
    grain.uniforms.uTime.value = clock;

    composer.render(dt);
    raf = requestAnimationFrame(frame);
  }
  const camWater = { on: false, k: 1 }, camGround = { on: false, eye: 1.65 };
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
    // 눈높이를 땅 + eye로 (걸어가는 장면). null이면 끈다
    groundCam(eye = 1.65) { if (eye == null) { camGround.on = false; return; } camGround.on = true; camGround.eye = eye; },
    // 땅을 따라 걸어간다: kit.walkTo(x, z, 초, { eye })
    walkTo(x, z, dur, { eye = 1.65 } = {}) { camGround.on = true; camGround.eye = eye; return setEnv({ camX: x, camZ: z }, dur); },
    groundAt, addGround, addFloor, boatAt, outsideBoats,
    waveH: (x, z) => waveH(x, z, env.waves),
    terrain, disc, rocks, box, glow, glowMat, person, figure, gesture, hold, selfBody, mat, house, village, room, cityWall, temple, trees, grass, cross, tomb, rooster, get self() { return me; }, into, site, shown, prop, instancedProp, throng, walker, faceCamera, herd, fire, water, float, boat, net, tent, altar,
    reset() {
      for (const k in tw) delete tw[k];
      tweens.length = 0; cyc = null; camWater.on = false; camGround.on = false; tLookX = tLookY = 0;
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
