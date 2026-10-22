import {test} from 'node:test';
import assert from 'node:assert/strict';
import {serverOrigin,createUploadJob,uploadPlannedBatches} from '../src/upload.js';
import {indexedDB} from 'fake-indexeddb';
import {CollectorStore} from '../src/store.js';
import {createTask,stepTask,exportBatches} from '../src/engine.js';
globalThis.indexedDB=indexedDB;
const row={submission_id:'7',problem_key:'1/A',submitted_at:'2026-10-21T00:00:00Z',language:'C++',verdict:'OK',source_state:'not_requested',source_code:null};
const config={platform:'codeforces',account:'alice',tabId:1,includeSource:false};
test('upload job checkpoint survives reopening IndexedDB',async()=>{
 const name='test-'+crypto.randomUUID();const first=new CollectorStore(name);
 const job={taskId:'task-1',origin:'https://school.example',totalRecords:51,nextBatch:2,batches:[{batchId:'stable-1',start:0,end:25},{batchId:'stable-2',start:25,end:50},{batchId:'stable-3',start:50,end:51}]};
 await first.saveTask({id:'task-1',status:'paused'});
 await first.saveUploadJob(job);
 const reopened=new CollectorStore(name);
 assert.deepEqual(await reopened.uploadJob('task-1'),job);
 await reopened.clearUploadJob('task-1');
 assert.equal(await first.uploadJob('task-1'),undefined);
});
test('upgrade from the shipped version-2 database preserves tasks, records, uploads and adds recent index',async()=>{
 const name='legacy-'+crypto.randomUUID();
 await new Promise((resolve,reject)=>{
  const request=indexedDB.open(name,2);
  request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('tasks',{keyPath:'id'});const records=db.createObjectStore('records',{keyPath:['taskId','submission_id']});records.createIndex('task','taskId');db.createObjectStore('uploads',{keyPath:'taskId'});};
  request.onsuccess=()=>{request.result.close();resolve();};request.onerror=()=>reject(request.error);
 });
 const legacyDb=await new Promise((resolve,reject)=>{const request=indexedDB.open(name,2);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 const tx=legacyDb.transaction(['tasks','records','uploads'],'readwrite');
 tx.objectStore('tasks').put({id:'task-1',platform:'codeforces'});
 tx.objectStore('records').put({taskId:'task-1',submission_id:'1',verdict:'OK'});
 tx.objectStore('uploads').put({taskId:'task-1',origin:'https://school.example',nextBatch:2});
 await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});legacyDb.close();
 const upgraded=new CollectorStore(name);
 assert.deepEqual(await upgraded.task('task-1'),{id:'task-1',platform:'codeforces'});
 assert.deepEqual(await upgraded.records('task-1'),[{submission_id:'1',verdict:'OK'}]);
 assert.deepEqual(await upgraded.uploadJob('task-1'),{taskId:'task-1',origin:'https://school.example',nextBatch:2});
 const db=await upgraded.db();assert.deepEqual(Array.from(db.transaction('records').objectStore('records').indexNames),['task','task_submitted']);
});
test('a repeated nonempty page with a moving offset blocks instead of infinite collection',async()=>{
 const store=new CollectorStore('test-'+crypto.randomUUID());const task=createTask(config);await store.saveTask(task);
 await stepTask(store,task.id,async()=>({items:[row],next:{offset:101},done:false}),10000);
 await stepTask(store,task.id,async()=>({items:[row],next:{offset:201},done:false}),14000);
 assert.equal((await store.task(task.id)).error,'page_repeated');
});
test('failure during persistence cannot advance a cursor using in-memory mutations',async()=>{
 const real=new CollectorStore('test-'+crypto.randomUUID());const task=createTask(config);await real.saveTask(task);
 const store=Object.create(real);store.commit=async()=>{throw Error('disk_full');};
 await assert.rejects(stepTask(store,task.id,async()=>({items:[row],next:{offset:101},done:false}),10000));
 assert.deepEqual((await real.task(task.id)).cursor,{offset:1});
});
test('unavailable source does not block the rest of history or become available empty text',async()=>{
 const store=new CollectorStore('test-'+crypto.randomUUID());const task=createTask({...config,includeSource:true});await store.saveTask(task);
 await stepTask(store,task.id,async()=>({items:[row],next:{offset:101},done:false}),10000);
 await stepTask(store,task.id,async()=>({error:'source_unavailable'}),14000);
 assert.equal((await store.records(task.id))[0].source_state,'unavailable');
 assert.equal((await store.task(task.id)).status,'running');
});
test('upload refuses userinfo, paths and insecure remote destinations; strips credentials',async()=>{
 for(const url of ['http://example.org','https://user:pass@example.org','https://example.org/path','https://example.org/?key=secret'])assert.throws(()=>serverOrigin(url));
 let options;
 globalThis.fetch=async(url,opts)=>{assert.equal(url,'https://school.example/api/collection/batches');options=opts;return {ok:true,json:async()=>({inserted:1,updated:0})};};
 const task={...createTask(config),status:'complete'};
 const records=[row];const job=createUploadJob(task,records,'https://school.example');
 assert.equal(await uploadPlannedBatches('https://school.example','token',job,records,async()=>{}),1);
 assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
 assert.equal(JSON.parse(options.body).submissions[0].submission_id,'7');
});
