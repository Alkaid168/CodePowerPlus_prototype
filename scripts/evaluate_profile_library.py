"""Replay three synthetic learners against a read-only copy of a local library.

No judge or model is called: AC/WA are scripted assumptions, not real solves.
Run with the project Python, --source-db and a fresh --output directory.
"""
from __future__ import annotations

import argparse
from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["CODEPOWERPLUS_DB_PATH"] = ":memory:"

import numpy as np
from fastapi.testclient import TestClient
from scipy.special import expit

from app.config import load_settings
from app.main import create_app


SCENARIOS = [
    ("c-beginner", "C语言初学者", [
        (1001, "AC"), (1021, "AC"), (1023, "AC"), (1025, "AC"),
        (1003, "WA"), (1024, "AC"), (1022, "AC"), (1027, "WA"),
    ]),
    ("contest-beginner", "约1200竞赛初学者（假设）", [
        (1012, "AC"), (1006, "AC"), (1005, "AC"), (1008, "AC"),
        (1010, "WA"), (1015, "AC"), (1016, "WA"), (1038, "WA"),
    ]),
    ("demo-user", "当前demo-user副本", [
        (1000, "AC"), (1004, "AC"), (1005, "AC"), (1006, "AC"),
        (1007, "AC"), (1008, "AC"), (1009, "AC"), (1010, "AC"),
        (1011, "AC"), (1012, "AC"), (1013, "AC"), (1014, "AC"),
        (1015, "AC"), (1016, "AC"), (1017, "AC"), (1018, "AC"),
        (1020, "AC"), (1030, "AC"), (1032, "AC"), (1037, "AC"),
        (1038, "AC"), (1040, "AC"),
    ]),
]
DOMAINS = ("syntax", "basic", "search", "dp", "string", "math", "ds", "graph", "geometry", "misc")


def fingerprint(conn):
    result = {}
    for (name, schema) in conn.execute(
        "SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name"
    ):
        rows = [tuple(r) for r in conn.execute(f'SELECT * FROM "{name}" ORDER BY rowid')]
        result[name] = {
            "count": len(rows),
            "sha256": hashlib.sha256(json.dumps([schema, rows], ensure_ascii=False).encode()).hexdigest(),
        }
    return result


def reason(record, taxonomy):
    """Independent eligibility oracle, with readable exclusions."""
    if record["verdict"] == "CE":
        return "CE不计能力"
    if not record["analysis_id"]:
        return "无当前已通过审核的分析"
    if record["taxonomy_version"] != taxonomy.version:
        return "词表版本不符"
    ids = record["knowledge_ids"]
    if not ids or not taxonomy.allowed(ids):
        return "无合法标签"
    roots = {key.split(".")[0] for key in ids}
    difficulty = record["difficulty"]
    if (difficulty is None or difficulty <= 0 or ("syntax" in roots) != (difficulty < 800)
            or ("syntax" in roots and len(roots) > 1)):
        return "难度与领域不匹配"
    return None


def oracle(records, taxonomy):
    """Independent 1-point numerical integration; no production rating functions.

    All synthetic observations use a single timestamp so the likelihood product
    has a simple independent calculation. This tests accounting, not inactivity.
    """
    episodes = {}
    ignored = 0
    for record in sorted(records, key=lambda r: r["created_at"]):
        excluded = reason(record, taxonomy)
        if excluded:
            ignored += record["verdict"] != "CE"
            continue
        old = episodes.get(record["problem_id"])
        if old is None or old["verdict"] != "AC" and record["verdict"] == "AC":
            episodes[record["problem_id"]] = record
    grid = np.arange(-12000., 16001.)
    scores, counts, means = {}, {}, {}
    completed = any(r["verdict"] == "AC" and not r["knowledge_ids"][0].startswith("syntax.")
                    for r in episodes.values())
    for domain in DOMAINS:
        chosen = [r for r in episodes.values() if domain in {k.split(".")[0] for k in r["knowledge_ids"]}]
        counts[domain] = sum(1 / len({k.split(".")[0] for k in r["knowledge_ids"]}) for r in chosen)
        log_weights = -.5 * (grid / 800) ** 2
        for record in chosen:
            z = np.log(10) * (grid + 200 - record["difficulty"]) / 400
            log_weights += np.log(expit(z if record["verdict"] == "AC" else -z)) / \
                len({k.split(".")[0] for k in record["knowledge_ids"]})
        weights = np.exp(log_weights - log_weights.max())
        means[domain] = float(np.dot(grid, weights) / weights.sum())
        scores[domain] = max(0, round(means[domain]))
    completed |= means["syntax"] >= 800
    scores["syntax"] = 800 if completed else min(800, scores["syntax"])
    total = round(800 + np.sqrt(sum(max(scores[d] - 800, 0)**2 for d in DOMAINS[1:]) / 9)) \
        if completed else scores["syntax"]
    return dict(scores=scores, counts=counts, means=means, total=total, ignored=ignored)


def check(profile, records, taxonomy):
    expected = oracle(records, taxonomy)
    assert profile["overall"]["score"] == expected["total"], (profile, expected)
    assert abs(profile["overall"]["evidence_count"] - sum(expected["counts"].values())) < 1e-9
    assert profile["unmapped_submission_count"] == expected["ignored"]
    for dimension in profile["dimensions"]:
        key = dimension["knowledge_id"]
        assert dimension["score"] == expected["scores"][key], (key, dimension, expected)
        assert abs(dimension["evidence_count"] - expected["counts"][key]) < 1e-9
        assert abs(dimension["latent_mean"] - expected["means"][key]) < .01
    return expected


def run(source_path, output):
    output.mkdir(parents=True, exist_ok=False)
    source = sqlite3.connect(source_path.as_uri() + "?mode=ro", uri=True)
    before = fingerprint(source)
    results = {"synthetic": True, "judge_called": False, "scenarios": [], "checks": []}
    baseline = output / "baseline.db"
    with sqlite3.connect(baseline) as dest:
        source.backup(dest)
    settings = replace(load_settings(), api_key="")
    library = {}
    # Never open or initialize the source through the application.
    inventory_app = create_app(settings.with_db(baseline))
    c = inventory_app.state.container
    for problem in c.problems.all():
        analysis = c.analyses.latest(problem["id"])
        library[problem["id"]] = {
            "id": problem["id"], "title": problem["title"],
            "difficulty": analysis.get("difficulty") if analysis else None,
            "review_status": analysis["review_status"] if analysis else None,
            "is_stale": analysis["is_stale"] if analysis else None,
            "knowledge_ids": ((analysis.get("primary_knowledge_ids", []) +
                               analysis.get("secondary_knowledge_ids", [])) if analysis else []),
        }
    c.close()
    results["library"] = list(sorted(library.values(), key=lambda p: p["id"]))
    for item in results["library"]:
        item["exclusion"] = reason(dict(
            verdict="AC", analysis_id=1 if item["review_status"] == "approved" and not item["is_stale"] else None,
            taxonomy_version=c.taxonomy.version, knowledge_ids=item["knowledge_ids"],
            difficulty=item["difficulty"],
        ), c.taxonomy)
    for user_id, label, attempts in SCENARIOS:
        db_path = output / f"{user_id}.db"
        with sqlite3.connect(baseline) as src, sqlite3.connect(db_path) as dest:
            src.backup(dest)
        app = create_app(settings.with_db(db_path))
        c = app.state.container
        original = c.submissions.history_for_user(user_id)
        # Current real demo-user is empty. Fail clearly if future history needs a timed oracle.
        assert not original, "已有历史需扩展独立核算时间协议，不可悄悄丢弃"
        initial_others = [dict(r) for r in c.db.query("SELECT * FROM submissions WHERE user_id<>?", (user_id,))]
        scenario = {"user_id": user_id, "label": label, "original_submissions": len(original), "steps": []}
        with TestClient(app) as client, patch("app.repositories.utcnow", return_value="2026-10-24T10:00:00+00:00"):
            initial = client.get(f"/api/users/{user_id}/profile").json()
            check(initial, original, c.taxonomy)
            for problem_id, verdict in attempts:
                assert problem_id in library, f"题目{problem_id}不存在"
                response = client.post("/api/submissions", json={
                    "user_id": user_id, "problem_id": problem_id, "verdict": verdict,
                    "language": "c" if user_id == "c-beginner" else "cpp",
                })
                assert response.status_code == 201, response.text
                record = response.json()
                profile = client.get(f"/api/users/{user_id}/profile").json()
                history = c.submissions.history_for_user(user_id)
                check(profile, history, c.taxonomy)
                if reason(record, c.taxonomy):
                    assert record["warning"], "未计分必须向用户说明"
                else:
                    assert not record["warning"], "有效证据不应误报"
                scenario["steps"].append({
                    "problem_id": problem_id, "title": library[problem_id]["title"],
                    "difficulty": library[problem_id]["difficulty"], "verdict": verdict,
                    "exclusion": reason(record, c.taxonomy), "warning": record["warning"],
                    "profile": profile,
                })
            scenario["final"] = profile
            # Read consistency and raw history checks.
            assert client.get(f"/api/users/{user_id}/profile").json() == profile
            listing = client.get("/api/submissions", params={"user_id": user_id, "limit": 500}).json()
            assert listing["total"] == len(attempts)
            assert len(history) == len(attempts)
            assert [dict(r) for r in c.db.query("SELECT * FROM submissions WHERE user_id<>?", (user_id,))] == initial_others
            # Post-AC retries and failures must not farm or erase evidence.
            solved = next(s for s in scenario["steps"] if not s["exclusion"] and s["verdict"] == "AC")
            for verdict in ("AC", "WA", "CE"):
                response = client.post("/api/submissions", json={
                    "user_id": user_id, "problem_id": solved["problem_id"], "verdict": verdict})
                assert response.status_code == 201
                assert client.get(f"/api/users/{user_id}/profile").json() == profile
            scenario["retry_checks"] = 3
            # Keep the preview DB showing exactly the requested main experiment.
            c.db.execute("DELETE FROM submissions WHERE user_id=? AND id>?",
                         (user_id, history[-1]["id"]))
        # Application restart, not only a second GET, must preserve ratings.
        restarted = create_app(settings.with_db(db_path))
        with TestClient(restarted) as client:
            assert client.get(f"/api/users/{user_id}/profile").json() == profile
        results["scenarios"].append(scenario)
        print(label, "total", profile["overall"]["score"], "evidence",
              profile["overall"]["evidence_count"], "unmapped", profile["unmapped_submission_count"])
        print({d["name"]: d["score"] for d in profile["dimensions"]})
    after = fingerprint(source)
    source.close()
    assert before == after, "源数据库发生变化：必须人工核查并发写入"
    results["source_unchanged"] = True
    results["source_fingerprint"] = before
    results["checks"] = ["38步独立数值积分核对", "9次AC/WA/CE同题去重", "三次重启持久性", "其他用户隔离", "源库只读且指纹不变"]
    # A separate combined fixture lets the browser display all three learners.
    preview = output / "preview.db"
    with sqlite3.connect(baseline) as src, sqlite3.connect(preview) as dest:
        src.backup(dest)
    with sqlite3.connect(preview) as dest:
        for scenario in results["scenarios"]:
            with sqlite3.connect(output / f'{scenario["user_id"]}.db') as src:
                src.row_factory = sqlite3.Row
                for row in src.execute("SELECT * FROM submissions WHERE user_id=?", (scenario["user_id"],)):
                    values = {k: row[k] for k in row.keys() if k != "id"}
                    columns = ",".join(values)
                    dest.execute(f"INSERT INTO submissions({columns}) VALUES ({','.join('?' for _ in values)})",
                                 tuple(values.values()))
    with TestClient(create_app(settings.with_db(preview))) as client:
        for scenario in results["scenarios"]:
            assert client.get(f'/api/users/{scenario["user_id"]}/profile').json() == scenario["final"]
    (output / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-db", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    run(args.source_db.resolve(strict=True), args.output.resolve())
