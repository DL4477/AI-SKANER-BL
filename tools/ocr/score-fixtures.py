"""Report detection separately from exact reading; missing labels stay in denominator.

This is a variant-recall metric, not automatic disambiguation accuracy. Text only
normalizes whitespace/NFC; case, decimal separators, signs and digits stay exact.
"""
import json
from pathlib import Path
import unicodedata
ROOT=Path(__file__).resolve().parents[2]/'.local/acceptance'
manifest=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
def box(poly):return [min(p[0] for p in poly),min(p[1] for p in poly),max(p[0] for p in poly),max(p[1] for p in poly)]
def area(b):return max(0,b[2]-b[0])*max(0,b[3]-b[1])
def match(a,b):
    intersection=area([max(a[0],b[0]),max(a[1],b[1]),min(a[2],b[2]),min(a[3],b[3])])
    return intersection/max(area(a),1e-10)>=.5 and area(b)/max(area(a),1e-10)<8
def text(s):return ''.join(unicodedata.normalize('NFC',s).split())
reports=[]
for document in manifest['documents']:
    path=ROOT/(document['file']+'.prepared.json')
    if not path.exists():continue
    prepared=json.loads(path.read_text(encoding='utf-8'))
    report={k:document[k] for k in ('file','split','kind')};report['labels']=len(document['annotations'])
    for name,engines in [('rapid',['rapidocr']),('ocr',['rapidocr','tesseract']),('all_sources',['pdf','rapidocr','tesseract'])]:
        detected=exact=0;missed=[];wrong=[]
        for annotation in document['annotations']:
            candidates=[r for r in prepared['regions'] if r['page']==annotation['page'] and match(box(annotation['polygon']),box(r['polygon'])) and any(v['engine'] in engines for v in r['readings'])]
            if candidates:detected+=1
            else:missed.append(annotation['id'])
            variants=[v['text'] for r in candidates for v in r['readings'] if v['engine'] in engines]
            if any(text(v)==text(annotation['text']) for v in variants):exact+=1
            else:wrong.append({'id':annotation['id'],'expected':annotation['text'],'variants':variants})
        report[name]={'detected':detected,'exact_variant':exact,'missed':missed,'not_exact':wrong}
    reports.append(report)
(ROOT/'scores.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
for r in reports:print(json.dumps({k:v for k,v in r.items() if k in ('file','split','labels')}|{engine:{k:v for k,v in r[engine].items() if k in ('detected','exact_variant')} for engine in ('rapid','ocr','all_sources')}))
