"""Collector import uses a separate temporary database and synthetic records."""
import time
import pytest
from app.collection import CollectionStore, ImportBatch, mint_token, verify_token


def batch(**kwargs):
    item = dict(submission_id='11', problem_key='1/A', submitted_at='2026-10-21T01:00:00Z',
                language='C++', verdict='WRONG_ANSWER', time_ms=0, memory_bytes=None,
                source_state='not_requested', source_code=None)
    item.update(kwargs)
    return ImportBatch(schema_version=1, adapter_version='0.1.0', batch_id='batch-1',
                       platform='codeforces', account_id='alice',
                       coverage={'status':'partial','pages':1}, submissions=[item])


def test_scope_and_expiry():
    token = mint_token('x'*32, 'student', 'codeforces', 'alice', now=100, ttl=60)
    assert verify_token('x'*32, token, now=110)['user_id']=='student'
    for bad_secret, bad_token, now in [('y'*32,token,110),('x'*32,token+'x',110),('x'*32,token,160)]:
        with pytest.raises(ValueError): verify_token(bad_secret,bad_token,now=now)


def test_replay_updates_and_ownership(tmp_path):
    store=CollectionStore(tmp_path/'collection.db')
    assert store.import_batch('student',batch())['inserted']==1
    assert store.import_batch('student',batch())['replayed'] is True
    newer=batch(verdict='OK',source_state='available',source_code='int main(){}')
    newer.batch_id='batch-2'
    assert store.import_batch('student',newer)['updated']==1
    row=store.list_submissions('student')['items'][0]
    assert row['verdict']=='OK' and row['source_code']=='int main(){}'
    assert store.list_submissions('other')['total']==0
    retry=batch(); retry.batch_id='batch-3'
    store.import_batch('student',retry)
    assert store.list_submissions('student')['items'][0]['source_code']=='int main(){}'
    with pytest.raises(ValueError): store.import_batch('student',batch(verdict='OK'))
    with store.connect() as db:
        assert db.execute('SELECT COUNT(*) FROM observations').fetchone()[0]==3


def test_strict_protocol_rejects_credentials_and_bad_source():
    from pydantic import ValidationError
    raw=batch().model_dump()
    raw['cookie']='secret'
    with pytest.raises(ValidationError): ImportBatch(**raw)
    with pytest.raises(ValidationError): batch(source_state='available')
    with pytest.raises(ValidationError): batch(submitted_at='2026-10-21')
    with pytest.raises(ValidationError): batch(time_ms=-1)


def test_import_api_disabled_and_bound(client, monkeypatch, tmp_path):
    body=batch().model_dump(mode='json')
    monkeypatch.delenv('CODEPOWERPLUS_COLLECTION_SECRET',raising=False)
    assert client.post('/api/collection/batches',json=body).status_code==503
    monkeypatch.setenv('CODEPOWERPLUS_COLLECTION_SECRET','z'*32)
    monkeypatch.setenv('CODEPOWERPLUS_COLLECTION_DB',str(tmp_path/'external.db'))
    assert client.post('/api/collection/batches',json=body).status_code==401
    token=mint_token('z'*32,'student','codeforces','alice')
    headers={'Authorization':'Bearer '+token}
    assert client.post('/api/collection/batches',json=body,headers=headers).status_code==200
    assert client.post('/api/collection/batches',json={**body,'account_id':'bob'},headers=headers).status_code==403
    assert client.get('/api/collection/submissions',headers=headers).json()['total']==1
    assert client.get('/api/overview').json()['submissions']==0
