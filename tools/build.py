import json, re, sys, os, shutil
import pathlib
S=str(pathlib.Path(__file__).resolve().parent.parent)+'/'
D=S+'data/krv_holybible.jsonl'
H={}
for line in open(D,encoding='utf8'):
    o=json.loads(line); H[(o['code'],o['chapter'],o['verse'])]=o['text']
os.makedirs(S+'dist/chars',exist_ok=True)
for f in ['index.html','kit.js']: shutil.copy(S+'src/'+f, S+'dist/'+f)
ok=True
for name in sorted(os.listdir(S+'src/chars')):
    s=open(S+'src/chars/'+name,encoding='utf8').read()
    m=re.search(r'/\*KRV\*/\{(.*?)\}/\*KRV\*/',s,re.S)
    V={}; partial=[]
    for k,code,ch,v1,v2,sub in re.findall(r"'([^']+)':\s*'([0-9A-Z]{3}) (\d+):(\d+)(?:-(\d+))?(?: ~ ([^']+))?'",m.group(1)):
        ch=int(ch); v1=int(v1); v2=int(v2) if v2 else v1
        parts=[]
        for v in range(v1,v2+1):
            t=H.get((code,ch,v))
            if t is None: print('MISSING',name,k,code,ch,v); ok=False; t=''
            parts.append(t)
        text=' '.join(parts)
        if sub:
            i=text.find(sub)
            if i<0: print('SUBSTR NOT FOUND',name,k,'|',sub); ok=False
            else:
                pre='…' if i>0 else ''; post='…' if i+len(sub)<len(text) else ''
                text=pre+sub+post; partial.append(k)
        V[k]=text
    s=s[:m.start()]+json.dumps(V,ensure_ascii=False,indent=1)+s[m.end():]
    s=re.sub(r'/\*PARTIAL\*/\[\]/\*PARTIAL\*/',json.dumps(partial,ensure_ascii=False),s)
    # paraphrase coverage
    pm=re.search(r'\nconst P = \{(.*?)\n\};',s,re.S)
    pkeys=set(re.findall(r"^\s*'([^']+)':",pm.group(1),re.M)) if pm else set()
    for k in V:
        if k not in pkeys: print('NO PARAPHRASE',name,k); ok=False
    for k in pkeys-set(V): print('EXTRA PARAPHRASE',name,k)
    # refs used
    used=set(re.findall(r"verse\('([^']+)'",s))
    used|=set(re.findall(r"ref: '([^']+)'",s)) | set(re.findall(r"A\.say\('[^']*', '[^']*', '([^']+)'",s)) | set(re.findall(r"\[\['요 21:15#1'",s)) - {"[['요 21:15#1'"}
    for blk in re.findall(r"(?:hisRefs|hisWords|refs):\s*\[([^\]]*)\]",s): used|=set(re.findall(r"'([^']+)'",blk))
    for k in used:
        if k not in V: print('REF NOT IN V',name,k); ok=False
    open(S+'dist/chars/'+name,'w',encoding='utf8').write(s)
    print(name,len(V),'verses',len(partial),'partial')
print('OK' if ok else 'PROBLEMS')
