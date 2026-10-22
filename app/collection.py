"""External collection protocol, scoped tokens and independent SQLite store.

Never imports an OJ session or writes approved learning evidence.
"""
from __future__ import annotations
import base64
from datetime import datetime, timezone
import hashlib
import hmac
import json
import secrets
import time
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Platform = Literal['codeforces', 'luogu', 'atcoder', 'vjudge']

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')

class CollectedSubmission(StrictModel):
    submission_id: str = Field(min_length=1, max_length=100, pattern=r'^[A-Za-z0-9_-]+$')
    problem_key: str = Field(min_length=1, max_length=200)
    submitted_at: datetime
    language: str = Field(max_length=200)
    verdict: str = Field(min_length=1, max_length=100)
    score: float | None = Field(default=None, allow_inf_nan=False)
    time_ms: int | None = Field(default=None, ge=0, le=10**12)
    memory_bytes: int | None = Field(default=None, ge=0, le=10**15)
    source_state: Literal['not_requested','available','private','blocked','unavailable','image_only']
    source_code: str | None = Field(default=None, max_length=500_000)
    source_hash: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')

    @field_validator('submitted_at')
    @classmethod
    def utc_time(cls, value):
        if value.tzinfo is None: raise ValueError('submitted_at requires timezone')
        return value.astimezone(timezone.utc)

    @model_validator(mode='after')
    def source_consistent(self):
        if self.source_state == 'available':
            if self.source_code is None: raise ValueError('available requires source_code')
            digest=hashlib.sha256(self.source_code.encode()).hexdigest()
            if self.source_hash and self.source_hash != digest: raise ValueError('source hash mismatch')
            self.source_hash=digest
        elif self.source_code is not None or self.source_hash is not None:
            raise ValueError('source content requires available state')
        return self

class Coverage(StrictModel):
    status: Literal['partial','complete_visible','blocked','cancelled'] = 'partial'
    pages: int = Field(default=0, ge=0)
    note: str = Field(default='', max_length=500)

class ImportBatch(StrictModel):
    schema_version: Literal[1]
    adapter_version: str = Field(min_length=1, max_length=40)
    batch_id: str = Field(min_length=1, max_length=100, pattern=r'^[A-Za-z0-9_-]+$')
    platform: Platform
    account_id: str = Field(min_length=1,max_length=100,pattern=r'^[A-Za-z0-9_.-]+$')
    coverage: Coverage
    submissions: list[CollectedSubmission] = Field(min_length=1,max_length=100)

    @model_validator(mode='after')
    def unique_ids(self):
        ids=[s.submission_id for s in self.submissions]
        if len(ids)!=len(set(ids)): raise ValueError('duplicate IDs inside batch')
        return self

def _b64(data): return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

def mint_token(secret, user_id, platform, account_id, *, now=None, ttl=900, purpose='import'):
    if len(secret)<32: raise ValueError('collection secret must have at least 32 characters')
    if platform not in ('codeforces','luogu','atcoder','vjudge'): raise ValueError('invalid platform')
    if not user_id or not account_id or len(user_id)>100 or len(account_id)>100: raise ValueError('invalid account')
    if not 1<=ttl<=3600: raise ValueError('ttl must be 1..3600')
    if purpose not in ('import','manage'): raise ValueError('invalid purpose')
    payload=dict(user_id=user_id, platform=platform, account_id=account_id,
                 exp=int(time.time() if now is None else now)+ttl, nonce=secrets.token_hex(8), purpose=purpose)
    encoded=_b64(json.dumps(payload,separators=(',',':')).encode())
    return encoded+'.'+_b64(hmac.digest(secret.encode(),encoded.encode(),'sha256'))

def verify_token(secret, token, *, now=None):
    try:
        if len(secret)<32 or len(token)>2000: raise ValueError()
        encoded, signature=token.split('.')
        expected=_b64(hmac.digest(secret.encode(),encoded.encode(),'sha256'))
        if not hmac.compare_digest(signature,expected): raise ValueError()
        claim=json.loads(base64.urlsafe_b64decode(encoded+'='*(-len(encoded)%4)))
        required={'user_id','platform','account_id','exp','nonce'}
        if set(claim) not in (required,required|{'purpose'}): raise ValueError()
        claim.setdefault('purpose','import')
        if claim['purpose'] not in ('import','manage'): raise ValueError()
        if claim['exp']<=int(time.time() if now is None else now): raise ValueError()
        return claim
    except (ValueError,TypeError,KeyError,json.JSONDecodeError) as exc:
        raise ValueError('invalid or expired import token') from exc

# Public compatibility import; protocol and token helpers remain in this module.
from app.collection_storage import CollectionStore  # noqa: E402,F401
