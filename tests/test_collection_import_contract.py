"""Cross-language exported result and failure atomicity, using synthetic data."""
import json
from pathlib import Path
import subprocess
import pytest
from app.collection import CollectionStore, ImportBatch, mint_token


def test_extension_export_is_accepted_by_real_api(client,monkeypatch,tmp_path):
    root=Path(__file__).resolve().parents[1]
    module=(root/'extensions/collector/src/engine.js').as_uri()
    script="import {exportBatches} from '"+module+"'; console.log(JSON.stringify(exportBatches({platform:'codeforces',account:'alice',status:'paused',pages:1,coverageScope:'visible_account_history'},[{submission_id:'1',problem_key:'1/A',submitted_at:'2026-10-21T00:00:00Z',language:'C++',verdict:'OK',score:null,time_ms:0,memory_bytes:null,source_state:'not_requested',source_code:null,source_hash:null}],1)[0]));"
    output=subprocess.check_output(['node','--input-type=module','-e',script],encoding='utf-8',cwd=root)
    batch=json.loads(output)
    monkeypatch.setenv('CODEPOWERPLUS_COLLECTION_SECRET','q'*32)
    monkeypatch.setenv('CODEPOWERPLUS_COLLECTION_DB',str(tmp_path/'external.db'))
    token=mint_token('q'*32,'student','codeforces','alice')
    headers={'Authorization':'Bearer '+token}
    result=client.post('/api/collection/batches',json=batch,headers=headers)
    assert result.status_code==200,result.text
    assert result.json()['inserted']==1
    assert client.post('/api/collection/batches',json=batch,headers=headers).json()['replayed']
    # Another account token for the same local user must not read Alice's code.
    bob=mint_token('q'*32,'student','codeforces','bob')
    assert client.get('/api/collection/submissions',headers={'Authorization':'Bearer '+bob}).json()['total']==0


def test_transaction_failure_rolls_back_page(tmp_path):
    store=CollectionStore(tmp_path/'external.db')
    raw=dict(schema_version=1,adapter_version='0.1',batch_id='b',platform='codeforces',account_id='alice',coverage={'status':'partial','pages':1},
        submissions=[dict(submission_id=str(i),problem_key='1/A',submitted_at='2026-10-21T00:00:00Z',language='C++',verdict='OK',source_state='not_requested') for i in [1,2]])
    with store.connect() as db:
        db.execute("CREATE TRIGGER simulate_failure BEFORE INSERT ON external_submissions WHEN NEW.submission_id='2' BEGIN SELECT RAISE(ABORT, 'test interrupted write'); END")
    with pytest.raises(Exception,match='interrupted write'): store.import_batch('student',ImportBatch(**raw))
    assert store.list_submissions('student')['total']==0
    with store.connect() as db:
        assert db.execute('SELECT COUNT(*) FROM batches').fetchone()[0]==0
        assert db.execute('SELECT COUNT(*) FROM observations').fetchone()[0]==0


def test_rejects_source_hash_mismatch_and_duplicate_ids():
    from pydantic import ValidationError
    base=dict(schema_version=1,adapter_version='0.1',batch_id='b',platform='luogu',account_id='7',coverage={'status':'partial','pages':0})
    row=dict(submission_id='1',problem_key='P1001',submitted_at='2026-10-21T00:00:00Z',language='1',verdict='12',source_state='available',source_code='int main(){}',source_hash='a'*64)
    with pytest.raises(ValidationError): ImportBatch(**base,submissions=[row])
    row.pop('source_hash')
    with pytest.raises(ValidationError): ImportBatch(**base,submissions=[row,row])


def test_collection_cors_preflight_uses_configured_extension_origin(client,monkeypatch):
    monkeypatch.setenv('CODEPOWERPLUS_COLLECTION_ALLOWED_ORIGINS','chrome-extension://abcdefghijklmnop, edge-extension://qrstuvwxyzabcdef')
    # The app middleware reads environment at construction time, so create a dedicated isolated app.
    from dataclasses import replace
    from fastapi.testclient import TestClient
    from app.config import load_settings
    from app.main import create_app
    import os
    monkeypatch.setenv('CODEPOWERPLUS_COLLECTION_ALLOWED_ORIGINS','chrome-extension://abcdefghijklmnop,edge-extension://qrstuvwxyzabcdef')
    with TestClient(create_app(replace(load_settings(),db_path=':memory:',api_key=''))) as cors_client:
        response=cors_client.options('/api/collection/batches',headers={
            'Origin':'chrome-extension://abcdefghijklmnop',
            'Access-Control-Request-Method':'POST',
            'Access-Control-Request-Headers':'authorization,content-type',
        })
        assert response.status_code==200
        assert response.headers['access-control-allow-origin']=='chrome-extension://abcdefghijklmnop'
        denied=cors_client.options('/api/collection/batches',headers={
            'Origin':'chrome-extension://unlistedextension',
            'Access-Control-Request-Method':'POST',
            'Access-Control-Request-Headers':'authorization,content-type',
        })
        assert 'access-control-allow-origin' not in denied.headers
