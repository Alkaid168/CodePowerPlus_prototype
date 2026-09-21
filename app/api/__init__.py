"""HTTP 接口层：只做参数解析、依赖装配与响应组装，业务规则放在 services。"""
from __future__ import annotations

from app.container import Container
from app.errors import NotFound
from app.services.recommend import tags_of


def problem_summary(problem: dict, analysis: dict | None) -> dict:
    """列表与卡片需要的最小字段，避免把整份分析都发给前端。"""
    return {
        'id': problem['id'],
        'title': problem['title'],
        'source_url': problem.get('source_url', ''),
        'created_at': problem.get('created_at', ''),
        'analysis_status': analysis['review_status'] if analysis else None,
        'knowledge_ids': tags_of(analysis) if analysis else [],
        'difficulty': analysis.get('difficulty') if analysis else None,
    }


def problem_detail(problem: dict, analysis: dict | None) -> dict:
    return {**problem_summary(problem, analysis), 'description': problem['description'], 'analysis': analysis}


def problems_with_analysis(container: Container) -> list[dict]:
    """题目列表加上各自最新分析，供推荐、队列与总览复用。"""
    problems = container.problems.all()
    latest = container.analyses.latest_by_problem([problem['id'] for problem in problems])
    return [{**problem, 'analysis': latest.get(problem['id'])} for problem in problems]


def require_problem(container: Container, problem_id: int) -> dict:
    problem = container.problems.get(problem_id)
    if problem is None:
        raise NotFound(f'题目 {problem_id} 不存在')
    return problem
