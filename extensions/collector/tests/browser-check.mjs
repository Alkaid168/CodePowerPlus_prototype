/** Isolated Chromium integration; synthetic records only, no user browser/profile. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {env} from 'node:process';
const root=path.resolve(import.meta.dirname,'../../..');
const output=path.join(root,'output/playwright/collector');await fs.mkdir(output,{recursive:true});
const candidates=[env.COLLECTOR_CHROMIUM_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean);
let executablePath;for(const candidate of candidates){try{await fs.access(candidate);executablePath=candidate;break;}catch{}}
if(!executablePath)throw Error('No Chromium, Edge, or Chrome executable found; set COLLECTOR_CHROMIUM_EXECUTABLE');
const extension=path.resolve(import.meta.dirname,'..');
const context=await chromium.launchPersistentContext(path.join(output,'profile-'+Date.now()),{executablePath,headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension],timezoneId:'America/New_York',viewport:{width:1440,height:1000}});
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const id=new URL(worker.url()).host;
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('chrome-extension://'+id+'/collector.html');
 const nativeSavePickerAvailable=await page.evaluate(()=>typeof window.showSaveFilePicker==='function');
 await page.getByRole('heading',{name:'把做题经历带回来'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'开始采集',exact:true}).isEnabled(),false);
 await page.screenshot({path:path.join(output,'empty-1440.png'),fullPage:true});
 // Test Chrome real IndexedDB / worker lifecycle integration with explicit synthetic data.
 await page.evaluate(async()=>{
   const {CollectorStore}=await import('./src/store.js');const {createTask}=await import('./src/engine.js');
   const store=new CollectorStore();const task=createTask({platform:'codeforces',account:'synthetic_student',tabId:999999,includeSource:true});
   await store.saveTask(task);const leased=await store.acquire(task.id,Date.now());leased.status='paused';
   await store.commit(leased,[{submission_id:'1',problem_key:'100/A',submitted_at:'2026-10-21T00:00:00Z',language:'C++',verdict:'OK',score:null,time_ms:2,memory_bytes:1024,source_state:'available',source_code:'int main(){return 0;}',source_hash:null}]);
 });
 await page.getByRole('button',{name:'刷新',exact:true}).click();
 await page.getByText('Codeforces · synthetic_student',{exact:true}).waitFor();
 await page.getByText('已保存',{exact:true}).waitFor();
 await page.getByRole('columnheader',{name:'提交时间（UTC+8）',exact:true}).waitFor();
 await page.getByRole('cell',{name:'2026-10-21 08:00:00',exact:true}).waitFor();
 await page.evaluate(async()=>{const {CollectorStore}=await import('./src/store.js');const store=new CollectorStore();const task=(await store.tasks())[0];await store.saveUploadJob({taskId:task.id,taskUpdatedAt:task.updatedAt,origin:'http://127.0.0.1:8000',totalRecords:1,nextBatch:0,batches:[{batchId:'synthetic-batch',start:0,end:1}]});});
 await page.getByRole('button',{name:'继续上传（0/1批）'}).waitFor();
 await page.getByRole('button',{name:'清除上传进度'}).click();
 await page.getByRole('button',{name:'继续上传（0/1批）'}).waitFor({state:'hidden'});
 await page.evaluate(()=>{window.__exportChunks=[];window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async chunk=>window.__exportChunks.push(chunk),close:async()=>{},abort:async()=>{}})});});
 await page.getByRole('button',{name:'导出全部 JSON'}).click();await page.getByText('导出已完成，请打开文件核对记录数后再卸载扩展。',{exact:true}).waitFor();
 const exportedText=await page.evaluate(()=>window.__exportChunks.join(''));const exportPath=path.join(output,'synthetic-export.json');await fs.writeFile(exportPath,exportedText);
 const exported=JSON.parse(exportedText);assert.equal(exported.batches[0].submissions[0].source_code,'int main(){return 0;}');
 assert.equal(exported.batches[0].account_id,'synthetic_student');
 assert.equal(exported.batches[0].submissions[0].submitted_at,'2026-10-21T00:00:00Z');
 // A missing synthetic tab must report a handled identity error.
 await page.getByRole('button',{name:'重新同步',exact:true}).click();
 await page.getByText('账号不一致，请回到本人登录的标签页。',{exact:true}).waitFor();
 await page.evaluate(async()=>{
   const {CollectorStore}=await import('./src/store.js');const store=new CollectorStore();
   const task=(await store.tasks())[0];task.status='blocked';task.error='access_denied';
   task.diagnostic={action:'source',status:403,path:'/contest/1234/submission/123456789'};
   await store.saveTask(task);
 });
 await page.getByRole('button',{name:'刷新',exact:true}).click();
 await page.getByText('源码页 · HTTP 403 · https://codeforces.com/contest/1234/submission/123456789',{exact:true}).waitFor();
 await page.getByText(/平台拒绝了该请求（403），未识别到验证页/).waitFor();
 await page.screenshot({path:path.join(output,'task-1440.png'),fullPage:true});
 for(const width of [1280,1024,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'horizontal overflow '+width);}
 await page.screenshot({path:path.join(output,'task-mobile.png'),fullPage:true});
 let confirmation='';
 page.once('dialog',async dialog=>{confirmation=dialog.message();await dialog.dismiss();});
 await page.getByRole('button',{name:'删除本地任务',exact:true}).click();
 assert.match(confirmation,/无法撤销/);assert.match(confirmation,/服务器已接收/);
 assert.equal(await page.locator('#tasks .task').count(),1);
 // Only synthetic task in the disposable profile; test both confirmation paths.
 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'删除本地任务',exact:true}).click();
 await page.getByText('已删除本地任务及其记录；服务器数据和导出文件不受影响。',{exact:true}).waitFor();
 await page.getByText('还没有任务，先连接一个已登录的平台。',{exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(async()=>{
   const {CollectorStore}=await import('./src/store.js');const db=await new CollectorStore().db();
   return Promise.all(['tasks','records','uploads'].map(name=>new Promise((resolve,reject)=>{
     const request=db.transaction(name).objectStore(name).count();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
   })));
 }),[0,0,0]);
 assert.equal(await page.locator('#export').isEnabled(),false);
 assert.deepEqual(errors,[]);
 const report={extensionLoaded:true,realIndexedDB:true,syntheticExport:true,utc8DisplayInNewYorkTimezone:true,exportPreservesUTCTimestamp:true,nativeSavePickerAvailable,uploadCheckpointUI:true,resyncInvalidTabHandled:true,httpFailureDiagnosticUI:true,deleteCancelAndConfirmUI:true,deleteClearsAllLocalTaskStores:true,responsiveWidths:[1280,1024,390],consoleErrors:errors,liveOJAccountsTested:false};
 await fs.writeFile(path.join(output,'browser-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await context.close();}
