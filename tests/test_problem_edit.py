"""运行真实编辑页和草稿模块，保存流程不调用模型或正式数据库。"""
from pathlib import Path
import shutil
import subprocess
import pytest


def test_problem_edit_save_drafts_and_late_response():
    node = shutil.which('node')
    if not node:
        pytest.skip('Node.js required')
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run([node, '--experimental-vm-modules', '--no-warnings',
                             str(root / 'tests/frontend/problem_edit.cjs')],
                            cwd=root, capture_output=True, text=True, encoding='utf-8', timeout=25)
    assert result.returncode == 0, result.stdout + result.stderr
