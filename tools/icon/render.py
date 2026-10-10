# 사이트 아이콘을 다시 만든다: tools/icon/icon.html(three.js)을 띄워 그린 뒤 assets/icon/에 크기별 PNG로 저장
# python3 tools/icon/render.py   (npm install, playwright, Pillow 필요)
import base64, io, threading, http.server, functools, pathlib
from playwright.sync_api import sync_playwright
from PIL import Image
S = pathlib.Path(__file__).resolve().parent.parent.parent
T = S / 'node_modules/three/'
OUT = S / 'assets/icon'; OUT.mkdir(parents=True, exist_ok=True)
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(S / 'tools/icon')); h.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8768), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page()
    pg.on('pageerror', lambda e: print('오류:', e))
    pg.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', lambda r: r.fulfill(path=str(T / r.request.url.split('three@0.160.0/')[1]), content_type='application/javascript'))
    pg.goto('http://127.0.0.1:8768/icon.html')
    pg.wait_for_function('window.ICONS', timeout=120000)
    im = {k: Image.open(io.BytesIO(base64.b64decode(v.split(',')[1]))).convert('RGBA') for k, v in pg.evaluate('window.ICONS').items()}
    b.close()
srv.shutdown()
for name, src, n in [('favicon-16.png', 'round', 16), ('favicon-32.png', 'round', 32), ('icon-192.png', 'round', 192), ('icon-512.png', 'round', 512)]:
    im[src].resize((n, n), Image.LANCZOS).save(OUT / name, optimize=True)
im['square'].convert('RGB').resize((180, 180), Image.LANCZOS).save(OUT / 'apple-touch-icon.png', optimize=True)  # 아이폰은 투명을 검게 칠하므로 불투명하게
im['og'].convert('RGB').save(OUT / 'og.jpg', quality=88)
for f in sorted(OUT.iterdir()): print(f.name, f.stat().st_size)
