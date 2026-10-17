const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app/static/js/views/analysis.js', 'utf8');
class Node {
  constructor(tag, props={}, ...children) {
    this.tag = tag; this.disabled = false; this.value = ''; this.children = []; this.listeners={};
    Object.assign(this, props); this.classList={toggle(){}};
    this.append(...children);
    if (tag === 'textarea') this.value = children.flat(Infinity).join('');
    if (tag === 'select') this.value = (this.children.find(c=>c.selected) || this.children[0])?.value || '';
  }
  setAttribute(name,value){this[name]=value;}
  append(...children){this.children.push(...children.flat(Infinity).filter(c=>c!==null&&c!==undefined&&c!==false));}
  addEventListener(name, fn){this.listeners[name]=fn;}
  querySelectorAll(selector){const tags=selector.split(',').map(s=>s.trim());return descendants(this).filter(n=>tags.includes(n.tag));}
}
const descendants = node => (node.children || []).flatMap(c=>c instanceof Node ? [c,...descendants(c)] : []);
const h = (tag, props={}, ...children) => { const n=new Node(tag, props,...children); for(const [k,v] of Object.entries(props)) if(k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(),v); return n; };
const mount = (host,...children)=>{host.children=[];host.append(...children);return host;};
const tick = async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
const deferred = ()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
(async()=>{
 let updateCalls=0,saveCalls=0,modelCalls=0, gate=null,modelGate=null;
 let editorGate=null;
 const problem={id:1000,title:'Test',description:'Statement',source_url:'',reference_solution:'',reference_code:'',revision:1,analysis:null};
 const api={problem:async()=>({...problem}),updateProblem:()=>{updateCalls++;return gate?gate.promise:Promise.resolve({...problem});},saveAnalysis:()=>{saveCalls++;return gate.promise;},analyzeProblem:()=>{modelCalls++;return modelGate.promise;}};
 const button=(label,props={})=>h('button',props,label);
 const stubEditor=()=>({node:h('div',{},h('input',{value:'label evidence'}),h('button',{disabled:true},'Always disabled')),read:()=>({primary_knowledge_ids:['basic.prefix-sum']})});
 const dependencies={
 '../api.js':{api},'../dom.js':{h,mount},'../markdown.js':{mountMarkdown:async()=>({mathRendered:true})},'../router.js':{navigate(){}},
 '../store.js':{store:{ensureKnowledge:async()=>[],state:{knowledgeVersion:'test'}}},
 '../components.js':{button,card:(props,...children)=>h('section',{},props.actions,...children),field:(label,control)=>h('div',{},control),difficultyTag:()=>h('span'),errorBox:()=>h('aside'),loading:()=>h('p'),notice:()=>h('p'),sourceLink:()=>h('span'),statusBadge:()=>h('span'),toast(){}},
 '../tagEditor.js':{createTagEditor:async()=>editorGate?editorGate.promise:stubEditor()},
 };
 const context=vm.createContext({window:{location:{hash:'#/analysis/1000'},addEventListener(){},setTimeout,clearTimeout}});
 const drafts=new vm.SourceTextModule(fs.readFileSync('app/static/js/drafts.js','utf8'),{context});await drafts.link(()=>{});
 const module=new vm.SourceTextModule(source,{context});
 await module.link(specifier=>{if(specifier==='../drafts.js')return drafts;const data=dependencies[specifier];assert.ok(data,specifier);return new vm.SyntheticModule(Object.keys(data),function(){for(const [k,v] of Object.entries(data))this.setExport(k,v);},{context});});await module.evaluate();
 const render = async()=>{const workspace=await module.namespace.default.render({param:'1000'});const tab=descendants(workspace).find(n=>n.tag==='button'&&n.children.includes('手工标注'));tab.listeners.click();await tick();return workspace;};
 const forms=w=>descendants(w).filter(n=>n.tag==='form');
 const submit=(form,label)=>form.listeners.submit({preventDefault(){},submitter:descendants(form).find(n=>n.tag==='button'&&n.children.includes(label))});
 const allLocked=w=>assert.ok(w.querySelectorAll('input, textarea, select, button').every(n=>n.disabled),'every control should be disabled during mutation');
 const editableRestored=w=>{const controls=w.querySelectorAll('input, textarea, select, button');assert.ok(controls.filter(n=>!n.children.includes('Always disabled')).every(n=>!n.disabled));assert.ok(controls.filter(n=>n.children.includes('Always disabled')).every(n=>n.disabled));};
 // Manual save locks both columns, blocks a simultaneous left save, then restores on success.
 let w=await render();let [left,manual]=forms(w);
 const rating=descendants(manual).find(n=>n.tag==='select');
 assert.equal(rating.children[0].value,'100');assert.equal(rating.children.at(-1).value,'3500');assert.equal(rating.children.length,35);
 assert.equal(rating.value,'1200','new choices must preserve the existing manual default');
 gate=deferred();const manualPending=submit(manual,'保存标注（进入待审核）');allLocked(w);await submit(left,'保存修改');assert.equal(updateCalls,0);gate.resolve({analysis:{analysis_id:1}});await manualPending;editableRestored(w);
 // Failure must restore old disabled states and keep inputs.
 w=await render();[left,manual]=forms(w);gate=deferred();const manualFailure=submit(manual,'保存标注（进入待审核）');allLocked(w);gate.reject(new Error('save failed'));await manualFailure;editableRestored(w);
 // Left save/model failure locks both columns and prevents manual save.
 w=await render();[left,manual]=forms(w);gate=deferred();modelGate=deferred();const leftPending=submit(left,'保存并重新分析');allLocked(w);const before=saveCalls;await submit(manual,'保存标注（进入待审核）');assert.equal(saveCalls,before);gate.resolve({...problem});await tick();assert.equal(modelCalls,1);allLocked(w);modelGate.reject(new Error('model failed'));await leftPending;editableRestored(w);
 console.log('PASS shared lock: manual success, manual failure, model failure, both submit directions, original disabled state');
 // Extra async-editor boundary: pending editor may mount while a left save is locked.
 editorGate=deferred();w=await render();left=forms(w)[0];gate=deferred();const pending=submit(left,'保存修改');allLocked(w);editorGate.resolve(stubEditor());await tick();const unlocked=w.querySelectorAll('input, textarea, select, button').filter(n=>!n.disabled);assert.equal(unlocked.length,0,'async editor must join the shared lock'); console.log('PASS delayed editor joins shared lock');gate.reject(new Error('cleanup'));await pending;
})().catch(error=>{console.error(error);process.exitCode=1;});
