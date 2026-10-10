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
