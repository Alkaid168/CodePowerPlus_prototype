"""Typed outputs for zero-start, submission-driven ratings."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class ProfileScoreOut(BaseModel):
    score: int
    source: Literal['default', 'problem_evidence']
    uncertainty: float | None
    evidence_count: int


class ProfileDimensionOut(ProfileScoreOut):
    evidence_count: float
    knowledge_id: str
    name: str
    latent_mean: float


class LearnerProfileOut(BaseModel):
    profile_version: str
    user_id: str
    stage: Literal['syntax', 'algorithms']
    parameters: dict[str, float]
    unmapped_submission_count: int
    updated_at: datetime | None
    overall: ProfileScoreOut
    dimensions: list[ProfileDimensionOut]
