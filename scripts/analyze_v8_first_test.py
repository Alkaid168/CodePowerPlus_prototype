"""只读已封存预测和已提交人评，生成v8首测事后诊断；不调用模型、不写正式库。"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import statistics
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.blind_evaluation import digest, verify_commitment


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def components(n, edges):
    parent = list(range(n + 1))
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for a, b in edges:
        parent[find(a)] = find(b)
    return len({find(x) for x in range(1, n + 1)})


def stack_permutations(n):
    result = []
    def visit(next_input, stack, out):
        if len(out) == n:
            result.append(out)
            return
        if next_input <= n:
            visit(next_input + 1, stack + (next_input,), out)
        if stack:
            visit(next_input, stack[:-1], out + (stack[-1],))
    visit(1, (), ())
    return sorted(set(result))


def main():
    work = ROOT / 'data/evaluation/v8-first-test'
    private = Path(os.environ['LOCALAPPDATA']) / 'CodePowerPlus/blind-evaluations/v8-first-test'
    manifest = load(work / 'manifest.json')
    seal = load(work / 'commitment.json')
    predictions = load(private / 'predictions.json')
    comparison = load(work / 'comparison.json')
    verify_commitment(predictions, seal)
    assert digest(manifest) == seal['manifest_sha256']
    assert comparison['prediction_commitment'] == seal['predictions_sha256']
    human_file = ROOT / 'output/v8-blind-form/v8首测-人工难度评测.xlsx'
    human_bytes = human_file.read_bytes()
    assert hashlib.sha256(human_bytes).hexdigest() == comparison['human_file_sha256']
    revision = comparison.get('human_revision', 0)
    archive = private / (f'human-submission-r{revision}.xlsx' if revision else 'human-submission.xlsx')
    if archive.exists():
        assert archive.read_bytes() == human_bytes, '不同人评不能覆盖首测归档'
    else:
        archive.write_bytes(human_bytes)
    spec = importlib.util.spec_from_file_location('v8_runner', ROOT / 'scripts/v8_blind_evaluation.py')
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    assert runner.database_snapshot() == manifest['database_before']
    assert all(hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == sha
               for name, sha in manifest['fingerprint']['files'].items())
    sources = {x['public_id']: x for x in manifest['items']}
    analyses = {x['public_id']: x['analysis'] for x in predictions['items']}
    old = load(ROOT / 'data/evaluation/reassess-2026-10-17-v7/predictions.json')['items']
    paired = []
    details = []
    for row in comparison['items']:
        source, analysis = sources[row['public_id']], analyses[row['public_id']]
        detail = dict(row, title=analysis['title'], primary=analysis['primary_knowledge_ids'],
                      secondary=analysis['secondary_knowledge_ids'], confidence=analysis['confidence'])
        if row['group'] == 'regression9':
            v7 = old[str(source['origin_problem_id'])]['analysis']
            detail['v7_difficulty'] = v7['difficulty']
            detail['v7_absolute_difference'] = abs(v7['difficulty'] - row['human_difficulty'])
            detail['v7_signed_difference'] = v7['difficulty'] - row['human_difficulty']
            paired.append(detail)
        details.append(detail)
    assert len(paired) == 9
    assert '因此每个连通块都是一棵树' in analyses['B17']['solution_idea']
    assert '两个独立子问题' in analyses['B11']['solution_idea']
    assert '[1, 2m]' in analyses['B10']['solution_idea']
    assert '并查集' in old['1039']['analysis']['solution_idea'] and '多余边' in old['1039']['analysis']['solution_idea']
    v7_mae = statistics.mean(x['v7_absolute_difference'] for x in paired)
    v8_mae = comparison['metrics']['regression9']['mae']
    paired_metrics = {'n': 9, 'v7_mae_against_current_human': v7_mae,
        'v8_mae_against_current_human': v8_mae, 'relative_mae_reduction': 1 - v8_mae / v7_mae,
        'better': sum(x['absolute_difference'] < x['v7_absolute_difference'] for x in paired),
        'equal': sum(x['absolute_difference'] == x['v7_absolute_difference'] for x in paired),
        'worse': sum(x['absolute_difference'] > x['v7_absolute_difference'] for x in paired),
        'v7_within_200': sum(x['v7_absolute_difference'] <= 200 for x in paired),
        'v8_within_200': sum(x['absolute_difference'] <= 200 for x in paired)}
    # 反例验证的是冻结文字方案中的断言；没有把代理写的实现冒充模型生成程序。
    triangle = [(1, 2), (2, 3), (3, 1)]
    official = triangle + [(4, 5), (5, 6), (6, 7)]
    after_bad = [e for e in official if e != (5, 6)] + [(1, 4)]
    after_good = [e for e in official if e != (3, 1)] + [(3, 7)]
    outputs = stack_permutations(3)
    count_first = Counter(x[0] for x in outputs)
    catalan = [1]
    for n in range(1, 4):
        catalan.append(sum(catalan[k - 1] * catalan[n - k] for k in range(1, n + 1)))
    claimed_first = {k: catalan[k - 1] * catalan[3 - k] for k in range(1, 4)}
    assert components(4, triangle) == 2  # n-1边但有三角环和孤点，并非森林。
    assert components(7, official) == components(7, after_bad) == 2
    assert components(7, after_good) == 1
    assert len(outputs) == catalan[3] == 5
    assert count_first != claimed_first
    assert 10 > 2 * 1  # 官方10->1输入，声称[1,2m]完整状态界排除起点。
    witnesses = {
        'B17': {'finding': '错误推出n-1边必为森林，删树边再跨分量加边不能减少分量数',
                'triangle_plus_isolated': {'n': 4, 'edges': triangle, 'components': 2},
                'official_sample_components_before': 2, 'delete_bridge_add_cross_components_after': 2,
                'delete_cycle_edge_add_cross_components_after': 1, 'v7_solution_has_valid_spare_cycle_edge_method': True},
        'B10': {'finding': '遗漏n>=m分支；[1,2m]状态界不覆盖所有合法起点',
                'official_sample': {'n': 10, 'm': 1, 'claimed_max_state': 2, 'correct_answer': 9}},
        'B11': {'finding': '卡特兰公式与总答案对，但按首个弹出k的独立分解证明不成立',
                'n': 3, 'outputs': outputs, 'actual_first_output_counts': dict(count_first),
                'claimed_first_output_counts': claimed_first, 'actual_total': 5, 'claimed_total': 5},
        'scope': '代理确定性反例复核，不是新增教师评审或模型代码执行通过率'}
    calls = [c for a in analyses.values() for c in a['assessment_meta']['calls']]
    assert sum(c['stage'] == 'grade' for c in calls) == 20
    assert all(not a['assessment_meta']['grading_record']['consistency_issues'] for a in analyses.values())
    usage = {key: sum((c['usage'] or {}).get(key, 0) for c in calls)
             for key in ['prompt_tokens', 'completion_tokens', 'total_tokens']}
    high = [x for x in details if x['confidence'] >= .95]
    extra = {'exact_matches': sum(x['difference'] == 0 for x in details),
        'underestimated': sum(x['difference'] < 0 for x in details),
        'overestimated': sum(x['difference'] > 0 for x in details),
        'absolute_difference_gt_200': sum(x['absolute_difference'] > 200 for x in details),
        'absolute_difference_ge_400': sum(x['absolute_difference'] >= 400 for x in details),
        'self_confidence_ge_095': {'n': len(high), 'difference_gt_200': sum(x['absolute_difference'] > 200 for x in high)}}
    case_notes = {
        'B01': 'v7漏树状数组标签的问题已修复；800→1400，但本轮人评1100，两版绝对差同为300。标签改好不等于难度校准完成。',
        'B02': '前缀和主线正确，评分仍800，与v7相同、人评1100。非环形题不需要倍扩；低分分歧与算法发现门槛有关。滑动窗口O(1)应区分已存输入后的辅助空间与流式读入空间。',
        'B03': '矩阵快速幂主线、单位矩阵及负数取模边界基本完整；1300比人评低200。“矩阵乘法是新生先验”未经约定。',
        'B04': '一次连通块预处理+多次查表正确，1100比人评高100。',
        'B05': '选/不选树形DP转移正确，负权和深链边界有考虑；1400比人评高100。',
        'B06': '排序后二分计数主线正确；900→1100，本轮与人评一致。',
        'B07': 'AC+fail信息传播主线可行，1400→1700与本轮人评一致；重复串必须保留终点出现次数，不能只存一个代表编号而丢失重复计数。大规模迭代与内存仍需具体实现验证。',
        'B08': 'DFS增广匹配主线正确；1400比人评低100。理由把1400解释成偏基础算法档，档位语义仍不稳定。',
        'B09': '断环成链、最小/最大区间DP主线正确；1500比人评高100。',
        'B10': '实质边界缺漏：官方10→1样例的起点已大于2m；必须先处理n>=m，或采用覆盖起点的状态上界。第二阶段误判无问题。1200比人评低200。',
        'B11': '公式/总数正确而证明错误：n=3首输出2有213/231两种，模型按k分项仅计1。把低实现量当低门槛，1100比人评低400；第二阶段复述错误独立分解。',
        'B12': '前缀和+二分主线正确；800→1100，比人评低100。',
        'B13': '排序去重是合法替代，不应因原题名哈希而强制单一算法。800比人评低300；“新生已掌握排序/集合”先验未统一。方法表把哈希最坏时间近似写成线性不严谨，冲突可能使其退化。',
        'B14': '正数滑动窗口及单调性解释正确；800→1100，仍比本轮人评低200。',
        'B15': '最早结束贪心及交换论证正确；1400比人评高400。评分对“非平凡证明”门槛赋予过高权重，不能对所有算法统一加分。',
        'B16': '查询后入队的窗口维护顺序正确；1400比人评高100。',
        'B17': '严重错误：n-1边不推出森林；每次删除树边再跨块加边不会净减少分量。原样例含环，仍被两阶段接受；v7并查集记录冗余边方案反而正确。具体分差以当前人评版本的数值字段为准。',
        'B18': '懒标记线段树解法与64位范围基本正确；1500比人评低200。只输出线段树一种方法，不视为必须穷举所有正确替代解法。',
        'B19': '二进制快速幂及64位乘积界正确；1100与人评一致。',
        'B20': '筛法预处理主线可行，1800→1100，比本轮人评低200。需把n=1e8的时空开销具体化；冻结旧输入未含运行限制，不能据文字断言具体实现必定通过。'}
    diagnostic = {'event': 'v8首测', 'state': 'analyzed', 'human_revision': revision, 'analyzed_at': datetime.now(timezone.utc).isoformat(),
        'version_status': '实验版本，暂不支持免审生产', 'metrics': comparison['metrics'],
        'extra_metrics': extra, 'paired_v7_v8_same_current_human': paired_metrics,
        'counterexamples': witnesses, 'usage': usage, 'logical_calls': len(calls),
        'response_models': dict(Counter(c['response_model'] for c in calls)),
        'wall_seconds': (datetime.fromisoformat(predictions['completed_at']) - datetime.fromisoformat(predictions['started_at'])).total_seconds(),
        'median_problem_seconds': statistics.median(a['assessment_meta']['elapsed_seconds'] for a in analyses.values()),
        'private_predictions_sha256': seal['predictions_sha256'], 'human_file_sha256': comparison['human_file_sha256'],
        'database_unchanged': True, 'model_code_and_prompt_unchanged': True,
        'items': [dict(x, audit_note=case_notes[x['public_id']]) for x in details],
        'audit_origin': '模型/标签/证明复核为代理检查，不是用户新增的标签金标准或逐题驳回决定'}
    save(work / 'diagnosis.json', diagnostic)
    human_json = [{'public_id': x['public_id'], 'source_url': x['source_url'], 'difficulty': x['human_difficulty']} for x in details]
    save(work / 'human-ratings.json', {'event': 'v8首测', 'human_revision': revision, 'source_file_sha256': comparison['human_file_sha256'],
                                    'origin': 'project-owner-human-only-difficulty', 'items': human_json})
    print(json.dumps({'verified': True, 'metrics': comparison['metrics'], 'paired': paired_metrics,
                      'extra': extra, 'counterexamples_verified': ['B17', 'B10', 'B11']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
