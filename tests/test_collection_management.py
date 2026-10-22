"""HTTP limits and destructive action permissions, isolated SQLite only."""
from app.collection import mint_token
from tests.test_collection_storage import make_batch


def configure(monkeypatch, tmp_path):
    monkeypatch.setenv('CODEPOWERPLUS_COLLECTION_SECRET', 'x'*32)
    monkeypatch.setenv('CODEPOWERPLUS_COLLECTION_DB', str(tmp_path/'collection.db'))
    def headers(user='student', account='alice', purpose='import'):
        return {'Authorization': 'Bearer '+mint_token('x'*32, user, 'codeforces', account, purpose=purpose)}
    return headers


def test_usage_and_delete_require_manage_token_and_exact_confirmation(client, monkeypatch, tmp_path):
    headers = configure(monkeypatch, tmp_path)
    assert client.post('/api/collection/batches', json=make_batch().model_dump(mode='json'),
                       headers=headers()).status_code == 200
    usage = client.get('/api/collection/storage', headers=headers()).json()
    assert usage['submission_count'] == 1
    assert usage['limit_bytes'] == 150*1024**2
    assert client.get('/api/collection/storage', headers=headers('other')).json()['used_bytes'] == 0
    assert client.delete('/api/collection/submissions?confirm=delete-account-data', headers=headers()).status_code == 403
    assert client.delete('/api/collection/submissions', headers=headers(purpose='manage')).status_code == 422
    assert client.delete('/api/collection/submissions?confirm=delete-account-data',
                         headers=headers(account='bob', purpose='manage')).json()['deleted'] == 0
    result = client.delete('/api/collection/submissions?confirm=delete-account-data', headers=headers(purpose='manage'))
    assert result.status_code == 200 and result.json()['deleted'] == 1
    assert client.get('/api/collection/storage', headers=headers()).json()['used_bytes'] == 0
    # A management token cannot silently reimport deleted data.
    assert client.post('/api/collection/batches', json=make_batch().model_dump(mode='json'),
                       headers=headers(purpose='manage')).status_code == 403


def test_quota_http_error_is_structured_and_batch_not_written(client, monkeypatch, tmp_path):
    headers = configure(monkeypatch, tmp_path)
    monkeypatch.setenv('CODEPOWERPLUS_COLLECTION_LIMIT_BYTES', '3000')
    monkeypatch.setenv('CODEPOWERPLUS_COLLECTION_WARNING_BYTES', '2000')
    response = client.post('/api/collection/batches', json=make_batch(code='x'*5000).model_dump(mode='json'),
                           headers=headers())
    assert response.status_code == 413
    assert response.json()['detail']['code'] == 'storage_quota_exceeded'
    assert client.get('/api/collection/storage', headers=headers()).json()['used_bytes'] == 0


def test_invalid_limits_fail_closed(client, monkeypatch, tmp_path):
    headers = configure(monkeypatch, tmp_path)
    monkeypatch.setenv('CODEPOWERPLUS_COLLECTION_LIMIT_BYTES', '-1')
    assert client.get('/api/collection/storage', headers=headers()).status_code == 503
