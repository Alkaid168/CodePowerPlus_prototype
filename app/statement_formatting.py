"""一次性公开题排版维护，严格限制为已审查补丁，不用于猜测任意用户题面的公式。

只修展示语法，不递增语义 revision；分析及其真实输入快照保持不可变。
调用方负责先备份并持久化完整补丁，普通题目编辑仍走原版本保护。
"""
from hashlib import sha256
import json
from pathlib import Path
import re


def digest(text):
    return sha256(text.encode('utf-8')).hexdigest()


def fences(text):
    return re.findall(r'^```[^\n]*\n[\s\S]*?^```[^\n]*(?:\n|$)', text, re.M)


def canonical(text):
    # 不把任意 LaTeX 当作等价。新增命令必须逐一审查并明确映射。
    commands = {'le': '≤', 'leq': '≤', 'ge': '≥', 'geq': '≥', 'ne': '≠', 'neq': '≠',
                'times': '*', 'cdot': '*', 'sum': 'Σ', 'log': 'log',
                'ldots': '...', 'cdots': '...', 'dots': '...',
                'lceil': '⌈', 'rceil': '⌉', 'lfloor': '⌊', 'rfloor': '⌋',
                'mid': '|', 'bmod': 'mod', 'in': '∈', 'text': '', 'mathrm': '',
                'left': '', 'right': ''}
    def command(match):
        name = match[1]
        if name not in commands:
            raise ValueError(f'unreviewed math command: {name}')
        return commands[name]
    text = re.sub(r'\\([a-zA-Z]+)', command, text)
    text = re.sub(r'\\([{} ,;!])', r'\1', text)
    text = text.replace('×', '*').replace('−', '-').replace('…', '...')
    return re.sub(r'[\s${}_()`]', '', text).replace('...', '..')


def validate_formatting(items, patches):
    originals = {item['source_url']: item for item in items}
    if len(originals) != len(items) or len(patches) != len(items):
        raise ValueError('duplicate or incomplete formatting batch')
    seen = set()
    for patch in patches:
        source = patch['source_url']
        original = originals.get(source)
        if source in seen or not original or patch['source_id'] != original['source_id']:
            raise ValueError('formatting source conflict')
        seen.add(source)
        before, after = original['description'], patch['description']
        if patch['original_sha256'] != digest(before):
            raise ValueError('original fingerprint conflict')
        if fences(before) != fences(after):
            raise ValueError('sample/code content changed')
        # 本批次使用行内公式；拒绝未闭合、多余或跨段分隔符。
        body = re.sub(r'^```[^\n]*\n[\s\S]*?^```[^\n]*(?:\n|$)', '', after, flags=re.M)
        if '$$' in body or not re.search(r'\$[^$\n]+\$', body) or '$' in re.sub(r'\$[^$\n]+\$', '', body):
            raise ValueError('unbalanced or missing inline math')
        if canonical(before) != canonical(after):
            raise ValueError(f'non-formatting content conflict: {patch["source_id"]}')


def is_curated_formatting(item, current_description):
    """原批次重导入仅认可已核验的精确排版正文，不泛化为忽略任意内容差异。"""
    folder = Path(__file__).resolve().parents[1] / 'data/evaluation/public40/formatting'
    for platform in ('luogu', 'codeforces'):
        path = folder / f'{platform}.json'
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding='utf-8'))
        if data.get('version') != 'statement-formatting-v1':
            continue
        for patch in data['items']:
            if patch['source_url'] == item['source_url'] and patch['original_sha256'] == digest(item['description']):
                validate_formatting([item], [patch])
                return current_description == patch['description']
    return False


def apply_formatting(db, items, patches):
    """整批检查再原子更新，拒绝用户已修改过的正文、标题或参考资料。"""
    validate_formatting(items, patches)
    originals = {item['source_url']: item for item in items}
    result = []
    with db.transaction():
        changes = []
        for patch in patches:
            original = originals[patch['source_url']]
            matches = db.query('SELECT * FROM problems WHERE source_url=?', (patch['source_url'],))
            if len(matches) != 1:
                raise ValueError('existing source conflict')
            row = dict(matches[0])
            if row['title'] != original['title'] or row['revision'] != 1 or row['reference_solution'] or row['reference_code']:
                raise ValueError('existing metadata/revision conflict')
            previous = patch.get('previous_formatted_sha256', [])
            accepted_previous = digest(row['description']) in previous
            if accepted_previous and (canonical(row['description']) != canonical(original['description'])
                                      or fences(row['description']) != fences(original['description'])):
                raise ValueError('previous formatting content conflict')
            if row['description'] not in (original['description'], patch['description']) and not accepted_previous:
                raise ValueError('existing description conflict')
            changed = row['description'] != patch['description']
            result.append({'source_id': patch['source_id'], 'source_url': patch['source_url'],
                           'problem_id': row['id'], 'revision': row['revision'], 'changed': changed,
                           'original_sha256': patch['original_sha256'], 'formatted_sha256': digest(patch['description'])})
            if changed:
                changes.append((patch['description'], row['id'], row['description']))
        for description, problem_id, before in changes:
            count = db.execute('UPDATE problems SET description=? WHERE id=? AND description=? AND revision=1',
                               (description, problem_id, before)).rowcount
            if count != 1:
                raise ValueError('concurrent formatting conflict')
    return result
