"""测试夹具：每个用例一套独立的临时数据库与应用实例（默认不调用模型）。"""
from __future__ import annotations

import os
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

# 必须在导入 app.main 之前设置，避免模块级应用碰到正式的 data/codepowerplus.db。
os.environ.setdefault('CODEPOWERPLUS_DB_PATH', ':memory:')

from app.config import load_settings  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture()
def settings(tmp_path):
    return replace(load_settings().with_db(tmp_path / 'test.db'), api_key='')


@pytest.fixture()
def app(settings):
    return create_app(settings)


@pytest.fixture()
def client(app):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def container(app):
    return app.state.container


@pytest.fixture()
def version(container):
    return container.taxonomy.version


@pytest.fixture()
def make_problem(client, version):
    """建一道题并写一条手工分析，默认仍处于待审核状态。"""
    def factory(title='测试题', primary=('basic.prefix-sum',), secondary=(), difficulty=1600,
                description='给定数组，多次询问区间和。'):
        problem = client.post('/api/problems', json={'title': title, 'description': description}).json()
        ids = list(primary) + list(secondary)
        payload = {
            'difficulty': difficulty,
            'confidence': 0.8,
            'primary_knowledge_ids': list(primary),
            'secondary_knowledge_ids': list(secondary),
            'evidence': {node_id: f'{node_id} 是必要解法' for node_id in ids},
            'knowledge_confidence': {node_id: 0.8 for node_id in ids},
            'taxonomy_version': version,
        }
        response = client.post(f'/api/problems/{problem["id"]}/analyses', json=payload)
        assert response.status_code == 201, response.text
        return problem, response.json()['analysis']
    return factory


@pytest.fixture()
def approved_problem(client, make_problem):
    """一道审核通过的题：提交后会计入知识画像。"""
    def factory(**kwargs):
        problem, analysis = make_problem(**kwargs)
        response = client.post(f'/api/problems/{problem["id"]}/review', json={
            'action': 'approve', 'reviewer': 'tester', 'comment': '核对通过',
            'expected_analysis_id': analysis['analysis_id']})
        assert response.status_code == 200, response.text
        return problem, response.json()['analysis']
    return factory
