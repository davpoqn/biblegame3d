# three.js 0.160에서 캐릭터와 애니메이션을 data URI로 불러와 확인한다 (게시 조건과 같게 옆 파일 없이).
#   python3 tools/chars/charcheck.py            → 결과 출력 + assets/chars/preview/three.png
# 확인: 모든 클립이 뼈에 붙는지, 걷기에서 손이 움직이는지, 여자의 팔 길이가 유지되는지
import base64, json, pathlib, sys
from playwright.sync_api import sync_playwright

S = pathlib.Path(__file__).resolve().parent.parent.parent
T = S / 'node_modules/three'
uri = lambda p: 'data:model/gltf-binary;base64,' + base64.b64encode((S / p).read_bytes()).decode()
data = {k: uri(f'assets/chars/{k}.glb') for k in ('char_m', 'char_f', 'anims', 'props')}
outfits = json.loads((S / 'assets/chars/outfits.json').read_text())
# 아티팩트 뷰어와 비슷한 보안 정책: fetch 금지, WebAssembly 금지
CSP = ('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' https://cdn.jsdelivr.net; '
       'style-src \'unsafe-inline\'; img-src data: blob:; connect-src \'none\'">')

html = '''<!doctype html><html><head><meta charset=utf8>CSP
<script type=importmap>{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
"three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script></head>
<body style="margin:0"><script type=module>
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
const D = DATA, O = OUTFITS, out = {};
const buf = (u) => Uint8Array.from(atob(u.slice(u.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
const ld = new GLTFLoader();
const [m, f, a] = await Promise.all([D.char_m, D.char_f, D.anims].map((u) => ld.parseAsync(buf(u), '')));
const clips = Object.fromEntries(a.animations.map(c => [c.name, c]));
out.clips = a.animations.length;
const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(960, 540); document.body.appendChild(r.domElement);
const sc = new THREE.Scene(); sc.background = new THREE.Color(0x9a9aa2);
sc.add(new THREE.HemisphereLight(0xffffff, 0x665544, 1.6)); const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(2, 4, 3); sc.add(sun);
const cam = new THREE.PerspectiveCamera(30, 960 / 540, 0.1, 50); cam.position.set(0, 1.3, 7.5); cam.lookAt(0, 0.9, 0);
function dress(src, role) {
  const g = SkeletonUtils.clone(src.scene), spec = O.roles[role], d = O.default_colors, col = { ...d };
  for (const u of ['under_chest', 'under_body', 'under_arm', 'under_thigh', 'under_calf']) col[u] = spec.under || d.tunic;
  for (const u of spec.bare || []) col[u] = d.M_Main; Object.assign(col, spec.colors || {});
  g.traverse(o => { if (!o.isMesh) return;
    if (!o.name.startsWith('Mannequin')) o.visible = spec.wear.includes(o.name);
    o.material = o.material.clone(); const c = col[o.material.name]; if (c) o.material.color.set(c); });
  return g;
}
const cast = [['man', m, 'Walk_Loop', 0.4], ['woman', f, 'Sitting_Idle_Loop', 0.3], ['shepherd', m, 'Idle_Loop', 0.5],
              ['woman', f, 'Walk_Loop', 0.6], ['king', m, 'Idle_Talking_Loop', 0.7], ['roman', m, 'Sword_Attack', 0.35]];
const mixers = [];
cast.forEach(([role, src, clip, t], i) => {
  const g = dress(src, role); g.position.x = (i - 2.5) * 1.1; sc.add(g);
  const mx = new THREE.AnimationMixer(g); mx.clipAction(clips[clip]).play(); mx.setTime(t * clips[clip].duration); mixers.push([g, mx, role, clip]);
});
// 팔 길이 (어깨→손) — 여자가 남자 팔 길이로 늘어나면 안 된다
const P = (g, n) => g.getObjectByName(n).getWorldPosition(new THREE.Vector3());
sc.updateMatrixWorld(true);
out.arm = mixers.map(([g, , role, clip]) => [role, clip, +(P(g, 'upperarm_l').distanceTo(P(g, 'lowerarm_l')) + P(g, 'lowerarm_l').distanceTo(P(g, 'hand_l'))).toFixed(3)]);
const [g0, mx0] = mixers[0]; const h0 = P(g0, 'hand_l'); mx0.setTime(0.4 * clips.Walk_Loop.duration + 0.5); sc.updateMatrixWorld(true);
out.handMoved = +P(g0, 'hand_l').distanceTo(h0).toFixed(3);
mx0.setTime(0.4 * clips.Walk_Loop.duration);
out.meshes = { m: [], f: [] }; m.scene.traverse(o => o.isMesh && out.meshes.m.push(o.name)); f.scene.traverse(o => o.isMesh && out.meshes.f.push(o.name));
r.render(sc, cam); window.OUT = out;
</script></body></html>'''.replace('CSP', CSP).replace('DATA', json.dumps(data)).replace('OUTFITS', json.dumps(outfits))

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 960, 'height': 540})
    errs = []
    pg.on('console', lambda m: errs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errs.append(f'[pageerror] {e}'))
    pg.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', lambda r: r.fulfill(path=str(T / r.request.url.split('three@0.160.0/')[1]), content_type='application/javascript'))
    pg.set_content(html)
    pg.wait_for_function('window.OUT', timeout=60000)
    out = pg.evaluate('window.OUT')
    (S / 'chk').mkdir(exist_ok=True)
    pg.screenshot(path=str(S / 'assets/chars/preview/three.png'))
    b.close()
print('clips', out['clips'], '| hand moved in walk', out['handMoved'])
for row in out['arm']: print('  arm length (m 0.547 / f 0.493)', *row)
print('  meshes m:', ' '.join(out['meshes']['m']))
print('  meshes f:', ' '.join(out['meshes']['f']))
print('warnings/errors:', len(errs))
for e in errs[:6]: print('  ', e[:200])
sys.exit(1 if errs else 0)
