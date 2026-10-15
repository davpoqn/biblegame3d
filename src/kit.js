/* 3D 공용 도구 — 모든 인물의 장면이 같이 쓴다 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

let SPEED = 1;  // 테스트용 배속 (index.html ?test의 배속 버튼). 시계와 기다림을 함께 빠르게 한다
export const sleep = ms => new Promise(r => setTimeout(r, ms / SPEED));
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
  // 얼굴·머리카락 텍스처: GLTFLoader는 보통 fetch(blob:)로 그림을 읽는데 아티팩트 보안 정책이 막는다(connect-src). 그 동안만 createImageBitmap을 감춰 <img>(img-src blob: 허용)로 읽게 한다
  const cib = window.createImageBitmap; try { window.createImageBitmap = undefined; } catch (e) {}
  try { (await Promise.all(keys.map(k => ld.parseAsync(buf(D[k]), '')))).forEach((g, i) => { G[keys[i]] = g; }); }
  finally { try { window.createImageBitmap = cib; } catch (e) {} }
  const animals = {};
  for (const k of keys) if (k.startsWith('an_')) animals[k.slice(3)] = prepAnimal(G[k]);
  return { m: G.char_m, f: G.char_f, clips: Object.fromEntries(G.anims.animations.map(c => [c.name, c])), outfits: window.OUTFITS, props: G.props, animals, jesusHead: G.jesus_head ? G.jesus_head.scene : null,
    mhHead: { m: G.mh_head_m ? G.mh_head_m.scene : null, f: G.mh_head_f ? G.mh_head_f.scene : null } };
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
// 각진 동물 모델을 부드럽게: 같은 자리의 꼭짓점을 하나로 이어 붙이고 법선을 다시 계산한다(뼈 가중치는 같은 자리끼리 같다)
function weldSmooth(geo) {
  const p = geo.getAttribute('position'), n = p.count, map = new Int32Array(n), keys = new Map();
  for (let i = 0; i < n; i++) { const k = Math.round(p.getX(i) * 1e4) + ',' + Math.round(p.getY(i) * 1e4) + ',' + Math.round(p.getZ(i) * 1e4); let j = keys.get(k); if (j === undefined) { j = i; keys.set(k, i); } map[i] = j; }
  const src = geo.index ? geo.index.array : Array.from({ length: n }, (_, i) => i), tri = new Uint32Array(src.length);
  for (let i = 0; i < src.length; i++) tri[i] = map[src[i]];
  const g2 = geo.clone(); g2.setIndex(Array.from(tri)); g2.deleteAttribute('normal'); g2.computeVertexNormals(); return g2;
}
function prepAnimal(g) {  // 뼈대(가까이 한두 마리), 굳힌 자세(무리)
  const rig = g.scene.getObjectByName('Armature');
  if (rig) rig.traverse(m => { if (m.isMesh) m.geometry = weldSmooth(m.geometry); });
  const poses = ['pose_a', 'pose_b', 'pose_c'].map(n => g.scene.getObjectByName(n)).filter(Boolean).map(o => { g.scene.updateWorldMatrix(true, true); const parts = []; o.traverse(m => { if (m.isMesh) parts.push({ geo: weldSmooth(floatGeo(m.geometry.clone()).applyMatrix4(m.matrixWorld)), mat: m.material }); }); return parts; });
  return { rig, poses, clips: Object.fromEntries(g.animations.map(c => [c.name, c])) };
}

export async function createKit(canvas, { presets = {}, initial = 'start', audio } = {}) {
  const PRE = {};
  for (const k in presets) PRE[k] = presets[k];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const PR = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(PR);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.AgXToneMapping;  // 그래픽 1단계(2026-10-15): ACES는 피부가 주황빛으로 쏠려 더 자연스러운 AgX로. 노출은 TONE_K로 맞춘다
  const TONE_K = 1.15, HQ = !(window.matchMedia && matchMedia('(pointer: coarse)').matches);  // HQ: 마우스로 하는 PC (무거운 효과는 PC만)
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const fog = new THREE.FogExp2(0x000000, .006);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, .05, 3000);
  camera.rotation.order = 'YXZ';

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth * PR, innerHeight * PR, { type: THREE.HalfFloatType, samples: HQ ? 4 : 2 }));  // 계단 현상 없애기(MSAA)
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
        c.rgb = max(mix(vec3(dot(c.rgb, vec3(.2126, .7152, .0722))), c.rgb, 1.18), 0.);  // 채도를 조금 (AgX는 색이 옅다)
        vec2 q = vUv - .5;
        c.rgb *= clamp(1.0 - dot(q, q) * 1.35, 0.0, 1.0);
        float g = h(vUv * vec2(1931.0, 1087.0) + fract(uTime) * 97.0) - .5;
        c.rgb += g * .045 * (.25 + c.rgb);
        gl_FragColor = c;
      }`
  });
  composer.addPass(grain);
  composer.addPass(new OutputPass());
  // 그래픽 2단계(2026-10-15, PC만): 틈새 그림자(GTAO: 옷 주름·맞닿은 곳·처마 밑이 어두워져 입체감)와 대화할 때 배경 흐림(피사계 심도)
  let gtao = null, bokeh = null, dofK = 0, dofF = 3;
  if (HQ) {
    try {
      const [{ GTAOPass }, { BokehPass }] = await Promise.all([import('three/addons/postprocessing/GTAOPass.js'), import('three/addons/postprocessing/BokehPass.js')]);
      gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
      gtao.updateGtaoMaterial({ radius: .45, distanceExponent: 1.5, thickness: 1, scale: 1, samples: 12 }); gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 12 });
      gtao.blendIntensity = .75;
      const gs = gtao.setSize.bind(gtao); gtao.setSize = (w, h) => gs(Math.round(w * .6), Math.round(h * .6));  // 0.6배 해상도로 (무겁다)
      composer.insertPass(gtao, 1);
      bokeh = new BokehPass(scene, camera, { focus: 3, aperture: .006, maxblur: 0 }); bokeh.enabled = false; composer.insertPass(bokeh, 2);
      composer.setSize(innerWidth, innerHeight);
    } catch (e) { console.warn('틈새 그림자·배경 흐림을 켜지 못했습니다:', e); gtao = bokeh = null; }
  }

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
  // 그림자: 나무 아래 얼룩진 그림자, 사람·바위 그림자. 카메라 둘레 28m만 그린다(휴대폰은 작은 그림자 지도)
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const SHM = window.matchMedia && matchMedia('(pointer: coarse)').matches ? 1024 : 2048, SHR = 28;
  sun.castShadow = true; sun.shadow.mapSize.set(SHM, SHM);
  Object.assign(sun.shadow.camera, { left: -SHR, right: SHR, top: SHR, bottom: -SHR, near: 1, far: 260 }); sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -.0005; sun.shadow.normalBias = .04; scene.add(sun.target);
  let shadowSweepAt = 0;
  function shadowSweep() {  // 새로 생긴 물체에도 그림자를 켠다 (1.5초마다). userData.noCast: 그림자를 드리우지 않음(풀, 땅)
    scene.traverse(o => {
      if (!(o.isMesh || o.isInstancedMesh) || o.userData.shadowSet) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!m || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial)) return;
      o.userData.shadowSet = true; o.castShadow = !o.userData.noCast && !m.transparent; o.receiveShadow = true;
    });
  }
  const hemi = new THREE.HemisphereLight('#ffffff', '#332211', .6); scene.add(hemi);
  // 하늘빛 조명(IBL, 그래픽 1단계): 지금 하늘색·땅빛·해로 작은 환경 지도를 만들어 모든 재질에 은은한 빛과 반사를 준다. 하늘이 바뀌면 다시 만든다 (고른 빛 hemi는 그만큼 줄인다)
  const pmrem = new THREE.PMREMGenerator(renderer), ENV_K = .75, HEMI_K = .55;
  const envU = { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, uSun: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) } };
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({ uniforms: envU, side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uGround; uniform vec3 uSun; uniform vec3 uSunDir; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); float h = d.y;
        vec3 c = h > 0. ? mix(uHor, uTop, smoothstep(0., .55, h)) : mix(uHor, uGround, smoothstep(0., -.25, h));
        c += uSun * pow(max(dot(d, uSunDir), 0.), 48.) * 3.;
        gl_FragColor = vec4(c, 1.); }` })));
  let envRT = null, envKey = '', envAt = -9;
  function stepEnvMap() {
    const k = env.hemiI * ENV_K;
    envU.uTop.value.copy(env.top).multiplyScalar(k); envU.uHor.value.copy(env.horizon).multiplyScalar(k); envU.uGround.value.copy(env.fog).multiplyScalar(k * .55);
    envU.uSun.value.copy(env.sun).multiplyScalar(sun.intensity * .12); envU.uSunDir.value.copy(sunDir);
    const key = [envU.uTop.value, envU.uHor.value, envU.uGround.value, envU.uSun.value].map(c => c.getHexString()).join() + sunDir.toArray().map(v => v.toFixed(2)).join();
    if (key === envKey) return; envKey = key;
    const old = envRT; envRT = pmrem.fromScene(envScene, .04); scene.environment = envRT.texture; if (old) old.dispose();
  }
  const moon = new THREE.AmbientLight('#9aa8d0', 0); scene.add(moon);  // 어두운 장면에서도 사람과 사물이 보이게 하는 고른 빛

  /* --- 자연 질감 (2026-10-14, 사용자가 보낸 사진: 나무 사이 흙길, 바위 언덕의 흙길, 해 질 녘 물결) ---
     그림 파일 없이 캔버스로 그린다. repeat: 이어 붙여도 이음매가 없게 가장자리를 넘는 점은 반대편에도 그린다 */
  const windU = { value: 0 };
  function canvasTex(w, h, draw, { srgb = true } = {}) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.userData.canvas = c; return t;
  }
  // 잎·풀처럼 투명한 곳을 잘라 그리는 그림: 작은 밉맵에서 투명도가 평균 나며 잎이 사라지지 않게, 밉맵마다 투명도를 다시 세운다
  function cutoutTex(w, h, draw) {
    const t = canvasTex(w, h, draw), src = t.userData.canvas, mips = [];
    let cw = w, ch = h, prev = src;
    while (cw > 1 || ch > 1) {
      cw = Math.max(1, cw >> 1); ch = Math.max(1, ch >> 1);
      const c = document.createElement('canvas'); c.width = cw; c.height = ch; const g = c.getContext('2d'); g.drawImage(prev, 0, 0, cw, ch);
      const im = g.getImageData(0, 0, cw, ch), d = im.data; for (let i = 3; i < d.length; i += 4) d[i] = Math.min(255, d[i] * 1.6);  // 덮인 넓이가 줄지 않게
      g.putImageData(im, 0, 0); mips.push(c); prev = c;
    }
    t.mipmaps = [src, ...mips]; t.generateMipmaps = false; t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }
  function wrapDraw(g, w, h, x, y, r, fn) { for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) if (x + dx > -r && x + dx < w + r && y + dy > -r && y + dy < h + r) fn(x + dx, y + dy); }
  function blots(g, w, h, n, r0, r1, col) {
    for (let i = 0; i < n; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = rnd(r0, r1), c = col();
      wrapDraw(g, w, h, x, y, r, (px, py) => { const gr = g.createRadialGradient(px, py, 0, px, py, r); gr.addColorStop(0, c); gr.addColorStop(1, c.replace(/[\d.]+\)$/, '0)')); g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2); });
    }
  }
  // 밝기 그림 → 법선 지도 (울퉁불퉁한 느낌)
  function normalFrom(tex, k = 2.2) {
    const src = tex.userData.canvas, w = src.width, h = src.height, d = src.getContext('2d').getImageData(0, 0, w, h).data;
    return canvasTex(w, h, g => {
      const out = g.createImageData(w, h), L = (x, y) => d[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = (L(x - 1, y) - L(x + 1, y)) * k, dy = (L(x, y - 1) - L(x, y + 1)) * k, n = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
        out.data[i] = (dx / n * .5 + .5) * 255; out.data[i + 1] = (dy / n * .5 + .5) * 255; out.data[i + 2] = (1 / n * .5 + .5) * 255; out.data[i + 3] = 255;
      }
      g.putImageData(out, 0, 0);
    }, { srgb: false });
  }
  const TEX = {};
  // 흙: 밝기 0.8~1.05의 얼룩, 잔돌, 모래알. 땅 색(정점 색)에 곱한다
  TEX.soil = () => TEX._soil || (TEX._soil = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = 'rgb(236,236,236)'; g.fillRect(0, 0, w, h);
    blots(g, w, h, 70, 30, 90, () => Math.random() < .5 ? `rgba(200,200,200,${rnd(.2, .45).toFixed(2)})` : `rgba(255,255,255,${rnd(.15, .35).toFixed(2)})`);
    blots(g, w, h, 260, 4, 14, () => `rgba(${Math.random() < .6 ? '185,185,185' : '255,255,255'},${rnd(.25, .5).toFixed(2)})`);
    for (let i = 0; i < 520; i++) {  // 잔돌
      const x = Math.random() * w, y = Math.random() * h, r = rnd(1.2, 4.2), l = rnd(150, 245) | 0;
      wrapDraw(g, w, h, x, y, r + 2, (px, py) => { g.fillStyle = 'rgba(90,90,90,.35)'; g.beginPath(); g.ellipse(px + .8, py + 1, r, r * .75, 0, 0, 7); g.fill(); g.fillStyle = `rgb(${l},${l},${l})`; g.beginPath(); g.ellipse(px, py, r, r * .75, rnd(0, 3), 0, 7); g.fill(); });
    }
    for (let i = 0; i < 9000; i++) { const l = rnd(170, 255) | 0; g.fillStyle = `rgba(${l},${l},${l},.5)`; g.fillRect(Math.random() * w, Math.random() * h, 1, 1); }
  }));
  TEX.soilN = () => TEX._soilN || (TEX._soilN = normalFrom(TEX.soil(), 3));
  // 흙길: 가운데가 밟혀 밝고 매끈하고, 가장자리는 풀과 섞이며 흐려진다 (가로 = 길 폭, 세로 = 길 방향)
  TEX.path = () => TEX._path || (TEX._path = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = 'rgb(198,170,128)'; g.fillRect(0, 0, w, h);
    blots(g, w, h, 60, 10, 40, () => Math.random() < .5 ? `rgba(160,130,92,${rnd(.25, .5).toFixed(2)})` : `rgba(222,200,160,${rnd(.25, .5).toFixed(2)})`);
    for (const cx of [.36, .64]) { const gr = g.createLinearGradient(w * (cx - .12), 0, w * (cx + .12), 0); gr.addColorStop(0, 'rgba(232,212,176,0)'); gr.addColorStop(.5, 'rgba(232,212,176,.45)'); gr.addColorStop(1, 'rgba(232,212,176,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }  // 밟힌 두 줄
    for (let i = 0; i < 260; i++) { const x = Math.random() * w, y = Math.random() * h, r = rnd(1, 3.4), l = rnd(120, 230) | 0; wrapDraw(g, w, h, x, y, r, (px, py) => { g.fillStyle = `rgb(${l},${l * .92 | 0},${l * .8 | 0})`; g.beginPath(); g.ellipse(px, py, r, r * .7, rnd(0, 3), 0, 7); g.fill(); }); }
    const img = g.getImageData(0, 0, w, h), d = img.data;  // 가장자리: 들쭉날쭉하게 투명해진다
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const e = Math.abs(x / w - .5) * 2, wob = vnoise(x * .05, y * .02) * .28 + vnoise(x * .2, y * .2) * .1;
      d[(y * w + x) * 4 + 3] = clamp((1 - e - wob * .9) * 4.2, 0, 1) * 255;
    }
    g.putImageData(img, 0, 0);
  }));
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
  function terrain({ height, size = 900, seg = 240, lo = '#5f4738', hi = '#b8936a', yMul = .055, grain = .3, at = [0, 0], tint } = {}) {  // tint(x, z, y, c): 자리마다 색을 바꾼다(풀밭 등)
    const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2); g.translate(at[0], 0, at[1]);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    const cLo = new THREE.Color(lo), cHi = new THREE.Color(hi), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), y = height(x, z); p.setY(i, y);
      c.copy(cLo).lerp(cHi, clamp(.5 + y * yMul + (vnoise(x * .35, z * .35) - .5) * grain, 0, 1)); if (tint) tint(x, z, y, c);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
    const uvA = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++) { uvA[i * 2] = p.getX(i) / 2.6; uvA[i * 2 + 1] = p.getZ(i) / 2.6; }
    g.setAttribute('uv', new THREE.BufferAttribute(uvA, 2));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, map: TEX.soil(), normalMap: TEX.soilN(), normalScale: new THREE.Vector2(.7, .7) }));
    m.userData.noCast = true; R().add(m);
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
    const uvA = g.attributes.uv; for (let i = 0; i < p.count; i++) uvA.setXY(i, (p.getX(i) + at[0]) / 2.6, (p.getZ(i) + at[1]) / 2.6);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: TEX.soil(), normalMap: TEX.soilN(), normalScale: new THREE.Vector2(.6, .6) })); m.userData.noCast = true; m.position.set(at[0], y, at[1]); R().add(m); return m;
  }
  function rocks({ n = 160, height, color = '#7b6856', rMin = 4, rMax = 110, center = [0, 0], avoid, big = .08, sMin = .12, sMax = .8 } = {}) {
    if (!TEX._rockGeo) {  // 둥근 돌을 잡음으로 울퉁불퉁하게 (한 번 만들어 같이 쓴다)
      const rg = new THREE.IcosahedronGeometry(1, 2), pa = rg.attributes.position;
      for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i), k = .78 + vnoise(x * 1.6 + 7, y * 1.6 + z * 1.3) * .38 + vnoise(x * 4 + z * 3, y * 4) * .1; pa.setXYZ(i, x * k, y * k * (y < -.3 ? .7 : 1), z * k); }
      rg.computeVertexNormals(); TEX._rockGeo = rg;
    }
    const m = new THREE.InstancedMesh(TEX._rockGeo, new THREE.MeshStandardMaterial({ color, roughness: .95, map: TEX.soil(), normalMap: TEX.soilN(), normalScale: new THREE.Vector2(1.2, 1.2) }), n);
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

  /* --- 등잔과 횃불 (사용자: 전등은 절대 없고 모든 불빛은 등잔·횃불, 2026-10-14) ---
     진흙 등잔: 둥근 몸통에 심지 주둥이와 손잡이. 매단 등잔: 청동 등잔을 쇠사슬 셋으로 천장에 매단다(로마 시대에 쓰던 모양).
     불꽃은 깜빡이고, 빛(PointLight)도 불꽃을 따라 흔들린다 */
  const flames = [];
  const LAMP = {};
  function lampBody(bronze) {
    const k = bronze ? 'b' : 'c'; if (LAMP[k]) return LAMP[k];
    const pts = [[0, 0], [.03, .002], [.045, .012], [.047, .02], [.038, .028], [.012, .03], [.01, .036], [0, .036]].map(([x, y]) => new THREE.Vector2(x, y));
    const body = new THREE.LatheGeometry(pts, 14), nose = new THREE.CylinderGeometry(.009, .013, .05, 8); nose.rotateZ(Math.PI / 2); nose.translate(.055, .02, 0);
    const handle = new THREE.TorusGeometry(.016, .005, 5, 10, Math.PI); handle.rotateY(Math.PI / 2); handle.translate(-.05, .02, 0);
    return (LAMP[k] = { geos: [body, nose, handle], mat: bronze ? new THREE.MeshStandardMaterial({ color: '#8a6a3a', metalness: .55, roughness: .45 }) : new THREE.MeshStandardMaterial({ color: '#9a6a46', roughness: .9 }) });
  }
  function lamp({ at = [0, 0, 0], parent = R(), hang = 0, light = null, power = 2.6, ry = 0 } = {}) {
    const g = new THREE.Group(); g.position.set(at[0], at[1], at[2]); g.rotation.y = ry; parent.add(g);
    const B = lampBody(hang > 0); B.geos.forEach(geo => g.add(new THREE.Mesh(geo, B.mat)));
    if (hang > 0) for (let i = 0; i < 3; i++) {  // 쇠사슬
      const a = i / 3 * Math.PI * 2, c = new THREE.Mesh(new THREE.CylinderGeometry(.003, .003, hang, 4), B.mat), tx = Math.cos(a) * .035, tz = Math.sin(a) * .035;
      c.position.set(tx / 2, .03 + hang / 2, tz / 2); c.rotation.set(Math.atan2(tz, hang) * -1, 0, Math.atan2(tx, hang)); g.add(c);
    }
    const fl = new THREE.Mesh(new THREE.ConeGeometry(.009, .04, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.7, .55), fog: false }));
    fl.position.set(.08, .045, 0); g.add(fl);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(.03, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, .7, .25), transparent: true, opacity: .35, depthWrite: false, fog: false }));
    halo.position.copy(fl.position); g.add(halo);
    let L = light;
    if (light === false) L = { intensity: 1, userData: {}, position: new THREE.Vector3() };  // 불빛은 다른 등이 맡고 불꽃만 (빛을 너무 많이 두지 않게)
    else if (!L) { L = new THREE.PointLight('#ffb070', power, 9, 2); parent.add(L); }
    L.position.set(at[0], at[1] + .15, at[2]);
    flames.push({ fl, halo, L, base: L.intensity, seed: Math.random() * 9 });
    return g;
  }
  // 이미 있는 빛에 보이는 등잔을 단다: kit.lampAt(L, { hang: 높이 }) — 빛의 자리에 등잔을 두고(매달면 그만큼 위가 천장), 빛은 불꽃을 따라 흔들린다
  function lampAt(L, { hang = 0, drop = .1 } = {}) { return lamp({ at: [L.position.x, L.position.y - drop, L.position.z], parent: L.parent && L.parent !== scene ? L.parent : R(), hang, light: L }); }
  // 손에 든 횃불: kit.torch(뼈, { light }) — 막대 끝의 불꽃, 깜빡이는 빛
  function torch(bone, { light = null, power = 2.4 } = {}) {
    const t = new THREE.Group(); t.add(new THREE.Mesh(new THREE.CylinderGeometry(.025, .03, .7, 6), mat('#4a3626')));
    const fl = new THREE.Mesh(new THREE.ConeGeometry(.07, .22, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.5, .45), fog: false })); fl.position.y = .45; t.add(fl);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(.12, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, .6, .2), transparent: true, opacity: .3, depthWrite: false, fog: false })); halo.position.y = .42; t.add(halo);
    const L = light || new THREE.PointLight('#ff9a50', power, 9, 2); if (L.parent) L.parent.remove(L); L.position.set(0, .55, 0); t.add(L);
    t.rotation.set(0, 0, -.2); bone.add(t); t.scale.setScalar(1 / Math.max(1e-3, bone.getWorldScale(new THREE.Vector3()).x));
    flames.push({ fl, halo, L, base: L.intensity || power, seed: Math.random() * 9 });
    return t;
  }
  function stepFlames() {
    for (const f of flames) {
      const n = Math.sin(clock * 11 + f.seed) * .5 + Math.sin(clock * 17.3 + f.seed * 2) * .3 + Math.sin(clock * 5.1 + f.seed * 3) * .2, k = 1 + n * .12;
      f.fl.scale.set(1 - n * .08, k, 1 - n * .08); f.halo.scale.setScalar(1 + n * .1);
      if (f.L.userData.base == null) f.L.userData.base = f.L.intensity;
      if (f.L.userData.lastSet !== f.L.intensity) f.L.userData.base = f.L.intensity;  // 이야기가 밝기를 바꾸면 그것을 기준으로
      f.L.intensity = f.L.userData.base * (1 + n * .1); f.L.userData.lastSet = f.L.intensity;
      f.fl.visible = f.halo.visible = f.L.userData.base > .01;
    }
  }

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
  // 예수님(연출: 성경에는 생김새가 없다). 사용자가 보낸 그림(2026-10-14)처럼 평범한 갈릴리 사람: 거친 베 속옷, 붉은 줄무늬 띠, 두 어깨에 두른 줄무늬 올리브색 겉옷, 가죽끈 샌들. 후광은 없다
  const JESUS = { name: '예수 (연출)', body: 'm', wear: ['tunic_long', 'belt', 'sandals', 'beard', 'mantle_j'], under: '#d8ccb6', colors: { tunic: '#d8ccb6', belt: '#8a3328', beard: '#4a3122', mantle_j: '#6f6c3a' } };
  const JESUS_HAIR = '#3f2a1c';
  // 예수님 겉옷(mantle_j, build_chars.py가 뼈에 붙여 만든 옷)에 줄무늬와 주름을 그린다: 아랫단 두 줄, 앞자락 두 줄, 아래로 갈수록 깊은 세로 주름.
  // 옷의 원래 자리(뼈로 움직이기 전)를 기준으로 하므로 걷거나 팔을 들어도 무늬가 옷을 따라간다
  // 천처럼: 걸으면 아랫단이 뒤로 끌리고, 멈추거나 돌면 흔들리다 가라앉고(용수철), 바람에 살짝 나부낀다. 위(어깨)는 움직이지 않고 아래로 갈수록 크게
  function mantleStripes(o) {
    o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox, U = new THREE.Vector4(bb.min.y, bb.max.y, (bb.min.x + bb.max.x) / 2, (bb.min.z + bb.max.z) / 2);
    const lag = new THREE.Vector3(), perM = (bb.max.y - bb.min.y) / 1.25;  // 옷 길이 약 1.25m: 1m가 모델 단위로 얼마인지
    o.material.onBeforeCompile = sh => {
      sh.uniforms.uBB = { value: U }; sh.uniforms.uLag = { value: lag }; sh.uniforms.uWind = windU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRest; uniform vec4 uBB; uniform vec3 uLag; uniform float uWind;').replace('#include <begin_vertex>', `#include <begin_vertex>
        vRest = position;
        { float t = clamp((position.y - uBB.x) / (uBB.y - uBB.x), 0., 1.), w = pow(1. - t, 1.7), a = atan(position.x - uBB.z, position.z - uBB.w);
          transformed += (uLag + vec3(sin(uWind * 2.3 + a * 3. + t * 7.) * .014, 0., cos(uWind * 1.9 + a * 2. + t * 5.) * .012)) * ${perM.toFixed(4)} * w; }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRest; uniform vec4 uBB;').replace('#include <color_fragment>', `#include <color_fragment>
        float t = (vRest.y - uBB.x) / (uBB.y - uBB.x), a = atan(vRest.x - uBB.z, vRest.z - uBB.w), ea = abs(a);
        diffuseColor.rgb *= 1. + sin(a * 9. + sin(t * 9.) * .9) * .13 * (1.1 - t);  // 주름
        float band = step(.03, t) * step(t, .055) + step(.08, t) * step(t, .1) + (step(.9, ea) * step(ea, .99) + step(1.06, ea) * step(ea, 1.13)) * step(t, .82);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.42, .46, .3), clamp(band, 0., 1.));`);
    };
    o.material.customProgramCacheKey = () => 'mantle_j';
    return { lag, x: new THREE.Vector2(), v: new THREE.Vector2(), prev: null, vel: new THREE.Vector2(), yaw: null };
  }
  const _cp = new THREE.Vector3(), _cq = new THREE.Quaternion(), _ce = new THREE.Euler();
  function stepCloth(g, C, dt) {
    if (dt <= 0) return;
    g.getWorldPosition(_cp); g.getWorldQuaternion(_cq); _ce.setFromQuaternion(_cq, 'YXZ');
    if (!C.prev) { C.prev = _cp.clone(); C.yaw = _ce.y; return; }
    const vx = (_cp.x - C.prev.x) / dt, vz = (_cp.z - C.prev.z) / dt; C.prev.copy(_cp);
    let dy = _ce.y - C.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2; C.yaw = _ce.y;
    const s = Math.sin(_ce.y), c = Math.cos(_ce.y), fwd = vx * s + vz * c, side = vx * c - vz * s;  // 사람 기준 앞(+z)·옆(+x) 빠르기
    const ax = (side - C.vel.x) / dt, az = (fwd - C.vel.y) / dt; C.vel.set(side, fwd);
    // 용수철: 목표는 가는 반대쪽으로 조금 끌린 자리, 빨라지거나 멈출 때 반대로 밀리고, 돌면 옆으로 쏠린다
    const tx = clamp(-side * .05 - dy / dt * .02, -.12, .12), tz = clamp(-fwd * .06, -.14, .1), K = 34, D = 7;
    const n = Math.ceil(dt / .04), h = dt / n;  // 배속이면 나눠서 (한 번에 크게 밀면 용수철이 튄다)
    for (let i = 0; i < n; i++) {
      C.v.x += ((tx - C.x.x) * K - C.v.x * D - ax * .012) * h; C.v.y += ((tz - C.x.y) * K - C.v.y * D - az * .012) * h;
      C.x.x = clamp(C.x.x + C.v.x * h, -.18, .18); C.x.y = clamp(C.x.y + C.v.y * h, -.2, .15);
    }
    C.lag.set(C.x.x, 0, C.x.y);
  }
  const JHEAD = { y: .1, z: .136 };  // 새 머리의 두 눈 가운데를 둘 자리(머리 뼈 기준). 다른 남자 머리(MHEAD.m)와 같다 — 같은 MakeHuman 얼굴로 만든다
  function dressJesus(body) {
    body.updateMatrixWorld(true);  // 지금 동작 자세 그대로 머리·가슴 뼈에 붙인다 (skeleton.pose()는 뼈 크기가 달라진다)
    const head = body.getObjectByName('Head'), chest = body.getObjectByName('spine_03'), hp = body.worldToLocal(head.getWorldPosition(new THREE.Vector3())), cp = body.worldToLocal(chest.getWorldPosition(new THREE.Vector3()));  // 몸 기준 좌표 (앉은 사람은 몸이 내려가 있다)
    const M = c => new THREE.MeshStandardMaterial({ color: c, roughness: .85 });
    const put = (bone, mesh, base, [x, y, z], rot, sc) => { mesh.position.set(base.x + x, base.y + y, base.z + z); if (rot) mesh.rotation.set(...rot); if (sc) mesh.scale.set(...sc); mesh.frustumCulled = false; body.add(mesh); mesh.updateMatrixWorld(true); bone.attach(mesh); return mesh; };
    const JH = figSrc && figSrc.jesusHead;
    if (JH) {
      // MakeHuman으로 만든 얼굴·눈·머리카락·눈썹·수염(assets/chars/jesus_head.glb, CC0). 두 눈의 가운데를 마네킹의 눈 자리에 맞춰 머리 뼈에 붙이고, 마네킹 머리는 접어 숨긴다
      const h = JH.clone(true), node = h.getObjectByName('jesus_head') || h.children[0], ex = (node && node.userData) || {};
      const k = .078 / (ex.eyeDist || .065), mid = new THREE.Vector3(...(ex.eyeMid || [0, 1.816, .146]));
      h.scale.setScalar(k); h.position.set(hp.x - mid.x * k, hp.y + JHEAD.y - mid.y * k, hp.z + JHEAD.z - mid.z * k);
      h.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
      head.scale.setScalar(.001); head.updateMatrixWorld(true);  // 붙이기 전에 접어야 새 머리 크기가 그대로 남는다
      body.add(h); h.updateMatrixWorld(true); head.attach(h);
    }
    const eyeM = M('#24160f'), browM = M('#3a2618'), lipM = M('#7a4433'), skinM = M('#b4876a'), hairM = new THREE.MeshStandardMaterial({ color: JESUS_HAIR, roughness: .95, side: THREE.DoubleSide });
    // 눈: 짙은 눈동자 위로 살짝 내려온 눈꺼풀 (웃는 눈매) — 새 머리가 없을 때만
    if (!JH) for (const sx of [-1, 1]) {
      put(head, new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), eyeM), hp, [sx * .039, .122, .136], null, [.012, .0075, .006]);
      put(head, new THREE.Mesh(new THREE.TorusGeometry(.013, .0026, 4, 10, Math.PI), browM), hp, [sx * .039, .121, .139], [0, 0, 0], [1, .55, 1]);  // 눈꺼풀 선
      put(head, new THREE.Mesh(new THREE.BoxGeometry(.03, .0045, .006), browM), hp, [sx * .04, .142, .136], [0, 0, sx * -.12]);  // 눈썹 (안쪽이 살짝 올라간 온화한 모양)
    }
    if (!JH) {
    put(head, new THREE.Mesh(new THREE.ConeGeometry(.012, .034, 6), skinM), hp, [0, .097, .147], [Math.PI / 2 + .35, 0, 0]);  // 코
    put(head, new THREE.Mesh(new THREE.TorusGeometry(.019, .0032, 4, 12, Math.PI * .8), lipM), hp, [0, .068, .138], [0, 0, Math.PI + Math.PI * .1]);  // 미소 짓는 입
    // 머리카락: 정수리를 덮고, 옆과 뒤로 어깨까지 내려온다. 가운데 가르마
    put(head, new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * .5), hairM), hp, [0, .105, .03], [-.55, 0, 0], [.118, .172, .142]);  // 정수리 (이마 선은 높고 뒤는 낮게)
    put(head, new THREE.Mesh(new THREE.CylinderGeometry(.1, .118, .21, 18, 1, true, Math.PI * .3, Math.PI * 1.4), hairM), hp, [0, .005, .03], null, [1, 1, 1.05]);  // 옆과 뒤로 어깨까지 (얼굴 쪽은 트였다)
    }
    return JH ? head : null;  // 머리를 접어 둔 뼈(동작이 크기를 되돌려도 매 장면 다시 접는다)
  }
  /* --- 자연스러운 움직임 (사용자 요청 2026-10-14) ---
     서 있는 모습을 사람마다 다르게, 가끔 자세를 바꾸고(팔짱 끼기·풀기, 끄덕임, 옆 사람과 이야기), 고개를 돌려 가까이 있는 나나 말하는 사람을 본다.
     이야기가 정한 동작을 하고 있으면(지금 동작이 기본 동작이 아니면) 건드리지 않는다. 동작 사이는 천천히 섞어 넘어간다 */
  const STAND_IDLES = ['Idle_Loop', 'Idle_Loop', 'Idle_FoldArms_Loop', 'Idle_Loop', 'Idle_FoldArms_Loop'];
  const IDLE_SET = new Set(['Idle_Loop', 'Idle_FoldArms_Loop', 'Sitting_Idle_Loop']);
  const NOLOOK = new Set(['Death01', 'LayToIdle', 'Swim_Fwd_Loop', 'Swim_Idle_Loop', 'Sword_Attack', 'OverhandThrow', 'Hit_Chest', 'Hit_Head', 'Hit_Knockback', 'TreeChopping_Loop', 'PickUp_Table', 'Push_Loop', 'Dance_Loop']);
  const talkState = { speaker: null, until: 0 };
  function autoStep(g, F) {
    const A = F.auto;
    if (F.role === 'jesus' || g === me.g || F.gest) return;
    if (A.clip) {  // 잠깐 다른 자세 중
      if (F.curName !== A.clip) { A.clip = null; return; }  // 그 사이 이야기가 다른 동작을 시켰다
      if (clock > A.until) { A.clip = null; F.play(F.base, .9, IDLE_SET.has(F.base) ? F.speed : 1); A.next = clock + rnd(7, 16); }
      return;
    }
    if (F.curName !== F.base) return;
    const seat = F.base.startsWith('Sitting'), stand = F.base === 'Idle_Loop' || F.base === 'Idle_FoldArms_Loop';
    if (A.nodAt && clock > A.nodAt) {  // 들은 말에 끄덕인다
      A.nodAt = 0; if (stand) { A.clip = 'Yes'; A.until = clock + 1.7; F.play('Yes', .5); }
      return;
    }
    if (clock < A.next) return;
    A.next = clock + rnd(7, 16);
    if (!seat && !stand) return;
    const r = Math.random();
    let c = null;
    if (seat) c = r < .35 ? 'Sitting_Talking_Loop' : null;
    else if (r < .4) c = F.base === 'Idle_FoldArms_Loop' ? 'Idle_Loop' : 'Idle_FoldArms_Loop';  // 팔짱을 끼거나 푼다
    else if (r < .52) c = 'Yes';
    else if (r < .66 && figs.some(o => o !== g && shown(o) && o.position.distanceTo(g.position) < 2.6)) c = 'Idle_Talking_Loop';  // 옆 사람과 이야기
    if (!c) { lookAround(g, F); return; }
    A.clip = c; A.until = clock + (c === 'Yes' ? 1.7 : rnd(3, 6)); F.play(c, .8, c === 'Yes' ? 1 : F.speed);
  }
  // 잠깐 다른 곳을 둘러본다: 옆 사람이나 먼 곳
  function lookAround(g, F) {
    const L = F.look, near = figs.filter(o => o !== g && shown(o) && o.position.distanceTo(g.position) < 6);
    if (near.length && Math.random() < .6) { const o = near[Math.floor(Math.random() * near.length)]; o.getWorldPosition(L.pt); L.pt.y += 1.5 * o.scale.y; }
    else { g.getWorldPosition(L.pt); const a = g.rotation.y + rnd(-1.2, 1.2); L.pt.x += Math.sin(a) * 6; L.pt.z += Math.cos(a) * 6; L.pt.y += rnd(.8, 2.2); }
    L.glance = clock + rnd(1.8, 3.2);
  }
  const _up = new THREE.Vector3(), _rt = new THREE.Vector3(), _hp = new THREE.Vector3(), _tp = new THREE.Vector3(), _ql = new THREE.Quaternion(), _qt = new THREE.Quaternion();
  function turnBone(bone, axis, ang) {
    if (!ang) return;
    bone.getWorldQuaternion(_qt); _ql.setFromAxisAngle(axis, ang).multiply(_qt);
    bone.parent.getWorldQuaternion(_qt).invert(); bone.quaternion.copy(_qt.multiply(_ql)); bone.updateMatrixWorld(true);
  }
  // 고개 돌리기: 말하는 사람 > 잠깐 둘러보기 > 가까이 있는 나. 목이 4할, 머리가 6할을 돌린다. 몸 뒤쪽은 보지 않는다
  function lookStep(g, F, dt) {
    const L = F.look, neck = F.bone('neck_01'), head = F.bone('Head');
    if (!neck || !head || g === me.g) return;
    let want = null;
    if (!F.gest && !NOLOOK.has(F.curName)) {
      head.getWorldPosition(_hp);
      const sp = talkState.speaker;
      if (sp && sp !== g && clock < talkState.until && shown(sp) && sp.position.distanceTo(g.position) < 12) { sp.getWorldPosition(_tp); _tp.y = _hp.y + (sp.scale.y - g.scale.y) * 1.5; want = _tp; }
      else if (clock < L.glance) want = _tp.copy(L.pt);
      else if (camera.position.distanceTo(_hp) < 9) want = _tp.copy(camera.position);
    }
    let ty = 0, tp = 0;
    if (want) {
      g.getWorldQuaternion(_ql).invert(); _tp.sub(_hp).applyQuaternion(_ql);
      const yaw = Math.atan2(_tp.x, _tp.z), pitch = Math.atan2(_tp.y, Math.hypot(_tp.x, _tp.z));
      if (Math.abs(yaw) < 1.8) { ty = clamp(yaw, -1.05, 1.05); tp = clamp(pitch, -.5, .4); }
    }
    const k = 1 - Math.exp(-dt * 3.2);
    L.yaw += (ty - L.yaw) * k; L.pitch += (tp - L.pitch) * k;
    if (Math.abs(L.yaw) < 1e-3 && Math.abs(L.pitch) < 1e-3) return;
    g.updateMatrixWorld(true);
    _up.set(0, 1, 0).transformDirection(g.matrixWorld); _rt.set(1, 0, 0).transformDirection(g.matrixWorld).applyAxisAngle(_up, L.yaw);
    for (const [b, w] of [[neck, .4], [head, .6]]) { turnBone(b, _up, L.yaw * w); turnBone(b, _rt, -L.pitch * w); }
  }
  // 대사가 나오면 말하는 사람이 말하는 동작을 하고, 둘레 사람들은 그를 보고 몇은 끄덕인다.
  // 말하는 사람: figure(…, { name })의 이름이 대사의 이름에 들어 있으면 그 사람, 없으면 화면 가운데 가까이 있는 사람(무리면 몇 명)
  function talk(who, { dur = 4 } = {}) {
    const cands = figs.filter(g => g !== me.g && shown(g) && g.userData.fig.role !== 'jesus');
    if (!cands.length) return;
    const many = /들$|무리|여럿|사람들|지파/.test(who || '');
    let sp = cands.filter(g => g.userData.fig.name && who && who.includes(g.userData.fig.name));
    if (!sp.length) {
      const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
      sp = cands.map(g => { g.getWorldPosition(_tp); _tp.y += 1.4 * g.scale.y; /* 얼굴 높이로 잰다 */ const d = _tp.sub(camera.position); const dist = d.length(); return { g, dist, ang: d.normalize().angleTo(fwd) }; })
        .filter(o => o.dist < 14 && o.ang < .55).sort((a, b) => (a.ang + a.dist * .03) - (b.ang + b.dist * .03)).slice(0, many ? 3 : 1).map(o => o.g);
    }
    if (!sp.length) return;
    for (const g of sp) {
      const F = g.userData.fig; if (F.gest || (F.curName !== F.base && !F.auto.clip)) continue;  // 이야기가 정한 동작 중이면 그대로
      const c = F.base.startsWith('Sitting') ? 'Sitting_Talking_Loop' : 'Idle_Talking_Loop';
      F.auto.clip = c; F.auto.until = clock + dur; F.play(c, .5, F.speed);
    }
    talkState.speaker = sp[0]; talkState.until = clock + dur + .8;
    cands.filter(g => !sp.includes(g) && g.position.distanceTo(sp[0].position) < 7 && Math.random() < .45).slice(0, 2)
      .forEach((g, i) => { g.userData.fig.auto.nodAt = clock + dur * .75 + i * .5; });
  }
  // MakeHuman 머리(assets/chars/mh_head_m·f.glb, CC0, tools/chars/mh_heads.py). 얼굴은 모두 같고(사용자 뜻) 사람마다 피부색·머리카락·수염·그 색이 다르다 (연출: 성경에는 생김새가 없다)
  const SKIN_TONES = [[.92, .86, .8], [.86, .78, .7], [.8, .71, .62], [.72, .62, .53], [.62, .52, .44]];  // 얼굴 텍스처에 곱하는 색 (밝은 올리브 ~ 짙은 갈색)
  const HAIR_COLORS = ['#1b130e', '#2a1c13', '#3b2819', '#553b28', '#7a7470', '#bdb8b0'];  // 검정, 짙은 갈색, 갈색, 밝은 갈색, 희끗, 흰
  let lookN = 0;
  function pickLook(role, sex, look = {}) {
    const n = lookN++, old = role === 'elder';
    const hairs = (figSrc.mhHead[sex].getObjectByName('mh_head_' + sex) || {}).userData?.hairs || [];
    const pool = role === 'boy' ? hairs.filter(h => h.startsWith('hair_short')) : hairs;
    // 얼굴과 체형도 돌려 가며 고른다 (사용자 요청 2026-10-15: 복제인간처럼 보이지 않게). 얼굴 번호는 mh_head의 faces 순서, 체형은 BODY
    const fp = FACE_PICK[sex][role] || FACE_PICK[sex].any, bp = BODY_PICK[sex][role] || BODY_PICK[sex].any;
    const body = bp[n % bp.length], face = sex === 'm' && body === 'heavy' ? 4 : fp[(n * 3 + (n >> 2)) % fp.length];  // 살찐 사람은 살찐 얼굴
    return { skin: (n * 3) % SKIN_TONES.length, hair: pool[(n * 7 + 1) % pool.length], hairColor: old ? HAIR_COLORS[4 + n % 2] : HAIR_COLORS[(n * 5) % 4], face, body,
      beard: sex === 'f' || role === 'boy' || role === 'roman' ? null : old || role === 'goliath' ? 'beard_full' : BEARDS[(n * 5 + (n >> 1)) % BEARDS.length], ...look };
  }
  const BEARDS = ['beard_short', 'beard_trim', 'beard_full', 'beard_goatee', 'beard_trim', 'beard_short'];  // 다듬은 수염이 많고 덥수룩한 수염은 가끔
  // 남자 얼굴: 0 갸름 1 각진 2 젊은 3 나이 든 4 살찐 5 긴 얼굴 6 아프리카계에 가까운 / 여자: 0 고운 1 따뜻한 2 앳된 3 어머니 (tools/chars/mh_build.py HEADS)
  const FACE_PICK = { m: { boy: [2], elder: [3, 5, 3, 4], roman: [1, 0, 6, 2], goliath: [1], any: [0, 1, 5, 2, 6, 1, 0, 5, 3] }, f: { any: [0, 1, 2, 3, 0, 2, 1] } };
  const BODY_PICK = { m: { boy: ['slim'], elder: ['slim', 'avg', 'heavy'], roman: ['muscle', 'avg', 'muscle'], goliath: ['muscle'], king: ['avg', 'heavy'], any: ['avg', 'slim', 'muscle', 'avg', 'heavy', 'slim', 'muscle', 'avg'] },
    f: { any: ['shapely', 'slim', 'shapely', 'avg'] } };
  // 체형: 뼈마다 몸과 옷을 그 겉면 방향으로 이만큼(m) 부풀리거나 줄인다. 옷도 같은 뼈를 따라 함께 움직여 겹이 그대로다 (뼈 크기를 바꾸면 팔·머리까지 찌그러진다)
  const BODY = {
    slim: { spine_01: -.03, spine_02: -.025, spine_03: -.016, pelvis: -.015, clavicle: -.008, upperarm: -.012, lowerarm: -.007, thigh: -.018, calf: -.008, neck_01: -.006 },
    muscle: { spine_03: .05, spine_02: .026, clavicle: .04, upperarm: .035, lowerarm: .018, neck_01: .02, thigh: .026, calf: .014, spine_01: -.01 },
    heavy: { spine_01: .1, spine_02: .085, pelvis: .07, spine_03: .045, clavicle: .025, thigh: .05, calf: .018, upperarm: .028, lowerarm: .015, neck_01: .026 },
    shapely: { spine_01: -.032, spine_02: -.014, pelvis: .026, thigh: .02, spine_03: .016, clavicle: -.006, upperarm: -.007, lowerarm: -.005 } };
  function shapeBody(body, type) {
    const B = BODY[type]; if (!B) return;
    body.traverse(o => {
      if (!o.isSkinnedMesh) return;
      const bones = o.skeleton.bones, arr = new Float32Array(Math.max(1, bones.length));
      const outer = /mantle|veil|shawl|belt|collar|trim|cloak/.test(o.name);  // 겉옷은 조금 더 부풀리고 덜 줄인다 (속옷이 비쳐 나오지 않게)
      bones.forEach((b, i) => { const v = B[b.name] ?? B[b.name.replace(/_[lr]$/, '')] ?? 0; arr[i] = outer ? (v > 0 ? v * 1.15 + .004 : v * .8) : v; });
      const m = o.material, prev = m.onBeforeCompile, N = arr.length;
      m.onBeforeCompile = (sh, r) => {
        if (prev) prev.call(m, sh, r);
        sh.uniforms.uInfl = { value: arr };
        sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\nuniform float uInfl[${N}];`)
          .replace('#include <skinning_vertex>', '#include <skinning_vertex>\ntransformed += normalize(objectNormal) * (skinWeight.x * uInfl[int(skinIndex.x)] + skinWeight.y * uInfl[int(skinIndex.y)] + skinWeight.z * uInfl[int(skinIndex.z)] + skinWeight.w * uInfl[int(skinIndex.w)]);');
      };
      const key = m.customProgramCacheKey.bind(m); m.customProgramCacheKey = () => key() + '|infl' + N;
    });
  }
  const MHEAD = { m: { y: .1, z: .136, eye: .078 }, f: { y: .043, z: .133, eye: .067 } };  // 새 머리의 두 눈 가운데를 둘 자리(머리 뼈 기준)와 눈 사이 거리
  function dressHead(body, sex, spec, L) {
    const src = figSrc.mhHead[sex]; if (!src) return null;
    body.updateMatrixWorld(true);
    const head = body.getObjectByName('Head'), hp = body.worldToLocal(head.getWorldPosition(new THREE.Vector3()));  // 몸 기준 좌표 (앉은 사람은 몸이 내려가 있어 그대로 쓰면 얼굴이 가슴께로 간다)
    const h = src.clone(true), root = h.getObjectByName('mh_head_' + sex) || h, ex = root.userData || {}, A = MHEAD[sex];
    // 얼굴 여러 개 중 하나만 남긴다 (노드 이름 끝의 #번호). 크기는 첫 얼굴의 눈 사이 거리로 같게 하고, 자리는 그 얼굴의 두 눈 가운데로 맞춘다
    const faces = ex.faces || [ex], fi = Math.min(L.face || 0, faces.length - 1);
    for (const c of [...root.children]) if (c.name.includes('#') && !c.name.endsWith('#' + fi)) root.remove(c);
    const k = A.eye / (ex.eyeDist || .064), mid = new THREE.Vector3(...(faces[fi].eyeMid || ex.eyeMid || [0, 1.64, .1]));
    h.scale.setScalar(k); h.position.set(hp.x - mid.x * k, hp.y + A.y - mid.y * k, hp.z + A.z - mid.z * k);
    const covered = spec.wear.some(w => ['headcloth', 'veil', 'helmet'].includes(w));  // 머리를 덮는 것을 쓰면 머리카락은 숨긴다
    const tone = SKIN_TONES[L.skin] || SKIN_TONES[0];
    h.traverse(o => {
      if (!o.isMesh) return;
      o.frustumCulled = false; o.material = o.material.clone();
      const n = o.name.split('#')[0];
      if (n.startsWith('hair_')) o.visible = !covered && n === L.hair;
      if (n.startsWith('beard_')) o.visible = n === L.beard;
      if (n === 'face' || n === 'face_cov') { o.visible = (n === 'face_cov') === covered; o.material.color.setRGB(...tone, THREE.SRGBColorSpace); }
      if (n.startsWith('hair_') || n === 'brows') o.material.color.set(L.hairColor);
      if (n.startsWith('beard_')) o.material.color.set(L.beardColor || L.hairColor);
      if (n === 'lashes') o.material.color.set('#2a1c13');
      if (n === 'eyes') o.material.color.set('#b9ada3');  // 흰자가 너무 밝게 빛나지 않게
    });
    body.traverse(o => { if (o.name.startsWith('Mannequin_head')) o.visible = false; });  // 마네킹 머리만 숨긴다 (머리 뼈를 접으면 머릿수건·투구·면사포도 접힌다)
    body.add(h); h.updateMatrixWorld(true); head.attach(h);
    // 몸의 맨살(손·발·팔)을 얼굴 피부색에 맞춘다
    const avg = ex.skinAvg || [.8, .62, .51];
    const bare = new Set(['M_Main', ...(spec.bare || [])]);
    body.traverse(o => { if (o.isMesh && o.material && bare.has(o.material.name)) o.material.color.setRGB(avg[0] * tone[0], avg[1] * tone[1], avg[2] * tone[2], THREE.SRGBColorSpace); });
    return null;
  }
  const CLOTH = new Set(['tunic_long', 'tunic_short', 'mantle', 'headcloth', 'dress', 'veil', 'sash', 'royal_mantle', 'cloak', 'mantle_j']), _white = new THREE.Color('#ffffff');
  // 옷을 사람마다 다르게 (사용자 요청 2026-10-15: "여자랑 남자 옷이 다 저렇게 똑같아야 하나"). 그 시대 천연 염료 색(아마·양털 그대로, 쪽빛, 꼭두서니 빨강, 황토, 올리브, 잿빛)
  const DYE = {
    tunic: ['#d9ceb2', '#e6dfcf', '#c4b591', '#b9b3a6', '#cdb994', '#a8916a', '#9fb0bf', '#c9a46a'],
    mantle: ['#7a5a3c', '#4e3a2a', '#33507e', '#8e3b2e', '#6b6a3a', '#6a665e', '#3a3028', '#a8916a', '#5b4a6e'],
    headcloth: ['#e3dac4', '#cdb994', '#33507e', '#9a5a3a', '#8c867a', '#e3dac4', '#6b6a3a'],
    belt: ['#5a3d25', '#8e3b2e', '#3a3028', '#6b6a3a', '#a07a3a'],
    dress: ['#ece6d8', '#c9b48e', '#8e3b2e', '#33507e', '#6b7a5a', '#b98a5e', '#7a4f6e', '#d8c7a6'],
    sash: ['#c9a23a', '#9b2a22', '#33507e', '#a8916a', '#5b6e3a'],
    veil: ['#e3dac4', '#cdb994', '#8a6a48', '#5b6e8c', '#9a5a3a', '#ece6d8'],
    stripe: ['#e3dac4', '#3a3028', '#8e3b2e', '#c9a46a', '#33507e'] };
  const VARY = new Set(['man', 'elder', 'shepherd', 'fisherman', 'boy', 'woman', 'woman_veil']);  // 왕·군인·골리앗은 정해진 옷
  let outfitN = 0;
  function dressUp(role, spec, tint, colors) {
    if (!VARY.has(role)) return spec;
    const n = outfitN++, P = (list, k) => list[(n * k + (n >> 1) + k) % list.length], male = spec.body !== 'f';
    const fixed = new Set(Object.keys(colors || {})), t = tint && TINT.find(([w]) => spec.wear.includes(w)); if (t) fixed.add(t[1]);  // 이야기가 정한 색은 그대로
    const wear = new Set(spec.wear), bare = new Set(spec.bare || []), c = {}, pat = {};
    const drop = (w, slot) => { if (!fixed.has(slot)) wear.delete(w); };
    if (male) {
      Object.assign(c, { tunic: P(DYE.tunic, 3), mantle: P(DYE.mantle, 5), headcloth: P(DYE.headcloth, 7), belt: P(DYE.belt, 2) });
      if (role === 'man' && n % 4 === 1 && !fixed.has('tunic')) { wear.delete('tunic_long'); wear.add('tunic_short'); bare.add('under_calf'); }  // 무릎까지 오는 짧은 옷
      if ((role === 'man' || role === 'shepherd') && n % 5 === 2) drop('mantle', 'mantle');                                                   // 겉옷 없이
      if ((role === 'man' || role === 'fisherman' || role === 'boy') && n % 4 === 3) drop('headcloth', 'headcloth');                      // 머릿수건 없이 (머리카락이 보인다)
      if (n % 2 === 0) pat.mantle = { kind: 1, freq: 8 + (n % 4) * 2, width: .12 + (n % 3) * .05, color: P(DYE.stripe, 11) };                // 겉옷 세로 줄무늬
      if (n % 3 === 1) pat.tunic_long = pat.tunic_short = { kind: 2, color: P(DYE.mantle, 13) };                                          // 옷단 띠
      if (n % 4 === 2) pat.headcloth = { kind: 1, freq: 16, width: .1, color: P(DYE.stripe, 9) };
    } else {
      Object.assign(c, { dress: P(DYE.dress, 3), sash: P(DYE.sash, 5), veil: P(DYE.veil, 7), mantle: P(DYE.mantle, 2), tunic: P(DYE.dress, 5), belt: P(DYE.belt, 3) });
      if (role === 'woman') { if (n % 5 === 1 || n % 5 === 3) wear.add('veil'); if (n % 3 === 0) wear.delete('necklace'); if (n % 2) wear.delete('bracelets'); }
      if (role === 'woman_veil' && n % 3 === 1) drop('mantle', 'mantle');
      if (n % 3 === 0) pat.dress = pat.tunic_long = { kind: 2, color: P(DYE.sash, 3) };
      if (n % 4 === 1) pat.veil = { kind: 2, color: P(DYE.stripe, 9) };
      if (n % 4 === 3) pat.mantle = { kind: 1, freq: 10, width: .15, color: P(DYE.stripe, 7) };
    }
    if (role === 'elder' || role === 'boy') { delete c.headcloth; if (role === 'boy') delete c.mantle; }
    for (const k of fixed) delete c[k];
    const under = male || role === 'woman_veil' ? c.tunic : c.dress;  // 소매 밑 팔 부분도 같은 옷 색
    return { ...spec, wear: [...wear], bare: [...bare], colors: { ...(spec.colors || {}), ...c }, under: under || spec.under, pat };
  }
  // 옷 무늬: 원래 모양(뼈를 움직이기 전) 기준이라 옷이 움직여도 무늬가 따라간다. kind 1 세로 줄무늬, 2 아랫단 띠
  function clothPattern(o, pt) {
    o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox;
    const U = new THREE.Vector4(bb.min.y, bb.max.y, (bb.min.x + bb.max.x) / 2, (bb.min.z + bb.max.z) / 2), PU = new THREE.Vector4(pt.kind, pt.freq || 10, pt.width || .15, 0), PC = new THREE.Color(pt.color);
    const m = o.material, prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(m, sh, r);
      Object.assign(sh.uniforms, { uBB2: { value: U }, uPat: { value: PU }, uPC: { value: PC } });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRest2;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest2 = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRest2; uniform vec4 uBB2; uniform vec4 uPat; uniform vec3 uPC;').replace('#include <color_fragment>', `#include <color_fragment>
        { float t = (vRest2.y - uBB2.x) / (uBB2.y - uBB2.x), a = atan(vRest2.x - uBB2.z, vRest2.z - uBB2.w) * uPat.y / 6.2832, s = 0.;
          if (uPat.x != 2.) { float f = fract(a + .5), w = fwidth(a) * 1.5; s += smoothstep(uPat.z + w, uPat.z - w, f); }
          if (uPat.x >= 2.) s += step(.035, t) * step(t, .07) + step(.095, t) * step(t, .11);
          diffuseColor.rgb = mix(diffuseColor.rgb, uPC, clamp(s, 0., 1.) * .9); }`);
    };
    const key = m.customProgramCacheKey.bind(m); m.customProgramCacheKey = () => key() + '|pat';
  }
  function figure(role, { tint, colors, pose = 'stand', clip, scale = 1, visible = false, seatDrop = .3, look, noHead = false, name, mantle = true } = {}) {
    const spec0 = role === 'jesus' ? (figSrc && (mantle ? JESUS : { ...JESUS, wear: JESUS.wear.filter(w => w !== 'mantle_j') })) : figSrc && figSrc.outfits.roles[role];
    if (!spec0) return person(tint || '#4a3c30', { pose, scale, visible });
    const spec = noHead ? spec0 : dressUp(role, spec0, tint, colors);  // 사람마다 옷 색·무늬·조합을 다르게 (내 몸은 그대로)
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
      if (HQ && CLOTH.has(o.name)) {  // 옷감 광택(sheen, 그래픽 1단계): 천 가장자리에 부드럽게 도는 빛. PC만
        const pm = new THREE.MeshPhysicalMaterial(); THREE.MeshStandardMaterial.prototype.copy.call(pm, o.material); pm.defines = { STANDARD: '', PHYSICAL: '' };
        pm.sheen = .7; pm.sheenRoughness = .65; o.material = pm;
      }
      const c = col[o.material.name]; if (c) o.material.color.set(c);
      if (o.material.sheen) o.material.sheenColor.copy(o.material.color).lerp(_white, .4);
      const pt = spec.pat && spec.pat[o.name]; if (pt) clothPattern(o, pt);
      if (o.material.metalness > .5) { o.material.metalness = .35; o.material.roughness = .45; }  // 반사 환경이 없어도 금빛이 보이게
    });
    if (pose === 'seat' && !clip) body.position.y = -seatDrop;  // 의자 높이로 앉는 동작을 땅·배 위에 맞춘다
    g.add(body);
    const mixer = new THREE.AnimationMixer(body);
    // 서 있는 사람마다 서 있는 모습을 다르게 (팔짱 낀 사람도 있다). 박자도 조금씩 다르게
    const standBase = !clip && pose === 'stand' && role !== 'jesus' ? STAND_IDLES[figs.length % STAND_IDLES.length] : null;
    const F = { mixer, role, base: standBase || clip || POSE_CLIP[pose] || 'Idle_Loop', cur: null, curName: '', speed: rnd(.88, 1.08),
      auto: { next: clock + rnd(5, 14), clip: null, until: 0, nodAt: 0 }, look: { yaw: 0, pitch: 0, glance: -9, pt: new THREE.Vector3() },
      play(name, fade = .4, speed = 1) {
        const c = figSrc.clips[name]; if (!c) return;
        const a = mixer.clipAction(c); a.timeScale = speed; if (F.cur === a) return;
        a.reset().play(); if (F.cur && fade) F.cur.crossFadeTo(a, fade, false); else if (F.cur) F.cur.stop();
        F.cur = a; F.curName = name;
      } };
    if (role === 'jesus') { F.play('Idle_Loop', 0); mixer.update(0); F.hideHead = dressJesus(body); body.traverse(o => { if (o.isMesh && o.name === 'mantle_j') F.cloth = mantleStripes(o); }); }
    else if (!noHead && figSrc.mhHead[spec.body === 'f' ? 'f' : 'm']) {
      const sex = spec.body === 'f' ? 'f' : 'm';
      body.traverse(o => { if (o.isMesh && ['beard', 'hair', 'circlet'].includes(o.name)) o.visible = false; });  // 마네킹용 수염·머리카락 대신 MakeHuman 것 (머리띠는 새 머리 위에 떠서 후광처럼 보인다)
      F.play('Idle_Loop', 0); mixer.update(0); const L = pickLook(role, sex, look); F.hideHead = dressHead(body, sex, spec, L); shapeBody(body, L.body); F.cur = null; mixer.stopAllAction();
    }
    F.play(F.base, 0, IDLE_SET.has(F.base) ? F.speed : 1); mixer.update(Math.random() * 3);  // 여러 사람이 같은 박자로 움직이지 않게
    const bones = {}; F.bone = n => bones[n] || (bones[n] = body.getObjectByName(n)); F.name = name;
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
    const g = figure(role, { ...opts, visible: true, noHead: true });  // 내 머리는 보이지 않으니 붙이지 않는다
    if (!g.userData.fig) { g.parent && g.parent.remove(g); return null; }  // 캐릭터가 없으면 몸을 그리지 않는다
    scene.add(g);
    me.g = g; me.head = g.userData.fig.bone('Head'); me.neck = g.userData.fig.bone('neck_01'); me.pose = ''; me.lx = env.camX; me.lz = env.camZ; me.yaw = env.camY + Math.PI;
    return g;
  }
  const _e = new THREE.Vector3(), _cf = new THREE.Vector3();
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
    camera.updateMatrixWorld(); camera.getWorldDirection(_cf);  // 머리 앞이 아니라 눈이 보는 쪽으로 옮긴다 (고개를 돌려도 내 어깨가 눈앞을 가리지 않게)
    const fl = Math.hypot(_cf.x, _cf.z) || 1, fx = _cf.x / fl, fz = _cf.z / fl, s = g.scale.x;
    // 눈 = 머리 뼈 + 위로 0.11. 카메라를 머리보다 0.24 앞에 두어, 아래를 보면 배에 가리지 않고 다리와 발이 보이게 한다
    const fwd = me.pose === 'sit' ? .2 : .24;
    g.position.x += cx - (_e.x + fx * fwd * s); g.position.z += cz - (_e.z + fz * fwd * s); g.position.y += cy - (_e.y + .11 * s);
    me.head.scale.setScalar(.001); me.neck.scale.setScalar(.35); g.updateMatrixWorld(true);
  }
  const stepFigs = dt => {
    for (const g of figs) if (shown(g)) { const F = g.userData.fig; autoStep(g, F); if (F.cloth) stepCloth(g, F.cloth, dt); F.mixer.update(dt); if (F.hideHead) F.hideHead.scale.setScalar(.001); lookStep(g, F, dt); if (F.gest) applyGesture(g, F, dt); }
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
  const OPEN_HAND = { reach: ['r'], show: ['l', 'r'], give: ['l', 'r'], lift: ['l', 'r'] }, _qOpen = new THREE.Quaternion();
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
    // 손을 내밀 때는 손가락을 편다(쉬는 동작은 주먹을 쥐고 있다)
    const open = OPEN_HAND[name]; if (open) for (const sd of open) for (const f of ['index', 'middle', 'ring', 'pinky', 'thumb']) for (const n of ['01', '02', '03']) { const bn = F.bone(`${f}_${n}_${sd}`); if (bn) bn.quaternion.slerp(_qOpen, w * (f === 'thumb' ? .5 : .9)); }
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
    // 길 비키기: g.userData.makeWay([사람, ...])를 부르면, 카메라(당신)와 그 사람들이 가까이 올 때 옆으로 비켜선다(뚫고 지나가지 않게)
    items.forEach(o => { o.hx = o.x; o.hz = o.z; o.ox = 0; o.oz = 0; });
    let movers = null; const _mv = new THREE.Vector3();
    g.userData.makeWay = (list, r = 1.3) => { movers = list ? [...list] : null; g.userData.wayR = r; };
    frameFns.push(dt => {
      if (!movers || !shown(g)) return;
      const RW = g.userData.wayR, pts = [[env.camX, env.camZ]];
      for (const m of movers) if (m && m.visible) { m.getWorldPosition(_mv); pts.push([_mv.x, _mv.z]); }
      let moved = false; const k = Math.min(1, dt * 4);
      for (const o of items) {
        let tx = 0, tz = 0;
        for (const [px, pz] of pts) { const dx = o.hx - px, dz = o.hz - pz, dd = Math.hypot(dx, dz); if (dd < RW) { const f = (RW - dd) / (dd || .01); tx += dx * f; tz += dz * f; } }
        const nx = o.ox + (tx - o.ox) * k, nz = o.oz + (tz - o.oz) * k;
        if (Math.abs(nx - o.ox) + Math.abs(nz - o.oz) > 1e-4) { o.ox = nx; o.oz = nz; o.x = o.hx + nx; o.z = o.hz + nz; if (height) o.y = height(o.x, o.z); moved = true; }
      }
      if (moved) draw();
    });
    return g;
  }
  const walkers = [];
  function walker(g, { height, pace = 11, amp = .09, lean = .22, standLean = .3, noRun = false } = {}) {  // noRun: 빨라도 달리지 않고 걷는다(예수님)
    const F = g.userData.fig; if (F) { amp = 0; lean = 0; standLean = 0; }  // 캐릭터는 걷기 동작이 몸을 움직인다
    const o = { g, height: height || (() => 0), pace, amp, lean, standLean, state: 'idle', t0: 0, dur: 1, from: new THREE.Vector3(), to: new THREE.Vector3(), res: null, seed: Math.random() * 6 };
    o.go = (from, to, dur) => {
      if (from) o.from.copy(from); if (to) o.to.copy(to); o.dur = dur || o.dur; g.visible = true; o.state = 'run'; o.t0 = clock; g.position.copy(o.from);
      if (F) { const sp = Math.hypot(o.to.x - o.from.x, o.to.z - o.from.z) / o.dur / g.scale.x, run = !noRun && (sp > 2.4 || pace >= 10); o.ts = clamp(sp / (run ? 3 : 1.25), .6, 1.7); F.play(run ? 'Jog_Fwd_Loop' : 'Walk_Loop', .4, o.ts); }
      o.face = null;
      return new Promise(r => { o.res = r; });
    };
    o.idle = () => { o.state = 'idle'; };
    walkers.push(o); return o;
  }
  // 지금 방향에서 원하는 방향으로 조금씩 돈다 (한 번에 휙 돌지 않게)
  const turnToward = (cur, want, f) => { let d = want - cur; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return cur + d * f; };
  function stepWalkers() {
    walkers.forEach(o => {
      const F = o.g.userData.fig;
      if (o.state === 'run') {
        // 천천히 걸음을 떼고 천천히 멈춘다. 걷기 동작의 빠르기도 그에 맞춘다
        const k = clamp((clock - o.t0) / o.dur, 0, 1), e = F ? k * k * (3 - 2 * k) : 1 - (1 - k) * (1 - k);
        const x = lerp(o.from.x, o.to.x, e), z = lerp(o.from.z, o.to.z, e);
        o.g.position.set(x, o.height(x, z) + Math.abs(Math.sin(clock * o.pace)) * o.amp * (1 - k * .5), z);
        o.g.rotation.x = o.lean;
        const dir = Math.atan2(o.to.x - o.from.x, o.to.z - o.from.z);
        o.g.rotation.y = F ? turnToward(o.g.rotation.y, dir, .16) : dir;
        if (F && F.cur && o.ts && (F.curName === 'Walk_Loop' || F.curName === 'Jog_Fwd_Loop')) F.cur.timeScale = o.ts * clamp(6 * k * (1 - k), .35, 1.5);
        if (k >= 1) {
          o.state = 'stand'; F && F.play(F.base, .6, IDLE_SET.has(F.base) ? F.speed : 1);
          const face = Math.atan2(camera.position.x - o.g.position.x, camera.position.z - o.g.position.z);
          if (F) { o.face = face; o.faceSet = o.g.rotation.y; } else o.g.rotation.y = face;
          const r = o.res; o.res = null; r && r();
        }
      } else if (o.state === 'stand') {
        // 멈춘 뒤 당신 쪽으로 천천히 돌아선다. 그 사이 이야기가 방향을 정하면 그것을 따른다
        if (o.face != null) {
          if (Math.abs(o.g.rotation.y - o.faceSet) > 1e-4) o.face = null;
          else { o.g.rotation.y = o.faceSet = turnToward(o.g.rotation.y, o.face, .07); if (Math.abs(turnToward(0, o.face - o.g.rotation.y, 1)) < .01) o.face = null; }
        }
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
  // 동물 털 (사용자: 동물을 실사처럼, 2026-10-14). 양·숫양은 곱슬한 양털, 나머지는 짧은 털결. 모델 크기에 맞춰 세 방향에서 입혀(삼면 투영) 걸어도 무늬가 몸에 붙어 있다
  TEX.wool = () => TEX._wool || (TEX._wool = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = 'rgb(205,200,190)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 650; i++) { const x = Math.random() * w, y = Math.random() * h, r = rnd(4, 9), l = rnd(215, 255) | 0; wrapDraw(g, w, h, x, y, r + 2, (px, py) => { g.fillStyle = `rgb(${l},${l - 4},${l - 12})`; g.beginPath(); g.arc(px, py, r, 0, 7); g.fill(); g.strokeStyle = 'rgba(110,100,85,.7)'; g.lineWidth = 1.5; g.beginPath(); g.arc(px + .6, py + .8, r * .8, .3, 3.6); g.stroke(); }); }  // 곱슬한 털 뭉치
  }));
  TEX.hair = () => TEX._hair || (TEX._hair = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = 'rgb(222,220,215)'; g.fillRect(0, 0, w, h);
    blots(g, w, h, 40, 10, 30, () => `rgba(${Math.random() < .5 ? '180,176,170' : '255,255,252'},${rnd(.2, .4).toFixed(2)})`);
    for (let i = 0; i < 7000; i++) { const x = Math.random() * w, y = Math.random() * h, L = rnd(4, 10), a = 1.57 + rnd(-.35, .35), l = rnd(150, 255) | 0; g.strokeStyle = `rgba(${l},${l - 3},${l - 8},.55)`; g.lineWidth = rnd(.6, 1.3); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke(); }  // 아래로 누운 짧은 털
  }));
  function furify(m, geo, kind) {
    if (!['body', 'light', 'patch'].includes(m.name) && kind) return m;
    const wool = kind === 'sheep' || kind === 'ram';
    geo.computeBoundingBox(); const sz = geo.boundingBox.getSize(new THREE.Vector3()), D = Math.max(sz.x, sz.y, sz.z) || 1, sc = ((wool ? 4.5 : 9) / D).toFixed(4);
    m.map = wool ? TEX.wool() : TEX.hair(); m.roughness = 1; m.flatShading = false;
    m.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFP; varying vec3 vFN;').replace('#include <begin_vertex>', `#include <begin_vertex>\nvFP = position * ${sc}; vFN = normal;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFP; varying vec3 vFN;').replace('#include <map_fragment>', `{ vec3 bw = pow(abs(normalize(vFN)), vec3(4.)); bw /= (bw.x + bw.y + bw.z);
        diffuseColor *= texture2D(map, vFP.zy) * bw.x + texture2D(map, vFP.xz) * bw.y + texture2D(map, vFP.xy) * bw.z; }`);
    };
    m.customProgramCacheKey = () => 'fur' + (wool ? 'w' : 'h') + sc;
    m.needsUpdate = true;
    return m;
  }
  // 가축 떼: 동물 모델이 있으면 그것으로, 없으면 단순한 모양으로
  const herdMixers = [];
  function herd(kind, opts = {}) {
    const A = figSrc && figSrc.animals && figSrc.animals[kind];
    if (A && A.poses.length) return herdModel(A, { ...opts, kind });
    const alt = { ram: ['goat', '#cfc4b0'], colt: ['donkey'], pig: ['ox', '#2b2523'] }[kind];  // 단순한 모양에 없는 종류
    return alt && !ANIMALS[kind] ? herdSimple(alt[0], { color: alt[1], ...opts }) : herdSimple(kind, opts);
  }
  function herdModel(A, { n, center, rx = 15, rz = 12, height, scale = [.85, 1.15], placer, color, kind } = {}) {
    const g = new THREE.Group(); g.position.set(center[0], 0, center[1]);
    const items = [];
    for (let i = 0; i < n; i++) {
      let x, z; if (placer) [x, z] = placer(i); else { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()); x = Math.cos(a) * r * rx; z = Math.sin(a) * r * rz; }
      items.push({ x, z, ry: rnd(0, 6.3), s: rnd(scale[0], scale[1]), tint: rnd(.82, 1.05), on: true, pose: Math.floor(Math.random() * A.poses.length) });
    }
    const body = color ? new THREE.Color(color) : null;
    const mat = (m, geo) => { const c = m.clone(); if (body && m.name === 'body') c.color.copy(body); return geo ? furify(c, geo, kind) : c; };
    const ground = o => height ? height(center[0] + o.x, center[1] + o.z) : 0;
    let draw;
    if (n <= 3) {  // 한두 마리는 실제로 숨 쉬고 고개를 움직인다
      items.forEach(o => {
        o.obj = SkeletonUtils.clone(A.rig); o.base = o.obj.scale.x; o.obj.traverse(m => { if (m.isMesh) { m.material = mat(m.material, m.geometry); m.frustumCulled = false; } });
        o.mixer = new THREE.AnimationMixer(o.obj); if (A.clips.Idle) { o.act = o.mixer.clipAction(A.clips.Idle); o.act.play(); } o.mixer.update(rnd(0, 5));
        g.add(o.obj); herdMixers.push(o);
      });
      draw = () => items.forEach(o => { o.obj.position.set(o.x, ground(o), o.z); o.obj.rotation.set(0, o.ry, 0); o.obj.scale.setScalar(o.s * o.base); o.obj.visible = o.on; });  // 모델 자체의 크기(뼈대 노드의 scale)를 지킨다
    } else {  // 무리는 세 가지 굳힌 자세를 한꺼번에 그린다
      const tmp = new THREE.Color(), base = new THREE.Object3D();
      const buckets = A.poses.map((parts, p) => {
        const idx = items.map((o, i) => o.pose === p ? i : -1).filter(i => i >= 0);
        return { idx, meshes: parts.map(pt => { const m = new THREE.InstancedMesh(pt.geo, mat(pt.mat, pt.geo), Math.max(1, idx.length)); m.frustumCulled = false; if (!idx.length) m.count = 0; g.add(m); return m; }) };
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
    // 한두 마리만: 동작 바꾸기(Idle, Walk, Run). 나귀를 걷게 할 때 쓴다
    g.userData.play = (name, speed = 1) => items.forEach(o => { const c = A.clips[name]; if (!o.mixer || !c) return; const a = o.mixer.clipAction(c); a.timeScale = speed; if (o.act === a) return; a.reset().play(); if (o.act) o.act.crossFadeTo(a, .35, false); o.act = a; });
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
      if (f.owner) f.g.visible = shown(f.owner);  // 제단을 숨기면 그 위 장작도 숨긴다 (장작만 공중에 떠 보이던 것)
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
    TEX.ripple = TEX.ripple || canvasTex(256, 256, (g, w, h) => {  // 이어 붙여도 이음매 없는 잔물결 높이 (정수 주파수 사인의 합)
      const img = g.createImageData(w, h), W = [[1, 2, .9], [3, 1, .6], [2, 5, .35], [5, 3, .3], [7, 2, .2], [4, 7, .18], [9, 6, .12], [11, 13, .08]].map(([a, b2, am]) => [a, b2, am, Math.random() * 6.28]);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (const [a, b2, am, ph] of W) v += am * Math.sin((a * x / w + b2 * y / h) * 6.283 + ph); const l = (v / 2.6 * .5 + .5) * 255, i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = l; img.data[i + 3] = 255; }
      g.putImageData(img, 0, 0);
    }, { srgb: false });
    TEX.rippleN = TEX.rippleN || normalFrom(TEX.ripple, 4);
    const u = { uRip: { value: TEX.rippleN }, uBoat: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uBoatL: { value: [0, 0, 0, 0] }, uBoatN: { value: 0 }, uTime: { value: 0 }, uAmp: { value: 0 }, uY: { value: y }, uDeep: { value: new THREE.Color(deep) }, uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSun: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uFog: { value: new THREE.Color() }, uFogD: { value: .006 }, uCam: { value: new THREE.Vector3() }, uStars: { value: 0 } };
    const wl = WAVES.map(w => `h += ${w[3].toFixed(2)} * sin(dot(vec2(${w[0].toFixed(2)}, ${w[1].toFixed(2)}), p) * ${w[2].toFixed(2)} + uTime * ${w[4].toFixed(2)}); d += ${w[3].toFixed(2)} * ${w[2].toFixed(2)} * cos(dot(vec2(${w[0].toFixed(2)}, ${w[1].toFixed(2)}), p) * ${w[2].toFixed(2)} + uTime * ${w[4].toFixed(2)}) * vec2(${w[0].toFixed(2)}, ${w[1].toFixed(2)});`).join('\n');
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: `uniform float uTime, uAmp, uY; varying vec3 vW; varying vec3 vN;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.); vec2 p = w.xz; float h = 0.; vec2 d = vec2(0.);
          ${wl}
          float k = .06 + uAmp; w.y = uY + h * k; vN = normalize(vec3(-d.x * k, 1., -d.y * k)); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform vec3 uDeep, uTop, uHorizon, uSun, uSunDir, uFog, uCam; uniform float uFogD, uTime, uStars; uniform sampler2D uRip; varying vec3 vW; varying vec3 vN;
        uniform vec4 uBoat[4]; uniform float uBoatL[4]; uniform int uBoatN;
        void main(){
          for (int i = 0; i < 4; i++) { if (i >= uBoatN) break;
            vec2 d = vW.xz - uBoat[i].xy; float lx = d.x * uBoat[i].z - d.y * uBoat[i].w, lz = d.x * uBoat[i].w + d.y * uBoat[i].z;
            float az = abs(lz), hw = ${BOAT_HW.toFixed(2)}, e = (az - uBoatL[i]) / ${BOAT_END.toFixed(2)};
            if ((az <= uBoatL[i] && abs(lx) < hw) || (az > uBoatL[i] && e * e + (lx / hw) * (lx / hw) < 1.)) discard;  // 배 안에는 물이 없다
          }
          vec3 v = normalize(uCam - vW);
          vec2 r1 = texture2D(uRip, vW.xz * .045 + uTime * vec2(.012, .007)).xy * 2. - 1., r2 = texture2D(uRip, vW.xz * .13 - uTime * vec2(.01, .019)).xy * 2. - 1., r3 = texture2D(uRip, vW.xz * .41 + uTime * vec2(-.03, .02)).xy * 2. - 1.;
          float dist = length(uCam - vW), fine = 1. - smoothstep(20., 120., dist);  // 멀어질수록 잔물결은 줄인다 (반짝이가 지글거리지 않게)
          vec2 rip = r1 * .55 + r2 * .35 * (.4 + .6 * fine) + r3 * .22 * fine;
          vec3 n = normalize(vN + vec3(rip.x, 0., rip.y) * .32);
          float fr = pow(1. - max(dot(v, n), 0.), 4.) * .9 + .05;
          vec3 r = reflect(-v, n); vec3 sky = mix(uHorizon, uTop, clamp(r.y * 1.6, 0., 1.));
          vec3 deep = uDeep * (.35 + .65 * length(uHorizon)), shallow = deep * vec3(1.15, 1.35, 1.25) + vec3(.02, .04, .035);
          vec3 col = mix(mix(shallow, deep, smoothstep(2., 30., dist)), sky, fr);  // 가까운 물은 조금 맑고 푸르다
          vec3 sd = normalize(uSunDir); col += uSun * pow(max(dot(r, sd), 0.), 260.) * 5.5 * step(-.02, sd.y);  // 햇빛 반짝임
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
    const body = new THREE.Mesh(geo, surfMat('goat', color, { side: THREE.DoubleSide })); g.add(body);  // 염소털 천막 (짠 결과 띠)
    if (open) { const door = new THREE.Mesh(new THREE.PlaneGeometry(w * .3, h * .55), new THREE.MeshBasicMaterial({ color: '#0a0806' })); door.position.set(0, h * .28, d / 2 + .01); g.add(door); g.userData.door = door; }
    R().add(g); return g;
  }

  /* --- 돌 제단 --- */
  function altar({ at = [0, 0, 0], w = 1.6, h = .9 } = {}) {
    const g = new THREE.Group(); g.position.set(at[0], at[1], at[2]);
    const m = surfMat('rock', '#8b7a66', { flatShading: true });
    for (let y = 0; y < 3; y++) for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + y * .4, s = new THREE.Mesh(new THREE.DodecahedronGeometry(.26, 0), m);
      s.position.set(Math.cos(a) * w * .38, .16 + y * h / 3, Math.sin(a) * w * .3); s.scale.set(rnd(.9, 1.3), rnd(.7, 1), rnd(.9, 1.2)); s.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3)); g.add(s);
    }
    const top = new THREE.Mesh(new THREE.CylinderGeometry(w * .45, w * .5, .2, 10), m); top.position.y = h; g.add(top);
    R().add(g);
    g.userData.fire = fire([at[0], at[1] + h + .1, at[2]], { ring: false, smoke: true, size: 1.4, light: 10 }); g.userData.fire.owner = g;
    return g;
  }

  /* --- 마을과 건물, 나무, 십자가, 무덤 (여러 인물이 같이 쓴다) --- */
  const MAT = {};
  const mat = (c, o) => { const k = c + (o ? JSON.stringify(o) : ''); return MAT[k] || (MAT[k] = new THREE.MeshStandardMaterial({ color: c, roughness: 1, ...(o || {}) })); };
  // 건물 질감 (2026-10-14): 다듬은 돌, 흙벽 회반죽, 거친 바위, 나무, 염소털 천. 밝은 회색 무늬를 그려 두고 색(color)을 곱한다.
  // UV 대신 물체 자리로 세 방향에서 비춰 입힌다(삼면 투영): 상자·원기둥·밀어낸 모양 어디에나 크기에 맞게 붙는다. SURF_M: 그림 한 장이 덮는 길이(m)
  TEX.stone = () => TEX._stone || (TEX._stone = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = 'rgb(150,145,138)'; g.fillRect(0, 0, w, h);  // 줄눈
    const rows = 8, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rnd(0, 120);
      while (x < w) {
        const bw = rnd(90, 190), l = rnd(205, 248) | 0;
        g.fillStyle = `rgb(${l},${l - 4},${l - 10})`; const rr = (x0, y0, ww, hh) => { g.beginPath(); if (g.roundRect) g.roundRect(x0, y0, ww, hh, 5); else g.rect(x0, y0, ww, hh); g.fill(); };
        rr(x + 2.5, r * rh + 2.5, bw - 5, rh - 5); if (x + bw > w) rr(x - w + 2.5, r * rh + 2.5, bw - 5, rh - 5);
        const sh = g.createLinearGradient(0, r * rh, 0, (r + 1) * rh); sh.addColorStop(0, 'rgba(255,255,255,.18)'); sh.addColorStop(1, 'rgba(0,0,0,.14)'); g.fillStyle = sh; g.fillRect(x + 2.5, r * rh + 2.5, bw - 5, rh - 5);  // 돌마다 위는 밝고 아래는 어둡게
        x += bw;
      }
    }
    blots(g, w, h, 120, 3, 12, () => `rgba(${Math.random() < .5 ? '120,115,108' : '255,255,250'},${rnd(.15, .35).toFixed(2)})`);  // 얼룩과 쪼은 자국
    for (let i = 0; i < 6000; i++) { const l = rnd(150, 255) | 0; g.fillStyle = `rgba(${l},${l},${l},.35)`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
  }));
  TEX.plaster = () => TEX._plaster || (TEX._plaster = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = 'rgb(236,233,226)'; g.fillRect(0, 0, w, h);
    blots(g, w, h, 90, 20, 70, () => Math.random() < .55 ? `rgba(196,190,180,${rnd(.2, .45).toFixed(2)})` : `rgba(255,255,252,${rnd(.2, .4).toFixed(2)})`);  // 손으로 바른 흙의 얼룩
    for (let i = 0; i < 10; i++) { const x = Math.random() * w, l = rnd(.03, .07); const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, `rgba(120,110,95,${l})`); gr.addColorStop(1, 'rgba(120,110,95,0)'); g.fillStyle = gr; g.fillRect(x, 0, rnd(16, 40), h * rnd(.2, .6)); }  // 옅은 빗물 자국
    blots(g, w, h, 160, 6, 24, () => `rgba(${Math.random() < .5 ? '175,168,155' : '255,253,248'},${rnd(.2, .45).toFixed(2)})`);  // 흙손 자국
    g.strokeStyle = 'rgba(95,85,72,.55)'; g.lineWidth = 1.2;
    for (let i = 0; i < 14; i++) { let x = Math.random() * w, y = Math.random() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 9; k++) { x += rnd(-9, 9); y += rnd(3, 11); g.lineTo(x, y); } g.stroke(); }  // 갈라진 금
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '160,140,100' : '255,250,235'},.5)`; g.fillRect(Math.random() * w, Math.random() * h, rnd(2, 6), 1); }  // 짚 부스러기
  }));
  TEX.rock = () => TEX._rock || (TEX._rock = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = 'rgb(228,226,222)'; g.fillRect(0, 0, w, h);
    blots(g, w, h, 60, 30, 110, () => Math.random() < .5 ? `rgba(170,165,158,${rnd(.25, .5).toFixed(2)})` : `rgba(255,255,255,${rnd(.2, .4).toFixed(2)})`);
    blots(g, w, h, 300, 3, 14, () => `rgba(${Math.random() < .6 ? '140,135,128' : '250,250,245'},${rnd(.2, .45).toFixed(2)})`);
    g.strokeStyle = 'rgba(90,85,78,.6)'; g.lineWidth = 1.6;
    for (let i = 0; i < 22; i++) { let x = Math.random() * w, y = Math.random() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 7; k++) { x += rnd(-14, 14); y += rnd(-14, 14); g.lineTo(x, y); } g.stroke(); }  // 바위 금
  }));
  TEX.wood = () => TEX._wood || (TEX._wood = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = 'rgb(230,226,220)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { const y0 = Math.random() * h, l = rnd(150, 225) | 0; g.strokeStyle = `rgba(${l},${l - 8},${l - 18},.7)`; g.lineWidth = rnd(1, 3); g.beginPath(); g.moveTo(0, y0); for (let x = 0; x <= w; x += 16) g.lineTo(x, y0 + Math.sin(x * .03 + i) * 3); g.stroke(); }  // 나뭇결
    for (let i = 0; i < 5; i++) { const x = Math.random() * w, y = Math.random() * h; g.strokeStyle = 'rgba(110,95,80,.6)'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(x, y, rnd(6, 12), rnd(3, 5), 0, 0, 7); g.stroke(); }  // 옹이
  }));
  TEX.goat = () => TEX._goat || (TEX._goat = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = 'rgb(225,222,218)'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(${Math.random() < .5 ? '170,165,160' : '255,255,255'},${rnd(.15, .4).toFixed(2)})`; g.fillRect(0, y, w, 1); }  // 짠 결
    for (const y of [40, 52, 170, 182]) { g.fillStyle = 'rgba(120,112,105,.55)'; g.fillRect(0, y, w, 6); }  // 띠
    for (let i = 0; i < 1500; i++) { g.fillStyle = 'rgba(110,105,100,.35)'; g.fillRect(Math.random() * w, Math.random() * h, rnd(2, 5), 1); }  // 털
  }));
  const SURF_M = { stone: 2.4, plaster: 3, rock: 3.2, wood: 1, goat: 2 };
  function surfMat(kind, color, o = {}) {
    const k = 'surf' + kind + color + JSON.stringify(o); if (MAT[k]) return MAT[k];
    const m = new THREE.MeshStandardMaterial({ color, roughness: 1, map: TEX[kind](), ...o }), sc = (1 / SURF_M[kind]).toFixed(4);
    m.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTpP; varying vec3 vTpN;')
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vTpP = transformed; vTpP.y += modelMatrix[3].y; vTpN = objectNormal;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTpP; varying vec3 vTpN;')
        .replace('#include <map_fragment>', `{ vec3 bw = pow(abs(normalize(vTpN)), vec3(4.)); bw /= (bw.x + bw.y + bw.z); vec3 p = vTpP * ${sc};
          vec4 tx = texture2D(map, p.zy) * bw.x + texture2D(map, p.xz) * bw.y + texture2D(map, p.xy) * bw.z; diffuseColor *= tx; }`);
    };
    m.customProgramCacheKey = () => 'tri' + kind;
    return (MAT[k] = m);
  }
  // 흙벽돌 집: 앞(+z)에 문, 평평한 지붕, 바깥 계단(지붕으로). 안에서도 벽이 보인다
  function house({ at = [0, 0, 0], w = 5, d = 4, h = 2.8, ry = 0, color = '#a48a69', door = true, stairs = false, roof = true, win = true } = {}) {
    const g = new THREE.Group(); g.position.set(at[0], at[1], at[2]); g.rotation.y = ry;
    const m = surfMat('plaster', color), t = .3, dw = 1.05;
    box(w, h, t, null, 0, h / 2, -d / 2, g, m); box(t, h, d, null, -w / 2, h / 2, 0, g, m); box(t, h, d, null, w / 2, h / 2, 0, g, m);
    if (door) { box((w - dw) / 2, h, t, null, -(w + dw) / 4, h / 2, d / 2, g, m); box((w - dw) / 2, h, t, null, (w + dw) / 4, h / 2, d / 2, g, m); box(dw, h - 2, t, null, 0, 2 + (h - 2) / 2, d / 2, g, m); }
    else box(w, h, t, null, 0, h / 2, d / 2, g, m);
    if (win) [-1, 1].forEach(sx => box(.5, .4, .05, '#1a130e', sx * w * .28, h * .66, d / 2 + .16, g));
    if (roof) { box(w + .3, .22, d + .3, null, 0, h + .11, 0, g, surfMat('plaster', '#6e5a44')); box(w + .3, .35, .12, null, 0, h + .38, d / 2 + .1, g, m); }
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
    const m = surfMat('plaster', color);
    box(w, .1, d, null, 0, -.05, 0, g, surfMat('stone', floor));
    box(w, h, .3, null, 0, h / 2, -d / 2, g, m); box(.3, h, d, null, -w / 2, h / 2, 0, g, m); box(.3, h, d, null, w / 2, h / 2, 0, g, m);
    if (door != null && door !== false) { const dw = 1.2; box((w - dw) / 2, h, .3, null, -(w + dw) / 4 + door, h / 2, d / 2, g, m); box((w - dw) / 2, h, .3, null, (w + dw) / 4 + door, h / 2, d / 2, g, m); box(dw, h - 2.1, .3, null, door, 2.1 + (h - 2.1) / 2, d / 2, g, m); }
    else box(w, h, .3, null, 0, h / 2, d / 2, g, m);
    if (ceiling) box(w, .3, d, null, 0, h, 0, g, m);
    g.userData.lights = lamps.map(([x, z, y = .6]) => { const L = new THREE.PointLight('#ffb070', 3, 9, 2); L.position.set(x, y, z); g.add(L); lamp({ at: [x, y - .15, z], parent: g, light: L }); return L; });  // 진흙 등잔
    R().add(g); addFloor(at[0], at[2], w, d, at[1], g); return g;
  }
  // 성벽: from → to, 망대와 성가퀴
  function cityWall({ from, to, h = 9, t = 2.4, color = '#b7a07c', towers = 40, height } = {}) {
    const g = new THREE.Group(), m = surfMat('stone', color);
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
    const stone = surfMat('stone', '#d9ccb0'), white = surfMat('stone', '#efe8d8'), gold = mat('#c9a23a', { metalness: .4, roughness: .45 });
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
  // 나무: 감람나무, 무화과나무, 위성류, 마른 나무, 종려나무 (사용자가 보낸 사진처럼 가지와 잎이 있는 나무).
  // 줄기·가지는 휘어지며 가늘어지는 관, 잎은 잎 그림을 붙인 판 여러 장(빛을 받는 방향은 나무 바깥쪽). 종류마다 세 가지 모양을 만들어 돌려 쓴다. 잎은 바람에 흔들린다
  const TREE = {
    olive: { trunk: '#6b5d4c', leaf: '#93a07c', h: 2.4, r: .3, branches: 5, spread: 1.8, rise: .9, crown: 2.4, leafS: 1.15, leafTex: 'olive', twist: .38, fill: 16 },
    fig: { trunk: '#8a7a66', leaf: '#5d7a3e', h: 2.1, r: .24, branches: 5, spread: 2.1, rise: .75, crown: 2.5, leafS: 1.35, leafTex: 'fig', twist: .16, fill: 18 },
    palm: { trunk: '#7a6248', leaf: '#6b8a44', h: 8, palm: true },
    tamarisk: { trunk: '#64543f', leaf: '#97a387', h: 3.2, r: .2, branches: 6, spread: 1.6, rise: 1.4, crown: 2.3, leafS: 1.25, leafTex: 'tamarisk', twist: .22, fill: 22, droop: true },
    bare: { trunk: '#5a4a3a', h: 2.3, r: .2, branches: 4, spread: 1.4, rise: 1.1, crown: 0, twist: .32, bare: true }
  };
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  function mergeGeo(list) {
    let nv = 0, ni = 0; for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), I = new Uint32Array(ni); let ov = 0, oi = 0;
    for (const g of list) {
      P.set(g.attributes.position.array, ov * 3); N.set(g.attributes.normal.array, ov * 3); U.set(g.attributes.uv.array, ov * 2);
      const ix = g.index.array; for (let k = 0; k < ix.length; k++) I[oi + k] = ix[k] + ov;
      ov += g.attributes.position.count; oi += ix.length; g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); out.setAttribute('uv', new THREE.BufferAttribute(U, 2)); out.setIndex(new THREE.BufferAttribute(I, 1));
    return out;
  }
  function tubeGeo(a, b, r0, r1, seg = 7) {
    const len = a.distanceTo(b), g = new THREE.CylinderGeometry(r1, r0, len, seg, 2, true);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len * .9);
    g.translate(0, len / 2, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize())); g.translate(a.x, a.y, a.z);
    return g;
  }
  // 바람에 흔들림: 정점 셰이더에서 높이(weight)만큼 옆으로 민다. 사람마다 다른 자리라 흔들림이 어긋난다
  function sway(m, amt, weight) {
    m.onBeforeCompile = sh => {
      sh.uniforms.uWind = windU;
      sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 ip = instanceMatrix * vec4(0., 0., 0., 1.);
        #else
          vec4 ip = vec4(0.);
        #endif
        float sw = sin(uWind * 1.7 + ip.x * .37 + ip.z * .29 + position.x) + sin(uWind * 2.9 + ip.x * .11 - ip.z * .23) * .5;
        transformed.xz += vec2(sw, sw * .6) * ${amt.toFixed(3)} * (${weight});`);
    };
    m.customProgramCacheKey = () => 'sway' + amt + weight;
    return m;
  }
  // 잎 그림: 잎 여러 장이 모인 덩어리 (투명한 바탕)
  function leafTex(kind, base) {
    const key = 'leaf_' + kind;
    return TEX[key] || (TEX[key] = cutoutTex(256, 256, (g, w, h) => {
      const c0 = new THREE.Color(base), hsl = {}; c0.getHSL(hsl);
      const col = (dl, ds = 0) => { const c = new THREE.Color().setHSL(hsl.h + rnd(-.02, .02), clamp(hsl.s + ds, 0, 1), clamp(hsl.l + dl, 0, 1)); return `rgb(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0})`; };
      const R0 = 112, inC = () => { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * R0; return [w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r * .9]; };
      g.strokeStyle = 'rgba(70,55,40,.8)'; g.lineWidth = 1.4;
      for (let i = 0; i < 9; i++) { const [x, y] = inC(); g.beginPath(); g.moveTo(w / 2, h / 2 + 40); g.quadraticCurveTo((x + w / 2) / 2, y + 10, x, y); g.stroke(); }  // 잔가지
      if (kind === 'fig') for (let i = 0; i < 26; i++) {  // 넓고 갈라진 잎
        const [x, y] = inC(), a = rnd(0, 6.283), s = rnd(12, 20); g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = col(rnd(-.12, .08));
        for (const [dx, dy, rr] of [[0, 0, 1], [-.7, -.5, .7], [.7, -.5, .7], [0, -.9, .65]]) { g.beginPath(); g.ellipse(dx * s, dy * s, s * rr * .75, s * rr, 0, 0, 7); g.fill(); }
        g.strokeStyle = col(.12); g.lineWidth = 1; g.beginPath(); g.moveTo(0, s * .8); g.lineTo(0, -s * 1.3); g.stroke(); g.restore();
      }
      else if (kind === 'tamarisk') for (let i = 0; i < 230; i++) {  // 깃털처럼 가늘고 늘어진 잎
        const [x, y] = inC(); g.strokeStyle = col(rnd(-.1, .12), -.05); g.lineWidth = rnd(1.2, 2.4); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + rnd(-6, 6), y + 8, x + rnd(-4, 4), y + rnd(14, 26)); g.stroke();
      }
      else for (let i = 0; i < 170; i++) {  // 감람나무: 좁고 긴 잎, 앞은 짙고 뒤는 은빛
        const [x, y] = inC(), a = rnd(0, 6.283), L = rnd(7, 11); g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = Math.random() < .4 ? col(rnd(.12, .22), -.12) : col(rnd(-.14, .04)); g.beginPath(); g.ellipse(0, 0, L, L * .24, 0, 0, 7); g.fill(); g.restore();
      }
    }));
  }
  TEX.bark = () => TEX._bark || (TEX._bark = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = 'rgb(225,220,212)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { const x = Math.random() * w, l = rnd(110, 200) | 0; g.strokeStyle = `rgba(${l},${l - 8},${l - 16},${rnd(.4, .8).toFixed(2)})`; g.lineWidth = rnd(1.5, 5); g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= h; y += 16) g.lineTo(x + Math.sin(y * .05 + i) * 5, y); g.stroke(); }  // 세로로 갈라진 껍질
    blots(g, w, h, 20, 6, 16, () => `rgba(90,80,70,${rnd(.25, .5).toFixed(2)})`);  // 옹이
  }));
  TEX.palmBark = () => TEX._palmBark || (TEX._palmBark = canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = 'rgb(220,210,195)'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) { g.fillStyle = 'rgba(110,95,78,.7)'; g.fillRect(0, y, w, 4); for (let x = 0; x < w; x += 16) { g.fillStyle = 'rgba(150,130,105,.6)'; g.beginPath(); g.moveTo(x, y + 4); g.lineTo(x + 8, y + 14); g.lineTo(x + 16, y + 4); g.fill(); } }  // 잎이 떨어진 자리의 고리
  }));
  TEX.frond = () => TEX._frond || (TEX._frond = cutoutTex(64, 256, (g, w, h) => {
    g.strokeStyle = 'rgb(120,130,80)'; g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();  // 잎줄기
    for (let y = 6; y < h - 4; y += 5) for (const sd of [-1, 1]) { const L = (w / 2 - 2) * (1 - y / h * .5); const l = rnd(.85, 1.1); g.strokeStyle = `rgb(${120 * l | 0},${150 * l | 0},${80 * l | 0})`; g.lineWidth = 2.2; g.beginPath(); g.moveTo(w / 2, y); g.lineTo(w / 2 + sd * L, y + 14); g.stroke(); }  // 잎조각
  }));
  const treeProtos = {};
  function treeProto(kind, v) {
    const key = kind + v; if (treeProtos[key]) return treeProtos[key];
    const T = TREE[kind], trunk = [], leaves = [];
    if (T.palm) {
      // 종려나무: 살짝 휜 줄기 끝에 늘어진 잎 열네 장
      let p = V3(0, -.2, 0); const lean = V3(rnd(-1, 1), 0, rnd(-1, 1)).normalize().multiplyScalar(rnd(.06, .14)); let r = .26;
      for (let i = 0; i < 6; i++) { const q = p.clone().add(V3(0, T.h / 6, 0)).addScaledVector(lean, i * .5); trunk.push(tubeGeo(p, q, r, r * .95, 9)); p = q; r *= .95; }
      for (let k = 0; k < 14; k++) {
        const a = k / 14 * 6.283 + rnd(-.2, .2), out = V3(Math.cos(a), 0, Math.sin(a)), L = rnd(2.6, 3.4), up0 = rnd(.35, .9), segN = 6;
        const pos = [], nor = [], uv = [], idx = [];
        for (let i = 0; i <= segN; i++) {
          const t = i / segN, c = p.clone().addScaledVector(out, L * t).add(V3(0, up0 * t * L * .5 - t * t * L * .7, 0)), side = V3(-out.z, 0, out.x), wd = .55 * (1 - t * .65);
          for (const sd of [-1, 1]) { const q = c.clone().addScaledVector(side, sd * wd); pos.push(q.x, q.y, q.z); nor.push(0, 1, 0); uv.push(sd < 0 ? 0 : 1, 1 - t); }
          if (i) { const o = (i - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
        }
        const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); fg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); fg.setIndex(idx);
        leaves.push(fg);
      }
      return (treeProtos[key] = { trunk: mergeGeo(trunk), leaves: mergeGeo(leaves), top: p.y });
    }
    // 줄기: 네 마디, 조금씩 휘며 가늘어진다 (감람나무는 비틀리고 굵다)
    let p = V3(0, -.3, 0), dir = V3(rnd(-.15, .15), 1, rnd(-.15, .15)).normalize(), r = T.r;
    const segs = 4, pts = [p.clone()];
    for (let i = 0; i < segs; i++) { const q = p.clone().addScaledVector(dir, T.h / segs * (i ? 1 : 1.15)); trunk.push(tubeGeo(p, q, r, r * .85)); p = q; r *= .85; pts.push(p.clone()); dir.add(V3(rnd(-1, 1), 0, rnd(-1, 1)).multiplyScalar(T.twist)).normalize(); }
    const tips = [];
    for (let k = 0; k < T.branches; k++) {  // 큰 가지와 잔가지
      const a = k / T.branches * 6.283 + rnd(-.45, .45), b0 = pts[segs - (k % 2)].clone().add(V3(rnd(-.05, .05), rnd(-.2, .05), rnd(-.05, .05)));
      const bd = V3(Math.cos(a) * T.spread, T.rise * rnd(.75, 1.25), Math.sin(a) * T.spread).normalize(), L = Math.hypot(T.spread, T.rise) * rnd(.8, 1.15), br = r * .8;
      const b1 = b0.clone().addScaledVector(bd, L * .55); trunk.push(tubeGeo(b0, b1, br, br * .62));
      const bd2 = bd.clone().add(V3(rnd(-.4, .4), T.droop ? -.35 : rnd(0, .3), rnd(-.4, .4))).normalize(), b2 = b1.clone().addScaledVector(bd2, L * .5); trunk.push(tubeGeo(b1, b2, br * .62, br * .3));
      tips.push(b2, b1.clone().lerp(b2, .5));
      for (let j = 0; j < 2; j++) { const tw = b1.clone().addScaledVector(bd.clone().add(V3(rnd(-.8, .8), rnd(-.2, .6), rnd(-.8, .8))).normalize(), L * rnd(.3, .45)); trunk.push(tubeGeo(b1, tw, br * .4, br * .15, 5)); tips.push(tw); }
    }
    let top = p.y;
    if (!T.bare) {
      const ctr = tips.reduce((a, b) => a.add(b), V3(0, 0, 0)).multiplyScalar(1 / tips.length);
      const cards = [...tips.map(t => [t, 2]), ...Array.from({ length: T.fill }, () => [ctr.clone().add(V3(rnd(-1, 1) * T.crown * .55, rnd(-.4, .5) * T.crown * .4, rnd(-1, 1) * T.crown * .55)), 1])];
      for (const [c, m] of cards) for (let q = 0; q < m + 1; q++) {
        const s = T.leafS * rnd(.8, 1.25), pg = new THREE.PlaneGeometry(s, s), at = c.clone().add(V3(rnd(-.35, .35), rnd(-.25, .3), rnd(-.35, .35)));
        pg.rotateX(rnd(-1.2, 1.2)); pg.rotateY(rnd(0, 6.283)); pg.rotateZ(rnd(-.6, .6)); pg.translate(at.x, at.y, at.z);
        const pa = pg.attributes.position, na = pg.attributes.normal;
        for (let i = 0; i < pa.count; i++) { const n = V3(pa.getX(i), pa.getY(i), pa.getZ(i)).sub(ctr).add(V3(0, .6, 0)).normalize(); na.setXYZ(i, n.x, n.y, n.z); top = Math.max(top, pa.getY(i)); }  // 나무 바깥쪽이 밝게
        leaves.push(pg);
      }
    }
    return (treeProtos[key] = { trunk: mergeGeo(trunk), leaves: leaves.length ? mergeGeo(leaves) : null, top });
  }
  function trees(kind, { n = 20, place, height, s = [.8, 1.25] } = {}) {
    const T = TREE[kind], g = new THREE.Group(), d = new THREE.Object3D(), pts = [];
    for (let i = 0; i < n; i++) { const [x, z] = place(i); pts.push([x, height ? height(x, z) : 0, z, rnd(s[0], s[1]), rnd(0, 6.3)]); }
    const barkM = new THREE.MeshStandardMaterial({ color: T.trunk, map: T.palm ? TEX.palmBark() : TEX.bark(), roughness: 1 });
    const leafM = T.bare ? null : sway(new THREE.MeshStandardMaterial({ map: T.palm ? TEX.frond() : leafTex(T.leafTex, T.leaf), color: T.palm ? T.leaf : '#ffffff', alphaTest: .5, side: THREE.DoubleSide, roughness: .9 }), T.palm ? .05 : .035, T.palm ? 'max(position.y - 7., 0.)' : 'max(position.y - 1.6, 0.)');
    for (let v = 0; v < 3; v++) {  // 세 가지 모양을 돌려 쓴다
      const mine = pts.filter((_, i) => i % 3 === v); if (!mine.length) continue;
      const P = treeProto(kind, v);
      const tr = new THREE.InstancedMesh(P.trunk, barkM, mine.length), lf = P.leaves && leafM ? new THREE.InstancedMesh(P.leaves, leafM, mine.length) : null;
      mine.forEach(([x, y, z, sc, r], i) => { d.position.set(x, y, z); d.rotation.set(0, r, 0); d.scale.setScalar(sc); d.updateMatrix(); tr.setMatrixAt(i, d.matrix); if (lf) lf.setMatrixAt(i, d.matrix); });
      g.add(tr); if (lf) { g.add(lf); g.userData.crown = lf; }
    }
    R().add(g); return g;
  }
  // 풀: 풀잎 여러 가닥을 그린 판 세 장을 엇갈려 세운 다발. 바람에 흔들리고, 다발마다 색이 조금씩 다르다. 길 위에는 두지 않는다
  TEX.grass = () => TEX._grass || (TEX._grass = cutoutTex(256, 256, (g, w, h) => {
    for (let i = 0; i < 90; i++) {
      const x0 = rnd(.1, .9) * w, top = rnd(.05, .55) * h, bend = rnd(-40, 40), wd = rnd(2.5, 5.5), l = rnd(.78, 1);
      g.fillStyle = `rgb(${(232 * l) | 0},${(245 * l) | 0},${(214 * l) | 0})`;
      g.beginPath(); g.moveTo(x0 - wd, h); g.quadraticCurveTo(x0 + bend * .3, (h + top) / 2, x0 + bend, top); g.quadraticCurveTo(x0 + bend * .3 + wd * .6, (h + top) / 2, x0 + wd, h); g.fill();
    }
    for (let i = 0; i < 10; i++) { const x = rnd(.2, .8) * w, y = rnd(.05, .3) * h; g.fillStyle = 'rgb(240,232,200)'; g.beginPath(); g.ellipse(x, y, 2.4, 6, rnd(-.4, .4), 0, 7); g.fill(); }  // 이삭
  }));
  TEX.reeds = () => TEX._reeds || (TEX._reeds = cutoutTex(128, 512, (g, w, h) => {
    for (let i = 0; i < 26; i++) { const x0 = rnd(.15, .85) * w, top = rnd(.02, .25) * h, bend = rnd(-18, 18), wd = rnd(1.6, 3), l = rnd(.8, 1); g.fillStyle = `rgb(${(225 * l) | 0},${(238 * l) | 0},${(205 * l) | 0})`; g.beginPath(); g.moveTo(x0 - wd, h); g.quadraticCurveTo(x0, (h + top) / 2, x0 + bend, top); g.quadraticCurveTo(x0 + wd * .5, (h + top) / 2, x0 + wd, h); g.fill(); }
  }));
  const grassGeo = {};
  function clumpGeo(wd) {
    if (grassGeo[wd]) return grassGeo[wd];
    const parts = [0, 1, 2].map(k => { const p = new THREE.PlaneGeometry(wd, 1); p.translate(0, .5, 0); p.rotateY(k * Math.PI / 3); const n = p.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0); return p; });  // 법선은 위로: 앞뒤 어디서 봐도 고르게 밝다
    return (grassGeo[wd] = mergeGeo(parts));
  }
  const grassSets = [];
  function grass({ center = [0, 0], rx = 20, rz = 20, n = 1500, height, color = '#5f7a3a', h = .35, reeds = false, avoid, thin = 1 } = {}) {  // avoid(x, z): 풀을 두지 않을 자리, thin: 잎 굵기 배율
    const cnt = Math.max(1, Math.round(n * (reeds ? .5 : .3)));
    const mtl = sway(new THREE.MeshStandardMaterial({ map: reeds ? TEX.reeds() : TEX.grass(), color: '#ffffff', alphaTest: .45, side: THREE.DoubleSide, roughness: .95 }), reeds ? .07 : .05, 'position.y');
    const m = new THREE.InstancedMesh(clumpGeo(reeds ? .45 : .8 * thin), mtl, cnt), d = new THREE.Object3D(), base = new THREE.Color(color), c = new THREE.Color(), at = [];
    for (let i = 0; i < cnt; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()), x = center[0] + Math.cos(a) * r * rx, z = center[1] + Math.sin(a) * r * rz;
      const sc = avoid && avoid(x, z) || onPath(x, z) ? 0 : rnd(.7, 1.3);
      d.position.set(x, (height ? height(x, z) : 0) - .02, z); d.rotation.set(rnd(-.12, .12), rnd(0, 6.3), rnd(-.12, .12)); d.scale.set(sc, sc * (reeds ? 1.7 : h * 1.9) * rnd(.75, 1.2), sc); d.updateMatrix(); m.setMatrixAt(i, d.matrix);
      c.copy(base).offsetHSL(rnd(-.02, .03), rnd(-.08, .05), rnd(-.06, .07)); m.setColorAt(i, c); at.push([x, z]);
    }
    m.userData.noCast = true; m.frustumCulled = false; R().add(m);
    grassSets.push({ m, at });
    return m;
  }
  // 흙길: kit.path([[x, z], ...], { width, height }) — 점들을 잇는 부드러운 길. 가장자리는 풀과 섞이며 흐려지고, 길 위의 풀은 치운다
  const paths = [];
  function onPath(x, z) {
    for (const P of paths) for (let i = 1; i < P.pts.length; i++) {
      const [ax, az] = P.pts[i - 1], [bx, bz] = P.pts[i], vx = bx - ax, vz = bz - az, t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1), 0, 1);
      if (Math.hypot(x - ax - vx * t, z - az - vz * t) < P.w / 2 + .2) return true;
    }
    return false;
  }
  function path(points, { width = 2.4, height, y = .07 } = {}) {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => V3(x, 0, z))), L = curve.getLength(), N = Math.max(2, Math.ceil(L / .6)), C = 6, W = width * 1.3;
    const pos = [], uv = [], idx = [], samp = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, c = curve.getPointAt(t), tg = curve.getTangentAt(t), sx = -tg.z, sz = tg.x;
      samp.push([c.x, c.z]);
      for (let j = 0; j <= C; j++) { const u = j / C, o = (u - .5) * W, x = c.x + sx * o, z = c.z + sz * o; pos.push(x, (height ? height(x, z) : 0) + y, z); uv.push(u, t * L / (width * 2)); }
      if (i) for (let j = 0; j < C; j++) { const a = (i - 1) * (C + 1) + j, b = a + C + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }  // 위를 향하는 면
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: TEX.path(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    m.userData.noCast = true; m.renderOrder = 1; R().add(m);
    paths.push({ pts: samp, w: width });
    // 이미 깔린 풀 가운데 길 위에 있는 것은 치운다
    const d = new THREE.Object3D(), mx = new THREE.Matrix4();
    for (const G of grassSets) { let ch = false; G.at.forEach(([x, z], i) => { if (onPath(x, z)) { G.m.getMatrixAt(i, mx); mx.decompose(d.position, d.quaternion, d.scale); d.scale.setScalar(0); d.updateMatrix(); G.m.setMatrixAt(i, d.matrix); ch = true; } }); if (ch) G.m.instanceMatrix.needsUpdate = true; }
    return m;
  }
  // 십자가: 세로 기둥, 가로 들보, 죄패 (요 19:19). userData.hang = 매달린 사람이 설 자리
  function cross({ at = [0, 0, 0], h = 4.2, ry = 0, titulus = false } = {}) {
    const g = new THREE.Group(); g.position.set(at[0], at[1], at[2]); g.rotation.y = ry;
    const wood = surfMat('wood', '#5a4430');
    box(.22, h + .6, .2, null, 0, (h + .6) / 2 - .6, 0, g, wood); box(2.1, .2, .2, null, 0, h - .55, 0, g, wood);
    if (titulus) { box(.75, .32, .04, '#c9bea3', 0, h - .05, .12, g); }
    box(.3, .06, .22, null, 0, h - 1.92, .14, g, wood);  // 발판 (두 팔이 가로 들보에 닿는 높이)
    g.userData.hang = new THREE.Vector3(0, h - 1.89, .16);
    R().add(g); return g;
  }
  // 바위 무덤: 바위벽에 판 굴과 굴리는 돌 (요 20:1, 막 16:4). 안으로 들어갈 수 있는 방이다 (앞이 +z)
  function tomb({ at = [0, 0, 0], ry = 0 } = {}) {
    const g = new THREE.Group(); g.position.set(at[0], at[1], at[2]); g.rotation.y = ry;
    const rock = surfMat('rock', '#9a8a74'), inner = surfMat('rock', '#6e6252');
    box(4.2, 5, 1, null, -3.2, 2.5, 0, g, rock); box(4.2, 5, 1, null, 3.2, 2.5, 0, g, rock); box(2.2, 2.6, 1, null, 0, 3.7, 0, g, rock);  // 앞벽과 문 (너비 2.2, 높이 2.4)
    box(1, 2.8, 5, null, -1.7, 1.4, -3, g, inner); box(1, 2.8, 5, null, 1.7, 1.4, -3, g, inner); box(4.4, 2.8, 1, null, 0, 1.4, -5.4, g, inner); box(4.4, .8, 6, null, 0, 3.2, -3, g, inner);  // 안쪽 방
    box(4, 6, 7, null, -4.4, 3, -3.4, g, rock); box(4, 6, 7, null, 4.4, 3, -3.4, g, rock); box(12, 2.6, 7.4, null, 0, 4.8, -3.4, g, rock);  // 바깥 바위 덩어리
    box(1, .6, 3.6, '#8a7b66', .75, .3, -3.2, g);  // 시체를 뉘던 자리
    const L = new THREE.PointLight('#d8c8a8', 1.2, 7, 2); L.position.set(0, 2, -1.2); g.add(L);
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, .45, 18), surfMat('rock', '#8c7d68')); stone.rotation.x = Math.PI / 2; stone.position.set(0, 1.4, .8); g.add(stone);
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
  // 마우스는 끌지 않아도 가리키는 쪽을 조금 바라보고(hTX·hTY), 화면 좌우 끝에 두면 그쪽으로 계속 돈다(edge). 휠로도 좌우로 돈다
  let hTX = 0, hTY = 0, edge = 0;
  const onMove = e => {
    if (!dragging && e.pointerType === 'mouse') {
      if (e.target === canvas) { const x = e.clientX / innerWidth * 2 - 1, y = e.clientY / innerHeight * 2 - 1; hTX = x * .3; hTY = -y * .18; edge = Math.abs(x) > .86 ? Math.sign(x) * (Math.abs(x) - .86) / .14 : 0; lastDrag = clock; }
      else edge = 0;  // 글 상자나 버튼 위에서는 시점을 그대로 둔다
      return;
    }
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
  const onWheel = e => { if (e.target !== canvas) return; e.preventDefault(); tLookX = clamp(tLookX + (e.deltaY + e.deltaX) * .0012, -1, 1); lastDrag = clock; };
  canvas.addEventListener('wheel', onWheel, { passive: false });
  const onLeave = () => { hTX = hTY = 0; edge = 0; };  // 마우스가 창 밖으로 나가면 가운데로
  document.documentElement.addEventListener('mouseleave', onLeave);
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h; camera.fov = w / h < 1 ? 74 : 60; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();

  /* --- 매 프레임 --- */
  const fx = { flash: 0 };
  const frameFns = [], resetFns = [];
  const sunDir = new THREE.Vector3(), _dofP = new THREE.Vector3();
  let last = performance.now(), raf = 0, dead = false;
  function frame(now) {
    if (dead) return;
    const dt = Math.min(.05, (now - last) / 1000) * SPEED; last = now; clock += dt;
    stepTweens(); if (cyc) stepCycle(); stepNumTweens();

    const el = THREE.MathUtils.degToRad(env.sunEl), az = THREE.MathUtils.degToRad(env.sunAz);
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    skyU.uSunDir.value.copy(sunDir); skyU.uTop.value.copy(env.top); skyU.uHorizon.value.copy(env.horizon); skyU.uSunColor.value.copy(env.sun);
    skyU.uStars.value = env.stars; skyU.uStorm.value = env.storm; skyU.uSing.value = env.sing; skyU.uTime.value = clock;
    fog.color.copy(env.fog); fog.density = env.fogD; skyU.uFog.value.copy(env.fog);
    sun.color.copy(env.sun); sun.intensity = env.sunI * clamp(env.sunEl / 6 + .35, 0, 1);
    { const tx = Math.round(camera.position.x / 2) * 2, tz = Math.round(camera.position.z / 2) * 2;  // 그림자 지도를 카메라 둘레에 (2m 단위로 옮겨 그림자가 떨리지 않게)
      sun.target.position.set(tx, groundAt(tx, tz), tz); sun.position.copy(sun.target.position).addScaledVector(sunDir, 120); sun.target.updateMatrixWorld();
      sun.castShadow = env.sunEl > -1 && sun.intensity > .08; }
    if (clock > shadowSweepAt) { shadowSweepAt = clock + 1.5; shadowSweep(); }
    windU.value = clock;
    hemi.color.copy(env.top).lerp(env.horizon, .55); hemi.groundColor.copy(env.fog).multiplyScalar(.6); hemi.intensity = env.hemiI * HEMI_K + fx.flash * 1.6;
    if (clock > envAt) { envAt = clock + .5; stepEnvMap(); }
    // 어두운 장면일수록(해가 지고 하늘빛이 약할수록) 고른 빛과 노출을 더한다
    const dark = clamp(1 - (sun.intensity * .4 + env.hemiI + fx.flash * 1.6) / .8, 0, 1);
    moon.intensity = dark * .7;
    renderer.toneMappingExposure = env.exposure * (1.15 + dark * .35) * TONE_K;
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

    stepWalkers(); stepFires(dt); stepFigs(dt); stepFlames();
    for (const fn of frameFns) fn(dt, clock);
    fx.flash *= Math.exp(-dt * 6);
    skyU.uFlash.value = fx.flash;
    sparks.update(dt); dust.update(dt);

    if (edge && !dragging) { tLookX = clamp(tLookX + edge * dt * .9, -1, 1); lastDrag = clock; }
    if (!dragging && clock - lastDrag > 5) { const k = 1 - Math.exp(-dt * .7); tLookX -= tLookX * k; tLookY -= tLookY * k; hTX -= hTX * k; hTY -= hTY * k; }
    const lk = Math.min(1, dt * 4); lookX += (clamp(tLookX + hTX, -1, 1) - lookX) * lk; lookY += (clamp(tLookY + hTY, -1, 1) - lookY) * lk;
    const sway = reduceMotion ? 0 : 1, sh = env.shake * (reduceMotion ? .15 : 1);
    if (camGround.on) env.camH = groundAt(env.camX, env.camZ) + camGround.eye;  // 걸을 때 눈높이를 땅에 맞춘다
    camera.position.set(env.camX + Math.sin(clock * 13.1) * .02 * sh, env.camH + Math.sin(clock * .9) * .012 * sway + Math.sin(clock * 17.3) * .02 * sh, env.camZ);
    if (camWater.on) camera.position.y += waveH(env.camX, env.camZ, env.waves) * camWater.k;
    { const gy = groundAt(camera.position.x, camera.position.z) + .28; if (camera.position.y < gy) camera.position.y = gy; }  // 땅·배 바닥 아래로는 내려가지 않는다
    camera.rotation.set(Math.max(-1.45, env.camP - lookY * (lookY > 0 ? 1.3 : .45)) + Math.sin(clock * .6) * .004 * sway, env.camY - lookX * 1.4, env.camR + Math.sin(clock * .37) * .004 * sway + Math.sin(clock * 11) * .004 * sh + (camWater.on ? (waveH(env.camX + 1, env.camZ, env.waves) - waveH(env.camX - 1, env.camZ, env.waves)) * .3 * camWater.k : 0));
    // 배에 붙은 시선: 배의 기울기를 따라 자리를 옮기고 시선도 조금 기운다
    camBoat.w += ((camBoat.on ? 1 : 0) - camBoat.w) * Math.min(1, dt * 1.5);
    if (camBoat.w > .002 && camBoat.boat) { const b = camBoat.boat; b.updateMatrixWorld(); camera.position.lerp(b.localToWorld(_cb.copy(camBoat.local)), camBoat.w); camera.rotation.x += b.rotation.x * .4 * camBoat.w; camera.rotation.z += b.rotation.z * .35 * camBoat.w; }
    sky.position.copy(camera.position);
    stepSelf(dt);
    grain.uniforms.uTime.value = clock;

    if (bokeh) {  // 누가 말하는 동안 그 사람 머리에 초점을 맞추고 뒤를 흐린다 (서서히 켜고 끈다)
      const sp = talkState.speaker, on = !!(sp && clock < talkState.until && shown(sp) && sp.userData.head);
      if (on) { sp.userData.head.getWorldPosition(_dofP); const d = camera.position.distanceTo(_dofP); dofF += (d - dofF) * Math.min(1, dt * 4); }
      dofK += ((on && dofF < 9 ? .009 : 0) - dofK) * Math.min(1, dt * 2.2);
      bokeh.enabled = dofK > .0004; bokeh.uniforms.focus.value = dofF; bokeh.uniforms.maxblur.value = dofK;
    }
    composer.render(dt);
    raf = requestAnimationFrame(frame);
  }
  const camWater = { on: false, k: 1 }, camGround = { on: false, eye: 1.65 };
  const camBoat = { on: false, boat: null, local: new THREE.Vector3(), w: 0 }, _cb = new THREE.Vector3();  // 배에 탄 시선: 배와 함께 흔들리고 배 밑으로 꺼지지 않는다
  setEnv(initial, 0);
  raf = requestAnimationFrame(frame);

  return {
    setSpeed(s) { SPEED = s; },
    THREE, scene, camera, renderer, PR, env, fx, sparks, dust,
    u: { clamp, lerp, ease, rnd, smooth, vnoise, hash2, sleep, reduceMotion },
    get clock() { return clock; },
    setEnv, cycleDays, tween, perFrame,
    focus(azDeg, dur = 2.5) { return setEnv({ camY: -azDeg * Math.PI / 180 }, dur); },
    onFrame(fn) { frameFns.push(fn); },
    onReset(fn) { resetFns.push(fn); },
    camOnWater(on, k = 1) { camWater.on = on; camWater.k = k; },
    // 시선을 배의 한 자리(배 기준 좌표)에 붙인다: kit.camOnBoat(boat, [x, y, z], 바로) / kit.camOnBoat(null)로 뗀다(천천히 풀린다)
    camOnBoat(boat, local, now = false) { if (!boat) { camBoat.on = false; return; } camBoat.boat = boat; camBoat.local.set(...local); camBoat.on = true; if (now) camBoat.w = 1; },
    // 눈높이를 땅 + eye로 (걸어가는 장면). null이면 끈다
    groundCam(eye = 1.65) { if (eye == null) { camGround.on = false; return; } camGround.on = true; camGround.eye = eye; },
    // 땅을 따라 걸어간다: kit.walkTo(x, z, 초, { eye })
    walkTo(x, z, dur, { eye = 1.65 } = {}) { camGround.on = true; camGround.eye = eye; return setEnv({ camX: x, camZ: z }, dur); },
    groundAt, addGround, addFloor, boatAt, outsideBoats,
    waveH: (x, z) => waveH(x, z, env.waves),
    terrain, disc, rocks, path, box, glow, glowMat, lamp, lampAt, torch, person, figure, gesture, hold, talk, selfBody, mat, house, village, room, cityWall, temple, trees, grass, cross, tomb, rooster, get self() { return me; }, into, site, shown, prop, instancedProp, throng, walker, faceCamera, herd, fire, water, float, boat, net, tent, altar,
    reset() {
      for (const k in tw) delete tw[k];
      tweens.length = 0; cyc = null; camWater.on = false; camGround.on = false; camBoat.on = false; camBoat.w = 0; tLookX = tLookY = 0;
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
      canvas.removeEventListener('wheel', onWheel); document.documentElement.removeEventListener('mouseleave', onLeave);
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
      composer.dispose && composer.dispose(); renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss();
    }
  };
}
