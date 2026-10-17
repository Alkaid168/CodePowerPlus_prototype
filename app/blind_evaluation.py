"""隔离的难度盲评：公开输入不含预测，封存后禁止改写，完整人评后才能比较。"""
from __future__ import annotations

import hashlib
import json
import statistics


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
        separators=(',', ':'), allow_nan=False).encode('utf-8')).hexdigest()


def validate_public(public):
    if set(public) != {'items'} or len(public['items']) != 20:
        raise ValueError('公开清单必须只有20题items')
    urls = set()
    for i, row in enumerate(public['items'], 1):
        if set(row) != {'public_id', 'source_url'} or row['public_id'] != f'B{i:02}':
            raise ValueError('公开清单只能包含顺序匿名编号和链接')
        if not row['source_url'].startswith('https://') or row['source_url'] in urls:
            raise ValueError('原始链接必须为不重复HTTPS链接')
        urls.add(row['source_url'])
    return public


def verify_commitment(predictions, commitment):
    if digest(predictions) != commitment['predictions_sha256']:
        raise ValueError('封存预测哈希不一致，禁止揭盲比较')


def compare(public, predictions, human):
    validate_public(public)
    if len(human) != 20 or len({x['public_id'] for x in human}) != 20:
        raise ValueError('人工评分必须完整20题且编号不重复')
    expected = {x['public_id']: x['source_url'] for x in public['items']}
    if {x['public_id'] for x in human} != set(expected):
        raise ValueError('人工评分编号与冻结清单不一致')
    if len(predictions['items']) != 20 or {x['public_id'] for x in predictions['items']} != set(expected):
        raise ValueError('封存预测必须完整20题')
    answers = {}
    for row in human:
        score = row['difficulty']
        if row['source_url'] != expected[row['public_id']]:
            raise ValueError('人工文件原始链接被修改')
        if isinstance(score, bool) or not isinstance(score, (int, float)) or not 100 <= score <= 3500 or score % 100:
            raise ValueError('人工难度必须填写100–3500之间100的整数倍，不允许空白')
        answers[row['public_id']] = int(score)
    rows = []
    for prediction in predictions['items']:
        ident = prediction['public_id']
        score = prediction['analysis']['difficulty']
        difference = score - answers[ident]
        rows.append({'public_id': ident, 'source_url': expected[ident], 'group': prediction['group'],
                     'model_difficulty': score, 'human_difficulty': answers[ident],
                     'difference': difference, 'absolute_difference': abs(difference)})
    metrics = {}
    for group in ('all20', 'regression9', 'new11'):
        group_rows = [x for x in rows if group == 'all20' or x['group'] == group]
        if len(group_rows) != {'all20': 20, 'regression9': 9, 'new11': 11}[group]:
            raise ValueError('回归/新增分组数量不正确')
        diffs = [x['difference'] for x in group_rows]
        absolute = [abs(x) for x in diffs]
        metrics[group] = {'n': len(diffs), 'mae': statistics.mean(absolute),
            'median_absolute_difference': statistics.median(absolute), 'bias': statistics.mean(diffs),
            'max_absolute_difference': max(absolute),
            **{f'within_{limit}': sum(x <= limit for x in absolute) / len(diffs) for limit in (100, 200, 300)}}
    return {'event': 'v8首测', 'state': 'human_compared', 'human_results_sha256': digest(human),
            'metrics': metrics, 'items': rows,
            'limitations': '单人教学标尺；9题反馈回归与11题新增分别报告；不自动认定生产通过。'}
