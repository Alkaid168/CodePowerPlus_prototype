import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {CollectorStore} from '../src/store.js';
import {createTask} from '../src/engine.js';
globalThis.indexedDB=indexedDB;globalThis.IDBKeyRange=IDBKeyRange;

test('delete removes only target task records and upload job; late commit cannot resurrect it',async()=>{
 const store=new CollectorStore('delete-'+crypto.randomUUID());
 const a=createTask({platform:'vjudge',account:'alice',tabId:1});
 const b=createTask({platform:'vjudge',account:'alice',tabId:1});
 for(const task of [a,b]){
   await store.saveTask(task);const lease=await store.acquire(task.id,10000);
   await store.commit(lease,[{submission_id:'1',source_code:'synthetic source'}]);
   await store.saveUploadJob({taskId:task.id,nextBatch:1});
 }
 const late=await store.acquire(a.id,20000);
 await store.deleteTask(a.id);
 assert.equal(await store.task(a.id),undefined);
 assert.equal(await store.recordCount(a.id),0);
 assert.equal(await store.uploadJob(a.id),undefined);
 await store.commit(late,[{submission_id:'2',source_code:'late'}]);
 assert.equal(await store.task(a.id),undefined);assert.equal(await store.recordCount(a.id),0);
 await assert.rejects(()=>store.saveUploadJob({taskId:a.id,nextBatch:2}),/missing_task/);
 assert.equal(await store.uploadJob(a.id),undefined);
 assert.ok(await store.task(b.id));assert.equal(await store.recordCount(b.id),1);
 assert.equal((await store.uploadJob(b.id)).nextBatch,1);
 await store.deleteTask(a.id); // Idempotent.
});

test('an in-flight resync cannot recreate a deleted or changed task',async()=>{
 const store=new CollectorStore('delete-race-'+crypto.randomUUID());
 const task=createTask({platform:'atcoder',account:'alice',tabId:1,contests:['abc480']});
 task.status='paused';await store.saveTask(task);
 const reset={...task,status:'running'};
 await store.deleteTask(task.id);
 assert.equal(await store.resetTask(reset,task),false);
 assert.equal(await store.task(task.id),undefined);
 await store.saveTask(task);await store.changeStatus(task.id,'running');
 assert.equal(await store.resetTask(reset,task),false);
});
