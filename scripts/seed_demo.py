"""写入几道演示题目，方便本地打开工作台就有内容可看。

用法：python scripts/seed_demo.py
只写题目，不写分析；分析请在界面里手工标注或调用模型接口。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.container import Container  # noqa: E402

SAMPLES = [
    ('两数之和', '给定整数数组和目标值，返回和为目标值的两个下标。'),
    ('最长递增子序列', '给定整数数组，求最长严格递增子序列的长度。'),
    ('单源最短路', '给定带权无向图和源点，求源点到每个点的最短距离。'),
    ('区间和', '给定静态数组和多次区间询问，输出每次询问的区间和。'),
]


def main() -> int:
    container = Container.build()
    try:
        existing = {problem['title'] for problem in container.problems.all()}
        created = 0
        for title, description in SAMPLES:
            if title in existing:
                continue
            container.problems.create(title, description)
            created += 1
        print(f'新增 {created} 道演示题目，数据库当前共 {container.problems.count()} 道。')
    finally:
        container.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
