import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {CollectorStore} from '../src/store.js';
import {createTask} from '../src/engine.js';
globalThis.indexedDB=indexedDB;globalThis.IDBKeyRange=IDBKeyRange;

// Only the browser boundary is mocked; handlers, engine and IndexedDB writes are real.
let onMessage;
globalThis.chrome={
  permissions:{contains:async()=>true},
  tabs:{get:async tabId=>({url:tabId>=3?'https://atcoder.jp/':'https://codeforces.com/'})},
  scripting:{executeScript:async({args})=>args[0].action==='identify'
    ?[{result:{account:'alice'}}]:new Promise(()=>{})},
  action:{onClicked:{addListener(){}}},
  runtime:{id:'activation-test',getURL:p=>'chrome-extension://activation-test/'+p,
    onInstalled:{addListener(){}},onStartup:{addListener(){}},
    onMessage:{addListener(listener){onMessage=listener;}}},
  alarms:{create(){},onAlarm:{addListener(){}}}
};
let source=await fs.readFile(new URL('../src/worker.js',import.meta.url),'utf8');
source=source.replace(/from '(\.\/[^']+)'/g,(_,relative)=>
  'from '+JSON.stringify(new URL('../src/'+relative,import.meta.url).href));
await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const store=new CollectorStore();
const send=message=>new Promise(resolve=>onMessage(message,{
  id:chrome.runtime.id,url:chrome.runtime.getURL('collector.html')
},resolve));
async function clearTasks(){for(const task of await store.tasks())await store.deleteTask(task.id);}

test('resync rejects a second running task on the same platform and preserves its old checkpoint',async()=>{
  await clearTasks();
  const running=createTask({platform:'codeforces',account:'alice',tabId:1});
  const completed={...createTask({platform:'codeforces',account:'alice',tabId:1}),status:'complete',pages:7};
  await store.saveTask(running);await store.saveTask(completed);
  const reply=await send({type:'resync',id:completed.id});
  assert.deepEqual(reply,{error:'platform_busy'});
  assert.equal((await store.task(completed.id)).status,'complete');
  assert.equal((await store.task(completed.id)).pages,7);
  assert.equal((await store.tasks()).filter(t=>t.status==='running').length,1);
});

test('concurrent start messages from two pages activate only one same-platform task',async()=>{
  await clearTasks();
  const replies=await Promise.all([1,2].map(tabId=>send({
    type:'start',platform:'codeforces',account:'alice',tabId
  })));
  assert.equal(replies.filter(reply=>reply.id).length,1);
  assert.equal(replies.filter(reply=>reply.error==='platform_busy').length,1);
  assert.equal((await store.tasks()).filter(t=>t.status==='running').length,1);
});

test('concurrent resume and resync cannot activate separate tasks for the same platform',async()=>{
  await clearTasks();
  const paused={...createTask({platform:'codeforces',account:'alice',tabId:1}),status:'paused'};
  const completed={...createTask({platform:'codeforces',account:'alice',tabId:1}),status:'complete'};
  await store.saveTask(paused);await store.saveTask(completed);
  const replies=await Promise.all([
    send({type:'status',id:paused.id,status:'running'}),
    send({type:'resync',id:completed.id})
  ]);
  assert.equal(replies.filter(reply=>reply.ok).length,1);
  assert.equal(replies.filter(reply=>reply.error==='platform_busy').length,1);
  assert.equal((await store.tasks()).filter(t=>t.status==='running').length,1);
});

test('concurrent legacy AtCoder switches activate only one task and keep the other checkpoint',async()=>{
  await clearTasks();
  const tasks=[3,4].map(tabId=>({...createTask({platform:'atcoder',account:'alice',tabId}),
    status:'paused',coverageScope:'archive_contests',pages:9}));
  for(const task of tasks)await store.saveTask(task);
  const replies=await Promise.all(tasks.map(task=>send({type:'accelerate',id:task.id})));
  assert.equal(replies.filter(reply=>reply.ok).length,1);
  assert.equal(replies.filter(reply=>reply.error==='platform_busy').length,1);
  const saved=await store.tasks();
  assert.equal(saved.filter(t=>t.status==='running').length,1);
  assert.equal(saved.find(t=>t.status==='paused').pages,9);
});

test('exclusive activation still allows different platforms to run in the queue',async()=>{
  await clearTasks();
  const replies=await Promise.all([
    send({type:'start',platform:'codeforces',account:'alice',tabId:1}),
    send({type:'start',platform:'atcoder',account:'alice',tabId:3})
  ]);
  assert.equal(replies.filter(reply=>reply.id).length,2);
  assert.equal((await store.tasks()).filter(t=>t.status==='running').length,2);
});
