"""Reproducible offline fixture experiment. No database or network access."""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.evaluation import (
    BASELINE_VERSION, EVALUATION_VERSION, baseline_recommend, evaluate_predictions,
    mastery_from_history, recommendation_metrics,
)
from app.knowledge import Taxonomy
from app.services.difficulty import MAX_RATING, MIN_RATING, STEP, is_valid_rating
from app.services.profile import ALGORITHM_VERSION as PROFILE_VERSION
from app.services.recommend import ALGORITHM_VERSION, recommend


def validate_dataset(dataset: dict, taxonomy: Taxonomy) -> None:
    if dataset.get('taxonomy_version') != taxonomy.version:
        raise ValueError('dataset taxonomy_version must match loaded taxonomy; migrate explicitly')
    if dataset.get('provenance') != 'authored_fixture':
        raise ValueError('this experiment expects explicitly authored_fixture data')
    if not dataset.get('version') or not dataset.get('annotation_policy'):
        raise ValueError('dataset version and annotation_policy are required')
    problems, learners = dataset['problems'], dataset['learners']
    problem_ids = {p['id'] for p in problems}
    if not problems or not learners or len(problem_ids) != len(problems):
        raise ValueError('non-empty problems/learners and unique problem IDs required')
    if len({x['id'] for x in learners}) != len(learners):
        raise ValueError('learner IDs must be unique')
    for problem in problems:
        gold = problem['gold']
        if problem.get('provenance') != 'authored_fixture' or gold.get('annotation_source') != 'authored_fixture':
            raise ValueError('each problem and annotation must disclose authored_fixture provenance')
        taxonomy.validate_assignment(gold['primary_knowledge_ids'], gold['secondary_knowledge_ids'],
                                     gold['evidence'], gold['knowledge_confidence'])
        if not is_valid_rating(gold['difficulty']):
            raise ValueError(f'gold difficulty must be a multiple of {STEP} within {MIN_RATING}..{MAX_RATING}')
    for learner in learners:
        if learner.get('provenance') != 'authored_fixture':
            raise ValueError('simulated learner provenance is required')
        relevant, negatives = set(learner['relevant_problem_ids']), set(learner['negative_problem_ids'])
        if not relevant or not negatives or not (relevant | negatives) <= problem_ids or relevant & negatives:
            raise ValueError('learner needs disjoint valid positive and negative example IDs')
        if any(record.get('provenance') != 'authored_fixture' for record in learner['history']):
            raise ValueError('simulated history provenance is required')
        _, solved = mastery_from_history(learner['history'], problems)
        if relevant & solved:
            raise ValueError('held-out relevant problems must not be already solved')


def run_experiment(dataset: dict, taxonomy: Taxonomy, predictions: dict | None = None, seed: int = 42, k: int = 5) -> dict:
    validate_dataset(dataset, taxonomy)
    if k <= 0:
        raise ValueError('k must be positive')
    # Simulated approval is only an in-memory adapter for this offline experiment.
    # It never creates an audit event or writes approved analyses to application storage.
    problems = [{
        'id': p['id'], 'title': p['title'], 'description': p['description'],
        'source_url': p.get('source_url', ''),
        'provenance': 'authored_fixture',
        'analysis': {**p['gold'], 'taxonomy_version': taxonomy.version, 'review_status': 'approved',
                     'model_name': 'authored_fixture', 'prompt_version': 'none',
                     'analysis_id': f'fixture-{p["id"]}'},
    } for p in dataset['problems']]
    random.Random(seed).shuffle(problems)
    relevant, masteries, candidate_ids = [], [], set()
    rankings, details = {'baseline': [], 'graph': []}, []
    for learner in dataset['learners']:
        mastery, solved = mastery_from_history(learner['history'], dataset['problems'])
        relevant.append(set(learner['relevant_problem_ids']))
        masteries.append(mastery)
        eligible = {p['id'] for p in problems} - solved
        candidate_ids.update(eligible)
        baseline = baseline_recommend(problems, mastery, solved, k)
        graph = recommend(problems, mastery, list(solved), limit=k, taxonomy=taxonomy)
        entry = {'learner_id': learner['id'], 'provenance': learner['provenance'],
                 'mastery_from_history': mastery, 'solved_ids': sorted(solved),
                 'eligible_count': len(eligible), 'relevant_problem_ids': sorted(relevant[-1]),
                 'negative_problem_ids': learner['negative_problem_ids'], 'rationale': learner['rationale']}
        for name, result in [('baseline', baseline), ('graph', graph)]:
            ids = [p.get('problem_id', p.get('id')) for p in result]
            if not set(ids) <= eligible:
                raise ValueError(f'{name} returned ineligible or solved problems')
            rankings[name].append(ids)
            entry[name] = [{'problem_id': p.get('problem_id', p.get('id')),
                            'score': p.get('recommendation_score'),
                            'reasons': p.get('reasons', []), 'score_breakdown': p.get('score_breakdown', {})}
                           for p in result]
        details.append(entry)
    metrics = {name: recommendation_metrics(ranking, relevant, candidate_ids=candidate_ids, k=k)
               for name, ranking in rankings.items()}
    digest = hashlib.sha256(json.dumps(dataset, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()
    return {
        'evaluation_version': EVALUATION_VERSION, 'dataset_version': dataset['version'],
        'dataset_sha256': digest, 'taxonomy_version': taxonomy.version, 'provenance': dataset['provenance'],
        'seed': seed, 'algorithm_versions': {'baseline': BASELINE_VERSION, 'graph': ALGORITHM_VERSION,
                                           'mastery': PROFILE_VERSION},
        'sample_counts': {'problems': len(problems), 'learners': len(dataset['learners']),
                          'history_records': sum(len(x['history']) for x in dataset['learners'])},
        'analysis': evaluate_predictions(dataset['problems'], predictions, taxonomy.version),
        'recommendation': metrics, 'learner_results': details,
        'limitations': [
            dataset['annotation_policy'],
            'This small authored_fixture dataset validates mechanics, not real learning outcomes or generalization.',
            'Positive/negative relevance examples were authored for scenarios, not independently assessed; unlisted candidates are treated as non-relevant for hit/MRR.',
            'Recommendations use fixture gold analyses, so this is an oracle-label ranking experiment and excludes prediction errors.',
            'Mastery uses only simulated history: latest non-CE result per problem; (1+final AC problem count)/(2+independent problem count) per knowledge ID, reusing the production formula in services/profile.py. These are heuristics, not calibrated learning probabilities.',
            'Difficulty-only baseline targets 1200+1600*mean(observed mastery) on the 800-3500 Codeforces-style scale; the knowledge ranker adds tag weakness on top. Neither is tuned on real outcomes.',
            'MRR is truncated at k; coverage denominator is the union of all learner-eligible candidates.',
            'No API, real user, or database is used; no automatic paid prediction calls. Use external predictions to evaluate labels/difficulty.',
        ],
    }


def markdown_report(report: dict) -> str:
    lines = ['# Offline evaluation / 离线流程验证', '',
             f"Dataset: `{report['dataset_version']}` · taxonomy: `{report['taxonomy_version']}` · seed: {report['seed']}",
             f"Provenance: **{report['provenance']}** · samples: {json.dumps(report['sample_counts'])}",
             f"Algorithms: `{json.dumps(report['algorithm_versions'])}`", '',
             '| Method | hit@k | MRR@k | Coverage | Shown |',
             '|---|---:|---:|---:|---:|']
    for name, metric in report['recommendation'].items():
        lines.append(f"| {name} (k={metric['k']}) | {metric['hit_at_k']:.4f} | {metric['mrr']:.4f} | {metric['coverage']:.4f} | {metric['recommendation_count']} |")
    lines += ['', '## External analysis predictions', '', f"Status: **{report['analysis']['status']}**", '',
              '```json', json.dumps(report['analysis'], ensure_ascii=False, indent=2), '```', '',
              '## Limits / 数据来源与局限', '']
    lines += ['- ' + value for value in report['limitations']]
    lines += ['', 'Per-learner rankings, known mastery and held-out relevance are preserved in `report.json`.', '']
    return '\n'.join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', type=Path, default=ROOT / 'data/evaluation/authored_fixture.json')
    parser.add_argument('--taxonomy', type=Path, default=ROOT / 'data/taxonomy_versions/2026.09.9.json',
                        help='默认固定到 authored_fixture 对应的历史快照；新数据集需显式指定版本')
    parser.add_argument('--predictions', type=Path, help='External complete predictions JSON; never generated from gold.')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'data/evaluation/reports')
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--k', type=int, default=5)
    args = parser.parse_args()
    try:
        dataset = json.loads(args.dataset.read_text(encoding='utf-8'))
        predictions = json.loads(args.predictions.read_text(encoding='utf-8')) if args.predictions else None
        report = run_experiment(dataset, Taxonomy(args.taxonomy), predictions, args.seed, args.k)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        parser.error(str(exc))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (args.output_dir / 'report.md').write_text(markdown_report(report), encoding='utf-8')
    print(f"Report: {args.output_dir / 'report.json'}")
    print(f"Report: {args.output_dir / 'report.md'}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
