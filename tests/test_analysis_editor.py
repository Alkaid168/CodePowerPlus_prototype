"""运行真实页面模块，验证慢请求时的编辑保护，不调用模型或正式数据库。"""
import shutil
import subprocess
from pathlib import Path

import pytest


def test_shared_save_lock_preserves_inputs_and_original_disabled_state():
    node = shutil.which('node')
    if not node:
        pytest.skip('需要 Node 运行真实前端模块')
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [node, '--experimental-vm-modules', '--no-warnings',
         str(root / 'tests/frontend/analysis_shared_lock.cjs')],
        cwd=root, capture_output=True, text=True, encoding='utf-8', timeout=20)
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'PASS shared lock' in result.stdout
    assert 'PASS delayed editor joins shared lock' in result.stdout
