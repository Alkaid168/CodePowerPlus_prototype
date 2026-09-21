"""题目接口：录入、列表、详情、模型分析、手工标注、版本历史。

录入与分析是两步：`POST /api/problems` 先落库并分配 OJ 编号，
`POST /api/problems/{id}/analyze` 再调用模型。
拆开的好处是模型不可用时题目仍然存在，用户可以重试或改手工标注，
不会出现“模型失败 → 题面丢失”的情况。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api import problem_detail, problem_summary, require_problem
from app.container import Container, get_container
from app.schemas import (AnalysisHistoryOut, AnalysisPayload, ProblemCreate, ProblemDetailOut, ProblemListOut,
                         ProblemWithAnalysisOut)
from app.services.analysis import analyze_with_model, validate

router = APIRouter(prefix='/api/problems', tags=['problems'])


@router.post('', response_model=ProblemDetailOut, status_code=201)
def create_problem(payload: ProblemCreate, container: Container = Depends(get_container)):
    """录入一道题。题面按 Markdown 保存，编号由系统自动分配（从 1000 开始）。"""
    problem = container.problems.create(payload.title, payload.description, payload.source_url)
    return problem_detail(problem, None)


@router.get('', response_model=ProblemListOut)
def list_problems(q: str = '', limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                  container: Container = Depends(get_container)):
    problems, total = container.problems.list(q, limit, offset)
    latest = container.analyses.latest_by_problem([problem['id'] for problem in problems])
    return {'items': [problem_summary(problem, latest.get(problem['id'])) for problem in problems],
            'total': total, 'offset': offset, 'limit': limit}


@router.get('/{problem_id}', response_model=ProblemDetailOut)
def get_problem(problem_id: int, container: Container = Depends(get_container)):
    problem = require_problem(container, problem_id)
    return problem_detail(problem, container.analyses.latest(problem_id))


@router.post('/{problem_id}/analyze', response_model=ProblemWithAnalysisOut, status_code=201)
def analyze_existing_problem(problem_id: int, container: Container = Depends(get_container)):
    """调用模型分析一道已录入的题目，结果作为新的待审核版本保存。"""
    problem = require_problem(container, problem_id)
    analysis = analyze_with_model(problem['description'], container.taxonomy, container.settings)
    saved = container.analyses.add(problem_id, {**analysis.model_dump(), 'title': problem['title']},
                                   origin='model', status='pending', taxonomy_version=container.taxonomy.version)
    return {'problem': problem_summary(problem, saved), 'analysis': saved}


@router.post('/{problem_id}/analyses', response_model=ProblemWithAnalysisOut, status_code=201)
def manual_analysis(problem_id: int, payload: AnalysisPayload, container: Container = Depends(get_container)):
    """人工标注或纠正：与模型输出走同一套校验，保存为新的待审核版本。"""
    problem = require_problem(container, problem_id)
    analysis = validate(payload, container.taxonomy, model_name='manual', require_current_version=True)
    saved = container.analyses.add(problem_id, analysis.model_dump(), origin='manual', status='pending',
                                   taxonomy_version=container.taxonomy.version)
    return {'problem': problem_summary(problem, saved), 'analysis': saved}


@router.get('/{problem_id}/analyses', response_model=AnalysisHistoryOut)
def analysis_history(problem_id: int, container: Container = Depends(get_container)):
    require_problem(container, problem_id)
    return {'items': container.analyses.history(problem_id)}
