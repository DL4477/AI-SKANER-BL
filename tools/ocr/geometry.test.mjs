import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source=fs.readFileSync(new URL('../../src/ui/src/preparation/geometry.ts',import.meta.url),'utf8');
const js=stripTypeScriptTypes(source);
const g=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const region=(text,box,engine='rapidocr',page=1,id='a')=>({id,page,polygon:g.boxPolygon(box),readings:[{text,engine,rotation:0,confidence:.8}],fragmentIds:[id],reasons:[]});
test('tiles cover large and tiny pages, bounded to 2000 with at least 15% overlap',()=>{
  for(const [w,h] of [[1,1],[2000,2000],[2001,4001],[4961,3508],[14044,9934]]){
    const boxes=g.tileBoxes(w,h);
    assert(boxes.some(b=>b[2]===w&&b[3]===h));
    assert(boxes.every(b=>b[2]-b[0]<=2000&&b[3]-b[1]<=2000));
    for(let y=0;y<h;y+=37)for(let x=0;x<w;x+=37)assert(boxes.some(b=>x>=b[0]&&x<b[2]&&y>=b[1]&&y<b[3]));
    const xs=[...new Set(boxes.map(b=>b[0]))];for(let i=1;i<xs.length;i++)assert(xs[i]-xs[i-1]<=1700);
  }
});
test('rotated polygon vertices retain correspondence when mapped from a crop',()=>{
  assert.deepEqual(g.pagePolygon([[100,0],[100,200],[0,200],[0,0]],[.2,.3,.4,.7],100,200),[[.4,.3],[.4,.7],[.2,.7],[.2,.3]]);
});
test('overlap dedup preserves variants, sources, minus signs and letter case',()=>{
  const regions=[region('142−0,21',[.1,.1,.2,.2],'pdf')];
  g.mergeRegion(regions,region('142−0,21',[.101,.101,.201,.201],'rapidocr',1,'b'));
  g.mergeRegion(regions,region('142−0,1',[.1,.1,.2,.2],'tesseract',1,'c'));
  assert.equal(regions.length,1);assert.equal(regions[0].readings.length,3);assert.equal(regions[0].fragmentIds.length,3);assert(regions[0].reasons.length);
  assert.notEqual(g.comparable('H7'),g.comparable('h7'));assert.notEqual(g.comparable('Ø58±1'),g.comparable('58±1'));
});
test('identical neighbouring dimensions and other pages remain separate',()=>{
  const regions=[region('12',[.1,.1,.2,.2])];
  g.mergeRegion(regions,region('12',[.21,.1,.31,.2],'rapidocr',1,'b'));
  g.mergeRegion(regions,region('12',[.1,.1,.2,.2],'rapidocr',2,'c'));
  assert.equal(regions.length,3);
});
