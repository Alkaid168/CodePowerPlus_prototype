"""从 lucide-static 生成前端图标模块。

用法：python scripts/build_icons.py
生成 app/static/js/icons.js（只含 SVG 形状数据，不含 innerHTML）。
图标来源：https://unpkg.com/lucide-static@1.45.0（ISC 许可）。
"""
from __future__ import annotations

import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = '1.45.0'
BASE = f'https://unpkg.com/lucide-static@{VERSION}/icons'
ICONS = [
    'layout-dashboard', 'book-open', 'list-checks', 'sparkles', 'clipboard-check', 'send',
    'user-round', 'route', 'target', 'message-circle', 'search', 'plus', 'check', 'x',
    'refresh-cw', 'chevron-right', 'alert-triangle', 'save', 'trash-2', 'play', 'external-link',
    'tags', 'square-pen',
]
KEEP = {'d', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'x1', 'x2', 'y1', 'y2', 'points', 'rx', 'ry'}


def fetch(name: str) -> list[tuple[str, dict[str, str]]]:
    with urllib.request.urlopen(f'{BASE}/{name}.svg', timeout=30) as response:
        root = ET.fromstring(response.read())
    shapes = []
    for child in root:
        tag = child.tag.split('}')[-1]
        attributes = {key: value for key, value in child.attrib.items() if key in KEEP}
        if attributes:
            shapes.append((tag, attributes))
    return shapes


def js_literal(shapes: list[tuple[str, dict[str, str]]]) -> str:
    rows = []
    for tag, attributes in shapes:
        pairs = ', '.join(f'{key}: {value!r}'.replace("'", "'") for key, value in attributes.items())
        rows.append(f"    ['{tag}', {{ {pairs} }}],")
    return '[\n' + '\n'.join(rows) + '\n  ]'


def main() -> int:
    entries = []
    for name in ICONS:
        try:
            shapes = fetch(name)
        except Exception as exc:  # 网络失败时保留旧文件，避免生成半成品
            raise SystemExit(f'下载 {name} 失败：{exc}') from exc
        entries.append(f"  '{name}': {js_literal(shapes)},")
    content = f"""/* 由 scripts/build_icons.py 从 lucide-static@{VERSION} 生成（ISC 许可），请勿手工编辑。 */
const SHAPES = {{
{chr(10).join(entries)}
}};

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, {{ size = 16, stroke = 1.75, label = '' }} = {{}}) {{
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(stroke));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', label ? 'false' : 'true');
  if (label) svg.setAttribute('aria-label', label);
  for (const [tag, attributes] of SHAPES[name] || []) {{
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    svg.append(node);
  }}
  return svg;
}}
"""
    target = ROOT / 'app' / 'static' / 'js' / 'icons.js'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')
    print(f'已生成 {target.relative_to(ROOT)}（{len(ICONS)} 个图标，lucide {VERSION}）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
