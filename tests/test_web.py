"""静态前端与健康检查：ES 模块能正常提供。"""
import hashlib
import json
import re
from pathlib import Path

ASSETS = [
    '/static/css/base.css',
    '/static/css/layout.css',
    '/static/css/components.css',
    '/static/css/overview.css',
    '/static/css/knowledge.css',
    '/static/css/analysis.css',
    '/static/js/app.js',
    '/static/js/api.js',
    '/static/js/dom.js',
    '/static/js/store.js',
    '/static/js/router.js',
    '/static/js/search.js',
    '/static/js/components.js',
    '/static/js/icons.js',
    '/static/js/tagEditor.js',
    '/static/js/markdown.js',
    '/static/js/views/overview.js',
    '/static/js/views/knowledge.js',
    '/static/js/knowledgeIllustrations.js',
    '/static/js/views/problems.js',
    '/static/js/views/analysis.js',
    '/static/js/views/reviews.js',
    '/static/js/views/submissions.js',
    '/static/js/views/profile.js',
    '/static/js/views/path.js',
    '/static/js/views/recommendations.js',
    '/static/js/views/tutor.js',
    '/static/vendor/marked.esm.js',
    '/static/vendor/tex-svg.js',
]

STATIC_DIR = Path(__file__).resolve().parents[1] / 'app' / 'static'
VENDOR_DIR = STATIC_DIR / 'vendor'


def own_modules():
    """只扫描自己写的模块；vendor/ 里是第三方库，不适用本项目的代码规则。"""
    return [module for module in STATIC_DIR.rglob('*.js') if VENDOR_DIR not in module.parents]


def test_homepage_serves_the_module_entry(client):
    page = client.get('/')
    assert page.status_code == 200
    assert 'CodePowerPlus' in page.text
    assert 'type="module"' in page.text
    assert '/static/css/base.css' in page.text


def test_static_assets_are_available(client):
    for path in ASSETS:
        assert client.get(path).status_code == 200, path
    assert client.get('/static/js/missing.js').status_code == 404


def test_static_assets_revalidate_so_the_browser_never_runs_stale_modules(client):
    """没有 Cache-Control 时浏览器会启发式缓存模块，改前端却像没生效。"""
    for path in ('/static/js/app.js', '/static/css/analysis.css', '/static/js/views/analysis.js'):
        response = client.get(path)
        assert response.status_code == 200
        assert response.headers['cache-control'] == 'no-cache', path


def test_health_endpoint(client, version):
    body = client.get('/health').json()
    assert body['status'] == 'ok'
    assert body['taxonomy_version'] == version
    assert body['model_configured'] is False
    assert body['mode'] == 'local-single-user'
    assert body['version']


def test_every_relative_import_resolves():
    """前端模块之间用相对路径互相引用，写错路径在浏览器里才会炸；这里提前拦住。"""
    missing = []
    for module in own_modules():
        source = module.read_text(encoding='utf-8')
        for target in re.findall(r"from '(\.[^']+)'", source):
            if not (module.parent / target).resolve().exists():
                missing.append(f'{module.relative_to(STATIC_DIR)} -> {target}')
    assert not missing


def test_no_module_builds_html_from_strings():
    """界面统一用 dom.js 的 h() 创建节点；出现 innerHTML 视为回归。"""
    pattern = re.compile(r'\.\s*innerHTML')
    offenders = [str(module.relative_to(STATIC_DIR))
                 for module in own_modules()
                 if pattern.search(module.read_text(encoding='utf-8'))]
    assert not offenders


def test_vendored_markdown_and_math_assets_are_pinned(client):
    """第三方库随仓库分发，离线可用；版本与校验和写在 vendor.json 里。"""
    manifest = json.loads((VENDOR_DIR / 'vendor.json').read_text(encoding='utf-8'))
    assert set(manifest) == {'marked.esm.js', 'tex-svg.js'}
    for name, entry in manifest.items():
        payload = (VENDOR_DIR / name).read_bytes()
        assert hashlib.sha256(payload).hexdigest() == entry['sha256'], name
        assert 'cdn.jsdelivr.net' in entry['url']
        assert client.get(f'/static/vendor/{name}').status_code == 200


def test_markdown_module_escapes_html_and_guards_urls():
    """题面里的原生 HTML 必须被转义，链接只允许 http(s)。"""
    source = (STATIC_DIR / 'js' / 'markdown.js').read_text(encoding='utf-8')
    assert 'renderer.html = (html) => escapeHtml(html)' in source
    assert 'safeUrl' in source
    assert '/^https?:\\/\\//i.test(text)' in source
    assert 'createContextualFragment' in source
    assert 'innerHTML' not in source
    assert 'skipHtmlTags' in source


def test_analysis_page_is_the_problem_intake_module(client):
    """第四个页面改名成“题目录入与分析”，是双栏录入 + 分析与手工标注。"""
    page = client.get('/')
    assert '/static/css/analysis.css' in page.text
    app_source = (STATIC_DIR / 'js' / 'app.js').read_text(encoding='utf-8')
    assert "label: '题目录入与分析'" in app_source
    assert "label: '题目分析'" not in app_source

    source = (STATIC_DIR / 'js' / 'views' / 'analysis.js').read_text(encoding='utf-8')
    for marker in ('renderEntry', 'renderExisting', 'analysis-workspace', 'analysis-column-left',
                   'analysis-column-right', 'analysis-tabs', 'markdown-input', 'difficultyTag',
                   'createTagEditor', 'api.createProblem', 'api.analyzeProblem', 'sourceLink',
                   'mountMarkdown'):
        assert marker in source, marker
    # 录入必须先建题再分析：这样模型失败时题面不会丢。
    assert source.index('api.createProblem') < source.index('api.analyzeProblem')
    for removed in ('用模型分析新题目', 'analyzeNewProblem', '难度（1–5）'):
        assert removed not in source

    css = (STATIC_DIR / 'css' / 'analysis.css').read_text(encoding='utf-8').lower()
    assert 'grid-template-columns: minmax(360px, 440px) minmax(0, 1fr)' in css
    assert 'linear-gradient' not in css
    assert 'transition: all' not in css

def test_overview_uses_the_confirmed_monochrome_design_system(client):
    page = client.get('/')
    assert page.status_code == 200
    assert '/static/css/overview.css' in page.text
    assert client.get('/static/css/overview.css').status_code == 200

    overview_source = (STATIC_DIR / 'js' / 'views' / 'overview.js').read_text(encoding='utf-8')
    for marker in ('overview-v2', 'overview-metrics', 'overview-focus', 'overview-lower'):
        assert marker in overview_source

    base_css = (STATIC_DIR / 'css' / 'base.css').read_text(encoding='utf-8')
    assert '--canvas: #f5f5f5' in base_css
    assert '--brand: #111111' in base_css

    production_css = '\n'.join(
        path.read_text(encoding='utf-8')
        for path in (STATIC_DIR / 'css').glob('*.css')
    ).lower()
    assert 'linear-gradient' not in production_css
    assert 'radial-gradient' not in production_css

def test_logo_asset_is_served_as_transparent_png(client):
    response = client.get('/static/assets/codepowerplus-mark.png')
    assert response.status_code == 200
    assert response.headers['content-type'] == 'image/png'
    assert response.content[:8] == b'\x89PNG\r\n\x1a\n'
    assert response.content[25] == 6, 'PNG must use RGBA color type'


def test_global_shell_follows_latest_template_rules(client):
    page = client.get('/')
    assert page.status_code == 200
    assert 'brand-logo' in page.text
    assert '/static/assets/codepowerplus-mark.png' in page.text
    assert 'CodePowerPlus' in page.text
    assert 'page-eyebrow' not in page.text
    assert 'sidebar-foot' not in page.text

    app_source = (STATIC_DIR / 'js' / 'app.js').read_text(encoding='utf-8')
    assert 'nav-section-label' not in app_source

    overview_source = (STATIC_DIR / 'js' / 'views' / 'overview.js').read_text(encoding='utf-8')
    assert 'overview-metric-foot' not in overview_source
    assert '审核通过后进入画像' not in overview_source
    assert '建立可选择与分析的题目' not in overview_source

    components_css = (STATIC_DIR / 'css' / 'components.css').read_text(encoding='utf-8')
    assert 'animation: card-enter' in components_css
    primary_button = re.search(r'\.btn\s*\{(?P<body>[^}]*)\}', components_css)
    assert primary_button is not None
    assert 'background: var(--ink)' in primary_button.group('body')
    assert 'color: #fff' in primary_button.group('body')
    assert '.main { animation' not in components_css

def test_overview_remains_minimal_and_avoids_repeated_entry_cards():
    source = (STATIC_DIR / 'js' / 'views' / 'overview.js').read_text(encoding='utf-8')
    assert 'overview-side' not in source
    assert 'overview-quick-grid' not in source
    assert 'focusAside' not in source
    assert 'overview-focus-aside' not in source
    assert '/static/assets/codepowerplus-mark.png' not in source
    assert '常用入口' not in source
    assert '学习流程' not in source
    assert '系统状态' not in source

def test_overview_uses_card_bubbles_without_topbar(client):
    page = client.get('/')
    assert 'class="topbar"' not in page.text

    source = (STATIC_DIR / 'js' / 'views' / 'overview.js').read_text(encoding='utf-8')
    assert "class: 'card overview-metric'" in source
    assert 'overview-focus' in source
    assert 'overview-lower-card' in source
    assert 'api.problems({ limit: 1 })' in source
    assert 'firstProblem' in source

    overview_css = (STATIC_DIR / 'css' / 'overview.css').read_text(encoding='utf-8')
    focus_rule = re.search(r'\.overview-focus\s*\{(?P<body>[^}]*)\}', overview_css)
    assert focus_rule is not None
    assert 'background: var(--surface)' in focus_rule.group('body')
    assert 'background: #111' not in focus_rule.group('body')
    assert 'overview-focus-aside' not in overview_css
    assert 'display: flex' in focus_rule.group('body')
    assert 'grid-template-columns' not in focus_rule.group('body')


def test_knowledge_page_follows_final_template(client):
    """知识树采用 OI Wiki 式 L1 顶部导航，左侧只浏览当前领域。"""
    page = client.get('/')
    assert page.status_code == 200
    assert '/static/css/knowledge.css' in page.text
    assert 'rel="icon"' in page.text
    assert client.get('/static/css/knowledge.css').status_code == 200

    app_source = (STATIC_DIR / 'js' / 'app.js').read_text(encoding='utf-8')
    assert 'showTitle: false' in app_source
    assert 'route.showTitle === false' in app_source

    api_source = (STATIC_DIR / 'js' / 'api.js').read_text(encoding='utf-8')
    assert "knowledgeDetail: (id) => request(`/api/knowledge/node/${encodeURIComponent(id)}`)" in api_source
    source = (STATIC_DIR / 'js' / 'views' / 'knowledge.js').read_text(encoding='utf-8')
    for marker in (
        'knowledge-level-bar', 'knowledge-l1-tabs', 'knowledge-tree-panel',
        'knowledge-detail-panel', 'tree-row', 'knowledge-result-path',
        'selectedRootId', 'knowledge-child',
    ):
        assert marker in source
    for removed in (
        'knowledge-total', 'knowledge-filter', 'knowledge-expand-actions',
        'knowledge-level-chip', 'tree-level', 'knowledge-id', 'knowledge-role',
        '标签词表',
    ):
        assert removed not in source
    assert 'api.knowledgeSearch' not in source
    assert 'normalizeSearch' in source
    assert 'knowledge-actions' not in source
    assert '设为学习目标' not in source
    assert '看推荐训练' not in source
    assert 'matchesSearch' in source
    assert 'const showIntroduction = !hasChildren && node.level >= 2;' in source
    assert "h('h3', {}, '下级节点')" not in source
    illustration_source = (STATIC_DIR / 'js' / 'knowledgeIllustrations.js').read_text(encoding='utf-8')
    for l1_id in ('basic', 'search', 'dp', 'string', 'math', 'ds', 'graph', 'geometry', 'misc'):
        assert f"  '{l1_id}':" in illustration_source
    assert 'knowledgeIllustration' in source
    assert 'knowledge-l1-art' in source
    assert "const path = node.level === 1 ? [node] : [...(node.ancestors || []), node];" in source
    assert "node.level === 1 ? null : h('nav'" in source
    assert 'function normalizeDetail(node)' in source
    assert 'const children = Array.isArray(node.children) ? node.children : [];' in source
    assert 'const ancestors = Array.isArray(node.ancestors) ? node.ancestors : [];' in source
    assert '<details>' not in source

    css = (STATIC_DIR / 'css' / 'knowledge.css').read_text(encoding='utf-8').lower()
    for marker in (
        'grid-template-columns: minmax(340px, 390px) minmax(0, 1fr)',
        'background: var(--surface)',
        "grid-template-columns: 16px minmax(0, 1fr)",
    ):
        assert marker in css
    for removed in ('background: #111111', 'background: #777777', 'background: #e8e8e8'):
        assert removed not in css
    assert '.tree-group' not in css
    children_rule = re.search(r"\.knowledge-children\s*\{(?P<body>[^}]*)\}", css)
    assert children_rule is not None
    assert 'border-top' not in children_rule.group('body')
