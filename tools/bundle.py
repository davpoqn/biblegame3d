# 공용 엔진·도구·인물 파일을 한 장의 HTML로 묶는다 (모바일 뷰어는 옆 파일을 불러오지 못할 수 있음)
# python3 tools/bundle.py           → single/index.html (모든 인물)
# python3 tools/bundle.py peter     → single/peter.html (그 인물만, 처음 화면에 '다른 인물' 링크)
import re, os, sys, json
ALL=['job','peter','paul','david','abraham','jacob']
ONLY=[a for a in sys.argv[1:] if a in ALL]
HUB='https://claude.ai/artifact/PCJtDUMSu6sDSikaXrHdNV'  # 인물 고르는 곳 (원래 데모 링크)
import pathlib
S=str(pathlib.Path(__file__).resolve().parent.parent)+'/'
kit=open(S+'dist/kit.js',encoding='utf8').read()
kit=re.sub(r"^import .*?;\n",'',kit,flags=re.M)
kit=re.sub(r'^export (const|function|async function)',r'\1',kit,flags=re.M)
head="""export async function createKit(""".replace('export ','')
assert head in kit
kit=kit.replace("async function createKit(canvas, { presets = {}, initial = 'start', audio } = {}) {",
"""async function createKit(canvas, { presets = {}, initial = 'start', audio } = {}) {
  const [THREE, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { ShaderPass }, { OutputPass }, { GLTFLoader }, SkeletonUtils] = await Promise.all([
    import('three'), import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
    import('three/addons/postprocessing/UnrealBloomPass.js'), import('three/addons/postprocessing/ShaderPass.js'), import('three/addons/postprocessing/OutputPass.js'),
    import('three/addons/loaders/GLTFLoader.js'), import('three/addons/utils/SkeletonUtils.js')]);""",1)
assert 'import(\'three\')' in kit
chars=[]
for n in (ONLY or ALL):
    c=open(S+f'dist/chars/{n}.js',encoding='utf8').read()
    assert c.count('export default {')==1
    c=c.replace('export default {','return {')
    chars.append(f"  {n}: () => {{\n{c}\n  }}")
block=("/* ---------- 3D 공용 도구 ---------- */\nconst KIT = (() => {\n"+kit+"\nreturn { createKit };\n})();\n\n"
       "/* ---------- 인물별 장면 ---------- */\nconst CHARMODS = {\n"+",\n".join(chars)+"\n};\n")
page=open(S+'dist/index.html',encoding='utf8').read()
NAMES={'job':'욥','peter':'베드로','paul':'바울','david':'다윗','abraham':'아브라함','jacob':'야곱'}
if len(ONLY)==1:
    page=page.replace('<title>그날, 그곳에서 · 성경 속으로</title>','<title>'+NAMES[ONLY[0]]+' · 그날, 그곳에서</title>',1)
if ONLY:
    a="const RULE = "
    assert a in page; page=page.replace(a,"CHARS.splice(0, CHARS.length, ...CHARS.filter(c => "+json.dumps(ONLY)+".includes(c.id)));\n"+a,1)
    a='    <div class="start-row">'
    assert a in page; page=page.replace(a,'    <p class="notice"><a href="'+HUB+'" target="_blank" rel="noopener" style="color:inherit">다른 인물 고르기 →</a></p>\n'+a,1)
a="const kitReady = import('./kit.js').catch(e => { console.warn('3D 도구를 불러오지 못했습니다:', e); return null; });"
b="const kitReady = Promise.resolve(KIT);"
assert a in page; page=page.replace(a,b)
a="    C = (await import(`./chars/${meta.id}.js`)).default;"
b="    C = CHARMODS[meta.id]();"
assert a in page; page=page.replace(a,b)
marker='<script type="module">\n'
i=page.index(marker)+len(marker)
page=page[:i]+block+'\n'+page[i:]
# 인물 캐릭터(assets/chars)를 base64로 넣는다. 모듈 스크립트보다 앞에 둔다
import base64
glb={k:'data:model/gltf-binary;base64,'+base64.b64encode(open(S+f'assets/chars/{k}.glb','rb').read()).decode() for k in ('char_m','char_f','anims','props')+tuple('an_'+n for n in ('sheep','ram','goat','ox','donkey','colt','camel','pig'))}
outfits=json.load(open(S+'assets/chars/outfits.json',encoding='utf8'))
j=page.index(marker)
page=page[:j]+'<script>window.CHAR_GLB='+json.dumps(glb)+';window.OUTFITS='+json.dumps(outfits,ensure_ascii=False)+';</script>\n'+page[j:]
os.makedirs(S+'single',exist_ok=True)
out=S+'single/'+(ONLY[0] if len(ONLY)==1 else 'index')+'.html'
open(out,'w',encoding='utf8').write(page)
print(out,'bytes',len(page.encode('utf8')))
