"""Offline metrics for explicitly authored fixtures; never reads application storage."""
from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

from app.services.difficulty import MAX_RATING, MIN_RATING, STEP, is_valid_rating

EVALUATION_VERSION = 'offline-evaluation-v1'
BASELINE_VERSION = 'difficulty-fit-v1'


def _prf(tp: int, fp: int, fn: int) -> dict[str, float]:
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    return {'precision': precision, 'recall': recall,
            'f1': 2 * precision * recall / (precision + recall) if precision + recall else 0.0}


def classification_metrics(gold: Sequence[Sequence[str]], predictions: Sequence[Sequence[str]]) -> dict:
    """Micro set-label P/R/F1 plus mean of per-problem P/R/F1. Empty scores are 0."""
    if len(gold) != len(predictions):
        raise ValueError('gold and predictions must have equal length')
    tp = fp = fn = 0
    samples = []
    for expected, predicted in zip(gold, predictions):
        gs, ps = set(expected), set(predicted)
        a, b, c = len(gs & ps), len(ps - gs), len(gs - ps)
        tp += a
        fp += b
        fn += c
        samples.append(_prf(a, b, c))
    return {
        'micro': _prf(tp, fp, fn),
        'sample_macro': {name: sum(s[name] for s in samples) / len(samples) if samples else 0.0
                         for name in ('precision', 'recall', 'f1')},
        'true_positive': tp, 'false_positive': fp, 'false_negative': fn, 'samples': len(gold),
    }


def difficulty_mae(gold: Sequence[float], predictions: Sequence[float] | None) -> float:
    if predictions is None:
        raise ValueError('external predictions required; gold labels are not predictions')
    if len(gold) != len(predictions) or not gold:
        raise ValueError('gold and predictions must have equal non-zero length')
    for value in [*gold, *predictions]:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f'difficulty must be a finite number in {MIN_RATING}..{MAX_RATING}')
        if not is_valid_rating(int(value)) or value != int(value):
            raise ValueError(f'difficulty must be a multiple of {STEP} within {MIN_RATING}..{MAX_RATING}')
    return sum(abs(a - b) for a, b in zip(gold, predictions)) / len(gold)


def recommendation_metrics(
    recommendations: Sequence[Sequence[Any]], relevant: Sequence[set], *, candidate_ids: set,
    k: int = 10,
) -> dict:
    """Recall-style ranking metrics over eligible candidate problems; MRR is truncated to k."""
    if k <= 0 or len(recommendations) != len(relevant):
        raise ValueError('positive k and matching query counts required')
    shown, hits, reciprocal_ranks = set(), [], []
    shown_count = 0
    for ranking, targets in zip(recommendations, relevant):
        ids = [item['id'] if isinstance(item, dict) else item for item in ranking[:k]]
        if len(set(ids)) != len(ids) or not set(ids) <= candidate_ids:
            raise ValueError('recommendations must be unique eligible problem IDs')
        shown.update(ids)
        shown_count += len(ids)
        rank = next((i + 1 for i, problem_id in enumerate(ids) if problem_id in targets), None)
        hits.append(int(rank is not None))
        reciprocal_ranks.append(1 / rank if rank else 0.0)
    count = len(recommendations)
    return {
        'k': k, 'queries': count,
        'hit_at_k': sum(hits) / count if count else 0.0,
        'mrr': sum(reciprocal_ranks) / count if count else 0.0,
        'coverage': len(shown) / len(candidate_ids) if candidate_ids else 0.0,
        'unique_recommended': len(shown), 'eligible_catalog_size': len(candidate_ids),
        'recommendation_count': shown_count,
    }


def evaluate_predictions(problems: list[dict], predictions: dict | None, taxonomy_version: str) -> dict:
    """Evaluate a separately supplied complete prediction file joined by problem ID."""
    if predictions is None:
        return {'status': 'not_evaluated', 'reason': 'No external predictions supplied; gold is never used as predictions.',
                'classification': None, 'difficulty_mae': None, 'samples': 0}
    if predictions.get('taxonomy_version') != taxonomy_version:
        raise ValueError('prediction taxonomy_version does not match dataset')
    for key in ('model_name', 'prompt_version', 'provenance'):
        if not isinstance(predictions.get(key), str) or not predictions[key].strip():
            raise ValueError(f'prediction {key} is required')
    items = predictions.get('predictions', [])
    by_id = {item['problem_id']: item for item in items}
    expected_ids = {item['id'] for item in problems}
    if len(by_id) != len(items) or set(by_id) != expected_ids:
        raise ValueError('predictions must cover every dataset problem exactly once')
    gold_labels, predicted_labels, gold_difficulty, predicted_difficulty = [], [], [], []
    for problem in problems:
        gold, prediction = problem['gold'], by_id[problem['id']]
        for key in ('primary_knowledge_ids', 'secondary_knowledge_ids'):
            value = prediction.get(key)
            if not isinstance(value, list) or any(not isinstance(x, str) or not x for x in value):
                raise ValueError(f'prediction {key} must be a list of non-empty strings')
        gold_labels.append(gold['primary_knowledge_ids'] + gold['secondary_knowledge_ids'])
        predicted_labels.append(prediction['primary_knowledge_ids'] + prediction['secondary_knowledge_ids'])
        gold_difficulty.append(gold['difficulty'])
        predicted_difficulty.append(prediction.get('difficulty'))
    return {'status': 'evaluated', 'samples': len(problems),
            'model_name': predictions['model_name'], 'prompt_version': predictions['prompt_version'],
            'provenance': predictions['provenance'],
            'classification': classification_metrics(gold_labels, predicted_labels),
            'difficulty_mae': difficulty_mae(gold_difficulty, predicted_difficulty)}


def mastery_from_history(history: list[dict], problems: list[dict]) -> tuple[dict[str, float], set]:
    """Reuse the production mastery formula; only the latest non-CE result per problem counts."""
    from app.services.profile import mastery_from_evidence
    by_id = {p['id']: p for p in problems}
    evidence: dict[str, list[bool]] = {}
    solved = set()
    latest: dict[int, bool] = {}
    for record in history:
        problem_id, verdict = record['problem_id'], record['verdict']
        if problem_id not in by_id:
            raise ValueError('history references unknown problem')
        if verdict == 'AC':
            solved.add(problem_id)
        if verdict == 'CE':
            continue
        if verdict not in {'AC', 'WA', 'TLE', 'MLE', 'RE', 'PE', 'OLE'}:
            raise ValueError('unsupported history verdict')
        latest[problem_id] = verdict == 'AC'
    for problem_id, passed in latest.items():
        gold = by_id[problem_id]['gold']
        for tag in dict.fromkeys(gold['primary_knowledge_ids'] + gold['secondary_knowledge_ids']):
            evidence.setdefault(tag, []).append(passed)
    return mastery_from_evidence(evidence), solved


def baseline_recommend(problems: list[dict], mastery: dict[str, float], solved_ids: set, limit: int) -> list[dict]:
    """Difficulty-only reference; no prerequisites and no held-out relevance labels."""
    average = sum(mastery.values()) / len(mastery) if mastery else 0.5
    target = 1200 + 1600 * average
    ranked = []
    for problem in problems:
        if problem['id'] in solved_ids:
            continue
        score = max(0.0, 1 - abs(problem['analysis']['difficulty'] - target) / 800)
        ranked.append({**problem, 'recommendation_score': round(score, 6)})
    return sorted(ranked, key=lambda p: p['recommendation_score'], reverse=True)[:limit]
