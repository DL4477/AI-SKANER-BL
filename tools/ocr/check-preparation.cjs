// Browser executes the real PDF.js preparation; IPC forwards to the packaged OCR.
// The harness never calls a cloud API. Requires Playwright and running Vite at 5173.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const out=path.join(root,'.local/acceptance');
let worker, pending, buffer='', calls=0, begins=0;
const executable=process.env.OCR_WORKER||path.join(root,'.local/ocr-dist/ocr-worker/ocr-worker.exe');
function stop(){ if(worker){worker.kill();worker=null;} if(pending){pending.reject(new Error('OCR cancelled'));pending=null;} }
function start(){
  stop();buffer='';worker=spawn(executable,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const currentWorker=worker;
  worker.stderr.on('data',chunk=>fs.appendFile(path.join(out,'worker-stderr.log'),chunk));
  worker.stdout.setEncoding('utf8');
  worker.on('error',e=>{if(worker===currentWorker&&pending){pending.reject(e);pending=null;}});
  worker.stdin.on('error',e=>{if(worker===currentWorker&&pending){pending.reject(e);pending=null;}});
  worker.stdout.on('data',chunk=>{
    if(worker!==currentWorker)return;
    buffer+=chunk.toString('utf8');let end;
    while((end=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
      const current=pending;pending=null;if(!current)continue;
      try{const r=JSON.parse(line);r.ok?current.resolve(r.data):current.reject(new Error(r.error));}catch(e){current.reject(e);}
    }
  });
  worker.on('exit',()=>{if(worker===currentWorker&&pending){pending.reject(new Error('Worker exited'));pending=null;}});
}
async function ipc(cmd,args){
  if(cmd==='model_status')return {provider:'Kimi API',model:'kimi-k3',endpoint:'https://api.moonshot.ai/v1',keyStored:true};
  if(cmd==='ocr_begin'){begins++;start();return;}
  if(cmd==='ocr_end'||cmd==='ocr_cancel'){stop();return;}
  if(cmd==='ocr_image'){
    calls++;assert(worker&&!pending);
    if(calls%10===0)console.log(`OCR calls: ${calls}, ${args.mode}`);
    return new Promise((resolve,reject)=>{pending={resolve,reject};worker.stdin.write(JSON.stringify({mode:args.mode,image:args.image,dpi:args.dpi})+'\n');}).catch(async e=>{await fs.writeFile(path.join(out,'failed-ocr.json'),JSON.stringify({mode:args.mode,image:args.image,dpi:args.dpi}));throw e;});
  }
  if(cmd==='analyze_drawing')throw new Error('Cloud requests are prohibited in this offline harness');
  throw new Error('Unexpected IPC: '+cmd);
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
        try{return await preparePdf({name:file,kind:'pdf',url},crypto.randomUUID(),window.prepAbort.signal,t=>window.prepProgress=t);}
        finally{URL.revokeObjectURL(url);}
      },{encoded:bytes.toString('base64'),file});
      assert.equal(result.status,'complete');
      assert.equal(result.coverage.unfinishedPages.length,0);
      assert(result.fragments.every(f=>f.width<=2000&&f.height<=2000));
      assert(result.regions.every(r=>r.polygon.every(p=>p.every(n=>n>=0&&n<=1))));
      await fs.writeFile(path.join(out,file+'.prepared.json'),JSON.stringify(result));
      const metrics={file,seconds:(Date.now()-started)/1000,ocrCalls:calls-before,pages:result.pages.length,fragments:result.fragments.length,regions:result.regions.length,disputed:result.regions.filter(r=>r.reasons.length).length,pngBytes:[...result.pages,...result.fragments].reduce((n,f)=>n+Buffer.from(f.image.split(',')[1],'base64').length,0)};
      await fs.writeFile(path.join(out,file+'.metrics.json'),JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics));
    }
    // Real UI, session cache, and cancellation. One extra development document only.
    if(process.env.CHECK_UI==='1'){
      await page.locator('input[type=file]').setInputFiles(path.join(out,'plate.pdf'));
      await page.getByRole('button',{name:'Подготовить PDF',exact:true}).click();
      await page.getByText(/Подготовка завершена ·/).waitFor({timeout:300000});
      const count=begins;
      await page.getByRole('button',{name:'Подготовить PDF',exact:true}).click();
      await page.getByText(/Подготовка завершена ·/).waitFor();assert.equal(begins,count);
      await page.locator('.preparation-panel > summary').click();
      await page.locator('.preparation-regions button').first().click();
      await page.screenshot({path:path.join(out,'preparation-ui.png'),fullPage:true});
      await page.locator('input[type=file]').setInputFiles(path.join(out,'shaft.pdf'));
      await page.getByRole('button',{name:'Подготовить PDF',exact:true}).click();
      await page.getByRole('button',{name:'Остановить',exact:true}).click();
      await page.getByText('Анализ остановлен.',{exact:true}).waitFor({timeout:10000});
      console.log('UI: real preparation, cache, inspector, cancellation passed.');
    }
  }finally{stop();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
