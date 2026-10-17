"""下载前端第三方库到 app/static/vendor/，并记录版本与校验和。

为什么不用 CDN：这个系统是本地单用户工作台，断网也应该能看题面。
为什么不引入 npm：项目刻意保持“一条命令跑起来”，第三方库只做静态文件内置。

用法：
    python scripts/vendor_frontend.py          # 已下载就只校验
    python scripts/vendor_frontend.py --force  # 重新下载
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VENDOR_DIR = ROOT / 'app' / 'static' / 'vendor'
MANIFEST = VENDOR_DIR / 'vendor.json'

# 版本写死，避免“今天能跑、明天换了版本”的不确定。
ASSETS = {
    'marked.esm.js': ('marked 12.0.2（MIT）', 'https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js',
                      'Markdown 解析'),
    'tex-svg.js': ('MathJax 3.2.2 tex-svg（Apache-2.0）',
                   'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js',
                   'LaTeX 公式渲染；SVG 输出，无需字体文件'),
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={'User-Agent': 'CodePowerPlus vendor script'})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--force', action='store_true', help='忽略已有文件，重新下载')
    args = parser.parse_args()

    VENDOR_DIR.mkdir(parents=True, exist_ok=True)
    recorded = json.loads(MANIFEST.read_text(encoding='utf-8')) if MANIFEST.exists() else {}
    entries, missing = {}, []
    for name, (label, url, purpose) in ASSETS.items():
        target = VENDOR_DIR / name
        expected = recorded.get(name, {}).get('sha256')
        if target.exists() and not args.force and expected and digest(target) == expected:
            print(f'{name}: 已存在且校验通过')
        else:
            try:
                payload = download(url)
            except OSError as exc:
                missing.append(f'{name}: {exc}')
                continue
            target.write_bytes(payload)
            print(f'{name}: 下载完成 {len(payload)} 字节')
        entries[name] = {'label': label, 'url': url, 'purpose': purpose, 'sha256': digest(target)}

    if missing:
        print('以下文件无法获取，联网后重跑本脚本：', file=sys.stderr)
        for line in missing:
            print('  - ' + line, file=sys.stderr)
        return 1

    MANIFEST.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'清单已写入 {MANIFEST.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
