# MakeHuman(MPFB2, CC0)으로 남녀 사람을 하나씩 만들어 손·발·머리 재료를 assets/raw/mh/에 뽑는다.
# 얼굴은 모두 같고(사용자 뜻), 사람마다 다른 것은 피부색·머리카락·수염·옷 색이다. 그건 엔진(kit.js)이 고른다.
#   준비(처음 한 번): Blender 4.2, MPFB2 확장, MakeHuman 기본 자산(CC0) — PLAN.md 2장 '메모'
#   /opt/mh/blender-4.2.3-linux-x64/blender -b -P tools/chars/mh_build.py   → assets/raw/mh/mh_m.npz, mh_f.npz, 텍스처
# 뼈대는 MPFB의 game_engine 뼈대(뼈 이름이 UAL 마네킹과 같다: hand_l, index_01_l, foot_l, ball_l …)
import bpy, bmesh, sys, os, importlib, shutil
import numpy as np

ASSETS = os.environ.get('MH_ASSETS', '/opt/mh/assets')
OUT = 'assets/raw/mh'
SPECS = {
    # 나이·근육·몸무게는 0~1. 인종 비율은 중동 사람에 가깝게 섞는다
    'm': dict(macros={'gender': 1., 'age': .55, 'muscle': .6, 'weight': .5, 'height': .5, 'african': .2, 'asian': .05, 'caucasian': .75},
              skin='middleage_caucasian_male', brow='eyebrow001', hairs=['short02', 'short03', 'short04', 'long01']),
    'f': dict(macros={'gender': 0., 'age': .45, 'muscle': .45, 'weight': .5, 'height': .5, 'african': .2, 'asian': .05, 'caucasian': .75},
              skin='middleage_caucasian_female', brow='eyebrow010', hairs=['long01', 'braid01', 'ponytail01', 'bob02']),
}


def imp(pkg, key):
    for m in list(sys.modules):
        if m.endswith(pkg): return getattr(importlib.import_module(m), key)
    raise ValueError(pkg)


ext = [a for a in bpy.context.preferences.addons.keys() if a.endswith('mpfb')][0]
bpy.context.preferences.addons[ext].preferences.mpfb_second_root = ASSETS
imp('mpfb.services.locationservice', 'LocationService').update_second_root()
HumanService = imp('mpfb.services.humanservice', 'HumanService')
AssetService = imp('mpfb.services.assetservice', 'AssetService')
HOP = imp('mpfb.entities.objectproperties', 'HumanObjectProperties')
TargetService = imp('mpfb.services.targetservice', 'TargetService')


def find(sub, name):
    p = AssetService.find_asset_absolute_path(name, asset_subdir=sub)
    if not p: raise RuntimeError(f'자산 없음: {sub}/{name}')
    return p


def diffuse_of(mhmat):
    for l in open(mhmat, encoding='utf8'):
        if l.startswith('diffuseTexture'): return os.path.join(os.path.dirname(mhmat), l.split(None, 1)[1].strip())
    return None


def mesh_arrays(obj, keep_vert=None):
    """모디파이어 없이(형태 키는 반영) 삼각형으로: 위치(월드), 삼각형, 모서리별 UV"""
    mods = [(m, m.show_viewport) for m in obj.modifiers]
    for m, _ in mods: m.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get(); ev = obj.evaluated_get(dg); me = ev.to_mesh()
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.triangulate(bm, faces=bm.faces[:])
    uvl = bm.loops.layers.uv.active
    mw = obj.matrix_world
    V = np.array([tuple(mw @ v.co) for v in bm.verts], np.float32)
    tris, uvs = [], []
    for f in bm.faces:
        ids = [l.vert.index for l in f.loops]
        if keep_vert is not None and not all(i < keep_vert for i in ids): continue
        tris.append(ids); uvs.append([tuple(l[uvl].uv) for l in f.loops] if uvl else [(0, 0)] * 3)
    bm.free(); ev.to_mesh_clear()
    for m, s in mods: m.show_viewport = s
    return V, np.array(tris, np.int32), np.array(uvs, np.float32)


os.makedirs(OUT, exist_ok=True)
for sex, sp in SPECS.items():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    h = HumanService.create_human()
    for k, v in sp['macros'].items(): HOP.set_value(k, v, entity_reference=h)
    TargetService.reapply_macro_details(h)
    rig = HumanService.add_builtin_rig(h, 'game_engine', import_weights=True)
    data = {}
    # 몸: 앞의 13380개가 MakeHuman 기본 몸 정점(그 뒤는 도우미 정점)
    V, T, UV = mesh_arrays(h, keep_vert=13380)
    data['body_V'] = V[:13380]; data['body_T'] = T; data['body_UV'] = UV
    names = [b.name for b in rig.data.bones]
    W = np.zeros((13380, len(names)), np.float32)
    gi = {g.index: g.name for g in h.vertex_groups}
    for v in h.data.vertices[:13380]:
        for g in v.groups:
            n = gi[g.group]
            if n in names: W[v.index, names.index(n)] = g.weight
    data['body_W'] = W.astype(np.float16)
    data['bone_names'] = np.array(names)
    mw = rig.matrix_world
    data['bone_head'] = np.array([tuple(mw @ b.head_local) for b in rig.data.bones], np.float32)
    data['bone_tail'] = np.array([tuple(mw @ b.tail_local) for b in rig.data.bones], np.float32)
    texd = f'{OUT}/tex_{sex}'; os.makedirs(texd, exist_ok=True)
    skin = find('skins', sp['skin'] + '.mhmat'); shutil.copy(diffuse_of(skin), f'{texd}/skin.png')
    # 눈·눈썹·속눈썹·머리카락: mhclo를 몸에 맞춘 뒤 뽑는다
    parts = [('eyes', 'eyes', 'high-poly.mhclo', 'Eyes'), ('brows', 'eyebrows', sp['brow'] + '.mhclo', 'Eyebrows'), ('lashes', 'eyelashes', 'eyelashes01.mhclo', 'Eyelashes')]
    parts += [(f'hair_{n}', 'hair', n + '.mhclo', 'Clothes') for n in sp['hairs']]
    for key, sub, f, typ in parts:
        before = set(bpy.data.objects)
        HumanService.add_mhclo_asset(find(sub, f), h, asset_type=typ, subdiv_levels=0)
        new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
        o = new[0]
        V, T, UV = mesh_arrays(o)
        data[f'{key}_V'], data[f'{key}_T'], data[f'{key}_UV'] = V, T, UV
        tex = diffuse_of(find('eyes', 'brown.mhmat')) if key == 'eyes' else diffuse_of(os.path.join(os.path.dirname(find(sub, f)), f.replace('.mhclo', '.mhmat')))
        shutil.copy(tex, f'{texd}/{key}.png')
        if key.startswith('hair_'): bpy.data.objects.remove(o)  # 머리카락은 하나씩 맞춰 본다
    np.savez_compressed(f'{OUT}/mh_{sex}.npz', **data)
    print('MH', sex, {k: v.shape for k, v in data.items()}, 'height', float(data['body_V'][:, 2].max() - data['body_V'][:, 2].min()))
