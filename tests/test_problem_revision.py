"""单题维护闭环：全部使用隔离夹具，参考材料是机器构造的测试输入。"""
from app.services.analysis import build_prompt
import pytest


def update_body(problem, **changes):
    return {key: problem.get(key, '') for key in
            ('title', 'description', 'source_url', 'reference_solution', 'reference_code')} | {
                'expected_revision': problem['revision']} | changes


def test_reference_materials_are_optional_and_round_trip(client):
    created = client.post('/api/problems', json={
        'title': '测试输入', 'description': '区间求和',
        'reference_solution': '构造前缀和', 'reference_code': 'int main() {}'})
    assert created.status_code == 201
    problem = client.get(f"/api/problems/{created.json()['id']}").json()
    assert problem['revision'] == 1
    assert problem['reference_solution'] == '构造前缀和'
    assert problem['reference_code'] == 'int main() {}'


def test_revision_invalidates_approved_analysis_without_rewriting_history(client, approved_problem):
    problem, analysis = approved_problem()
    original = client.post('/api/submissions', json={
        'user_id': 'revision-test', 'problem_id': problem['id'], 'verdict': 'AC'}).json()
    detail = client.get(f"/api/problems/{problem['id']}").json()
    changed = client.put(f"/api/problems/{problem['id']}", json=update_body(detail, description='新的题面'))
    assert changed.status_code == 200, changed.text
    assert changed.json()['revision'] == 2
    assert changed.json()['analysis_stale'] is True
    history = client.get(f"/api/problems/{problem['id']}/analyses").json()['items']
    assert history[0]['review_status'] == 'approved'
    assert history[0]['input_snapshot']['description'] == detail['description']
    assert history[0]['problem_revision'] == 1
    fresh = client.post('/api/submissions', json={
        'user_id': 'revision-test', 'problem_id': problem['id'], 'verdict': 'AC'}).json()
    assert fresh['knowledge_ids'] == []
    records = client.get('/api/submissions?user_id=revision-test').json()['items']
    assert next(row for row in records if row['id'] == original['id'])['analysis_id'] == analysis['analysis_id']
    assert client.get('/api/users/new-user/recommendations').json()['recommendations'] == []
    assert client.get('/api/overview').json()['approved_analyses'] == 0


def test_conflicting_edit_and_no_op(client, make_problem):
    problem, _ = make_problem()
    detail = client.get(f"/api/problems/{problem['id']}").json()
    assert client.put(f"/api/problems/{problem['id']}", json=update_body(detail)).json()['revision'] == 1
    assert client.put(f"/api/problems/{problem['id']}", json=update_body(detail, title='修订')).status_code == 200
    assert client.put(f"/api/problems/{problem['id']}", json=update_body(detail, title='覆盖')).status_code == 409
    assert client.get(f"/api/problems/{problem['id']}").json()['title'] == '修订'


def test_stale_pending_analysis_cannot_be_approved(client, make_problem):
    problem, analysis = make_problem()
    detail = client.get(f"/api/problems/{problem['id']}").json()
    client.put(f"/api/problems/{problem['id']}", json=update_body(detail, reference_code='new code'))
    response = client.post(f"/api/problems/{problem['id']}/review", json={
        'action': 'approve', 'reviewer': 'test', 'expected_analysis_id': analysis['analysis_id']})
    assert response.status_code == 409
    assert client.get(f"/api/problems/{problem['id']}/reviews").json()['items'] == []


def test_edit_during_model_call_does_not_save_analysis_of_old_input(client, make_problem, monkeypatch):
    from app.api import problems as endpoint
    from app.schemas import AnalysisPayload
    problem, analysis = make_problem()
    detail = client.get(f"/api/problems/{problem['id']}").json()
    def fake(*args, **kwargs):
        client.put(f"/api/problems/{problem['id']}", json=update_body(detail, description='分析期间修改'))
        return AnalysisPayload.model_validate(analysis)
    monkeypatch.setattr(endpoint, 'analyze_with_model', fake)
    response = client.post(f"/api/problems/{problem['id']}/analyze")
    assert response.status_code == 409, response.text
    assert len(client.get(f"/api/problems/{problem['id']}/analyses").json()['items']) == 1


def test_model_receives_reference_materials(client, make_problem, monkeypatch):
    from app.api import problems as endpoint
    from app.schemas import AnalysisPayload
    problem, analysis = make_problem()
    detail = client.get(f"/api/problems/{problem['id']}").json()
    client.put(f"/api/problems/{problem['id']}", json=update_body(
        detail, reference_solution='前缀和 O(n+q)', reference_code='int main() {}'))
    def fake(description, taxonomy, settings, **materials):
        assert materials['reference_solution'] == '前缀和 O(n+q)'
        assert materials['reference_code'] == 'int main() {}'
        return AnalysisPayload.model_validate(analysis)
    monkeypatch.setattr(endpoint, 'analyze_with_model', fake)
    saved = client.post(f"/api/problems/{problem['id']}/analyze")
    assert saved.status_code == 201, saved.text
    assert saved.json()['analysis']['problem_revision'] == 2
    assert saved.json()['analysis']['is_stale'] is False


def test_prompt_keeps_material_boundaries(container):
    prompt = build_prompt('题面', container.taxonomy, reference_solution='参考解法', reference_code='参考代码')
    assert '【参考题解】' in prompt and '【参考代码】' in prompt
    assert '参考解法' in prompt and '参考代码' in prompt


def test_review_correction_retains_all_fields_and_history(client, make_problem, version):
    problem, analysis = make_problem()
    correction = {key: analysis[key] for key in (
        'primary_knowledge_ids', 'secondary_knowledge_ids', 'evidence', 'knowledge_confidence')}
    correction.update(difficulty=1800, confidence=0.7, difficulty_reason='需要转换',
                      solution_idea='原思路保留并补充', taxonomy_version=version)
    result = client.post(f"/api/problems/{problem['id']}/review", json={
        'action': 'approve', 'reviewer': 'test', 'expected_analysis_id': analysis['analysis_id'],
        'correction': correction})
    assert result.status_code == 200, result.text
    assert result.json()['analysis']['solution_idea'] == correction['solution_idea']
    assert result.json()['analysis']['difficulty'] == 1800
    assert len(client.get(f"/api/problems/{problem['id']}/analyses").json()['items']) == 2


def test_stale_manual_editor_cannot_attach_old_labels_to_new_input(client, make_problem, version):
    problem, analysis = make_problem()
    detail = client.get(f"/api/problems/{problem['id']}").json()
    client.put(f"/api/problems/{problem['id']}", json=update_body(detail, description='新题面'))
    response = client.post(f"/api/problems/{problem['id']}/analyses", json={
        **analysis, 'expected_revision': 1, 'taxonomy_version': version})
    assert response.status_code == 409, response.text
    assert len(client.get(f"/api/problems/{problem['id']}/analyses").json()['items']) == 1


def test_failed_review_audit_rolls_back_correction(client, container, make_problem, monkeypatch):
    problem, analysis = make_problem()
    def fail(*args, **kwargs):
        raise RuntimeError('test audit failure')
    monkeypatch.setattr(container.reviews, 'add', fail)
    with pytest.raises(RuntimeError, match='test audit failure'):
        client.post(f"/api/problems/{problem['id']}/review", json={
            'action': 'approve', 'reviewer': 'test', 'expected_analysis_id': analysis['analysis_id'],
            'correction': analysis})
    history = client.get(f"/api/problems/{problem['id']}/analyses").json()['items']
    assert len(history) == 1 and history[0]['review_status'] == 'pending'
    assert container.db.conn.in_transaction is False
