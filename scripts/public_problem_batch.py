"""显式运行公开真题分析／评估／导入，失败可续跑，不自动审核。"""
from __future__ import annotations

import argparse
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
from app.knowledge import Taxonomy
from app.public_problem_batch import evaluate_batch, import_batch, predict_batch, read_predictions, validate_items


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(path)


def write_report(folder, report):
    write_json(folder / 'report.json', report)
    names = report.get('knowledge_names', {})
    def labels(ids):
        return '、'.join(names.get(node_id, node_id) for node_id in ids) or '—'
    lines = ['# 公开真题辅助评估', '',
             f"完成 {report['completed']} / {report['requested']} 题；词表 {report['taxonomy_version']}；模型 {report['model_name']}；提示词 {report['prompt_version']}。", '',
             '**标签参考来源：代理独立辅助核对，未经教师审核。以下指标不代表真实教学准确率。**', '',
             '| 来源 | 完成 | 标签 micro F1 | 官方 CF 评分 MAE | 代理估计评分 MAE |',
             '| --- | ---: | ---: | ---: | ---: |']
    for platform, values in report['platforms'].items():
        official, estimated = values['official_rating']['mae'], values['estimated_reference_rating']['mae']
        lines.append(f"| {platform} | {values['completed']} | {values['classification']['micro']['f1']:.3f} | {round(official, 1) if official is not None else '不适用'} | {round(estimated, 1) if estimated is not None else '暂无'} |")
    lines += ['', '## 来源与局限', ''] + ['- ' + limitation for limitation in report['limitations']]
    if report.get('validation_repair_notes'):
        repair = report['validation_repair_notes']
        lines += ['', f"- {repair['source_id']} 在常规重试后仍有父子标签冲突；追加 {repair['extra_attempts']} 次同一 v5 提示词校验修复调用，修复对话包含模型自己被拒的响应，不含辅助参考或官方评分。该题采用了额外修复步骤，不能把最终 40/40 视为首轮成功率。"]
    lines += ['', '- 洛谷 P1001 使用官方样例，其余 19 题使用明确注明来源并经独立算法检查的自编样例，不能称为官方样例。']
    lines += ['', '## 逐题差异', '', '| 题目 | 来源 | 模型分 | 官方 CF 分 | 缺少标签 | 多出标签 |', '| --- | --- | ---: | ---: | --- | --- |']
    for row in report['rows']:
        lines.append(f"| [{row['source_id']}]({row['source_url']}) | {row['source_platform']} | {row['predicted_rating']} | {row['official_rating'] if row['official_rating'] is not None else '—'} | {labels(row['missing_labels'])} | {labels(row['extra_labels'])} |")
    lines += ['', '逐题题面、样例来源和辅助参考见 manifest.json；真实模型输出及断点见 predictions.json；导入编号见 import.json。', '']
    (folder / 'report.md').write_text('\n'.join(lines), encoding='utf-8')


def backup_database(path):
    path = Path(path).resolve()
    if not path.is_file():
        raise ValueError('formal database must exist before import')
    backup_dir = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'CodePowerPlus' / 'backups'
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / f"before-public40-{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}.sqlite3"
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as source, sqlite3.connect(target) as destination:
        source.backup(destination)
        if destination.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('backup integrity check failed')
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', type=Path, nargs='+', default=[ROOT / 'data/evaluation/public40/luogu.json', ROOT / 'data/evaluation/public40/codeforces.json'])
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'data/evaluation/public40/run-2026-10-05')
    parser.add_argument('--analyze', action='store_true', help='显式授权调用当前配置模型；沿用有效断点')
    parser.add_argument('--import-db', action='store_true', help='全部预测完成后备份并导入配置数据库；不审核')
    args = parser.parse_args()
    settings = load_settings()
    taxonomy = Taxonomy(settings.taxonomy_path)
    items = []
    for path in args.sources:
        data = json.loads(path.read_text(encoding='utf-8'))
        if data.get('provenance') != 'public_problem_rewritten':
            raise ValueError('source collection provenance required')
        items.extend(data['items'])
    validate_items(items, taxonomy, {'luogu': 20, 'codeforces': 20})
    folder = args.output_dir
    folder.mkdir(parents=True, exist_ok=True)
    manifest = {'version': 'public40-v1', 'provenance': 'public_problem_rewritten', 'items': items}
    # 首次预测前冻结辅助参考，后续不得修改参考来迎合输出。
    if (folder / 'manifest.json').exists():
        if json.loads((folder / 'manifest.json').read_text(encoding='utf-8')) != manifest:
            raise ValueError('frozen manifest differs; use a new output directory')
    else:
        write_json(folder / 'manifest.json', manifest)
    checkpoint_path = folder / 'predictions.json'
    checkpoint = json.loads(checkpoint_path.read_text(encoding='utf-8')) if checkpoint_path.exists() else {}
    if args.analyze:
        if not settings.model_configured:
            raise ValueError('model environment is not configured')
        predictions = predict_batch(items, taxonomy, settings, checkpoint, lambda state: write_json(checkpoint_path, state),
                                    progress=lambda i, n, source, state: print(f'{i}/{n} {source} {state}', flush=True))
    else:
        # 默认只读已有真实预测，不自动调用模型或创建合成预测。
        predictions = read_predictions(items, taxonomy, settings, checkpoint)
    report = evaluate_batch(items, predictions)
    report.update(taxonomy_version=taxonomy.version, model_name=checkpoint.get('model_name', settings.model),
                  prompt_version=checkpoint.get('prompt_version', ''), created_at=datetime.now(timezone.utc).isoformat())
    report['knowledge_names'] = {node_id: node['name'] for node_id, node in taxonomy.nodes.items()}
    if checkpoint.get('validation_repair_notes'):
        report['validation_repair_notes'] = checkpoint['validation_repair_notes']
    write_report(folder, report)
    if args.import_db:
        if report['missing']:
            raise ValueError('missing predictions; formal database untouched')
        backup = backup_database(settings.db_path)
        container = Container.build(settings)
        try:
            imported = import_batch(container, items, predictions)
        finally:
            container.close()
        write_json(folder / 'import.json', {'backup_path': str(backup), 'items': imported})
        print(f'Imported: {len(imported)}; newly created: {sum(x["created"] for x in imported)}; pending review.', flush=True)
    print(f'Report: {folder / "report.md"}', flush=True)
    return 0 if not report['missing'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
