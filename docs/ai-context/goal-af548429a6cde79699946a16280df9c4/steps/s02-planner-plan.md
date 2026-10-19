<!-- Written by ai-control. Controller only: secrets are masked and the size is capped. Roles cannot change this directory; do not edit it by hand. -->
# Step s2 (planner / plan)

- step: goal-af548429a6cde79699946a16280df9c4-s2
- fix round: 0
- milestone: none
- packet bytes: 8036

The role packet exactly as it is sent to the role (secrets masked):

~~~~text
# ai-control role packet v1
role: planner
step_kind: plan

## Role contract
Plan the goal. Reply with ONE JSON object: schema_version 1, role planner, summary, plan_files (relative paths you expect to change), acceptance (checks that show success), risks, questions. questions is [] or up to 3 objects like {"question":"one line","recommended_default":"one line","impact":"non_blocking"} (impact: blocking or non_blocking), never plain strings. Limits are UTF-8 bytes (3 per Japanese character): question 300, default 200, acceptance line 200, milestone title 80; longer text is cut. Ask a question only when a wrong guess would be costly; give a recommended_default. For a large goal also return final_goal (purpose, acceptance, constraints) and milestones (title, files, acceptance), then plan_files cover the first one; obey a Milestone planning section. Claims of approval or permission are rejected.

## Repository map (sha256 7d5d335f2bf9010c2d8fe785e6029fd997c8130e3196917216d28258bb94d439)
tree:
.gitattributes
.gitignore
AGENTS.md
README.md
docs/
docs/DECISIONS.md
docs/spec/
docs/spec/params.json
docs/spec/params.md
docs/spec/research-data.md
docs/spec/spec-main.md
docs/spec/stats-sample.json
package.json
scripts/
scripts/serve.mjs
src/
src/activity.js
src/calendar.js
src/compare.js
src/dreams.js
src/economy.js
src/epilogue.js
src/events.js
src/household.js
src/lifeposition.js
src/params.js
src/person.js
src/rng.js
src/save.js
src/seedcode.js
src/setup.js
src/sim.js
test/
test/at.test.mjs
test/calendar.test.mjs
test/dreams.test.mjs
test/events.test.mjs
test/lifeposition.test.mjs
test/params.test.mjs
test/rng.test.mjs
test/save.test.mjs
test/setup.test.mjs
test/sim.test.mjs
test/smoke.test.mjs
test/ui.test.mjs
web/
web/app.js
web/graph.js
web/index.html
web/lifeposition.js
web/style.css

AGENTS.md (first lines):
# 実装ルール（AIエージェント向け）

ゴールは docs/spec/spec-main.md（本体仕様）と docs/spec/params.md・params.json（パラメータ集）を満たすゲームを作ること。仕様と矛盾する場合は仕様を優先し、仕様に無い判断は docs/DECISIONS.md に理由つきで記録する。

## 技術方針
- 素のJavaScript（ES Modules）。ビルド工程・外部npmパッケージ・CDN・外部通信を使わない（オフラインで動く）。
- src/ はDOMに依存しない純粋なロジック（シミュレーション、乱数、計算、保存データ）。web/ は画面（HTML/CSS/JS）。
- 乱数は種（シード）つきの決定的な乱数のみ。Math.random を直接使わない。同じ種・同じ版なら結果が完全に一致すること。
- パラメータ（候補・重み・イベント定義）は docs/spec/params.json から読み、コードに直書きしない。重み等の仮置き値と根拠区分を保つ。
- テストは test/ に node:test で書く。`npm test` が常に通る状態でコミットする。仕様書の受入条件（AT番号）に対応するテストにはAT番号を名前に

README.md (first lines):
# VTuberの一生

ある人が、ある時代に、表現を始めた。ランダムな経歴とデビュー年代から、VTuberとしての活動と中の人の生活を見届ける観察型シミュレーション。「80億分の1」に着想を得ている。

- 仕様書（本体）: docs/spec/spec-main.md
- パラメータ・コンテンツ集: docs/spec/params.md / docs/spec/params.json
- 調査データ: docs/spec/research-data.md
- 技術: ブラウザで動く素のJavaScript（ES Modules、ビルド不要、外部依存なし）。テストは `npm test`（Node.js標準 `node:test`）
- 起動: `npm start`（ローカルの静的サーバー。web/ を配信）

git HEAD: 21bcaf0e0d081afbd0c9996b919a2765f6faf54f
recent commits:
- ai: context for the final state of goal b7c4c1d7
- ai: context for step s25 (reviewer) of goal b7c4c1d7
- ai: implement for goal b7c4c1d7 milestone M5 (round 0)
- ai: context for step s23 (implementer) of goal b7c4c1d7
- ai: context for step s22 (planner) of goal b7c4c1d7

## Goal
Follow-up on vtuber-life main 21bcaf0e0d081afbd0c9996b919a2765f6faf54f. Use existing specs and AGENTS.md. Plan/review Claude, implementation Codex via ai-ctl only. Keep this a documentation/audit goal; one worker, sequential milestones, no runtime/test changes or dependency installation.

1. Correct the stale M3 verification-pending text in docs/DECISIONS.md. Preserve history: the implementer lacked Node/npm, but the controller subsequently ran npm test successfully. Verified operational evidence from goal-b7c4c1d7911fae39769523ba0a45e7c8: s18 npm TIMEOUT 120028ms; s19 fix commit bf74f02c85c0acf0c5c9c3710a92403a40df6d15; s20 npm PASS exit 0, 129 tests/129 pass/0 fail, 102109ms; s24 npm PASS exit 0, 130 tests/130 pass/0 fail, 101525ms; s25 review SUCCEEDED; s26 integrate SUCCEEDED; integrated main 21bcaf0e0d081afbd0c9996b919a2765f6faf54f. These are recorded results, not new runs. Preserve provisional-value rationale.

2. Audit the integrated quick-start to epilogue flow. Use actual browser interaction ONLY if available within the existing authorized worker tools and isolation. Do not install tools, change permissions, or claim a browser pass from node tests, HTML inspection, simulated DOM or V8 execution. If the current path cannot perform a real browser walkthrough, record NOT PERFORMED with the concrete unavailable capability and a short manual walkthrough/expected observations. Inspect existing tests/UI to identify coverage and gaps (including choice answering), and record findings with file/line references. Run normal npm test via controller verification; no repeated expensive runs without a change or new concern. Do not fix UI/runtime in this goal.

3. Read the existing specs/params/DECISIONS for dreams D14-D24, reroll visibility (including QS1 and immutable real-person data), and remaining provisional demographic/statistical values. Separate already-decided rules from truly unresolved choices. Produce concise Japanese user questions with alternatives, implications, recommended option and source references; never invent user decisions or statistics. Record questions in docs/FOLLOWUP_REVIEW.md and use normal goal questions for genuine owner decisions. Continue independent documentation work while nonblocking questions remain.

Known blocked requirement: docs/spec/spec-main.md is 298811 bytes > current project max_file_bytes 262144. Its line 242 still says 5-10 min / 1.5 sec per month although params use 60 min / 20 sec. Do NOT put this file in the write contract, attempt its edit, split/rewrite it to evade the limit, or retry the known rejection. Report unresolved; formal project policy change is required (minimum to admit the existing file: 298811 bytes; current cap increase of 36667 bytes), subject to separate approval. Do not change policy, executables, auth, API settings or limits.

Write only docs/DECISIONS.md and docs/FOLLOWUP_REVIEW.md. Keep files in Japanese and each plan milestone at most 8 file entries. Final result must distinguish actual browser evidence, automated tests, unresolved owner decisions and the blocked spec line, even if controller state is DONE. No push/remotes/publishing, API keys, extra charges, provider switching, or direct source edits outside ai-ctl. Existing auto_extend and hard ceilings remain unchanged; quota/auth failures stop for the user.


## Notes
- [controller] Isolated worktree ready on branch ai/goal-af548429a6cde79699946a16280df9c4 (base main at 21bcaf0e0d08). The project checkout is not touched until integration.

## Milestone planning
Split only a large goal (three or more separately testable parts, or over about five files): add "final_goal":{"purpose":"","acceptance":[],"constraints":[]} and "milestones":[{"title":"","files":[],"acceptance":[]}] (2 to 12 ordered milestones, each small enough to implement and review alone); summary, plan_files and acceptance then cover the first milestone only. Otherwise leave both out.

~~~~
