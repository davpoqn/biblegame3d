// 동물 GLB 줄이기: 쓰지 않는 동작·움직이지 않는 채널을 지우고, 키프레임을 덜고, 회전을 16비트로
//   node tools/chars/slim.mjs <입력.glb> <출력.glb>
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, resample } from '@gltf-transform/functions';
const KEEP = new Set(['Idle', 'Walk', 'Run']);
const [inp, out] = process.argv.slice(2);
const io = new NodeIO(), doc = await io.read(inp), root = doc.getRoot();
const drop = (a) => { a.listChannels().forEach((c) => c.dispose()); a.listSamplers().forEach((s) => s.dispose()); a.dispose(); };
for (const a of root.listAnimations()) if (!KEEP.has(a.getName())) drop(a);
const rest = { translation: (n) => n.getTranslation(), rotation: (n) => n.getRotation(), scale: (n) => n.getScale() };
for (const a of root.listAnimations()) for (const ch of a.listChannels()) {
  const s = ch.getSampler(), v = s.getOutput().getArray(), r = rest[ch.getTargetPath()]?.(ch.getTargetNode()); if (!r) continue;
  let same = true; for (let i = 0; i < v.length && same; i++) same = Math.abs(v[i] - r[i % r.length]) < 1e-4;
  if (same) { s.dispose(); ch.dispose(); }  // 원래 자세 그대로인 채널
}
await doc.transform(resample({ tolerance: 5e-4 }), prune({ keepLeaves: true }), dedup());
for (const a of root.listAnimations()) for (const ch of a.listChannels()) {
  if (ch.getTargetPath() !== 'rotation') continue;
  const acc = ch.getSampler().getOutput(); if (acc.getComponentType() !== 5126) continue;
  const f = acc.getArray(), q = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) q[i] = Math.round(Math.max(-1, Math.min(1, f[i])) * 32767);
  acc.setArray(q).setNormalized(true);
}
for (const acc of root.listAccessors()) if (acc.listParents().every((p) => p.propertyType === 'Root')) acc.dispose();
await io.write(out, doc);
