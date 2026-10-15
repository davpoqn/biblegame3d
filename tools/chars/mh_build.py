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
    # 예수님 (사용자 요청 2026-10-15: 넙대대하지 않게 다시 — 길고 좁은 얼굴, 높은 광대, 좁고 각진 턱, 곧은 코, 짙은 눈썹. 연출: 성경에는 생김새가 없다)
    'j': dict(macros={'gender': 1., 'age': .56, 'muscle': .55, 'weight': .35, 'height': .55, 'african': .15, 'asian': .05, 'caucasian': .8},
              skin='young_caucasian_male', brow='eyebrow003', hairs=['long01', 'short02', 'short04'],
              targets={'head/head-oval': .4, 'head/head-scale-horiz-decr': .3, 'head/head-fat-decr': .5, 'head/head-scale-vert-incr': .15,
                       'forehead/forehead-temple-decr': .5,
                       **{f'cheek/{s}-cheek-{k}': w for s in 'lr' for k, w in [('bones-incr', .55), ('volume-decr', .6), ('inner-decr', .3)]},
                       'chin/chin-width-decr': .45, 'chin/chin-prominent-incr': .25, 'chin/chin-bones-decr': .3, 'chin/chin-triangle': .2, 'chin/chin-height-incr': .15,
                       'nose/nose-scale-horiz-decr': .3, 'nose/nose-nostrils-width-decr': .35, 'nose/nose-point-width-decr': .3, 'nose/nose-greek-incr': .25,
                       'nose/nose-hump-decr': .3, 'nose/nose-scale-vert-incr': .15,
                       'mouth/mouth-lowerlip-volume-decr': .35, 'mouth/mouth-upperlip-volume-decr': .35, 'mouth/mouth-angles-up': .15,
                       'eyebrows/eyebrows-trans-down': .25}),
}
WHO = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['m', 'f']  # blender -b -P mh_build.py -- j  → 예수님만

# 얼굴 여러 개 (사용자 요청 2026-10-15: "복제인간 처럼 보이게 말고, 남자 6~7개 여자 3~4개, 여자는 이쁘게"). 머리만 뽑는다 → assets/raw/mh/heads_m.npz, heads_f.npz
#   blender -b -P tools/chars/mh_build.py -- heads
LR = lambda part, name, w: {f'{part}/{s}-{name}': w for s in 'lr'}
HEADS = {
    'm': [  # (이름, 나이·몸무게 등 바꿀 값, 얼굴 세부)
        ('lean', {'age': .5, 'weight': .35, 'muscle': .55}, {'head/head-oval': .3, **LR('cheek', 'cheek-bones-incr', .4), **LR('cheek', 'cheek-volume-decr', .4), 'chin/chin-width-decr': .3, 'nose/nose-greek-incr': .2, 'mouth/mouth-lowerlip-volume-decr': .2, 'mouth/mouth-upperlip-volume-decr': .2}),
        ('square', {'age': .55, 'weight': .5, 'muscle': .75}, {'head/head-square': .4, 'chin/chin-prominent-incr': .35, 'chin/chin-bones-incr': .3, 'nose/nose-hump-incr': .25, 'eyebrows/eyebrows-trans-down': .2, 'forehead/forehead-nubian-incr': .2}),
        ('young', {'age': .42, 'weight': .4, 'muscle': .45}, {'head/head-round': .15, 'nose/nose-point-up': .2, **LR('eyes', 'eye-scale-incr', .15), 'chin/chin-height-decr': .1, 'head/head-scale-horiz-decr': .15}),
        ('old', {'age': .88, 'weight': .35, 'muscle': .4}, {**LR('cheek', 'cheek-volume-decr', .5), **LR('cheek', 'cheek-bones-incr', .3), 'nose/nose-scale-vert-incr': .2, 'nose/nose-hump-incr': .3, **LR('eyes', 'eye-bag-incr', .3), 'head/head-age-incr': .4}),
        ('heavy', {'age': .6, 'weight': .9, 'muscle': .35}, {'head/head-fat-incr': .6, **LR('cheek', 'cheek-volume-incr', .5), 'neck/neck-double-incr': .5, 'head/head-round': .3}),
        ('long', {'age': .62, 'weight': .45, 'muscle': .5}, {'head/head-oval': .2, 'head/head-scale-vert-incr': .2, 'nose/nose-hump-incr': .6, 'nose/nose-point-down': .3, 'nose/nose-scale-vert-incr': .25, 'chin/chin-prominent-incr': .2}),
        ('dark', {'age': .5, 'weight': .5, 'muscle': .6, 'african': .5, 'caucasian': .45}, {'head/head-oval': .2, 'chin/chin-width-decr': .2, **LR('cheek', 'cheek-bones-incr', .3)}),
    ],
    'f': [
        ('fair', {'age': .4, 'weight': .4, 'muscle': .45}, {'head/head-oval': .4, **LR('cheek', 'cheek-bones-incr', .35), **LR('cheek', 'cheek-volume-decr', .3), 'chin/chin-width-decr': .35, 'nose/nose-scale-horiz-decr': .3, 'nose/nose-point-up': .15, 'mouth/mouth-upperlip-volume-incr': .15, **LR('eyes', 'eye-scale-incr', .12)}),
        ('warm', {'age': .45, 'weight': .45, 'african': .35, 'caucasian': .6}, {'head/head-oval': .25, 'nose/nose-scale-horiz-decr': .1, 'mouth/mouth-upperlip-volume-incr': .25, 'mouth/mouth-lowerlip-volume-incr': .2, **LR('cheek', 'cheek-bones-incr', .3)}),
        ('girl', {'age': .36, 'weight': .42}, {'head/head-round': .2, **LR('eyes', 'eye-scale-incr', .18), 'nose/nose-point-width-decr': .25, 'chin/chin-width-decr': .3}),
        ('mother', {'age': .7, 'weight': .55}, {'head/head-oval': .2, 'nose/nose-scale-vert-incr': .1, **LR('cheek', 'cheek-bones-incr', .15)}),
    ]}
HEAD_BROW = {'m': 'eyebrow008', 'f': 'eyebrow010'}  # 남자는 짙은 눈썹
HEAD_HAIRS = {'m': ['short02', 'short03', 'short04', 'long01'], 'f': ['long01', 'braid01', 'ponytail01']}  # 여자 단발(bob02)은 요즘 머리 같아 뺐다


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
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='FIXED', ngon_method='EAR_CLIP')  # 모양과 상관없이 같은 삼각형 (얼굴 여러 개가 면을 같이 쓴다)
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
TARGETS = imp('mpfb.services.locationservice', 'LocationService').get_mpfb_data('targets')


def head_variants(sex):
    """얼굴 여러 개: 같은 몸·같은 눈썹·머리카락으로 얼굴만 바꿔 위치만 뽑는다 (삼각형·UV는 첫 얼굴 것을 함께 쓴다)"""
    data = {'names': np.array([n for n, _, _ in HEADS[sex]])}; texd = f'{OUT}/tex_{sex}'
    parts = [('eyes', 'eyes', 'high-poly.mhclo', 'Eyes'), ('brows', 'eyebrows', HEAD_BROW[sex] + '.mhclo', 'Eyebrows'), ('lashes', 'eyelashes', 'eyelashes01.mhclo', 'Eyelashes')]
    parts += [(f'hair_{n}', 'hair', n + '.mhclo', 'Clothes') for n in HEAD_HAIRS[sex]]
    for vi, (name, mac, tg) in enumerate(HEADS[sex]):
        for o in list(bpy.data.objects): bpy.data.objects.remove(o)
        h = HumanService.create_human()
        for k, v in {**SPECS[sex]['macros'], **mac}.items(): HOP.set_value(k, v, entity_reference=h)
        TargetService.reapply_macro_details(h)
        for t, w in tg.items(): TargetService.load_target(h, os.path.join(TARGETS, t + '.target.gz'), weight=w)
        V, T, UV = mesh_arrays(h, keep_vert=13380)
        got = {'body': (V[:13380], T, UV)}
        for key, sub, f, typ in parts:
            before = set(bpy.data.objects)
            HumanService.add_mhclo_asset(find(sub, f), h, asset_type=typ, subdiv_levels=0)
            o = [o for o in bpy.data.objects if o not in before and o.type == 'MESH'][0]
            got[key] = mesh_arrays(o)
            if vi == 0:
                tex = diffuse_of(find('eyes', 'brown.mhmat')) if key == 'eyes' else diffuse_of(os.path.join(os.path.dirname(find(sub, f)), f.replace('.mhclo', '.mhmat')))
                shutil.copy(tex, f'{texd}/{key}.png')
            if key.startswith('hair_'): bpy.data.objects.remove(o)
        for key, (V, T, UV) in got.items():
            if vi == 0: data[f'{key}_T'], data[f'{key}_UV'] = T, UV
            elif not np.array_equal(data[f'{key}_T'], T): raise RuntimeError(f'{name} {key}: 삼각형이 다르다')
            data[f'v{vi}_{key}_V'] = V
        print('HEAD', sex, vi, name)
    np.savez_compressed(f'{OUT}/heads_{sex}.npz', **data)


if WHO == ['heads']:
    for sex in ('m', 'f'): head_variants(sex)
    WHO = []
for sex, sp in [(k, SPECS[k]) for k in WHO]:
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    h = HumanService.create_human()
    for k, v in sp['macros'].items(): HOP.set_value(k, v, entity_reference=h)
    TargetService.reapply_macro_details(h)
    for t, w in sp.get('targets', {}).items(): TargetService.load_target(h, os.path.join(TARGETS, t + '.target.gz'), weight=w)  # 얼굴 세부 (머리카락·눈썹은 이 모양에 맞춰 붙는다)
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
