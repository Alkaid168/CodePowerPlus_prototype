"""请求契约：多余字段一律拒绝，取值范围由 Pydantic 兜住。"""
import pytest
from pydantic import ValidationError

from app.schemas import AnalysisPayload, ProblemCreate, ReviewRequest, SubmissionCreate


def test_extra_fields_are_rejected():
    with pytest.raises(ValidationError):
        SubmissionCreate(user_id='u1', problem_id=1, verdict='AC', tags=['forged'])
    with pytest.raises(ValidationError):
        ProblemCreate(title='t', description='d', owner='me')
    with pytest.raises(ValidationError):
        ReviewRequest(action='approve', reviewer='r', expected_analysis_id=1, extra='x')


def test_value_ranges_are_validated():
    with pytest.raises(ValidationError):
        SubmissionCreate(user_id='u1', problem_id=1, verdict='OK')
    with pytest.raises(ValidationError):
        SubmissionCreate(user_id='', problem_id=1, verdict='AC')
    # 项目难度为 100–3500，必须是 100 的整数倍。
    with pytest.raises(ValidationError):
        AnalysisPayload(difficulty=0, confidence=0.5)
    with pytest.raises(ValidationError):
        AnalysisPayload(difficulty=50, confidence=0.5)
    with pytest.raises(ValidationError):
        AnalysisPayload(difficulty=3600, confidence=0.5)
    with pytest.raises(ValidationError):
        AnalysisPayload(difficulty=1250, confidence=0.5)
    with pytest.raises(ValidationError):
        AnalysisPayload(difficulty=1600, confidence=1.5)
    valid = AnalysisPayload(difficulty=1600, confidence=0.5,
                            primary_knowledge_ids=['basic.prefix-sum'],
                            evidence={'basic.prefix-sum': '前缀和'},
                            knowledge_confidence={'basic.prefix-sum': 0.5})
    assert valid.taxonomy_version == ''


def test_source_url_must_be_a_link():
    assert ProblemCreate(title='t', description='d').source_url == ''
    assert ProblemCreate(title='t', description='d',
                         source_url='https://codeforces.com/problemset/problem/1/A').source_url.startswith('https://')
    for bad in ('codeforces.com/1/A', 'ftp://example.com', 'https://'):
        with pytest.raises(ValidationError):
            ProblemCreate(title='t', description='d', source_url=bad)
