"""v8两阶段真实数据流：解法/方法标签先冻结，再按新生门槛审查与评级。"""
from __future__ import annotations

import json
import time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.errors import InvalidInput, ModelUnavailable
from app.knowledge import TaxonomyError
from app.schemas import AnalysisPayload
from app.services.analysis import (GRADING_SYSTEM_PROMPT, SOLUTION_SYSTEM_PROMPT, build_prompt, validate)
from app.services.difficulty import is_valid_rating

PIPELINE_VERSION = 'solve-grade-v8.0'


class Structured(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')


class MethodPlan(Structured):
    name: str = Field(min_length=1)
    knowledge_ids: list[str] = Field(min_length=1)
    time_complexity: str = Field(min_length=1)
    space_complexity: str = Field(min_length=1)


class SolutionPlan(Structured):
    title: str = Field(min_length=1, max_length=300)
    kind: Literal['syntax', 'algorithm']
    solution_idea: str = Field(min_length=1, max_length=20000)
    methods: list[MethodPlan] = Field(min_length=1)
    primary_knowledge_ids: list[str] = Field(min_length=1)
    secondary_knowledge_ids: list[str]
    evidence: dict[str, str]
    knowledge_confidence: dict[str, float]
    confidence: float = Field(ge=0, le=1)


class Rubric(Structured):
    knowledge: str = Field(min_length=1)
    modelling: str = Field(min_length=1)
    proof: str = Field(min_length=1)
    implementation: str = Field(min_length=1)


class Grade(Structured):
    rubric: Rubric
    consistency_issues: list[str]
    difficulty: int
    difficulty_reason: str = Field(min_length=1, max_length=2000)
    confidence: float = Field(ge=0, le=1)


def check_plan(plan: SolutionPlan, taxonomy):
    ids = plan.primary_knowledge_ids + plan.secondary_knowledge_ids
    try:
        taxonomy.validate_assignment(plan.primary_knowledge_ids, plan.secondary_knowledge_ids,
                                     plan.evidence, plan.knowledge_confidence)
    except TaxonomyError as exc:
        raise InvalidInput(str(exc)) from exc
    if any(node.startswith('syntax.') != (plan.kind == 'syntax') for node in ids):
        raise InvalidInput('解法类别与语法/算法标签互斥规则不一致')
    method_ids = set()
    for method in plan.methods:
        if len(method.knowledge_ids) != len(set(method.knowledge_ids)):
            raise InvalidInput('方法知识点ID不能重复')
        method_ids.update(method.knowledge_ids)
    if method_ids != set(ids):
        raise InvalidInput('方法知识点与最终标签必须一致，不能遗漏方法所需知识或增加无方法依据标签')
    return plan


def assemble(plan, grade, taxonomy, settings):
    if not is_valid_rating(grade.difficulty):
        raise InvalidInput('难度必须为100–3500之间100的整数倍')
    if (grade.difficulty <= 700) != (plan.kind == 'syntax'):
        raise InvalidInput('评级与已验证的语法/算法类别不一致，请重新独立评级，不改标签规避')
    payload = AnalysisPayload(title=plan.title, solution_idea=plan.solution_idea,
        primary_knowledge_ids=plan.primary_knowledge_ids, secondary_knowledge_ids=plan.secondary_knowledge_ids,
        evidence=plan.evidence, knowledge_confidence=plan.knowledge_confidence,
        confidence=min(plan.confidence, grade.confidence), difficulty=grade.difficulty,
        difficulty_reason=grade.difficulty_reason)
    return validate(payload, taxonomy, model_name=settings.model)


def _json(raw, schema):
    text = raw.strip()
    if text.startswith('```'):
        text = text.split('\n', 1)[-1].rsplit('```', 1)[0]
    try:
        return schema.model_validate(json.loads(text))
    except (ValueError, ValidationError) as exc:
        raise InvalidInput(f'结构化响应不符合{schema.__name__}：{str(exc)[:600]}') from None


def _request(client, settings, stage, messages, schema, checker, calls):
    for attempt in range(2):
        start = time.monotonic()
        response = client.chat.completions.create(model=settings.model, messages=messages, temperature=0,
                                                   response_format={'type': 'json_object'})
        raw = response.choices[0].message.content or ''
        event = {'stage': stage, 'attempt': attempt + 1, 'request_model': settings.model,
                 'response_model': getattr(response, 'model', None), 'response_id': getattr(response, 'id', None),
                 'usage': response.usage.model_dump() if getattr(response, 'usage', None) is not None else None,
                 'elapsed_seconds': round(time.monotonic() - start, 3), 'valid': False, 'response_text': raw}
        calls.append(event)
        try:
            parsed = checker(_json(raw, schema))
            event['valid'] = True
            return parsed
        except InvalidInput as exc:
            event['validation_error'] = str(exc)
            if attempt:
                raise ModelUnavailable(f'v8的{stage}阶段连续未通过结构或一致性校验') from None
            # 必须把模型自己被拒绝的JSON反馈回去，不能只有一条没有上下文的泛泛重试。
            messages.extend([{'role': 'assistant', 'content': raw},
                             {'role': 'user', 'content': f'校验未通过：{exc}。请修正并重新输出本阶段完整JSON。'}])


def analyze(description, taxonomy, settings, *, reference_solution='', reference_code=''):
    from openai import OpenAI, OpenAIError
    if not settings.model_configured:
        raise ModelUnavailable('尚未配置模型密钥，请使用手工标注或配置DEEPSEEK_API_KEY')
    solve_messages = [{'role': 'system', 'content': SOLUTION_SYSTEM_PROMPT},
        {'role': 'user', 'content': build_prompt(description, taxonomy,
            reference_solution=reference_solution, reference_code=reference_code)}]
    calls = []
    start = time.monotonic()
    try:
        with OpenAI(api_key=settings.api_key, base_url=settings.base_url,
                    timeout=settings.request_timeout, max_retries=1) as client:
            for cycle in range(2):
                plan = _request(client, settings, 'solve', solve_messages, SolutionPlan,
                                 lambda value: check_plan(value, taxonomy), calls)
                selected_nodes = [taxonomy.get(node) for node in plan.primary_knowledge_ids + plan.secondary_knowledge_ids]
                grade_messages = [{'role': 'system', 'content': GRADING_SYSTEM_PROMPT},
                    {'role': 'user', 'content': json.dumps({'problem': description, 'solution': plan.model_dump(),
                                                          'selected_knowledge': selected_nodes}, ensure_ascii=False)}]
                def check_grade(value):
                    if not value.consistency_issues:
                        assemble(plan, value, taxonomy, settings)
                    return value
                grade = _request(client, settings, 'grade', grade_messages, Grade, check_grade, calls)
                calls[-1]['consistent'] = not grade.consistency_issues
                if grade.consistency_issues:
                    if cycle:
                        raise ModelUnavailable('v8评级审查仍发现解法/标签实质问题，未生成可用分析')
                    solve_messages.extend([{'role': 'assistant', 'content': plan.model_dump_json()},
                        {'role': 'user', 'content': '独立审查发现问题：' + '；'.join(grade.consistency_issues)
                         + '。请重新检查完整约束并生成本阶段完整JSON，不给评分，不用改类别掩盖问题。'}])
                    continue
                result = assemble(plan, grade, taxonomy, settings)
                return result.model_copy(update={'assessment_meta': {
                    'pipeline_version': PIPELINE_VERSION, 'calls': calls, 'solution_record': plan.model_dump(),
                    'grading_record': grade.model_dump(), 'elapsed_seconds': round(time.monotonic() - start, 3),
                    'sdk_transport_retries': 1, 'confidence_policy': 'min_of_two_uncalibrated_self_reports'}})
    except ModelUnavailable:
        raise
    except OpenAIError:
        raise ModelUnavailable('模型服务暂不可用；v8未生成可用分析，请稍后重试') from None
    except Exception as exc:
        raise ModelUnavailable(f'v8模型客户端失败（{type(exc).__name__}）') from None
