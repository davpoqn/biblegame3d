# 캐릭터 보기 페이지를 한 장짜리 HTML로 묶는다 (GLB를 data URI로 넣음) → single/chars.html
#   python3 tools/chars/viewer.py
import base64, json, pathlib

S = pathlib.Path(__file__).resolve().parents[2]
uri = lambda p: 'data:model/gltf-binary;base64,' + base64.b64encode((S / p).read_bytes()).decode()
data = {k: uri(f'assets/chars/{k}.glb') for k in ('char_m', 'char_f', 'anims')}
outfits = json.loads((S / 'assets/chars/outfits.json').read_text(encoding='utf8'))
page = (S / 'tools/chars/viewer.html').read_text(encoding='utf8').replace(
    '/*__DATA__*/', f'window.GLB={json.dumps(data)};window.OUTFITS={json.dumps(outfits, ensure_ascii=False)};')
(S / 'single').mkdir(exist_ok=True)
(S / 'single/chars.html').write_text(page, encoding='utf8')
print('single/chars.html', round(len(page.encode()) / 1e6, 2), 'MB')
