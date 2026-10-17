"""语法基础前端适配：真实模块、隔离页面数据，无模型和正式数据库。"""
import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.mark.parametrize('scenario', ['filters', 'knowledge', 'navigation', 'race'])
def test_syntax_frontend(scenario):
    node = shutil.which('node')
    if not node:
        pytest.skip('需要 Node 验证前端行为')
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run([node, '--experimental-vm-modules', '--no-warnings',
                             'tests/frontend/syntax_frontend.cjs', scenario],
                            cwd=root, capture_output=True, text=True, encoding='utf-8', timeout=20)
    assert result.returncode == 0, result.stdout + result.stderr
