import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
globalThis.indexedDB=indexedDB;globalThis.IDBKeyRange=IDBKeyRange;
import {CollectorStore} from '../src/store.js';
import {collectionJsonChunks} from '../src/export.js';

test('recordBatches reads ordered records in bounded pages without mixing tasks',async()=>{
 const store=new CollectorStore('export-pages-'+crypto.randomUUID());
 const task={id:'task-a',platform:'codeforces',account:'alice',status:'complete',pages:3,coverageScope:'visible_account_history',updatedAt:'now'};
 await store.saveTask(task);
 const db=await store.db();const tx=db.transaction('records','readwrite');
 for(let i=0;i<53;i++)tx.objectStore('records').put({taskId:'task-a',submission_id:String(i).padStart(3,'0'),problem_key:'1/A',submitted_at:new Date(Date.UTC(2026,9,21,0,0,53-i)).toISOString(),language:'C++',verdict:'OK',source_state:'available',source_code:'x'.repeat(2000)});
 tx.objectStore('records').put({taskId:'task-b',submission_id:'001',problem_key:'9/Z'});
 await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
 const pages=[];for await(const page of store.recordBatches('task-a',20))pages.push(page);
 assert.deepEqual(pages.map(page=>page.length),[20,20,13]);
 assert.equal(pages.flat().length,53);
 assert.deepEqual(pages.flat().map(row=>row.submission_id),Array.from({length:53},(_,i)=>String(i).padStart(3,'0')));
 assert.equal(await store.recordCount('task-a'),53);
 assert.deepEqual((await store.recordRange('task-a',20,25)).map(row=>row.submission_id),['020','021','022','023','024']);
 assert.deepEqual(await store.recordRange('task-a',53,54),[]);
 await assert.rejects(()=>store.recordRange('task-a',0,101),/invalid_record_range/);
 assert.deepEqual((await store.recentRecords('task-a',3)).map(row=>row.submission_id),['002','001','000']);
});

test('collectionJsonChunks emits valid batches incrementally and preserves source code',async()=>{
 const task={id:'task-a',platform:'codeforces',account:'alice',status:'complete',pages:3,coverageScope:'visible_account_history'};
 const rows=Array.from({length:53},(_,i)=>({submission_id:String(i),problem_key:'1/A',submitted_at:'2026-10-21T00:00:00.000Z',
   language:'C++',verdict:'OK',source_state:'available',source_code:i===52?'int main(){}':null}));
 async function* pages(){for(let i=0;i<rows.length;i+=20)yield rows.slice(i,i+20);}
 let chunkCount=0;let text='';
 for await(const chunk of collectionJsonChunks(task,pages(),20)){chunkCount++;text+=chunk;}
 const output=JSON.parse(text);
 assert.equal(chunkCount,5);
 assert.deepEqual(output.batches.map(batch=>batch.submissions.length),[20,20,13]);
 assert.equal(output.batches[2].submissions[12].source_code,'int main(){}');
 assert.equal(output.batches[0].coverage.status,'complete_visible');
});
