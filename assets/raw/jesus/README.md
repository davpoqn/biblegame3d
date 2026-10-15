# 예수님 머리 원본 (MakeHuman)

- 사용자가 MakeHuman Community 1.2.0으로 만들어 내보낸 모델(2026-10-10). MakeHuman이 내보낸 모델은 CC0다.
- 들어 있는 것: 몸(base), 눈(high-poly), 긴 머리(long01), 눈썹(eyebrow001), 수염(beard_sigmund — MakeHuman Community 자료, CC0, 사용자가 확인).
- 텍스처는 채팅으로 받은 그림을 그대로 저장했다(webp/png, 투명 부분 포함). 피부는 그 전 내보내기의 old_lightskinned_male을 쓴다(UV가 같다).
- 지금은 수염(beard_sigmund)만 쓴다: `tools/chars/mh_heads.py`가 남자 얼굴과 예수님 얼굴로 옮긴다. 예수님 머리는 2026-10-15부터 `mh_build.py`의 'j'(MPFB2로 새로 만든 얼굴)에서 만든다(넙대대해서 사용자 요청으로 바꿈).
