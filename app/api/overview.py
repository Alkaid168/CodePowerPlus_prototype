"""总览接口：给工作台首页一次性提供计数与（可选）个人薄弱知识点。"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api import problems_with_analysis
from app.container import Container, get_container
from app.schemas import OverviewOut
from app.services.profile import build_profile

router = APIRouter(tags=['overview'])


@router.get('/api/overview', response_model=OverviewOut)
def overview(user_id: str | None = None, container: Container = Depends(get_container)):
    problems = problems_with_analysis(container)
    weakest: list[dict] = []
    if user_id:
        profile = build_profile(container.submissions.history_for_user(user_id), container.taxonomy)
        ranked = [skill for skill in profile['skills']
                  if skill['level'] > 1 and skill['mastery'] is not None]
        weakest = sorted(ranked, key=lambda skill: (skill['mastery'], -skill['evidence_count']))[:5]
    return {
        'app_version': container.settings.app_version,
        'taxonomy_version': container.taxonomy.version,
        'model_configured': container.settings.model_configured,
        'problems': len(problems),
        'analyses': container.analyses.count(),
        'pending_reviews': sum(1 for p in problems if p['analysis'] and p['analysis']['review_status'] == 'pending'),
        'approved_analyses': sum(1 for p in problems if p['analysis']
                                 and p['analysis']['review_status'] == 'approved' and not p['analysis'].get('is_stale')),
        'submissions': container.submissions.count(),
        'learners': len(container.submissions.users()),
        'knowledge_nodes': len(container.taxonomy.nodes),
        'weakest_knowledge': weakest,
    }
