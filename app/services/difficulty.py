"""Codeforces 风格难度评分：800–3500，步长 100。

系统里只保留一个难度概念——评分本身。中文档位（入门 / 基础 / 区域赛铜牌……）
不单独存储，而是每次按评分推导，避免两处数据打架。

锚点由项目负责人给定：800 是签到题，1200 相当于国内普通高校上机考试，
1600 是算法与思维开始结合，2000 接近 ICPC 区域赛铜牌。其余档位按同一比例补齐。
"""
from __future__ import annotations

MIN_RATING = 800
MAX_RATING = 3500
STEP = 100

# (最低分, 最高分, 档位名, 档位说明)
BANDS: tuple[tuple[int, int, str, str], ...] = (
    (800, 1000, '入门', '签到题，简单模拟、枚举或单一公式'),
    (1100, 1300, '基础', '算法竞赛入门，相当于普通高校程序设计上机考试'),
    (1400, 1600, '进阶', '算法与思维开始结合，需要一步非平凡转化'),
    (1700, 1900, '提高', '需要组合两个以上知识点或一个不易想到的观察'),
    (2000, 2200, '区域赛铜牌', 'ICPC 区域赛铜牌题，需要完整建模与复杂度分析'),
    (2300, 2500, '区域赛银牌', '常见区域赛银牌题'),
    (2600, 2900, '区域赛金牌', '需要高级数据结构或较深的数学推导'),
    (3000, 3500, '国际赛', '世界总决赛级别'),
)


def is_valid_rating(value: object) -> bool:
    """评分必须是 800–3500 之间、100 的整数倍。"""
    if isinstance(value, bool) or not isinstance(value, int):
        return False
    return MIN_RATING <= value <= MAX_RATING and value % STEP == 0


def band_of(rating: int | None) -> dict:
    """把评分翻译成中文档位；未知评分返回空档位而不是抛错。"""
    if not isinstance(rating, int) or isinstance(rating, bool):
        return {'name': '', 'description': '', 'min': None, 'max': None}
    for low, high, name, description in BANDS:
        if low <= rating <= high:
            return {'name': name, 'description': description, 'min': low, 'max': high}
    # 3500 以上或 800 以下不在设计范围内，但历史数据可能出现，给出最近档位避免前端空白。
    nearest = BANDS[0] if rating < MIN_RATING else BANDS[-1]
    return {'name': nearest[2], 'description': nearest[3], 'min': nearest[0], 'max': nearest[1]}


def band_name(rating: int | None) -> str:
    return band_of(rating)['name']


def anchor_text() -> str:
    """给模型看的难度锚点说明，直接由 BANDS 生成，改档位不需要改提示词。"""
    return '\n'.join(f'  - {low}~{high} {name}：{description}' for low, high, name, description in BANDS)
