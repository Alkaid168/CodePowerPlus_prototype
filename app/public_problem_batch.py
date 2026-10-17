"""公开真题的辅助评估与幂等导入；不把代理参考标注当成人工金标准。"""
from __future__ import annotations

from collections import Counter
import hashlib
import json
import re
import time
from urllib.parse import urlparse

from app.evaluation import classification_metrics
from app.schemas import AnalysisPayload, ProblemCreate
from app.services.analysis import PROMPT_VERSION, SYSTEM_PROMPT, analyze_with_model, validate


REFERENCE_PROVENANCE = 'agent_reference_not_human'


def prediction_fingerprint(item, taxonomy, settings):
    return hashlib.sha256(json.dumps({
        'title': item['title'], 'description': item['description'], 'source': item['source_url'],
        'taxonomy': taxonomy.version, 'model': settings.model, 'prompt': SYSTEM_PROMPT,
        'endpoint': settings.base_url,
    }, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def read_predictions(items, taxonomy, settings, checkpoint):
    """只读路径同样校验输入指纹与当前模型／词表／提示词，不能误用别题旧输出。"""
    results = {}
    for item in items:
        source = item['source_url']
        record = checkpoint.get('items', {}).get(source, {})
        if not isinstance(record, dict) or record.get('status') != 'complete' or record.get('fingerprint') != prediction_fingerprint(item, taxonomy, settings):
            continue
        payload = record.get('analysis', {})
        if (not isinstance(payload, dict) or payload.get('model_name') != settings.model or payload.get('prompt_version') != PROMPT_VERSION
                or payload.get('taxonomy_version') != taxonomy.version):
            continue
        try:
            results[source] = validate(AnalysisPayload.model_validate(payload), taxonomy,
                                       model_name=settings.model).model_dump()
        except Exception:
            continue
    return results


def predict_batch(items, taxonomy, settings, checkpoint, save, *, analyzer=analyze_with_model, progress=None):
    """逐题断点保存；给模型的只有重述题面，不含官方标签、评分或辅助参考。"""
    checkpoint.setdefault('items', {})
    checkpoint.update(version='public-problem-predictions-v1', taxonomy_version=taxonomy.version,
                      model_name=settings.model, prompt_version=PROMPT_VERSION)
    results = {}
    for index, item in enumerate(items, 1):
        source = item['source_url']
        digest = prediction_fingerprint(item, taxonomy, settings)
        cached = read_predictions([item], taxonomy, settings, checkpoint)
        if source in cached:
            results[source] = cached[source]
            if progress:
                progress(index, len(items), item['source_id'], 'cached')
            continue
        start = time.monotonic()
        try:
            checked = validate(analyzer(item['description'], taxonomy, settings), taxonomy, model_name=settings.model)
            payload = checked.model_dump()
            checkpoint['items'][source] = {'fingerprint': digest, 'status': 'complete', 'analysis': payload,
                                           'elapsed_seconds': round(time.monotonic() - start, 3)}
            results[source] = payload
            state = 'complete'
        except Exception as exc:
            checkpoint['items'][source] = {'fingerprint': digest, 'status': 'failed', 'error_type': type(exc).__name__,
                                           'elapsed_seconds': round(time.monotonic() - start, 3)}
            state = f'failed:{type(exc).__name__}'
        save(checkpoint)
        if progress:
            progress(index, len(items), item['source_id'], state)
    return results


def validate_items(items: list[dict], taxonomy, expected_counts: dict | None = None) -> None:
    seen, ids = set(), set()
    for item in items:
        platform, source = item.get('source_platform'), item.get('source_url', '')
        parsed = urlparse(source)
        hosts = {'codeforces': 'codeforces.com', 'luogu': 'www.luogu.com.cn'}
        if platform not in hosts or parsed.scheme != 'https' or parsed.hostname != hosts[platform]:
            raise ValueError('unverified source platform/URL')
        pattern = r'/problemset/problem/[0-9]+/[A-Za-z0-9]+' if platform == 'codeforces' else r'/problem/P[0-9]+'
        if parsed.query or parsed.fragment or parsed.username or parsed.password or parsed.port or not re.fullmatch(pattern, parsed.path):
            raise ValueError('source must be canonical problem URL')
        identity = (platform, item.get('source_id'))
        if not identity[1] or source in seen or identity in ids:
            raise ValueError('duplicate or missing source identity')
        seen.add(source)
        ids.add(identity)
        ProblemCreate.model_validate({key: item[key] for key in ('title', 'description', 'source_url')})
        checks = item.get('source_checks', {})
        if checks.get('statement_verified') is not True or checks.get('samples_verified') is not True:
            raise ValueError('statement and sample correctness must be verified with provenance')
        reference = item.get('reference', {})
        if reference.get('provenance') != REFERENCE_PROVENANCE:
            raise ValueError('reference must disclose agent_reference_not_human')
        validate(AnalysisPayload.model_validate(reference), taxonomy, model_name='manual')
        official = item.get('official_difficulty') or {}
        rating = official.get('rating')
        if platform == 'codeforces' and rating is not None and (type(rating) is not int or not 800 <= rating <= 3500):
            raise ValueError('invalid official CF rating')
    if expected_counts is not None and Counter(x['source_platform'] for x in items) != Counter(expected_counts):
        raise ValueError('source sample counts do not match requested batch')


def _labels(payload):
    return list(payload['primary_knowledge_ids']) + list(payload['secondary_knowledge_ids'])


def _rating_metrics(rows, key):
    eligible = [row for row in rows if row[key] is not None]
    errors = [abs(row['predicted_rating'] - row[key]) for row in eligible]
    return {'samples': len(errors), 'mae': sum(errors) / len(errors) if errors else None,
            'within_200': sum(error <= 200 for error in errors) / len(errors) if errors else None,
            'mean_signed_error': sum(row['predicted_rating'] - row[key] for row in eligible) / len(eligible) if eligible else None}


def evaluate_batch(items: list[dict], predictions: dict[str, dict]) -> dict:
    rows, missing = [], []
    for item in items:
        predicted = predictions.get(item['source_url'])
        if predicted is None:
            missing.append(item['source_url'])
            continue
        reference = item['reference']
        expected_ids, predicted_ids = set(_labels(reference)), set(_labels(predicted))
        official = item.get('official_difficulty') or {}
        rows.append({'source_id': item['source_id'], 'source_platform': item['source_platform'],
                     'source_url': item['source_url'], 'title': item['title'],
                     'reference_labels': sorted(expected_ids), 'predicted_labels': sorted(predicted_ids),
                     'reference_primary': reference['primary_knowledge_ids'], 'predicted_primary': predicted['primary_knowledge_ids'],
                     'missing_labels': sorted(expected_ids - predicted_ids), 'extra_labels': sorted(predicted_ids - expected_ids),
                     'reference_rating': reference['difficulty'], 'predicted_rating': predicted['difficulty'],
                     'official_rating': official.get('rating') if item['source_platform'] == 'codeforces' else None,
                     'official_level': official.get('label') if item['source_platform'] == 'luogu' else None})
    def summary(selected):
        return {'completed': len(selected),
                'classification': classification_metrics([row['reference_labels'] for row in selected], [row['predicted_labels'] for row in selected]),
                'primary_classification': classification_metrics([row['reference_primary'] for row in selected], [row['predicted_primary'] for row in selected]),
                'exact_label_match': sum(not row['missing_labels'] and not row['extra_labels'] for row in selected) / len(selected) if selected else None,
                'official_rating': _rating_metrics(selected, 'official_rating'),
                'estimated_reference_rating': _rating_metrics(selected, 'reference_rating')}
    return {'version': 'public-problem-evaluation-v1', 'requested': len(items), 'completed': len(rows),
            'missing': missing, 'label_reference_provenance': REFERENCE_PROVENANCE,
            **summary(rows), 'platforms': {platform: summary([row for row in rows if row['source_platform'] == platform])
                                        for platform in ['codeforces', 'luogu']}, 'rows': rows,
            'limitations': [
                '标签参考由代理独立核对题意生成，未经教师／双人独立人工审核，不是人工金标准；F1 只表示与辅助参考的一致性。',
                'CF 官方标签粒度与本项目词表不同，保留作来源参考，不直接等同本项目标签。',
                'CF 官方评分可直接计算误差；洛谷等级不转换成官方 CF 评分，另列代理估计评分误差。',
                '公开经典题可能被模型在训练中见过；隐藏来源和官方评分不构成严格盲测，不代表学校新题上的泛化表现。',
                '题面按官方技术条件独立重述；原题故事与语言差异可能影响结果，样例来源见逐题采集记录。',
                '这批题仅作为题库和初步诊断数据，不产生真实学生记录或教学效果结论。',
            ]}


def import_batch(container, items: list[dict], predictions: dict[str, dict]) -> list[dict]:
    """原子导入；同来源冲突拒绝，已有分析／审核不可覆盖。"""
    validate_items(items, container.taxonomy)
    if any(item['source_url'] not in predictions for item in items):
        raise ValueError('missing predictions; refusing partial import')
    parsed = {}
    for item in items:
        payload = predictions[item['source_url']]
        if not payload.get('model_name') or payload.get('model_name') == 'manual' or not payload.get('prompt_version'):
            raise ValueError('model provenance required')
        analysis = validate(AnalysisPayload.model_validate(payload), container.taxonomy, model_name=payload['model_name'])
        if analysis.prompt_version != payload['prompt_version']:
            raise ValueError('prediction prompt version is no longer current')
        parsed[item['source_url']] = analysis.model_copy(update={'title': item['title']})
    result = []
    with container.db.transaction():
        by_source = {}
        for old in container.problems.all():
            if old['source_url'] in by_source:
                raise ValueError('duplicate existing source conflict')
            if old['source_url']:
                by_source[old['source_url']] = old
        for item in items:
            source = item['source_url']
            body = {key: item[key] for key in ('title', 'description', 'source_url')}
            body.update(reference_solution='', reference_code='')
            old = by_source.get(source)
            if old and old['description'] != body['description']:
                from app.statement_formatting import is_curated_formatting
                if is_curated_formatting(item, old['description']):
                    body['description'] = old['description']
            if old and any(old.get(key, '') != value for key, value in body.items()):
                raise ValueError(f'existing source conflict: {source}')
            problem = old or container.problems.create(**body)
            latest = container.analyses.latest(problem['id'])
            analysis = parsed[source]
            if latest:
                if latest.get('is_stale') or AnalysisPayload.model_validate(latest).model_dump() != analysis.model_dump():
                    raise ValueError(f'existing analysis conflict: {source}')
            else:
                latest = container.analyses.add(problem['id'], analysis.model_dump(), origin='model', status='pending',
                                                taxonomy_version=container.taxonomy.version, expected_revision=problem['revision'])
            result.append({'source_id': item['source_id'], 'source_url': source, 'problem_id': problem['id'],
                           'analysis_id': latest['analysis_id'], 'created': old is None,
                           'review_status': latest['review_status']})
    return result
