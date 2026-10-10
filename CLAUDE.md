# biblegame3d — 작업 안내

작업을 시작하기 전에 [PLAN.md](PLAN.md)를 먼저 읽는다. 목표, 지켜야 할 원칙 9가지, 기술 제약, 빌드 순서, 다음 단계, 인물별 구성이 모두 거기 있다.

## 가장 중요한 것

- 성경 본문은 개역한글(1961)만 쓴다. `data/krv_holybible.jsonl`에서 빌드할 때 넣고, 손으로 옮겨 치지 않는다. 쉬운성경은 쓰지 않는다.
- 시작, 과정, 마무리가 모두 성경과 일치해야 한다. 본문에 없는 이름과 사건은 넣지 않는다. 게임을 위해 쓴 문장에는 '연출' 표시를 붙인다.
- 게시는 반드시 한 장짜리 HTML(`tools/bundle.py`)로 한다. 여러 파일로 게시하면 휴대폰 앱에서 인물이 뜨지 않는다.
- **웹사이트**: https://davpoqn.github.io/biblegame3d/ — main에 push하면 GitHub Actions(`.github/workflows/pages.yml`)가 빌드해서 자동으로 다시 게시한다. 인물별 링크는 주소 끝에 `#peter`, `#paul`처럼 붙인다.
- **이 저장소는 공개다.** 너진똑 스크립트 같은 남의 저작물, API 키, 개인 정보를 올리지 않는다. 너진똑 자료는 사용자의 비공개 저장소에 따로 있다.
- 일레븐랩스 API 키는 사용자 PC에서만 쓴다. 받지도 않고, 저장소에 넣지도 않는다.

## 빌드와 확인

```
npm install
python3 tools/build.py                                  # → dist/
python3 tools/bundle.py                                 # → single/index.html (여섯 인물)
python3 tools/bundle.py paul                            # → single/paul.html (한 인물, 허브 링크 붙음)
python3 tools/site.py                                   # → _site/index.html (웹사이트용 문서 틀을 씌움)
python3 tools/icon/render.py                            # → assets/icon/ (사이트 아이콘 다시 만들기)
tools/check.sh                                          # 문법 검사
python3 tools/inlinecheck.py single/index.html peter    # 로딩 확인
```

## 작업 방식 (사용자 선호)

- 작업 전에 규모를 먼저 알린다: 🟢 소형(약 1천 토큰 이하), 🟡 중형(약 1천~5천), 🟠 대형(약 5천~1.5만), 🔴 매우 대형(1.5만 이상). 🟠 이상이면 사용자의 "ㅇㅋ"를 받고 시작한다.
- 코드는 바뀐 부분만 고친다. 전체를 다시 쓰지 않는다.
- 검증은 문법 검사와 짧은 로딩 확인 정도로 한다. 긴 자동 플레이 테스트는 사용자가 원할 때만 한다.
- **작업 하나가 끝날 때마다** PLAN.md 2장 '현재 상태'를 갱신하고, 작업 브랜치에 커밋·push한 뒤 **main에 합쳐 push한다.** 사용자가 정한 규칙이므로 따로 묻지 않는다. main이 앞서 있으면 main을 먼저 작업 브랜치에 합친다.

## 다음 할 일

**전체 확장(3부 구성, 바울 추가, 인물별 게시와 허브)은 끝났다.** 게시 링크와 남은 한계는 PLAN.md 2장 끝에 있다. 사용자가 새 버전을 해 보고 주는 의견을 반영한다. 캐릭터·동물은 `assets/chars/`, 다시 만들기는 `tools/chars/make.sh`.
