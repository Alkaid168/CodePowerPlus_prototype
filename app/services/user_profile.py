"""Zero-start L1 ratings; a reviewed problem shares one unit across its L1s."""
from __future__ import annotations

from datetime import datetime, timezone
import math

from app.services.rating import Observation, RatingConfig, RatingDistribution

PROFILE_VERSION = 'learner-profile-v3'
DIMENSIONS = ('syntax', 'basic', 'search', 'dp', 'string', 'math', 'ds', 'graph', 'geometry', 'misc')
ALGORITHM_DIMENSIONS = DIMENSIONS[1:]
RESULTS = {'AC', 'WA', 'TLE', 'MLE', 'RE'}


def _domains(ids, taxonomy) -> tuple[str, ...]:
    roots = set()
    for key in ids:
        node = taxonomy.nodes[key]
        while node['parent_id'] is not None:
            node = taxonomy.nodes[node['parent_id']]
        roots.add(node['id'])
    return tuple(sorted(roots))


def aggregate_total(stage: str, syntax_score: float, algorithm_scores: dict[str, float]) -> int:
    if stage == 'syntax':
        return round(max(0, min(800, syntax_score)))
    if stage != 'algorithms' or set(algorithm_scores) != set(ALGORITHM_DIMENSIONS):
        raise ValueError('阶段或算法领域不完整')
    values = [float(algorithm_scores[key]) for key in ALGORITHM_DIMENSIONS]
    if not all(math.isfinite(value) for value in values):
        raise ValueError('能力评分必须为有限数')
    return round(800 + math.sqrt(sum(max(0, value - 800) ** 2 for value in values) / 9))


def profile_evidence_issue(record: dict, taxonomy) -> str:
    """Shared eligibility check for scoring and the submission receipt."""
    if record.get('verdict') == 'CE':
        return '编译错误不计入能力评分。'
    ids = record.get('knowledge_ids') or []
    difficulty = record.get('difficulty')
    if (record.get('verdict') not in RESULTS or not record.get('analysis_id')
            or record.get('taxonomy_version') != taxonomy.version or not taxonomy.allowed(ids)
            or isinstance(difficulty, bool) or not isinstance(difficulty, (float, int))
            or not math.isfinite(difficulty) or not 0 < difficulty <= 10000):
        return '题目缺少有效的审核快照、知识标签或难度，本次提交不计入能力评分。'
    roots = _domains(ids, taxonomy)
    if not set(roots) <= set(DIMENSIONS):
        return '题目能力领域无效，本次提交不计入能力评分。'
    if ('syntax' in roots) != (difficulty < 800) or ('syntax' in roots and len(roots) > 1):
        return '题目难度与能力领域不匹配，本次提交不计入能力评分。'
    try:
        at = datetime.fromisoformat(record['created_at'])
        if at.tzinfo is None or at.utcoffset() is None:
            return '提交时间缺少时区，本次提交不计入能力评分。'
        str(record['problem_id'])
    except (KeyError, TypeError, ValueError):
        return '提交时间或题号无效，本次提交不计入能力评分。'
    return ''


def _opportunity(record: dict, taxonomy):
    if profile_evidence_issue(record, taxonomy):
        return None
    at = datetime.fromisoformat(record['created_at']).astimezone(timezone.utc)
    return _domains(record['knowledge_ids'], taxonomy), \
        Observation(str(record['problem_id']), at, record['difficulty'], record['verdict'] == 'AC')


def build_profile(user_id: str, records: list[dict], taxonomy) -> dict:
    candidates = []
    unmapped = 0
    for record in records:
        candidate = _opportunity(record, taxonomy)
        if candidate is not None:
            candidates.append(candidate)
        elif record.get('verdict') != 'CE':
            unmapped += 1
    # One episode per problem: first valid failure, replaced by first valid AC.
    # Retries are not independent tests; later AC/failures cannot farm or erase it.
    episodes = {}
    for domains, event in sorted(candidates, key=lambda item: item[1].occurred_at):
        previous = episodes.get(event.problem_id)
        if previous is None or (not previous[1].success and event.success):
            episodes[event.problem_id] = (domains, event)
    config = RatingConfig(prior_mean=0)
    dimensions = []
    algorithm_success = any('syntax' not in domains and event.success for domains, event in episodes.values())
    for domain in DIMENSIONS:
        events = sorted(((event, 1 / len(domains)) for domains, event in episodes.values() if domain in domains),
                        key=lambda item: item[0].occurred_at)
        if events:
            # Stream the complete history through the same posterior engine;
            # the interactive preview endpoint's 500-event limit is unrelated.
            distribution = RatingDistribution.normal(0, config.prior_sd, config.grid_step)
            previous = events[0][0].occurred_at
            for event, weight in events:
                days = (event.occurred_at - previous).total_seconds() / 86400
                distribution.diffuse(config.drift_sd_per_30_days ** 2 * days / 30)
                distribution.observe(event.difficulty, event.success, config.practice_offset, evidence_weight=weight)
                previous = event.occurred_at
            summary = distribution.summary()
        else:
            summary = {'mean': 0, 'sd': config.prior_sd}
        score = max(0, round(summary['mean']))
        dimensions.append({
            'knowledge_id': domain,
            'name': taxonomy.nodes[domain]['name'],
            'score': min(800, score) if domain == 'syntax' else score,
            'latent_mean': summary['mean'],
            'uncertainty': summary['sd'],
            'evidence_count': math.fsum(weight for _, weight in events),
            'source': 'problem_evidence' if events else 'default',
        })
    # An early uncertain estimate must not permanently lock a syntax learner
    # at 800 after later evidence lowers their current ability estimate.
    stage = 'algorithms' if algorithm_success or dimensions[0]['latent_mean'] >= 800 else 'syntax'
    if stage == 'algorithms':
        dimensions[0]['score'] = 800
    scores = {item['knowledge_id']: item['score'] for item in dimensions}
    return {
        'profile_version': PROFILE_VERSION,
        'user_id': user_id,
        'stage': stage,
        'parameters': {'prior_mean': 0, 'prior_sd': config.prior_sd,
                       'practice_offset': config.practice_offset,
                       'drift_sd_per_30_days': config.drift_sd_per_30_days},
        'overall': {
            'score': aggregate_total(stage, scores['syntax'], {key: scores[key] for key in ALGORITHM_DIMENSIONS}),
            'source': 'problem_evidence' if episodes else 'default',
            'uncertainty': None,
            'evidence_count': len(episodes),
        },
        'dimensions': dimensions,
        'unmapped_submission_count': unmapped,
        'updated_at': max((event.occurred_at for _, event in episodes.values()), default=None),
    }
