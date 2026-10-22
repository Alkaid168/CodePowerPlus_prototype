export const ADAPTER_VERSION='0.1.0';
export const SITES={codeforces:'https://codeforces.com',luogu:'https://www.luogu.com.cn',atcoder:'https://atcoder.jp',vjudge:'https://vjudge.net'};
export function legacyAtCoder(task){
  return task?.platform==='atcoder'&&task.coverageScope!=='replica_submissions';
}
export function createTask({platform,account,tabId,includeSource=false}){
  if(!SITES[platform] || !/^[A-Za-z0-9_.-]{1,100}$/.test(account)||!Number.isSafeInteger(tabId))throw Error('invalid_task');
  const replica=platform==='atcoder';
  return {id:crypto.randomUUID(),platform,account,tabId,includeSource,atcoderMode:replica?'replica':undefined,status:'running',phase:replica?'replica_count':'list',
    cursor:replica?{fromSecond:0,untilSecond:Math.floor(Date.now()/1000)+1}:platform==='luogu'?{page:1}:{offset:platform==='codeforces'?1:0},
    coverageScope:replica?'replica_submissions':'visible_account_history',
    pending:[],sourceIndex:0,pageDone:false,pageNext:null,pages:0,requests:0,retries:0,nextDue:0,
    createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),error:'',leaseUntil:0};
}
function advance(task){
  task.pending=[];task.sourceIndex=0;
  if(task.coverageScope==='replica_submissions'){
    task.phase=task.pageDone?'replica_verify':'replica_boundary';
    task.cursor=task.pageNext;return;
  }
  task.phase='list';
  if(task.pageDone)task.status='complete';
  else task.cursor=task.pageNext;
}
function validRows(rows){
  return Array.isArray(rows)&&rows.every(r=>/^[A-Za-z0-9_-]+$/.test(r.submission_id)&&typeof r.problem_key==='string'&&r.problem_key.length>0&&
    Number.isFinite(Date.parse(r.submitted_at))&&typeof r.verdict==='string'&&r.verdict.length>0);
}
export async function stepTask(store,id,invoke,now=Date.now()){
  const task=await store.acquire(id,now);if(!task)return store.task(id);
  let saving=false;
  const commit=async(rows=[])=>{saving=true;return store.commit(task,rows);};
  try{
    if(legacyAtCoder(task))throw Error('atcoder_fast_required');
    if(task.phase==='source' && task.sourceIndex>=task.pending.length)advance(task);
    if(task.status==='complete')return commit();
    const operation={platform:task.platform,account:task.account,action:task.phase.startsWith('replica_')?task.phase:task.phase==='source'?'source':'list',cursor:task.cursor};
    if(task.phase==='source')operation.item=task.pending[task.sourceIndex];
    const result=await invoke(operation,task.tabId);task.requests++;task.diagnostic=null;
    if(result?.error&&result.diagnostic){
      const d=result.diagnostic;
      if(['source','list','contests','replica_count','replica_list','replica_boundary','replica_verify'].includes(d.action)&&typeof d.path==='string'&&
        /^\/[A-Za-z0-9_./-]{0,240}$/.test(d.path)&&Number.isInteger(d.status)&&d.status>=100&&d.status<=599){
        task.diagnostic={action:d.action,path:d.path,status:d.status};
        if(d.provider==='atcoder_problems')task.diagnostic.provider='atcoder_problems';
      }
    }
    if(task.phase==='source'&&['source_unavailable','unsupported_problem'].includes(result?.error)){
      const row={...task.pending[task.sourceIndex],source_state:'unavailable',source_code:null,source_hash:null};task.sourceIndex++;task.nextDue=now+3500;task.error='';
      return await commit([row]);
    }
    if(result?.error)throw Error(result.error);
    let rows=[];
    if(['replica_count','replica_verify','replica_boundary'].includes(task.phase)){
      if(!Number.isSafeInteger(result.count)||result.count<0)throw Error('schema_changed');
      if(task.phase==='replica_count'){task.replicaExpected=result.count;task.replicaCollected=0;task.phase='replica_list';}
      else if(task.phase==='replica_verify'){
        if(result.count!==task.replicaExpected||result.count!==task.replicaCollected)throw Error('replica_count_mismatch');
        task.replicaVerified=true;task.status='complete';
      }else{
        if(result.count!==task.cursor.boundaryCount)throw Error('replica_boundary_gap');
        const next=task.cursor.fromSecond+1,until=task.cursor.untilSecond;
        task.cursor={fromSecond:next>=until?0:next,untilSecond:until};
        task.phase=next>=until?'replica_verify':'replica_list';
      }
    }else if(task.phase==='list'||task.phase==='replica_list'){
      if(!validRows(result?.items)||typeof result.done!=='boolean'||!result.next)throw Error('schema_changed');
      if(!result.done&&JSON.stringify(result.next)===JSON.stringify(task.cursor))throw Error('cursor_stalled');
      const signature=result.items.map(r=>r.submission_id).join(',');
      if(signature&&task.lastPageSignature===signature)throw Error('page_repeated');
      task.lastPageSignature=signature;
      rows=result.items;task.pages++;task.pageDone=result.done;task.pageNext=result.next;
      task.pending=rows;task.sourceIndex=0;
      if(task.coverageScope==='replica_submissions')task.replicaCollected+=rows.length;
      if(task.includeSource&&rows.length)task.phase='source';else advance(task);
    }else{
      if(!['available','unavailable','private','image_only'].includes(result?.source_state))throw Error('schema_changed');
      if(result.source_state==='available'&&typeof result.source_code!=='string')throw Error('schema_changed');
      const row={...task.pending[task.sourceIndex],source_state:result.source_state,source_code:result.source_code??null,source_hash:null};
      if(row.source_code!==null){if(row.source_code.length>500000)throw Error('source_too_large');const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.source_code));row.source_hash=[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');}
      rows=[row];task.sourceIndex++;
    }
    task.retries=0;task.error='';task.nextDue=now+3500;
    return await commit(rows);
  }catch(error){
    if(saving)throw error;
    task.error=/^[a-z0-9_]+$/.test(error.message)?error.message:'collection_failed';
    if(['network_error','network_timeout','rate_limited','http_500','http_502','http_503','http_504'].includes(task.error)&&task.retries<4){
      task.retries++;task.nextDue=now+Math.min(300000,5000*2**task.retries);
    }else task.status='blocked';
    // No page cursor or source index changes on failed requests.
    return store.commit(task);
  }
}
export function exportBatches(task,records,batchSize=20){
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>100)throw Error('invalid_batch_size');
  const batches=[];for(let i=0;i<records.length;i+=batchSize)batches.push({schema_version:1,adapter_version:ADAPTER_VERSION,batch_id:crypto.randomUUID(),
    platform:task.platform,account_id:task.account,coverage:{status:coverageStatus(task),pages:task.pages,note:coverageNote(task)},
    submissions:records.slice(i,i+batchSize)});return batches;
}
export function coverageStatus(task){
  return task.status==='blocked'?'blocked':task.status==='cancelled'?'cancelled':
    task.status==='complete'&&task.coverageScope!=='replica_submissions'?'complete_visible':'partial';
}
export function coverageNote(task){
  return task.coverageScope+(task.coverageScope==='replica_submissions'?'; metadata: AtCoder Problems unofficial replica (may lag/omit); source code: AtCoder official; local records may also include earlier official scans':'')+
    '; account ownership supplied by local browser, not independently verified';
}
