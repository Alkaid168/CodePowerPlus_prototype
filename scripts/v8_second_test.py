"""v8二测：固定原20题、原提示词，每题独立3次显式Flash/High，不写正式库。"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import replace
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.blind_evaluation import digest, verify_commitment
from app.config import load_settings
from app.knowledge import Taxonomy
from app.v8_high_transport import begin_run, load_high_engine

WORK = ROOT / 'data/evaluation/v8-second-test'
FIRST = ROOT / 'data/evaluation/v8-first-test'
PRIVATE_FIRST = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'CodePowerPlus/blind-evaluations/v8-first-test'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(path)


def now():
    return datetime.now(timezone.utc).isoformat()


def runner():
    spec = importlib.util.spec_from_file_location('v8_first_runner', ROOT / 'scripts/v8_blind_evaluation.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def freeze(settings):
    first = read(FIRST / 'manifest.json')
    seal = read(FIRST / 'commitment.json')
    verify_commitment(read(PRIVATE_FIRST / 'predictions.json'), seal)
    for name, sha in first['fingerprint']['files'].items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != sha:
            raise ValueError(f'首测冻结的提示词/实现发生变化：{name}')
    paths = ['app/v8_high_transport.py', 'scripts/v8_second_test.py', 'docs/v8-second-test-protocol.md']
    fingerprint = {'original_fingerprint': first['fingerprint'],
        'experiment_files': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in paths},
        'profile': {'model': 'deepseek-flash', 'reasoning_effort': 'high', 'thinking': {'type': 'enabled'},
                    'max_tokens': 32768, 'temperature': 0, 'timeout_seconds': 300, 'sdk_transport_retries': 1},
        'endpoint': settings.base_url, 'first_prediction_commitment': seal['predictions_sha256'],
        'human_revision_r1_sha256': digest(read(FIRST / 'human-ratings.json'))}
    manifest_path = WORK / 'manifest.json'
    if manifest_path.exists():
        frozen = read(manifest_path)
        if frozen['fingerprint'] != fingerprint:
            raise ValueError('二测参数/输入/实现/人工评分发生变化，拒绝混用缓存')
        return frozen
    human = read(FIRST / 'human-ratings.json')
    if human.get('human_revision') != 1 or next(x['difficulty'] for x in human['items'] if x['public_id'] == 'B17') != 1500:
        raise ValueError('必须使用人工评分修订1，CF25D=1500')
    frozen = {'event': 'v8二测', 'frozen_at': now(), 'fingerprint': fingerprint,
              'items': first['items'], 'database_before': runner().database_snapshot(),
              'tasks': [f"{row['public_id']}-R{repetition}" for repetition in range(1,4) for row in first['items']]}
    write(manifest_path, frozen)
    return frozen


def run(only=None):
    settings = replace(load_settings(), model='deepseek-flash', request_timeout=300)
    frozen = freeze(settings)
    if not settings.model_configured:
        raise ValueError('尚未配置真实模型密钥')
    manifest_hash = digest(frozen)
    complete = WORK / 'completion.json'
    if complete.exists():
        if runner().database_snapshot() != frozen['database_before']:
            raise ValueError('正式数据库与实验基线不同')
        print('60/60已经封存；没有新增模型调用。')
        return
    engine = load_high_engine()
    taxonomy = Taxonomy(settings.taxonomy_path, settings.schema_path)
    by_id = {x['public_id']:x for x in frozen['items']}
    records = {}
    pending = []
    for key in frozen['tasks']:
        file = WORK / 'runs' / f'{key}.json'
        if file.exists():
            item = read(file)
            if item['manifest_sha256'] != manifest_hash:
                raise ValueError('缓存输入或参数不一致')
            records[key] = item
        elif only is None or only == key:
            pending.append(key)
    def execute(key):
        public_id, repetition = key.split('-R')
        row = by_id[public_id]
        transport = begin_run()
        try:
            result = engine.analyze(row['description'], taxonomy, settings,
                reference_solution=row['reference_solution'], reference_code=row['reference_code'])
            if any(x.get('response_model') != 'deepseek-flash' for x in transport):
                raise ValueError('响应模型不是deepseek-flash')
            if any(x.get('finish_reason') != 'stop' for x in transport):
                raise ValueError('输出未正常完成，不能视为成功')
            return {'event': 'v8二测', 'key': key, 'public_id': public_id, 'repetition': int(repetition),
                    'manifest_sha256': manifest_hash, 'input_sha256': row['input_sha256'],
                    'completed_at': now(), 'analysis': result.model_dump(), 'transport_records': transport}
        except Exception as exc:
            failures = WORK / 'failures' / f'{key}.json'
            previous = read(failures) if failures.exists() else []
            previous.append({'at': now(), 'error_type': type(exc).__name__, 'message': str(exc)[:300],
                             'transport_records': transport})
            write(failures, previous)
            raise
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(execute,key):key for key in pending}
        for future in as_completed(futures):
            key = futures[future]
            try:
                item = future.result()
                write(WORK/'runs'/f'{key}.json', item)
                records[key] = item
                print(f'{key} complete; {len(records)}/60', flush=True)
            except Exception as exc:
                print(f'{key} failed: {type(exc).__name__}; retained diagnostics', flush=True)
    if len(records) == 60:
        if runner().database_snapshot() != frozen['database_before']:
            raise ValueError('正式数据库在实验期间发生变化，请核验')
        payload = {'event': 'v8二测', 'manifest_sha256': manifest_hash,
                   'items': [records[key] for key in frozen['tasks']]}
        write(WORK / 'predictions.json', payload)
        write(complete, {'event': 'v8二测', 'completed': 60, 'sealed_at': now(),
            'predictions_sha256': digest(payload), 'manifest_sha256': manifest_hash,
            'database_unchanged': True, 'first_predictions_unchanged': True,
            'state': 'awaiting_semantic_review'})
        print('60/60 complete and sealed; semantic review required.', flush=True)
    elif only:
        print('Canary saved as actual repetition, no extra sample.', flush=True)
    else:
        raise ValueError(f'仅{len(records)}/60成功，保留失败并等待原配置断点重试')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', choices=[f'B{x:02}-R{y}' for y in range(1,4) for x in range(1,21)])
    run(parser.parse_args().only)
