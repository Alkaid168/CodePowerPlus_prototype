import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {parseHTML} from 'linkedom';
import {pageAgent} from '../src/page-agent.js';
import {CollectorStore} from '../src/store.js';
import {createTask,stepTask} from '../src/engine.js';

test('Luogu resumes a blocked page containing Waiting, saves its source and continues without losing earlier records',async()=>{
 const {document,DOMParser}=parseHTML('<script id="lentille-context" type="application/json">{"user":{"uid":7}}</script>');
 Object.assign(globalThis,{document,DOMParser,location:new URL('https://www.luogu.com.cn/'),indexedDB,IDBKeyRange});
 const store=new CollectorStore('luogu-resume-'+crypto.randomUUID());
 const task={...createTask({platform:'luogu',account:'7',tabId:1,includeSource:true}),status:'blocked',error:'schema_changed',cursor:{page:33},pages:32,requests:676};
 await store.saveTask({...task,status:'running'});
 const earlier={submission_id:'1',problem_key:'P1001',submitted_at:'2026-01-01T00:00:00.000Z',language:'27',verdict:'12',score:100,time_ms:1,memory_bytes:1024,source_state:'available',source_code:'// earlier source',source_hash:null};
 await store.commit({...task,status:'running'},[earlier]);
 await store.saveTask(task);
 const paths=[];
 globalThis.fetch=async path=>{
  paths.push(path);
  const url=new URL(path,location.origin);let data;
  if(url.pathname==='/record/list'){
   assert.equal(url.searchParams.get('user'),'7');
   const page=Number(url.searchParams.get('page'));assert.ok([33,34].includes(page));
   const records=page===33?Array.from({length:20},(_,i)=>({id:3300+i,status:i===0?0:12,user:{uid:7},problem:{pid:'P3808'},submitTime:1700000000+i,language:27})): [{id:3400,status:12,user:{uid:7},problem:{pid:'P1001'},submitTime:1699999999,language:27}];
   data={records:{count:661,perPage:20,result:records}};
  }else{
   assert.match(url.pathname,/^\/record\/(33\d\d|3400)$/);
   data={record:{user:{uid:7},sourceCode:'int main(){return 0;}'}};
  }
  return {ok:true,status:200,url:url.href,text:async()=>'<script id="lentille-context" type="application/json">'+JSON.stringify({data})+'</script>'};
 };
 await store.changeStatus(task.id,'running');
 const first=await stepTask(store,task.id,pageAgent,10000);
 assert.equal(first.error,'');assert.equal(first.phase,'source');assert.equal(first.pages,33);
 let records=await store.records(task.id);
 assert.equal(records.length,21);assert.equal(records.find(r=>r.submission_id==='3300').verdict,'0');
 let now=14000;
 for(let i=0;i<20;i++,now+=4000){const saved=await stepTask(store,task.id,pageAgent,now);assert.equal(saved.status,'running');}
 const next=await stepTask(store,task.id,pageAgent,now);now+=4000;
 assert.equal(next.pages,34);assert.equal(next.phase,'source');
 await stepTask(store,task.id,pageAgent,now);now+=4000;
 const completed=await stepTask(store,task.id,pageAgent,now);
 assert.equal(completed.status,'complete');
 records=await store.records(task.id);assert.equal(records.length,22);
 assert.equal(records.find(r=>r.submission_id==='1').source_code,'// earlier source');
 assert.equal(records.find(r=>r.submission_id==='3300').source_code,'int main(){return 0;}');
 assert.deepEqual(paths.filter(p=>p.startsWith('/record/list')),['/record/list?user=7&page=33','/record/list?user=7&page=34']);
 assert.equal(completed.requests,699);
});
