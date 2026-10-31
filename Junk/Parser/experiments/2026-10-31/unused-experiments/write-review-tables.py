from pathlib import Path
import json,csv,unicodedata,pymupdf
root=Path('/home/user/.cache/parser-eye/trash-broad')
dest=Path('/home/user/Myangustis/Junk/Parser/experiments/2026-10-31/current-design')
inv={x['case']:x for x in json.loads((root/'inventory.json').read_text())['cases']}
pages=json.loads((root/'page-details.json').read_text())
with (dest/'source-pages.csv').open('w',encoding='utf-8',newline='') as f:
 w=csv.writer(f);w.writerow(['case','original_on_trash','source_page','sample_pdf','manager_text_file','parser_path','page_decision','parser_characters','parser_text_empty','image_placements','prefix_bytes','prefix_reason','prefix_had_decoded_text','warnings'])
 for p in pages:
  c=inv[p['case']];x=p['checkpoint'];warnings='; '.join(v['code']+(' ('+', '.join(v['fonts'])+')' if v.get('fonts') else '') for v in p['warnings'])
  w.writerow([p['case'],c['path'],p['page'],f"source-samples/{p['case']}.pdf",f"output-text/{p['case']}.txt",p['parsingPath'],p['decision'],p['chars'],p['empty'],p['images'],x.get('bytes'),x.get('reason'),x.get('hasText'),warnings])
with (dest/'case-summary.csv').open(encoding='utf-8',newline='') as fh:
 cases=list(csv.DictReader(fh))
num=0;major=0
with (dest/'output-pages.csv').open('w',encoding='utf-8',newline='') as f:
 w=csv.writer(f);w.writerow(['case','individual_output_pdf','output_page','combined_pdf_page','nonspace_noncontrol_text_chars','chars_with_centres_off_page','majority_off_page'])
 for row in cases:
  start=int(row['merged_pdf_pages'].split('-')[0]);id=row['case']
  with pymupdf.open(dest/'output-pdfs'/f'{id}.pdf') as doc:
   for i,p in enumerate(doc):
    chars=[c for b in p.get_text('rawdict',clip=pymupdf.INFINITE_RECT())['blocks'] if 'lines' in b for line in b['lines'] for span in line['spans'] for c in span['chars'] if c['c'] and not c['c'].isspace() and not unicodedata.category(c['c'][0]).startswith('C')]
    width,height=p.rect.width,p.rect.height
    out=sum(not(0<=(c['bbox'][0]+c['bbox'][2])/2<=width and 0<=(c['bbox'][1]+c['bbox'][3])/2<=height) for c in chars)
    m=bool(chars and out>len(chars)/2);num+=1;major+=m
    w.writerow([id,f'output-pdfs/{id}.pdf',i+1,start+i,len(chars),out,m])
print(f'source page records={len(pages)} output page records={num} majority offpage={major}')
