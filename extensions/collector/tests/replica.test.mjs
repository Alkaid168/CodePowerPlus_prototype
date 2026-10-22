import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {CollectorStore} from '../src/store.js';
import {createTask,stepTask,exportBatches} from '../src/engine.js';
globalThis.indexedDB=indexedDB;globalThis.IDBKeyRange=IDBKeyRange;
const config={platform:'atcoder',account:'alice',tabId:1,includeSource:true,atcoderMode:'replica'};
const raw=(id,epoch=100)=>({id,user_id:'alice',contest_id:'practice2',problem_id:'practice2_a',epoch_second:epoch,language:'C++',result:'AC',point:100,execution_time:5});

test('replica adapter batches practice submissions and omits credentials; count freezes window',async()=>{
 const {fetchReplica}=await import('../src/replica.js');const calls=[];
 const fake=async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>[raw(1),raw(2,101)]};};
 const out=await fetchReplica({action:'replica_list',account:'alice',cursor:{fromSecond:0,untilSecond:200}},fake);
 assert.equal(out.items.length,2);assert.equal(out.items[0].problem_key,'practice2/practice2_a');
 assert.equal(out.items[0].submitted_at,'1970-01-01T00:01:40.000Z');
 assert.equal(out.items[0].memory_bytes,null);assert.equal(out.items[0].source_state,'not_requested');
 assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.redirect,'error');
 assert.equal(new URL(calls[0].url).origin,'https://kenkoooo.com');
 assert.equal(out.done,true);
 let url;
 const count=await fetchReplica({action:'replica_count',account:'alice',cursor:{fromSecond:0,untilSecond:200}},async(u)=>{url=u;return {ok:true,status:200,json:async()=>({count:2})};});
 assert.equal(count.count,2);assert.equal(new URL(url).searchParams.get('to_second'),'200');
 const cutoff=await fetchReplica({action:'replica_list',account:'alice',cursor:{fromSecond:0,untilSecond:200}},async()=>({ok:true,status:200,json:async()=>[raw(1,100),raw(2,200)]}));
 assert.equal(cutoff.items.length,1);assert.equal(cutoff.done,true);
});

test('replica rejects unknown author, unordered data and HTTP failures',async()=>{
 const {fetchReplica}=await import('../src/replica.js'),input={action:'replica_list',account:'alice',cursor:{fromSecond:0,untilSecond:200}};
 const reply=data=>async()=>({ok:true,status:200,json:async()=>data});
 assert.equal((await fetchReplica(input,reply([{...raw(1),user_id:'bob'}]))).error,'owner_mismatch');
 assert.equal((await fetchReplica(input,reply([raw(1,102),raw(2,101)]))).error,'schema_changed');
 const denied=await fetchReplica(input,async()=>({ok:false,status:403}));
 assert.equal(denied.error,'access_denied');assert.equal(denied.diagnostic.provider,'atcoder_problems');
 assert.equal((await fetchReplica({...input,account:'a&secret=bad'},reply([]))).error,'invalid_operation');
 assert.equal((await fetchReplica(input,async()=>({ok:true,status:200,json:async()=>{throw new SyntaxError('not JSON');}}))).error,'schema_changed');
});

test('fast engine persists metadata before fetching source, then verifies replica count; exports provenance as partial',async()=>{
 const {fetchReplica}=await import('../src/replica.js');
 const store=new CollectorStore('fast-'+crypto.randomUUID()),task=createTask(config);await store.saveTask(task);
 assert.equal(task.phase,'replica_count');assert.equal(task.coverageScope,'replica_submissions');
 const invoke=async op=>{
   if(op.action==='source'){assert.equal(op.item.problem_key,'practice2/practice2_a');return {source_state:'available',source_code:'int main(){}'};}
   return fetchReplica(op,async()=>({ok:true,status:200,json:async()=>op.action==='replica_list'?[raw(1)]:{count:1}}));
 };
 await stepTask(store,task.id,invoke,10000);
 await stepTask(store,task.id,invoke,14000);
 assert.equal(await store.recordCount(task.id),1);assert.equal((await store.records(task.id))[0].source_state,'not_requested');
 await stepTask(store,task.id,invoke,18000);
 await stepTask(store,task.id,invoke,22000);
 const done=await store.task(task.id);assert.equal(done.status,'complete');
 const batch=exportBatches(done,await store.records(task.id))[0];
 assert.equal(batch.coverage.status,'partial');assert.match(batch.coverage.note,/AtCoder Problems/);
 assert.equal((await store.records(task.id))[0].source_code,'int main(){}');
 const {createUploadJob,uploadPlannedBatches}=await import('../src/upload.js');
 const records=await store.records(task.id),job=createUploadJob(done,records,'https://example.edu');
 const previousFetch=globalThis.fetch;
 try{
   globalThis.fetch=async(_url,{body})=>{
     const sent=JSON.parse(body);assert.equal(sent.coverage.status,'partial');assert.match(sent.coverage.note,/AtCoder Problems/);
     return {ok:true,json:async()=>({inserted:1,updated:0})};
   };
   await uploadPlannedBatches(job.origin,'synthetic-token',job,records,async()=>{});
 }finally{globalThis.fetch=previousFetch;}
});

test('a full page cannot advance past an uncollected timestamp; mismatch never completes',async()=>{
 const {fetchReplica}=await import('../src/replica.js');
 const store=new CollectorStore('boundary-'+crypto.randomUUID()),task=createTask({...config,includeSource:false});await store.saveTask(task);
 await stepTask(store,task.id,async()=>({count:501}),10000);
 const full=await fetchReplica({action:'replica_list',account:'alice',cursor:{fromSecond:0,untilSecond:200}},async()=>({ok:true,status:200,json:async()=>Array.from({length:500},(_,i)=>raw(i+1))}));
 await stepTask(store,task.id,async()=>full,14000);
 assert.equal((await store.task(task.id)).phase,'replica_boundary');
 await stepTask(store,task.id,async()=>({count:501}),18000);
 const blocked=await store.task(task.id);assert.equal(blocked.error,'replica_boundary_gap');
 assert.equal(blocked.status,'blocked');assert.equal(blocked.cursor.fromSecond,100);
 assert.equal(await store.recordCount(task.id),500);
 const other=createTask({...config,includeSource:false});await store.saveTask(other);
 await stepTask(store,other.id,async()=>({count:2}),10000);
 const short=await fetchReplica({action:'replica_list',account:'alice',cursor:{fromSecond:0,untilSecond:200}},async()=>({ok:true,status:200,json:async()=>[raw(1)]}));
 await stepTask(store,other.id,async()=>short,14000);
 await stepTask(store,other.id,async()=>({count:2}),18000);
 assert.equal((await store.task(other.id)).error,'replica_count_mismatch');
});

test('verified full-page timestamp advances safely; short next page and final count complete the replica only',async()=>{
 const {fetchReplica}=await import('../src/replica.js');
 const store=new CollectorStore('paging-'+crypto.randomUUID()),task=createTask({...config,includeSource:false});await store.saveTask(task);
 const actions=[];
 const invoke=async op=>{
   actions.push({action:op.action,from:op.cursor.fromSecond});
   return fetchReplica(op,async()=>({ok:true,status:200,json:async()=>{
     if(op.action==='replica_boundary')return {count:1};
     if(op.action!=='replica_list')return {count:501};
     return op.cursor.fromSecond===0?Array.from({length:500},(_,i)=>raw(i+1,100+i)):[raw(501,600)];
   }}));
 };
 for(let i=0;i<5;i++)await stepTask(store,task.id,invoke,10000+i*4000);
 assert.equal((await store.task(task.id)).status,'complete');
 assert.equal(await store.recordCount(task.id),501);
 assert.deepEqual(actions.map(x=>x.action),['replica_count','replica_list','replica_boundary','replica_list','replica_verify']);
 assert.equal(actions[3].from,600);
});

test('a full last-second page verifies without requesting an empty invalid time window',async()=>{
 const {fetchReplica}=await import('../src/replica.js');
 const store=new CollectorStore('cutoff-'+crypto.randomUUID()),task=createTask({...config,includeSource:false});
 task.cursor.untilSecond=200;await store.saveTask(task);
 const actions=[];
 const invoke=async op=>{
   actions.push(op.action);
   return fetchReplica(op,async()=>({ok:true,status:200,json:async()=>op.action==='replica_list'?Array.from({length:500},(_,i)=>raw(i+1,199)):{count:500}}));
 };
 for(let i=0;i<4;i++)await stepTask(store,task.id,invoke,10000+i*4000);
 assert.equal((await store.task(task.id)).status,'complete');
 assert.deepEqual(actions,['replica_count','replica_list','replica_boundary','replica_verify']);
});
