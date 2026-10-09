import json, sys
import pathlib
D=str(pathlib.Path(__file__).resolve().parent.parent/'data')+'/'
def load(f):
    m={}
    for line in open(D+f,encoding='utf8'):
        o=json.loads(line); m[(o['code'],o['chapter'],o['verse'])]=o['text']
    return m
H=load('krv_holybible.jsonl')
try: B=load('krv_bskorea.jsonl')
except FileNotFoundError: B={}
# args: CODE CH V1-V2 [CODE CH V1-V2 ...]
a=sys.argv[1:]
for i in range(0,len(a),3):
    code,ch,rng=a[i],int(a[i+1]),a[i+2]
    v1,v2=(rng.split('-')+[rng])[:2]; v1,v2=int(v1),int(v2)
    for v in range(v1,v2+1):
        t=H.get((code,ch,v)); b=B.get((code,ch,v))
        print(f'{code} {ch}:{v} | {t}')
        if b is not None and t is not None and b.replace(' ','')!=t.replace(' ',''): print(f'   (bskorea) {b}')
