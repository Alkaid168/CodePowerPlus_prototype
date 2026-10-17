import argparse,csv,json,sys,tempfile,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.knowledge import Taxonomy,TaxonomyError

def atomic(path,data):
 p=Path(path)
 if p.exists(): raise TaxonomyError('output exists; refusing overwrite')
 p.parent.mkdir(parents=True,exist_ok=True); t=p.with_suffix(p.suffix+'.tmp'); t.write_text(data,encoding='utf8'); t.replace(p)
def main():
 p=argparse.ArgumentParser(); p.add_argument('command',choices=['validate','export','import','migrate']); p.add_argument('--input',default='data/knowledge_taxonomy.json'); p.add_argument('--output'); p.add_argument('--format',choices=['json','csv']); p.add_argument('--mapping'); p.add_argument('--apply',action='store_true'); a=p.parse_args()
 try:
  if a.command=='validate': print(f'OK {Taxonomy(a.input).version} nodes={len(Taxonomy(a.input).nodes)}'); return
  if a.command=='export':
   tax=Taxonomy(a.input); fmt=a.format or ('csv' if str(a.output).lower().endswith('.csv') else 'json'); out=a.output or ('taxonomy.csv' if fmt=='csv' else 'taxonomy.json')
   if fmt=='json': atomic(out,json.dumps(tax.data,ensure_ascii=False,indent=2))
   else:
    fields=['version','provenance']+sorted({k for n in tax.data['nodes'] for k in n})
    import io; s=io.StringIO(); w=csv.DictWriter(s,fieldnames=fields); w.writeheader()
    for n in tax.data['nodes']: w.writerow({'version':tax.version,'provenance':tax.data.get('provenance',''), **{k:n.get(k,'') for k in fields if k not in ('version','provenance')}})
    atomic(out,s.getvalue())
  elif a.command=='import':
   fmt=a.format or ('csv' if str(a.input).lower().endswith('.csv') else 'json')
   if fmt=='json': data=json.loads(Path(a.input).read_text(encoding='utf8'))
   else:
    with open(a.input,encoding='utf-8-sig',newline='') as f:
     rows=list(csv.DictReader(f)); data={'version':rows[0].get('version') or Taxonomy().version,'provenance':rows[0].get('provenance',''),'nodes':[]}
     for r in rows:
      # CSV 里的空单元格：parent_id 表示根节点（写成 null），其他字段视为没有该字段。
      n={k:(None if (k=='parent_id' and v in ('','None')) else v) for k,v in r.items() if k not in ('version','provenance') and (v!='' or k=='parent_id')}; n['level']=int(n['level'])
      if 'intro_rating' in n: n['intro_rating']=int(n['intro_rating'])
      data['nodes'].append(n)
   t=Path(a.output or 'data/knowledge_taxonomy.json'); temp=Path(tempfile.mktemp(suffix='.json')); temp.write_text(json.dumps(data,ensure_ascii=False),encoding='utf8'); Taxonomy(temp); temp.unlink(); atomic(t,json.dumps(data,ensure_ascii=False,indent=2))
  else:
   src=json.loads(Path(a.input).read_text(encoding='utf8')); mp=json.loads(Path(a.mapping).read_text(encoding='utf8')); target=Taxonomy(); mapping=mp['mapping'];
   for rec in src.get('records',[]):
    ids=rec.get('primary_knowledge_ids',[])+rec.get('secondary_knowledge_ids',[])+rec.get('knowledge_ids',[])
    for i in ids:
     if i not in mapping: raise TaxonomyError(f'unmapped ID: {i}')
    rec['migration_source']=dict(rec); rec['taxonomy_version']=target.version
    for key in ('primary_knowledge_ids','secondary_knowledge_ids','knowledge_ids'):
     if key in rec: rec[key]=[mapping[i] for i in rec[key]]
   if a.apply: atomic(a.output,json.dumps(src,ensure_ascii=False,indent=2))
   else: print(json.dumps({'dry_run':True,'records':len(src.get('records',[]))}))
 except Exception as e: print(f'ERROR: {e}',file=sys.stderr); raise SystemExit(1)
if __name__=='__main__': main()
