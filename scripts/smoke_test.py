"""端到端自检：在一个临时数据库里跑一遍完整流程，打印每一步的结果。

用法：python scripts/smoke_test.py
它不访问网络、不碰正式数据库，用来快速确认重写后的接口是否还能串起来。
"""
import sys
import tempfile
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.config import load_settings  # noqa: E402
from app.main import create_app  # noqa: E402


def main() -> int:
    with tempfile.TemporaryDirectory() as folder:
        # 自检不访问网络：强制关闭模型，走“提示词预览”分支。
        settings = replace(load_settings().with_db(Path(folder) / 'smoke.db'), api_key='')
        with TestClient(create_app(settings)) as client:
            version = client.get('/health').json()['taxonomy_version']
            print(f'health        ok    taxonomy={version}')
            tree = client.get('/api/knowledge/tree').json()
            print(f'knowledge     ok    L1={len(tree["tree"])} 节点={tree["total"]}')
            problem = client.post('/api/problems', json={'title': '示例题', 'description': '给一个数组求和。'}).json()
            print(f'problem       ok    id={problem["id"]}')
            analysis = client.post(f'/api/problems/{problem["id"]}/analyses', json={
                'title': '示例题', 'difficulty': 800, 'confidence': 0.8,
                'primary_knowledge_ids': ['basic.prefix-sum'], 'secondary_knowledge_ids': [],
                'evidence': {'basic.prefix-sum': '需要快速回答区间和'},
                'knowledge_confidence': {'basic.prefix-sum': 0.8},
                'taxonomy_version': version}).json()
            print(f'analysis      ok    id={analysis["analysis"]["analysis_id"]}')
            review = client.post(f'/api/problems/{problem["id"]}/review', json={
                'action': 'approve', 'reviewer': 'smoke', 'comment': '自检',
                'expected_analysis_id': analysis['analysis']['analysis_id']}).json()
            print(f'review        ok    status={review["analysis"]["review_status"]}')
            submission = client.post('/api/submissions', json={
                'user_id': 'smoke', 'problem_id': problem['id'], 'verdict': 'AC', 'language': 'cpp'}).json()
            print(f'submission    ok    knowledge={submission["knowledge_ids"]}')
            profile = client.get('/api/users/smoke/profile').json()
            print(f'profile       ok    有证据的知识点={len(profile["skill_mastery"])}')
            queue = client.get('/api/reviews?status=approved').json()
            print(f'review queue  ok    approved={len(queue["items"])}')
            path = client.get('/api/users/smoke/learning-path',
                              params={'target_id': 'basic.prefix-sum'}).json()
            print('path          ok    ' + ' -> '.join(step['name'] for step in path['steps']))
            hint = client.post('/api/tutor/hint', json={'problem': '求和', 'code': 'int main(){}',
                                                       'verdict': 'WA'}).json()
            kind = 'hint' if 'hint' in hint else 'prompt'
            print(f'tutor         ok    返回 {kind}')
    print('自检完成：接口串起来没有报错。')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
