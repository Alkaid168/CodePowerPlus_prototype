"""学习者接口：能力画像、推荐与学习路径。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api import problems_with_analysis
from app.container import Container, get_container
from app.errors import InvalidInput
from app.schemas import LearningPathOut, RecommendationListOut
from app.services.profile import build_profile
from app.services.recommend import learning_path, recommend
from app.services.user_profile import build_profile as build_user_profile
from app.user_profile_schemas import LearnerProfileOut

router = APIRouter(prefix='/api/users', tags=['learners'])


def learner_state(container: Container, user_id: str) -> tuple[list[dict], dict, set[int]]:
    records = container.submissions.history_for_user(user_id)
    profile = build_profile(records, container.taxonomy)
    solved = {record['problem_id'] for record in records if record['verdict'] == 'AC'}
    return records, profile, solved


@router.get('/{user_id}/profile', response_model=LearnerProfileOut)
def get_profile(user_id: str, container: Container = Depends(get_container)):
    records = container.submissions.history_for_user(user_id)
    try:
        return build_user_profile(user_id, records, container.taxonomy)
    except ValueError as exc:
        raise InvalidInput(str(exc)) from exc


@router.get('/{user_id}/recommendations', response_model=RecommendationListOut)
def get_recommendations(user_id: str, limit: int = Query(10, ge=1, le=50),
                        container: Container = Depends(get_container)):
    _, profile, solved = learner_state(container, user_id)
    items = recommend(problems_with_analysis(container), profile['direct_skill_mastery'], solved,
                      container.taxonomy, limit)
    return {'user_id': user_id, 'taxonomy_version': container.taxonomy.version, 'recommendations': items}


@router.get('/{user_id}/learning-path', response_model=LearningPathOut)
def get_learning_path(user_id: str, target_id: str | None = None,
                      container: Container = Depends(get_container)):
    _, profile, solved = learner_state(container, user_id)
    try:
        steps = learning_path(problems_with_analysis(container), profile['direct_skill_mastery'], solved,
                              container.taxonomy, target_id)
    except ValueError as exc:
        raise InvalidInput(str(exc)) from exc
    return {'user_id': user_id, 'taxonomy_version': container.taxonomy.version,
            'target_id': target_id, 'steps': steps}
