"""真实前端审核流程：隔离 DOM/API，不写正式记录。"""
import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.mark.parametrize('scenario', ['detail', 'queue', 'mutation', 'syntax-rating'])
def test_review_workspace(scenario):
    node = shutil.which('node')
    if not node:
        pytest.skip('需要 Node 验证前端行为')
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run([node, '--experimental-vm-modules', '--no-warnings',
                             'tests/frontend/review_workspace.cjs', scenario],
                            cwd=root, capture_output=True, text=True, encoding='utf-8', timeout=20)
    assert result.returncode == 0, result.stdout + result.stderr
