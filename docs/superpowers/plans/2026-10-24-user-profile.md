# 用户画像模块 Implementation Plan

> **For agentic workers:** Work task-by-task with tests before implementation. Preserve dirty files that predate this plan.

**Goal:** Replace the old tag-ratio profile with a persistent 11-metric cold-start profile and a new profile page that clearly distinguishes self-report from verified evidence.

**Architecture:** Add profile setup persistence and a versioned score summary in the existing SQLite/FastAPI layers. Keep the current rating engine as a separate candidate; do not infer ability from unlinked external submissions.

**Tech Stack:** Python, FastAPI, Pydantic, SQLite, existing ES modules and CSS.

**Spec:** `docs/superpowers/specs/2026-10-24-user-profile-design.md`

## Global Constraints

- Do not use the old profile page or service as product design authority.
- Keep all tests on isolated databases.
- Leave author notes read-only.
- Preserve the external collection database and unrelated dirty files.
- Unknown skill is distinct from a true or self-reported zero.
- Do not add data-dependent evidence until difficulty, method and learner attribution are reliable.

---

### Task 1: Correct thread records and baseline

- [x] Remove unsupported "this conversation is project controller" statements.
- [x] Keep project-wide stage order and mark this section as the user-profile conversation.
- [x] Run the existing full isolated test suite before profile code changes.

### Task 2: Profile contract and persistence

- [x] Write tests for cold-start presets, unknown/self-reported state, 10 domain mapping, syntax-stage total, algorithm-stage RMS total, and no hard cap.
- [x] Add learner profile and dimension prior persistence to an additive SQLite migration.
- [x] Add create/read/update endpoints with strict field validation, atomic create conflicts and versioned update semantics.
- [x] Verify existing recommendation/learning-path APIs retain their response behavior.

### Task 3: Replace the profile page

- [x] Add an initial setup form for experience, language, goals, and target domains.
- [x] Show the 11 score summary and ten L1 domains, including source and missing-evidence states; retain SD in the API rather than inventing aggregate confidence bounds.
- [x] Add editable self-report settings without labeling them as verified skill.
- [x] Match the final frontend template and maintain keyboard/mobile usability.

### Task 4: Verification and records

- [x] Run focused and full tests, frontend module checks, and an isolated HTTP flow.
- [x] Exercise create/edit/profile views in a real browser with screenshots and console checks.
- [x] Confirm the formal learning DB, collection DB and author notes were not modified by tests.
- [x] Update `PROJECT_MEMORY.md`, `task_plan.md`, `findings.md`, and `progress.md` with the actual phase result and remaining evidence/attribution work.

## Errors encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Shared project files contained an unsupported role change | Read original session and current files | Replaced role claim with a module-specific record while keeping overall project order |
| New unit tests referenced a nonexistent taxonomy fixture / old service signature | Focused pytest | Use the existing Taxonomy class and the actual new profile contract |
| Preview patch attempted delete/add on the same path in one patch | Patch validation rejected it without partial edits | Apply separate delete then add |
| CLI run-code was called using an outdated context-object signature | Two browser script invocation errors | Use the installed CLI's async(page) function; rerun assertions successfully |

## Completion

- Full isolated suite: 378 passed, one existing dependency warning; 32 ES modules and smoke flow passed.
- Independent review findings fixed: atomic create conflict, consistent read snapshot, version conflict, pending save controls.
- Edge checked initial/edit/reload/error/retry/duplicate flows, five widths, beginner stage, reduced motion.
- Both real database fingerprints and five author files match the protection baseline.
- Details and next evidence-integration boundary: `docs/user-profile-stage1-2026-10-24.md`.
