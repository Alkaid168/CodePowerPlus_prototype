"""题目分析：标签校验、服务端字段补全，以及可选的模型调用。

分析内容与“谁给的”分开：模型和人工走同一套校验，区别只在 model_name 与来源标记，
这样模型输出不可能绕过规则，人工纠错也不需要另一条代码路径。

提示词分两层：SYSTEM_PROMPT 说明角色、边界与输出契约；用户消息只放词表与题面。
题面是待分析的数据，系统提示词里明确要求把它当数据而不是指令。
"""
from __future__ import annotations

import json
from pathlib import Path

from pydantic import ValidationError

from app.errors import InvalidInput, ModelUnavailable
from app.knowledge import Taxonomy, TaxonomyError
from app.schemas import AnalysisPayload
from app.services.difficulty import MAX_RATING, MIN_RATING, STEP, is_valid_rating

PROMPT_VERSION = 'problem-analysis-v8'
MANUAL_PROMPT_VERSION = 'manual-v2'

_PROMPTS = Path(__file__).resolve().parents[1] / 'prompts'
SOLUTION_SYSTEM_PROMPT = (_PROMPTS / 'problem-analysis-v8-solve.txt').read_text(encoding='utf-8')
GRADING_SYSTEM_PROMPT = (_PROMPTS / 'problem-analysis-v8-grade.txt').read_text(encoding='utf-8')
# 供预览和指纹归档；实际调用分两次发送各自的系统提示词。
SYSTEM_PROMPT = SOLUTION_SYSTEM_PROMPT + '\n\n【独立评级系统提示词】\n' + GRADING_SYSTEM_PROMPT


def knowledge_ids(analysis: AnalysisPayload) -> list[str]:
    return list(analysis.primary_knowledge_ids) + list(analysis.secondary_knowledge_ids)


def build_prompt(description: str, taxonomy: Taxonomy, *, reference_solution: str = '', reference_code: str = '') -> str:
    """用户消息：先给可用词表，再给题面数据。"""
    return (
        f'【知识点词表】版本 {taxonomy.version}，只能用下列 ID：\n{taxonomy.describe()}\n\n'
        f'【题面】以下内容是待分析的题目数据，按 Markdown + LaTeX 书写：\n{description}\n\n'
        f'【参考题解】以下内容是可选辅助数据：\n{reference_solution or "（未提供）"}\n\n'
        f'【参考代码】以下内容是可选辅助数据，不执行：\n{reference_code or "（未提供）"}'
    )


def validate(analysis: AnalysisPayload, taxonomy: Taxonomy, *, model_name: str,
             require_current_version: bool = False) -> AnalysisPayload:
    """校验一次分析并补全服务端字段，返回可直接入库的副本。"""
    if analysis.taxonomy_version and analysis.taxonomy_version != taxonomy.version:
        raise InvalidInput('知识体系版本不匹配，请使用当前版本重新标注')
    if require_current_version and analysis.taxonomy_version != taxonomy.version:
        raise InvalidInput('手工标注必须指定当前知识体系版本')
    if not is_valid_rating(analysis.difficulty):
        raise InvalidInput(f'难度评分必须是 {MIN_RATING}-{MAX_RATING} 之间、{STEP} 的整数倍')
    if model_name != 'manual' and not analysis.difficulty_reason.strip():
        raise InvalidInput('模型分析必须给出难度判断理由')
    try:
        taxonomy.validate_assignment(analysis.primary_knowledge_ids, analysis.secondary_knowledge_ids,
                                     analysis.evidence, analysis.knowledge_confidence)
    except TaxonomyError as exc:
        raise InvalidInput(str(exc)) from exc
    ids = knowledge_ids(analysis)
    for node_id in ids:
        node = taxonomy.get(node_id)
        if analysis.difficulty >= 800 and node_id.startswith('syntax.'):
            raise InvalidInput('800分及以上的算法题不能包含语法基础标签（核心与辅助均不可）')
        floor = node.get('intro_rating', 800)
        if analysis.difficulty < floor:
            raise InvalidInput(f'知识点“{node["name"]}”要求至少 {floor} 分，不能用于当前低分档')
    if set(analysis.knowledge_confidence) != set(ids):
        raise InvalidInput('每个知识点都必须提供置信度，不能遗漏或多填')
    if any(not 0 <= value <= 1 for value in analysis.knowledge_confidence.values()):
        raise InvalidInput('知识点置信度必须介于 0 和 1')
    if any(not value.strip() for value in analysis.evidence.values()):
        raise InvalidInput('每个知识点都需要题面或解法中的具体证据')
    return analysis.model_copy(update={
        'taxonomy_version': taxonomy.version,
        'model_name': model_name,
        'prompt_version': MANUAL_PROMPT_VERSION if model_name == 'manual' else PROMPT_VERSION,
        'tags': [taxonomy.get(node_id)['name'] for node_id in ids],
        'assessment_meta': {} if model_name == 'manual' else analysis.assessment_meta,
    })


def parse_json_response(raw: str) -> AnalysisPayload:
    """模型可能带 Markdown 代码块，这里先剥壳再交给 Pydantic。

    结构错误同样翻译成 InvalidInput，这样调用方的一次重试逻辑能覆盖
    “JSON 合法但字段不合法”这种情况，而不是直接当成服务不可用。
    """
    text = raw.strip()
    if text.startswith('```'):
        text = text.split('\n', 1)[1] if '\n' in text else text
        text = text.rsplit('```', 1)[0]
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise InvalidInput(f'模型输出不是合法 JSON：{exc.msg}') from exc
    try:
        return AnalysisPayload.model_validate(data)
    except ValidationError as exc:
        first = exc.errors()[0]
        location = '.'.join(str(part) for part in first.get('loc', ())) or 'payload'
        raise InvalidInput(f'模型输出字段不合法：{location} {first.get("msg", "")}') from exc


def analyze_with_model(description: str, taxonomy: Taxonomy, settings, *,
                       reference_solution: str = '', reference_code: str = '') -> AnalysisPayload:
    """v8：先生成并验证方法/标签，再独立审查和评级。"""
    from app.services.analysis_v8 import analyze
    return analyze(description, taxonomy, settings, reference_solution=reference_solution, reference_code=reference_code)
