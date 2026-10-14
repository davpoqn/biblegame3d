# 예수님 머리: MakeHuman(내보낸 모델은 CC0)으로 만든 얼굴·눈·긴 머리·눈썹·수염에서 머리만 떼어 assets/chars/jesus_head.glb로 만든다
# 원본: assets/raw/jesus/ (사용자가 MakeHuman 1.2로 내보낸 obj·mtl과 텍스처, 2026-10-10)
# 머리카락은 어깨 길이로 자르고, 피부는 조금 어둡게, 눈은 갈색으로 바꾼다. 엔진(kit.js)이 두 눈의 가운데를 마네킹의 눈 자리에 맞춰 머리 뼈에 붙인다
# python3 tools/chars/jesus_head.py
import io, json, struct, pathlib
import numpy as np
from PIL import Image

S = pathlib.Path(__file__).resolve().parents[2]
RAW = S / 'assets/raw/jesus'
OUT = S / 'assets/chars/jesus_head.glb'
NECK_Y = 16.6   # 데시미터. 이보다 아래의 몸은 버린다(수염 아래 끝 16.8보다 조금 낮게, 목 아래는 옷깃이 가린다)
HAIR_Y = 16.15  # 머리카락은 어깨 길이로 자른다
DM = .1         # MakeHuman obj는 데시미터


def load_obj(p):
    V, T, groups, g = [], [], {}, None
    for l in open(p, encoding='utf8'):
        if l.startswith('v '): V.append([float(x) for x in l.split()[1:4]])
        elif l.startswith('vt '): T.append([float(x) for x in l.split()[1:3]])
        elif l.startswith('g '): g = l.split()[1]
        elif l.startswith('f '): groups.setdefault(g, []).append([(int(a.split('/')[0]) - 1, int(a.split('/')[1]) - 1) for a in l.split()[1:]])
    return np.array(V), np.array(T), groups


V, T, G = load_obj(RAW / 'jesus1.exports.obj')


def sculpt(V, G):
    """얼굴을 덜 납작하게 (사용자 요청 2026-10-14: 광대뼈가 조금 나오고 볼은 갸름하게).
    두 눈 사이 거리(ed)를 단위로, 두 눈 가운데를 원점으로 하는 공간 변형을 얼굴·눈썹·수염·머리카락에 똑같이 줘서 서로 어긋나지 않게 한다"""
    eyes = np.array(sorted({v for f in G['high-poly.obj'] for v, _ in f}))
    E = V[eyes]; L, R = E[E[:, 0] > 0].mean(0), E[E[:, 0] < 0].mean(0); mid, ed = (L + R) / 2, np.linalg.norm(L - R)
    q = (V - mid) / ed; x, y, z = q[:, 0], q[:, 1], q[:, 2]; ax, sx = np.abs(x), np.sign(x)
    ss = lambda a, b, t: np.clip((t - a) / (b - a), 0, 1) ** 2 * (3 - 2 * np.clip((t - a) / (b - a), 0, 1))
    g = lambda cx, cy, rx, ry: np.exp(-((ax - cx) / rx) ** 2 / 2 - ((y - cy) / ry) ** 2 / 2)
    front = ss(-.9, -.2, z)                                     # 얼굴 앞쪽만 (뒷머리·귀 뒤는 그대로)
    d = np.zeros_like(q)
    d[:, 2] -= SC['side'] * ss(.42, 1.05, ax) * ss(-1.2, -.6, y) * (1 - ss(.7, 1.2, y)) * front   # 눈·광대 높이의 볼 옆면을 뒤로 (입 높이는 그대로 — 거기까지 밀면 주둥이가 튀어나와 보인다)
    cb = g(.84, -.4, .26, .2) * front                            # 광대뼈
    d[:, 0] += sx * SC['cheekbone'] * cb; d[:, 2] += SC['cheekbone'] * .8 * cb
    hc = g(.72, -.98, .28, .24) * front                          # 광대 아래 볼은 들어가게
    d[:, 0] -= sx * SC['hollow'] * hc; d[:, 2] -= SC['hollow'] * .6 * hc
    d[:, 2] -= SC['lower'] * ss(.55, 1.05, -y) * (1 - ss(.7, 1.3, ax)) * front   # 하관(입·턱)을 뒤로
    d[:, 2] -= SC['lips'] * g(0, -.95, .4, .2) * front           # 입술을 조금 더 뒤로
    d[:, 0] -= x * SC['jaw'] * ss(-.95, -1.6, -y) * ss(.3, .7, ax)   # 턱선을 조금 좁게
    q2 = q + d
    # 얼굴 폭 줄이기: 두 눈은 그대로 두고 눈 바깥쪽(관자놀이·볼·턱·귀·뒷머리)을 안으로. 폭이 매끄럽게 줄도록 x를 적분한 꼴로 옮긴다
    a0, a1, a = .6, .95, np.abs(q2[:, 0]); u = np.clip((a - a0) / (a1 - a0), 0, 1)
    q2[:, 0] = np.sign(q2[:, 0]) * (a - (1 - SC['narrow']) * ((a1 - a0) * (u ** 3 - u ** 4 / 2) + np.maximum(a - a1, 0)))
    q2[eyes] = q[eyes]                                           # 눈알 모양·자리는 그대로
    return mid + q2 * ed


SC = {'narrow': .55, 'side': .12, 'cheekbone': .08, 'hollow': .07, 'lower': .2, 'lips': .06, 'jaw': .12}
V = sculpt(V, G)
keep = {
    'base.obj': lambda f: min(V[i][1] for i, _ in f) >= NECK_Y,
    'long01.obj': lambda f: min(V[i][1] for i, _ in f) >= HAIR_Y,
}


def build(name):
    faces = [f for f in G[name] if keep.get(name, lambda f: True)(f)]
    # 위치 번호 기준 부드러운 법선(텍스처 이음매에서도 끊기지 않게)
    acc = {}
    for f in faces:
        p = [V[i] for i, _ in f]
        n = np.cross(p[1] - p[0], p[2] - p[0]) + (np.cross(p[2] - p[0], p[3] - p[0]) if len(p) > 3 else 0)
        for i, _ in f: acc[i] = acc.get(i, 0) + n
    idx, pos, nor, uv, tri = {}, [], [], [], []
    for f in faces:
        ks = []
        for i, t in f:
            if (i, t) not in idx:
                idx[(i, t)] = len(pos); pos.append(V[i] * DM)
                n = acc[i]; nor.append(n / (np.linalg.norm(n) or 1)); uv.append([T[t][0], 1 - T[t][1]])
            ks.append(idx[(i, t)])
        for k in range(1, len(ks) - 1): tri += [ks[0], ks[k], ks[k + 1]]
    return np.array(pos, np.float32), np.array(nor, np.float32), np.array(uv, np.float32), np.array(tri, np.uint32)


def png(im): b = io.BytesIO(); im.save(b, 'PNG', optimize=True); return b.getvalue(), 'image/png'
def jpg(im): b = io.BytesIO(); im.convert('RGB').save(b, 'JPEG', quality=88); return b.getvalue(), 'image/jpeg'
def tint(im, mul): a = np.asarray(im.convert('RGBA')).astype(np.float32); a[..., :3] *= mul; return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')


prims = {k: build(k) for k in ['base.obj', 'high-poly.obj', 'long01.obj', 'eyebrow001.obj', 'beard_sigmund.obj']}

# 피부: 머리 부분만 잘라 쓰고(UV를 그 안으로 옮긴다), 중동 사람처럼 조금 어둡고 따뜻하게
skin = Image.open(RAW / 'textures/old_lightskinned_male_diffuse.webp').convert('RGB'); W, H = skin.size
uvb = prims['base.obj'][2]
x0, y0 = max(0, int(uvb[:, 0].min() * W) - 8), max(0, int(uvb[:, 1].min() * H) - 8)
x1, y1 = min(W, int(uvb[:, 0].max() * W) + 8), min(H, int(uvb[:, 1].max() * H) + 8)
crop = skin.crop((x0, y0, x1, y1)); cw, ch = crop.size
uvb[:, 0] = (uvb[:, 0] * W - x0) / cw; uvb[:, 1] = (uvb[:, 1] * H - y0) / ch
k = 1024 / max(cw, ch); crop = crop.resize((max(1, round(cw * k)), max(1, round(ch * k))), Image.LANCZOS)
skinT = tint(crop, [.94, .88, .82])
# 눈: 파란 홍채를 갈색으로
eye = np.asarray(Image.open(RAW / 'textures/blue_eye.webp').convert('RGBA')).astype(np.float32)
m = (eye[..., 2] - eye[..., 0]) > 28; lum = eye[..., :3].mean(-1)
for c, (b0, s) in enumerate([(62, .62), (36, .38), (20, .2)]): eye[..., c] = np.where(m, b0 + lum * s, eye[..., c])
eyeT = Image.fromarray(np.clip(eye, 0, 255).astype(np.uint8), 'RGBA').resize((256, 256), Image.LANCZOS)
# 바깥 각막 껍질은 그림의 투명한 곳을 쓴다. 불투명하게 그리면 눈이 새까맣게 보이므로 뺀다
_p, _n, _u, _t = prims['high-poly.obj']; _t = _t.reshape(-1, 3); _c = _u[_t].mean(1); _a = np.asarray(eyeT)[..., 3]
_k = _a[np.clip((_c[:, 1] * 256).astype(int), 0, 255), np.clip((_c[:, 0] * 256).astype(int), 0, 255)] >= 128
prims['high-poly.obj'] = (_p, _n, _u, _t[_k].ravel()); print('eyes: kept', int(_k.sum()), 'of', len(_k), 'triangles')
hairT = tint(Image.open(RAW / 'textures/long01_diffuse.webp'), [.95, .9, .86]).resize((1024, 1024), Image.LANCZOS)
browT = tint(Image.open(RAW / 'textures/eyebrow001.png'), [.42, .3, .22]).resize((256, 256), Image.LANCZOS)
beardT = tint(Image.open(RAW / 'textures/beard_sigmund_diffuse.webp'), [.5, .36, .26]).resize((512, 512), Image.LANCZOS)

MATS = [  # (이름, 그림, 투명 방식, 거칠기)
    ('skin', jpg(skinT), 'OPAQUE', .62), ('eyes', png(eyeT), 'OPAQUE', .25), ('hair', png(hairT), 'MASK', .7),
    ('brows', png(browT), 'MASK', .8), ('beard', png(beardT), 'MASK', .8)]

# --- glb 쓰기 ---
bin_, views, accs = bytearray(), [], []
def view(data, target=None):
    while len(bin_) % 4: bin_.append(0)
    views.append({'buffer': 0, 'byteOffset': len(bin_), 'byteLength': len(data), **({'target': target} if target else {})}); bin_.extend(data); return len(views) - 1
def accessor(arr, typ, comp, target, mm=False):
    a = {'bufferView': view(arr.tobytes(), target), 'componentType': comp, 'count': len(arr), 'type': typ}
    if mm: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
    accs.append(a); return len(accs) - 1
primitives, materials, textures, images = [], [], [], []
for mi, (key, (name, (data, mime), mode, rough)) in enumerate(zip(prims, MATS)):
    p, n, u, t = prims[key]
    primitives.append({'attributes': {'POSITION': accessor(p, 'VEC3', 5126, 34962, True), 'NORMAL': accessor(n, 'VEC3', 5126, 34962), 'TEXCOORD_0': accessor(u, 'VEC2', 5126, 34962)},
                       'indices': accessor(t.astype(np.uint16) if t.max() < 65535 else t, 'SCALAR', 5123 if t.max() < 65535 else 5125, 34963), 'material': mi})
    images.append({'bufferView': view(data), 'mimeType': mime}); textures.append({'source': mi, 'sampler': 0})
    materials.append({'name': name, 'pbrMetallicRoughness': {'baseColorTexture': {'index': mi}, 'metallicFactor': 0, 'roughnessFactor': rough},
                      'alphaMode': mode, **({'alphaCutoff': .35, 'doubleSided': True} if mode == 'MASK' else {})})
eyes = prims['high-poly.obj'][0]; L, R = eyes[eyes[:, 0] > 0].mean(0), eyes[eyes[:, 0] < 0].mean(0)
gltf = {'asset': {'version': '2.0', 'generator': 'tools/chars/jesus_head.py (MakeHuman CC0)'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0, 'name': 'jesus_head', 'extras': {'eyeMid': ((L + R) / 2).tolist(), 'eyeDist': float(np.linalg.norm(L - R))}}],
        'meshes': [{'name': 'jesus_head', 'primitives': primitives}], 'materials': materials, 'textures': textures, 'images': images,
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}], 'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(bin_)}]}
js = json.dumps(gltf, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
while len(bin_) % 4: bin_.append(0)
glb = struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(bin_)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bin_), 0x004E4942) + bytes(bin_)
OUT.write_bytes(glb)
print(OUT, len(glb), 'bytes;', {k: len(v[0]) for k, v in prims.items()}, 'eyeDist', round(gltf['nodes'][0]['extras']['eyeDist'], 4))
