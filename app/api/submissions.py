"""提交接口：记录判题结果，并自动带上题目当前已审核分析的标签。

客户端不能自带标签：提交的知识证据只能来自该题当前版本、已审核的分析，
否则用户就能用自由文本污染画像。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api import require_problem
from app.container import Container, get_container
from app.schemas import SubmissionCreate, SubmissionCreatedOut, SubmissionListOut
from app.services.recommend import tags_of

router = APIRouter(prefix='/api/submissions', tags=['submissions'])


def approved_evidence(container: Container, problem_id: int) -> tuple[list[str], dict | None]:
    analysis = container.analyses.latest(problem_id)
    if (analysis is None or analysis.get('review_status') != 'approved'
            or analysis.get('is_stale')
            or analysis.get('taxonomy_version') != container.taxonomy.version):
        return [], None
    ids = tags_of(analysis)
    return (ids, analysis) if container.taxonomy.allowed(ids) else ([], None)


@router.post('', response_model=SubmissionCreatedOut, status_code=201)
def create_submission(payload: SubmissionCreate, container: Container = Depends(get_container)):
    with container.db.transaction():
        require_problem(container, payload.problem_id)
        knowledge_ids, analysis = approved_evidence(container, payload.problem_id)
        submission = container.submissions.add(
            payload.user_id, payload.problem_id, payload.verdict, code=payload.code, language=payload.language,
            knowledge_ids=knowledge_ids, taxonomy_version=container.taxonomy.version if analysis else '',
            analysis_id=analysis['analysis_id'] if analysis else None,
            difficulty=analysis.get('difficulty') if analysis else None)
    submission['warning'] = '' if analysis else '题目尚无当前版本的已审核分析，本次提交暂不计入知识点画像。'
    return submission


@router.get('', response_model=SubmissionListOut)
def list_submissions(user_id: str | None = None, limit: int = Query(50, ge=1, le=500),
                     offset: int = Query(0, ge=0), container: Container = Depends(get_container)):
    items, total = container.submissions.list(user_id, limit, offset)
    return {'items': items, 'total': total}
