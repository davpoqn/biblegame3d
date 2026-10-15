# MakeHuman 재료 (CC0)

- `tools/chars/mh_build.py`가 Blender 4.2 + MPFB2 + MakeHuman 기본 자산(makehuman_system_assets, CC0)으로 남녀 사람을 하나씩 만들어 뽑은 것이다(2026-10-14).
- `mh_m.npz`, `mh_f.npz`: 몸 정점·삼각형·UV, game_engine 뼈대(뼈 이름이 UAL 마네킹과 같다)의 뼈 위치와 정점 가중치, 눈·눈썹·속눈썹·머리카락(남: short02·short03·short04·long01, 여: long01·braid01·ponytail01·bob02).
- `tex_m/`, `tex_f/`: 피부·눈·눈썹·속눈썹·머리카락 텍스처(1024px 이하로 줄인 webp).
- `mh_j.npz`, `tex_j/`: 예수님 (2026-10-15, `blender -b -P tools/chars/mh_build.py -- j`). 남자 몸에 얼굴 세부(길고 좁은 얼굴, 높은 광대, 좁고 각진 턱, 곧은 코, 얇은 입술, 짙은 눈썹 eyebrow003)를 더하고 머리카락 long01·short02·short04를 맞췄다. `mh_heads.py j` → `assets/chars/jesus_head.glb`(목 길이로 자른 long01, 짧은 수염, 색을 칠한 그림).
- 쓰는 곳: 손·발 → `tools/chars/build_chars.py`의 `mh_limbs`, 머리 → `tools/chars/mh_heads.py` → `assets/chars/mh_head_m.glb`, `mh_head_f.glb`.
- 수염은 `assets/raw/jesus/`의 beard_sigmund(MakeHuman Community, CC0)를 이 얼굴로 옮겨 쓴다.
