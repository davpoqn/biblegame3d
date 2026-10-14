# MakeHuman(CC0) 머리: 얼굴·눈·눈썹·속눈썹 + 머리카락 몇 가지 + 수염 두 가지를 한 파일에 담는다 (남녀 하나씩).
# 얼굴은 모두 같고(사용자 뜻), 엔진(kit.js dressHead)이 사람마다 피부색·머리카락·수염과 그 색을 골라 보인다.
# 머리카락·눈썹·수염 텍스처는 밝은 회색으로 바꿔 두고 엔진이 색을 곱한다. 피부도 엔진이 색을 곱한다.
#   python3 tools/chars/mh_heads.py   → assets/chars/mh_head_m.glb, mh_head_f.glb
# 재료: assets/raw/mh/ (tools/chars/mh_build.py), 수염: assets/raw/jesus/의 beard_sigmund (MakeHuman Community, CC0)
import io, json, struct, pathlib
import numpy as np
from PIL import Image

S = pathlib.Path(__file__).resolve().parents[2]
RAW = S / 'assets/raw/mh'
NECK = .14   # 눈 높이에서 이만큼(m) 아래로 목을 자른다 (옷깃이 가린다)
HAIR = .19   # 긴 머리카락은 눈 높이에서 이만큼 아래(어깨)에서 자른다


def tex(sex, key):
    """원본 png는 크니 처음 한 번 줄여 webp로 바꿔 둔다"""
    p = RAW / f'tex_{sex}/{key}'
    if (p.with_suffix('.png')).exists():
        im = Image.open(p.with_suffix('.png')); im.thumbnail((1024, 1024), Image.LANCZOS)
        im.save(p.with_suffix('.webp'), quality=90); p.with_suffix('.png').unlink()
    return Image.open(p.with_suffix('.webp'))


def to_gltf(P): return np.stack([P[:, 0], P[:, 2], -P[:, 1]], 1)  # Blender(Z 위) → glTF(Y 위)


def part(V, T, UV, keep=None):
    """삼각형 목록 → (위치, 법선, uv, 인덱스). 모서리 uv가 다르면 정점을 나눈다"""
    if keep is not None: sel = keep[T].all(1); T, UV = T[sel], UV[sel]
    acc = np.zeros_like(V)
    for t in T:
        n = np.cross(V[t[1]] - V[t[0]], V[t[2]] - V[t[0]])
        acc[t] += n
    idx, pos, nor, uv, tri = {}, [], [], [], []
    for t, u in zip(T, UV):
        for i, (a, b) in zip(t, u):
            k = (int(i), round(float(a), 5), round(float(b), 5))
            if k not in idx:
                idx[k] = len(pos); pos.append(V[i]); n = acc[i]; nor.append(n / (np.linalg.norm(n) or 1)); uv.append([a, 1 - b])
            tri.append(idx[k])
    return np.array(pos, np.float32), np.array(nor, np.float32), np.array(uv, np.float32), np.array(tri, np.uint32)


def gray(im, gain=1.):
    """색을 빼고 밝기를 고르게(평균 0.8) — 엔진이 곱하는 색이 거의 그대로 보이게"""
    a = np.asarray(im.convert('RGBA')).astype(np.float32)
    lum = a[..., :3] @ [.3, .59, .11]; m = a[..., 3] > 40
    lum = lum / (lum[m].mean() if m.any() else 128) * 204 * gain
    return Image.fromarray(np.stack([np.clip(lum, 0, 255), a[..., 3]], -1).astype(np.uint8), 'LA')  # 회색+투명이면 파일이 작다


def png(im, size): im = im.resize((size, size), Image.LANCZOS); b = io.BytesIO(); im.save(b, 'PNG', optimize=True); return b.getvalue(), 'image/png'
def jpg(im, size): im = im.convert('RGB'); im.thumbnail((size, size), Image.LANCZOS); b = io.BytesIO(); im.save(b, 'JPEG', quality=86); return b.getvalue(), 'image/jpeg'


def beards(D):
    """예수님 모델의 수염(beard_sigmund)을 이 얼굴로 옮긴다: 가까운 얼굴 정점들이 움직인 만큼 같이 옮긴다. 짧은 수염은 얼굴 쪽으로 당기고 아래를 자른다"""
    V, groups, T, n = [], {}, [], 0
    g = None
    for l in open(S / 'assets/raw/jesus/jesus1.exports.obj', encoding='utf8'):
        if l.startswith('v '): V.append([float(x) for x in l.split()[1:4]])
        elif l.startswith('vt '): T.append([float(x) for x in l.split()[1:3]])
        elif l.startswith('g '): g = l.split()[1]
        elif l.startswith('f ') and g == 'beard_sigmund.obj':
            groups.setdefault(g, []).append([(int(a.split('/')[0]) - 1, int(a.split('/')[1]) - 1) for a in l.split()[1:]])
    V = np.array(V) * .1; V = np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1)  # 데시미터 Y 위 → 미터 Z 위
    J, M = V[:13380], D['body_V'].astype(float)
    faces = groups['beard_sigmund.obj']
    ids = sorted({i for f in faces for i, _ in f}); B = V[ids]
    near = np.argsort(((B[:, None, :] - J[None, :, :]) ** 2).sum(-1), 1)[:, :4]
    d = np.sqrt(((B[:, None, :] - J[near]) ** 2).sum(-1)); w = 1 / (d + 1e-4); w /= w.sum(1, keepdims=True)
    B2 = B + (w[..., None] * (M[near] - J[near])).sum(1)
    anchor = M[near[:, 0]]
    tri, uvs = [], []
    loc = {v: k for k, v in enumerate(ids)}
    for f in faces:
        for k in range(1, len(f) - 1):
            c = [f[0], f[k], f[k + 1]]; tri.append([loc[i] for i, _ in c]); uvs.append([T[t] for _, t in c])
    tri, uvs = np.array(tri), np.array(uvs, np.float32)
    eye_z = D['eyes_V'][:, 2].mean()
    short = anchor + (B2 - anchor) * .45
    keep = short[:, 2] > eye_z - .125
    return {'beard_full': (B2, tri, uvs, None), 'beard_short': (short, tri, uvs, keep)}


for sex in ('m', 'f'):
    D = np.load(RAW / f'mh_{sex}.npz')
    eye_z = float(D['eyes_V'][:, 2].mean())
    P = {}
    bv = D['body_V'].astype(float)
    P['face'] = part(to_gltf(bv), D['body_T'], D['body_UV'], keep=bv[:, 2] > eye_z - NECK)
    # 머릿수건·면사포·투구를 쓴 사람용: 앞얼굴만 (정수리·뒷머리·귀는 덮개가 가리니 빼서 덮개 밖으로 비치지 않게)
    eye_y = float(D['eyes_V'][:, 1].mean())  # Blender에서 얼굴은 -Y 쪽
    P['face_cov'] = part(to_gltf(bv), D['body_T'], D['body_UV'], keep=(bv[:, 2] > eye_z - NECK) & (bv[:, 2] < eye_z + .045) & (bv[:, 1] < eye_y + .07))
    for k in ('eyes', 'brows', 'lashes'): P[k] = part(to_gltf(D[f'{k}_V'].astype(float)), D[f'{k}_T'], D[f'{k}_UV'])
    hairs = [k[:-2] for k in D.files if k.startswith('hair_') and k.endswith('_V')]
    for k in hairs:
        hv = D[f'{k}_V'].astype(float)
        P[k] = part(to_gltf(hv), D[f'{k}_T'], D[f'{k}_UV'], keep=hv[:, 2] > eye_z - HAIR)
    if sex == 'm':
        for k, (bv2, t, u, keep) in beards(D).items(): P[k] = part(to_gltf(bv2), t, u, keep)
    # 피부: 머리 부분만 잘라 쓴다(UV를 그 안으로 옮긴다)
    skin = tex(sex, 'skin').convert('RGB'); W, H = skin.size
    uvb = P['face'][2]
    x0, y0 = max(0, int(uvb[:, 0].min() * W) - 8), max(0, int(uvb[:, 1].min() * H) - 8)
    x1, y1 = min(W, int(uvb[:, 0].max() * W) + 8), min(H, int(uvb[:, 1].max() * H) + 8)
    crop = skin.crop((x0, y0, x1, y1)); cw, ch = crop.size
    for u_ in (uvb, P['face_cov'][2]): u_[:, 0] = (u_[:, 0] * W - x0) / cw; u_[:, 1] = (u_[:, 1] * H - y0) / ch
    avg = np.asarray(crop).reshape(-1, 3).mean(0) / 255
    beard_im = Image.open(S / 'assets/raw/jesus/textures/beard_sigmund_diffuse.webp')
    face_im = jpg(crop, 1024)
    MATS = {'face': (face_im, 'OPAQUE', .6), 'face_cov': (face_im, 'OPAQUE', .6), 'eyes': (jpg(tex(sex, 'eyes'), 256), 'OPAQUE', .25),
            'brows': (png(gray(tex(sex, 'brows')), 256), 'MASK', .8), 'lashes': (png(gray(tex(sex, 'lashes'), .5), 128), 'MASK', .8)}
    for k in hairs: MATS[k] = (png(gray(tex(sex, k)), 512), 'MASK', .7)
    if sex == 'm':
        b = png(gray(beard_im), 512); MATS['beard_full'] = (b, 'MASK', .8); MATS['beard_short'] = (b, 'MASK', .8)
    # --- glb 쓰기 (노드 하나에 메시 하나, 이름으로 고른다) ---
    bin_, views, accs = bytearray(), [], []
    def view(data, target=None):
        while len(bin_) % 4: bin_.append(0)
        views.append({'buffer': 0, 'byteOffset': len(bin_), 'byteLength': len(data), **({'target': target} if target else {})}); bin_.extend(data); return len(views) - 1
    def accessor(arr, typ, comp, target, mm=False):
        a = {'bufferView': view(arr.tobytes(), target), 'componentType': comp, 'count': len(arr), 'type': typ}
        if mm: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        accs.append(a); return len(accs) - 1
    meshes, materials, textures, images, nodes = [], [], [], [], []
    img_of = {}
    for name, (p, n, u, t) in P.items():
        (data, mime), mode, rough = MATS[name]
        if data not in img_of:
            images.append({'bufferView': view(data), 'mimeType': mime}); textures.append({'source': len(images) - 1, 'sampler': 0}); img_of[data] = len(textures) - 1
        materials.append({'name': 'mh_' + name.split('_')[0], 'pbrMetallicRoughness': {'baseColorTexture': {'index': img_of[data]}, 'metallicFactor': 0, 'roughnessFactor': rough},
                          'alphaMode': mode, **({'alphaCutoff': .35, 'doubleSided': True} if mode == 'MASK' else {})})
        idx = t.astype(np.uint16) if t.max() < 65535 else t
        meshes.append({'name': name, 'primitives': [{'attributes': {'POSITION': accessor(p, 'VEC3', 5126, 34962, True), 'NORMAL': accessor(n, 'VEC3', 5126, 34962), 'TEXCOORD_0': accessor(u, 'VEC2', 5126, 34962)},
                                                     'indices': accessor(idx, 'SCALAR', 5123 if idx.dtype == np.uint16 else 5125, 34963), 'material': len(materials) - 1}]})
        nodes.append({'mesh': len(meshes) - 1, 'name': name})
    e = to_gltf(D['eyes_V'].astype(float)); L, R = e[e[:, 0] > 0].mean(0), e[e[:, 0] < 0].mean(0)
    root = {'name': f'mh_head_{sex}', 'children': list(range(len(nodes))),
            'extras': {'eyeMid': ((L + R) / 2).tolist(), 'eyeDist': float(np.linalg.norm(L - R)), 'skinAvg': avg.tolist(), 'hairs': hairs}}
    nodes.append(root)
    gltf = {'asset': {'version': '2.0', 'generator': 'tools/chars/mh_heads.py (MakeHuman CC0)'}, 'scene': 0, 'scenes': [{'nodes': [len(nodes) - 1]}],
            'nodes': nodes, 'meshes': meshes, 'materials': materials, 'textures': textures, 'images': images,
            'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}], 'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(bin_)}]}
    js = json.dumps(gltf, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
    while len(bin_) % 4: bin_.append(0)
    glb = struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(bin_)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bin_), 0x004E4942) + bytes(bin_)
    out = S / f'assets/chars/mh_head_{sex}.glb'; out.write_bytes(glb)
    print(out.name, len(glb), 'bytes', {k: len(v[3]) // 3 for k, v in P.items()}, 'skinAvg', np.round(avg, 3).tolist())
