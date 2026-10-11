"""Synthetic regression corpus, NOT production acceptance evidence.

Six mechanical part layouts; 216 annotated callouts, including positional duplicates.
flange and housing are held out by family before OCR tuning. Output is ignored.
Build-time dependencies only: reportlab, Pillow, pypdf, pdftoppm (Poppler).
"""
from pathlib import Path
import json
import math
import subprocess
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader, PdfWriter

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'.local/acceptance'
OUT.mkdir(parents=True,exist_ok=True)
pdfmetrics.registerFont(TTFont('TestFont','C:/Windows/Fonts/arial.ttf'))
W,H=842,595
families=['plate','shaft','bushing','bracket','flange','housing']
manifest={'synthetic':True,'coordinateSystem':'displayed page, normalized, top-left', 'documents':[]}

def shape(c,family,x,y):
    c.saveState();c.translate(x,y);c.setLineWidth(.7)
    if family in ('shaft','bushing'):
        for a,b,h in [(0,45,22),(45,140,35),(140,190,26)]: c.rect(a,-h,b-a,h*2)
        if family=='bushing':c.setDash(4,2);c.line(0,-12,190,-12);c.line(0,12,190,12);c.setDash()
        c.circle(240,0,35);c.circle(240,0,12)
    elif family=='flange':
        c.circle(70,0,65);c.circle(70,0,28)
        for a in range(0,360,60):c.circle(70+48*math.cos(math.radians(a)),48*math.sin(math.radians(a)),5)
        c.rect(180,-65,25,130);c.rect(205,-30,45,60)
    else:
        c.rect(0,-45,155,90)
        for xx in (18,137):
            for yy in (-27,27):c.circle(xx,yy,6)
        if family=='bracket':c.rect(155,-45,25,130)
        elif family=='housing':c.rect(40,-20,75,40);c.circle(210,0,40);c.circle(210,0,24)
        else:c.rect(195,-45,12,90)
    c.setDash([7,2,1,2]);c.line(-15,0,285,0);c.setDash();c.restoreState()

for fi,family in enumerate(families):
    source=OUT/f'{family}-vector.pdf'
    c=canvas.Canvas(str(source),pagesize=(W,H),invariant=1)
    c.setTitle(f'Synthetic OCR regression: {family}');c.setFont('TestFont',11)
    c.drawString(30,565,f'SYNTHETIC / {family} / OCR REGRESSION - NOT FOR MANUFACTURE')
    shape(c,family,70,405);shape(c,family,460,405)
    annotations=[]
    labels=['142−0,21','Ø58±1','5+0,2','12F9','Ra 6,3','Ø20H7','Ø20h7','Rz 20','±0,05','Ra 3.2','12','12',
            '45°','2×45°','М12×1,5','Ø8','R4','80±0,1','25−0,2','32+0,1','60','90','1:2','A-A',
            'Ø16H7','Ø16h7','Ra 0,8','Rz 40','0,02','100±1','4 отв. Ø6','20','6,3','R2','Ø42','5']
    for i,text in enumerate(labels):
        # Six columns of separated callouts below orthographic views.
        row,col=divmod(i,6);x=44+col*127;y=292-row*42;size=10 if i%5 else 7
        if i==0:x=465;y=495 # straddles the first 300 DPI tile boundary
        angle=90 if i in (8,26) else 0
        c.saveState();c.translate(x,y);c.rotate(angle);c.setFont('TestFont',size)
        width=pdfmetrics.stringWidth(text,'TestFont',size)
        if i==2:
            c.drawString(0,0,'5');base=pdfmetrics.stringWidth('5','TestFont',size)
            c.setFont('TestFont',size*.6);c.drawString(base,size*.45,'+0,2')
            width=base+pdfmetrics.stringWidth('+0,2','TestFont',size*.6)
        else:c.drawString(0,0,text)
        c.setLineWidth(.25);c.line(-3,-5,width+3,-5);c.line(-3,-8,-3,-2);c.line(width+3,-8,width+3,-2)
        c.restoreState()
        corners=[(0,-size*.22),(width,-size*.22),(width,size*.95),(0,size*.95)]
        points=[]
        for px,py in corners:
            if angle: px,py=-py,px
            points.append([(x+px)/W,1-(y+py)/H])
        annotations.append({'id':f'{family}-{i+1}','text':text,'page':1,'polygon':points,'rotation':angle})
    c.showPage();c.save()
    final=OUT/f'{family}.pdf'
    kind='vector'
    if family in ('bushing','flange'):
        # Raster source, with no OCR layer. Upsampling must not be claimed to restore detail.
        subprocess.run(['pdftoppm','-r','200','-singlefile','-png',str(source),str(OUT/family)],check=True,capture_output=True)
        c=canvas.Canvas(str(final),pagesize=(W,H),invariant=1)
        c.drawImage(str(OUT/f'{family}.png'),0,0,W,H);c.showPage();c.save();kind='scan-200dpi'
    elif family=='housing':
        writer=PdfWriter();page=PdfReader(source).pages[0];page.rotate(90);writer.add_page(page)
        with final.open('wb') as f:writer.write(f)
        for a in annotations:a['polygon']=[[1-y,x] for x,y in a['polygon']]
        kind='vector-rotated-90'
    else:final.write_bytes(source.read_bytes())
    manifest['documents'].append({'file':final.name,'family':family,'split':'holdout' if fi>=4 else 'development','kind':kind,'annotations':annotations})

# Empty/multipage, encryption, deliberate corruption and damaged text map.
c=canvas.Canvas(str(OUT/'blank.pdf'),pagesize=(W,H));c.showPage();c.save()
writer=PdfWriter()
for f in ['plate.pdf','blank.pdf','shaft.pdf']:writer.add_page(PdfReader(OUT/f).pages[0])
with (OUT/'multipage.pdf').open('wb') as f:writer.write(f)
writer=PdfWriter();writer.add_page(PdfReader(OUT/'plate.pdf').pages[0]);writer.encrypt('fixture-only-password')
with (OUT/'protected.pdf').open('wb') as f:writer.write(f)
(OUT/'broken.pdf').write_bytes(b'%PDF-1.7\nthis is deliberately damaged')
writer=PdfWriter();writer.clone_document_from_reader(PdfReader(OUT/'plate.pdf'))
for font in writer.pages[0]['/Resources']['/Font'].values():
    font=font.get_object()
    if '/ToUnicode' in font:
        mapping=font['/ToUnicode'].get_object()
        mapping.set_data(mapping.get_data().replace(b'<0048>',b'<0068>')) # displayed H, extracted h
with (OUT/'damaged-text.pdf').open('wb') as f:writer.write(f)
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print('Prepared 6 synthetic families, 216 labels; flange/housing held out. Also 5 failure/edge fixtures.')
