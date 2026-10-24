"""有效作答的数学性质；不使用正式数据库或模型服务。"""
from datetime import datetime, timedelta, timezone
import pytest
from app.services.rating import RatingConfig, RatingDistribution, Observation, replay, success_probability

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def test_practice_and_contest_probability_anchors():
    assert success_probability(1000, 1200, 200) == pytest.approx(.5)
    assert success_probability(1000, 1000, 0) == pytest.approx(.5)
    assert success_probability(1000, 1000, 200) == pytest.approx(.75974692665)
    assert success_probability(1e6, 0, 200) == 1
    assert success_probability(-1e6, 0, 200) == 0


@pytest.mark.parametrize('success', [True, False])
def test_two_half_observations_equal_one_full_observation(success):
    whole = RatingDistribution.normal(0, 800)
    halves = RatingDistribution.normal(0, 800)
    whole.observe(1400, success, 200)
    halves.observe(1400, success, 200, evidence_weight=.5)
    halves.observe(1400, success, 200, evidence_weight=.5)
    assert halves.summary()['mean'] == pytest.approx(whole.summary()['mean'], abs=1e-6)
    assert halves.summary()['variance'] == pytest.approx(whole.summary()['variance'], abs=1e-6)


@pytest.mark.parametrize('weight', [0, -1, 1.1, float('nan'), float('inf'), True])
def test_invalid_fractional_observation_weight_is_rejected(weight):
    distribution = RatingDistribution.normal(0, 800)
    before = distribution.summary()
    with pytest.raises(ValueError):
        distribution.observe(1400, True, 200, evidence_weight=weight)
    assert distribution.summary() == before


def test_static_replay_matches_independent_integral_and_has_no_4000_ceiling():
    observations = [Observation(str(i), T0, 1000, True) for i in range(10)]
    practice = replay(observations, RatingConfig(drift_sd_per_30_days=0))
    contest = replay([Observation(str(i), T0, 1000, True, 'contest') for i in range(10)], RatingConfig(drift_sd_per_30_days=0))
    assert practice['final']['mean'] == pytest.approx(1732.2863, abs=1)
    assert contest['final']['mean'] == pytest.approx(1876.0637, abs=1)
    assert practice['steps'][0]['predicted_success'] == pytest.approx(.5, abs=.001)
    assert RatingDistribution.normal(5000, 100).summary()['mean'] == pytest.approx(5000)


def test_time_propagation_preserves_mean_and_adds_variance_in_parts():
    one = RatingDistribution.normal(800, 20)
    split = RatingDistribution.normal(800, 20)
    one.diffuse(40000)
    split.diffuse(10000)
    split.diffuse(30000)
    a, b = one.summary(), split.summary()
    assert a['mean'] == pytest.approx(800, abs=.001)
    assert a['variance'] == pytest.approx(40400, abs=.01)
    assert b['variance'] == pytest.approx(a['variance'], abs=.01)
    assert a['interval95'][0] < 800 < a['interval95'][1]


def test_gap_makes_hard_success_more_responsive_without_prior_mean_bonus():
    config = RatingConfig(prior_mean=800, prior_sd=20, drift_sd_per_30_days=100)
    immediate = replay([Observation('new', T0, 2000, True)], config, prior_at=T0)
    returned = replay([Observation('new', T0+timedelta(days=120), 2000, True)], config, prior_at=T0)
    assert returned['steps'][0]['before']['mean'] == pytest.approx(800)
    assert returned['steps'][0]['before']['variance'] == pytest.approx(40400, abs=.01)
    assert returned['final']['mean'] > immediate['final']['mean']+200


def test_projection_without_events_is_explicit_and_does_not_count_as_evidence():
    config = RatingConfig(prior_sd=20)
    result = replay([], config, prior_at=T0, as_of=T0+timedelta(days=120))
    assert result['final']['variance'] == pytest.approx(40400, abs=.01)
    assert result['evidence_count'] == 0
    assert result['final']['mean'] == pytest.approx(800)
    assert result['steps'] == []


def test_failures_lower_estimate_and_replay_does_not_double_count():
    events = [Observation(str(i), T0+timedelta(days=i), 800, False) for i in range(5)]
    config = RatingConfig(prior_mean=1800, prior_sd=200)
    a, b = replay(events, config), replay(events, config)
    assert a == b
    assert a['final']['mean'] < 1800
    assert a['evidence_count'] == 5


def test_grid_refinement_and_singleton_hard_success():
    events = [Observation('hard', T0, 3500, True)]
    fine = replay(events, RatingConfig(grid_step=5))
    coarse = replay(events, RatingConfig(grid_step=10))
    assert fine['final']['mean'] == pytest.approx(3120.2572, abs=1)
    assert coarse['final']['mean'] == pytest.approx(fine['final']['mean'], abs=.1)
    assert coarse['final']['sd'] > 300


@pytest.mark.parametrize('case', ['duplicate', 'order', 'naive', 'as_of', 'no_origin'])
def test_invalid_evidence_rejected(case):
    a = Observation('a', T0, 1000, True)
    events, kwargs = [a], {}
    if case == 'duplicate': events = [a, a]
    if case == 'order': events = [a, Observation('b', T0-timedelta(days=1), 1000, True)]
    if case == 'naive': events = [Observation('a', T0.replace(tzinfo=None), 1000, True)]
    if case == 'as_of': kwargs = {'as_of': T0-timedelta(days=1)}
    if case == 'no_origin': events, kwargs = [], {'as_of': T0}
    with pytest.raises(ValueError): replay(events, RatingConfig(), **kwargs)


@pytest.mark.parametrize('kwargs', [{'prior_sd':0}, {'grid_step':0}, {'practice_offset':float('nan')}, {'drift_sd_per_30_days':-1}])
def test_invalid_config_rejected(kwargs):
    with pytest.raises(ValueError): RatingConfig(**kwargs)


@pytest.mark.parametrize('count,mean,sd', [(50,1169.819,51.484), (100,1680.861,34.204)])
def test_strong_evidence_after_small_diffusion_preserves_rare_tails(count, mean, sd):
    # Independent log-series heat-kernel reference from numerical review.
    events = [Observation(str(i), T0 if i == 0 else T0+timedelta(days=1), 2000, True)
              for i in range(count)]
    result = replay(events, RatingConfig(prior_sd=20))
    assert result['final']['mean'] == pytest.approx(mean, abs=.02)
    assert result['final']['sd'] == pytest.approx(sd, abs=.02)


def test_many_tiny_time_steps_preserve_variance_without_fft_noise():
    dist = RatingDistribution.normal(800, 20)
    for _ in range(20):
        dist.diffuse(.01)
    assert dist.summary()['mean'] == pytest.approx(800, abs=1e-6)
    assert dist.summary()['variance'] == pytest.approx(400.2, abs=1e-6)
