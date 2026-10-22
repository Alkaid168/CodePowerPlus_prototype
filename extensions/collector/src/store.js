const value = (request) => new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
const done = (tx) => new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error||new Error('storage_failed'));});
const platformBusy = async (tasks,task) => (await value(tasks.getAll())).some(
  other=>other.id!==task.id&&other.platform===task.platform&&other.status==='running');
export class CollectorStore {
  constructor(name='codepowerplus-collector-v1'){this.name=name;this.opening=null;}
  async db(){if(!this.opening)this.opening=new Promise((resolve,reject)=>{
    const req=indexedDB.open(this.name,3);
    req.onupgradeneeded=event=>{const db=req.result;
      if(event.oldVersion<1){db.createObjectStore('tasks',{keyPath:'id'});const rows=db.createObjectStore('records',{keyPath:['taskId','submission_id']});rows.createIndex('task','taskId');rows.createIndex('task_submitted',['taskId','submitted_at']);}
      else if(event.oldVersion<3){const rows=req.transaction.objectStore('records');if(!rows.indexNames.contains('task_submitted'))rows.createIndex('task_submitted',['taskId','submitted_at']);}
      if(event.oldVersion<2)db.createObjectStore('uploads',{keyPath:'taskId'});
    };
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });return this.opening;}
  async task(id){const db=await this.db();return value(db.transaction('tasks').objectStore('tasks').get(id));}
  async tasks(){const db=await this.db();return value(db.transaction('tasks').objectStore('tasks').getAll());}
  async saveTask(task){const db=await this.db();const tx=db.transaction('tasks','readwrite');const complete=done(tx);tx.objectStore('tasks').put(task);await complete;}
  async startTask(task){
    const db=await this.db(),tx=db.transaction('tasks','readwrite'),complete=done(tx),tasks=tx.objectStore('tasks');
    // Check and activation share a write transaction, including across open task pages.
    if(await platformBusy(tasks,task)){await complete;throw Error('platform_busy');}
    tasks.add(task);await complete;
  }
  async resetTask(task,expected){
    const db=await this.db(),tx=db.transaction('tasks','readwrite'),complete=done(tx),tasks=tx.objectStore('tasks');
    const live=await value(tasks.get(task.id));
    const matches=!!live&&live.status!=='running'&&live.status===expected.status&&live.updatedAt===expected.updatedAt&&live.leaseToken===expected.leaseToken;
    if(matches&&task.status==='running'&&await platformBusy(tasks,task)){await complete;throw Error('platform_busy');}
    if(matches)tasks.put(task);
    await complete;return matches;
  }
  async deleteTask(id){
    const db=await this.db(),tx=db.transaction(['tasks','records','uploads'],'readwrite'),complete=done(tx);
    tx.objectStore('tasks').delete(id);tx.objectStore('uploads').delete(id);
    const cursor=tx.objectStore('records').index('task').openCursor(IDBKeyRange.only(id));
    cursor.onsuccess=()=>{const row=cursor.result;if(row){row.delete();row.continue();}};
    await complete;
  }
  async uploadJob(taskId){const db=await this.db();return value(db.transaction('uploads').objectStore('uploads').get(taskId));}
  async saveUploadJob(job){
    const db=await this.db(),tx=db.transaction(['tasks','uploads'],'readwrite'),complete=done(tx);
    const task=await value(tx.objectStore('tasks').get(job.taskId));
    if(!task){await complete;throw Error('missing_task');}
    tx.objectStore('uploads').put(job);await complete;
  }
  async clearUploadJob(taskId){const db=await this.db();const tx=db.transaction('uploads','readwrite');const complete=done(tx);tx.objectStore('uploads').delete(taskId);await complete;}
  async records(id){const db=await this.db();const rows=await value(db.transaction('records').objectStore('records').index('task').getAll(id));return rows.map(({taskId,...row})=>row);}
  async recordCount(id){const db=await this.db();return value(db.transaction('records').objectStore('records').index('task').count(id));}
  async recordRange(id,start,end){
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end-start>100)throw Error('invalid_record_range');
    const db=await this.db(),request=db.transaction('records').objectStore('records').index('task').openCursor(IDBKeyRange.only(id));
    return new Promise((resolve,reject)=>{
      const rows=[];let skipped=false;request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{const cursor=request.result;
        if(!cursor||rows.length===end-start){resolve(rows);return;}
        if(!skipped&&start){skipped=true;cursor.advance(start);return;}
        const {taskId,...row}=cursor.value;rows.push(row);cursor.continue();
      };
    });
  }
  async recentRecords(id,limit=50){
    if(!Number.isInteger(limit)||limit<1||limit>500)throw Error('invalid_record_limit');
    const db=await this.db();const tx=db.transaction('records');const request=tx.objectStore('records').index('task_submitted').openCursor(IDBKeyRange.bound([id,''],[id,'\uffff']),'prev');
    return new Promise((resolve,reject)=>{
      const rows=[];request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{const cursor=request.result;if(!cursor||rows.length>=limit){resolve(rows.reverse().map(({taskId,...row})=>row));return;}
        rows.push(cursor.value);cursor.continue();};
    });
  }
  async *recordBatches(id,batchSize=25){
    if(!Number.isInteger(batchSize)||batchSize<1||batchSize>500)throw Error('invalid_record_batch_size');
    const db=await this.db();let after='';
    while(true){
      const range=IDBKeyRange.bound([id,after],[id,'\uffff'],after!=='',false);
      const rows=await value(db.transaction('records').objectStore('records').getAll(range,batchSize));
      if(!rows.length)return;
      after=rows.at(-1).submission_id;
      yield rows.map(({taskId,...row})=>row);
      if(rows.length<batchSize)return;
    }
  }
  async acquire(id,now){const db=await this.db();const tx=db.transaction('tasks','readwrite');const complete=done(tx);const tasks=tx.objectStore('tasks');const task=await value(tasks.get(id));
    if(!task || task.status!=='running' || (task.leaseUntil||0)>now || (task.nextDue||0)>now){await complete;return null;}
    task.leaseUntil=now+60000;task.leaseToken=crypto.randomUUID();tasks.put(task);await complete;return task;
  }
  async release(id){const db=await this.db();const tx=db.transaction('tasks','readwrite');const complete=done(tx);const store=tx.objectStore('tasks');const task=await value(store.get(id));if(task){task.leaseUntil=0;store.put(task);}await complete;}
  async commit(task,rows=[]){const db=await this.db();const tx=db.transaction(['tasks','records'],'readwrite');const complete=done(tx);const tasks=tx.objectStore('tasks');const records=tx.objectStore('records');const live=await value(tasks.get(task.id));
    if(!live || live.status!=='running' || live.leaseToken!==task.leaseToken){await complete;return live;}
    for(const row of rows){const old=await value(records.get([task.id,row.submission_id]));const merged={...old,...row,taskId:task.id};
      if(old?.source_state==='available' && row.source_state!=='available')for(const k of ['source_state','source_code','source_hash'])merged[k]=old[k];
      records.put(merged);
    }
    task.leaseUntil=0;task.updatedAt=new Date().toISOString();tasks.put(task);await complete;return task;
  }
  async changeStatus(id,status,tabId){const db=await this.db();const tx=db.transaction('tasks','readwrite');const complete=done(tx);const tasks=tx.objectStore('tasks');const task=await value(tasks.get(id));
    if(task&&status==='running'&&await platformBusy(tasks,task)){await complete;throw Error('platform_busy');}
    if(task){task.status=status;task.error='';task.nextDue=0;task.leaseUntil=0;task.leaseToken=crypto.randomUUID();if(tabId!==undefined)task.tabId=tabId;tasks.put(task);}await complete;return task;
  }
}
