"""运行真实 Markdown 模块，保护页面切换后的公式测量时机。"""
import shutil
import subprocess
from pathlib import Path

import pytest


def test_math_typesets_only_after_page_is_connected():
    node = shutil.which('node')
    if not node:
        pytest.skip('需要 Node 验证真实前端模块')
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [node, '--experimental-vm-modules', '--no-warnings',
         str(root / 'tests/frontend/markdown_connected.cjs')],
        cwd=root, capture_output=True, text=True, encoding='utf-8', timeout=20)
    assert result.returncode == 0, result.stdout + result.stderr
