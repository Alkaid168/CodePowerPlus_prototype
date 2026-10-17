#!/usr/bin/env node
/** Create the reviewed v8 20×4 comparison with bundled Artifact Tool.
 * Run the spreadsheet operation marker once before first authoring in a session.
 * --qa-fixture writes only explicitly named synthetic fixture artifacts.
 * The small OOXML compatibility patch adds only used dimensions and URL links.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repo, 'output', 'v8-second-test');
const runKeys = ['first', 'second_1', 'second_2', 'second_3'];
const runLabels = ['首测', '二测第1次', '二测第2次', '二测第3次'];
const groupLabels = { regression9: '回归9题', new11: '新增11题' };
const mainHeader = ['匿名编号', '题目名称', '原始链接', '人工分', '首测', '二测第1次', '二测第2次', '二测第3次', '标签与题解均正确次数（代理复核）'];
const detailHeader = ['匿名编号', '题目名称', '分组', '测试轮次', '人工分', '模型分', '标签正确', '题解正确', '标签与题解均正确', '分差', '绝对分差', '代理复核依据', '数据定位'];

function options() {
  const args = process.argv.slice(2), opt = { input: path.join(repo, 'data/evaluation/v8-second-test/results.json'), output: path.join(outputRoot, 'v8二测-四次对比与代理复核.xlsx') };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') { console.log('Usage: node scripts/build_v8_second_test_table.mjs [--input results.json] [--output output/v8-second-test/result.xlsx] [--validate-only] [--qa-fixture]'); process.exit(0); }
    if (args[i] === '--validate-only') opt.validateOnly = true;
    else if (args[i] === '--qa-fixture') opt.fixture = true;
    else if (['--input', '--output'].includes(args[i]) && args[i + 1]) opt[args[i++].slice(2)] = args[i];
    else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
  }
  if (opt.fixture) opt.output = path.join(outputRoot, 'qa-fixture', 'SYNTHETIC-QA-only.xlsx');
  opt.input = path.resolve(opt.input); opt.output = path.resolve(opt.output);
  const rel = path.relative(outputRoot, opt.output);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !opt.output.endsWith('.xlsx')) throw new Error('Output must be XLSX inside output/v8-second-test/.');
  if (!opt.fixture && /qa-fixture|synthetic/i.test(rel)) throw new Error('Real and synthetic outputs must stay separate.');
  return opt;
}

function must(condition, message) { if (!condition) throw new Error(message); }
function nonempty(value) { return typeof value === 'string' && value.trim().length > 0; }
function score(value) { return Number.isInteger(value) && value >= 100 && value <= 3500 && value % 100 === 0; }
function excelText(value) { return /^[=+@]/.test(value) ? `'${value}` : value; }

export function validateResults(data, fixture = false) {
  must(data && data.schema_version === 1, 'schema_version must be 1.');
  must(data.status === (fixture ? 'synthetic_fixture' : 'reviewed'), 'All 80 results must be reviewed before final export.');
  must(data.human_revision === 'r1', 'human_revision must be r1 (CF25D=1500).');
  must(nonempty(data.reviewed_by) && nonempty(data.reviewed_at), 'Reviewer and reviewed_at are required.');
  must(Array.isArray(data.problems) && data.problems.length === 20, 'Exactly 20 reviewed problems are required.');
  const seenUrls = new Set(), counts = { regression9: 0, new11: 0 };
  return data.problems.map((problem, index) => {
    const id = `B${String(index + 1).padStart(2, '0')}`;
    must(problem.anonymous_id === id, `Expected stable ID ${id} in source order.`);
    must(nonempty(problem.title) && nonempty(problem.url), `${id}: title and original URL are required.`);
    const url = new URL(problem.url);
    must(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !seenUrls.has(problem.url), `${id}: invalid or duplicate URL.`);
    seenUrls.add(problem.url);
    must(Object.hasOwn(counts, problem.group), `${id}: group must be regression9/new11.`); counts[problem.group]++;
    must(score(problem.human_rating), `${id}: human_rating must be a valid typed score.`);
    if (/codeforces\.com\/(?:contest\/25\/problem\/D|problemset\/problem\/25\/D)/i.test(problem.url)) must(problem.human_rating === 1500, `${id}: CF25D human rating must be 1500.`);
    let runs = problem.runs;
    if (Array.isArray(runs)) {
      must(runs.length === 4 && new Set(runs.map(r => r.run_id)).size === 4, `${id}: exactly four unique runs are required.`);
      runs = Object.fromEntries(runs.map(r => [r.run_id, r]));
    }
    must(runs && Object.keys(runs).sort().join(',') === [...runKeys].sort().join(','), `${id}: missing or unexpected run.`);
    for (const key of runKeys) {
      const r = runs[key];
      must(r && score(r.rating), `${id}/${key}: missing or invalid model rating.`);
      for (const field of ['tags_correct', 'solution_correct', 'joint_correct']) must(typeof r[field] === 'boolean', `${id}/${key}: ${field} must be a true JSON boolean after review.`);
      must(r.joint_correct === (r.tags_correct && r.solution_correct), `${id}/${key}: joint_correct must equal tags_correct && solution_correct.`);
      must(nonempty(r.evidence) && r.evidence.trim().length >= 12, `${id}/${key}: concrete visible review evidence is required.`);
      must(nonempty(r.source_ref), `${id}/${key}: source_ref is required.`);
    }
    if (index === 19) must(counts.regression9 === 9 && counts.new11 === 11, 'Group sizes must be regression9=9, new11=11.');
    return { ...problem, runs };
  });
}

function makeFixture() {
  return { schema_version: 1, status: 'synthetic_fixture', human_revision: 'r1', reviewed_by: 'SYNTHETIC QA', reviewed_at: '2026-10-17T00:00:00Z', problems: Array.from({ length: 20 }, (_, i) => ({
    anonymous_id: `B${String(i + 1).padStart(2, '0')}`, title: `合成测试题 ${i + 1}`, url: `https://example.invalid/synthetic/${i + 1}`, group: i < 9 ? 'regression9' : 'new11', human_rating: 1000 + i % 5 * 100,
    runs: Object.fromEntries(runKeys.map((key, j) => { const joint = j < i % 5; return [key, { rating: 1000 + i % 5 * 100 + (j - 1) * 100, tags_correct: joint || j % 2 === 0, solution_correct: joint, joint_correct: joint, evidence: '合成 QA 数据，仅验证布尔值、计数、公式与排版，不代表任何真实题目或模型结论。', source_ref: `SYNTHETIC-QA/${i + 1}/${key}` }]; }))
  })) };
}

function verifyFixtureRejections(data) {
  const mutations = {
    incomplete_review: d => { d.status = 'pending'; },
    missing_run: d => { delete d.problems[0].runs.second_3; },
    string_boolean: d => { d.problems[0].runs.first.tags_correct = 'true'; },
    inconsistent_joint: d => { d.problems[0].runs.first.joint_correct = true; },
    missing_evidence: d => { d.problems[0].runs.first.evidence = ''; },
    missing_source: d => { d.problems[0].runs.first.source_ref = ''; },
    wrong_human_revision: d => { d.human_revision = 'r0'; },
    outdated_cf25d_score: d => { d.problems[0].url = 'https://codeforces.com/problemset/problem/25/D'; d.problems[0].human_rating = 1900; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const copy = structuredClone(data); mutate(copy); let rejected = false;
    try { validateResults(copy, true); } catch { rejected = true; }
    must(rejected, `Validator did not reject QA mutation: ${name}`);
  }
  return Object.keys(mutations);
}

const patchAndAudit = String.raw`
import json,sys,zipfile,xml.etree.ElementTree as E,os
sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8')
p=json.load(sys.stdin); m='http://schemas.openxmlformats.org/spreadsheetml/2006/main'; r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'; pkg='http://schemas.openxmlformats.org/package/2006/relationships'; ns={'m':m}
E.register_namespace('x',m);E.register_namespace('r',r)
with zipfile.ZipFile(p['file']) as z: entries=[(x,z.read(x.filename)) for x in z.infolist()]
files={x.filename:b for x,b in entries}; wb=E.fromstring(files['xl/workbook.xml']); sheets=wb.findall('m:sheets/m:sheet',ns)
assert len(sheets)==2 and all(x.get('state','visible')=='visible' for x in sheets)
assert [x.get('name') for x in sheets]==['四次对比','审核明细']
shfiles=sorted(x for x in files if x.startswith('xl/worksheets/') and x.endswith('.xml') and '/_rels/' not in x)
assert len(shfiles)==2
replacement={}; linksfile=None
for index,name in enumerate(shfiles):
 sh=E.fromstring(files[name]); dim=sh.find('m:dimension',ns)
 if dim is None:
  dim=E.Element('{'+m+'}dimension');sh.insert(1 if len(sh) and sh[0].tag=='{'+m+'}sheetPr' else 0,dim)
 dim.set('ref','A1:I31' if index==0 else 'A1:M84')
 if index==0:
  assert sh.find('m:hyperlinks',ns) is None
  links=E.Element('{'+m+'}hyperlinks');rels=E.Element('Relationships',{'xmlns':pkg})
  for row,item in enumerate(p['problems'],12):
   rid='rIdOriginal'+str(row);E.SubElement(links,'{'+m+'}hyperlink',{'ref':'C'+str(row),'{'+r+'}id':rid});E.SubElement(rels,'Relationship',{'Id':rid,'Type':r+'/hyperlink','Target':item['url'],'TargetMode':'External'})
  before=next((i for i,c in enumerate(sh) if c.tag in ('{'+m+'}printOptions','{'+m+'}pageMargins','{'+m+'}pageSetup')),len(sh));sh.insert(before,links)
  linksfile=name.rsplit('/',1)[0]+'/_rels/'+name.rsplit('/',1)[1]+'.rels';assert linksfile not in files
  replacement[linksfile]=E.tostring(rels,encoding='utf-8',xml_declaration=True)
 replacement[name]=E.tostring(sh,encoding='utf-8',xml_declaration=True)
temp=p['file']+'.compat.tmp'
with zipfile.ZipFile(temp,'w',compression=zipfile.ZIP_DEFLATED) as z:
 for info,b in entries:z.writestr(info,replacement.get(info.filename,b))
 z.writestr(linksfile,replacement[linksfile])
os.replace(temp,p['file'])
with zipfile.ZipFile(p['file']) as z:
 assert z.testzip() is None
 shared=[]
 if 'xl/sharedStrings.xml' in z.namelist():shared=[''.join(x.itertext()) for x in E.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',ns)]
 def cells(name):return {c.get('r'):c for c in E.fromstring(z.read(name)).findall('.//m:sheetData/m:row/m:c',ns)}
 def value(c):
  v=c.find('m:v',ns)
  if c.get('t')=='s':return shared[int(v.text)]
  if c.get('t')=='inlineStr':return ''.join(c.find('m:is',ns).itertext())
  return None if v is None else v.text
 main=cells(shfiles[0]);detail=cells(shfiles[1])
 for row,item in enumerate(p['problems'],12):
  assert value(main['A'+str(row)])==item['anonymous_id']
  for col,expected in zip('DEFGH',[item['human_rating']]+[item['runs'][k]['rating'] for k in p['keys']]):assert float(value(main[col+str(row)]))==expected
  c=main['I'+str(row)];assert c.get('t','n')=='n' and float(value(c))==sum(item['runs'][k]['joint_correct'] for k in p['keys'])
 for i,item in enumerate(p['problems']):
  for j,key in enumerate(p['keys']):
   row=5+i*4+j;run=item['runs'][key]
   for col,field in [('G','tags_correct'),('H','solution_correct'),('I','joint_correct')]:
    c=detail[col+str(row)];assert c.get('t')=='b' and value(c)==str(int(run[field])),(row,col,c.attrib,value(c))
   assert value(detail['L'+str(row)])==run['evidence']
   assert value(detail['M'+str(row)])==run['source_ref']
 for name in shfiles:
  sh=E.fromstring(z.read(name));assert not any(x.get('hidden') in ('1','true') for x in sh.findall('.//m:row',ns)+sh.findall('.//m:col',ns))
  assert sh.find('m:sheetViews/m:sheetView/m:pane',ns) is not None
 forbidden=('xl/externalLinks/','xl/embeddings/','customXml/','xl/comments','xl/threadedComments')
 assert not any(n.startswith(forbidden) for n in z.namelist())
 links=E.fromstring(z.read(shfiles[0])).findall('m:hyperlinks/m:hyperlink',ns);assert len(links)==20
 targets={x.get('Id'):x.get('Target') for x in E.fromstring(z.read(linksfile))}
 assert {x.get('ref'):targets[x.get('{'+r+'}id')] for x in links}=={'C'+str(i+12):item['url'] for i,item in enumerate(p['problems'])}
 print(json.dumps({'zip_valid':True,'visible_sheets':2,'main_rows':20,'review_rows':80,'joint_count_numeric_integer_0_to_4':True,'review_columns_native_boolean':True,'original_url_hyperlinks':20,'no_hidden_rows_columns':True,'frozen_panes':True,'only_dimensions_and_hyperlinks_patched':True}))
`;

async function main() {
  const opt = options();
  const inputBytes = opt.fixture ? Buffer.from(JSON.stringify(makeFixture())) : await fs.readFile(opt.input);
  const data = JSON.parse(inputBytes.toString('utf8').replace(/^\uFEFF/, '')), problems = validateResults(data, opt.fixture);
  const qaRejectedCases = opt.fixture ? verifyFixtureRejections(data) : undefined;
  if (opt.validateOnly) { console.log(JSON.stringify({ valid: true, problems: 20, reviewed_runs: 80 })); return; }
  const dependencies = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies');
  const modules = path.join(dependencies, 'node/node_modules'), python = path.join(dependencies, 'python/python.exe');
  await fs.access(modules); await fs.mkdir(path.dirname(opt.output), { recursive: true });
  if (opt.fixture) await fs.writeFile(path.join(path.dirname(opt.output), 'SYNTHETIC-QA-only.input.json'), inputBytes);
  const junction = path.join(outputRoot, 'node_modules');
  try { await fs.lstat(junction); } catch (e) { if (e.code !== 'ENOENT') throw e; await fs.symlink(modules, junction, 'junction'); }
  must((await fs.realpath(junction)).toLowerCase() === (await fs.realpath(modules)).toLowerCase(), 'Dependency junction must point to bundled runtime.');
  const bundled = createRequire(path.join(outputRoot, '_bundled.cjs'));
  const { Workbook, SpreadsheetFile, FileBlob } = await import(pathToFileURL(bundled.resolve('@oai/artifact-tool')).href);
  const workbook = Workbook.create(), mainSheet = workbook.worksheets.add('四次对比'), detail = workbook.worksheets.add('审核明细');
  for (const [sheet, used] of [[mainSheet, 'A1:I31'], [detail, 'A1:M84']]) {
    sheet.showGridLines = false; sheet.getRange(used).format = { font: { name: 'Arial', size: 11, color: '#242424' }, verticalAlignment: 'center', rowHeight: 30 };
    sheet.tabColor = sheet === mainSheet ? '#333333' : '#A0A0A0';
  }
  const headerStyle = { fill: '#333333', font: { name: 'Arial', size: 11, bold: true, color: '#FFFFFF' }, horizontalAlignment: 'center', verticalAlignment: 'center', wrapText: true, rowHeight: 44 };
  const sizes = [12, 32, 63, 11, 11, 12, 12, 12, 30];
  sizes.forEach((w, i) => mainSheet.getRange(`${String.fromCharCode(65 + i)}1:${String.fromCharCode(65 + i)}31`).format.columnWidth = w);
  mainSheet.getRange('A2').values = [[opt.fixture ? '合成 QA 数据：不用于实际结论' : 'v8 二测：20题四次对比']];
  mainSheet.getRange('A2').format.font = { name: 'Arial', size: 16, bold: true, color: '#242424' };
  mainSheet.getRange('A3').values = [['人工分采用修订1（CF25D=1500）。次数仅统计标签与题解同时正确，与评分分差分别判断；代理复核不是教师金标准。']];
  mainSheet.getRange('A3:I3').format.font = { name: 'Arial', size: 10, color: '#666666' };
  mainSheet.getRange('A5:I5').values = [['评分误差分组', '题数', '首测 MAE', '二测1 MAE', '二测2 MAE', '二测3 MAE', '二测合并 MAE', '联合正确次数合计', '四次复核样本量']];
  mainSheet.getRange('A5:I5').format = headerStyle;
  mainSheet.getRange('A6:B8').values = [['全部20题', 20], ['回归9题', 9], ['新增11题', 11]];
  mainSheet.getRange('C6:G8').setNumberFormat('0.0');
  for (let i = 0; i < 3; i++) {
    const r = 6 + i, group = i === 0 ? null : i === 1 ? '回归9题' : '新增11题';
    const criteria = group ? `,'审核明细'!$C$5:$C$84,A${r}` : '';
    mainSheet.getRange(`C${r}:F${r}`).formulas = [runLabels.map(label => `=AVERAGEIFS('审核明细'!$K$5:$K$84,'审核明细'!$D$5:$D$84,"${label}"${criteria})`)];
    mainSheet.getRange(`G${r}`).formulas = [[`=AVERAGEIFS('审核明细'!$K$5:$K$84,'审核明细'!$D$5:$D$84,"<>首测"${criteria})`]];
    const countRefs = problems.flatMap((p, index) => !group || groupLabels[p.group] === group ? [`I${index + 12}`] : []);
    mainSheet.getRange(`H${r}`).formulas = [[`=SUM(${countRefs.join(',')})`]];
    mainSheet.getRange(`I${r}`).formulas = [[`=B${r}*4`]];
  }
  mainSheet.getRange('A10').values = [['MAE为平均绝对分差。颜色仅提示单次评分与人工分相差超过200分；不代表标签或题解正确。']];
  mainSheet.getRange('A10:I10').format.font = { name: 'Arial', size: 10, color: '#666666' };
  mainSheet.getRange('A11:I11').values = [mainHeader]; mainSheet.getRange('A11:I11').format = headerStyle;
  mainSheet.getRange('A12:I31').values = problems.map(p => [p.anonymous_id, excelText(p.title), p.url, p.human_rating, ...runKeys.map(k => p.runs[k].rating), null]);
  mainSheet.getRange('D12:I31').setNumberFormat('0'); mainSheet.getRange('D12:I31').format.horizontalAlignment = 'right';
  mainSheet.getRange('C12:C31').format.font = { name: 'Arial', size: 11, color: '#454545', underline: 'single' };
  mainSheet.getRange('B12:C31').format.wrapText = true;
  mainSheet.getRange('A12:I31').format.rowHeight = 38;
  mainSheet.getRange('I12:I31').formulas = problems.map((p, i) => [`=SUM(${runKeys.map((_, j) => `IF('审核明细'!I${5 + i * 4 + j},1,0)`).join(',')})`]);
  mainSheet.getRange('E12:H31').conditionalFormats.addCustom('ABS(E12-$D12)>200', { fill: '#F5E8E6', font: { color: '#873E34' } });
  mainSheet.freezePanes.freezeRows(11); mainSheet.freezePanes.freezeColumns(2);
  detail.getRange('A2').values = [[opt.fixture ? '合成 QA 审核数据' : '80次代理复核明细']];
  detail.getRange('A2').format.font = { name: 'Arial', size: 16, bold: true, color: '#242424' };
  detail.getRange('A3').values = [['TRUE/FALSE为原生布尔值；“均正确”=AND(标签正确,题解正确)。分差=模型−人工，绝对分差用于主表MAE。']];
  detail.getRange('A3:M3').format.font = { name: 'Arial', size: 10, color: '#666666' };
  detail.getRange('A4:M4').values = [detailHeader]; detail.getRange('A4:M4').format = headerStyle;
  [12, 30, 13, 14, 11, 11, 13, 13, 21, 11, 12, 110, 76].forEach((w, i) => detail.getRange(`${String.fromCharCode(65 + i)}1:${String.fromCharCode(65 + i)}84`).format.columnWidth = w);
  const rows = problems.flatMap(p => runKeys.map((key, j) => { const r = p.runs[key]; return [p.anonymous_id, excelText(p.title), groupLabels[p.group], runLabels[j], p.human_rating, r.rating, r.tags_correct, r.solution_correct, null, null, null, excelText(r.evidence), excelText(r.source_ref)]; }));
  detail.getRange('A5:M84').values = rows;
  detail.getRange('I5:K84').formulas = rows.map((_, i) => [`=AND(G${i + 5},H${i + 5})`, `=F${i + 5}-E${i + 5}`, `=ABS(J${i + 5})`]);
  detail.getRange('E5:F84').setNumberFormat('0'); detail.getRange('J5:K84').setNumberFormat('0');
  detail.getRange('G5:I84').format.horizontalAlignment = 'center';
  detail.getRange('L5:M84').format.wrapText = true; detail.getRange('L5:M84').format.verticalAlignment = 'top';
  rows.forEach((r, i) => { const lines = Math.max(Math.ceil([...r[11]].reduce((s, c) => s + (c.charCodeAt(0) > 255 ? 2 : 1), 0) / 105), Math.ceil(r[12].length / 70)); detail.getRange(`A${i + 5}:M${i + 5}`).format.rowHeight = Math.max(44, (lines + 1) * 16); });
  detail.getRange('I5:I84').conditionalFormats.addCustom('I5=FALSE', { fill: '#F2F2F2', font: { bold: true, color: '#444444' } });
  detail.freezePanes.freezeRows(4); detail.freezePanes.freezeColumns(2);
  workbook.recalculate();
  const initialJoint = problems[0].runs.first.joint_correct;
  const beforeCount = mainSheet.getRange('I12').values[0][0];
  const savedBooleans = detail.getRange('G5:H5').values;
  detail.getRange('G5:H5').values = [[!initialJoint, true]];
  must(mainSheet.getRange('I12').values[0][0] === beforeCount + (initialJoint ? -1 : 1), 'Changing review inputs did not recalculate joint counts.');
  detail.getRange('G5:H5').values = savedBooleans;
  workbook.recalculate();
  const independent = problems.map(p => runKeys.filter(k => p.runs[k].joint_correct).length);
  const actualCounts = mainSheet.getRange('I12:I31').values.map(r => r[0]);
  must(actualCounts.every((n, i) => Number.isInteger(n) && n === independent[i]), `Calculated joint counts differ from independent JS totals: ${JSON.stringify(actualCounts)}`);
  for (let i = 0; i < 3; i++) {
    const ps = problems.filter(p => i === 0 || p.group === (i === 1 ? 'regression9' : 'new11'));
    const expected = runKeys.map(k => ps.reduce((s, p) => s + Math.abs(p.runs[k].rating - p.human_rating), 0) / ps.length);
    const actual = mainSheet.getRange(`C${6 + i}:F${6 + i}`).values[0];
    must(actual.every((n, j) => typeof n === 'number' && Math.abs(n - expected[j]) < 1e-8), 'Calculated grouped MAE differs from independent JS.');
  }
  const inspection = await workbook.inspect({ kind: 'table', range: "'四次对比'!A5:I8", include: 'values,formulas', tableMaxRows: 4, tableMaxCols: 9, maxChars: 2500 });
  const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 30 }, maxChars: 2000 });
  const stem = opt.output.replace(/\.xlsx$/, '');
  for (const [name, sheetName, range] of [['main', '四次对比', 'A1:I31'], ['detail', '审核明细', 'A1:M12']]) {
    const rendered = await workbook.render({ sheetName, range, scale: 1.2, format: 'png' });
    await fs.writeFile(`${stem}.${name}.png`, new Uint8Array(await rendered.arrayBuffer()));
  }
  await (await SpreadsheetFile.exportXlsx(workbook)).save(opt.output);
  const patched = spawnSync(python, ['-c', patchAndAudit], { input: JSON.stringify({ file: opt.output, problems, keys: runKeys }), encoding: 'utf8', windowsHide: true });
  must(!patched.error && patched.status === 0, `XLSX compatibility/audit failed: ${patched.error?.message ?? patched.stderr}`);
  const reopened = await SpreadsheetFile.importXlsx(await FileBlob.load(opt.output));
  must(JSON.stringify(reopened.worksheets.getItem('四次对比').getRange('D12:I31').values) === JSON.stringify(mainSheet.getRange('D12:I31').values), 'Roundtrip score/count mismatch.');
  const report = { ...JSON.parse(patched.stdout), synthetic_fixture: Boolean(opt.fixture), input_sha256: createHash('sha256').update(inputBytes).digest('hex'), human_revision: data.human_revision, grouped_mae_independently_verified: true, review_boolean_change_recalculates_count: true, qa_rejected_cases: qaRejectedCases, counts: independent, roundtrip_scores_counts_equal: true, inspection: inspection.ndjson, error_scan: errors.ndjson, native_application_validation: 'Not performed; Artifact Tool render/import and ZIP/XML checks performed.' };
  await fs.writeFile(`${stem}.audit.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output: opt.output, synthetic_fixture: Boolean(opt.fixture), counts: independent, audit: `${stem}.audit.json` }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exitCode = 1; });
