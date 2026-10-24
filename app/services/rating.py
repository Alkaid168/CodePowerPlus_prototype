"""动态一维贝叶斯IRT：有效作答证据 -> 能力概率分布。

时间只扩散不确定性；一次观测只更新一次。这里不决定实际代码归因、
原始提交如何合并成解题过程，或九领域如何聚合总分。
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import math
from typing import Literal

import numpy as np
from scipy.special import ive, logsumexp

ALGORITHM_VERSION = 'dynamic-bayesian-irt-v1'
MAX_EVENTS = 500
MAX_DAYS = 36525
MAX_GRID_POINTS = 262144


@dataclass(frozen=True)
class RatingConfig:
    prior_mean: float = 800
    prior_sd: float = 800
    practice_offset: float = 200
    drift_sd_per_30_days: float = 100
    grid_step: float = 10

    def __post_init__(self):
        limits = {'prior_mean': (-10000, 10000), 'prior_sd': (20, 2000),
                  'practice_offset': (0, 1000), 'drift_sd_per_30_days': (0, 300),
                  'grid_step': (1, 20)}
        for name, (low, high) in limits.items():
            value = getattr(self, name)
            if not math.isfinite(value) or not low <= value <= high:
                raise ValueError(f'{name}必须是{low}到{high}之间的有限数')
        if self.grid_step > self.prior_sd / 2:
            raise ValueError('网格步长不得大于初始标准差的一半')


@dataclass(frozen=True)
class Observation:
    problem_id: str
    occurred_at: datetime
    difficulty: float
    success: bool
    context: Literal['practice', 'contest'] = 'practice'


def success_probability(rating: float, difficulty: float, offset: float = 200) -> float:
    if not all(math.isfinite(x) for x in (rating, difficulty, offset)):
        raise ValueError('概率参数必须为有限数')
    z = math.log(10) * (rating + offset - difficulty) / 400
    return 1 / (1 + math.exp(-z)) if z >= 0 else math.exp(z) / (1 + math.exp(z))


class RatingDistribution:
    """等间距网格上的全分布，不将后验重新压成正态分布。"""

    def __init__(self, low: float, step: float, mass: np.ndarray):
        self.low, self.step = low, step
        self.log_mass = np.log(mass)

    @classmethod
    def normal(cls, mean: float, sd: float, step: float = 10) -> 'RatingDistribution':
        if not all(math.isfinite(x) for x in (mean, sd, step)) or sd <= 0 or step <= 0:
            raise ValueError('初始分布参数不合法')
        if step > sd / 2:
            raise ValueError('网格过粗，无法表达初始分布')
        radius = math.ceil(32 * sd / step)
        if 2 * radius + 1 > MAX_GRID_POINTS:
            raise ValueError('数值网格超出资源限制')
        x = np.arange(-radius, radius + 1, dtype=float) * step
        mass = np.exp(-.5 * (x / sd) ** 2)
        mass /= mass.sum()
        return cls(mean - radius * step, step, mass)

    @property
    def grid(self) -> np.ndarray:
        return self.low + np.arange(len(self.log_mass)) * self.step

    @property
    def mass(self) -> np.ndarray:
        return np.exp(self.log_mass)

    def _check_edges(self):
        if float(self.mass[:3].sum() + self.mass[-3:].sum()) > 1e-9:
            raise ValueError('能力分布到达数值边界，请扩大计算范围')

    def _trim(self):
        # Keep about exp(-512) of relative density, far below double-precision
        # FFT accuracy. Preserve a contiguous finite support; boundary checks
        # reject later evidence which would move significant mass off it.
        keep = np.flatnonzero(self.log_mass >= self.log_mass.max() - 512)
        left, right = max(0, int(keep[0]) - 8), min(len(self.log_mass), int(keep[-1]) + 9)
        self.low += left * self.step
        self.log_mass = self.log_mass[left:right]
        self.log_mass -= logsumexp(self.log_mass)

    def diffuse(self, added_variance: float):
        """离散热核传播：均值不变、方差增加added_variance（数值误差内）。

        对称连续时间随机游走的概率核为exp(-lambda)*I_k(lambda)，
        lambda=V/h²；网格细化后趋近正态扩散，小间隔不会被取整成零。
        保留约32标准差范围，以正项直接卷积避免FFT消减误差。
        """
        if not math.isfinite(added_variance) or added_variance < 0:
            raise ValueError('新增方差必须为非负有限数')
        if added_variance == 0:
            return
        lam = added_variance / self.step ** 2
        radius = max(256, math.ceil(32 * math.sqrt(added_variance) / self.step) + 16)
        size = len(self.log_mass) + 2 * radius
        if size > MAX_GRID_POINTS:
            raise ValueError('时间跨度与方差导致网格超出资源限制')
        shifts = np.arange(-radius, radius + 1)
        # ive(k, lambda) = exp(-lambda) * I_k(lambda), since lambda > 0.
        scaled = ive(np.abs(shifts), lam)
        log_kernel = np.log(scaled, where=scaled > 0,
                            out=np.full_like(scaled, -np.inf))
        # ive may underflow for a tiny time interval and a distant lattice
        # state. Its positive power series supplies those tails in log space.
        for i in np.flatnonzero(scaled == 0):
            k = abs(int(shifts[i]))
            term = -lam + k * math.log(lam / 2) - math.lgamma(k + 1)
            total = term
            j = 0
            while True:
                j += 1
                term += 2 * math.log(lam / 2) - math.log(j) - math.log(j + k)
                total = float(np.logaddexp(total, term))
                if term < total - 40:
                    break
            log_kernel[i] = total
        if len(self.log_mass) * len(log_kernel) > 50_000_000:
            raise ValueError('时间扩散计算超出资源限制，请缩小时间跨度或参数')
        # Positive direct convolution has no FFT cancellation/noise floor.
        # Relative densities through exp(-512) remain representable; products
        # that underflow are far below the explicitly retained precision.
        mass = np.convolve(self.mass, np.exp(log_kernel))
        out = np.log(mass, where=mass > 0, out=np.full_like(mass, -np.inf))
        self.low -= radius * self.step
        self.log_mass = out - logsumexp(out)
        self._check_edges()
        self._trim()

    def observe(self, difficulty: float, success: bool, offset: float, *, evidence_weight: float = 1) -> float:
        if (isinstance(evidence_weight, bool) or not math.isfinite(evidence_weight)
                or not 0 < evidence_weight <= 1):
            raise ValueError('证据权重必须大于0且不超过1')
        z = math.log(10) * (self.grid + offset - difficulty) / 400
        log_success = -np.logaddexp(0, -z)
        predicted = float(np.exp(logsumexp(self.log_mass + log_success)))
        likelihood = log_success if success else -np.logaddexp(0, z)
        self.log_mass += evidence_weight * likelihood
        self.log_mass -= logsumexp(self.log_mass)
        self._check_edges()
        self._trim()
        return predicted

    def summary(self) -> dict:
        grid = self.grid
        mass = self.mass
        mean = float(np.dot(mass, grid))
        variance = float(np.dot(mass, (grid - mean) ** 2))
        cdf = np.cumsum(mass)
        bounds = [float(grid[min(len(grid) - 1, int(np.searchsorted(cdf, q)))])
                  for q in (.025, .975)]
        return {'mean': mean, 'variance': variance, 'sd': math.sqrt(variance), 'interval95': bounds}


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError('所有时间必须携带时区')
    return value.astimezone(timezone.utc)


def replay(observations: list[Observation], config: RatingConfig | None = None, *,
           prior_at: datetime | None = None, as_of: datetime | None = None) -> dict:
    """确定性重放；不读取系统时钟，不读写数据库，不把重复提交当独立证据。"""
    config = config or RatingConfig()
    if len(observations) > MAX_EVENTS:
        raise ValueError(f'单次最多{MAX_EVENTS}个独立作答机会')
    start = _aware(prior_at) if prior_at is not None else (
        _aware(observations[0].occurred_at) if observations else None)
    finish = _aware(as_of) if as_of is not None else None
    if finish is not None and start is None:
        raise ValueError('无作答时指定as_of必须同时指定prior_at')
    seen = set()
    previous = start
    # 先验证全部事件，避免中途发现坏数据时已经执行大量FFT。
    for event in observations:
        if not event.problem_id or event.problem_id in seen:
            raise ValueError('同一题只能提供一个整理后的有效作答机会')
        seen.add(event.problem_id)
        at = _aware(event.occurred_at)
        if previous is not None and at < previous:
            raise ValueError('作答时间必须有序，且不能早于prior_at')
        if type(event.success) is not bool or event.context not in ('practice', 'contest'):
            raise ValueError('结果必须为布尔值，条件必须是practice或contest')
        if not math.isfinite(event.difficulty) or not 0 <= event.difficulty <= 10000:
            raise ValueError('题目难度必须为0到10000之间的有限数')
        previous = at
    finish = finish if finish is not None else previous
    if finish is not None and previous is not None and finish < previous:
        raise ValueError('as_of不能早于最后一次作答或prior_at')
    if finish is not None and start is not None and (finish - start).total_seconds() / 86400 > MAX_DAYS:
        raise ValueError('一次重放的时间跨度最多100年')
    distribution = RatingDistribution.normal(config.prior_mean, config.prior_sd, config.grid_step)
    initial = distribution.summary()
    steps = []
    previous = start

    def propagate(at: datetime) -> float:
        days = (at - previous).total_seconds() / 86400
        variance = config.drift_sd_per_30_days ** 2 * days / 30
        distribution.diffuse(variance)
        return variance

    for event in observations:
        at = _aware(event.occurred_at)
        added = propagate(at)
        before = distribution.summary()
        offset = config.practice_offset if event.context == 'practice' else 0
        predicted = distribution.observe(event.difficulty, event.success, offset)
        steps.append({'problem_id': event.problem_id, 'occurred_at': at.isoformat(),
                      'difficulty': event.difficulty, 'success': event.success, 'context': event.context,
                      'added_variance': added, 'predicted_success': predicted,
                      'before': before, 'after': distribution.summary()})
        previous = at
    projection_variance = propagate(finish) if finish is not None else 0
    return {'algorithm_version': ALGORITHM_VERSION,
            'parameters': {'prior_mean': config.prior_mean, 'prior_sd': config.prior_sd,
                           'practice_offset': config.practice_offset, 'logistic_scale': 400,
                           'drift_sd_per_30_days': config.drift_sd_per_30_days, 'grid_step': config.grid_step},
            'prior_at': start.isoformat() if start else None,
            'as_of': finish.isoformat() if finish else None, 'initial': initial,
            'final': distribution.summary(), 'evidence_count': len(observations),
            'projection_added_variance': projection_variance, 'steps': steps}
