# GitHub Pages용 사이트를 만든다: single/index.html(여섯 인물) → _site/index.html
# 아티팩트는 게시할 때 문서 틀(doctype, 문자 인코딩, viewport)을 붙여 주지만 일반 웹서버는 붙여 주지 않는다.
# 틀 없이 올리면 브라우저가 인코딩을 잘못 짐작해 한글이 깨지고 스크립트가 멈춘다. 그래서 여기서 붙인다.
# python3 tools/build.py && python3 tools/bundle.py && python3 tools/site.py
import os, pathlib
S = str(pathlib.Path(__file__).resolve().parent.parent) + '/'
page = open(S + 'single/index.html', encoding='utf8').read()
DESC = '성경 인물의 자리에 서 보는 1인칭 3D 이야기. 본문은 성경전서 개역한글판.'
head = f'''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="{DESC}">
<meta name="theme-color" content="#0c0a09">
<meta property="og:title" content="그 사람의 자리">
<meta property="og:description" content="{DESC}">
<meta property="og:type" content="website">
<style>body{{margin:0}}</style>
</head>
<body>
'''
os.makedirs(S + '_site', exist_ok=True)
out = S + '_site/index.html'
open(out, 'w', encoding='utf8').write(head + page + '\n</body>\n</html>\n')
print(out, 'bytes', os.path.getsize(out))
