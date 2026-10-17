import pytest

from scripts.summarize_v8_second_test import verify_reviews


def ledger():
    return [{'public_id': f'B{i:02}', 'run_id': run, 'tags_correct': True, 'solution_correct': True,
             'joint_correct': True, 'evidence': '已核对方法、标签、正确性理由及题目关键边界。'}
            for i in range(1,21) for run in ['first','second_1','second_2','second_3']]


def test_cannot_export_partial_or_duplicate_semantic_reviews():
    assert len(verify_reviews(ledger())) == 80
    with pytest.raises(ValueError): verify_reviews(ledger()[:-1])
    rows=ledger(); rows[1]=rows[0]
    with pytest.raises(ValueError): verify_reviews(rows)
    with pytest.raises(ValueError): verify_reviews([None]*80)


def test_joint_counts_require_true_booleans_and_both_checks():
    rows=ledger(); rows[0]['tags_correct']=False
    with pytest.raises(ValueError): verify_reviews(rows)
    rows[0]['joint_correct']=False
    assert verify_reviews(rows)[('B01','first')]['joint_correct'] is False
    rows[0]['solution_correct']='true'
    with pytest.raises(ValueError): verify_reviews(rows)
