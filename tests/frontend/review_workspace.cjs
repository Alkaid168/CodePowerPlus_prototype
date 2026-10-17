const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Node {
 constructor(tag,props={},...children){this.tag=tag;this.children=[];this.listeners={};this.disabled=false;this.value='';this.hidden=false;this.isConnected=true;Object.assign(this,props);this.classList={add(){},toggle(){}};this.append(...children);if(tag==='textarea')this.value=text(this);if(tag==='select')this.value=(this.children.find(c=>c.selected)||this.children[0])?.value||'';}
 append(...children){this.children.push(...children.flat(Infinity).filter(c=>c!==null&&c!==undefined&&c!==false));}
 addEventListener(name,fn){this.listeners[name]=fn;}
 setAttribute(k,v){this[k]=v;}
 focus(){}
 querySelectorAll(selector){const tags=selector.split(',').map(s=>s.trim());return all(this).filter(n=>tags.includes(n.tag));}
 get textContent(){return text(this);} set textContent(v){this.children=[String(v)];}
}
const all=n=>(n.children||[]).flatMap(c=>c instanceof Node?[c,...all(c)]:[]);
const text=n=>(n.children||[]).map(c=>c instanceof Node?text(c):String(c)).join('');
const h=(tag,props={},...children)=>{const n=new Node(tag,props,...children);for(const[k,v]of Object.entries(props))if(k.startsWith('on'))n.addEventListener(k.slice(2).toLowerCase(),v);return n;};
const mount=(n,...children)=>{n.children=[];n.append(...children);return n;};
const button=(label,props={})=>h('button',props,label);
const tick=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const click=async(n)=>{assert.ok(n,'missing control');assert.ok(!n.disabled,'disabled control');return n.listeners.click?.({currentTarget:n,preventDefault(){}});};
const find=(n,label)=>all(n).find(c=>c.tag==='button'&&text(c)===label);
const analysis={analysis_id:7,review_status:'pending',is_stale:false,primary_knowledge_ids:['basic.prefix-sum'],secondary_knowledge_ids:[],evidence:{'basic.prefix-sum':'range queries'},knowledge_confidence:{'basic.prefix-sum':.8},difficulty:1200,difficulty_band:'基础',difficulty_reason:'基础区间查询',solution_idea:'求前缀和',confidence:.9,taxonomy_version:'test'};
const problem={id:1000,title:'测试题',description:'题面',reference_solution:'参考题解',reference_code:'code',source_url:'',analysis};
(async()=>{
 let problemCalls=0,queueCalls=[],bodies=[],gate=null,editorGate=null,current=structuredClone(problem);
 const api={problem:async()=>{problemCalls++;return current;},reviewQueue:status=>{queueCalls.push(status);return gate?gate.promise:Promise.resolve({items:[current]});},reviewProblem:(id,body)=>{bodies.push(body);return gate?gate.promise:Promise.resolve({analysis:{...current.analysis,review_status:body.action==='approve'?'approved':'rejected'},problem:{...current}});},reviewHistory:async()=>({items:[]})};
 const editor=()=>({node:h('div',{},h('input',{value:'edited evidence'})),read:()=>({primary_knowledge_ids:['basic.prefix-sum'],secondary_knowledge_ids:[],evidence:{'basic.prefix-sum':'edited evidence'},knowledge_confidence:{'basic.prefix-sum':.8}})});
 const store={ensureKnowledge:async()=>[{id:'basic.prefix-sum',name:'前缀和',level:2}],state:{knowledge:[{id:'basic.prefix-sum',name:'前缀和',level:2}],knowledgeVersion:'test',userId:'teacher'}};
 const stubs={
 '../api.js':{api},'../dom.js':{h,mount},'../store.js':{store},'../router.js':{navigate(){}},
 '../icons.js':{icon:()=>h('svg')},'../search.js':{normalizeSearch:v=>String(v).toLowerCase()},
 '../problemFilters.js':{pageNumbers:(n,total)=>Array.from({length:total},(_,i)=>i+1)},
 '../problemStatement.js':{statementHost:()=>h('article')},'../markdown.js':{mountMarkdown(){}},'../codeCopy.js':{attachCodeCopy(){}},
 '../tagEditor.js':{createTagEditor:async()=>editorGate?editorGate.promise:editor()},
 '../components.js':{button,card:(p,...c)=>h('section',{},p.actions,...c),table:(headers,rows)=>h('table',{},rows),tag:l=>h('span',{},l),difficultyTag:()=>h('span'),statusBadge:s=>h('span',{},s),emptyState:l=>h('p',{},l),loading:()=>h('p',{},'loading'),errorBox:(e,retry)=>h('aside',{},e.message,retry?button('重试',{onClick:retry}):null),field:(l,c)=>h('div',{},l,c),formatDate:v=>v,notice:l=>h('p',{},l),sourceLink:()=>null,toast(){}},
 };
 const context=vm.createContext({document:{activeElement:null},structuredClone});const cache=new Map();
 async function moduleAt(path){if(cache.has(path))return cache.get(path);const m=new vm.SourceTextModule(fs.readFileSync(path,'utf8'),{context});cache.set(path,m);await m.link(async spec=>{if(spec==='./reviewDetail.js')return moduleAt('app/static/js/views/reviewDetail.js');const data=stubs[spec];assert.ok(data,`Unexpected dependency ${spec}`);return new vm.SyntheticModule(Object.keys(data),function(){for(const[k,v]of Object.entries(data))this.setExport(k,v);},{context});});return m;}
 const m=await moduleAt('app/static/js/views/reviews.js');await m.evaluate();const render=param=>m.namespace.default.render({param});
 const scenario=process.argv[2];
 if(scenario==='detail'){
  let w=await render('1000');assert.equal(problemCalls,1,'direct review URL must fetch only the selected problem');assert.equal(queueCalls.length,0);assert.ok(find(w,'通过'));assert.ok(!text(w).includes('成为知识证据'));
  current={...current,analysis:{...analysis,is_stale:true}};w=await render('1000');assert.ok(!find(w,'通过'),'stale analysis cannot be approved');
  current={...current,analysis:{...analysis,review_status:'approved',is_stale:false}};w=await render('1000');assert.ok(!find(w,'通过'),'already reviewed is read-only');
 }else if(scenario==='syntax-rating'){
  current={...current,analysis:{...analysis,difficulty:100,difficulty_band:'输出入门'}};
  const w=await render('1000');await click(find(w,'修改标注'));await tick();
  const difficulty=all(w).find(n=>n.tag==='select'&&n['aria-label']==='纠正难度');
  assert.equal(difficulty.children[0].value,'100','syntax rating must be selectable');
  assert.equal(difficulty.children.at(-1).value,'3500');
  assert.equal(difficulty.children.length,35);assert.equal(difficulty.value,'100');
  await click(find(w,'保存并通过'));assert.equal(bodies.at(-1).correction.difficulty,100);
 }else if(scenario==='queue'){
  const slow=deferred();gate=slow;const w=await render('');await tick();assert.equal(problemCalls,0);assert.ok(!find(w,'通过'),'queue must not contain review forms');
  gate=null;await click(find(w,'已通过'));await tick();const before=text(w);slow.resolve({items:[{...current,title:'OLD_PENDING'}]});await tick();assert.equal(text(w),before,'old status response must not overwrite selected status');
  assert.ok(all(w).some(n=>n.tag==='a'&&n.href==='#/reviews/1000'),'dedicated review link');
  gate=deferred();await click(find(w,'待审核'));const search=all(w).find(n=>n['aria-label']==='搜索审核题目');search.value='测试';search.listeners.input();assert.ok(!text(w).includes('测试题'),'search while switching status must not repaint old cached items');gate.reject(new Error('queue failure'));await tick();search.value='new query';search.listeners.input();assert.ok(find(w,'重试'),'search must retain failed request retry');
 }else{
  let w=await render('1000');const slow=deferred();gate=slow;const pending=click(find(w,'通过'));assert.equal(bodies.length,1);assert.ok(find(w,'驳回').disabled);slow.reject(new Error('conflict'));await pending;assert.ok(!find(w,'通过').disabled);assert.ok(text(w).includes('conflict'));
  gate=null;await click(find(w,'修改标注'));await tick();const reject=find(w,'驳回');await click(reject);assert.equal(bodies.at(-1).action,'reject');assert.ok(!bodies.at(-1).correction,'reject must never send draft correction');
  current=structuredClone(problem);w=await render('1000');await click(find(w,'修改标注'));await tick();await click(find(w,'保存并通过'));assert.equal(bodies.at(-1).expected_analysis_id,7);assert.equal(bodies.at(-1).correction.evidence['basic.prefix-sum'],'edited evidence');assert.ok(!find(w,'保存并通过'),'successful review becomes read-only');
  current=structuredClone(problem);w=await render('1000');editorGate=deferred();const opening=click(find(w,'修改标注'));const count=bodies.length;assert.ok(find(w,'通过').disabled);editorGate.resolve(editor());await opening;assert.equal(bodies.length,count,'opening editor cannot submit');
 }
 console.log(`PASS ${scenario}`);
})().catch(e=>{console.error(e);process.exitCode=1;});
