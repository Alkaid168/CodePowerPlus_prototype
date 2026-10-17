"""接口契约：请求与响应的数据结构。

请求模型一律禁止多余字段（extra="forbid"）。这样客户端就无法偷偷塞入
自由标签之类的字段——标签只能来自分析结果，不能由提交接口自带。
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator

from app.services.difficulty import MAX_RATING, MIN_RATING, STEP

VERDICT = Literal['AC', 'WA', 'TLE', 'MLE', 'RE', 'CE']
REVIEW_STATUS = Literal['pending', 'approved', 'rejected', 'legacy']
ANALYSIS_ORIGIN = Literal['manual', 'model', 'legacy']


class RequestModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')


class ProblemCreate(RequestModel):
    """录入一道题。题面是 Markdown（可含 LaTeX），来源可选但必须是链接。"""

    title: str = Field(min_length=1, max_length=300)
    description: str = Field(min_length=1, max_length=200000)
    source_url: str = Field(default='', max_length=2000)
    reference_solution: str = Field(default='', max_length=200000)
    reference_code: str = Field(default='', max_length=200000)

    @field_validator('source_url')
    @classmethod
    def _check_source_url(cls, value: str) -> str:
        return _normalize_url(value)


class ProblemUpdate(ProblemCreate):
    expected_revision: int = Field(gt=0)


def _normalize_url(value: str) -> str:
    text = (value or '').strip()
    if not text:
        return ''
    if not text.startswith(('http://', 'https://')):
        raise ValueError('来源必须是 http:// 或 https:// 开头的链接')
    host = text.split('://', 1)[1].split('/', 1)[0]
    if not host:
        raise ValueError('来源链接缺少域名')
    return text


class AnalysisPayload(BaseModel):
    """一次题目分析的内容；模型输出与人工标注共用同一份结构。"""

    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(default='', max_length=300)
    difficulty: int = Field(ge=MIN_RATING, le=MAX_RATING)
    difficulty_reason: str = Field(default='', max_length=2000)
    solution_idea: str = Field(default='', max_length=20000)
    confidence: float = Field(ge=0, le=1)
    primary_knowledge_ids: list[str] = Field(default_factory=list)
    secondary_knowledge_ids: list[str] = Field(default_factory=list)
    evidence: dict[str, str] = Field(default_factory=dict)
    knowledge_confidence: dict[str, float] = Field(default_factory=dict)
    taxonomy_version: str = Field(default='', max_length=40)
    model_name: str = Field(default='', max_length=100)
    prompt_version: str = Field(default='', max_length=100)
    tags: list[str] = Field(default_factory=list)
    assessment_meta: dict = Field(default_factory=dict)

    @field_validator('difficulty')
    @classmethod
    def _check_step(cls, value: int) -> int:
        if value % STEP:
            raise ValueError(f'难度评分必须是 {STEP} 的整数倍')
        return value

class AnalysisOut(AnalysisPayload):
    analysis_id: int
    problem_id: int
    review_status: REVIEW_STATUS
    origin: ANALYSIS_ORIGIN
    created_at: str
    problem_revision: int = 1
    is_stale: bool = False
    input_snapshot: dict = Field(default_factory=dict)

    @computed_field
    @property
    def difficulty_band(self) -> str:
        from app.services.difficulty import band_name
        return band_name(self.difficulty)


class ManualAnalysisRequest(AnalysisPayload):
    expected_revision: int | None = Field(default=None, gt=0)


class ReviewRequest(RequestModel):
    action: Literal['approve', 'reject']
    reviewer: str = Field(min_length=1, max_length=100)
    comment: str = Field(default='', max_length=4000)
    expected_analysis_id: int = Field(gt=0)
    correction: AnalysisPayload | None = None


class SubmissionCreate(RequestModel):
    user_id: str = Field(min_length=1, max_length=100)
    problem_id: int = Field(gt=0)
    verdict: VERDICT
    code: str = Field(default='', max_length=100000)
    language: str = Field(default='unknown', min_length=1, max_length=40)


class TutorRequest(RequestModel):
    problem: str = Field(min_length=1, max_length=100000)
    code: str = Field(min_length=1, max_length=100000)
    verdict: VERDICT


class KnowledgeNodeOut(BaseModel):
    id: str
    name: str
    level: int
    parent_id: str | None = None
    summary: str = ''
    intro_rating: int | None = None


class KnowledgeNodeTree(KnowledgeNodeOut):
    children: list['KnowledgeNodeTree'] = Field(default_factory=list)


KnowledgeNodeTree.model_rebuild()


class KnowledgeTreeOut(BaseModel):
    version: str
    total: int
    tree: list[KnowledgeNodeTree]


class KnowledgeSearchOut(BaseModel):
    version: str
    total: int
    items: list[KnowledgeNodeOut]


class KnowledgeDetailOut(KnowledgeNodeOut):
    ancestors: list[KnowledgeNodeOut]
    children: list[KnowledgeNodeOut]


class ProblemSummaryOut(BaseModel):
    id: int
    title: str
    source_url: str = ''
    created_at: str = ''
    analysis_status: REVIEW_STATUS | None = None
    knowledge_ids: list[str] = Field(default_factory=list)
    difficulty: int | None = None
    revision: int = 1
    analysis_stale: bool = False

    @computed_field
    @property
    def difficulty_band(self) -> str:
        from app.services.difficulty import band_name
        return band_name(self.difficulty)


class ProblemDetailOut(ProblemSummaryOut):
    description: str
    reference_solution: str = ''
    reference_code: str = ''
    analysis: AnalysisOut | None = None


class ProblemListOut(BaseModel):
    items: list[ProblemSummaryOut]
    total: int
    offset: int
    limit: int


class ProblemWithAnalysisOut(BaseModel):
    problem: ProblemSummaryOut
    analysis: AnalysisOut


class AnalysisHistoryOut(BaseModel):
    items: list[AnalysisOut]


class ReviewQueueOut(BaseModel):
    items: list[ProblemDetailOut]


class ReviewOut(BaseModel):
    id: int
    problem_id: int
    original_analysis_id: int
    analysis_id: int
    action: Literal['approve', 'reject']
    reviewer: str
    comment: str
    created_at: str


class ReviewListOut(BaseModel):
    items: list[ReviewOut]


class ReviewResultOut(BaseModel):
    problem: ProblemSummaryOut
    analysis: AnalysisOut


class SubmissionOut(BaseModel):
    id: int
    user_id: str
    problem_id: int
    verdict: str
    language: str
    code: str = ''
    knowledge_ids: list[str] = Field(default_factory=list)
    taxonomy_version: str = ''
    analysis_id: int | None = None
    difficulty: int | None = None
    created_at: str = ''


class SubmissionCreatedOut(SubmissionOut):
    warning: str = ''


class SubmissionListOut(BaseModel):
    items: list[SubmissionOut]
    total: int


class SkillOut(BaseModel):
    knowledge_id: str
    name: str
    level: int
    mastery: float | None = None
    evidence_count: int
    direct_evidence_count: int
    confidence: float


class ProfileOut(BaseModel):
    user_id: str
    submission_count: int
    skill_mastery: dict[str, float]
    direct_skill_mastery: dict[str, float]
    skills: list[SkillOut]
    taxonomy_version: str
    unmapped_submission_count: int
    algorithm_version: str
    explanation: str


class RecommendationOut(BaseModel):
    problem_id: int
    title: str
    source_url: str = ''
    difficulty: int | None = None
    difficulty_band: str = ''
    recommendation_score: float
    target_knowledge_ids: list[str]
    target_knowledge_names: list[str]
    reasons: list[str]
    score_breakdown: dict[str, float]
    algorithm_version: str


class RecommendationListOut(BaseModel):
    user_id: str
    taxonomy_version: str
    recommendations: list[RecommendationOut]


class PathStepOut(BaseModel):
    knowledge_id: str
    name: str
    level: int
    reason: str
    mastery: float | None = None
    problem_ids: list[int]


class LearningPathOut(BaseModel):
    user_id: str
    taxonomy_version: str
    target_id: str | None = None
    steps: list[PathStepOut]


class WeakKnowledgeOut(BaseModel):
    knowledge_id: str
    name: str
    level: int
    mastery: float | None = None
    evidence_count: int


class OverviewOut(BaseModel):
    app_version: str
    taxonomy_version: str
    model_configured: bool
    problems: int
    analyses: int
    pending_reviews: int
    approved_analyses: int
    submissions: int
    learners: int
    knowledge_nodes: int
    weakest_knowledge: list[WeakKnowledgeOut]


class HealthOut(BaseModel):
    status: str
    message: str
    version: str
    taxonomy_version: str
    model_configured: bool
    mode: str


class HintOut(BaseModel):
    hint: str


class HintPreviewOut(BaseModel):
    prompt: str
    message: str
