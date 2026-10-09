# 성경 장면의 가축을 만든다 (Quaternius Farm Animals, CC0) → assets/chars/build/an_<종류>.glb
#   python3 tools/chars/build_animals.py
# 양은 그대로, 염소는 양에 뿔, 소(겨릿소)는 젖소를 갈색으로 칠하고 젖을 떼고 뿔, 나귀는 말을 줄여 회갈색, 약대는 라마에 혹.
# 파일마다: 뼈대+메시+동작(가까이 있는 한두 마리용), 굳힌 자세 pose_a·pose_b·pose_c(무리를 한꺼번에 그릴 때)
import bpy, bmesh, math, os
from mathutils import Vector

RAW, OUT = 'assets/raw/animals', 'assets/chars/build'
KEEP = ('Idle', 'Walk', 'WalkSlow', 'Run', 'Death')
POSES = (('Idle', 0.0), ('Idle', 0.5), ('WalkSlow', 0.25))  # (동작, 동작 안의 위치 0~1)
KINDS = {  # 원본, 머리 꼭대기 높이(m), 재질 → (새 이름, 색), 덧붙일 것
    'sheep': ('Sheep', .95, {'White': ('body', '#d8cfc0'), 'Black': ('dark', '#3a3028')}, ()),
    'goat': ('Sheep', .90, {'White': ('body', '#3b3029'), 'Black': ('dark', '#241c17')}, ('horns_goat',)),
    'ox': ('Cow', 1.55, {'White': ('body', '#6b4e38'), 'Black': ('patch', '#4a3628'), 'Pink': ('nose', '#3a2a20')}, ('horns_ox', 'no_udder')),
    'donkey': ('Horse', 1.30, {'Material.003': ('body', '#7c7266'), 'Material.006': ('dark', '#2d2721')}, ()),
    'ram': ('Sheep', 1.05, {'White': ('body', '#e2d9c6'), 'Black': ('dark', '#3a3028')}, ('horns_ram',)),  # 숫양 (창 22:13)
    'colt': ('Horse', 1.05, {'Material.003': ('body', '#8d8478'), 'Material.006': ('dark', '#3a332c')}, ('big_head',)),  # 어린 나귀 (요 12:14, 슥 9:9)
    'pig': ('Pig', .75, {'Material.003': ('body', '#2b2523'), 'Material': ('dark', '#1b1716')}, ()),  # 흑돼지 떼 (막 5:11-13)
    'camel': ('Llama', 2.30, {'Brown': ('body', '#b08a5e'), 'White': ('light', '#c9a77a'), 'Grey': ('dark', '#4a3826')}, ('hump',)),
}


def lin(hexc):
    return [(int(hexc[i:i + 2], 16) / 255) ** 2.2 for i in (1, 3, 5)]


def paint(m, name, hexc):
    """원본 재질의 노드 구조가 제각각이라 Principled 하나로 새로 짠다 (glTF가 색을 읽는 구조)"""
    m.name = name
    m.use_backface_culling = False
    m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    b = nt.nodes.new('ShaderNodeBsdfPrincipled'); o = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(b.outputs['BSDF'], o.inputs['Surface'])
    b.inputs['Base Color'].default_value = (*lin(hexc), 1)
    b.inputs['Roughness'].default_value = .9
    b.inputs['Metallic'].default_value = 0
    m.diffuse_color = (*lin(hexc), 1)


def new_mat(name, hexc):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    paint(m, name, hexc)
    return m


def tube(name, path, r0, r1, mat, seg=6):
    """path를 따라 굵기가 r0→r1로 가늘어지는 뿔"""
    verts, faces = [], []
    for i, p in enumerate(path):
        t = i / (len(path) - 1)
        d = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        u = d.orthogonal().normalized(); v = d.cross(u)
        r = r0 + (r1 - r0) * t
        verts += [p + (u * math.cos(a) + v * math.sin(a)) * r for a in [k * 2 * math.pi / seg for k in range(seg)]]
    for i in range(len(path) - 1):
        faces += [(i * seg + j, i * seg + (j + 1) % seg, (i + 1) * seg + (j + 1) % seg, (i + 1) * seg + j) for j in range(seg)]
    faces.append(tuple(range(seg))[::-1])
    me = bpy.data.meshes.new(name); me.from_pydata([tuple(p) for p in verts], [], faces); me.materials.append(mat)
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    return ob


def on_bone(ob, A, bone):
    """제자리를 유지한 채 뼈에 붙인다 (뼈를 따라 움직임)"""
    A.data.pose_position = 'REST'; bpy.context.view_layer.update()
    w = ob.matrix_world.copy()
    ob.parent = A; ob.parent_type = 'BONE'; ob.parent_bone = bone
    bpy.context.view_layer.update(); ob.matrix_world = w
    A.data.pose_position = 'POSE'


def build(kind):
    src, top, mats, extras = KINDS[kind]
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(f'{RAW}/{src}.blend'))
    A, M = bpy.data.objects['Armature'], bpy.data.objects[src]
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':  # 포즈·편집 모드로 저장된 파일
        with bpy.context.temp_override(active_object=bpy.context.object, object=bpy.context.object):
            bpy.ops.object.mode_set(mode='OBJECT')
    for a in list(bpy.data.actions):
        if a.name not in KEEP: bpy.data.actions.remove(a)
    for s in M.material_slots:
        if s.material and s.material.name in mats: paint(s.material, *mats[s.material.name])
    P = [M.matrix_world @ v.co for v in M.data.vertices]
    H = max(p.z for p in P)
    W = max(p.x for p in P) - min(p.x for p in P)
    gi = M.vertex_groups['Head'].index
    hv = [M.matrix_world @ v.co for v in M.data.vertices if any(g.group == gi and g.weight > .5 for g in v.groups)]
    hx0, hx1 = min(p.x for p in hv), max(p.x for p in hv)
    hy0, hy1 = min(p.y for p in hv), max(p.y for p in hv)
    hz1 = max(p.z for p in hv)
    hw, hl = hx1 - hx0, hy1 - hy0
    cx, cy = (hx0 + hx1) / 2, (hy0 + hy1) / 2
    if 'no_udder' in extras:  # 젖을 뗀다 (분홍 면 중 배 아래쪽)
        bm = bmesh.new(); bm.from_mesh(M.data)
        idx = [i for i, s in enumerate(M.material_slots) if s.material and s.material.name == 'nose']
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in idx and (M.matrix_world @ f.calc_center_median()).z < H * .5], context='FACES')
        bm.to_mesh(M.data); bm.free()
    if 'big_head' in extras:  # 머리를 키워 어리고 귀엽게 (머리뼈 기준으로 머리 정점을 넓힌다)
        h = A.matrix_world @ A.data.bones['Head'].head_local
        ni = M.vertex_groups['Neck'].index if 'Neck' in M.vertex_groups else -1
        for v in M.data.vertices:
            w = sum(g.weight for g in v.groups if g.group == gi) + .4 * sum(g.weight for g in v.groups if g.group == ni)
            if w > 0: v.co = h + (v.co - h) * (1 + .38 * min(1, w))
    for e in extras:  # 앞이 -Y, 위가 +Z (원본 단위)
        for sg in (1, -1):
            if e == 'horns_goat':  # 위로 솟아 뒤로 휘는 뿔
                b = Vector((cx + sg * hw * .2, cy + hl * .12, hz1 - hw * .05))
                path = [b + Vector((sg * hw * .04 * k, hl * (.02 + .09 * k * k), hw * .22 * k - hw * .02 * k * k)) for k in range(5)]
                on_bone(tube(f'horn_{sg}', path, hw * .09, hw * .015, new_mat('horn', '#4a3e30')), A, 'Head')
            if e == 'horns_ram':  # 뒤로 말려 내려가 앞으로 도는 뿔
                c = Vector((cx + sg * hw * .3, cy + hl * .12, hz1 - hw * .2))
                path = [c + Vector((sg * hw * .05 * k / 8, hw * (.32 - .2 * k / 8) * math.sin(k * .7), hw * (.32 - .2 * k / 8) * math.cos(k * .7))) for k in range(9)]
                on_bone(tube(f'horn_{sg}', path, hw * .13, hw * .035, new_mat('horn', '#b9a988')), A, 'Head')
            if e == 'horns_ox':  # 옆으로 뻗어 위로 휘는 뿔
                b = Vector((cx + sg * hw * .38, cy + hl * .18, hz1 - hw * .08))
                path = [b + Vector((sg * hw * .17 * k, -hl * .02 * k * k, hw * .025 * k * k)) for k in range(5)]
                on_bone(tube(f'horn_{sg}', path, hw * .1, hw * .02, new_mat('horn', '#cdbf9f')), A, 'Head')
        if e == 'hump':  # 등의 혹 하나 (단봉약대)
            back = [p for p in P if abs(p.x) < W * .2 and -H * .1 < p.y < H * .25]
            bz = max(p.z for p in back); by = sum(p.y for p in back) / len(back)
            bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, location=(0, by, bz))
            hu = bpy.context.active_object; hu.name = 'hump'; hu.scale = (W * .28, H * .16, H * .13)
            hu.data.materials.append(bpy.data.materials['body'])
            bpy.ops.object.transform_apply(scale=True)
            on_bone(hu, A, 'Back' if 'Back' in A.data.bones else 'Body')
    A.scale = (top / H,) * 3  # 미터로
    bpy.context.view_layer.update()
    # 굳힌 자세 (무리용)
    parts = [M] + [o for o in bpy.data.objects if o.parent == A and o.type == 'MESH' and o != M]
    poses = []
    for pi, (act, f) in enumerate(POSES):
        a = bpy.data.actions[act]
        A.animation_data.action = a
        if hasattr(A.animation_data, 'action_slot') and a.slots: A.animation_data.action_slot = a.slots[0]
        f0, f1 = a.frame_range
        bpy.context.scene.frame_set(int(f0 + (f1 - f0) * f))
        dg = bpy.context.evaluated_depsgraph_get()
        obs = []
        for o in parts:
            oe = o.evaluated_get(dg)
            me = bpy.data.meshes.new_from_object(oe); me.transform(oe.matrix_world)
            n = bpy.data.objects.new('tmp', me); bpy.context.scene.collection.objects.link(n); obs.append(n)
        with bpy.context.temp_override(active_object=obs[0], selected_editable_objects=obs, selected_objects=obs):
            bpy.ops.object.join()
        obs[0].name = obs[0].data.name = 'pose_' + 'abc'[pi]
        obs[0].vertex_groups.clear()
        poses.append(obs[0])
    A.animation_data.action = bpy.data.actions['Idle']
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in [A] + parts + poses: o.select_set(True)
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(f'{OUT}/an_{kind}.glb'), export_format='GLB', use_selection=True,
                              export_animations=True, export_animation_mode='ACTIONS', export_texcoords=False,
                              export_tangents=False, export_morph=False, export_extras=False)
    print(kind, 'H', round(H, 2), 'scale', round(top / H, 3), 'faces', len(M.data.polygons))


for k in KINDS: build(k)
