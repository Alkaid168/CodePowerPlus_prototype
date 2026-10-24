import pytest


def metric(body, key):
    return next(item for item in body['dimensions'] if item['knowledge_id'] == key)


def test_profile_starts_at_zero_without_creating_or_configuring_anything(client, container):
    statements = []
    container.db.conn.set_trace_callback(statements.append)
    try:
        body = client.get('/api/users/new/profile').json()
    finally:
        container.db.conn.set_trace_callback(None)
    assert body['overall']['score'] == 0
    assert len(body['dimensions']) == 10
    assert all(item['score'] == 0 for item in body['dimensions'])
    assert not any(s.lstrip().upper().startswith(('INSERT', 'UPDATE', 'DELETE')) for s in statements)


def test_starting_score_can_no_longer_be_chosen(client):
    payload = {'experience': 'contest_advanced', 'language': 'C++', 'goal_knowledge_ids': []}
    assert client.post('/api/users/u/profile', json=payload).status_code == 405
    assert client.put('/api/users/u/profile', json=payload).status_code == 405
    assert client.get('/api/users/u/profile').json()['overall']['score'] == 0


def test_old_self_report_is_ignored_without_erasing_its_saved_data(client, container):
    container.db.execute(
        'INSERT INTO learner_profiles(user_id,experience,language,created_at,updated_at) VALUES (?,?,?,?,?)',
        ('legacy', 'contest_advanced', 'C++', 'old', 'old'))
    body = client.get('/api/users/legacy/profile').json()
    assert body['overall']['score'] == 0
    assert container.db.query_one('SELECT experience FROM learner_profiles WHERE user_id=?', ('legacy',))['experience'] == 'contest_advanced'


def test_actual_submission_updates_score_and_repeated_ac_does_not(client, approved_problem):
    problem, _ = approved_problem(primary=('basic.prefix-sum',), difficulty=1600)
    path = '/api/users/learner/profile'
    assert client.get(path).json()['overall']['score'] == 0
    for i in range(2):
        assert client.post('/api/submissions', json={
            'user_id': 'learner', 'problem_id': problem['id'], 'verdict': 'AC',
        }).status_code == 201
        body = client.get(path).json()
        assert metric(body, 'basic')['score'] > 0
        assert body['overall']['score'] >= 800
        assert body['overall']['evidence_count'] == 1
        if i == 0:
            first = body
        else:
            assert body == first
    assert client.get('/api/users/other/profile').json()['overall']['score'] == 0


def test_unreviewed_submission_does_not_change_score(client, make_problem):
    problem, _ = make_problem()
    client.post('/api/submissions', json={'user_id': 'pending', 'problem_id': problem['id'], 'verdict': 'AC'})
    body = client.get('/api/users/pending/profile').json()
    assert body['overall']['score'] == 0
    assert body['unmapped_submission_count'] == 1


@pytest.mark.parametrize('domain', ['basic', 'search', 'dp', 'string', 'math', 'ds', 'graph', 'geometry', 'misc'])
def test_each_algorithm_domain_can_rise_and_fall_without_changing_other_domains(
        client, container, approved_problem, domain):
    # Synthetic approved fixtures cover domains absent from the real 41-question
    # library. They are never inserted into the user's actual database.
    leaf = next(n['id'] for n in container.taxonomy.leaves() if n['id'].startswith(domain + '.'))
    good, _ = approved_problem(primary=(leaf,), difficulty=1600)
    hard_profile = '/api/users/domain-check/profile'
    response = client.post('/api/submissions', json={
        'user_id': 'domain-check', 'problem_id': good['id'], 'verdict': 'AC'})
    assert response.status_code == 201
    assert response.json()['warning'] == ''
    before = client.get(hard_profile).json()
    assert metric(before, domain)['score'] > 800
    bad, _ = approved_problem(primary=(leaf,), difficulty=800)
    response = client.post('/api/submissions', json={
        'user_id': 'domain-check', 'problem_id': bad['id'], 'verdict': 'WA'})
    assert response.status_code == 201
    after = client.get(hard_profile).json()
    assert metric(after, domain)['score'] < metric(before, domain)['score']
    assert after['overall']['score'] < before['overall']['score']
    for item in after['dimensions']:
        if item['knowledge_id'] not in (domain, 'syntax'):
            assert item['score'] == 0
            assert item['evidence_count'] == 0
    assert metric(after, domain)['evidence_count'] == 2
    assert after['overall']['evidence_count'] == 2
