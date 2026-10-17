#!/usr/bin/env node
/**
 * Build the human-only v8 blind review form from a public, two-field manifest.
 * Workbook authoring uses bundled @oai/artifact-tool. Its public API has no
 * native hyperlink setter and its HYPERLINK engine reports "not implemented".
 * The authorized compatibility patch adds only native hyperlink elements and
 * their exact public-URL relationships. Python also performs ZIP/XML QA.
 * Run the spreadsheet skill's operation marker once before the first authoring
 * invocation for the delivery. The preparation session already ran that marker.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workDir = path.join(repo, 'output', 'v8-blind-form');
const instructions = '按项目标准，先独立评分；原站评级/题解尽量避开；全部填完后返回本文件';
const scaleNote = '人工难度填写 100–3500，且为 100 的整数倍。浅黄色单元格可填写或下拉选择。';
const headers = ['匿名 ID', '原始题目链接', '人工难度'];

function options() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node scripts/build_v8_blind_form.mjs --input <public_manifest.json> --output <output/v8-blind-form/form.xlsx> [--expected-count 20]');
    process.exit(0);
  }
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--input', '--output', '--expected-count'].includes(args[i]) || !args[i + 1]) throw new Error('Expected --input, --output, and optional --expected-count.');
    if (parsed[args[i]]) throw new Error(`Duplicate option: ${args[i]}`);
    parsed[args[i]] = args[i + 1];
  }
  if (!parsed['--input'] || !parsed['--output']) throw new Error('Both --input and --output are required.');
  const count = Number(parsed['--expected-count'] ?? 20);
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('--expected-count must be 1..20 (default 20; use a smaller number only for fixture QA).');
  const output = path.resolve(parsed['--output']);
  const relative = path.relative(workDir, output);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(output).toLowerCase() !== '.xlsx') throw new Error('Output must be an .xlsx within output/v8-blind-form/.');
  return { input: path.resolve(parsed['--input']), output, count };
}

function validateManifest(manifest, count) {
  if (!manifest || Array.isArray(manifest) || Object.keys(manifest).sort().join(',') !== 'items' || !Array.isArray(manifest.items)) throw new Error('Public manifest must contain only an items array.');
  if (manifest.items.length !== count) throw new Error(`Expected ${count} public items; received ${manifest.items.length}.`);
  const seenUrls = new Set();
  return manifest.items.map((item, index) => {
    if (!item || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'public_id,source_url') throw new Error(`Item ${index + 1} must contain only public_id and source_url.`);
    const expectedId = `B${String(index + 1).padStart(2, '0')}`;
    if (item.public_id !== expectedId) throw new Error(`Expected anonymous ID ${expectedId} at row ${index + 1}.`);
    if (typeof item.source_url !== 'string' || item.source_url.length > 500 || item.source_url.trim() !== item.source_url || /[\r\n\t]/.test(item.source_url)) throw new Error(`Invalid public URL at ${expectedId}.`);
    const url = new URL(item.source_url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(`URL at ${expectedId} must be a public HTTP(S) link.`);
    if (seenUrls.has(item.source_url)) throw new Error('Duplicate public source URL.');
    seenUrls.add(item.source_url);
    return { public_id: item.public_id, source_url: item.source_url };
  });
}

const hyperlinkPatch = String.raw`
import json, sys, zipfile, xml.etree.ElementTree as E, os
sys.stdin.reconfigure(encoding='utf-8')
p = json.load(sys.stdin)
main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
package = 'http://schemas.openxmlformats.org/package/2006/relationships'
E.register_namespace('x', main)
E.register_namespace('r', rel)
with zipfile.ZipFile(p['file']) as z:
    entries = [(info,z.read(info.filename)) for info in z.infolist()]
files = dict((info.filename,data) for info,data in entries)
sheetNames = [n for n in files if n.startswith('xl/worksheets/') and n.endswith('.xml') and '/_rels/' not in n]
assert len(sheetNames) == 1
sheetName = sheetNames[0]
relsName = sheetName.rsplit('/',1)[0]+'/_rels/'+sheetName.rsplit('/',1)[1]+'.rels'
assert relsName not in files, 'Unexpected pre-existing worksheet relationships'
sheet = E.fromstring(files[sheetName])
# Artifact Tool omits dimension; readers using read_only mode need an explicit
# used range to distinguish a complete 20-row form from an unsized worksheet.
dimension = sheet.find('{'+main+'}dimension')
if dimension is None:
    dimension = E.Element('{'+main+'}dimension')
    sheet.insert(1 if len(sheet) and sheet[0].tag == '{'+main+'}sheetPr' else 0, dimension)
dimension.set('ref', 'A1:C'+str(len(p['items'])+4))
assert sheet.find('{'+main+'}hyperlinks') is None
links = E.Element('{'+main+'}hyperlinks')
relationships = E.Element('Relationships', {'xmlns':package})
for row,item in enumerate(p['items'],5):
    rid = 'rIdBlindLink'+str(row-4)
    E.SubElement(links, '{'+main+'}hyperlink', {'ref':'B'+str(row), '{'+rel+'}id':rid})
    E.SubElement(relationships, 'Relationship', {'Id':rid,'Type':rel+'/hyperlink','Target':item['source_url'],'TargetMode':'External'})
before = next((i for i,child in enumerate(sheet) if child.tag == '{'+main+'}pageMargins'), len(sheet))
sheet.insert(before,links)
replacement = E.tostring(sheet,encoding='utf-8',xml_declaration=True)
relsBytes = E.tostring(relationships,encoding='utf-8',xml_declaration=True)
ct = E.fromstring(files['[Content_Types].xml'])
assert any(c.get('Extension') == 'rels' for c in ct), 'Missing relationship content type'
temp = p['file']+'.links.tmp'
with zipfile.ZipFile(temp,'w',compression=zipfile.ZIP_DEFLATED) as z:
    for info,data in entries: z.writestr(info,replacement if info.filename == sheetName else data)
    z.writestr(relsName,relsBytes)
os.replace(temp,p['file'])
`;

const zipAudit = String.raw`
import json, sys, zipfile, xml.etree.ElementTree as E
sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
p = json.load(sys.stdin)
ns = {'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
allowed = set(p['texts'])
with zipfile.ZipFile(p['file']) as z:
    assert z.testzip() is None, 'Corrupt ZIP entry'
    names = z.namelist()
    forbidden = ('customXml/', 'xl/externalLinks/', 'xl/embeddings/', 'xl/comments', 'xl/threadedComments', 'docProps/custom.xml')
    assert not any(n.startswith(forbidden) for n in names), 'Unexpected hidden metadata or external data'
    wb = E.fromstring(z.read('xl/workbook.xml'))
    sheets = wb.findall('m:sheets/m:sheet', ns)
    assert len(sheets) == 1 and sheets[0].get('state', 'visible') == 'visible', 'Expected one visible sheet'
    assert sheets[0].get('name') == '人工难度', 'Unexpected sheet name'
    assert wb.find('m:definedNames/m:definedName', ns) is None, 'Unexpected defined names'
    sheetfiles = [n for n in names if n.startswith('xl/worksheets/') and n.endswith('.xml') and '/_rels/' not in n]
    assert len(sheetfiles) == 1, 'Expected exactly one sheet XML'
    sh = E.fromstring(z.read(sheetfiles[0]))
    assert sh.find('m:sheetProtection', ns) is None, 'Unnecessary protection'
    assert not any(x.get('hidden') in ('1','true') for x in sh.findall('.//m:row', ns) + sh.findall('.//m:col', ns)), 'Hidden rows or columns'
    shared = []
    if 'xl/sharedStrings.xml' in names:
        shared = [''.join(x.itertext()) for x in E.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', ns)]
        assert all(t in allowed for t in shared), 'Unexpected shared text'
    cells = {c.get('r'): c for c in sh.findall('.//m:sheetData/m:row/m:c', ns)}
    values, formulas = {}, {}
    for addr,c in cells.items():
        f = c.find('m:f', ns)
        if f is not None: formulas[addr] = f.text or ''
        v = c.find('m:v', ns)
        if c.get('t') == 's' and v is not None: text = shared[int(v.text)]
        elif c.get('t') == 'inlineStr': text = ''.join(c.find('m:is', ns).itertext())
        elif v is not None: text = v.text or ''
        else: text = ''
        if text: values[addr] = text
        if f is None and text: assert text in allowed, 'Unexpected nonpublic cell value at ' + addr
        assert addr[0] in 'ABC' and int(addr[1:]) <= len(p['items']) + 4, 'Content outside blind form'
    assert values.get('A1') == p['instructions'] and values.get('A2') == p['scaleNote'], 'Missing instructions'
    for col,title in zip('ABC', p['headers']): assert values.get(col+'4') == title, 'Wrong header'
    expected = {}
    for i,item in enumerate(p['items'], 5):
        assert values.get('A'+str(i)) == item['public_id'], 'Wrong anonymous ID'
        assert not values.get('C'+str(i)) and 'C'+str(i) not in formulas, 'Human score must be blank'
        expected['B'+str(i)] = item['source_url']
        assert values.get('B'+str(i)) == item['source_url'], 'URL cell must contain the exact public URL'
    assert not formulas, 'Blind form must have zero cell formulas'
    relns = {'r':'http://schemas.openxmlformats.org/package/2006/relationships'}
    reltype = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    sheetfile = sheetfiles[0]
    relfile = sheetfile.rsplit('/',1)[0]+'/_rels/'+sheetfile.rsplit('/',1)[1]+'.rels'
    rels = E.fromstring(z.read(relfile)).findall('r:Relationship', relns)
    assert len(rels) == len(expected), 'Unexpected worksheet relationships'
    targets = {}
    for r in rels:
        assert r.get('Type') == reltype+'/hyperlink' and r.get('TargetMode') == 'External', 'Non-hyperlink relationship'
        targets[r.get('Id')] = r.get('Target')
    links = sh.findall('m:hyperlinks/m:hyperlink', ns)
    actual = {h.get('ref'):targets[h.get('{'+reltype+'}id')] for h in links}
    assert len(links) == len(expected) and actual == expected, 'Hyperlinks must equal public URLs row by row'
    external = []
    for name in names:
        if name.endswith('.rels'):
            for r in E.fromstring(z.read(name)):
                if r.get('TargetMode') == 'External': external.append((r.get('Type'),r.get('Target')))
    assert sorted(external) == sorted((reltype+'/hyperlink',u) for u in expected.values()), 'Unexpected external relationships'
    validations = sh.findall('m:dataValidations/m:dataValidation', ns)
    assert len(validations) == 1, 'Expected one difficulty dropdown rule'
    dv = validations[0]
    assert dv.get('type') == 'list' and dv.get('sqref') == 'C5:C'+str(len(p['items'])+4), 'Wrong input validation range'
    assert dv.find('m:formula1', ns).text == '"'+','.join(str(x) for x in range(100,3501,100))+'"', 'Wrong rating choices'
    print(json.dumps({'zip_readable':True,'visible_sheets':1,'public_rows':len(p['items']),'human_scores_blank':True,'native_hyperlinks_equal_public_urls':True,'cell_formulas':0,'no_extra_external_relationships':True,'no_hidden_rows_or_columns':True,'no_extra_cell_data':True,'rating_options':35,'validation_attributes':dv.attrib}, ensure_ascii=False))
`;

async function main() {
  const opt = options();
  const items = validateManifest(JSON.parse(await fs.readFile(opt.input, 'utf8')), opt.count);
  const dependencies = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies');
  const modules = path.join(dependencies, 'node', 'node_modules');
  const python = path.join(dependencies, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python');
  await fs.access(modules).catch(() => { throw new Error('Bundled workspace dependencies are unavailable. Call load_workspace_dependencies; do not use repository packages.'); });
  await fs.mkdir(path.dirname(opt.output), { recursive: true });
  const junction = path.join(workDir, 'node_modules');
  try { await fs.lstat(junction); } catch (error) { if (error.code !== 'ENOENT') throw error; await fs.symlink(modules, junction, process.platform === 'win32' ? 'junction' : 'dir'); }
  if (path.resolve(await fs.realpath(junction)).toLowerCase() !== path.resolve(await fs.realpath(modules)).toLowerCase()) throw new Error('Output dependency junction must point to bundled runtime modules.');
  const requireBundled = createRequire(path.join(workDir, '_bundled_dependencies.cjs'));
  const { Workbook, SpreadsheetFile, FileBlob } = await import(pathToFileURL(requireBundled.resolve('@oai/artifact-tool')).href);
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add('人工难度');
  const lastRow = items.length + 4;
  sheet.showGridLines = false;
  const used = sheet.getRange(`A1:C${lastRow}`);
  used.format.font = { name: 'Arial', size: 11, color: '#202124' };
  used.format.verticalAlignment = 'center';
  used.format.rowHeight = 28;
  sheet.getRange('A:A').format.columnWidth = 14;
  const longestUrl = Math.max(...items.map(item => item.source_url.length));
  sheet.getRange('B:B').format.columnWidth = Math.min(115, Math.max(72, Math.ceil(longestUrl * 1.05)));
  sheet.getRange('C:C').format.columnWidth = 20;
  sheet.mergeCells('A1:C1');
  sheet.getRange('A1').values = [[instructions]];
  sheet.getRange('A1:C1').format.rowHeight = 34;
  sheet.getRange('A1:C1').format.font = { name: 'Arial', size: 11, color: '#202124', bold: true };
  sheet.mergeCells('A2:C2');
  sheet.getRange('A2').values = [[scaleNote]];
  sheet.getRange('A2:C2').format.rowHeight = 26;
  sheet.getRange('A2:C2').format.font = { name: 'Arial', size: 10, color: '#666666' };
  sheet.getRange('A3:C3').format.rowHeight = 8;
  sheet.getRange('A4:C4').values = [headers];
  sheet.getRange('A4:C4').format = { fill: '#30343B', font: { name: 'Arial', size: 11, color: '#FFFFFF', bold: true }, horizontalAlignment: 'center', verticalAlignment: 'center', rowHeight: 30 };
  sheet.getRange(`A5:C${lastRow}`).values = items.map(item => [item.public_id, null, null]);
  sheet.getRange(`A5:A${lastRow}`).format.horizontalAlignment = 'center';
  sheet.getRange(`B5:B${lastRow}`).values = items.map(item => [item.source_url]);
  sheet.getRange(`B5:B${lastRow}`).format.font = { name: 'Arial', size: 11, color: '#245B9E', underline: 'single' };
  sheet.getRange(`B5:B${lastRow}`).format.wrapText = true;
  sheet.getRange(`A5:C${lastRow}`).format.rowHeight = longestUrl > 110 ? 42 : 30;
  sheet.getRange(`C5:C${lastRow}`).format = { fill: '#FFF4CE', horizontalAlignment: 'right', numberFormat: '0', verticalAlignment: 'center' };
  sheet.getRange(`C5:C${lastRow}`).dataValidation = { rule: { type: 'list', values: Array.from({ length: 35 }, (_, index) => String((index + 1) * 100)) } };
  sheet.freezePanes.freezeRows(4);
  workbook.recalculate();
  const inspection = await workbook.inspect({ kind: 'table', range: `'人工难度'!A4:C${lastRow}`, include: 'values,formulas', tableMaxRows: 4, tableMaxCols: 3, maxChars: 1500 });
  const preview = await workbook.render({ sheetName: '人工难度', range: `A1:C${lastRow}`, scale: 1.5, format: 'png' });
  const previewPath = opt.output.replace(/\.xlsx$/i, '.preview.png');
  await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
  await (await SpreadsheetFile.exportXlsx(workbook)).save(opt.output);
  const patchResult = spawnSync(python, ['-c', hyperlinkPatch], { input: JSON.stringify({ file: opt.output, items }), encoding: 'utf8', windowsHide: true });
  if (patchResult.error || patchResult.status !== 0) throw new Error(`Native public hyperlink compatibility patch failed: ${patchResult.error?.message ?? patchResult.stderr}`);
  const reopened = await SpreadsheetFile.importXlsx(await FileBlob.load(opt.output));
  const actual = reopened.worksheets.getItem('人工难度').getRange(`A5:C${lastRow}`).values;
  if (actual.length !== items.length || actual.some((row, i) => row[0] !== items[i].public_id || (row[2] !== null && row[2] !== ''))) throw new Error('Round-trip import did not preserve anonymous IDs and blank rating cells.');
  const auditInput = { file: opt.output, instructions, scaleNote, headers, items, texts: [instructions, scaleNote, ...headers, ...items.flatMap(item => [item.public_id, item.source_url])] };
  const audit = spawnSync(python, ['-c', zipAudit], { input: JSON.stringify(auditInput), encoding: 'utf8', windowsHide: true });
  if (audit.error || audit.status !== 0) throw new Error(`Saved XLSX structure audit failed: ${audit.error?.message ?? audit.stderr}`);
  const report = { ...JSON.parse(audit.stdout), round_trip_import: true, render_completed: true, input_fields: ['public_id', 'source_url'], hyperlink_compatibility: 'Artifact Tool public API has no native hyperlink setter; HYPERLINK calculation is not implemented. Minimal OOXML patch adds only public URL hyperlinks and relationships.', inspection: inspection.ndjson };
  await fs.writeFile(opt.output.replace(/\.xlsx$/i, '.audit.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output: opt.output, preview: previewPath, checks: report }, null, 2));
}

main().catch(error => { console.error(`Blind form build failed: ${error.message}`); process.exitCode = 1; });
