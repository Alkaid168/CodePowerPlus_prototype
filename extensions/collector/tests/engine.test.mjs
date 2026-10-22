import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
globalThis.indexedDB=indexedDB;globalThis.IDBKeyRange=IDBKeyRange;
import {CollectorStore} from '../src/store.js';
import {createTask,stepTask} from '../src/engine.js';
const row={submission_id:'1',problem_key:'1/A',submitted_at:'2026-10-21T00:00:00.000Z',language:'C++',verdict:'OK',score:null,time_ms:0,memory_bytes:null,source_state:'not_requested',source_code:null,source_hash:null};
const config={platform:'codeforces',account:'alice',tabId:1,includeSource:true};
test('page + cursor atomic, restart pending source, repeated ID deduplication',async()=>{
 const store=new CollectorStore('test-'+crypto.randomUUID());let task=createTask(config);await store.saveTask(task);
 const first=await stepTask(store,task.id,async()=>({items:[row],next:{offset:2},done:false}),10000);
 assert.equal(first.phase,'source');assert.equal((await store.records(task.id)).length,1);
 // A new engine invocation resumes source queue from the persisted page, not the next list page.
 const second=await stepTask(store,task.id,async op=>{assert.equal(op.action,'source');return {source_state:'available',source_code:'int main(){}'};},14000);
 assert.equal(second.sourceIndex,1);
 await stepTask(store,task.id,async()=>({items:[{...row,verdict:'WRONG_ANSWER'}, {...row,submission_id:'2'}],next:{offset:3},done:false}),18000);
 assert.equal((await store.records(task.id)).length,2);
 assert.equal((await store.records(task.id))[0].source_code,'int main(){}');
});
test('worker lease prevents duplicate execution, request failure never advances cursor',async()=>{
 const store=new CollectorStore('test-'+crypto.randomUUID());let task=createTask(config);await store.saveTask(task);
 assert.ok(await store.acquire(task.id,10000));assert.equal(await store.acquire(task.id,10001),null);
 await store.release(task.id);
 await stepTask(store,task.id,async()=>({error:'challenge'}),20000);
 const saved=await store.task(task.id);assert.equal(saved.status,'blocked');assert.deepEqual(saved.cursor,{offset:1});assert.equal((await store.records(task.id)).length,0);
});
test('blocked source preserves its position and safe diagnostic, resume does not repeat the list',async()=>{
 const store=new CollectorStore('test-'+crypto.randomUUID());const task=createTask(config);await store.saveTask(task);
 await stepTask(store,task.id,async()=>({items:[row],next:{offset:2},done:false}),10000);
 const diagnostic={action:'source',path:'/contest/1/submission/1',status:403};
 const blocked=await stepTask(store,task.id,async()=>({error:'access_denied',diagnostic:{...diagnostic,body:'must not persist'}}),14000);
 assert.equal(blocked.status,'blocked');assert.equal(blocked.sourceIndex,0);
 assert.deepEqual(blocked.diagnostic,diagnostic);
 assert.equal(blocked.requests,2);
 let calls=0;await stepTask(store,task.id,async()=>{calls++;},18000);assert.equal(calls,0);
 await store.changeStatus(task.id,'running');
 const resumed=await stepTask(store,task.id,async op=>{
   assert.equal(op.action,'source');assert.equal(op.item.submission_id,'1');
   return {source_state:'available',source_code:'int main(){}'};
 },22000);
 assert.equal(resumed.diagnostic,null);assert.equal(resumed.sourceIndex,1);
});
test('empty successful page completes visible scope, malformed response never does',async()=>{
 const store=new CollectorStore('test-'+crypto.randomUUID());let task=createTask({...config,includeSource:false});await store.saveTask(task);
 await stepTask(store,task.id,async()=>({items:[],next:{offset:1},done:true}),10000);
 assert.equal((await store.task(task.id)).status,'complete');
 let bad=createTask(config);await store.saveTask(bad);await stepTask(store,bad.id,async()=>({}),10000);
 assert.equal((await store.task(bad.id)).status,'blocked');
});
test('AtCoder new tasks always use the submission replica even with legacy mode parameters',()=>{
 for(const options of [{},{atcoderMode:'archive',contests:['asprocon9']}]){
  const task=createTask({...config,platform:'atcoder',...options});
  assert.equal(task.phase,'replica_count');assert.equal(task.coverageScope,'replica_submissions');
  assert.equal(task.atcoderMode,'replica');assert.equal(task.cursor.fromSecond,0);
  assert.equal(task.contests?.length||0,0);
 }
});
test('legacy AtCoder scans stop before any request without losing records or checkpoints',async()=>{
 for(const phase of ['contests','list','source']){
  const store=new CollectorStore('legacy-'+crypto.randomUUID());
  const task={...createTask({...config,platform:'atcoder'}),coverageScope:'archive_contests',phase,cursor:{contest:'asprocon9',page:1},pages:411,requests:527};
  await store.saveTask(task);await store.commit(task,[row]);let calls=0;
  const saved=await stepTask(store,task.id,async()=>{calls++;return {error:'http_404'};},10000);
  assert.equal(calls,0);assert.equal(saved.status,'blocked');assert.equal(saved.error,'atcoder_fast_required');
  assert.equal(saved.pages,411);assert.equal(saved.requests,527);assert.deepEqual(saved.cursor,task.cursor);
  assert.equal(await store.recordCount(task.id),1);
 }
});
