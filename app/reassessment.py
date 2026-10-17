"""冻结现有题目、断点模型重评、原子追加；不覆盖人工审核或历史分析。"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import time

from app.errors import InvalidInput, ModelUnavailable
from app.schemas import AnalysisPayload
from app.services.analysis import PROMPT_VERSION, SYSTEM_PROMPT, analyze_with_model, validate

FIELDS = ('title', 'description', 'source_url', 'reference_solution', 'reference_code')


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def context(taxonomy, settings):
    return {'taxonomy_version': taxonomy.version, 'taxonomy_sha256': digest(taxonomy.data),
            'prompt_version': PROMPT_VERSION, 'prompt_sha256': digest(SYSTEM_PROMPT),
            'model_name': settings.model, 'endpoint': settings.base_url}


def unreviewed_problem_ids(container):
    return {p['id'] for p in container.problems.all()
            if not container.reviews.list_for_problem(p['id'])
            and ((latest := container.analyses.latest(p['id'])) is None or latest['review_status'] == 'pending')}


def freeze(container, *, unreviewed_only=False):
    with container.db.transaction():
        items = []
        eligible = unreviewed_problem_ids(container) if unreviewed_only else None
        for problem in sorted(container.problems.all(), key=lambda p: p['id']):
            if eligible is not None and problem['id'] not in eligible:
                continue
            old = container.analyses.latest(problem['id'])
            items.append({**{key: problem[key] for key in FIELDS}, 'id': problem['id'],
                          'revision': problem['revision'], 'baseline_analysis_id': old['analysis_id'] if old else None,
                          'before': {key: old.get(key) for key in ('difficulty', 'primary_knowledge_ids',
                                     'secondary_knowledge_ids', 'review_status')} if old else None})
        return {'version': 'problem-reassessment-v1', 'selection': 'unreviewed' if unreviewed_only else 'all',
                **context(container.taxonomy, container.settings), 'items': items}


def check_context(manifest, taxonomy, settings):
    if any(manifest.get(key) != value for key, value in context(taxonomy, settings).items()):
        raise ValueError('frozen model, prompt or taxonomy differs; use a new run directory')


def checked_payload(payload, taxonomy, settings):
    if not isinstance(payload, dict):
        raise ValueError('checkpoint analysis must be an object')
    if (payload.get('model_name') != settings.model or payload.get('prompt_version') != PROMPT_VERSION
            or payload.get('taxonomy_version') != taxonomy.version):
        raise ValueError('prediction provenance differs')
    return validate(AnalysisPayload.model_validate(payload), taxonomy, model_name=settings.model).model_dump()


def predict(manifest, taxonomy, settings, checkpoint, save, *, analyzer=analyze_with_model, progress=None, workers=2):
    check_context(manifest, taxonomy, settings)
    checkpoint.setdefault('items', {})
    results, pending = {}, []
    batch_id = digest(manifest)
    for item in manifest['items']:
        key, fingerprint = str(item['id']), digest({'batch': batch_id, 'input': item})
        record = checkpoint['items'].get(key, {})
        if not isinstance(record, dict):
            record = {}
        if record.get('status') == 'complete' and record.get('fingerprint') == fingerprint:
            try:
                results[key] = checked_payload(record['analysis'], taxonomy, settings)
                continue
            except (ValueError, KeyError, TypeError, InvalidInput):
                pass
        pending.append((item, fingerprint))
    def run(item):
        start = time.monotonic()
        try:
            value = analyzer(item['description'], taxonomy, settings,
                             reference_solution=item['reference_solution'], reference_code=item['reference_code'])
            payload = validate(value, taxonomy, model_name=settings.model).model_dump()
            payload['title'] = item['title']
            return {'status': 'complete', 'analysis': payload, 'elapsed_seconds': round(time.monotonic() - start, 3)}
        except Exception as exc:
            # 只保存异常类型；客户端错误文本可能包含请求信息，不能写进公开输出。
            failure = {'status': 'failed', 'error_type': type(exc).__name__,
                       'elapsed_seconds': round(time.monotonic() - start, 3)}
            if isinstance(exc, ModelUnavailable) and str(exc).startswith('模型连续返回不符合知识标注规范'):
                failure['validation_error'] = str(exc)  # 仅服务端校验反馈，不含客户端请求或凭据。
            return failure
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(run, item): (item, fingerprint) for item, fingerprint in pending}
        for future in as_completed(futures):
            item, fingerprint = futures[future]
            record = {**future.result(), 'fingerprint': fingerprint}
            key = str(item['id'])
            previous = checkpoint['items'].get(key, {})
            if not isinstance(previous, dict):
                previous = {}
            record['runs'] = previous.get('runs', 0) + 1
            if previous:
                record['previous_attempts'] = previous.get('previous_attempts', []) + [
                    {k: previous[k] for k in ('status', 'error_type', 'validation_error', 'elapsed_seconds') if k in previous}]
            checkpoint['items'][key] = record
            if record['status'] == 'complete':
                results[key] = record['analysis']
            save(checkpoint)  # 主线程串行持久化，避免同时写坏断点。
            if progress:
                progress(item['id'], record['status'], len(results), len(manifest['items']))
    return results


def apply_results(container, manifest, results):
    check_context(manifest, container.taxonomy, container.settings)
    items = manifest['items']
    if not items or set(results) != {str(item['id']) for item in items}:
        raise ValueError('all frozen problems need a valid prediction; refusing partial apply')
    parsed = {key: checked_payload(value, container.taxonomy, container.settings) for key, value in results.items()}
    receipt_key = 'reassessment:' + digest(manifest)
    with container.db.transaction():
        current = {p['id']: p for p in container.problems.all()}
        for item in items:
            problem = current.get(item['id'])
            if problem is None:
                raise ValueError('problem set changed during reassessment')
            if problem['revision'] != item['revision'] or any(problem[key] != item[key] for key in FIELDS):
                raise ValueError(f'problem #{item["id"]} changed during reassessment')
        receipt = container.db.query_one('SELECT value FROM schema_meta WHERE key=?', (receipt_key,))
        if receipt:
            saved = json.loads(receipt['value'])
            for row in saved:
                stored = container.analyses.get(row['analysis_id'])
                if AnalysisPayload.model_validate(stored).model_dump() != parsed[str(row['problem_id'])]:
                    raise ValueError('applied batch payload differs; refusing duplicate append')
            return saved
        eligible = unreviewed_problem_ids(container) if manifest.get('selection') == 'unreviewed' else set(current)
        if eligible != {item['id'] for item in items}:
            raise ValueError('problem set or review decisions changed during reassessment')
        for item in items:
            latest = container.analyses.latest(item['id'])
            if (latest['analysis_id'] if latest else None) != item['baseline_analysis_id']:
                raise ValueError(f'analysis #{item["id"]} changed during reassessment')
        receipt = []
        for item in items:
            analysis = container.analyses.add(item['id'], parsed[str(item['id'])], origin='model', status='pending',
                                              taxonomy_version=container.taxonomy.version, expected_revision=item['revision'])
            receipt.append({'problem_id': item['id'], 'previous_analysis_id': item['baseline_analysis_id'],
                            'analysis_id': analysis['analysis_id'], 'review_status': analysis['review_status']})
        container.db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)',
                             (receipt_key, json.dumps(receipt, ensure_ascii=False)))
        return receipt
