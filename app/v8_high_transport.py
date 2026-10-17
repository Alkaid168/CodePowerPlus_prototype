"""仅离线二测使用的API适配器：不改变v8提示词、校验或正式接口。"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import threading
import time
from types import ModuleType, SimpleNamespace

_local = threading.local()
MAX_TOKENS = 32768


def begin_run():
    _local.records = []
    return _local.records


class ProfileClient:
    def __init__(self, **kwargs):
        from openai import OpenAI
        self.client = OpenAI(**kwargs)
        self.chat = SimpleNamespace(completions=self)

    def __enter__(self):
        self.client.__enter__()
        return self

    def __exit__(self, *args):
        return self.client.__exit__(*args)

    def create(self, **kwargs):
        if kwargs.get('model') != 'deepseek-flash':
            raise ValueError('二测模型必须为deepseek-flash')
        sent = dict(kwargs, reasoning_effort='high', extra_body={'thinking': {'type': 'enabled'}},
                    max_tokens=MAX_TOKENS)
        record = {'request_parameters': {k:v for k,v in sent.items() if k != 'messages'},
                  'messages_sha256': hashlib.sha256(json.dumps(sent['messages'], ensure_ascii=False,
                    sort_keys=True).encode('utf-8')).hexdigest()}
        _local.records.append(record)
        started = time.monotonic()
        try:
            response = self.client.chat.completions.create(**sent)
            message = response.choices[0].message
            reasoning = getattr(message, 'reasoning_content', None) or ''
            record.update(response_model=response.model, response_id=response.id,
                finish_reason=response.choices[0].finish_reason,
                reasoning_content_chars=len(reasoning),
                reasoning_content_sha256=hashlib.sha256(reasoning.encode('utf-8')).hexdigest(),
                usage=response.usage.model_dump() if response.usage else None)
            return response
        except Exception as exc:
            record.update(error_type=type(exc).__name__, status_code=getattr(exc, 'status_code', None))
            raise
        finally:
            record['elapsed_seconds'] = round(time.monotonic() - started, 3)


def load_high_engine():
    """只替换客户端导入，原引擎其余源码逐字复用，不写回app。"""
    name = 'app.services._v8_high_experiment_engine'
    if name in sys.modules:
        return sys.modules[name]
    source_path = Path(__file__).parent / 'services/analysis_v8.py'
    source = source_path.read_text(encoding='utf-8')
    original = 'from openai import OpenAI, OpenAIError'
    replacement = 'from app.v8_high_transport import ProfileClient as OpenAI; from openai import OpenAIError'
    if source.count(original) != 1:
        raise RuntimeError('v8原引擎客户端导入已变化，禁止静默改变实验')
    module = ModuleType(name)
    module.__file__ = str(source_path)
    sys.modules[name] = module
    exec(compile(source.replace(original, replacement), str(source_path), 'exec'), module.__dict__)
    return module
