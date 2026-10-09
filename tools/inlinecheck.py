# 옆 파일 없이 HTML만 주입되는 환경(모바일 뷰어와 비슷한 조건)에서 불러와 본다
import sys
from playwright.sync_api import sync_playwright
import pathlib
S=str(pathlib.Path(__file__).resolve().parent.parent)+'/'
T=S+'node_modules/three/'
src=sys.argv[1]; char=sys.argv[2]
body=open(S+src,encoding='utf8').read()
html='<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"></head><body>'+body+'</body></html>'
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    pg=b.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    errs=[]
    pg.on('console',lambda m: errs.append(f'[{m.type}] {m.text}') if m.type in ('error','warning') else None)
    pg.on('pageerror',lambda e: errs.append(f'[pageerror] {e}'))
    pg.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**',lambda r: r.fulfill(path=T+r.request.url.split('three@0.160.0/')[1],content_type='application/javascript'))
    pg.route('https://fonts.googleapis.com/**',lambda r: r.fulfill(body='',content_type='text/css'))
    pg.set_content(html)
    pg.wait_for_timeout(600)
    pg.tap(f'#picker [data-id="{char}"]'); pg.tap('#start-quiet')
    pg.wait_for_timeout(12000)
    print(src,char,'→',pg.inner_text('#stage-inner')[:120].replace('\n',' | '))
    print('  3D:',pg.eval_on_selector('#gl','e=>getComputedStyle(e).display'))
    if len(sys.argv)>3: pg.screenshot(path=S+'chk/'+sys.argv[3])
    for e in errs[:4]: print('  ',e[:160])
    b.close()
