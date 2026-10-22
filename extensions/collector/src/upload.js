import {coverageStatus,coverageNote} from './engine.js';
export function serverOrigin(value){
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('请输入服务器根地址，例如 https://example.edu');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('服务器需使用HTTPS，本机地址除外');
  return url.origin;
}
const encoder=new TextEncoder();
const batchPayload=(task,records,batchId)=>({
  schema_version:1,adapter_version:'0.1.0',batch_id:batchId,platform:task.platform,account_id:task.account,
  coverage:{status:coverageStatus(task),pages:task.pages,note:coverageNote(task)},
  submissions:records
});
export function createUploadJob(task,records,origin,{maxRecords=25,maxBytes=1_500_000,maxSingleBytes=8_000_000}={}){
  origin=serverOrigin(origin);
  if(!Array.isArray(records)||records.length===0||!Number.isInteger(maxRecords)||maxRecords<1||maxRecords>100||
    !Number.isInteger(maxBytes)||maxBytes<1||maxBytes>8_000_000||!Number.isInteger(maxSingleBytes)||maxSingleBytes<maxBytes||maxSingleBytes>8_000_000)throw Error('invalid_upload_plan');
  const batches=[];let start=0;
  while(start<records.length){
    let end=start;
    while(end<records.length&&end-start<maxRecords){
      const proposed=records.slice(start,end+1);
      const body=JSON.stringify(batchPayload(task,proposed,'00000000-0000-4000-8000-000000000000'));
      if(encoder.encode(body).length>maxBytes){
        if(end===start){
          if(encoder.encode(body).length>maxSingleBytes)throw Error('single submission exceeds upload batch byte limit');
          end++;
        }
        break;
      }
      end++;
    }
    batches.push({batchId:crypto.randomUUID(),start,end});
    start=end;
  }
  return {taskId:task.id,taskUpdatedAt:task.updatedAt,task:{platform:task.platform,account:task.account,status:task.status,pages:task.pages,coverageScope:task.coverageScope},
    origin,totalRecords:records.length,nextBatch:0,batches};
}
async function recordDigest(records){
  const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(records)));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function createPagedUploadJob(task,pages,origin){
  origin=serverOrigin(origin);let job=null,total=0;
  for await(const records of pages){
    if(!Array.isArray(records)||records.length>100)throw Error('invalid_upload_page');
    if(!records.length)continue;
    const page=createUploadJob(task,records,origin);
    if(!job)job={...page,totalRecords:0,batches:[]};
    for(const batch of page.batches){
      const digest=await recordDigest(records.slice(batch.start,batch.end));
      job.batches.push({...batch,start:batch.start+total,end:batch.end+total,digest});
    }
    total+=records.length;
  }
  if(!job)throw Error('没有可上传的记录');
  job.totalRecords=total;return job;
}
export async function uploadPlannedBatches(origin,token,job,records,saveJob,onProgress=()=>{}){
  origin=serverOrigin(origin);
  if(!token||!job?.batches?.length||job.nextBatch<0||job.nextBatch>job.batches.length)throw Error('缺少本站导入令牌或没有待上传批次');
  if(origin!==job.origin||records.length!==job.totalRecords)throw Error('上传任务与当前服务器或本地记录不匹配');
  for(let index=job.nextBatch;index<job.batches.length;index++){
    const batch=job.batches[index],submissions=Array.isArray(records)?records.slice(batch.start,batch.end):await records.read(batch);
    if(submissions.length!==batch.end-batch.start||(batch.digest&&await recordDigest(submissions)!==batch.digest))throw Error('upload_checkpoint_mismatch');
    const body=JSON.stringify(batchPayload(job.task,submissions,batch.batchId));
    if(encoder.encode(body).length>8_000_000)throw Error('上传批次超过服务器8MB上限');
    const response=await fetch(origin+'/api/collection/batches',{method:'POST',credentials:'omit',redirect:'error',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body,signal:AbortSignal.timeout(30000)});
    if(!response.ok){
      if(response.status===401)throw Error('导入令牌已过期或无效，请获取新令牌后继续；已确认批次保留');
      if(response.status===413){
        const detail=await response.json().catch(()=>null);
        if(detail?.detail?.code==='storage_quota_exceeded')throw Error('服务器存储空间不足，请清理数据或调整配额后继续；已确认批次保留');
      }
      throw Error('上传失败（HTTP '+response.status+'），已确认批次保留，可继续重试');
    }
    const result=await response.json();
    if(!Number.isInteger(result.inserted)||!Number.isInteger(result.updated)||result.inserted<0||result.updated<0||
      !((result.inserted+result.updated===submissions.length)||(result.replayed===true&&result.inserted===0&&result.updated===0)))throw Error('服务器返回格式不匹配，上传断点已保留');
    job.nextBatch=index+1;
    await saveJob(job);
    onProgress(Math.min(records.length,batch.end),records.length);
  }
  return records.length;
}
