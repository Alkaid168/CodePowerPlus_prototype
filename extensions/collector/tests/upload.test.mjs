import test from 'node:test';
import assert from 'node:assert/strict';
import * as uploads from '../src/upload.js';
const {createUploadJob,uploadPlannedBatches}=uploads;

function task(){return {id:'task-1',updatedAt:'2026-10-21T00:00:00.000Z',platform:'codeforces',account:'alice',status:'paused',pages:4,coverageScope:'visible_account_history'};}
function rows(count,sourceSize=0){return Array.from({length:count},(_,i)=>({submission_id:String(i+1),problem_key:'100/A',submitted_at:'2026-10-21T00:00:00Z',language:'C++',verdict:'OK',score:null,time_ms:1,memory_bytes:2,source_state:sourceSize?'available':'not_requested',source_code:sourceSize?'x'.repeat(sourceSize):null,source_hash:sourceSize?'a'.repeat(64):null}));}

test('upload plan groups records and caps the encoded request body',()=>{
  const job=createUploadJob(task(),rows(51),'https://school.example',{maxRecords:25,maxBytes:1_500_000});
  assert.deepEqual(job.batches.map(batch=>batch.end-batch.start),[25,25,1]);
  assert.equal(job.nextBatch,0);
  assert.equal(job.totalRecords,51);
  assert.ok(job.batches.every(batch=>batch.batchId));
});

test('large sources split batches by UTF-8 byte budget and reject an oversized single row',()=>{
  const job=createUploadJob(task(),rows(4,300),'https://school.example',{maxRecords:25,maxBytes:1000,maxSingleBytes:1000});
  assert.ok(job.batches.length>1);
  for(const batch of job.batches){
    const body=JSON.stringify({schema_version:1,adapter_version:'0.1.0',batch_id:batch.batchId,platform:'codeforces',account_id:'alice',
      coverage:{status:'partial',pages:4,note:'visible_account_history'},submissions:rows(4,300).slice(batch.start,batch.end)});
    assert.ok(new TextEncoder().encode(body).length<=1000);
  }
  assert.throws(()=>createUploadJob(task(),rows(1,1200),'https://school.example',{maxRecords:25,maxBytes:1000,maxSingleBytes:1000}),/single submission exceeds/);
});

test('one valid large source may exceed the target batch size without exceeding server limit',()=>{
  const job=createUploadJob(task(),rows(1,2000),'https://school.example',{maxRecords:25,maxBytes:1000});
  assert.equal(job.batches.length,1);
  assert.equal(job.batches[0].end-job.batches[0].start,1);
});

test('upload resumes after the last acknowledged batch with stable idempotency keys',async()=>{
  const job=createUploadJob(task(),rows(5),'https://school.example',{maxRecords:2,maxBytes:1_500_000});
  const records=rows(5);const calls=[];const saved=[];let failSecond=true;
  globalThis.fetch=async(_url,options)=>{
    const batch=JSON.parse(options.body);calls.push(batch.batch_id);
    if(batch.submissions[0].submission_id==='3'&&failSecond){failSecond=false;return {ok:false,status:503};}
    return {ok:true,json:async()=>({inserted:batch.submissions.length,updated:0})};
  };
  await assert.rejects(()=>uploadPlannedBatches('https://school.example', 'token',job,records,async state=>saved.push(structuredClone(state))),/HTTP 503/);
  assert.equal(job.nextBatch,1);
  assert.equal(saved.at(-1).nextBatch,1);
  await uploadPlannedBatches('https://school.example','token',job,records,async state=>saved.push(structuredClone(state)));
  assert.deepEqual(calls,[job.batches[0].batchId,job.batches[1].batchId,job.batches[1].batchId,job.batches[2].batchId]);
  assert.equal(job.nextBatch,3);
});

test('paged upload plans never persist sources and fetch only the current batch',async()=>{
  const records=rows(53,2000);let pages=0;
  async function* chunks(){for(let i=0;i<records.length;i+=25){pages++;yield records.slice(i,i+25);}}
  const job=await uploads.createPagedUploadJob(task(),chunks(),'https://school.example');
  assert.equal(pages,3);assert.equal(job.totalRecords,53);
  assert.deepEqual(job.batches.map(b=>b.end-b.start),[25,25,3]);
  assert.equal(JSON.stringify(job).includes('source_code'),false);
  const reads=[];globalThis.fetch=async(_url,{body})=>({ok:true,json:async()=>({inserted:JSON.parse(body).submissions.length,updated:0})});
  const provider={length:53,read:async batch=>{reads.push(batch.end-batch.start);return records.slice(batch.start,batch.end);}};
  await uploadPlannedBatches('https://school.example','token',job,provider,async()=>{});
  assert.deepEqual(reads,[25,25,3]);
});

test('changed batch data is rejected before HTTP and upload errors preserve checkpoint',async()=>{
  const records=rows(1);
  async function* chunks(){yield records;}
  const job=await uploads.createPagedUploadJob(task(),chunks(),'https://school.example');
  let calls=0;globalThis.fetch=async()=>{calls++;return {ok:false,status:413,json:async()=>({detail:{code:'storage_quota_exceeded',used_bytes:120,limit_bytes:150}})};};
  const provider={length:1,read:async()=>[{...records[0],verdict:'CHANGED'}]};
  await assert.rejects(()=>uploadPlannedBatches('https://school.example','token',job,provider,async()=>{}),/upload_checkpoint_mismatch/);
  assert.equal(calls,0);
  provider.read=async()=>records;
  await assert.rejects(()=>uploadPlannedBatches('https://school.example','token',job,provider,async()=>{}),/空间不足/);
  assert.equal(job.nextBatch,0);
  globalThis.fetch=async()=>({ok:false,status:401});
  await assert.rejects(()=>uploadPlannedBatches('https://school.example','token',job,provider,async()=>{}),/令牌已过期/);
});

test('only a matching import receipt or explicit replay may advance the checkpoint',async()=>{
  const records=rows(1),job=createUploadJob(task(),records,'https://school.example');
  globalThis.fetch=async()=>({ok:true,json:async()=>({inserted:0,updated:0})});
  await assert.rejects(()=>uploadPlannedBatches(job.origin,'token',job,records,async()=>{}),/返回格式不匹配/);
  assert.equal(job.nextBatch,0);
  globalThis.fetch=async()=>({ok:true,json:async()=>({inserted:0,updated:0,replayed:true})});
  await uploadPlannedBatches(job.origin,'token',job,records,async()=>{});
  assert.equal(job.nextBatch,1);
});
