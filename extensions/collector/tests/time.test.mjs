import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('submission display uses fixed UTC+8 across day/year boundaries and preserves input',async()=>{
 const {formatSubmissionTime}=await import('../src/time.js');
 const raw='2026-10-21T00:00:00.000Z';
 assert.equal(formatSubmissionTime(raw),'2026-10-21 08:00:00');
 assert.equal(raw,'2026-10-21T00:00:00.000Z');
 assert.equal(formatSubmissionTime('2026-12-31T20:30:45Z'),'2027-01-01 04:30:45');
 assert.equal(formatSubmissionTime('2026-10-21T10:00:00+09:00'),'2026-10-21 09:00:00');
 assert.equal(formatSubmissionTime('2026-10-21T09:00:00+08:00'),'2026-10-21 09:00:00');
 for(const bad of [null,undefined,'broken','2026-10-21T09:00:00'])assert.equal(formatSubmissionTime(bad),'—');
});

test('preview labels its timezone',async()=>{
 const html=await fs.readFile(new URL('../collector.html',import.meta.url),'utf8');
 assert.match(html,/<th>提交时间（UTC\+8）<\/th>/);
});
