"""显式重评当前题库；冻结输入、断点续跑、备份后原子追加待审核分析。"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.config import load_settings
from app.container import Container
from app.reassessment import apply_results, check_context, freeze, predict
from app.services.analysis import PROMPT_VERSION


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(path)


def backup(path):
    folder = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'CodePowerPlus/backups'
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f'before-reassess-{PROMPT_VERSION}-{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}.sqlite3'
    with sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True) as source, sqlite3.connect(target) as dest:
        source.backup(dest)
        if dest.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('backup integrity failed')
    return target


def write_report(folder, report, checkpoint, taxonomy):
    write_json(folder / 'report.json', report)
    failed_attempts = sum(attempt.get('status') == 'failed' for row in checkpoint.get('items', {}).values()
                          for attempt in row.get('previous_attempts', []))
    scope = '尚未审核题目' if report.get('selection') == 'unreviewed' else '全题库'
    lines = [f'# {scope}模型重评（2026-10-17）', '',
             f"完成 {report['completed']}/{report['requested']} 题；模型 `{report['model_name']}`；"
             f"提示词 `{report['prompt_version']}`；词表 `{report['taxonomy_version']}`。", '',
             f'保留断点；已恢复的失败运行 {failed_attempts} 次。有效缓存不重复调用模型。', '',
             '本次是模型重评，不是以人工金标准进行准确率评测。全部新增分析待人工审核；原分析与审核记录保留。', '',
             '## 新评分分布', '', '| 评分 | 题数 |', '| ---: | ---: |']
    lines += [f'| {rating} | {count} |' for rating, count in sorted(report['rating_distribution'].items(), key=lambda row: int(row[0]))]
    lines += ['', '## 逐题变化', '', '| 题号 | 题目 | 原评分 | 新评分 | 核心标签 |', '| --- | --- | ---: | ---: | --- |']
    for row in report['rows']:
        after = row['after']
        names = '、'.join(taxonomy.get(node_id)['name'] for node_id in after['primary_knowledge_ids']) if after else '未完成'
        title = row['title'].replace('|', '\\|')
        before_rating = (row['before'] or {}).get('difficulty', '—')
        lines.append(f"| #{row['problem_id']} | {title} | {before_rating} | {after['difficulty'] if after else '—'} | {names} |")
    lines += ['', '## 范围与后续审核', ''] + ['- ' + line for line in report['limitations']]
    lines += ['', '冻结输入见 manifest.json，真实模型输出与重试记录见 predictions.json，追加编号见 applied.json。',
              '具体人工复核疑点另见 review-notes.md，不改变原始模型预测。', '']
    (folder / 'report.md').write_text('\n'.join(lines), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=ROOT / f'data/evaluation/reassess-2026-10-17-{PROMPT_VERSION.rsplit("-", 1)[-1]}')
    parser.add_argument('--unreviewed-only', action='store_true', help='只重评从未有审核记录且当前待审或无分析的题目')
    parser.add_argument('--analyze', action='store_true')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    settings = load_settings()
    container = Container.build(settings)
    try:
        folder = args.output_dir
        path = folder / 'manifest.json'
        if path.exists():
            manifest = json.loads(path.read_text(encoding='utf-8'))
            check_context(manifest, container.taxonomy, settings)
            if (manifest.get('selection', 'all') == 'unreviewed') != args.unreviewed_only:
                raise ValueError('frozen selection differs; use a new run directory')
        else:
            manifest = freeze(container, unreviewed_only=args.unreviewed_only)
            write_json(path, manifest)
        checkpoint_path = folder / 'predictions.json'
        checkpoint = json.loads(checkpoint_path.read_text(encoding='utf-8')) if checkpoint_path.exists() else {}
        if args.analyze and not settings.model_configured:
            raise ValueError('model environment missing')
        def unavailable(*a, **kw):
            raise ValueError('prediction absent; run with --analyze')
        kwargs = {} if args.analyze else {'analyzer': unavailable}
        results = predict(manifest, container.taxonomy, settings, checkpoint,
                          lambda state: write_json(checkpoint_path, state),
                          progress=lambda pid, status, done, total: print(f'#{pid} {status} ({done}/{total})', flush=True), **kwargs)
        report = {key: value for key, value in manifest.items() if key != 'items'}
        report.update(requested=len(manifest['items']), completed=len(results),
                      rating_distribution=dict(Counter(str(p['difficulty']) for p in results.values())),
                      limitations=['本次为真实模型重评，没有人工金标准，不能当作准确率评估；全部新增分析待人工审核。',
                                   '旧分析与审核保留；旧公开40题实验输入输出未覆盖；本次使用当前含LaTeX题面。'])
        report['rows'] = [{'problem_id': item['id'], 'title': item['title'], 'before': item['before'],
                           'after': results.get(str(item['id']))} for item in manifest['items']]
        write_report(folder, report, checkpoint, container.taxonomy)
        if args.apply:
            if len(results) != len(manifest['items']):
                raise ValueError('predictions incomplete; no database writes applied')
            target = backup(settings.db_path)
            print(f'Backup verified: {target}', flush=True)
            receipt = apply_results(container, manifest, results)
            write_json(folder / 'applied.json', receipt)
            print(f'Applied {len(receipt)} pending analyses', flush=True)
        print(f'Completed {len(results)}/{len(manifest["items"])}', flush=True)
    finally:
        container.close()


if __name__ == '__main__':
    main()
