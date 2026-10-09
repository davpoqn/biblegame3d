# 남녀 마네킹에 시대 의복을 입혀 GLB로 내보낸다 (Blender bpy).
#   python3 tools/chars/build_chars.py            → assets/chars/build/char_m.glb, char_f.glb, props.glb
#   python3 tools/chars/build_chars.py --preview  → 위 파일 + assets/chars/preview/*.png
# 옷은 몸의 단면을 감싸는 고리를 쌓아 만든다 (마네킹이 조각으로 되어 있어 표면을 부풀리면 틈이 생긴다).
# 뼈대는 UAL1 원본을 그대로 쓰므로 anims.glb의 클립이 남녀 모두에 맞는다.
import bpy, math, json, sys, os
import numpy as np
from mathutils import Vector, kdtree

RAW, OUT = 'assets/raw', 'assets/chars/build'
OUTFITS = json.load(open('assets/chars/outfits.json'))
N = 24  # 고리 하나의 점 수

ARM = ('clavicle', 'upperarm', 'lowerarm', 'hand', 'index', 'middle', 'pinky', 'ring', 'thumb')
TORSO = {'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'clavicle_l', 'clavicle_r'}
HEADB = {'Head', 'neck_01', 'spine_03', 'spine_02', 'clavicle_l', 'clavicle_r'}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_ual1():
    bpy.ops.import_scene.gltf(filepath=f'{RAW}/UAL1_Standard.glb')  # 기본 bone_heuristic → 원본 뼈대 유지
    return bpy.data.objects['Armature'], bpy.data.objects['Mannequin']


class Body:
    """몸 정점, 법선, 정점별 뼈 가중치, 주로 따르는 뼈"""
    def __init__(self, obj, arm):
        me = obj.data
        mw = obj.matrix_world
        self.P = np.array([tuple(mw @ v.co) for v in me.vertices])
        self.Nn = np.array([tuple((mw.to_3x3() @ v.normal).normalized()) for v in me.vertices])
        names = [g.name for g in obj.vertex_groups]
        self.W = [{names[g.group]: g.weight for g in v.groups if g.weight > 0.01} for v in me.vertices]
        self.dom = [max(w, key=w.get) if w else 'root' for w in self.W]
        self.bone = {b.name: arm.matrix_world @ b.head_local for b in arm.data.bones}
        self.kd = {}

    def mask(self, f):
        return np.array([f(d) for d in self.dom])

    def tree(self, key, m):
        if key not in self.kd:
            idx = np.nonzero(m)[0]
            t = kdtree.KDTree(len(idx))
            for i in idx: t.insert(self.P[i], int(i))
            t.balance()
            self.kd[key] = t
        return self.kd[key]


is_arm = lambda d: d.startswith(ARM) and not d.startswith('clavicle')
is_head = lambda d: d == 'Head'
is_leg = lambda d: d.startswith(('thigh', 'calf', 'foot', 'ball'))


def frame(o, a, u):
    a = Vector(a).normalized(); u = Vector(u); u = (u - a * u.dot(a)).normalized()
    return Vector(o), a, u, a.cross(u)


def hull_rings(P, fr, ts, dt=0.03):
    """각 높이 t에서 단면의 볼록 껍질 지지함수 r(θ)"""
    o, a, u, v = fr
    D = P - np.array(o)
    s, x, y = D @ np.array(a), D @ np.array(u), D @ np.array(v)
    th = np.linspace(0, 2 * math.pi, N, endpoint=False)
    c, sn = np.cos(th), np.sin(th)
    rings, last = [], None
    for t in ts:
        m = np.abs(s - t) < dt
        if m.sum() >= 3:
            bx, by = x[m], y[m]
            cu, cv = (bx.min() + bx.max()) / 2, (by.min() + by.max()) / 2
            r = np.max(np.outer(c, bx - cu) + np.outer(sn, by - cv), axis=1)
            last = (cu, cv, np.maximum(r, 0.01))
        rings.append(last)
    first = next(r for r in rings if r is not None)
    return [r if r is not None else first for r in rings]


def smooth(rings, passes=2):
    R = np.array([r[2] for r in rings])
    for _ in range(passes):
        R = 0.5 * R + 0.25 * (np.roll(R, 1, 1) + np.roll(R, -1, 1))
        if len(R) > 2: R[1:-1] = 0.5 * R[1:-1] + 0.25 * (R[:-2] + R[2:])
    R = np.maximum(R, [r[2] for r in rings])  # 매끄럽게 하되 껍질 안으로는 들어가지 않게
    return [(r[0], r[1], R[i]) for i, r in enumerate(rings)]


def build(name, fr, ts, rings, off, cut=None, cap=None, mat=None):
    """고리들을 이어 메시를 만든다. off(t, θ) → 바깥으로 더할 거리. cut(t, θ) → 면을 뺄지"""
    o, a, u, v = fr
    th = np.linspace(0, 2 * math.pi, N, endpoint=False)
    verts, faces = [], []
    for t, (cu, cv, r) in zip(ts, rings):
        for j in range(N):
            rr = r[j] + off(t, th[j])
            verts.append(o + a * t + u * (cu + rr * math.cos(th[j])) + v * (cv + rr * math.sin(th[j])))
    for i in range(len(ts) - 1):
        for j in range(N):
            k = (j + 1) % N
            if cut and cut((ts[i] + ts[i + 1]) / 2, (th[j] + th[k] + (2 * math.pi if k == 0 else 0)) / 2):
                continue
            faces.append((i * N + j, i * N + k, (i + 1) * N + k, (i + 1) * N + j))
    if cap is not None:  # 위쪽 끝을 한 점으로 모은다
        verts.append(o + a * cap + u * rings[-1][0] + v * rings[-1][1])
        top, base = len(verts) - 1, (len(ts) - 1) * N
        faces += [(base + j, base + (j + 1) % N, top) for j in range(N)]
    return mesh_obj(name, verts, faces, mat)


def mesh_obj(name, verts, faces, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in verts], [], faces)
    me.validate(); me.update()
    for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if mat: me.materials.append(material(mat))
    return ob


def material(name):
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = False  # 앞이 트인 옷의 안쪽이 보이도록 양면
    col = OUTFITS['default_colors'].get(name, '#bbbbbb')
    rgb = [int(col[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*[c ** 2.2 for c in rgb], 1)
    bsdf.inputs['Roughness'].default_value = 0.35 if name in ('metal', 'gold') else 0.9
    bsdf.inputs['Metallic'].default_value = 0.8 if name in ('metal', 'gold') else 0.0
    return m


def push_out(ob, body, m, gap, key, zmin=-9, iters=2):
    """어깨 윗면처럼 위를 향한 몸 표면에서만 옷 정점을 바깥으로 민다"""
    t = body.tree(key, m)
    for _ in range(iters):
        for v in ob.data.vertices:
            if v.co.z < zmin: continue
            for (q, i, d) in t.find_n(v.co, 4):
                if body.Nn[i][2] < 0.3: continue
                n = Vector(body.Nn[i]); h = (v.co - q).dot(n)
                if h < gap: v.co += n * (gap - h)


def skin(ob, body, allowed, default, k=16, rule=None):
    """가까운 몸 정점의 가중치를 거리 반비례로 섞어 옮긴다. rule(p) → 직접 정한 가중치(dict) 또는 None"""
    t = body.tree('all', np.ones(len(body.P), bool))
    acc = []
    for v in ob.data.vertices:
        r = rule(v.co) if rule else None
        wr, al = (r if isinstance(r, tuple) else (r, 1.0)) if r is not None else (None, 0.0)
        w = {}
        if al < 1:
            for (q, i, d) in t.find_n(v.co, k):
                for g, x in body.W[i].items():
                    if g in allowed: w[g] = w.get(g, 0) + x / (d + 1e-3)
            if not w: w = {default: 1}
            s0 = sum(w.values()); w = {g: x / s0 * (1 - al) for g, x in w.items()}
        if wr:
            s1 = sum(wr.values())
            for g, x in wr.items(): w[g] = w.get(g, 0) + x / s1 * al
        top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
        s = sum(x for _, x in top)
        acc.append([(g, x / s) for g, x in top])
    for i, ws in enumerate(acc):
        for g, x in ws:
            vg = ob.vertex_groups.get(g) or ob.vertex_groups.new(name=g)
            vg.add([i], x, 'REPLACE')


# 옷 아래 몸을 속옷 색으로 칠할 부분 (주로 따르는 뼈 기준). 옷 사이로 몸이 비쳐도 살이 아니라 천으로 보이게
UNDER = [('under_chest', ('spine_03', 'clavicle')), ('under_body', ('pelvis', 'spine_01', 'spine_02')),
         ('under_arm', ('upperarm',)), ('under_thigh', ('thigh',)), ('under_calf', ('calf',))]


def paint_under(obj, body):
    me = obj.data
    idx = {}
    for name, _ in UNDER:
        me.materials.append(material(name)); idx[name] = len(me.materials) - 1
    for p in me.polygons:
        doms = [body.dom[v] for v in p.vertices]
        d = max(set(doms), key=doms.count)
        for name, pre in UNDER:
            if d.startswith(pre): p.material_index = idx[name]; break


def role_colors(spec):
    """재질별 색: 기본색 + 속옷색(under) + 살색으로 둘 곳(bare) + 개별 색(colors). 엔진도 같은 규칙"""
    d = OUTFITS['default_colors']
    col = dict(d)
    for name, _ in UNDER: col[name] = spec.get('under', d['tunic'])
    for name in spec.get('bare', []): col[name] = d['M_Main']
    col.update(spec.get('colors', {}))
    return col


def attach(ob, arm):
    ob.parent = arm
    md = ob.modifiers.new('Armature', 'ARMATURE'); md.object = arm


def sstep(e0, e1, x):
    t = min(1, max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t)


# ───────────────────────── 옷 만들기 ─────────────────────────

def dress(body, arm, sex):
    B = body.bone
    z_neck, z_head = B['neck_01'].z, B['Head'].z
    z_sh = B['upperarm_l'].z + 0.03          # 어깨 윗선
    z_hip, z_knee, z_ankle = B['thigh_l'].z, B['calf_l'].z, B['foot_l'].z
    z_waist = B['spine_01'].z - 0.02          # 허리띠 자리 (튜닉 윗부분과 치마의 경계)
    x_sh = B['upperarm_l'].x
    up = frame((0, 0, 0), (0, 0, 1), (1, 0, 0))
    FRONT = 1.5 * math.pi                     # θ=270° 가 앞(-Y)
    torso_m = body.mask(lambda d: not is_arm(d) and not is_head(d))
    neck_m = body.mask(lambda d: d in ('neck_01',))
    head_m = body.mask(is_head)
    arm_m = body.mask(is_arm)
    P = body.P
    made = []

    def ang(th, c):  # θ와 c 사이 각도 차
        return abs((th - c + math.pi) % (2 * math.pi) - math.pi)

    def skirt_rule(p):
        if p.z > z_hip + 0.10: return None
        t = sstep(z_hip, z_knee, p.z)
        c = sstep(z_knee, z_ankle, p.z) * 0.6
        s = sstep(-0.07, 0.07, p.x)          # x>0 이 왼쪽 다리
        w = {'pelvis': 1 - 0.85 * t}
        th = 0.85 * t * (1 - c); ca = 0.85 * t * c
        for side, f in (('l', s), ('r', 1 - s)):
            w[f'thigh_{side}'] = th * f + 1e-6; w[f'calf_{side}'] = ca * f + 1e-6
        return w, sstep(z_hip + 0.10, z_hip - 0.02, p.z)

    def robe(name, hem, off0, flare, mat, open_front=0.0, back_only=0.0, sleeve=None, top=None, trim=None, neck=0.0, ease=0.0):
        """몸통+치마 한 벌. top: 윗선 높이(없으면 목선까지 덮개). trim=(밑단 폭, 앞섶 폭): 그 테두리만 남긴다. neck: 앞 목선을 둥글게 판다"""
        zt = top or z_sh
        ts = list(np.arange(hem, zt, 0.04)) + [zt]
        Pm = P[torso_m | body.mask(is_leg)]
        rings = smooth(hull_rings(Pm, up, ts))
        hi = max((i for i, t in enumerate(ts) if t <= z_hip), default=0)  # 엉덩이 아래로는 곧게 떨어진다 (다리 사이로 좁아지지 않음)
        for i in range(hi - 1, -1, -1):
            rings[i] = (rings[i][0], rings[i][1], np.maximum(rings[i][2], rings[i + 1][2]))
        if top is None:  # 어깨에서 목선까지 비탈
            rn = hull_rings(P[neck_m], up, [z_neck + 0.01])[0]
            sh = rings[-1]
            for s in (0.33, 0.66, 1.0):
                ts.append(zt + (z_neck + 0.02 - zt) * s + off0 * 0.7)  # 겹쳐 입은 옷이 비탈에서 붙지 않게 위로 띄움
                rings.append((sh[0] * (1 - s) + rn[0] * s, sh[1] * (1 - s) + rn[1] * s, sh[2] * (1 - s) + (rn[2] + 0.01) * s))
        cut = None
        if open_front: cut = lambda t, th: ang(th, FRONT) < open_front and t < z_neck - 0.02
        if back_only: cut = lambda t, th: ang(th, FRONT) < back_only
        if neck: cut = lambda t, th: ang(th, FRONT) < neck and t > zt - 0.07
        if trim:
            base = cut or (lambda t, th: False)
            edge = lambda t, th: t < hem + trim[0] or (open_front <= ang(th, FRONT) < open_front + trim[1] and t < z_neck - 0.02)
            cut = lambda t, th: base(t, th) or not edge(t, th)
        off = lambda t, th: off0 + ease * sstep(z_waist, z_hip, t) + (flare * (z_hip - t) / (z_hip - hem) if t < z_hip else 0)
        ob = build(name, up, ts, rings, off, cut=cut, mat=mat)
        push_out(ob, body, torso_m | body.mask(is_leg), off0 * 0.8, 'torso', zmin=zt - 0.02)
        skin(ob, body, TORSO, 'spine_02', rule=skirt_rule)
        made.append(ob)
        if sleeve:  # 소매: 팔 축을 따라 고리
            for sd, sg in (('l', 1), ('r', -1)):
                fr = frame((0, B[f'upperarm_{sd}'].y, B[f'upperarm_{sd}'].z), (sg, 0, 0), (0, 1, 0))
                xs = list(np.arange(x_sh - 0.04, x_sh + sleeve, 0.04)) + [x_sh + sleeve]
                rs = smooth(hull_rings(P[arm_m], fr, xs, dt=0.025), 1)
                so = build(f'{name}_sleeve_{sd}', fr, xs, rs, lambda t, th: off0, mat=mat)
                skin(so, body, TORSO | {f'upperarm_{sd}', f'lowerarm_{sd}'}, f'upperarm_{sd}')
                made.append(join(ob, so))
        return ob

    def head_wrap(name, z_end, off0, opening, mat, back_len=0.0, brow=0.09):
        """두건·너울: 머리를 감싸고 어깨로 흘러내린다"""
        top = P[head_m][:, 2].max()
        zs = list(np.arange(z_end, top - 0.04, 0.03)) + list(np.arange(top - 0.04, top - 0.002, 0.012))
        Pm = P[head_m | neck_m | body.mask(lambda d: d in TORSO)]
        ring_head = hull_rings(P[head_m], up, zs, dt=0.02)
        ring_low = hull_rings(Pm, up, zs, dt=0.03)
        z_chin = P[head_m][:, 2].min() + 0.02
        rings = []
        hc = hull_rings(P[head_m], up, [z_chin + 0.03])[0]
        for z, rh, rl in zip(zs, ring_head, ring_low):
            rings.append(rh if z > z_chin + 0.03 else (rl[0], rl[1], np.maximum(rl[2], hc[2])))
        rings = smooth(rings, 2)
        for i, z in enumerate(zs):  # 정수리를 둥글게 (튀어나온 곳은 아래 push_out이 다시 민다)
            if z > top - 0.06:
                k = max(0.3, math.sqrt(max(0.0, 1 - ((z - (top - 0.06)) / 0.075) ** 2)))
                rings[i] = (rings[i][0], rings[i][1], rings[i][2] * k)
        brow = z_head + brow
        cut = lambda t, th: ang(th, FRONT) < opening and t < brow
        off = lambda t, th: off0 + (back_len * sstep(z_chin, z_end, t) if ang(th, FRONT) > 2.2 else 0)
        ob = build(name, up, zs, rings, off, cut=cut, cap=top + off0 + 0.01, mat=mat)
        m = head_m | neck_m | torso_m
        push_out(ob, body, m, off0 * 0.8, 'headtorso')
        skin(ob, body, HEADB, 'Head', rule=lambda p: {'Head': 1} if p.z > z_chin + 0.03 else None)
        made.append(ob)
        return ob

    def cap_on_head(name, z_lo, off0, mat, extra_cut=None):
        top = P[head_m][:, 2].max()
        zs = list(np.arange(z_lo, top - 0.01, 0.025))
        rings = smooth(hull_rings(P[head_m], up, zs, dt=0.02), 2)
        ob = build(name, up, zs, rings, lambda t, th: off0, cut=extra_cut, cap=top + off0, mat=mat)
        skin(ob, body, {'Head'}, 'Head', rule=lambda p: {'Head': 1})
        made.append(ob)
        return ob

    def collar(name, reach, width, mat, gap=0.05):
        """목둘레에서 어깨 쪽으로 펼쳐진 고리 (금 목걸이, 가슴 장식)"""
        rn = hull_rings(P[neck_m], up, [z_neck + 0.01])[0]
        zs = [z_neck - 0.01 - width * 0.6, z_neck - 0.01]
        rings = [(rn[0], rn[1], rn[2] + reach), (rn[0], rn[1], rn[2] + reach - width)]
        ob = build(name, up, zs, rings, lambda t, th: 0.0, mat=mat)
        push_out(ob, body, torso_m | neck_m, gap, 'collar', iters=3)
        skin(ob, body, TORSO, 'spine_03')
        made.append(ob)
        return ob

    def band(name, z0, z1, off0, mat, zig=0.0):
        rings = smooth(hull_rings(P[torso_m | head_m], up, [z0, z1], dt=0.03), 2)
        if zig:  # 위쪽 가장자리를 톱니 모양으로 (면류관)
            rings[1] = (rings[1][0], rings[1][1], rings[1][2])
        ob = build(name, up, [z0, z1], rings, lambda t, th: off0, mat=mat)
        if zig:
            for j, v in enumerate(ob.data.vertices[N:2 * N]): v.co.z += zig * (j % 2)
        made.append(ob)
        return ob

    # 속옷 튜닉 (길이 두 가지), 겉옷(망토형), 허리띠
    robe('tunic_long', z_ankle + 0.02, 0.012, 0.05, 'tunic', sleeve=0.16)
    if sex == 'm':
        robe('tunic_short', z_knee + 0.04, 0.012, 0.025, 'tunic', sleeve=0.12)
    robe('mantle', (z_knee + z_ankle) / 2 - 0.05, 0.035, 0.07, 'mantle', open_front=0.35)
    belt = band('belt', z_waist - 0.025, z_waist + 0.025, 0.03, 'belt')
    skin(belt, body, {'pelvis', 'spine_01', 'spine_02'}, 'spine_01')

    if sex == 'm':
        head_wrap('headcloth', z_sh - 0.04, 0.014, 0.75, 'headcloth')
        # 수염: 아래턱 앞쪽을 덮는 반쪽 고리
        zc = P[head_m][:, 2].min()
        zs = list(np.arange(zc - 0.05, z_head + 0.07, 0.02))
        rings = smooth(hull_rings(P[head_m], up, [max(z, zc + 0.01) for z in zs], dt=0.02), 1)
        taper = lambda t, th: 0.012 + 0.03 * sstep(zc + 0.02, zc - 0.05, t) * (1 if ang(th, FRONT) < 0.6 else 0)
        bd = build('beard', up, zs, rings, taper, cut=lambda t, th: ang(th, FRONT) > 1.25, mat='beard')
        for v in bd.data.vertices:  # 턱 아래로 모은다
            if v.co.z < zc: v.co.x *= 0.6; v.co.y = v.co.y * 0.7 + (P[head_m][:, 1].min()) * 0.3
        skin(bd, body, {'Head'}, 'Head', rule=lambda p: {'Head': 1})
        made.append(bd)
        # 로마 군인: 투구(+볏), 갑옷, 붉은 망토
        cap_on_head('helmet', z_head + 0.02, 0.03, 'metal', extra_cut=lambda t, th: ang(th, FRONT) < 0.8 and t < z_head + 0.10)
        crest = mesh_obj('helmet_crest', *box((0, B['Head'].y, P[head_m][:, 2].max() + 0.055), (0.012, 0.11, 0.035)), 'crest')
        skin(crest, body, {'Head'}, 'Head', rule=lambda p: {'Head': 1}); made.append(crest)
        robe('armor', z_waist - 0.08, 0.03, 0.0, 'metal', top=z_sh - 0.05)
        robe('cloak', z_knee - 0.02, 0.05, 0.06, 'cloak', back_only=1.2)
        # 왕: 면류관(삼하 12:30)과 보석, 금 테두리 겉옷, 속옷 금띠, 넓은 금띠, 금 목걸이
        cr = band('crown', z_head + 0.085, z_head + 0.135, 0.034, 'gold')
        for j, v in enumerate(cr.data.vertices[N:2 * N]):  # 꼭지 12개
            if j % 2 == 0: v.co.z += 0.055; v.co.x *= 0.97; v.co.y = B['Head'].y + (v.co.y - B['Head'].y) * 0.97
        gems = None
        for j in range(0, N, 4):
            a0, a1 = cr.data.vertices[j].co, cr.data.vertices[N + j].co
            c = (a0 + Vector((a1.x, a1.y, a0.z + 0.05))) / 2
            out = Vector((c.x, c.y - B['Head'].y, 0)).normalized() * 0.006
            g = mesh_obj('gem', *box(tuple(c + out), (0.011, 0.011, 0.011)), 'gem')
            g.rotation_euler.z = math.atan2(out.y, out.x); bpy.context.view_layer.update()
            with bpy.context.temp_override(active_object=g, selected_editable_objects=[g]):
                bpy.ops.object.transform_apply(rotation=True)
            gems = join(gems, g) if gems else g
        gems.name = gems.data.name = 'crown_gems'
        for o in (cr, gems): skin(o, body, {'Head'}, 'Head', rule=lambda p: {'Head': 1})
        robe('royal_mantle', z_ankle + 0.03, 0.035, 0.10, 'royal', open_front=0.35)
        robe('royal_trim', z_ankle + 0.03, 0.039, 0.10, 'gold', open_front=0.35, trim=(0.05, 0.2))
        robe('tunic_trim', z_ankle + 0.02, 0.016, 0.05, 'gold', trim=(0.05, 0.0))
        bw = band('belt_wide', z_waist - 0.045, z_waist + 0.045, 0.032, 'gold')
        skin(bw, body, {'pelvis', 'spine_01', 'spine_02'}, 'spine_01')
        collar('collar', 0.075, 0.045, 'gold', gap=0.075)
    else:
        head_wrap('veil', B['spine_02'].z, 0.016, 0.70, 'veil', back_len=0.03)
        # 홍색 드레스와 금 장신구 (삼하 1:24): 몸에 붙는 윗몸, 높은 허리, 넓게 퍼지는 치마, 민소매
        robe('dress', z_ankle + 0.01, 0.009, 0.14, 'dress', neck=0.85, ease=0.03)
        z_sash = (B['spine_01'].z + B['spine_02'].z) / 2
        sa = band('sash', z_sash - 0.03, z_sash + 0.03, 0.022, 'sash')
        fv = min(sa.data.vertices[:N], key=lambda v: v.co.y).co  # 허리띠 앞쪽
        for dx, ln in ((0.035, 0.30), (0.065, 0.24)):  # 늘어진 끈 두 가닥
            sa = join(sa, mesh_obj('tail', *box((fv.x + dx, fv.y - 0.008, z_sash - 0.03 - ln / 2), (0.014, 0.004, ln / 2)), 'sash'))
        skin(sa, body, {'pelvis', 'spine_01', 'spine_02'}, 'spine_01')
        z_chin = P[head_m][:, 2].min() + 0.02
        hr = head_wrap('hair', B['spine_02'].z + 0.06, 0.012, 1.35, 'hair', back_len=0.03, brow=0.15)
        drop = [p for p in hr.data.polygons if all(ang(math.atan2(hr.data.vertices[i].co.y - B['Head'].y, hr.data.vertices[i].co.x) % (2 * math.pi), FRONT) < 1.5
                and hr.data.vertices[i].co.z < z_chin for i in p.vertices)]
        import bmesh  # 턱 아래 앞쪽은 머리카락을 걷어 낸다 (등 뒤로 넘긴 머리)
        bm = bmesh.new(); bm.from_mesh(hr.data); bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[p.index] for p in drop], context='FACES'); bm.to_mesh(hr.data); bm.free()
        ci = band('circlet', z_head + 0.135, z_head + 0.15, 0.022, 'gold')
        skin(ci, body, {'Head'}, 'Head', rule=lambda p: {'Head': 1})
        collar('necklace', 0.05, 0.012, 'gold', gap=0.018)
        br = None
        for sd, sg in (('l', 1), ('r', -1)):
            xh = abs(B[f'hand_{sd}'].x)
            fr = frame((0, B[f'hand_{sd}'].y, B[f'hand_{sd}'].z), (sg, 0, 0), (0, 1, 0))
            xs = [xh - 0.07, xh - 0.045]
            o = build(f'bracelet_{sd}', fr, xs, smooth(hull_rings(P[arm_m], fr, xs, dt=0.02), 1), lambda t, th: 0.008, mat='gold')
            skin(o, body, {f'lowerarm_{sd}', f'hand_{sd}'}, f'lowerarm_{sd}')
            br = join(br, o) if br else o
        br.name = br.data.name = 'bracelets'

    # 샌들: 바닥창 + 발등 끈 두 줄
    for sd in ('l', 'r'):
        f, bl, tip = B[f'foot_{sd}'], B[f'ball_{sd}'], B[f'ball_leaf_{sd}']
        sole = mesh_obj(f'sandal_{sd}', *box((f.x, (f.y + 0.06 + tip.y) / 2, 0.004), (0.048, (f.y + 0.06 - tip.y) / 2, 0.007)), 'sandal')
        foot_m = body.mask(lambda d, s=sd: d in (f'foot_{s}', f'ball_{s}'))
        for nm, y0 in (('a', bl.y + 0.01), ('b', f.y - 0.01)):
            fr = frame((f.x, 0, 0), (0, 1, 0), (1, 0, 0))
            rs = smooth(hull_rings(P[foot_m], fr, [y0 - 0.012, y0 + 0.012], dt=0.02), 1)
            st = build(f'strap', fr, [y0 - 0.012, y0 + 0.012], rs, lambda t, th: 0.006, mat='sandal')
            sole = join(sole, st)
        skin(sole, body, {f'foot_{sd}', f'ball_{sd}'}, f'foot_{sd}')
        made.append(sole)
    # 좌우 샌들을 한 메시로
    sl = bpy.data.objects['sandal_l']; sr = bpy.data.objects['sandal_r']
    sl = join(sl, sr); sl.name = sl.data.name = 'sandals'

    for ob in {o for o in bpy.context.scene.objects if o.type == 'MESH' and o.parent is None and o.name not in ('Mannequin', 'Mannequin_F')}:
        attach(ob, arm)


def box(c, h):
    cx, cy, cz = c; hx, hy, hz = h
    v = [(cx + sx * hx, cy + sy * hy, cz + sz * hz) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return v, f


def join(a, b):
    """b를 a에 합친다 (정점 그룹 유지)"""
    with bpy.context.temp_override(active_object=a, selected_editable_objects=[a, b], selected_objects=[a, b]):
        bpy.ops.object.join()
    return a


# ───────────────────────── 소품 (손에 쥐는 것, 엔진에서 손뼈에 붙임) ─────────────────────────

def props():
    """원점 = 쥐는 자리, +Z = 위 (glTF에서는 +Y)"""
    out = []
    def cyl(name, r, z0, z1, mat, seg=8):
        v = [(r * math.cos(a), r * math.sin(a), z) for z in (z0, z1) for a in np.linspace(0, 2 * math.pi, seg, endpoint=False)]
        f = [(j, (j + 1) % seg, seg + (j + 1) % seg, seg + j) for j in range(seg)] + [tuple(range(seg))[::-1], tuple(range(seg, 2 * seg))]
        return mesh_obj(name, v, f, mat)
    st = cyl('prop_staff', 0.016, -0.9, 0.75, 'wood')       # 목자 지팡이 (끝이 굽음)
    for i in range(6):
        a0, a1 = math.pi * i / 6, math.pi * (i + 1) / 6
        seg = cyl('crook', 0.014, 0, 0.045, 'wood')
        seg.location = (0.06 - 0.06 * math.cos(a0), 0, 0.75 + 0.06 * math.sin(a0))
        seg.rotation_euler = (0, -a0 + math.pi / 12, 0)
        bpy.context.view_layer.update()
        with bpy.context.temp_override(active_object=seg, selected_editable_objects=[seg]):
            bpy.ops.object.transform_apply(location=True, rotation=True)
        st = join(st, seg)
    out.append(st)
    sw = cyl('prop_sword', 0.012, -0.06, 0.06, 'wood')      # 칼 (요 18:10): 손잡이 + 날
    blade = mesh_obj('blade', *box((0, 0, 0.36), (0.022, 0.004, 0.28)), 'metal')
    guard = mesh_obj('guard', *box((0, 0, 0.07), (0.06, 0.012, 0.01)), 'metal')
    out.append(join(join(sw, blade), guard))
    to = cyl('prop_torch', 0.02, -0.25, 0.25, 'wood')       # 횃불 자루 (불꽃은 엔진의 불)
    out.append(join(to, cyl('wrap', 0.03, 0.2, 0.3, 'cloth_dark')))
    out.append(fish())
    out.append(bread())
    return out


def fish():
    """갈릴리 바다의 고기 (눅 5:6, 요 21:9–11). 길이 약 30cm, 머리가 -Y(게임에서는 앞)"""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=1)
    f = bpy.context.active_object; f.name = 'prop_fish'
    for v in f.data.vertices:  # 옆으로 납작하고, 꼬리 쪽으로 가늘다
        x, y, z = v.co
        k = 1 - .55 * max(0, y)
        v.co = (x * .028 * k, y * .15, z * .055 * k - (.008 if z < 0 else 0))
    f.data.materials.append(material('fish'))
    fin = material('fin')
    tail = mesh_obj('tail', [(0, .13, 0), (0, .215, .065), (0, .195, 0), (0, .215, -.065)], [(0, 1, 2), (0, 2, 3)], 'fin')
    dorsal = mesh_obj('dorsal', [(0, -.04, .05), (0, .07, .07), (0, .09, .035)], [(0, 1, 2)], 'fin')
    belly = mesh_obj('belly', [(0, .02, -.045), (0, .08, -.06), (0, .1, -.03)], [(0, 1, 2)], 'fin')
    eyes = [mesh_obj('eye', *box((sx * .021, -.11, .014), (.006, .007, .007)), 'eye') for sx in (1, -1)]
    for o in (tail, dorsal, belly, *eyes): f = join(f, o)
    for p in f.data.polygons: p.use_smooth = True
    return f


def bread():
    """둥글고 납작한 보리떡 (요 6:9, 요 21:9). 지름 약 18cm, 윗면은 더 구워진 색"""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=1)
    b = bpy.context.active_object; b.name = 'prop_bread'
    import random; rng = random.Random(7)
    for v in b.data.vertices:
        x, y, z = v.co
        bump = 1 + rng.uniform(-.06, .06) if z > .2 else 1
        v.co = (x * .09 * bump, y * .09 * bump, (z * .035 if z > 0 else z * .008) + .008)
    b.data.materials.append(material('bread')); b.data.materials.append(material('bread_top'))
    b.data.update()
    for p in b.data.polygons:
        p.use_smooth = True
        if p.normal.z > .8: p.material_index = 1
    return b


# ───────────────────────── 미리보기 ─────────────────────────

def preview(arm, roles, tag, pose_list, close=False):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 12; sc.cycles.use_denoising = False; sc.cycles.device = 'CPU'
    sc.render.resolution_x, sc.render.resolution_y = 300, 520
    sc.render.film_transparent = False
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.55, 0.6, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
    sun.data.energy = 3.5; sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = 50
    tiles = []
    for role in roles:
        spec = OUTFITS['roles'][role]
        for o in arm.children: o.hide_render = o.name not in spec['wear'] + ['Mannequin', 'Mannequin_F']
        sc.view_layers[0].update()
        for mname, col in role_colors(spec).items():
            m = bpy.data.materials.get(mname)
            if m: m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*[(int(col[i:i + 2], 16) / 255) ** 2.2 for i in (1, 3, 5)], 1)
        for act, fr in pose_list:
            arm.animation_data_create(); a = bpy.data.actions[act]
            arm.animation_data.action = a
            if hasattr(arm.animation_data, 'action_slot') and a.slots: arm.animation_data.action_slot = a.slots[0]
            sc.frame_set(fr)
            hip = arm.matrix_world @ arm.pose.bones['pelvis'].head
            if close: cam.location = (hip.x + 0.55, hip.y - 1.35, 1.55); look(cam, Vector((hip.x, hip.y, 1.38)))
            else: cam.location = (hip.x + 1.6, hip.y - 3.6, 1.15); look(cam, Vector((hip.x, hip.y, 0.9)))
            p = f'{OUT}/../preview/_{tag}_{role}_{act}_{fr}.png'
            sc.render.filepath = p; bpy.ops.render.render(write_still=True)
            tiles.append(p)
    return tiles


def look(cam, target):
    d = target - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def sheet(paths, cols, out):
    ims = [bpy.data.images.load(os.path.abspath(p)) for p in paths]
    w, h = ims[0].size
    rows = math.ceil(len(ims) / cols)
    S = np.ones((rows * h, cols * w, 4), np.float32)
    for i, im in enumerate(ims):
        a = np.array(im.pixels[:], np.float32).reshape(h, w, 4)
        r, c = divmod(i, cols); r = rows - 1 - r
        S[r * h:(r + 1) * h, c * w:(c + 1) * w] = a
    img = bpy.data.images.new('sheet', cols * w, rows * h); img.pixels = S.ravel()
    img.filepath_raw = os.path.abspath(out); img.file_format = 'PNG'; img.save()
    for p in paths: os.remove(p)


def export(path, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=False,
                              export_texcoords=False, export_tangents=False, export_morph=False, export_extras=False)


# ───────────────────────── 실행 ─────────────────────────

def main():
    pv = '--preview' in sys.argv
    os.makedirs(OUT, exist_ok=True); os.makedirs(f'{OUT}/../preview', exist_ok=True)
    tiles = []
    # 남자
    reset(); arm, body = import_ual1()
    bd = Body(body, arm); paint_under(body, bd); dress(bd, arm, 'm')
    export(f'{OUT}/char_m.glb', [arm] + list(arm.children))
    if pv:
        tiles += preview(arm, ['man', 'shepherd', 'fisherman', 'king', 'roman'], 'm', [('Idle_Loop', 20)])
        walk = preview(arm, ['shepherd'], 'mw', [('Walk_Loop', 8), ('Sitting_Idle_Loop', 10), ('Fixing_Kneeling', 30)])
        walk += preview(arm, ['fisherman'], 'md', [('Death01', 30), ('Death01', 60)]) + preview(arm, ['man'], 'mx', [('Death01', 60)])
        near = preview(arm, ['king'], 'mc', [('Idle_Loop', 20)], close=True) + preview(arm, ['king'], 'mk', [('Walk_Loop', 8)])
    # 여자: UAL1 뼈대의 팔 위치만 여성 마네킹에 맞춘다
    reset(); arm, male = import_ual1(); bpy.data.objects.remove(male)
    with bpy.data.libraries.load(f'{RAW}/Mannequin_F.blend') as (src, dst):
        dst.objects = ['Mannequin_F', 'Armature']
    fem, rig = dst.objects
    for o in (fem, rig): bpy.context.scene.collection.objects.link(o)
    for i, s in enumerate(fem.material_slots):  # 남자와 같은 재질 이름 쓰기
        base = s.material.name.split('.')[0]
        if base in bpy.data.materials: fem.material_slots[i].material = bpy.data.materials[base]
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    inv = arm.matrix_world.inverted()
    for eb in arm.data.edit_bones:
        eb.use_connect = False
    for eb in arm.data.edit_bones:
        rb = rig.data.bones.get(eb.name)
        if not rb: continue
        vec = eb.tail - eb.head
        eb.head = inv @ (rig.matrix_world @ rb.head_local); eb.tail = eb.head + vec
    bpy.ops.object.mode_set(mode='OBJECT')
    mw = fem.matrix_world.copy(); fem.parent = arm; fem.matrix_world = mw
    fem.modifiers['Armature'].object = arm
    fem.data.name = 'Mannequin_F'
    bpy.data.objects.remove(rig)
    for o in [o for o in bpy.data.objects if o.name.startswith('WGT') or o.name == 'metarig']: bpy.data.objects.remove(o)
    bd = Body(fem, arm); paint_under(fem, bd); dress(bd, arm, 'f')
    export(f'{OUT}/char_f.glb', [arm] + list(arm.children))
    if pv:
        tiles += preview(arm, ['woman', 'woman_veil'], 'f', [('Idle_Loop', 20)])
        walk += preview(arm, ['woman'], 'fw', [('Walk_Loop', 8), ('Sitting_Idle_Loop', 10), ('Fixing_Kneeling', 30)])
        near += preview(arm, ['woman'], 'fc', [('Idle_Loop', 20)], close=True) + preview(arm, ['woman'], 'fk', [('Idle_Talking_Loop', 30)])
        sheet(tiles, 7, f'{OUT}/../preview/roles.png')
        sheet(near, 4, f'{OUT}/../preview/close.png')
        sheet(walk, 3, f'{OUT}/../preview/poses.png')
    # 소품
    reset(); export(f'{OUT}/props.glb', props())


main()
