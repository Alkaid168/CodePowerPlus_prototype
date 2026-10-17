import pytest

from app.blind_evaluation import compare, validate_public, verify_commitment, digest


def manifest():
    return {'items': [{'public_id': f'B{i:02}', 'source_url': f'https://example.org/{i}'} for i in range(1, 21)]}


def test_public_manifest_has_no_prediction_leakage_and_exact_twenty():
    validate_public(manifest())
    dirty = manifest()
    dirty['items'][0]['difficulty'] = 1200
    with pytest.raises(ValueError):
        validate_public(dirty)
    partial = manifest()
    partial['items'].pop()
    with pytest.raises(ValueError):
        validate_public(partial)


def test_seal_detects_mutated_predictions():
    prediction = {'items': list(range(20))}
    seal = {'predictions_sha256': digest(prediction)}
    verify_commitment(prediction, seal)
    prediction['items'][0] = -1
    with pytest.raises(ValueError):
        verify_commitment(prediction, seal)


def test_comparison_uses_signed_differences_and_independent_groups():
    public = manifest()
    predictions = {'items': [{'public_id': x['public_id'], 'group': 'regression9' if i < 9 else 'new11',
        'analysis': {'difficulty': 1200}} for i, x in enumerate(public['items'])]}
    human = [{'public_id': x['public_id'], 'source_url': x['source_url'], 'difficulty': 1400} for x in public['items']]
    result = compare(public, predictions, human)
    assert result['metrics']['all20']['bias'] == -200
    assert result['metrics']['regression9']['n'] == 9
    assert result['metrics']['new11']['mae'] == 200
    assert all(x['difference'] == -200 for x in result['items'])
    with pytest.raises(ValueError):
        compare(public, predictions, human[:-1])
    human[0]['difficulty'] = 1250
    with pytest.raises(ValueError):
        compare(public, predictions, human)
