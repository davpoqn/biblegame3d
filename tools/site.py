# GitHub Pages용 사이트를 만든다: single/index.html(여섯 인물) → _site/index.html
# 아티팩트는 게시할 때 문서 틀(doctype, 문자 인코딩, viewport)을 붙여 주지만 일반 웹서버는 붙여 주지 않는다.
# 틀 없이 올리면 브라우저가 인코딩을 잘못 짐작해 한글이 깨지고 스크립트가 멈춘다. 그래서 여기서 붙인다.
# python3 tools/build.py && python3 tools/bundle.py && python3 tools/site.py
import os, re, json, shutil, pathlib
S = str(pathlib.Path(__file__).resolve().parent.parent) + '/'
page = open(S + 'single/index.html', encoding='utf8').read()
DESC = '성경 인물의 자리에 서 보는 1인칭 3D 이야기. 본문은 성경전서 개역한글판.'
URL = 'https://davpoqn.github.io/biblegame3d/'
TITLE = re.search(r'<title>(.*?)</title>', page).group(1)  # 게임 제목을 따라간다
head = f'''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="{DESC}">
<meta name="theme-color" content="#0c0a09">
<meta property="og:title" content="{TITLE}">
<meta property="og:description" content="{DESC}">
<meta property="og:type" content="website">
<meta property="og:url" content="{URL}">
<meta property="og:image" content="{URL}og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="favicon-16.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="manifest" href="site.webmanifest">
<style>body{{margin:0}}</style>
</head>
<body>
'''
os.makedirs(S + '_site', exist_ok=True)
out = S + '_site/index.html'
open(out, 'w', encoding='utf8').write(head + page + '\n</body>\n</html>\n')
# 아이콘(tools/icon/render.py가 만든 것)과 홈 화면에 추가할 때 쓰는 정보
for f in os.listdir(S + 'assets/icon'): shutil.copy(S + 'assets/icon/' + f, S + '_site/' + f)
json.dump({'name': TITLE, 'short_name': TITLE, 'start_url': './', 'display': 'standalone', 'background_color': '#0c0a09', 'theme_color': '#0c0a09',
           'icons': [{'src': f'icon-{n}.png', 'sizes': f'{n}x{n}', 'type': 'image/png'} for n in (192, 512)]},
          open(S + '_site/site.webmanifest', 'w', encoding='utf8'), ensure_ascii=False)
print(out, 'bytes', os.path.getsize(out))
