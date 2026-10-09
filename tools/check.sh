#!/bin/bash
cd "$(dirname "$0")/.."
mkdir -p chk
python3 -I - <<'PY'
import re
s=open('dist/index.html',encoding='utf8').read()
m=re.findall(r'<script type="module">(.*?)</script>',s,re.S)
open('chk/engine.mjs','w',encoding='utf8').write(m[0])
PY
for f in chk/engine.mjs dist/kit.js dist/chars/*.js; do
  cp "$f" chk/t.mjs; if node --check chk/t.mjs 2>chk/err.txt; then echo "ok  $f"; else echo "ERR $f"; head -8 chk/err.txt; fi
done
