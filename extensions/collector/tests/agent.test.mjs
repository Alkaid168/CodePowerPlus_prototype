import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {pageAgent} from '../src/page-agent.js';
function page(html,url){const {document,DOMParser}=parseHTML(html);globalThis.document=document;globalThis.DOMParser=DOMParser;globalThis.location=new URL(url);}
function response(body,url='https://codeforces.com/api/user.status',status=200){globalThis.fetch=async()=>({ok:status===200,status,url,headers:{get:()=> 'application/json'},text:async()=>typeof body==='string'?body:JSON.stringify(body)});}
test('CF returns own metadata, timestamp, absent metrics and source separately',async()=>{
 page('<div id="header"><a href="/profile/alice">alice</a></div>','https://codeforces.com/');
 assert.equal((await pageAgent({platform:'codeforces',action:'identify'})).account,'alice');
 response({status:'OK',result:[{id:11,creationTimeSeconds:1700000000,problem:{contestId:1,index:'A'},author:{members:[{handle:'alice'}]},verdict:'OK',programmingLanguage:'C++',memoryConsumedBytes:1024,timeConsumedMillis:2}]});
 const result=await pageAgent({platform:'codeforces',action:'list',account:'alice',cursor:{offset:1}});
 assert.equal(result.items[0].memory_bytes,1024);assert.equal(result.items[0].submission_id,'11');
 response('<pre id="program-source-text">int main(){return 0;}</pre>','https://codeforces.com/contest/1/submission/11');
 const source=await pageAgent({platform:'codeforces',action:'source',account:'alice',item:result.items[0]});
 assert.equal(source.source_code,'int main(){return 0;}');
});
test('rejects a different owner, a challenge, and a login redirect',async()=>{
 page('<div id="header"><a href="/profile/alice">alice</a></div>','https://codeforces.com/');
 response({status:'OK',result:[{id:1,author:{members:[{handle:'bob'}]}}]});
 assert.equal((await pageAgent({platform:'codeforces',action:'list',account:'alice',cursor:{offset:1}})).error,'owner_mismatch');
 response('<title>Just a moment...</title>');
 assert.equal((await pageAgent({platform:'codeforces',action:'list',account:'alice',cursor:{offset:1}})).error,'challenge');
 response('<form><input type="password"></form>','https://codeforces.com/enter');
 assert.equal((await pageAgent({platform:'codeforces',action:'list',account:'alice',cursor:{offset:1}})).error,'login_required');
});
test('plain 403 is not called a challenge; failure contains only safe request metadata',async()=>{
 page('<div id="header"><a href="/profile/alice">alice</a></div>','https://codeforces.com/');
 const input={platform:'codeforces',action:'source',account:'alice',item:{submission_id:'11',problem_key:'1/A'}};
 response('<html><title>Forbidden</title><body>private response must not be recorded</body></html>','https://codeforces.com/contest/1/submission/11?secret=hidden',403);
 const denied=await pageAgent(input);
 assert.equal(denied.error,'access_denied');
 assert.deepEqual(denied.diagnostic,{action:'source',path:'/contest/1/submission/11',status:403});
 assert.equal(JSON.stringify(denied).includes('hidden'),false);
 assert.equal(JSON.stringify(denied).includes('private response'),false);
 response('<title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/test"></script>','https://codeforces.com/contest/1/submission/11',403);
 const challenged=await pageAgent(input);
 assert.equal(challenged.error,'challenge');
 assert.equal(challenged.diagnostic.status,403);
});
test('Luogu structured context uses UID and pagination count, unknown layout fails',async()=>{
 const context={user:{uid:7},data:{}};
 page('<script id="lentille-context" type="application/json">'+JSON.stringify(context)+'</script>','https://www.luogu.com.cn/');
 assert.equal((await pageAgent({platform:'luogu',action:'identify'})).account,'7');
 response('<script id="lentille-context" type="application/json">'+JSON.stringify({data:{records:{count:1,perPage:20,result:[{id:55,user:{uid:7},problem:{pid:'P1001'},submitTime:1700000000,status:12,language:1,time:10,memory:64}]}}})+'</script>','https://www.luogu.com.cn/record/list');
 const result=await pageAgent({platform:'luogu',action:'list',account:'7',cursor:{page:1}});
 assert.equal(result.items[0].problem_key,'P1001');assert.equal(result.items[0].memory_bytes,65536);assert.equal(result.done,true);
 response('<html>unexpected</html>','https://www.luogu.com.cn/record/list');
 assert.equal((await pageAgent({platform:'luogu',action:'list',account:'7',cursor:{page:1}})).error,'schema_changed');
});
test('Luogu Waiting status zero is retained and does not block the next list page',async()=>{
 page('<script id="lentille-context" type="application/json">{"user":{"uid":7}}</script>','https://www.luogu.com.cn/');
 response('<script id="lentille-context" type="application/json">'+JSON.stringify({data:{records:{count:680,perPage:20,result:[{id:55,user:{uid:7},problem:{pid:'P3808'},submitTime:1700000000,status:0,language:27,time:null,memory:null}]}}})+'</script>','https://www.luogu.com.cn/record/list');
 const result=await pageAgent({platform:'luogu',action:'list',account:'7',cursor:{page:33}});
 assert.equal(result.error,undefined);
 assert.equal(result.items.length,1);
 assert.equal(result.items[0].submission_id,'55');
 assert.equal(result.items[0].verdict,'0');
 assert.equal(result.items[0].time_ms,null);
 assert.equal(result.items[0].memory_bytes,null);
 assert.deepEqual(result.next,{page:34});
 assert.equal(result.done,false);
});
test('Luogu absent or malformed verdicts still stop collection rather than silently skipping a row',async()=>{
 page('<script id="lentille-context" type="application/json">{"user":{"uid":7}}</script>','https://www.luogu.com.cn/');
 for(const status of [undefined,null,'',false,{},[]]){
  response('<script id="lentille-context" type="application/json">'+JSON.stringify({data:{records:{count:1,perPage:20,result:[{id:55,user:{uid:7},problem:{pid:'P1001'},submitTime:1700000000,status,language:27}]}}})+'</script>','https://www.luogu.com.cn/record/list');
  const result=await pageAgent({platform:'luogu',action:'list',account:'7',cursor:{page:1}});
  assert.equal(result.error,'schema_changed',JSON.stringify(status));
  assert.deepEqual(result.diagnostic,{action:'list',path:'/record/list',status:200});
 }
});
test('AtCoder reads source directly from an indexed submission detail',async()=>{
 page('<div id="navbar-collapse"><a href="/users/alice">alice</a></div>','https://atcoder.jp/');
 response('<a href="/users/alice">alice</a><pre id="submission-code">print(1)</pre>','https://atcoder.jp/contests/abc100/submissions/99');
 const result=await pageAgent({platform:'atcoder',action:'source',account:'alice',item:{problem_key:'abc100/abc100_a',submission_id:'99'}});
 assert.equal(result.source_code,'print(1)');
});
test('VJudge filters owner and distinguishes image-only code',async()=>{
 page('<li id="nav-user"><a href="/user/alice">alice</a></li>','https://vjudge.net/');
 response({data:[{userName:'alice',runId:4,oj:'POJ',probNum:'1',time:1700000000000,language:'G++',status:'Accepted',runtime:3,memory:1024}],recordsTotal:9999999},'https://vjudge.net/status/data');
 const result=await pageAgent({platform:'vjudge',action:'list',account:'alice',cursor:{offset:0}});
 assert.equal(result.items[0].submission_id,'4');assert.equal(result.done,false);
 response({runId:4,author:'alice',codeImgUrl:'https://example.invalid/code.png'},'https://vjudge.net/solution/data/4');
 assert.equal((await pageAgent({platform:'vjudge',action:'source',account:'alice',item:result.items[0]})).source_state,'image_only');
});

test('VJudge current logged-in dropdown identifies its own profile, never a random user link',async()=>{
 page('<a href="/user/bob">bob</a><li class="top-nav-user-item"><a id="userNameDropdown">alice</a><div class="user-dropdown"><a data-i18n="top.nav.profile" href="/user/alice">个人信息</a></div></li>','https://vjudge.net/');
 assert.deepEqual(await pageAgent({platform:'vjudge',action:'identify'}),{account:'alice',platform:'vjudge'});
 page('<a href="/user/bob">bob</a><a href="/user/login">Login</a>','https://vjudge.net/');
 assert.equal((await pageAgent({platform:'vjudge',action:'identify'})).error,'login_required');
 page('<li><a id="userNameDropdown">alice</a><div class="user-dropdown"><a data-i18n="top.nav.profile" href="/user/bob">个人信息</a></div></li>','https://vjudge.net/');
 assert.equal((await pageAgent({platform:'vjudge',action:'identify'})).error,'owner_mismatch');
});

test('AtCoder no longer requests contest archives or per-contest submission lists',async()=>{
 page('<div id="navbar-collapse"><a href="/users/alice">alice</a></div>','https://atcoder.jp/');
 let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected network');};
 for(const action of ['contests','list']){
  const result=await pageAgent({platform:'atcoder',action,account:'alice',cursor:{contest:'asprocon9',page:1}});
  assert.equal(result.error,'invalid_operation');
 }
 assert.equal(calls,0);
});
