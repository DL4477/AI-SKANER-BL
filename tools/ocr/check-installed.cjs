// Installed Windows application, real Tauri IPC with OCR disabled. No cloud calls.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../../.local/acceptance');
const executable=process.env.INSTALLED_APP;
const label=process.env.APP_TEST_LABEL||'installed-041';
if(!executable)throw new Error('Set INSTALLED_APP to the installed ai-skaner.exe');
(async()=>{
  const app=spawn(executable,[],{windowsHide:true,env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:path.join(out,'webview-'+label),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9224 --remote-debugging-address=127.0.0.1'},stdio:'ignore'});
  let browser;
  try{
    for(let i=0;i<80;i++){try{const r=await fetch('http://127.0.0.1:9224/json/version');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
    browser=await chromium.connectOverCDP('http://127.0.0.1:9224');
    const context=browser.contexts()[0];let page=context.pages()[0];
    if(!page)page=await context.waitForEvent('page');
    await page.getByRole('button',{name:'Открыть PDF',exact:true}).waitFor();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    for(const fixture of ['protected.pdf','broken.pdf']){
      await page.locator('input[type=file]').setInputFiles(path.join(out,fixture));
      await page.getByRole('heading',{name:fixture}).waitFor();
      await page.getByRole('button',{name:'Подготовить PDF',exact:true}).click();
      await page.locator('.analysis-progress.error').waitFor({timeout:20000});
      console.log(fixture+': '+await page.locator('.analysis-progress.error').innerText());
    }
    await page.evaluate(()=>{
      const invoke=window.__TAURI_INTERNALS__.invoke;
      window.ocrCalls=0;
      window.__TAURI_INTERNALS__.invoke=(cmd,args,options)=>{
        if(cmd.startsWith('ocr_')){window.ocrCalls++;throw new Error('OCR must be disabled');}
        if(cmd==='analyze_drawing')throw new Error('No paid requests in installation test');
        return invoke(cmd,args,options);
      };
    });
    for(const fixture of ['plate.pdf','bushing.pdf','blank.pdf','multipage.pdf']){
      await page.locator('input[type=file]').setInputFiles(path.join(out,fixture));
      await page.getByRole('button',{name:'Подготовить PDF',exact:true}).click();
      await page.getByText(/Подготовка завершена ·/).waitFor({timeout:60000});
      console.log('Installed preparation without OCR: '+fixture);
    }
    await page.locator('input[type=file]').setInputFiles(path.join(out,'plate.pdf'));
    await page.getByRole('button',{name:'Подготовить PDF',exact:true}).click();
    await page.getByText(/Подготовка завершена ·/).waitFor({timeout:60000});
    await page.locator('.preparation-panel > summary').click();
    await page.locator('.preparation-regions button').first().click();
    assert(await page.locator('.preparation-reading img').count()>0);
    await page.screenshot({path:path.join(out,label+'.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>window.ocrCalls),0);
    assert.equal(errors.length,0,errors.join('\n'));
    await fs.writeFile(path.join(out,label+'-check.json'),JSON.stringify({executable,passed:true,ocrCalls:0,checks:['protected PDF','broken PDF','vector PDF','scan','blank','multipage','source crops'],pageErrors:errors},null,2));
  }finally{if(browser)await browser.close();app.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
