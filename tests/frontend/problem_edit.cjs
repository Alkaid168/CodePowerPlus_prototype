const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Node {
 constructor(tag,props={},...children){this.tag=tag;this.value='';this.disabled=false;this.children=[];this.listeners={};this.classList={add(){},toggle(){}};Object.assign(this,props);this.append(...children);if(tag==='textarea')this.value=children.flat(Infinity).join('');}
 append(...children){this.children.push(...children.flat(Infinity).filter(c=>c!==null&&c!==false&&c!==undefined));}
 addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
 setAttribute(k,v){this[k]=v;}
 querySelectorAll(sel){return all(this).filter(n=>sel.split(',').map(s=>s.trim()).includes(n.tag));}
}
const all=n=>(n.children||[]).flatMap(c=>c instanceof Node?[c,...all(c)]:[]);
const h=(tag,props={},...children)=>{const n=new Node(tag,props,...children);for(const[k,v]of Object.entries(props))if(k.startsWith('on')&&v)n.addEventListener(k.slice(2).toLowerCase(),v);return n;};
const mount=(n,...c)=>{n.children=[];n.append(...c);return n;};
const text=n=>typeof n==='string'?n:(n.children||[]).map(text).join('');
const tick=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
const fire=async(n,type='click',extra={})=>{for(const fn of n.listeners[type]||[])await fn({preventDefault(){},...extra});await tick();};
const button=(label,p={})=>h('button',p,label),find=(n,t)=>all(n).find(x=>x.tag==='button'&&text(x)===t);
(async()=>{
 const values=new Map(),timers=new Map(),listeners=new Map();let seq=0,requests=[],gate=null,route=[],fail=null;
 const window={location:{hash:'#/problems/1000/edit'},localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},setTimeout(fn){const id=++seq;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),addEventListener:(n,fn)=>listeners.set(n,fn)};
 let problem={id:1000,revision:1,title:'Original',source_url:'https://example.test/a',description:'正文 $a_i$\n',reference_solution:'解法',reference_code:'int main(){}',analysis:null};
 const store={state:{userId:'teacher'}};
 const api={problem:async()=>structuredClone(problem),updateProblem:async(id,body)=>{requests.push({id,body});if(gate)return gate.promise;if(fail)throw fail;problem={...problem,...body,revision:problem.revision+1};return structuredClone(problem);}};
 const stubs={
 '../api.js':{api},'../dom.js':{h,mount},'../store.js':{store},'../router.js':{navigate:p=>route.push(p)},
 '../problemStatement.js':{statementHost:(body,title)=>h('article',{},title,body)},
 '../codeCopy.js':{attachCodeCopy(){}},
 '../components.js':{button,card:(p,...c)=>h('section',{},p.title,p.actions,...c),field:(label,input)=>h('label',{},label,input),errorBox:e=>h('aside',{},e.message),notice:s=>h('p',{},s),toast(){}},
 };
 const context=vm.createContext({window,URL,Blob,structuredClone});const drafts=new vm.SourceTextModule(fs.readFileSync('app/static/js/drafts.js','utf8'),{context});await drafts.link(()=>{});
 const mod=new vm.SourceTextModule(fs.readFileSync('app/static/js/views/problemEdit.js','utf8'),{context});await mod.link(spec=>{if(spec==='../drafts.js')return drafts;const exports=stubs[spec];assert.ok(exports,'unexpected '+spec);return new vm.SyntheticModule(Object.keys(exports),function(){for(const[k,v]of Object.entries(exports))this.setExport(k,v);},{context});});await mod.evaluate();
 const render=()=>mod.namespace.default.render({problemId:1000});
 let view=await render(),form=all(view).find(n=>n.tag==='form'),inputs=form.querySelectorAll('input, textarea');
 assert.equal(inputs.length,5);assert.equal(inputs[0].value,'Original');assert.equal(inputs[2].value,problem.description);
 inputs[0].value='New title';inputs[2].value='Changed $b^2$';await fire(form,'input');
 window.location.hash='#/problems/1000';listeners.get('hashchange')();window.location.hash='#/problems/1000/edit';
 view=await render();form=all(view).find(n=>n.tag==='form');inputs=form.querySelectorAll('input, textarea');
 assert.equal(inputs[0].value,'New title');assert.equal(inputs[2].value,'Changed $b^2$');
 let release,reject;gate={promise:new Promise((a,b)=>{release=a;reject=b;})};
 const pending=fire(form,'submit');await tick();await fire(form,'submit');
 assert.equal(requests.length,1,'duplicate save must be blocked');assert.equal(requests[0].body.expected_revision,1);assert.ok(inputs.every(n=>n.disabled));
 reject(Object.assign(new Error('版本冲突'),{status:409}));await pending;gate=null;
 assert.equal(inputs[0].value,'New title');assert.ok(find(view,'加载最新版本'));assert.ok(!inputs[0].disabled);
 await fire(form,'submit');assert.equal(problem.title,'New title');assert.equal(problem.description,'Changed $b^2$');
 inputs[2].value='Next edit';await fire(form,'input');await fire(form,'submit');
 assert.equal(requests.at(-1).body.expected_revision,2,'saving again uses returned revision');
 inputs[0].value='Slow save';await fire(form,'input');gate={promise:new Promise(a=>release=a)};
 const slow=fire(form,'submit');await tick();
 window.location.hash='#/problems/1000';listeners.get('hashchange')();window.location.hash='#/problems/1000/edit';
 const newer=await render(),newForm=all(newer).find(n=>n.tag==='form'),newInputs=newForm.querySelectorAll('input, textarea');
 newInputs[0].value='Later draft';await fire(newForm,'input');listeners.get('pagehide')();
 const stored=[...values.values()];release({...problem,title:'Slow save',revision:4});await slow;
 assert.deepEqual([...values.values()],stored,'late response must not erase newer draft');assert.equal(newInputs[0].value,'Later draft');assert.deepEqual(route,[],'late save must not navigate');
 console.log('PASS edit fields, draft restore, conflicts, duplicate save, revisions and late response');
})().catch(e=>{console.error(e);process.exitCode=1;});
