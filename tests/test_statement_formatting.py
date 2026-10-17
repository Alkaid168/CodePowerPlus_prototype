"""受控公开题排版维护：内容校验、原子性和不可变分析保护。"""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

import pytest

from app.statement_formatting import apply_formatting, validate_formatting


def fixture_item():
    original = '两个整数 a、b，-10^9 ≤ a,b ≤ 10^9。\n```text\n20 30\n```'
    item = {'source_id': 'P1001', 'source_url': 'https://www.luogu.com.cn/problem/P1001',
            'title': 'A+B', 'description': original}
    patch = {**{k: item[k] for k in ('source_id', 'source_url')},
             'original_sha256': sha256(original.encode()).hexdigest(),
             'description': '两个整数 $a$、$b$，$-10^9 \\le a,b \\le 10^9$。\n```text\n20 30\n```'}
    return item, patch


def test_only_math_formatting_and_literal_code_preserved():
    item, patch = fixture_item()
    validate_formatting([item], [patch])
    for changed in ('10^8', '20 31', '两个实数', '$$a$'):
        bad = deepcopy(patch)
        bad['description'] = bad['description'].replace(
            '10^9' if changed == '10^8' else '20 30' if changed == '20 31'
            else '两个整数' if changed == '两个实数' else '$a$', changed, 1)
        with pytest.raises(ValueError):
            validate_formatting([item], [bad])
    with pytest.raises(ValueError):
        validate_formatting([item], [patch, patch])


def test_atomic_repair_preserves_revision_analysis_and_history(container, make_problem):
    item, patch = fixture_item()
    problem, _ = make_problem(title=item['title'], description=item['description'])
    container.db.execute('UPDATE problems SET source_url=? WHERE id=?', (item['source_url'], problem['id']))
    before = [dict(row) for row in container.db.query('SELECT * FROM problem_analyses')]
    result = apply_formatting(container.db, [item], [patch])
    assert result[0]['changed']
    current = container.problems.get(problem['id'])
    assert current['description'] == patch['description'] and current['revision'] == 1
    assert [dict(row) for row in container.db.query('SELECT * FROM problem_analyses')] == before
    assert container.reviews.list_for_problem(problem['id']) == []
    assert not apply_formatting(container.db, [item], [patch])[0]['changed']


def test_conflict_refuses_entire_batch(container):
    item, patch = fixture_item()
    first = container.problems.create(title=item['title'], description=item['description'], source_url=item['source_url'])
    second = {**item, 'source_id': 'P2', 'source_url': 'https://www.luogu.com.cn/problem/P2'}
    patch2 = {**patch, 'source_id': 'P2', 'source_url': second['source_url']}
    container.problems.create(title=second['title'], description='用户已经修改', source_url=second['source_url'])
    with pytest.raises(ValueError, match='conflict'):
        apply_formatting(container.db, [item, second], [patch, patch2])
    assert container.problems.get(first['id'])['description'] == item['description']


def test_curated_forty_statements_keep_samples_and_content():
    folder = Path(__file__).resolve().parents[1] / 'data/evaluation/public40'
    for platform in ('luogu', 'codeforces'):
        items = json.loads((folder / f'{platform}.json').read_text(encoding='utf-8'))['items']
        patches = json.loads((folder / f'formatting/{platform}.json').read_text(encoding='utf-8'))['items']
        assert len(items) == len(patches) == 20
        validate_formatting(items, patches)


def test_reviewed_previous_format_can_be_refined_without_accepting_user_edits(container):
    item, patch = fixture_item()
    old_format = patch['description']
    problem = container.problems.create(title=item['title'], description=old_format, source_url=item['source_url'])
    refined = {**patch, 'description': old_format.replace('a,b', 'a, b'),
               'previous_formatted_sha256': [sha256(old_format.encode()).hexdigest()]}
    assert apply_formatting(container.db, [item], [refined])[0]['changed']
    container.db.execute('UPDATE problems SET description=? WHERE id=?', ('用户修改', problem['id']))
    with pytest.raises(ValueError, match='conflict'):
        apply_formatting(container.db, [item], [refined])
