// One authorized cell edit. Preserve Excel-native features that the artifact
// exporter cannot round-trip by transferring only the authored numeric value.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = process.cwd();
const out = path.join(root, 'output/v8-blind-form');
const input = path.join(out, 'v8首测-人工难度评测.xlsx');
const req = createRequire(path.join(out, '_bundled_dependencies.cjs'));
const { FileBlob, SpreadsheetFile } = await import(pathToFileURL(req.resolve('@oai/artifact-tool')).href);
const book = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
const sheet = book.worksheets.getItem('人工难度');
const before = sheet.getRange('A5:C24').values;
if (before[16][0] !== 'B17' || before[16][1] !== 'https://codeforces.com/problemset/problem/25/D' || before[16][2] !== 1900) throw new Error('Expected original CF25D=1900 at C21');
const preview = await book.render({ sheetName: '人工难度', range: 'A20:C22', scale: 1.5, format: 'png' });
await fs.writeFile(path.join(out, 'r1-before.png'), new Uint8Array(await preview.arrayBuffer()));
if (process.argv.includes('--inspect-only')) process.exit(0);
sheet.getRange('C21').values = [[1500]];
book.recalculate();
const after = sheet.getRange('A5:C24').values;
if (after.some((row,i) => row.some((value,j) => value !== (i===16 && j===2 ? 1500 : before[i][j])))) throw new Error('Unexpected cell changes');
const staged = path.join(os.tmpdir(), 'codepowerplus-v8-human-r1-authored.xlsx');
await (await SpreadsheetFile.exportXlsx(book)).save(staged);
const python = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const patch = String.raw`
import sys,json,re,zipfile,hashlib,os,xml.etree.ElementTree as E
sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
p=json.load(sys.stdin);ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(p['authored']) as z:
 sheet=E.fromstring(z.read('xl/worksheets/sheet1.xml'))
 assert sheet.find('.//m:c[@r="C21"]/m:v',ns).text=='1500'
with zipfile.ZipFile(p['original']) as z:
 entries=[(i,z.read(i.filename)) for i in z.infolist()]
data=dict((i.filename,b) for i,b in entries)
name='xl/worksheets/sheet1.xml';raw=data[name]
match=re.search(rb'<c\b[^>]*\br="C21"[^>]*>.*?</c>',raw,re.S)
assert match is not None
old=match.group();assert b'<v>1900</v>' in old
new=old.replace(b'<v>1900</v>',b'<v>1500</v>');assert old!=new
updated=raw[:match.start()]+new+raw[match.end():]
temporary=p['original']+'.r1.tmp'
with zipfile.ZipFile(temporary,'w') as z:
 for i,b in entries:z.writestr(i,updated if i.filename==name else b)
with zipfile.ZipFile(temporary) as z:
 assert z.testzip() is None
 assert z.namelist()==list(data)
 assert all(z.read(n)==v for n,v in data.items() if n!=name)
 assert z.read(name).replace(new,old,1)==raw
os.replace(temporary,p['original'])
print(json.dumps({'changed_cell':'人工难度!C21','old':1900,'new':1500,'all_other_zip_payloads_unchanged':True}))
`;
const result = spawnSync(python, ['-c', patch], { input: JSON.stringify({ original: input, authored: staged }), encoding: 'utf8', windowsHide: true });
if (result.status !== 0) throw new Error(result.stderr);
const reopened = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
const revised = reopened.worksheets.getItem('人工难度').getRange('A5:C24').values;
if (JSON.stringify(revised)!==JSON.stringify(after)) throw new Error('Saved values do not match authored edit');
const rendered = await reopened.render({ sheetName:'人工难度', range:'A20:C22', scale:1.5, format:'png' });
await fs.writeFile(path.join(out, 'r1-after.png'),new Uint8Array(await rendered.arrayBuffer()));
console.log(result.stdout.trim());
