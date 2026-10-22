/** Isolated, routed synthetic pages shaped after observed 2026-10-22 DOM. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const output=path.resolve(import.meta.dirname,'../../../output/playwright/collector');
await fs.mkdir(output,{recursive:true});
const candidates=[process.env.COLLECTOR_CHROMIUM_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean);
let executable;for(const candidate of candidates){try{await fs.access(candidate);executable=candidate;break;}catch{}}
if(!executable)throw Error('No installed Chromium found');
const source=path.resolve(import.meta.dirname,'..'),extension=path.join(output,'adapter-fixture-extension');
await fs.mkdir(extension,{recursive:true});
for(const file of ['manifest.json','collector.html','collector.css'])await fs.copyFile(path.join(source,file),path.join(extension,file));
await fs.cp(path.join(source,'src'),path.join(extension,'src'),{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8'));
manifest.host_permissions=['https://atcoder.jp/*','https://vjudge.net/*','https://kenkoooo.com/*'];
await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
const context=await chromium.launchPersistentContext(path.join(output,'adapter-profile-'+Date.now()),{executablePath:executable,headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
 const acHeader='<div id="navbar-collapse"><a href="/users/synthetic_student">synthetic_student</a></div>';
 const vjHeader='<li class="top-nav-user-item"><a id="userNameDropdown">synthetic_student</a><div class="user-dropdown"><a data-i18n="top.nav.profile" href="/user/synthetic_student">个人信息</a></div></li>';
 const requests=[];
 await context.route('https://atcoder.jp/**',async route=>{
   const url=new URL(route.request().url());requests.push(url.pathname);
   let body=acHeader;
   if(url.pathname==='/contests/practice2/submissions/77')body+='<pre id="submission-code">int main(){return 77;}</pre>';
   await route.fulfill({status:200,contentType:'text/html',body});
 });
 await context.route('https://vjudge.net/**',async route=>{
   const url=new URL(route.request().url());
   const body=url.pathname==='/status/data'?JSON.stringify({data:url.searchParams.get('start')==='0'?[{runId:7,userName:'synthetic_student',oj:'POJ',probNum:'1000',time:1700000000000,language:'C++',status:'Accepted'}]:[]}):vjHeader;
   await route.fulfill({status:200,contentType:url.pathname==='/status/data'?'application/json':'text/html',body});
 });
 const replicaRequests=[];
 await context.route('https://kenkoooo.com/**',async route=>{
   const request=route.request(),url=new URL(request.url());replicaRequests.push(url.pathname);
   assert.equal(url.searchParams.get('user'),'synthetic_student');
   assert.equal(request.headers().cookie,undefined);assert.equal(request.headers().authorization,undefined);
   const body=url.pathname.endsWith('/submission_count')?{count:1}:[{id:77,user_id:'synthetic_student',contest_id:'practice2',problem_id:'practice2_a',epoch_second:1700000000,language:'C++',result:'AC',point:100,execution_time:5}];
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 const ac=await context.newPage();await ac.goto('https://atcoder.jp/');
 const vj=await context.newPage();await vj.goto('https://vjudge.net/');
 const ui=await context.newPage(),errors=[];ui.on('pageerror',e=>errors.push(e.message));
 await ui.goto('chrome-extension://'+id+'/collector.html');
 const tasks=await ui.evaluate(async()=>{
   const started=[];
   for(const platform of ['atcoder','vjudge']){
     const identity=await chrome.runtime.sendMessage({type:'identify',platform});if(identity.error)throw Error(identity.error);
     if(identity.account!=='synthetic_student')throw Error('wrong identity');
     const result=await chrome.runtime.sendMessage({type:'start',...identity,includeSource:platform==='atcoder'});
     if(result.error)throw Error(result.error);started.push(result.id);
   }
   return started;
 });
 const observed=[];
 for(let attempt=0;attempt<90;attempt++){
   const states=await ui.evaluate(async ids=>{
     const {CollectorStore}=await import('./src/store.js');const store=new CollectorStore();
     return Promise.all(ids.map(async id=>{const t=await store.task(id);return {id,status:t.status,phase:t.phase,error:t.error,pages:t.pages};}));
   },tasks);
   const state=JSON.stringify(states);if(state!==observed.at(-1))observed.push(state);
   if(states.every(t=>['complete','blocked'].includes(t.status)))break;
   await new Promise(resolve=>setTimeout(resolve,500));
 }
 const result=await ui.evaluate(async ids=>{
   const {CollectorStore}=await import('./src/store.js');const store=new CollectorStore();
   return Promise.all(ids.map(async id=>({task:await store.task(id),records:await store.records(id)})));
 },tasks);
 for(const r of result){assert.equal(r.task.status,'complete',JSON.stringify({task:r.task,observed,requests}));assert.equal(r.records.length,1);}
 assert.equal(result[0].task.pages,1);
 assert.equal(result[0].task.coverageScope,'replica_submissions');
 assert.equal(result[0].records[0].source_code,'int main(){return 77;}');
 assert.equal(result[1].records[0].problem_key,'POJ/1000');
 assert.deepEqual(requests.filter(p=>p.includes('/submissions')),['/contests/practice2/submissions/77']);
 assert.equal(await ui.locator('#atcoder-mode').count(),0);
 assert.equal(await ui.locator('#contests').count(),0);
 // Construct a historical task in the disposable profile, then run its guard.
 await ui.evaluate(async taskId=>{
   const {CollectorStore}=await import('./src/store.js');const {stepTask}=await import('./src/engine.js');const store=new CollectorStore();
   const t=await store.task(taskId);t.status='running';t.coverageScope='archive_contests';t.atcoderMode='archive';
   t.phase='list';t.cursor={contest:'asprocon9',page:1};t.nextDue=0;t.pages=411;t.requests=527;
   await store.saveTask(t);
   await store.commit(t,[{submission_id:'99',problem_key:'abc100/abc100_a',submitted_at:'2026-10-21T00:00:00Z',language:'C++',verdict:'AC',source_state:'available',source_code:'// synthetic earlier official record',source_hash:null}]);
   const guarded=await stepTask(store,taskId,async()=>{throw Error('legacy scan issued a request');});
   if(guarded.error!=='atcoder_fast_required'||guarded.requests!==527)throw Error('legacy task was not guarded');
   for(const message of [{type:'status',status:'running'},{type:'resync'}]){
     const reply=await chrome.runtime.sendMessage({...message,id:taskId});
     if(reply.error!=='atcoder_fast_required')throw Error('legacy message allowed');
   }
 },tasks[0]);
 const beforeFast=requests.length;replicaRequests.length=0;
 await ui.getByRole('button',{name:'刷新',exact:true}).click();
 await ui.getByText('逐比赛扫描已停用，已有数据保留，请点“改用快速采集”。',{exact:true}).last().waitFor();
 assert.equal(await ui.getByRole('button',{name:'继续',exact:true}).count(),0);
 assert.equal(await ui.getByRole('button',{name:'重新同步',exact:true}).count(),1);
 await ui.getByRole('button',{name:'改用快速采集',exact:true}).click();
 let fast;
 for(let attempt=0;attempt<90;attempt++){
   fast=await ui.evaluate(async id=>{
     const {CollectorStore}=await import('./src/store.js');return new CollectorStore().task(id);
   },tasks[0]);
   if(fast.coverageScope==='replica_submissions'&&['complete','blocked'].includes(fast.status))break;
   await new Promise(resolve=>setTimeout(resolve,500));
 }
 assert.equal(fast.coverageScope,'replica_submissions');assert.equal(fast.status,'complete',JSON.stringify(fast));
 assert.equal(fast.replicaVerified,true);assert.equal(fast.replicaCollected,1);
 const fastRows=await ui.evaluate(async id=>{
   const {CollectorStore}=await import('./src/store.js');return new CollectorStore().records(id);
 },tasks[0]);
 assert.equal(fastRows.length,2); // Prior official data survives mode change.
 assert.equal(fastRows.find(r=>r.submission_id==='77').source_code,'int main(){return 77;}');
 assert.equal(fastRows.find(r=>r.submission_id==='99').source_code,'// synthetic earlier official record');
 assert.deepEqual(requests.slice(beforeFast),['/contests/practice2/submissions/77']);
 assert.deepEqual(replicaRequests.map(p=>p.split('/').pop()),['submission_count','submissions','submission_count']);
 await ui.getByRole('button',{name:'刷新',exact:true}).click();
 await ui.getByText(/副本范围已遍历（不等于官网全量）/).waitFor();
 assert.equal(requests.some(p=>p==='/contests/archive'||/^\/contests\/[^/]+\/submissions$/.test(p)),false);
 assert.deepEqual(errors,[]);
 await ui.screenshot({path:path.join(output,'atcoder-fast-only.png'),fullPage:true});
 const report={synthetic:true,realWorker:true,vjudgeCurrentDropdown:true,atcoderDefaultsToFast:true,legacyScanStopsBeforeNetwork:true,legacyResumeAndResyncRejected:true,removedContestControls:true,atcoderFastMigrationUI:true,fastIncludesPracticeSubmissions:true,fastPreservesOldRecords:true,replicaRequestsHaveNoCredentials:true,fastOfficialRequestsOnlySource:true,liveAccountCollectionTested:false,consoleErrors:errors};
 await fs.writeFile(path.join(output,'adapter-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await context.close();}
