# 공용 엔진·도구·인물 파일을 한 장의 HTML로 묶는다 (모바일 뷰어는 옆 파일을 불러오지 못할 수 있음)
import re, os
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
for n in ['job','peter','david','abraham','jacob']:
    c=open(S+f'dist/chars/{n}.js',encoding='utf8').read()
    assert c.count('export default {')==1
    c=c.replace('export default {','return {')
    chars.append(f"  {n}: () => {{\n{c}\n  }}")
block=("/* ---------- 3D 공용 도구 ---------- */\nconst KIT = (() => {\n"+kit+"\nreturn { createKit };\n})();\n\n"
       "/* ---------- 인물별 장면 ---------- */\nconst CHARMODS = {\n"+",\n".join(chars)+"\n};\n")
page=open(S+'dist/index.html',encoding='utf8').read()
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
import base64, json
glb={k:'data:model/gltf-binary;base64,'+base64.b64encode(open(S+f'assets/chars/{k}.glb','rb').read()).decode() for k in ('char_m','char_f','anims')}
outfits=json.load(open(S+'assets/chars/outfits.json',encoding='utf8'))
j=page.index(marker)
page=page[:j]+'<script>window.CHAR_GLB='+json.dumps(glb)+';window.OUTFITS='+json.dumps(outfits,ensure_ascii=False)+';</script>\n'+page[j:]
os.makedirs(S+'single',exist_ok=True)
open(S+'single/index.html','w',encoding='utf8').write(page)
print('bytes',len(page.encode('utf8')))
