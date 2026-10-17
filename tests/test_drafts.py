import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.mark.parametrize('script', ['drafts.cjs', 'drafts_view.cjs', 'drafts_store.cjs'])
def test_draft_storage_and_lifecycle(script):
    node = shutil.which('node')
    if not node:
        pytest.skip('Node.js required for real frontend module regression')
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [node, '--experimental-vm-modules', str(root / 'tests/frontend' / script)],
        cwd=root, capture_output=True, text=True, encoding='utf-8', timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
