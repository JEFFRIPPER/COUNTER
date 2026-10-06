'use strict';
// npm install --no-save playwright ; npx playwright install chromium
// node tests/ui.test.cjs (or CHROMIUM_PATH=/path/to/chromium node ...)
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const html = fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');

(async()=>{
  const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  let browser;
  try {
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage',...(process.env.CHROMIUM_SINGLE_PROCESS?['--single-process','--no-zygote','--disable-gpu']:[])]});
    const context=await browser.newContext({viewport:{width:1050,height:1000},locale:'ru-RU',timezoneId:'Europe/Berlin',acceptDownloads:true});
    const page=await context.newPage(),errors=[],external=[];
    page.on('pageerror',e=>errors.push(e.message));
    context.on('request',request=>{if(!request.url().startsWith(url)&&!request.url().startsWith('blob:'))external.push(request.url());});
    const count=async id=>Number(await page.locator('#'+id).textContent());
    const confirm=async()=>{await page.locator('#dialogConfirm').click();};
    const input=async value=>{await page.locator('#dialogInput').fill(String(value));await confirm();};
    const row=name=>page.locator('.item-row').filter({has:page.locator('.item-name',{hasText:new RegExp('^'+name+'$')})});
    await page.goto(url);
    assert.equal(await page.locator('.item-row').count(),8);
    await row('НДЗ').getByRole('button',{name:'Добавить НДЗ',exact:true}).click();
    await row('Успешно').getByRole('button',{name:'Добавить Успешно',exact:true}).click();
    assert.equal(await count('totalComm'),2);
    assert.equal(await page.locator('#effSuccess').textContent(),'50%');
    await page.locator('#commPlus').click();
    assert.equal(await count('commCount'),1);
    assert.equal(await count('totalComm'),2);
    await page.locator('#undoBtn').click();
    assert.equal(await count('commCount'),0);
    await page.locator('#undoBtn').click();
    assert.equal(await count('totalComm'),1);
    await row('НДЗ').getByRole('button',{name:'Добавить НДЗ',exact:true}).click();
    await page.locator('#undoBtn').click();
    assert.equal(await count('totalComm'),1,'New mutation must not alias previous undo snapshots');
    console.log('PASS counters, total, percentage, independent communications, repeated undo');

    await page.locator('#startShiftBtn').click();
    await page.locator('#pauseShiftBtn').click();
    const paused=await page.evaluate(()=>JSON.parse(localStorage.getItem('commStatsData_default')));
    assert.ok(paused.pauseStart);
    await page.reload();
    assert.equal(await page.locator('#shiftStatusText').textContent(),'Пауза');
    assert.equal(await page.locator('#pauseShiftBtn span').textContent(),'Продолжить');
    const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('commStatsData_default')));
    assert.equal(restored.pauseStart,paused.pauseStart);
    await page.locator('#shiftNotes').fill('<img src=x onerror=alert(1)>');
    await page.locator('#endShiftBtn').click();await confirm();
    await page.locator('#historyBtn').click();
    assert.equal(await page.locator('.history-item img').count(),0);
    assert.ok((await page.locator('.history-item').textContent()).includes('<img src=x'));
    await page.locator('#historyCloseBtn').click();
    await page.locator('#undoBtn').click();
    assert.equal(await page.locator('#shiftStatusText').textContent(),'Пауза');
    await page.locator('#historyBtn').click();
    assert.equal(await page.locator('.history-item').count(),0,'Undo completion must undo archived history too');
    await page.locator('#historyCloseBtn').click();
    console.log('PASS start, pause, persisted pause, history, safe notes, undo completion');

    await page.locator('#settingsBtn').click();await page.locator('#profileAddBtn').click();await input('Тест');
    assert.equal(await count('totalComm'),0);
    await page.locator('#settingsBtn').click();await page.locator('#profileRenameBtn').click();await input('Второй');
    await page.locator('#profileSelect').selectOption('default');
    assert.equal(await count('totalComm'),1);
    await page.locator('#profileSelect').selectOption('Второй');
    await page.locator('#settingsBtn').click();await page.locator('#profileDelBtn').click();await confirm();
    assert.equal(await page.locator('#profileSelect option').count(),1);
    await page.locator('#addBtn').click();await input('Моя категория');
    assert.equal(await page.locator('.item-row').count(),9);
    await page.locator('.item-row').last().getByRole('button',{name:'Настроить Моя категория',exact:true}).click();
    await page.locator('#itemEditBtn').click();await input('5');
    assert.equal(await count('totalComm'),6);
    await page.locator('#resetBtn').click();await confirm();
    assert.equal(await count('totalComm'),0);
    await page.locator('#undoBtn').click();
    assert.equal(await count('totalComm'),6);
    console.log('PASS profile create, rename, switch, delete; category edit; reset and undo');

    const downloadEvent=page.waitForEvent('download');await page.locator('#exportCsvBtn').click();const download=await downloadEvent;
    assert.ok(download.suggestedFilename().endsWith('.csv'));
    const csv=fs.readFileSync(await download.path(),'utf8');assert.ok(csv.includes('"Моя категория","5"'));
    await page.locator('#settingsBtn').click();
    const backupEvent=page.waitForEvent('download');await page.locator('#backupBtn').click();const backup=await backupEvent;
    const backupPath=await backup.path(),copy=JSON.parse(fs.readFileSync(backupPath,'utf8'));assert.equal(copy.schema,2);
    await page.locator('#settingsCloseBtn').click();
    await page.locator('#resetBtn').click();await confirm();
    await page.locator('#importFile').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(copy))});await confirm();
    assert.equal(await count('totalComm'),6);
    console.log('PASS CSV, JSON backup and restore');

    await page.locator('#themeToggle').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    await page.reload();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    const output=process.env.SCREENSHOT_DIRECTORY;
    if(output){fs.mkdirSync(output,{recursive:true});await page.waitForTimeout(350);await page.screenshot({path:path.join(output,'counter-dark.png'),fullPage:true});}
    await page.locator('#themeToggle').click();
    if(output){await page.waitForTimeout(350);await page.screenshot({path:path.join(output,'counter-light.png'),fullPage:true});}
    await page.setViewportSize({width:420,height:860});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    assert.equal(overflow,false);
    if(output)await page.screenshot({path:path.join(output,'counter-narrow.png'),fullPage:true});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('#commPlus').click();assert.equal(await page.locator('.ripple').count(),0);
    assert.deepEqual(errors,[]);
    assert.deepEqual(external,[]);
    console.log('PASS light/dark persistence, narrow layout, reduced motion, offline UI, zero JavaScript errors');
    await context.close();
  } finally { if(browser)await browser.close();server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
