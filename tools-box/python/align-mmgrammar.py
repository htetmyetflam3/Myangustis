#!/usr/bin/env python3
"""Match raw PDF byte windows to Unicode grammar paragraphs, as candidates only.

Usage: python tools-box/python/align-mmgrammar.py MAP.json RAW_RUNS.json OUTPUT.json
RAW_RUNS.json comes from wininnwa-raw-runs.py using the same map. Known anchors
can be provisional; a source match is not independent proof. This program does
not update the map or infer PDF pages from database chapter order.
"""
import argparse
import bisect
import collections
import hashlib
import importlib.util
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('map', type=Path)
parser.add_argument('raw_runs', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--database', type=Path, default=root/'tools-box/js/scripts.db')
args = parser.parse_args()
spec=importlib.util.spec_from_file_location('export_mmgrammar',root/'tools-box/python/export-mmgrammar.py')
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
sections=mod.read_sections(args.database)
base='[\u1000-\u1021\u1023-\u102a\u103f]'
def visual(t):
 # Exactly the user-confirmed leading-slot visual patterns, no Unicode cleanup.
 t=re.sub('('+base+')([\u103b\u103c])\u1031',lambda m: '\u1031'+ ('\u103c' if m[2]=='\u103c' else '')+m[1]+('\u103b' if m[2]=='\u103b' else ''),t)
 t=re.sub('('+base+')\u103c',lambda m:'\u103c'+m[1],t)
 t=re.sub('('+base+')\u1031',lambda m:'\u1031'+m[1],t)
 return re.sub(r'\s+', '', t)
# Paragraph boundaries prevent anchors crossing unrelated sections/paragraphs.
refs=[]
for ident,title,chapter,text in sections:
 for line in text.splitlines():
  q=visual(line)
  if len(q)>=8:refs.append((ident,title,chapter,line,q))
# Concatenate paragraphs with sentinel so index search can't cross boundaries.
needle='\x00';text=needle.join(v[4] for v in refs); offsets=[];pos=0
for ref in refs:offsets.append(pos);pos+=len(ref[4])+1
print('reference lines',len(refs),'chars',len(text),flush=True)
for label in ['raw']:
 mapping=json.loads(args.map.read_text(encoding='utf-8'));runs=json.loads(args.raw_runs.read_text(encoding='utf-8'));profiles={}
 for h,p in mapping['profiles'].items():
  known={**p['bytes'],**p['resolvedForReview']};pending=(set(p['unmapped'])|set(p['flaggedOrExcluded']))-set(known)
  profiles[h]={'known':known,'pending':pending,'contexts':collections.Counter(),'pages':{}}
 for h,page,raw in runs:
  if h not in profiles:continue
  p=profiles[h];a=[f'{v:02X}' for v in bytes.fromhex(raw)];known=p['known'];pending=p['pending']
  for i,code in enumerate(a):
   if code not in pending:continue
   left=[];right=[]
   for j in range(i-1,max(-1,i-9),-1):
    if a[j] not in known:break
    left.insert(0,a[j])
   for j in range(i+1,min(len(a),i+9)):
    if a[j] not in known:break
    right.append(a[j])
   prefix=''.join(known[k] for k in left if not known[k].isspace());suffix=''.join(known[k] for k in right if not known[k].isspace())
   if len(prefix)<2 or len(suffix)<2 or len(prefix)+len(suffix)<8:continue
   key=(code,tuple(left),tuple(right));p['contexts'][key]+=1;p['pages'].setdefault(key,set()).add(page)
 index={};out={}
 for h,p in profiles.items():
  result=collections.defaultdict(dict)
  for (code,left,right),count in p['contexts'].items():
   known=p['known'];prefix=''.join(known[k] for k in left if not known[k].isspace());suffix=''.join(known[k] for k in right if not known[k].isspace())
   if prefix not in index:
    loc=[];start=0
    while True:
     i=text.find(prefix,start)
     if i<0:break
     loc.append(i);start=i+1
    index[prefix]=loc
   for at in index[prefix]:
    start=at+len(prefix)
    for size in range(1,5):
     end=start+size;value=text[start:end]
     if '\x00' in value or not text.startswith(suffix,end):continue
     if not all('\u1000'<=v<='\u109f' or v in '(),.=-–—‘’\"\'' for v in value):continue
     ref=refs[bisect.bisect_right(offsets,at)-1]
     record=result[code].setdefault(value,{'rawContexts':set(),'pages':set(),'sections':[],'examples':[]})
     record['rawContexts'].add((code,left,right));record['pages'].update(p['pages'][(code,left,right)])
     if ref[0] not in record['sections']:record['sections'].append(ref[0])
     example={'page':min(p['pages'][(code,left,right)]),'raw':' '.join((*left,code,*right)), 'section':ref[0], 'chapter':ref[2], 'sourceTitle':ref[1], 'sourceText':ref[3], 'matchedVisual':text[at:end+len(suffix)]}
     if len(record['examples'])<8 and not any(e['page']==example['page'] and e['raw']==example['raw'] for e in record['examples']):record['examples'].append(example)
  for candidates in result.values():
   for record in candidates.values():
    record['rawContexts']=len(record['rawContexts']);record['pages']=sorted(record['pages'])
  out[h]=result
 result={'method':'Unicode grammar paragraphs from scripts.db mmgrammar, visual leading-slot patterns only; matching raw windows with known anchors. All whitespace is removed and matches may cross word boundaries. Paragraphs and chapters are not assigned to PDF pages. Anchors may be provisional, matches can overlap, and page streams exclude Form XObjects. Candidates are not independent glyph verification.', 'databaseSha256':hashlib.sha256(args.database.read_bytes()).hexdigest(), 'mapSha256':hashlib.sha256(args.map.read_bytes()).hexdigest(), 'profiles':out}
 f=args.output;f.parent.mkdir(parents=True,exist_ok=True);f.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(label,'contexts',sum(len(p['contexts']) for p in profiles.values()),'slots with matches',sum(len(p) for p in out.values()),'file',f,flush=True)
