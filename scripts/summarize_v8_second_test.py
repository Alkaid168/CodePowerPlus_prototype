"""合并80份有证据语义复核、四次评分和冻结人评；只生成离线表格输入/报告。"""
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

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from app.blind_evaluation import digest, verify_commitment

RUNS=['first','second_1','second_2','second_3']
LABELS=['首测','二测第1次','二测第2次','二测第3次']


def read(path):return json.loads(path.read_text(encoding='utf-8'))


def write(path,data):path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def verify_reviews(items):
    expected={(f'B{i:02}',run) for i in range(1,21) for run in RUNS}
    actual={}
    for row in items:
        if not isinstance(row,dict):raise ValueError('复核对象缺失，禁止导出表格')
        key=(row['public_id'],row['run_id'])
        if key not in expected or key in actual:raise ValueError('复核编号/轮次重复或无效')
        if any(type(row.get(k)) is not bool for k in ['tags_correct','solution_correct','joint_correct']):
            raise ValueError('复核结果必须为原生布尔，不能猜测或缺失')
        if row['joint_correct'] != (row['tags_correct'] and row['solution_correct']):raise ValueError('联合正确不是标签与题解的逻辑与')
        if not isinstance(row.get('evidence'),str) or len(row['evidence'].strip())<12:raise ValueError('缺少可复核具体依据')
        actual[key]=row
    if set(actual)!=expected:raise ValueError('必须完整80份有证据复核，不能只输出成功或有利项')
    return actual


def main():
    w=ROOT/'data/evaluation/v8-second-test';first=ROOT/'data/evaluation/v8-first-test'
    manifest=read(w/'manifest.json');seal=read(w/'completion.json');second=read(w/'predictions.json')
    if digest(second)!=seal['predictions_sha256'] or digest(manifest)!=seal['manifest_sha256']:
        raise ValueError('二测封存哈希不一致')
    first_seal=read(first/'commitment.json')
    original=read(Path(os.environ['LOCALAPPDATA'])/'CodePowerPlus/blind-evaluations/v8-first-test/predictions.json')
    verify_commitment(original,first_seal)
    human=read(first/'human-ratings.json')
    if digest(human)!=manifest['fingerprint']['human_revision_r1_sha256']:raise ValueError('人工评分版本变化')
    human_scores={x['public_id']:x['difficulty'] for x in human['items']}
    assert human_scores['B17']==1500
    rubric_hash=hashlib.sha256((ROOT/'docs/v8-second-test-review-rubric.md').read_bytes()).hexdigest()
    review_items=[]
    for file in [w/'reviews/B01-B10.json',w/'reviews/B11-B20.json']:
        data=read(file)
        if data.get('rubric_sha256')!=rubric_hash:raise ValueError('复核标准指纹不一致')
        for name,expected_hash in data.get('packet_hashes',{}).items():
            if hashlib.sha256((w/f'review-packets/{name}.json').read_bytes()).hexdigest()!=expected_hash:
                raise ValueError(f'复核包已变化：{name}')
        review_items.extend(data['items'])
    reviewed=verify_reviews(review_items)
    source={x['public_id']:x for x in manifest['items']}
    analyses={(x['public_id'],'first'):x['analysis'] for x in original['items']}
    analyses.update({(x['public_id'],f"second_{x['repetition']}"):x['analysis'] for x in second['items']})
    if len(analyses)!=80:raise ValueError('不是完整20x4预测')
    # 核对复核者看到的内容与不可改写的原模型输出一致。
    packet_positions={}
    for run in RUNS:
        packet=read(w/f'review-packets/{run}.json')
        if len(packet['items'])!=20 or packet.get('partial',False):raise ValueError('语义包未齐20题')
        for index,row in enumerate(packet['items']):
            a=analyses[(row['public_id'],run)]
            if row['solution_idea']!=a['solution_idea'] or row['primary_knowledge_ids']!=a['primary_knowledge_ids'] or row['secondary_knowledge_ids']!=a['secondary_knowledge_ids']:
                raise ValueError('复核包与模型原输出不符')
            packet_positions[(row['public_id'],run)]=index
    problems=[]
    for i in range(1,21):
        ident=f'B{i:02}';runs={}
        for run in RUNS:
            decision=reviewed[(ident,run)]
            runs[run]={'rating':analyses[(ident,run)]['difficulty'],
                **{k:decision[k] for k in ['tags_correct','solution_correct','joint_correct','evidence']},
                'source_ref':f"data/evaluation/v8-second-test/review-packets/{run}.json#/items/{packet_positions[(ident,run)]}"}
        # 展示名不沿用首测把一般图误称森林的前提；封存预测原文不改写。
        display_title='图的最少换边连通（CF25D）' if ident=='B17' else analyses[(ident,'first')]['title']
        problems.append({'anonymous_id':ident,'title':display_title,
            'url':source[ident]['source_url'],'group':source[ident]['group'],
            'human_rating':human_scores[ident],'runs':runs})
    results={'schema_version':1,'event':'v8二测','status':'reviewed','human_revision':'r1',
        'reviewed_by':'两组代理逐份复核，root按冻结题意/词表及反例终审；非教师金标准',
        'reviewed_at':datetime.now(timezone.utc).isoformat(),'rubric_sha256':rubric_hash,'problems':problems}
    metrics={}
    for run in RUNS:
        metrics[run]={}
        for group in ['all20','regression9','new11']:
            rows=[x for x in problems if group=='all20' or x['group']==group]
            diffs=[x['runs'][run]['rating']-x['human_rating'] for x in rows]
            metrics[run][group]={'n':len(rows),'mae':statistics.mean(abs(x) for x in diffs),
                'bias':statistics.mean(diffs),'within_100':sum(abs(x)<=100 for x in diffs),
                'within_200':sum(abs(x)<=200 for x in diffs),'max_error':max(abs(x) for x in diffs),
                'tags_correct':sum(x['runs'][run]['tags_correct'] for x in rows),
                'solution_correct':sum(x['runs'][run]['solution_correct'] for x in rows),
                'joint_correct':sum(x['runs'][run]['joint_correct'] for x in rows)}
    ranges=[{'public_id':x['anonymous_id'],
             'range':max(x['runs'][r]['rating'] for r in RUNS[1:])-min(x['runs'][r]['rating'] for r in RUNS[1:]),
             'four_joint_count':sum(x['runs'][r]['joint_correct'] for r in RUNS)} for x in problems]
    transport=[c for x in second['items'] for c in x['transport_records']]
    assert all(c['request_parameters']['model']=='deepseek-flash' and c['request_parameters']['reasoning_effort']=='high'
               and c['request_parameters']['extra_body']=={'thinking':{'type':'enabled'}} for c in transport)
    assert all(c.get('response_model')=='deepseek-flash' and c.get('finish_reason')=='stop' for c in transport)
    usage={k:sum((c.get('usage') or {}).get(k,0) for c in transport)
           for k in ['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens']}
    spec=importlib.util.spec_from_file_location('v8_second_runner',ROOT/'scripts/v8_second_test.py');runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
    if runner.runner().database_snapshot()!=manifest['database_before']:raise ValueError('正式库不再匹配基线')
    for name,h in manifest['fingerprint']['original_fingerprint']['files'].items():
        if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=h:raise ValueError('原提示词或实现改变')
    failed_attempts=sum(len(read(f)) for f in (w/'failures').glob('*.json')) if (w/'failures').exists() else 0
    summary={'event':'v8二测','state':'reviewed','human_revision':'r1','metrics':metrics,
        'stability':{'ranges':ranges,'three_scores_identical':sum(x['range']==0 for x in ranges),
                     'maximum_three_score_range':max(x['range'] for x in ranges)},
        'logical_stage_calls':len(transport),'reasoning_field_nonempty_calls':sum(c['reasoning_content_chars']>0 for c in transport),
        'structure_or_tag_repairs':sum(not c['valid'] for x in second['items'] for c in x['analysis']['assessment_meta']['calls']),
        'semantic_return_events':sum(c['stage']=='grade' and c.get('consistent') is False for x in second['items'] for c in x['analysis']['assessment_meta']['calls']),
        'failed_whole_run_attempts':failed_attempts,'usage':usage,
        'median_run_seconds':statistics.median(x['analysis']['assessment_meta']['elapsed_seconds'] for x in second['items']),
        'database_unchanged':True,'first_predictions_unchanged':True,'prompts_unchanged':True,
        'results_sha256':digest(results),'predictions_sha256':seal['predictions_sha256']}
    write(w/'results.json',results);write(w/'summary.json',summary)
    lines=['# v8二测：Flash显式High三次重测','','20题原提示词与题面不变；人工评分使用修订1，CF25D=1500。共60份真实重测，与首测合计80份按统一标准代理复核。原预测不改写，结果不是教师金标准或平台AC率。','',
        '| 轮次 | 全20 MAE | 旧9 MAE | 新11 MAE | ≤100 | ≤200 | 最大分差 | 标签与题解均正确 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |']
    for run,label in zip(RUNS,LABELS):
        a=metrics[run]['all20'];lines.append(f"| {label} | {a['mae']:.1f} | {metrics[run]['regression9']['mae']:.1f} | {metrics[run]['new11']['mae']:.1f} | {a['within_100']}/20 | {a['within_200']}/20 | {a['max_error']} | {a['joint_correct']}/20 |")
    lines+=['','| ID | 题名 | 人工 | 首测 | 二测1 | 二测2 | 二测3 | 四次联合正确数 |','| --- | --- | --- | --- | --- | --- | --- | --- |']
    for p in problems:
        values=' | '.join(str(p['runs'][r]['rating']) for r in RUNS);count=sum(p['runs'][r]['joint_correct'] for r in RUNS)
        lines.append(f"| {p['anonymous_id']} | [{p['title']}]({p['url']}) | {p['human_rating']} | {values} | {count} |")
    lines+=['','## 结果解读','',
        '首测MAE170；三轮分别155、140、170，60份合并MAE155。说明评分误差略有改善，但第三轮与首测相同，不能认定难度标尺已经稳定。三轮联合正确分别18/20、19/20、19/20，首测为15/20；这是同一标准的代理复核结果，不是用户新增审核或OJ通过率。',
        '剩余问题包括遗漏独立构造标签、把频数统计误标成计数排序、快速幂说明含错误等式、双树状数组中间乘积溢出风险。首测还出现AC自动机重复模式计数的错误备选、BFS边界遗漏、卡特兰分解证明错误、哈希最坏复杂度误述和CF25D换边错误。各次判定及反例见工作簿审核明细和reviews，不能只从难度分差判断解法正确。',
        '结论：本轮显式High有较好的标签/题解表现，但难度评分仍有波动，继续保留v8实验版本与逐题审核，不据20道公开经典题宣布免审生产可用。','',
        '## 正确性口径与证据','',
        '最后一列为四份中tags_correct与solution_correct同时为真的次数。每一份均留具体依据和来源，见results.json与reviews。允许多种可行解法，不要求列全替代方法；但所声称的方法/边界/证明与复杂度不能有确定性错误，标签需覆盖独立核心。正确步骤夹错误数学等式亦按严格题解文本记录，不能等同于实际程序必定WA。未运行模型生成程序提交OJ。','',
        '二测前冻结参考标准，两个复核组读取去掉模型/人工分及置信度的包。长期记录有首测摘要，不能声称历史完全盲。争议项由root依据原题/词表与反例终审，差异保留在adjudication_history。独立参考检查不是模型通过记录。','',
        '## 思考强度解释','',
        '首测使用旧deepseek-chat别名，未显式传thinking/reasoning_effort；现有历史usage无思考细分，不能确认当时实际强度。当前官方新接口默认思考开启且High，因此default不意味着Low。二测将模型名与High显式固定，同时参数/模式与旧别名路径不同，不能把差异完全归因于思考强度。',
        '[官方思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)说明High参数、默认行为与temperature在思考模式被忽略；[模型/价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)支持Flash及JSON输出。未修改提示词。','',
        '## 稳定性与成本记录','',
        f"三次评分完全相同 {summary['stability']['three_scores_identical']}/20题；同题三次最大评分跨度 {summary['stability']['maximum_three_score_range']}分。60份是20题的重复测量，不能当60道独立新题。",
        f"本轮逻辑阶段请求 {len(transport)} 次，非空思考字段 {summary['reasoning_field_nonempty_calls']} 次；单份完整流程耗时中位数 {summary['median_run_seconds']:.2f}秒。输入 {usage['prompt_tokens']}、输出 {usage['completion_tokens']} tokens（含服务端usage记录，未当账单实付）。",
        f"格式/标签修复 {summary['structure_or_tag_repairs']} 次，实质审查退回 {summary['semantic_return_events']} 次，整份运行失败尝试 {failed_attempts} 次。所有成功及失败留痕，不挑最优样本。",'',
        '正式库与首测封存哈希不变。分数差和标签/题解正确性分开判断，不将±200窗口称为正式驳回率，不将本次公开经典题与代理审查外推为学校未见题生产准确率。']
    (ROOT/'docs/v8-second-test-report.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(json.dumps({'metrics':metrics,'logical_calls':len(transport),'three_scores_identical':summary['stability']['three_scores_identical']},ensure_ascii=False))


if __name__=='__main__':main()
