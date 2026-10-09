#!/bin/sh
# 캐릭터 전체 빌드: 옷 입히기(Blender) → 애니메이션 추리기 → meshopt 압축 → 확인
#   pip install bpy playwright --break-system-packages && npm install   (처음 한 번)
#   tools/chars/make.sh [--preview]
set -e
cd "$(dirname "$0")/../.."
python3 tools/chars/build_chars.py "$@"
node tools/chars/anims.mjs
for f in char_m char_f props; do npx gltf-transform meshopt assets/chars/build/$f.glb assets/chars/$f.glb >/dev/null; done
ls -l assets/chars/*.glb | awk '{s+=$5; print $5, $9} END {print s, "합계"}'
python3 tools/chars/charcheck.py
