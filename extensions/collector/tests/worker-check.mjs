import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {env} from 'node:process';
import path from 'node:path';
import http from 'node:http';
const root=path.resolve(import.meta.dirname,'../../..');const output=path.join(root,'output/playwright/collector');
const candidates=[env.COLLECTOR_CHROMIUM_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean);
let executable;for(const candidate of candidates){try{await fs.access(candidate);executable=candidate;break;}catch{}}
if(!executable)throw Error('No Chromium, Edge, or Chrome executable found; set COLLECTOR_CHROMIUM_EXECUTABLE');
const source=path.resolve(import.meta.dirname,'..');const extension=path.join(output,'fixture-extension');
await fs.mkdir(extension,{recursive:true});
for(const file of ['manifest.json','collector.html','collector.css'])await fs.copyFile(path.join(source,file),path.join(extension,file));
await fs.cp(path.join(source,'src'),path.join(extension,'src'),{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8'));manifest.host_permissions=['https://codeforces.com/*','http://127.0.0.1/*'];
await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
const uploads=[];let rejectQuota=true;
const server=http.createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 assert.equal(req.url,'/api/collection/batches');assert.equal(req.headers.cookie,undefined);
 assert.equal(req.headers.authorization,'Bearer synthetic-local-token');
 uploads.push(JSON.parse(body));
 res.setHeader('Content-Type','application/json');
 if(rejectQuota){rejectQuota=false;res.writeHead(413);res.end(JSON.stringify({detail:{code:'storage_quota_exceeded'}}));}
 else res.end(JSON.stringify({inserted:1,updated:0,replayed:false}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const context=await chromium.launchPersistentContext(path.join(output,'worker-profile-'+Date.now()),{executablePath:executable,headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
 await context.route('https://codeforces.com/**',async route=>{
   const url=new URL(route.request().url());let body='<div id="header"><a href="/profile/synthetic_student">synthetic_student</a></div>';
   if(url.pathname==='/api/user.status')body=JSON.stringify({status:'OK',result:url.searchParams.get('from')==='1'?[{id:123,creationTimeSeconds:1792537200,problem:{contestId:100,index:'A'},author:{members:[{handle:'synthetic_student'}]},programmingLanguage:'C++',verdict:'OK',timeConsumedMillis:2,memoryConsumedBytes:1024}]:[]});
   if(url.pathname==='/contest/100/submission/123')body='<pre id="program-source-text">int main(){return 0;}</pre>';
   await route.fulfill({status:200,contentType:url.pathname.startsWith('/api')?'application/json':'text/html',body});
 });
 const oj=await context.newPage();await oj.goto('https://codeforces.com/');
 const ui=await context.newPage();await ui.goto('chrome-extension://'+id+'/collector.html');
 // Fixture-only package pregrants the routed synthetic origin; shipping package uses user-gesture permission.
 const start=await ui.evaluate(async()=>{
   const identity=await chrome.runtime.sendMessage({type:'identify',platform:'codeforces'});
   if(identity.error)throw Error(identity.error);
   const started=await chrome.runtime.sendMessage({type:'start',...identity,includeSource:true,contests:[]});
   if(started.error)throw Error(started.error);return started.id;
 });
 for(let attempt=0;attempt<60;attempt++){const status=await ui.evaluate(async id=>{const {CollectorStore}=await import('./src/store.js');return (await new CollectorStore().task(id)).status;},start);if(status==='complete')break;if(status==='blocked')throw Error('worker blocked');await new Promise(resolve=>setTimeout(resolve,500));}
 const result=await ui.evaluate(async id=>{const {CollectorStore}=await import('./src/store.js');const store=new CollectorStore();return {task:await store.task(id),rows:await store.records(id)};},start);
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].source_code,'int main(){return 0;}');assert.equal(result.task.pages,2);
 assert.equal(result.rows[0].source_hash.length,64);
 const errors=[];ui.on('pageerror',error=>errors.push(error.message));
 await ui.getByRole('button',{name:'刷新',exact:true}).click();
 await ui.getByRole('button',{name:'重新同步',exact:true}).click();
 await ui.waitForFunction(async previous=>{
   const {CollectorStore}=await import('./src/store.js');
   const task=await new CollectorStore().task(previous.id);
   return task.updatedAt!==previous.updatedAt&&task.status==='complete';
 },result.task,{timeout:30000});
 const replay=await ui.evaluate(async id=>{
   const {CollectorStore}=await import('./src/store.js');
   return new CollectorStore().records(id);
 },start);
 assert.equal(replay.length,1);assert.equal(replay[0].source_code,'int main(){return 0;}');
 assert.deepEqual(errors,[]);
 assert.equal(await ui.locator('#notice').textContent(),'');
 await ui.locator('#server').fill(origin);
 await ui.locator('#token').fill('synthetic-local-token');
 await ui.locator('#consent').check();
 await ui.getByRole('button',{name:'授权并上传',exact:true}).click();
 await ui.getByText('服务器存储空间不足，请清理数据或调整配额后继续；已确认批次保留',{exact:true}).waitFor();
 await ui.getByRole('button',{name:'继续上传（0/1批）',exact:true}).waitFor();
 assert.equal(await ui.locator('#token').inputValue(),'');
 await ui.locator('#token').fill('synthetic-local-token');
 await ui.getByRole('button',{name:'继续上传（0/1批）',exact:true}).click();
 await ui.getByText('服务器已确认接收 1 条记录，可以卸载扩展；以后同步需重新安装。',{exact:true}).waitFor();
 assert.equal(uploads.length,2);assert.equal(uploads[0].batch_id,uploads[1].batch_id);
 assert.equal(uploads[1].submissions[0].source_code,'int main(){return 0;}');
 assert.equal(await ui.locator('#token').inputValue(),'');
 assert.equal(await ui.locator('#consent').isChecked(),false);
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(output,'worker-check.json'),JSON.stringify({synthetic:true,realExtensionWorker:true,sameOriginPageFetch:true,records:1,sourceCode:true,pages:result.task.pages,taskStatus:result.task.status,resyncUIDedup:true,uploadUIQuotaRetry:true,uploadStripsCookies:true},null,2));
 console.log('PASS: synthetic CF browser page -> real extension worker -> IndexedDB, 1 source, 2 pages');
}finally{await context.close();await new Promise(resolve=>server.close(resolve));}
