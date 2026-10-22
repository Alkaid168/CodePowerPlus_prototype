/** Serialized by chrome.scripting: keep all helpers inside this function. */
export async function pageAgent(input) {
  let diagnostic=null;
  const domains = {codeforces:'codeforces.com',luogu:'www.luogu.com.cn',atcoder:'atcoder.jp',vjudge:'vjudge.net'};
  const fail = (code) => { throw new Error(code); };
  const html = (text) => new DOMParser().parseFromString(text,'text/html');
  const context = (doc) => { try { return JSON.parse(doc.querySelector('#lentille-context')?.textContent || 'null'); } catch { fail('schema_changed'); } };
  const equal = (a,b) => input.platform === 'luogu' ? String(a)===String(b) : String(a).toLowerCase()===String(b).toLowerCase();
  const numeric = (value) => value == null || value==='' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  const seconds = (v) => { const n=numeric(v); if(n===null || n<=0)fail('schema_changed');return new Date(n*1000).toISOString(); };
  const owner = (name) => { if(!equal(name,input.account))fail('owner_mismatch'); };
  const baseItem = (id,problem,time,language,verdict,extra={}) => {
    // Luogu uses the valid numeric verdict 0 for Waiting.
    const validVerdict=(typeof verdict==='string'&&verdict.length>0)||(typeof verdict==='number'&&Number.isFinite(verdict));
    if(id==null || !problem || !validVerdict)fail('schema_changed');
    return {submission_id:String(id),problem_key:String(problem),submitted_at:time,language:String(language??'unknown'),
      verdict:String(verdict),score:null,time_ms:null,memory_bytes:null,source_state:'not_requested',source_code:null,source_hash:null,...extra};
  };
  const identify = () => {
    let account;
    if(input.platform==='luogu')account=context(document)?.user?.uid;
    else if(input.platform==='vjudge'&&document.querySelector('#userNameDropdown')){
      const dropdown=document.querySelector('#userNameDropdown');
      const profile=dropdown.parentElement?.querySelector('.user-dropdown a[data-i18n="top.nav.profile"][href^="/user/"]');
      account=profile?.getAttribute('href')?.split('/')[2];
      if(account&&!equal(dropdown.textContent.trim(),account))fail('owner_mismatch');
    }
    else {
      const selectors={codeforces:'#header a[href^="/profile/"]',atcoder:'#navbar-collapse a[href^="/users/"], .navbar a[href^="/users/"]',vjudge:'#nav-user a[href^="/user/"]'};
      const a=document.querySelector(selectors[input.platform]);
      account=a?.getAttribute('href')?.split('/')[2];
    }
    if(!account || !/^[A-Za-z0-9_.-]{1,100}$/.test(String(account)))fail('login_required');
    return String(account);
  };
  const request = async(path,{method='GET',form}={}) => {
    // Never accept a caller-supplied absolute destination or navigate the tab.
    if(!path.startsWith('/') || path.startsWith('//'))fail('invalid_operation');
    const opts={method,credentials:'same-origin',redirect:'follow',signal:AbortSignal.timeout(25000)};
    if(form){opts.body=new URLSearchParams(form);opts.headers={'Content-Type':'application/x-www-form-urlencoded'};}
    const response=await fetch(path,opts);
    diagnostic={action:input.action,path:new URL(path,location.origin).pathname,status:response.status};
    const text=await response.text();
    if(response.status===401 || /\/(login|enter)(\?|$)/.test(new URL(response.url,location.origin).pathname))fail('login_required');
    if(response.status===429)fail('rate_limited');
    if(/<title[^>]*>\s*(Just a moment|Attention Required)/i.test(text) || /cf-chl-|challenge-platform/.test(text))fail('challenge');
    if(response.status===403)fail('access_denied');
    if(!response.ok)fail('http_'+response.status);
    if(/<input[^>]+type=["']password/i.test(text))fail('login_required');
    return text;
  };
  const json = (text) => {try{return JSON.parse(text);}catch{fail('schema_changed');}};
  const codeResult = (code) => typeof code==='string' ? {source_state:'available',source_code:code} : {source_state:'unavailable',source_code:null};
  try {
    if(!domains[input.platform] || location.hostname!==domains[input.platform])fail('wrong_site');
    const current=identify();
    if(input.action==='identify')return {account:current,platform:input.platform};
    if(!input.account || !equal(current,input.account))fail('owner_mismatch');
    const c=input.cursor||{};
    if(input.action==='source') {
      const item=input.item;
      if(!item || !/^\d+$/.test(item.submission_id))fail('invalid_operation');
      if(input.platform==='codeforces') {
        const contest=item.problem_key.split('/')[0];if(!/^\d+$/.test(contest))fail('unsupported_problem');
        const path=Number(contest)>=100000 ? '/gym/' : '/contest/';
        const doc=html(await request(path+contest+'/submission/'+item.submission_id));
        const code=doc.querySelector('#program-source-text');
        if(!code)fail('source_unavailable');return codeResult(code.textContent);
      }
      if(input.platform==='luogu') {
        const obj=context(html(await request('/record/'+item.submission_id)));
        const r=obj?.data?.record;if(!r)fail('schema_changed');
        owner(r.user?.uid ?? r.uid);
        return codeResult(r.sourceCode??r.code);
      }
      if(input.platform==='atcoder') {
        const contest=item.problem_key.split('/')[0];if(!/^[A-Za-z0-9_-]+$/.test(contest))fail('invalid_operation');
        const doc=html(await request('/contests/'+contest+'/submissions/'+item.submission_id+'?lang=en'));
        const who=doc.querySelector('a[href="/users/'+input.account+'"]');if(!who)fail('owner_mismatch');
        const code=doc.querySelector('#submission-code');if(!code)fail('source_unavailable');return codeResult(code.textContent);
      }
      const obj=json(await request('/solution/data/'+item.submission_id,{method:'POST',form:{}}));
      if(obj.error)fail(obj.error.i18nKey?.includes('crawler')?'challenge':'source_unavailable');
      owner(obj.author);if(String(obj.runId)!==item.submission_id)fail('schema_changed');
      if(typeof obj.code==='string')return codeResult(obj.code);
      return {source_state:obj.codeImgUrl?'image_only':'private',source_code:null};
    }
    if(input.platform==='codeforces' && input.action==='list') {
      const offset=Number(c.offset||1);if(!Number.isSafeInteger(offset)||offset<1)fail('invalid_operation');
      const obj=json(await request('/api/user.status?handle='+encodeURIComponent(input.account)+'&from='+offset+'&count=100'));
      if(obj.status!=='OK')fail(obj.comment?.includes('limit')?'rate_limited':'api_failed');
      if(!Array.isArray(obj.result))fail('schema_changed');
      const items=obj.result.map(r=>{if(!r.author?.members?.some(m=>equal(m.handle,input.account)))fail('owner_mismatch');
        return baseItem(r.id,r.problem?.contestId+'/'+r.problem?.index,seconds(r.creationTimeSeconds),r.programmingLanguage,r.verdict||'PENDING',
          {score:numeric(r.points),time_ms:numeric(r.timeConsumedMillis),memory_bytes:numeric(r.memoryConsumedBytes)});});
      return {items,next:{offset:offset+obj.result.length},done:obj.result.length===0};
    }
    if(input.platform==='luogu' && input.action==='list') {
      const page=Number(c.page||1);if(!Number.isSafeInteger(page)||page<1)fail('invalid_operation');
      const obj=context(html(await request('/record/list?user='+encodeURIComponent(input.account)+'&page='+page)));
      const records=obj?.data?.records;
      if(!records || !Array.isArray(records.result) || numeric(records.count)===null)fail('schema_changed');
      const rows=records.result;
      if(!rows.length && page===1 && records.count>0)fail('schema_changed');
      const items=rows.map(r=>{owner(r.user?.uid);return baseItem(r.id,r.problem?.pid,seconds(r.submitTime),r.language,r.status,
        {score:numeric(r.score),time_ms:numeric(r.time),memory_bytes:numeric(r.memory)===null?null:Number(r.memory)*1024});});
      // Do not assume records.perPage is present; stop after a confirmed empty page.
      return {items,next:{page:page+1},done:records.count===0 || (numeric(records.perPage)>0 && page*records.perPage>=records.count) || rows.length===0};
    }
    if(input.platform==='vjudge' && input.action==='list') {
      const offset=Number(c.offset||0);if(!Number.isSafeInteger(offset)||offset<0)fail('invalid_operation');
      const obj=json(await request('/status/data?draw=1&start='+offset+'&length=20&un='+encodeURIComponent(input.account)));
      if(obj.error)fail('api_failed');if(!Array.isArray(obj.data))fail('schema_changed');
      const items=obj.data.map(r=>{owner(r.userName);return baseItem(r.runId,r.oj+'/'+r.probNum,seconds(Number(r.time)/1000),r.language,r.status,
        {time_ms:numeric(r.runtime),memory_bytes:numeric(r.memory)===null?null:Number(r.memory)*1024});});
      return {items,next:{offset:offset+obj.data.length},done:obj.data.length===0};
    }
    fail('invalid_operation');
  } catch(error) {
    return {error:['TimeoutError','AbortError'].includes(error.name)?'network_timeout':error.message?.match(/^[a-z0-9_]+$/)?error.message:'network_error',diagnostic};
  }
}
