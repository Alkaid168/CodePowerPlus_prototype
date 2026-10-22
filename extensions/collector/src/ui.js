import {CollectorStore} from './store.js';
import {SITES,legacyAtCoder} from './engine.js';
import {collectionJsonChunks} from './export.js';
import {serverOrigin,createPagedUploadJob,uploadPlannedBatches} from './upload.js';
import {formatSubmissionTime} from './time.js';
import {REPLICA_ORIGIN} from './replica.js';
const store=new CollectorStore();
const $=id=>document.getElementById(id);
const names={codeforces:'Codeforces',luogu:'洛谷',atcoder:'AtCoder',vjudge:'VJudge'};
const statuses={running:'采集中',paused:'已暂停',blocked:'等待处理',complete:'可见范围已遍历',cancelled:'已结束'};
const sourceNames={not_requested:'未请求',available:'已保存',private:'无查看权限',blocked:'被拦截',unavailable:'不可用',image_only:'仅图片'};
const errors={login_required:'请在相应平台的标签页登录本人账号，再重新识别。',permission_required:'请先授权访问所选平台。',owner_mismatch:'账号不一致，请回到本人登录的标签页。',challenge:'请到平台原页面完成验证，然后继续任务。',schema_changed:'网站返回格式发生变化，已保留断点，请导出已取得的数据。',platform_busy:'该平台已有运行任务，请先暂停它。',tab_unavailable:'采集标签页已关闭或不可用，请重新打开并识别账号。',wrong_site:'采集标签页已离开对应平台，请重新识别。',rate_limited:'平台暂时限流，任务稍后重试。',source_unavailable:'当前记录源码不可取；可保留断点，或改为仅继续采集记录。',pause_first:'请先暂停当前任务。'};
errors.challenge='请求返回了验证页，已保留断点。请打开下方失败地址处理，再点“继续”；不要反复重新同步。';
errors.access_denied='平台拒绝了该请求（403），未识别到验证页。已保留断点，请先检查下方失败地址能否正常打开。';
errors.task_changed='任务已在其他页面改变，请刷新后重试。';
errors.missing_task='任务已被删除，请刷新列表。';
errors.replica_permission_required='快速模式需要授权访问AtCoder Problems；只查询公开账号的提交元数据，不发送OJ登录凭据。';
errors.atcoder_fast_required='逐比赛扫描已停用，已有数据保留，请点“改用快速采集”。';
errors.replica_boundary_gap='提交副本在同一秒存在截断或变化，已保留记录并暂停；请导出已取得的数据，稍后重新同步核对。';
errors.replica_count_mismatch='副本计数与取得记录不一致（可能更新或漏收），已保留数据；请稍后重新同步核对。';
let identity=null,selected=null,allTasks=[],visibleRecordCount=0,refreshing=false,busy=false;
function setBusy(value){busy=value;for(const id of ['identify','start','export','upload','clear-upload'])$(id).disabled=value||$(id).disabled;for(const b of $('tasks').querySelectorAll('button'))b.disabled=value;}
async function assertSnapshot(task){
  const live=await store.task(task.id);
  if(!live||live.status==='running'||live.updatedAt!==task.updatedAt||live.status!==task.status)throw Error('upload_checkpoint_mismatch');
}
const message=async data=>{const out=await chrome.runtime.sendMessage(data);if(out?.error)throw Error(out.error);return out;};
function notify(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
function handleError(error){notify(errors[error.message]||error.message||'操作未完成，请稍后重试。',true);}
function button(text,action){const b=document.createElement('button');b.className='secondary';b.type='button';b.textContent=text;b.disabled=busy;b.addEventListener('click',()=>{if(!busy)Promise.resolve(action()).catch(handleError);});return b;}
async function setStatus(task,status){
  if(status==='running'&&task.coverageScope==='replica_submissions'&&!await chrome.permissions.request({origins:[REPLICA_ORIGIN+'/*']}))return notify(errors.replica_permission_required,true);
  const same=identity?.platform===task.platform&&identity.account===task.account;await message({type:'status',id:task.id,status,tabId:same?identity.tabId:undefined});await refresh();
}
async function refresh(){
  if(refreshing)return;refreshing=true;
  try{
    allTasks=(await store.tasks()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    if(!allTasks.some(t=>t.id===selected))selected=allTasks[0]?.id||null;
    const container=$('tasks');container.replaceChildren();
    if(!allTasks.length){const p=document.createElement('p');p.className='empty';p.textContent='还没有任务，先连接一个已登录的平台。';container.append(p);}
    for(const task of allTasks){
      const card=document.createElement('div');card.className='task'+(task.id===selected?' selected':'');const text=document.createElement('div');
      const title=document.createElement('strong');title.textContent=names[task.platform]+' · '+task.account;
      const replica=task.coverageScope==='replica_submissions';
      const legacy=legacyAtCoder(task);
      const meta=document.createElement('div');meta.className='task-meta';meta.textContent=(replica&&task.status==='complete'?'副本范围已遍历（不等于官网全量）':statuses[task.status]||task.status)+' · '+task.pages+'页 · '+task.requests+'次请求'+
        (replica?' · 快速模式'+(Number.isInteger(task.replicaExpected)?' · 副本记录 '+(task.replicaCollected||0)+'/'+task.replicaExpected:''):'')+(task.error?' · '+(errors[task.error]||task.error):'');
      text.append(title,meta);
      if(task.error&&task.diagnostic){
        const d=task.diagnostic,detail=document.createElement('div');detail.className='task-meta';
        detail.textContent=({source:'源码页',list:'提交列表',contests:'比赛目录',replica_list:'副本提交列表',replica_count:'副本计数',replica_boundary:'副本分页核对',replica_verify:'副本计数核对'}[d.action]||'请求')+' · HTTP '+d.status+' · '+(d.provider==='atcoder_problems'?REPLICA_ORIGIN:SITES[task.platform])+d.path;
        text.append(detail);
      }
      const controls=document.createElement('div');controls.className='row';controls.append(button('查看',async()=>{selected=task.id;await refresh();}));
      if(task.status==='running')controls.append(button('暂停',()=>setStatus(task,'paused')));
      else if(task.status!=='complete'&&!legacy)controls.append(button('继续',()=>setStatus(task,'running')));
      if(task.status!=='running'&&!legacy)controls.append(button('重新同步',async()=>{await message({type:'resync',id:task.id,tabId:identity?.platform===task.platform&&identity.account===task.account?identity.tabId:undefined});await refresh();}));
      if(legacy){const hint=document.createElement('div');hint.className='task-meta';hint.textContent=errors.atcoder_fast_required;text.append(hint);}
      if(task.platform==='atcoder'&&!replica&&task.status!=='running')controls.append(button('改用快速采集',async()=>{
        if(!await chrome.permissions.request({origins:[REPLICA_ORIGIN+'/*']}))return notify(errors.replica_permission_required,true);
        await message({type:'accelerate',id:task.id,tabId:identity?.platform===task.platform&&identity.account===task.account?identity.tabId:undefined});
        notify('已切换快速模式，保留已有记录；公开账号交由AtCoder Problems查询，源码仍从官网获取。');await refresh();
      }));
      controls.append(button('删除本地任务',async()=>{
        if(!window.confirm('删除 '+names[task.platform]+' · '+task.account+' 的这个本地任务？\n将停止该任务，并删除它的本地记录、源码和上传断点，无法撤销。\n服务器已接收的数据及已导出的文件不受影响。未备份的数据请先导出。'))return;
        setBusy(true);
        try{await message({type:'delete',id:task.id,confirm:'delete-local-task'});notify('已删除本地任务及其记录；服务器数据和导出文件不受影响。');}
        finally{setBusy(false);await refresh();}
      }));
      card.append(text,controls);container.append(card);
    }
    const task=allTasks.find(t=>t.id===selected);visibleRecordCount=task?await store.recordCount(task.id):0;
    const uploadJob=task?await store.uploadJob(task.id):null;
    const recentRecords=task?await store.recentRecords(task.id,50):[];
    $('summary').textContent=task?visibleRecordCount+'条记录 · '+(task.platform==='atcoder'?(task.coverageScope==='replica_submissions'?'AtCoder Problems副本元数据 · 官网源码 · 可能滞后/漏收':'旧任务数据已保留，待切换快速采集'):'账号可见范围'):'选择一个任务查看';
    const preview=$('preview');preview.replaceChildren();
    for(const row of recentRecords.reverse()){
      const tr=document.createElement('tr');for(const val of [row.problem_key,formatSubmissionTime(row.submitted_at),row.language,row.verdict,sourceNames[row.source_state]]){const td=document.createElement('td');td.textContent=val;tr.append(td);}preview.append(tr);
    }
    $('identify').disabled=busy;$('start').disabled=busy||!identity;
    $('export').disabled=busy||!visibleRecordCount||task?.status==='running';
    $('upload').textContent=uploadJob?`继续上传（${uploadJob.nextBatch}/${uploadJob.batches.length}批）`:'授权并上传';
    $('upload').disabled=busy||!visibleRecordCount||!$('consent').checked||task?.status==='running';
    $('clear-upload').disabled=busy;
    $('clear-upload').hidden=!uploadJob;
  }finally{refreshing=false;}
}
$('platform').addEventListener('change',()=>{identity=null;$('identity').textContent='尚未识别账号';$('start').disabled=true;$('atcoder-note').hidden=$('platform').value!=='atcoder';});
$('identify').addEventListener('click',async()=>{
  try{const platform=$('platform').value;const granted=await chrome.permissions.request({origins:[SITES[platform]+'/*']});if(!granted)return notify('未授予站点访问权限。');
    identity=await message({type:'identify',platform});$('identity').textContent=names[platform]+' · '+identity.account;$('start').disabled=false;notify('已识别本人账号。采集时请保持原站标签页打开。');
  }catch(e){handleError(e);}
});
$('start').addEventListener('click',async()=>{
  try{if(!identity)throw Error('login_required');
    if(identity.platform==='atcoder'&&!await chrome.permissions.request({origins:[REPLICA_ORIGIN+'/*']}))return notify(errors.replica_permission_required,true);
    const task=await message({type:'start',...identity,includeSource:$('include-source').checked});selected=task.id;notify('任务已开始，关闭本任务页后仍可从断点继续。');await refresh();
  }catch(e){handleError(e);}
});
$('refresh').addEventListener('click',()=>refresh().catch(handleError));$('consent').addEventListener('change',()=>refresh().catch(handleError));
$('export').addEventListener('click',async()=>{
  if(busy)return;
  let writable=null,parts=[];
  try{
    const cachedTask=allTasks.find(item=>item.id===selected);if(!cachedTask)throw Error('请先选择采集任务。');
    if(cachedTask.status==='running')throw Error('pause_first');
    setBusy(true);
    const safeAccount=cachedTask.account.replace(/[^A-Za-z0-9_.-]/g,'_');
    const filename='CodePowerPlus-'+cachedTask.platform+'-'+safeAccount+'.json';
    const handlePromise=window.showSaveFilePicker?window.showSaveFilePicker({suggestedName:filename,types:[{description:'JSON数据',accept:{'application/json':['.json']}}]}):null;
    const handle=handlePromise?await handlePromise:null;
    const task=await store.task(cachedTask.id);await assertSnapshot(cachedTask);
    if(handle)writable=await handle.createWritable();
    for await(const chunk of collectionJsonChunks(task,store.recordBatches(task.id,25))){
      await assertSnapshot(task);
      if(writable)await writable.write(chunk);else parts.push(chunk);
    }
    await assertSnapshot(task);
    if(writable)await writable.close();
    else{const blob=new Blob(parts,{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),10000);}
    notify('导出已完成，请打开文件核对记录数后再卸载扩展。');
  }catch(e){if(writable)try{await writable.abort();}catch{}if(e.name==='AbortError')notify('已取消导出。');else handleError(e);}
  finally{setBusy(false);await refresh();}
});
$('upload').addEventListener('click',async()=>{
  if(busy)return;
  const token=$('token').value;let origin;
  const taskId=selected;
  try{
    if(!$('consent').checked)throw Error('请先查看结果并同意上传。');origin=serverOrigin($('server').value);
    if(!token)throw Error('请输入本站短期导入令牌。');
    setBusy(true);
    // Permission prompt must stay in the click user gesture, before IndexedDB awaits.
    const granted=await chrome.permissions.request({origins:[origin+'/*']});if(!granted)return notify('未授予服务器访问权限。');
    const task=await store.task(taskId);if(!task)throw Error('请先选择采集任务。');if(task.status==='running')throw Error('pause_first');
    const length=await store.recordCount(task.id);
    let job=await store.uploadJob(task.id);
    if(job&&(job.origin!==origin||job.taskUpdatedAt!==task.updatedAt||job.totalRecords!==length))throw Error('upload_checkpoint_mismatch');
    if(!job){job=await createPagedUploadJob(task,store.recordBatches(task.id,25),origin);await assertSnapshot(task);await store.saveUploadJob(job);}
    const records={length,read:async batch=>{await assertSnapshot(task);return store.recordRange(task.id,batch.start,batch.end);}};
    $('upload').disabled=true;
    const count=await uploadPlannedBatches(origin,token,job,records,state=>store.saveUploadJob(state),(sent,total)=>notify('已上传 '+sent+' / '+total+' 条记录…'));
    await assertSnapshot(task);
    await store.clearUploadJob(task.id);
    notify('服务器已确认接收 '+count+' 条记录，可以卸载扩展；以后同步需重新安装。');$('consent').checked=false;
  }catch(e){handleError(e);}finally{$('token').value='';setBusy(false);await refresh();}
});
errors.upload_checkpoint_mismatch='已有上传断点绑定到其他服务器或不同版本的本地记录；请继续原上传，或清除断点后重新开始。';
$('clear-upload').addEventListener('click',async()=>{
  try{await store.clearUploadJob(selected);notify('已清除本地上传进度；服务器已确认的批次不会被删除。');await refresh();}
  catch(e){handleError(e);}
});
await refresh();setInterval(()=>refresh().catch(handleError),2500);
