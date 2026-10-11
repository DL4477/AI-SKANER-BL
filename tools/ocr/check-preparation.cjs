// Browser executes real PDF.js preparation. Any OCR IPC is a regression.
// The harness never calls a cloud API. Requires Playwright and running Vite at 5173.
const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const out=path.join(root,'.local/acceptance');
let calls=0;
async function ipc(cmd){
  if(cmd==='model_status')return {provider:'Kimi API',model:'kimi-k3',endpoint:'https://api.moonshot.ai/v1',keyStored:true};
  if(cmd.startsWith('ocr_'))calls++;
  throw new Error('Unexpected IPC (OCR and cloud disabled): '+cmd);
}
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    await page.exposeFunction('localOcr',ipc);
    await page.addInitScript(()=>{
      window.isTauri=true;window.__TAURI_INTERNALS__={invoke:(cmd,args)=>window.localOcr(cmd,args),transformCallback:()=>1,unregisterCallback:()=>{}};
    });
    await page.goto('http://127.0.0.1:5173');
    const manifest=JSON.parse(await fs.readFile(path.join(out,'manifest.json'),'utf8'));
    const selected=process.argv.slice(2);const documents=selected.length?selected:manifest.documents.filter(d=>d.split==='development').map(d=>d.file);
    for(const file of documents){
      const bytes=await fs.readFile(path.join(out,file));
      const started=Date.now();const before=calls;
      const result=await page.evaluate(async({encoded,file})=>{
        const {preparePdf}=await import('/src/preparation/prepare.ts');
        const binary=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
        const url=URL.createObjectURL(new Blob([binary],{type:'application/pdf'}));
        window.prepAbort=new AbortController();
        try{return await preparePdf({name:file,kind:'pdf',url},window.prepAbort.signal,t=>window.prepProgress=t);}
        finally{URL.revokeObjectURL(url);}
      },{encoded:bytes.toString('base64'),file});
      assert.equal(result.status,'complete');
      assert.equal(calls,0);
      assert.equal(result.coverage.reviewsCompleted,0);
      assert(result.fragments.every(f=>f.purpose==='tile'));
      assert(result.regions.every(r=>r.readings.every(v=>v.engine==='pdf') && r.fragmentIds.length));
      assert.equal(result.coverage.unfinishedPages.length,0);
      assert(result.fragments.every(f=>f.width<=2000&&f.height<=2000));
      assert(result.regions.every(r=>r.polygon.every(p=>p.every(n=>n>=0&&n<=1))));
      await fs.writeFile(path.join(out,file+'.no-ocr.prepared.json'),JSON.stringify(result));
      const metrics={file,seconds:(Date.now()-started)/1000,ocrCalls:calls-before,pages:result.pages.length,fragments:result.fragments.length,regions:result.regions.length,disputed:result.regions.filter(r=>r.reasons.length).length,pngBytes:[...result.pages,...result.fragments].reduce((n,f)=>n+Buffer.from(f.image.split(',')[1],'base64').length,0)};
      await fs.writeFile(path.join(out,file+'.no-ocr.metrics.json'),JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics));
    }
    // Real UI, session cache, and cancellation. One extra development document only.
    if(process.env.CHECK_UI==='1'){
      await page.locator('input[type=file]').setInputFiles(path.join(out,'plate.pdf'));
      await page.getByRole('button',{name:'Подготовить PDF',exact:true}).click();
      await page.getByText(/Подготовка завершена ·/).waitFor({timeout:300000});
      const count=calls;
      await page.getByRole('button',{name:'Подготовить PDF',exact:true}).click();
      await page.getByText(/Подготовка завершена ·/).waitFor();assert.equal(calls,count);
      await page.locator('.journal-toggle').click();
      await page.locator('#journal-content p').filter({hasText:'Использована локальная подготовка из кэша сеанса.'}).waitFor();
      await page.locator('.journal-toggle').click();
      await page.locator('.preparation-panel > summary').click();
      await page.locator('.preparation-regions button').first().click();
      await page.screenshot({path:path.join(out,'preparation-ui.png'),fullPage:true});
      await page.locator('input[type=file]').setInputFiles(path.join(out,'shaft.pdf'));
      await page.getByRole('button',{name:'Подготовить PDF',exact:true}).click();
      await page.getByRole('button',{name:'Остановить',exact:true}).click();
      await page.getByText('Анализ остановлен.',{exact:true}).waitFor({timeout:10000});
      console.log('UI: real preparation, cache, inspector, cancellation passed.');
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
