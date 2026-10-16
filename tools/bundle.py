# 공용 엔진·도구·인물 파일을 한 장의 HTML로 묶는다 (모바일 뷰어는 옆 파일을 불러오지 못할 수 있음)
# 웹사이트는 첫 페이지와 인물마다 한 장씩인 페이지로 나뉜다 (2026-10-16 사용자 요청). 인물마다 16MB를 따로 쓴다
# python3 tools/bundle.py           → single/index.html (첫 페이지: 인트로와 인물 고르기, 3D 자산 없음) + single/<id>.html (여섯 인물)
# python3 tools/bundle.py paul      → single/paul.html 만
# python3 tools/bundle.py all       → single/all.html (예전처럼 여섯 인물을 한 장에. 16MB를 넘을 수 있다)
# python3 tools/bundle.py web       → single/web/ (웹사이트용: 모델을 HTML에 넣지 않고 single/web/models/*.glb로 따로 둔다. 16MB 한도가 없고,
#                                     한 번 받은 모델은 브라우저가 기억해 다른 인물에서 다시 받지 않는다. 2026-10-16 사용자 결정. 아티팩트용은 위의 한 장짜리)
# 첫 페이지에서 인물을 고르면 <id>.html#go&part=1&sound=1 로 넘어가 곧바로 시작한다. 인물 페이지에서도 다른 인물을 고르면 그 페이지로 간다
import re, os, sys, json, base64, hashlib, shutil
ALL=['job','peter','paul','david','abraham','jacob']
ARGS=sys.argv[1:]
WEB='web' in ARGS
PAGE='{id}.html'  # 인물 페이지 주소 (첫 페이지와 같은 폴더)
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
src={n:open(S+f'dist/chars/{n}.js',encoding='utf8').read() for n in ALL}
page0=open(S+'dist/index.html',encoding='utf8').read()
NAMES={'job':'욥','peter':'베드로','paul':'바울','david':'다윗','abraham':'아브라함','jacob':'야곱'}
TITLE0='<title>그날, 그곳에서 · 성경 속으로</title>'
outfits=json.load(open(S+'assets/chars/outfits.json',encoding='utf8'))
ANIMALS=('sheep','ram','goat','ox','donkey','colt','camel','pig')
BASE=['char_m','char_f','anims','props','mh_head_m','mh_head_f']  # 모든 인물이 쓰는 모델
OUT=S+('single/web/' if WEB else 'single/')
def model(k):
    # 웹사이트: 모델 파일을 OUT/models/로 복사하고 주소를 돌려준다. ?v=는 내용이 바뀌면 브라우저가 새로 받게 하는 표시
    b=open(S+f'assets/chars/{k}.glb','rb').read()
    if not WEB: return 'data:model/gltf-binary;base64,'+base64.b64encode(b).decode()
    os.makedirs(OUT+'models',exist_ok=True); shutil.copy(S+f'assets/chars/{k}.glb',OUT+f'models/{k}.glb')
    return f'models/{k}.glb?v={hashlib.md5(b).hexdigest()[:8]}'
def glbs(ids):
    # 인물 캐릭터(assets/chars)를 base64로 넣는다(웹사이트는 주소만). 그 인물들이 쓰는 것만: 동물은 장면 파일에 이름이 나오는 것(없는 종류는 kit가 비슷한 것으로 대신한다),
    # 예수님 얼굴(jesus_head)은 figure('jesus')가 있을 때. mh_head_m·mh_head_f: MakeHuman 얼굴(tools/chars/mh_heads.py)
    code=''.join(src[n] for n in ids)
    keys=BASE+['an_'+a for a in ANIMALS if f"'{a}'" in code]+(['jesus_head'] if "figure('jesus'" in code else [])
    return {k:model(k) for k in keys if os.path.exists(S+f'assets/chars/{k}.glb')}
def bundle(ids, split, name, title=None):
    # ids: 넣을 인물 장면 (첫 페이지는 없음), split: 페이지 나눔 정보 (src/index.html의 SPLIT. None이면 한 장에 다 한다)
    page=page0
    if title: assert TITLE0 in page; page=page.replace(TITLE0,'<title>'+title+'</title>',1)
    if split is not None:
        a="const SPLIT = null;"
        assert a in page; page=page.replace(a,"const SPLIT = "+json.dumps(split)+";",1)
    a="const kitReady = import('./kit.js').catch(e => { console.warn('3D 도구를 불러오지 못했습니다:', e); return null; });"
    b="const kitReady = Promise.resolve(KIT);"
    assert a in page; page=page.replace(a,b)
    a="    C = (await import(`./chars/${meta.id}.js`)).default;"
    b="    C = CHARMODS[meta.id]();"
    assert a in page; page=page.replace(a,b)
    chars=[]
    for n in ids:
        c=src[n]
        assert c.count('export default {')==1
        c=c.replace('export default {','return {')
        chars.append(f"  {n}: () => {{\n{c}\n  }}")
    block=("/* ---------- 3D 공용 도구 ---------- */\nconst KIT = (() => {\n"+kit+"\nreturn { createKit };\n})();\n\n" if ids else "const KIT = null;  // 첫 페이지: 3D는 인물 페이지에서\n")+\
          "/* ---------- 인물별 장면 ---------- */\nconst CHARMODS = {\n"+",\n".join(chars)+"\n};\n"
    marker='<script type="module">\n'
    i=page.index(marker)+len(marker)
    page=page[:i]+block+'\n'+page[i:]
    if ids:  # 모듈 스크립트보다 앞에 둔다
        j=page.index(marker)
        page=page[:j]+'<script>window.CHAR_GLB='+json.dumps(glbs(ids))+';window.OUTFITS='+json.dumps(outfits,ensure_ascii=False)+';</script>\n'+page[j:]
    elif WEB:  # 웹사이트 첫 페이지: 인트로를 보는 동안 모든 인물이 쓰는 모델을 미리 받아 둔다
        a='</style>\n'; assert a in page
        page=page.replace(a,a+''.join(f'<link rel="prefetch" href="{model(k)}">\n' for k in BASE),1)
    os.makedirs(OUT,exist_ok=True)
    out=OUT+name+'.html'
    open(out,'w',encoding='utf8').write(page)
    print(out,'bytes',len(page.encode('utf8')))
if 'all' in ARGS: bundle(ALL, None, 'all')
for n in [a for a in ARGS if a in ALL] or ([] if 'all' in ARGS else ['index']+ALL):
    if n=='index': bundle([], {'page': PAGE}, 'index')
    else: bundle([n], {'page': PAGE, 'here': n}, n, NAMES[n]+' · 그날, 그곳에서')
