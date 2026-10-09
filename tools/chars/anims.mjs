// UAL1 + UAL2에서 쓸 애니메이션만 골라 뼈대만 있는 GLB 한 장으로 만든다.
// node tools/chars/anims.mjs [UAL2_Standard.glb 경로]  → assets/chars/anims.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, resample } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { existsSync, mkdirSync } from 'node:fs';

// 쓸 곳은 PLAN.md 6장 1번 표
const UAL1 = [
  'Idle_Loop', 'Idle_Talking_Loop',
  'Walk_Loop', 'Walk_Formal_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop',
  'Sitting_Enter', 'Sitting_Idle_Loop', 'Sitting_Talking_Loop', 'Sitting_Exit',
  'Fixing_Kneeling', 'Crouch_Idle_Loop',
  'Swim_Fwd_Loop', 'Swim_Idle_Loop',
  'Sword_Attack', 'Death01', 'Idle_Torch_Loop',
  'PickUp_Table', 'Interact', 'Push_Loop',
];
const UAL2 = [
  'OverhandThrow',      // 물매 (삼상 17:49)
  'Consume',            // 먹기 (요 6:11, 요 21:13, 창 25:34)
  'TreeChopping_Loop',  // 번제 나무 쪼개기 (창 22:3)
  'Walk_Carry_Loop',    // 나무 지고 가기 (창 22:6)
  'LayToIdle',          // 누웠다 일어나기 (창 28:11–18)
  'Yes', 'Idle_No_Loop',// 끄덕임, 고개 젓기
  'Idle_Lantern_Loop',  // 등 들고 서 있기 (요 18:3)
];
// 이 뼈만 위치를 움직인다. 나머지 뼈의 위치값을 지워야 여성 마네킹의 팔 길이가 유지된다.
const MOVE = new Set(['root', 'pelvis']);
const TOL = Number(process.env.TOL || 5e-4); // 키프레임 줄이기 허용 오차

const ual2Path = process.argv[2] || 'assets/raw/UAL2_Standard.glb';
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const doc = await io.read('assets/raw/UAL1_Standard.glb');
const root = doc.getRoot();
const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
const buf = root.listBuffers()[0];

const drop = (a) => { a.listChannels().forEach((c) => c.dispose()); a.listSamplers().forEach((s) => s.dispose()); a.dispose(); };
for (const a of root.listAnimations()) if (!UAL1.includes(a.getName())) drop(a);

// UAL2 클립을 이름이 같은 뼈로 옮겨 붙인다 (두 파일의 뼈대가 같다)
if (existsSync(ual2Path)) {
  const src = await io.read(ual2Path);
  const copy = (acc) => doc.createAccessor().setType(acc.getType()).setArray(acc.getArray().slice())
    .setNormalized(acc.getNormalized()).setBuffer(buf);
  for (const a of src.getRoot().listAnimations()) {
    if (!UAL2.includes(a.getName())) continue;
    const out = doc.createAnimation(a.getName());
    for (const ch of a.listChannels()) {
      const tgt = byName.get(ch.getTargetNode()?.getName());
      if (!tgt) continue;
      const s = ch.getSampler();
      const ns = doc.createAnimationSampler().setInput(copy(s.getInput())).setOutput(copy(s.getOutput()))
        .setInterpolation(s.getInterpolation());
      out.addSampler(ns).addChannel(doc.createAnimationChannel().setTargetNode(tgt).setTargetPath(ch.getTargetPath()).setSampler(ns));
    }
  }
} else console.warn('UAL2 없음, UAL1만 씀:', ual2Path);

for (const a of root.listAnimations()) for (const ch of a.listChannels()) {
  const p = ch.getTargetPath();
  if (p === 'scale' || (p === 'translation' && !MOVE.has(ch.getTargetNode().getName()))) {
    ch.getSampler().dispose(); ch.dispose();
  }
}
// 뼈대만 남긴다
for (const n of root.listNodes()) { n.setMesh(null); n.setSkin(null); }
for (const m of root.listMeshes()) m.dispose();
for (const s of root.listSkins()) s.dispose();
byName.get('Mannequin')?.dispose();

await doc.transform(resample({ tolerance: TOL }), prune({ keepLeaves: true }), dedup());
// 회전값은 16비트 정규화 정수로 줄인다 (glTF 기본 규격에서 허용, GLTFLoader가 읽음)
for (const a of root.listAnimations()) for (const ch of a.listChannels()) {
  if (ch.getTargetPath() !== 'rotation') continue;
  const acc = ch.getSampler().getOutput();
  if (acc.getComponentType() !== 5126) continue;
  const f = acc.getArray(), q = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) q[i] = Math.round(Math.max(-1, Math.min(1, f[i])) * 32767);
  acc.setArray(q).setNormalized(true);
}
// 쓰이지 않는 accessor 정리 (prune이 놓치는 것)
for (const acc of root.listAccessors()) if (acc.listParents().every((p) => p.propertyType === 'Root')) acc.dispose();
if (!process.env.NOMESHOPT) doc.createExtension((await import('@gltf-transform/extensions')).EXTMeshoptCompression)
  .setRequired(true).setEncoderOptions({ method: 'filter' });
mkdirSync('assets/chars', { recursive: true });
await io.write('assets/chars/anims.glb', doc);
console.log('anims:', root.listAnimations().map((a) => a.getName()).join(' '));
