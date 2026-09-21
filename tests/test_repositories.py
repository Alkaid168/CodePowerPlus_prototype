"""仓储层：分析版本不可变、审核状态推导、提交序列化。"""
import pytest

from app.db import Database
from app.repositories import AnalysisRepository, ProblemRepository, ReviewRepository, SubmissionRepository


@pytest.fixture()
def repos(tmp_path):
    db = Database(tmp_path / 'repos.db')
    yield db, ProblemRepository(db), AnalysisRepository(db), ReviewRepository(db), SubmissionRepository(db)
    db.close()


def test_problem_crud_and_search(repos):
    db, problems, *_ = repos
    first = problems.create('两数之和', '给定数组和目标值', 'https://example.com/p/1')
    problems.create('区间和', '多次询问区间和')
    assert problems.get(first['id'])['title'] == '两数之和'
    assert problems.get(first['id'])['source_url'] == 'https://example.com/p/1'
    assert problems.count() == 2
    items, total = problems.list('区间')
    assert total == 1 and items[0]['title'] == '区间和'
    assert [problem['id'] for problem in problems.all()] == [first['id'] + 1, first['id']]


def test_analysis_revisions_are_immutable(repos):
    db, problems, analyses, _, _ = repos
    problem = problems.create('题', '描述')
    first = analyses.add(problem['id'], {'difficulty': 2}, origin='manual', taxonomy_version='v1')
    second = analyses.add(problem['id'], {'difficulty': 3}, origin='model', taxonomy_version='v1')
    assert first['analysis_id'] != second['analysis_id']
    assert analyses.latest(problem['id'])['analysis_id'] == second['analysis_id']
    assert [item['analysis_id'] for item in analyses.history(problem['id'])] == [
        second['analysis_id'], first['analysis_id']]
    assert analyses.get(first['analysis_id'])['review_status'] == 'pending'
    assert analyses.latest_by_problem([problem['id']])[problem['id']]['difficulty'] == 3


def test_review_status_comes_from_latest_review(repos):
    db, problems, analyses, reviews, _ = repos
    problem = problems.create('题', '描述')
    analysis = analyses.add(problem['id'], {'difficulty': 2}, origin='manual')
    reviews.add(problem['id'], analysis['analysis_id'], analysis['analysis_id'], 'approve', 'tester', 'ok')
    assert analyses.get(analysis['analysis_id'])['review_status'] == 'approved'
    assert analyses.latest(problem['id'])['review_status'] == 'approved'
    assert reviews.list_for_problem(problem['id'])[0]['reviewer'] == 'tester'
    assert reviews.count() == 1


def test_submission_serialization_and_pagination(repos):
    db, problems, analyses, _, submissions = repos
    problem = problems.create('题', '描述')
    item = submissions.add('u1', problem['id'], 'AC', code='int main(){}', language='cpp',
                           knowledge_ids=['basic.prefix-sum'], taxonomy_version='v1',
                           analysis_id=1, difficulty=2)
    assert item['knowledge_ids'] == ['basic.prefix-sum']
    assert item['created_at']
    items, total = submissions.list('u1')
    assert total == 1 and items[0]['verdict'] == 'AC'
    assert submissions.history_for_user('u1')[0]['id'] == item['id']
    assert submissions.users() == ['u1']
    assert submissions.count() == 1
