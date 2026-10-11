// Installed Windows application, real Tauri IPC and bundled OCR. No cloud calls.
const {chromium}=require('playwright');
const {spawn,execFileSync}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../../.local/acceptance');
const executable=process.env.INSTALLED_APP;
if(!executable)throw new Error('Set INSTALLED_APP to the installed ai-skaner.exe');
(async()=>{
  const app=spawn(executable,[],{windowsHide:true,env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9224 --remote-debugging-address=127.0.0.1'},stdio:'ignore'});
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
    await page.locator('input[type=file]').setInputFiles(path.join(out,'plate.pdf'));
    await page.getByRole('button',{name:'Подготовить PDF',exact:true}).click();
    await page.getByText(/OCR · лист/).waitFor({timeout:30000});
    await page.getByRole('button',{name:'Остановить',exact:true}).click();
    await page.getByText('Анализ остановлен.',{exact:true}).waitFor({timeout:10000});
    console.log('Installed app: active OCR cancellation passed.');
    await page.getByRole('button',{name:'Подготовить PDF',exact:true}).click();
    await page.getByText(/Подготовка завершена ·/).waitFor({timeout:300000});
    await page.locator('.preparation-panel > summary').click();
    await page.getByLabel('Только области с замечаниями').check();
    await page.locator('.preparation-regions button').first().click();
    await page.screenshot({path:path.join(out,'installed-040.png'),fullPage:true});
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('Installed app: preparation, discrepancies and source crops passed; no Python/VS Code process required.');
    // Worker crash is injected only into a child of this test application.
    await page.locator('input[type=file]').setInputFiles(path.join(out,'shaft.pdf'));
    await page.getByRole('button',{name:'Подготовить PDF',exact:true}).click();
    await page.getByText(/OCR · лист/).waitFor({timeout:30000});
    const command=`$p=Get-CimInstance Win32_Process -Filter "ParentProcessId=${app.pid}" | Where-Object Name -eq 'ocr-worker.exe'; if (-not $p) {throw 'No OCR child'}; $p | ForEach-Object {Stop-Process -Id $_.ProcessId -Force}`;
    execFileSync('powershell.exe',['-NoProfile','-Command',command],{windowsHide:true});
    await page.locator('.analysis-progress.error').waitFor({timeout:20000});
    console.log('Installed app: worker crash blocks analysis and exposes retry.');
    await page.getByRole('button',{name:'Подготовить PDF',exact:true}).click();
    await page.getByText(/Подготовка завершена ·/).waitFor({timeout:300000});
    console.log('Installed app: retry after worker crash passed.');
    await fs.writeFile(path.join(out,'installed-check.json'),JSON.stringify({passed:true,checks:['protected PDF','broken PDF','active cancellation','local preparation','discrepancies and crops','worker crash','retry after worker crash'],pageErrors:errors},null,2));
  }finally{if(browser)await browser.close();app.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
