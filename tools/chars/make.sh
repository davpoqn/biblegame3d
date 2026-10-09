#!/bin/sh
# 캐릭터 전체 빌드: 옷 입히기(Blender) → 애니메이션 추리기 → quantize 압축 → 확인 → 보기 페이지
#   pip install bpy playwright --break-system-packages && npm install   (처음 한 번)
#   tools/chars/make.sh [--preview]
set -e
cd "$(dirname "$0")/../.."
python3 tools/chars/build_chars.py "$@"
node tools/chars/anims.mjs
# quantize: WebAssembly 없이 읽히는 압축 (meshopt·Draco는 아티팩트에서 막힐 수 있음)
for f in char_m char_f props; do npx gltf-transform quantize assets/chars/build/$f.glb assets/chars/$f.glb >/dev/null; done
ls -l assets/chars/*.glb | awk '{s+=$5; print $5, $9} END {print s, "합계"}'
python3 tools/chars/charcheck.py
python3 tools/chars/viewer.py   # 캐릭터 보기 페이지 → single/chars.html
