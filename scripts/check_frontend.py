"""前端 ES 模块语法检查。

为什么不用 `node --check`：Node 对 .js 文件先按 CommonJS 试解析，
实测会漏掉模块里的括号/参数列表错误（曾让一个缺 `)` 的文件通过了检查）。
这里改用 `vm.SourceTextModule`，按真正的 ES 模块语法解析，报错带行号。

用法：
    python scripts/check_frontend.py            # 检查 app/static/js
    python scripts/check_frontend.py <目录或文件>...
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIR = ROOT / 'app' / 'static' / 'js'

PROBE = r'''
const vm = require('node:vm');
const fs = require('node:fs');
const files = JSON.parse(process.argv[1]);
const failures = [];
for (const file of files) {
  try {
    new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { identifier: file });
  } catch (error) {
    failures.push({ file, message: error.message });
  }
}
process.stdout.write(JSON.stringify(failures));
'''


def collect(targets: list[str]) -> list[Path]:
    files: list[Path] = []
    for target in targets:
        path = Path(target)
        if path.is_dir():
            files.extend(sorted(p for p in path.rglob('*.js') if 'vendor' not in p.parts))
        elif path.is_file():
            files.append(path)
    return files


def main() -> int:
    targets = sys.argv[1:] or [str(DEFAULT_DIR)]
    files = collect(targets)
    if not files:
        print('没有找到需要检查的 .js 文件', file=sys.stderr)
        return 1
    node = shutil.which('node')
    if node is None:
        print('未找到 node，跳过前端语法检查', file=sys.stderr)
        return 0

    result = subprocess.run(
        [node, '--experimental-vm-modules', '--no-warnings', '-e', PROBE,
         json.dumps([str(path) for path in files])],
        capture_output=True, text=True, encoding='utf-8')
    if result.returncode != 0:
        print(result.stderr.strip() or '语法检查进程失败', file=sys.stderr)
        return 1
    failures = json.loads(result.stdout or '[]')
    for failure in failures:
        print(f"{failure['file']}: {failure['message']}", file=sys.stderr)
    print(f'检查 {len(files)} 个模块，失败 {len(failures)} 个')
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
