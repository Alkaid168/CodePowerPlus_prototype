"""审核接口：队列、批准/驳回、乐观锁与纠正版本。"""


def review_body(analysis, action='approve', **overrides):
    base = {'action': action, 'reviewer': 'tester', 'comment': '核对', 'expected_analysis_id': analysis['analysis_id']}
    return base | overrides


def correction_payload(version, knowledge_id='basic.binary', evidence='需要在有序序列上二分'):
    return {
        'difficulty': 1600, 'confidence': 0.9,
        'primary_knowledge_ids': [knowledge_id], 'secondary_knowledge_ids': [],
        'evidence': {knowledge_id: evidence}, 'knowledge_confidence': {knowledge_id: 0.9},
        'taxonomy_version': version,
    }


def test_queue_then_approve_moves_problem(client, make_problem):
    problem, analysis = make_problem()
    queue = client.get('/api/reviews').json()['items']
    assert [item['id'] for item in queue] == [problem['id']]
    assert queue[0]['analysis']['analysis_id'] == analysis['analysis_id']

    response = client.post(f"/api/problems/{problem['id']}/review", json=review_body(analysis))
    assert response.status_code == 200, response.text
    assert response.json()['analysis']['review_status'] == 'approved'
    assert response.json()['problem']['analysis_status'] == 'approved'

    assert client.get('/api/reviews').json()['items'] == []
    approved = client.get('/api/reviews', params={'status': 'approved'}).json()['items']
    assert [item['id'] for item in approved] == [problem['id']]

    audits = client.get(f"/api/problems/{problem['id']}/reviews").json()['items']
    assert len(audits) == 1
    assert audits[0]['action'] == 'approve' and audits[0]['reviewer'] == 'tester'
    assert audits[0]['original_analysis_id'] == analysis['analysis_id']


def test_reject_marks_analysis_and_blocks_second_review(client, make_problem):
    problem, analysis = make_problem()
    rejected = client.post(f"/api/problems/{problem['id']}/review", json=review_body(analysis, action='reject'))
    assert rejected.status_code == 200
    assert rejected.json()['analysis']['review_status'] == 'rejected'
    again = client.post(f"/api/problems/{problem['id']}/review", json=review_body(analysis))
    assert again.status_code == 409
    assert again.json()['code'] == 'conflict'


def test_stale_expected_id_is_rejected(client, make_problem):
    problem, analysis = make_problem()
    stale = review_body(analysis) | {'expected_analysis_id': analysis['analysis_id'] + 1}
    response = client.post(f"/api/problems/{problem['id']}/review", json=stale)
    assert response.status_code == 409


def test_correction_creates_new_approved_revision(client, make_problem, version):
    problem, analysis = make_problem()
    response = client.post(f"/api/problems/{problem['id']}/review",
                           json=review_body(analysis, correction=correction_payload(version)))
    assert response.status_code == 200, response.text
    current = response.json()['analysis']
    assert current['analysis_id'] != analysis['analysis_id']
    assert current['review_status'] == 'approved'
    assert current['tags'] == ['二分']
    history = client.get(f"/api/problems/{problem['id']}/analyses").json()['items']
    assert [item['analysis_id'] for item in history] == [current['analysis_id'], analysis['analysis_id']]
    audits = client.get(f"/api/problems/{problem['id']}/reviews").json()['items']
    assert audits[0]['analysis_id'] == current['analysis_id']
    assert audits[0]['original_analysis_id'] == analysis['analysis_id']


def test_correction_requires_approve_and_current_version(client, make_problem):
    problem, analysis = make_problem()
    reject_with_correction = client.post(f"/api/problems/{problem['id']}/review",
                                         json=review_body(analysis, action='reject',
                                                          correction=correction_payload('2020.01.1')))
    assert reject_with_correction.status_code == 422
    wrong_version = client.post(f"/api/problems/{problem['id']}/review",
                                json=review_body(analysis, correction=correction_payload('2020.01.1')))
    assert wrong_version.status_code == 422
    assert wrong_version.json()['code'] == 'invalid_input'


def test_review_unknown_problem_is_404(client):
    response = client.post('/api/problems/999/review', json={
        'action': 'approve', 'reviewer': 'tester', 'comment': '', 'expected_analysis_id': 1})
    assert response.status_code == 404
