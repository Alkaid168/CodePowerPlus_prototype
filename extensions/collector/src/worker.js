import {pageAgent} from './page-agent.js';
import {CollectorStore} from './store.js';
import {createTask,stepTask,SITES,legacyAtCoder} from './engine.js';
import {fetchReplica,REPLICA_ORIGIN} from './replica.js';
const store=new CollectorStore();
let active=false;
const invoke=async(input,tabId)=>{
  try {
    if(input.platform==='atcoder'&&input.action.startsWith('replica_')){
      if(!await chrome.permissions.contains({origins:[REPLICA_ORIGIN+'/*']}))return {error:'replica_permission_required'};
      const identity=await invoke({platform:'atcoder',action:'identify'},tabId);
      if(identity.error)return identity;
      if(identity.account!==input.account)return {error:'owner_mismatch'};
      return fetchReplica(input);
    }
    const tab=await chrome.tabs.get(tabId);
    if(new URL(tab.url).origin!==SITES[input.platform])return {error:'wrong_site'};
    const result=await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:pageAgent,args:[input]});
    return result[0]?.result||{error:'page_unavailable'};
  }catch{return {error:'tab_unavailable'};}
};
async function pump(){
  if(active)return;active=true;
  try{
    const tasks=(await store.tasks()).filter(t=>t.status==='running');
    // One task per platform: the queue never runs two authenticated requests concurrently.
    for(const task of tasks)await stepTask(store,task.id,invoke);
  }finally{
    active=false;
    if((await store.tasks()).some(t=>t.status==='running'))setTimeout(()=>pump(),3500);
  }
}
chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:chrome.runtime.getURL('collector.html')}));
chrome.runtime.onInstalled.addListener(()=>chrome.alarms.create('collector-recover',{periodInMinutes:0.5}));
chrome.runtime.onStartup.addListener(()=>{chrome.alarms.create('collector-recover',{periodInMinutes:0.5});pump();});
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='collector-recover')pump();});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id || sender.url!==chrome.runtime.getURL('collector.html'))return false;
  (async()=>{
    if(message.type==='identify'){
      const origin=SITES[message.platform];if(!origin)throw Error('invalid_platform');
      const granted=await chrome.permissions.contains({origins:[origin+'/*']});if(!granted)throw Error('permission_required');
      const tabs=await chrome.tabs.query({url:origin+'/*'});
      for(const tab of tabs){const result=await invoke({platform:message.platform,action:'identify'},tab.id);if(result.account)return {...result,tabId:tab.id};}
      throw Error('login_required');
    }
    if(message.type==='start'){
      const {platform,tabId,account}=message;
      if(platform==='atcoder'&&!await chrome.permissions.contains({origins:[REPLICA_ORIGIN+'/*']}))throw Error('replica_permission_required');
      const identified=await invoke({platform,action:'identify'},tabId);
      if(identified.account!==account)throw Error('owner_mismatch');
      if((await store.tasks()).some(t=>t.platform===platform&&t.status==='running'))throw Error('platform_busy');
      const task=createTask(message);await store.startTask(task);pump();return {id:task.id};
    }
    if(message.type==='status'){
      const target=await store.task(message.id);if(!target)throw Error('missing_task');
      if(message.status==='running'){
        if(legacyAtCoder(target))throw Error('atcoder_fast_required');
        if((await store.tasks()).some(t=>t.id!==target.id&&t.platform===target.platform&&t.status==='running'))throw Error('platform_busy');
        const identity=await invoke({platform:target.platform,action:'identify'},message.tabId??target.tabId);
        if(identity.account!==target.account)throw Error('owner_mismatch');
      }
      if(!['running','paused','cancelled'].includes(message.status))throw Error('invalid_status');
      if(!await store.changeStatus(message.id,message.status,message.status==='running'?message.tabId:undefined))throw Error('missing_task');
      pump();return {ok:true};
    }
    if(message.type==='resync'){
      const target=await store.task(message.id);if(!target||target.status==='running')throw Error('pause_first');
      if(legacyAtCoder(target))throw Error('atcoder_fast_required');
      if(target.platform==='atcoder'&&!await chrome.permissions.contains({origins:[REPLICA_ORIGIN+'/*']}))throw Error('replica_permission_required');
      const identity=await invoke({platform:target.platform,action:'identify'},message.tabId??target.tabId);
      if(identity.account!==target.account)throw Error('owner_mismatch');
      // Keep the same task/record keyspace: replay pages updates verdicts without local duplicates.
      const reset=createTask(target);
      reset.id=target.id;reset.createdAt=target.createdAt;
      if(message.tabId!==undefined)reset.tabId=message.tabId;
      if(!await store.resetTask(reset,target))throw Error('task_changed');
      pump();return {ok:true};
    }
    if(message.type==='accelerate'){
      const target=await store.task(message.id);
      if(!target||target.platform!=='atcoder'||target.status==='running')throw Error('pause_first');
      if((await store.tasks()).some(t=>t.id!==target.id&&t.platform==='atcoder'&&t.status==='running'))throw Error('platform_busy');
      if(!await chrome.permissions.contains({origins:[REPLICA_ORIGIN+'/*']}))throw Error('replica_permission_required');
      const tabId=message.tabId??target.tabId,identity=await invoke({platform:'atcoder',action:'identify'},tabId);
      if(identity.account!==target.account)throw Error('owner_mismatch');
      const reset=createTask({...target,tabId});
      reset.id=target.id;reset.createdAt=target.createdAt;
      if(!await store.resetTask(reset,target))throw Error('task_changed');
      pump();return {ok:true};
    }
    if(message.type==='delete'){
      if(message.confirm!=='delete-local-task')throw Error('confirmation_required');
      await store.deleteTask(message.id);return {ok:true};
    }
    throw Error('invalid_operation');
  })().then(reply,error=>reply({error:/^[a-z0-9_]+$/.test(error.message)?error.message:'operation_failed'}));
  return true;
});
