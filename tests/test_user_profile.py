from datetime import datetime, timedelta, timezone

import pytest

from app.knowledge import Taxonomy
from app.services.user_profile import aggregate_total, build_profile

T0 = datetime(2026, 10, 1, tzinfo=timezone.utc)
VERSION = Taxonomy().version


def record(problem, verdict='AC', *, ids=None, difficulty=1600, day=0, **extra):
    return dict(problem_id=problem, verdict=verdict, difficulty=difficulty,
                knowledge_ids=ids or ['dp.knapsack.zero-one'],
                taxonomy_version=VERSION, analysis_id=1,
                created_at=(T0 + timedelta(days=day)).isoformat(), **extra)


def dimension(profile, key):
    return next(item for item in profile['dimensions'] if item['knowledge_id'] == key)


def test_zero_profile_has_all_eleven_scores_without_setup():
    profile = build_profile('new', [], Taxonomy())
    assert profile['overall']['score'] == 0
    assert len(profile['dimensions']) == 10
    assert all(item['score'] == 0 for item in profile['dimensions'])
    assert profile['overall']['evidence_count'] == 0
    assert profile['stage'] == 'syntax'
    assert 'experience' not in profile


def test_single_domain_ac_updates_that_domain_and_total_from_zero():
    taxonomy = Taxonomy()
    profile = build_profile('u', [record(1, ids=['basic.prefix-sum'])], taxonomy)
    assert dimension(profile, 'basic')['score'] > 0
    assert dimension(profile, 'ds')['score'] == 0
    assert dimension(profile, 'syntax')['score'] == 800
    assert profile['overall']['score'] >= 800
    assert profile['overall']['evidence_count'] == 1
    assert profile['stage'] == 'algorithms'
    assert profile['parameters']['prior_mean'] == 0
    assert profile['parameters']['practice_offset'] == 200


def test_syntax_success_changes_initial_zero_without_forcing_algorithm_stage():
    profile = build_profile('u', [record(1, ids=['syntax.output.literal-output'], difficulty=100)], Taxonomy())
    assert 0 < profile['overall']['score'] < 800
    assert dimension(profile, 'syntax')['score'] == profile['overall']['score']
    assert dimension(profile, 'basic')['score'] == 0
    assert profile['stage'] == 'syntax'


def test_same_problem_retries_and_post_ac_failures_do_not_farm_or_erase_success():
    taxonomy = Taxonomy()
    success = record(1, ids=['basic.prefix-sum'], day=1)
    expected = build_profile('u', [success], taxonomy)
    attempts = [record(1, 'WA', ids=['basic.prefix-sum']), success,
                record(1, 'AC', ids=['basic.prefix-sum'], day=2),
                record(1, 'WA', ids=['basic.prefix-sum'], day=3)]
    assert build_profile('u', attempts, taxonomy) == expected
    failed = record(2, 'WA', ids=['basic.prefix-sum'])
    assert build_profile('u', [failed, record(2, 'WA', ids=['basic.prefix-sum'], day=5)], taxonomy) == \
        build_profile('u', [failed], taxonomy)


def test_failure_on_another_problem_can_lower_an_estimate():
    taxonomy = Taxonomy()
    good = [record(1, ids=['basic.prefix-sum'], difficulty=2500)]
    before = build_profile('u', good, taxonomy)
    after = build_profile('u', good + [record(2, 'WA', ids=['basic.prefix-sum'], difficulty=800)], taxonomy)
    assert dimension(after, 'basic')['score'] < dimension(before, 'basic')['score']
    assert after['overall']['score'] < before['overall']['score']


@pytest.mark.parametrize('change', [
    {'analysis_id': None}, {'taxonomy_version': 'old'}, {'verdict': 'CE'},
    {'knowledge_ids': ['invented']},
    {'difficulty': None}, {'created_at': 'invalid'},
    {'knowledge_ids': ['syntax.expressions.arithmetic'], 'difficulty': 800},
])
def test_ineligible_evidence_is_not_guessed(change):
    event = record(1, ids=['basic.prefix-sum']) | change
    profile = build_profile('u', [event], Taxonomy())
    assert profile['overall']['score'] == 0
    assert profile['overall']['evidence_count'] == 0


def test_two_alternatives_within_the_same_domain_count_only_once():
    taxonomy = Taxonomy()
    event = record(1, ids=['ds.fenwick', 'ds.segment-tree.basic'])
    profile = build_profile('u', [event], taxonomy)
    assert dimension(profile, 'ds')['evidence_count'] == 1
    assert profile['overall']['evidence_count'] == 1


def test_longer_gap_changes_uncertainty_before_new_evidence():
    taxonomy = Taxonomy()
    early = record(1, ids=['basic.prefix-sum'], difficulty=1600)
    fast = build_profile('u', [early, record(2, ids=['basic.prefix-sum'], difficulty=2500)], taxonomy)
    late = build_profile('u', [early, record(2, ids=['basic.prefix-sum'], difficulty=2500, day=120)], taxonomy)
    assert dimension(late, 'basic')['latent_mean'] > dimension(fast, 'basic')['latent_mean']


def test_total_anchor_and_algorithm_no_ceiling():
    values = dict.fromkeys(['basic', 'search', 'dp', 'string', 'math', 'ds', 'graph', 'geometry', 'misc'], 0)
    assert aggregate_total('algorithms', 0, values) == 800
    values['geometry'] = 3500
    assert aggregate_total('algorithms', 0, values) == 1700
    values['geometry'] = 5000
    assert aggregate_total('algorithms', 0, values) == 2200
    assert aggregate_total('syntax', 650, values) == 650


def test_profile_can_replay_more_than_the_preview_apis_500_opportunities():
    taxonomy = Taxonomy()
    events = [record(i, ids=['basic.prefix-sum'], difficulty=800) for i in range(501)]
    profile = build_profile('many-problems', events, taxonomy)
    assert profile['overall']['evidence_count'] == 501
    assert dimension(profile, 'basic')['evidence_count'] == 501


def test_profile_recurrence_matches_the_validated_rating_engine():
    from app.services.rating import Observation, RatingConfig, replay

    taxonomy = Taxonomy()
    events = [record(1, ids=['basic.prefix-sum'], difficulty=1600),
              record(2, 'WA', ids=['basic.prefix-sum'], difficulty=800, day=30)]
    expected = replay([
        Observation('1', T0, 1600, True),
        Observation('2', T0 + timedelta(days=30), 800, False),
    ], RatingConfig(prior_mean=0))
    actual = dimension(build_profile('u', events, taxonomy), 'basic')
    assert actual['latent_mean'] == pytest.approx(expected['final']['mean'])
    assert actual['uncertainty'] == pytest.approx(expected['final']['sd'])


def test_syntax_only_learner_is_not_permanently_graduated_by_an_early_high_estimate():
    # Actual library sequence: A+B, Watermelon, then two distinct new problems fail.
    events = [record(1001, ids=['syntax.expressions.arithmetic'], difficulty=300),
              record(1021, ids=['syntax.conditions.logical-condition'], difficulty=400)]
    early = build_profile('beginner', events, Taxonomy())
    assert early['overall']['score'] == 800
    events += [record(1003, 'WA', ids=['syntax.characters-strings.string-traversal'], difficulty=600),
               record(1027, 'WA', ids=['syntax.characters-strings.string-comparison'], difficulty=600)]
    final = build_profile('beginner', events, Taxonomy())
    syntax = dimension(final, 'syntax')
    assert 0 < syntax['latent_mean'] < 800
    assert final['stage'] == 'syntax'
    assert syntax['score'] == round(syntax['latent_mean'])
    assert final['overall']['score'] == syntax['score']


def test_algorithm_success_still_confirms_syntax_even_after_syntax_failures():
    events = [record(1, ids=['ds.union-find'], difficulty=1200),
              record(2, 'WA', ids=['syntax.expressions.arithmetic'], difficulty=300)]
    final = build_profile('learner', events, Taxonomy())
    assert final['stage'] == 'algorithms'
    assert dimension(final, 'syntax')['score'] == 800


@pytest.mark.parametrize('verdict', ['AC', 'WA'])
def test_cross_domain_problem_splits_likelihood_and_effective_count_equally(verdict):
    import numpy as np
    from scipy.special import logsumexp

    taxonomy = Taxonomy()
    # Two ds tags do not give ds two shares. Three distinct L1s get 1/3 each.
    event = record(1, verdict, ids=['ds.fenwick', 'ds.segment-tree.basic',
                                   'graph.shortest-path', 'basic.binary'], difficulty=1400)
    profile = build_profile('u', [event], taxonomy)
    grid = np.arange(-12000., 12001.)
    z = np.log(10) * (grid + 200 - 1400) / 400
    log_mass = -.5 * (grid / 800) ** 2 - np.logaddexp(0, -z if verdict == 'AC' else z) / 3
    expected_mean = float(np.dot(grid, np.exp(log_mass - logsumexp(log_mass))))
    assert profile['overall']['evidence_count'] == 1
    assert profile['unmapped_submission_count'] == 0
    assert sum(d['evidence_count'] for d in profile['dimensions']) == pytest.approx(1)
    for key in ['ds', 'graph', 'basic']:
        item = dimension(profile, key)
        assert item['evidence_count'] == pytest.approx(1 / 3)
        assert item['latent_mean'] == pytest.approx(expected_mean, abs=.01)
    assert dimension(profile, 'dp')['evidence_count'] == 0


def test_cross_domain_retries_replace_the_whole_episode_without_farming_shares():
    taxonomy = Taxonomy()
    ids = ['graph.shortest-path', 'ds.binary-heap']
    attempts = [record(1, 'WA', ids=ids), record(1, 'AC', ids=ids),
                record(1, 'AC', ids=ids), record(1, 'WA', ids=ids)]
    actual = build_profile('u', attempts, taxonomy)
    expected = build_profile('u', [attempts[1]], taxonomy)
    assert actual == expected
    assert dimension(actual, 'graph')['evidence_count'] == .5
    assert dimension(actual, 'ds')['evidence_count'] == .5
