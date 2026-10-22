/** Public metadata only. OJ sessions and API secrets never go to this origin. */
export const REPLICA_ORIGIN='https://kenkoooo.com';
const ROOT=REPLICA_ORIGIN+'/atcoder/atcoder-api/v3/user/';
export async function fetchReplica(input,fetcher=fetch){
  let diagnostic=null;
  try{
    const {account,action,cursor}=input,from=cursor?.fromSecond,until=cursor?.untilSecond;
    if(!/^[A-Za-z0-9_.-]{1,100}$/.test(account)||!['replica_count','replica_list','replica_boundary','replica_verify'].includes(action)||
      !Number.isSafeInteger(from)||from<0||!Number.isSafeInteger(until)||until<=from)throw Error('invalid_operation');
    const count=action!=='replica_list';
    const begin=action==='replica_verify'?0:from,end=action==='replica_boundary'?from+1:until;
    const url=ROOT+(count?'submission_count':'submissions')+'?user='+encodeURIComponent(account)+'&from_second='+begin+(count?'&to_second='+end:'');
    const response=await fetcher(url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(25000)});
    diagnostic={action,path:new URL(url).pathname,status:response.status,provider:'atcoder_problems'};
    if(!response.ok)throw Error(response.status===429?'rate_limited':response.status===403?'access_denied':'http_'+response.status);
    let data;try{data=await response.json();}catch{throw Error('schema_changed');}
    if(count){
      if(!Number.isSafeInteger(data?.count)||data.count<0)throw Error('schema_changed');
      return {count:data.count};
    }
    if(!Array.isArray(data)||data.length>500)throw Error('schema_changed');
    let previous=from;const ids=new Set();
    const items=[];
    for(const row of data){
      if(typeof row.user_id!=='string'||row.user_id.toLowerCase()!==account.toLowerCase())throw Error('owner_mismatch');
      if(!Number.isSafeInteger(row.id)||row.id<1||ids.has(row.id)||!Number.isSafeInteger(row.epoch_second)||row.epoch_second<previous||
        !/^[A-Za-z0-9_-]+$/.test(row.contest_id)||!/^[A-Za-z0-9_-]+$/.test(row.problem_id)||
        typeof row.language!=='string'||typeof row.result!=='string'||!row.result)throw Error('schema_changed');
      ids.add(row.id);previous=row.epoch_second;
      if(row.epoch_second>=until)continue;
      const date=new Date(row.epoch_second*1000);if(!Number.isFinite(date.getTime()))throw Error('schema_changed');
      items.push({submission_id:String(row.id),problem_key:row.contest_id+'/'+row.problem_id,
        submitted_at:date.toISOString(),language:row.language,verdict:row.result,
        score:typeof row.point==='number'&&Number.isFinite(row.point)?row.point:null,
        time_ms:Number.isSafeInteger(row.execution_time)&&row.execution_time>=0?row.execution_time:null,memory_bytes:null,
        source_state:'not_requested',source_code:null,source_hash:null});
    }
    const last=items.length?data.filter(r=>r.epoch_second<until).at(-1).epoch_second:from;
    return {items,done:data.length<500||previous>=until,
      next:{fromSecond:last,untilSecond:until,boundaryCount:data.filter(r=>r.epoch_second===last).length}};
  }catch(error){
    return {error:['TimeoutError','AbortError'].includes(error.name)?'network_timeout':
      /^[a-z0-9_]+$/.test(error.message)?error.message:'network_error',diagnostic};
  }
}
