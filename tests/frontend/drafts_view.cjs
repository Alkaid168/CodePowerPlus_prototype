const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Node {
 constructor(tag,props={},...children){this.tag=tag;this.value='';this.disabled=false;this.children=[];this.listeners={};Object.assign(this,props);this.classList={toggle(){}};this.append(...children);if(tag==='textarea')this.value=children.flat(Infinity).join('');if(tag==='select')this.value=(this.children.find(c=>c.selected)||this.children[0])?.value||'';}
 append(...children){this.children.push(...children.flat(Infinity).filter(c=>c!==null&&c!==undefined&&c!==false));}
 addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
 setAttribute(name,value){this[name]=value;}
 querySelectorAll(selector){return descend(this).filter(n=>selector.split(',').map(x=>x.trim()).includes(n.tag));}
}
const descend=n=>(n.children||[]).flatMap(c=>c instanceof Node?[c,...descend(c)]:[]);
const h=(tag,props={},...children)=>{const n=new Node(tag,props,...children);for(const[k,v]of Object.entries(props))if(k.startsWith('on')&&v)n.addEventListener(k.slice(2).toLowerCase(),v);return n;};
const mount=(n,...children)=>{n.children=[];n.append(...children);return n;};
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const fire=async(n,event='click',extra={})=>{for(const fn of n.listeners[event]||[])await fn({preventDefault(){},...extra});await tick();};
const btn=(w,label)=>descend(w).find(n=>n.tag==='button'&&n.children.includes(label));
(async()=>{
 const values=new Map(),tasks=new Map(),listeners=new Map();let seq=0,created=0,updates=0,manualSaves=0,editor=null,failManual=true,createGate=null,lateWrites=0,historyGate=null,modelGate=null;
 const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const window={location:{hash:'#/analysis'},localStorage:storage,setTimeout(fn){const id=++seq;tasks.set(id,fn);return id;},clearTimeout:id=>tasks.delete(id),addEventListener(name,fn){listeners.set(name,fn);}};
 let problem={id:1000,revision:1,title:'Saved',description:'Saved statement',source_url:'',reference_solution:'',reference_code:'',analysis:null};
 const api={createProblem:async body=>{created++;if(createGate)await createGate;problem={...problem,...body};return {...problem};},updateProblem:async(id,body)=>{updates++;problem={...problem,...body};return {...problem};},analyzeProblem:async()=>{throw Error('offline');},problem:async()=>({...problem}),saveAnalysis:async()=>{manualSaves++;if(failManual)throw Error('offline');return {analysis:{analysis_id:2}};}};
 api.analysisHistory=()=>historyGate;
 api.analyzeProblem=async()=>{if(modelGate)return modelGate;throw Error('offline');};
 const dependencies={
 '../api.js':{api},'../dom.js':{h,mount},'../markdown.js':{mountMarkdown:async()=>({mathRendered:true})},'../router.js':{navigate(){}},
 '../store.js':{store:{ensureKnowledge:async()=>[],state:{userId:'tester',knowledgeVersion:'test'}}},
 '../components.js':{button:(label,p={})=>h('button',p,label),card:(p,...c)=>h('section',{},p.actions,...c),field:(l,c)=>h('div',{},c),difficultyTag:()=>h('span'),errorBox:()=>h('aside'),loading:()=>h('p'),notice:()=>h('p'),sourceLink:()=>h('span'),statusBadge:()=>h('span'),toast(){}},
 '../tagEditor.js':{createTagEditor:async(initial,options={})=>{editor={node:h('div'),rows:initial.map(x=>({...x})),reset(rows){this.rows=rows;options.onChange?.();},read(){return {primary_knowledge_ids:['dp.knapsack']};},change(){options.onChange?.();}};return editor;}},
 };
 const context=vm.createContext({window});const drafts=new vm.SourceTextModule(fs.readFileSync('app/static/js/drafts.js','utf8'),{context});await drafts.link(()=>{});
 const mod=new vm.SourceTextModule(fs.readFileSync('app/static/js/views/analysis.js','utf8'),{context});
 await mod.link(spec=>{if(spec==='../drafts.js')return drafts;const data=dependencies[spec];assert.ok(data,spec);return new vm.SyntheticModule(Object.keys(data),function(){for(const[k,v]of Object.entries(data))this.setExport(k,v);},{context});});await mod.evaluate();
 const render=async param=>{const w=await mod.namespace.default.render({param});await tick();return w;};
 let w=await render('');let form=descend(w).find(n=>n.tag==='form');let inputs=form.querySelectorAll('input, textarea');
 inputs[0].value='Draft title ';inputs[2].value='Final keystroke\n';await fire(form,'input');
 window.location.hash='#/overview';listeners.get('hashchange')?.();window.location.hash='#/analysis';
 w=await render('');form=descend(w).find(n=>n.tag==='form');inputs=form.querySelectorAll('input, textarea');
 assert.equal(inputs[0].value,'Draft title ','route reentry restores title');assert.equal(inputs[2].value,'Final keystroke\n');
 await fire(form,'submit',{submitter:btn(w,'保存并分析')});assert.equal(created,1);
 w=await render('');form=descend(w).find(n=>n.tag==='form');assert.ok(form,'created recovery remains editable');
 await fire(form,'submit',{submitter:btn(w,'保存并分析')});assert.equal(created,1,'refresh after model failure cannot create twice');assert.equal(updates,1);
 await fire(btn(w,'清空'));assert.equal([...values.keys()].filter(k=>k.endsWith(':created:new')||k.endsWith(':entry:new')).length,0);
 w=await render('1000');form=descend(w).find(n=>n.tag==='form');inputs=form.querySelectorAll('input, textarea');inputs[0].value='Local edit';await fire(form,'input');
 w=await render('1000');form=descend(w).find(n=>n.tag==='form');assert.equal(form.querySelectorAll('input')[0].value,'Local edit');
 await fire(btn(w,'手工标注'));let manual=descend(w).filter(n=>n.tag==='form')[1];let manualInputs=manual.querySelectorAll('input, textarea, select');
 manualInputs.at(-1).value='Unfinished idea';editor.rows=[{id:'dp.knapsack',role:'primary',evidence:'draft evidence',confidence:0.75}];editor.change();await fire(manual,'input');
 await fire(btn(w,'分析结果'));await fire(btn(w,'手工标注'));manual=descend(w).filter(n=>n.tag==='form')[1];assert.equal(manual.querySelectorAll('textarea').at(-1).value,'Unfinished idea','switch tabs restores manual input');assert.equal(editor.rows[0].evidence,'draft evidence');
 const entries=[...values.keys()].filter(k=>k.endsWith(':problem:1000'));assert.equal(entries.length,1);
 await fire(manual,'submit',{submitter:btn(w,'保存标注（进入待审核）')});assert.equal(manualSaves,0,'unsaved left content still blocks manual save');
 form=descend(w).find(n=>n.tag==='form');await fire(form,'submit',{submitter:btn(w,'保存修改')});
 assert.equal([...values.keys()].filter(k=>k.endsWith(':problem:1000')).length,0,'successful left save clears content draft');
 await fire(btn(w,'手工标注'));manual=descend(w).filter(n=>n.tag==='form')[1];
 await fire(manual,'submit',{submitter:btn(w,'保存标注（进入待审核）')});assert.equal(manualSaves,1);assert.ok([...values.keys()].some(k=>k.endsWith(':manual:1000')),'failed manual save retains draft');
 failManual=false;await fire(manual,'submit',{submitter:btn(w,'保存标注（进入待审核）')});assert.equal(manualSaves,2);assert.equal([...values.keys()].filter(k=>k.endsWith(':manual:1000')).length,0,'successful manual save clears matching draft');
 form=descend(w).find(n=>n.tag==='form');form.querySelectorAll('input')[0].value='Conflict draft';await fire(form,'input');
 problem.revision=2;w=await render('1000');form=descend(w).find(n=>n.tag==='form');assert.equal(form.querySelectorAll('input')[0].value,problem.title,'server revision change blocks auto restore');
 assert.ok(descend(w).find(n=>n['aria-label']?.includes('导出')),'mismatched draft offers deliberate export');
 let releaseHistory;historyGate=new Promise(resolve=>{releaseHistory=resolve;});await fire(btn(w,'版本历史'));await fire(btn(w,'手工标注'));
 releaseHistory({items:[]});await tick();assert.equal(descend(w).filter(n=>n.tag==='form').length,2,'late history response cannot replace active manual editor');
 // A slow save may finish after navigating away; it must keep its id but cannot repaint old DOM.
 window.location.hash='#/analysis';w=await render('');form=descend(w).find(n=>n.tag==='form');inputs=form.querySelectorAll('input, textarea');inputs[0].value='Slow save';inputs[2].value='Statement';
 await fire(form,'input');
 let release;createGate=new Promise(resolve=>{release=resolve;});const pending=fire(form,'submit',{submitter:btn(w,'保存并分析')});
 await tick();window.location.hash='#/overview';listeners.get('hashchange')();
 for(const node of [w,...descend(w)]){
   node.savedChildren=node.children;node.monitored=true;
   Object.defineProperty(node,'children',{configurable:true,get(){return this.savedChildren;},set(value){if(this.monitored)lateWrites++;this.savedChildren=value;}});
 }
 const beforeReentryCreates=created;
 window.location.hash='#/analysis';let newerView=await render('');let newerForm=descend(newerView).find(n=>n.tag==='form');newerForm.querySelectorAll('input')[0].value='More recent intake';await fire(newerForm,'input');listeners.get('pagehide')();
 const secondPending=fire(newerForm,'submit',{submitter:btn(newerView,'保存并分析')});await tick();assert.equal(created,beforeReentryCreates,'pending create is locked across reentered views');
 dependencies['../store.js'].store.state.userId='second-user';let otherView=await render('');let otherForm=descend(otherView).find(n=>n.tag==='form');otherForm.querySelectorAll('input')[0].value='Second user draft';await fire(otherForm,'input');listeners.get('pagehide')();
 release();await pending;await secondPending;assert.equal(lateWrites,0,'late save must not repaint detached feedback');
 assert.equal(drafts.namespace.readCreated('tester').id,1000,'late create belongs to initiating user');assert.equal(drafts.namespace.readCreated('second-user'),null,'late create cannot write new current user');
 assert.ok([...values.values()].some(v=>v.includes('More recent intake')),'late create response cannot delete later intake draft');
 assert.ok([...values.values()].some(v=>v.includes('Second user draft')),'other user draft stays isolated');
 dependencies['../store.js'].store.state.userId='tester';newerView=await render('');newerForm=descend(newerView).find(n=>n.tag==='form');
 assert.equal(newerForm.querySelectorAll('input')[0].value,'More recent intake','known newly created revision restores later intake edits');
 createGate=null;const countBeforeRetry=created;await fire(newerForm,'submit',{submitter:btn(newerView,'保存并分析')});assert.equal(created,countBeforeRetry,'retry after late creation updates recorded id');
 let releaseModel;modelGate=new Promise(resolve=>{releaseModel=resolve;});newerView=await render('');newerForm=descend(newerView).find(n=>n.tag==='form');const modelPending=fire(newerForm,'submit',{submitter:btn(newerView,'保存并分析')});await tick();
 drafts.namespace.rememberCreated('tester',{id:4000,revision:1});drafts.namespace.rememberCreated('second-user',{id:5000,revision:1});dependencies['../store.js'].store.state.userId='second-user';
 releaseModel({problem:{id:1000}});await modelPending;
 assert.equal(drafts.namespace.readCreated('tester').id,4000,'late model success cannot clear newer initiating-user pointer');
 assert.equal(drafts.namespace.readCreated('second-user').id,5000,'late model success cannot clear current different user pointer');
 console.log('PASS draft view: last input route flush, reload, created recovery avoids duplication, clear, problem edits, manual tabs and evidence, revision conflict icon');
})().catch(e=>{console.error(e);process.exitCode=1;});
