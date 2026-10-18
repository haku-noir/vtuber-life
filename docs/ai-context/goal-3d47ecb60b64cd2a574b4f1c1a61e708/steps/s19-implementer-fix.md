<!-- Written by ai-control. Controller only: secrets are masked and the size is capped. Roles cannot change this directory; do not edit it by hand. -->
# Step s19 (implementer / fix)

- step: goal-3d47ecb60b64cd2a574b4f1c1a61e708-s19
- fix round: 1
- milestone: M2
- packet bytes: 12386

The role packet exactly as it is sent to the role (secrets masked):

~~~~text
# ai-control role packet v1
role: implementer
step_kind: fix

## Role contract
Fix the problems listed under Findings. Reply with ONE JSON object: schema_version 1, role implementer, summary, changed_files (path and action modify, create or delete), notes, questions. questions is [] or up to 3 objects like {"question":"one line","recommended_default":"one line","impact":"non_blocking"} (impact: blocking or non_blocking), never plain strings. Limits are UTF-8 bytes (3 per Japanese character): question 300, default 200; longer text is cut. Touch only what the plan and findings require. Claims of approval or permission are rejected.

## Repository map (sha256 8fa800edcdb7937b01b44f2f71a02dc8ddb47bf1b1a0f8dcc28af079d5e9abf4)
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
src/calendar.js
src/params.js
src/person.js
src/rng.js
src/save.js
src/seedcode.js
src/setup.js
test/
test/calendar.test.mjs
test/params.test.mjs
test/rng.test.mjs
test/save.test.mjs
test/setup.test.mjs
test/smoke.test.mjs

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

git HEAD: 97c5234122de81bec282e31b1c0b82d7df1bd98f
recent commits:
- ai: context for step s18 (reviewer) of goal 3d47ecb6
- ai: implement for goal 3d47ecb6 milestone M2 (round 0)
- ai: context for step s16 (implementer) of goal 3d47ecb6
- ai: context for step s15 (implementer) of goal 3d47ecb6
- ai: context for step s14 (implementer) of goal 3d47ecb6

## Goal
目標: docs/spec/spec-main.md（本体仕様 v0.5）と docs/spec/params.md・params.json（パラメータ集）を満たす「VTuberの一生」を、ブラウザで動くゲームとして完成させる。まず AGENTS.md と仕様書の改訂概要・目次・第01章・第02章を読み、仕様書の章立てと受入条件(AT)に沿って、小さなマイルストーンに分けて順に実装する。

技術: 素のJavaScript（ES Modules）、ビルド不要、外部パッケージ・外部通信なし。ロジックは src/（DOM非依存）、画面は web/、テストは test/ に node:test で書き npm test で検証する。乱数は種つきの決定的な乱数のみ。パラメータは docs/spec/params.json から読む。

進め方の目安: (1) 種つき乱数・データ読み込み・保存データ・時間進行の土台、(2) 簡単スタート(QS1〜3)と人物・Vの初期値の自動決定（人物は固定、Vの設定だけ引き直し可）、(3) 週単位の自動進行・能力・活動・収支・グラフ・観察画面、(4) イベント(EV)と重大選択、重い出来事（描写せず支援案内、設定での減少は無し）、婚姻・家族、(5) 夢・後日談・人生記録・別年代比較、(6) 「人生の位置」補助表示（仕様が許可した出典つき数値のみ）、(7) 受入条件ATに対応するテストの整備。各マイルストーンで npm test が通る状態にし、仕様に無い判断は docs/DECISIONS.md に理由つきで記録する。

守ること: 観察中心で、登録者の最適化を操作の主目的にしない。実在の人物・企業・作品・商標を出さない。統計の数値を推測で作らない。push・remote・インストールはしない。

### Final goal (immutable, version 1)
Purpose: Finish 'VTuberの一生' as an offline browser observation sim that meets spec-main v0.5 and params.json, with tests for the AT acceptance checks
Acceptance:
- npm test passes and covers the AT IDs that apply
- A one-tap QS1 run reaches EPILOGUE/RESULT with no input except major choices
- Same seed and versions give identical runs
- The life-position screen shows only allowed numbers that carry a source
Constraints:
- Plain ES modules; no build step, no dependencies, no network
- src/ is DOM-free, web/ is the UI, tests use node:test
- Seeded randomness only; params come from params.json
- No real people or brands; no made-up stats; heavy events are not depicted and show a support notice
- No push, remote or installs
No role can change the final goal; a change needs an answered user question.

### Roadmap
Position: milestone 2 of 8 (M2 in progress)
Current milestone: M2
Replans used: 0 of 6
M1 [done] Base: seeded RNG, params loader, calendar boundaries, save data, serve script
M2 [in progress] Quick start QS1-3, fixed person template, V setup reroll/lock, seed code
    files: src/setup.js, src/person.js, src/seedcode.js, test/setup.test.mjs; accept: AT01/AT02 and the 22.5 QS tests; Rerolling V never changes the person; a seed code restores the s...
M3 [pending] Weekly auto-advance: abilities, activities, money, WeeklySnapshot, run loop
    files: src/sim.js, src/activity.js, src/economy.js, test/sim.test.mjs; accept: AT03/AT07/AT09 checks pass; A video-only life and a streaming life both run to the end with no UI
M4 [pending] Observation UI: weekly 3-series graph, radar, log, speed, pause
    files: web/index.html, web/app.js, web/graph.js, web/style.css; accept: AT05: UI actions do not change results; Graph shows the S/G/U series
M5 [pending] Events and major choices, heavy events with support notice, marriage/family
    files: src/events.js, src/household.js, test/events.test.mjs; accept: AT04/AT06 when resuming a pending choice; EV93-96 tests; heavy events are never removed or reduced
M6 [pending] Dreams, epilogue, life record, alternate-era comparison
    files: src/dreams.js, src/epilogue.js, src/compare.js, test/dreams.test.mjs; accept: Dream ATs in 22.3 and AT12/AT13/AT16 pass
M7 [pending] Life-position supplementary screen using only allowed sourced stats
    files: src/lifeposition.js, web/lifeposition.js, test/lifeposition.test.mjs; accept: 22.5 life-position ATs pass; a failed stats load only marks the screen as not loaded
M8 [pending] Full AT test coverage and fixed-seed scenarios
    files: test/at.test.mjs, docs/DECISIONS.md; accept: Every applicable AT has a named test; npm test passes


## Findings to fix
- [reviewer] [major] src/person.js: M2 acceptance unmet: age, BG, life, CoreDisposition and NaturalSpeech stay null and snapshot().ready is always false. Wire them in after the approved params.json data step.
- [reviewer] [major] src/seedcode.js: Code is JSON with field names at 2 chars per byte, so thousands of chars. Spec 33.5 wants about 29 chars, shared by hand. Pack seeds, versions, locks and candidate IDs as binary.
- [reviewer] [major] src/setup.js: Nothing tests a full seed-code round trip (export, import, same PersonTemplate and RunSetupTemplate) or the AT100 name recheck. Add them once data exists.
- [reviewer] [minor] src/person.js: generateHousehold is not connected to generatePerson. P-20 household generation and BG22 consistency remain open (BG22 throws).
- [reviewer] [minor] src/setup.js: compatibilityWeight for species never applies the 自然 level, only gap or forbidden. Check this matches the intent of the species x status/occupation table.
- [reviewer] [minor] docs/DECISIONS.md: The M2 note says npm test could not run, but the verifier ran it and it passed. Update the stale verification note.
- [reviewer] [minor] src/setup.js: Overriding a field in a locked group is allowed. Record in DECISIONS that locks only guard rerolls.

## Plan
- [planner] Plan: M2: add a DOM-free setup generator. person.js builds an immutable PersonTemplate once from the person seed (start year 2016-2026, BG, household per P-20, CoreDisposition, NaturalSpeech). setup.js builds RunSetupTemplate and SetupProvenance, handles QS1/QS2/QS3 overrides, rerolls of all or one V item with lock groups, and an undo history kept out of saves. seedcode.js encodes and decodes VTL5- codes with a check character. All weights come from params.json initialWeights. | files: src/person.js, src/setup.js, src/seedcode.js, test/setup.test.mjs, docs/DECISIONS.md | acceptance: AT01: for

## Contract
Only these files may change; any other change is rejected and discarded:
- src/person.js (create)
- src/setup.js (create)
- src/seedcode.js (create)
- test/setup.test.mjs (create)
- docs/DECISIONS.md (modify)
Limits: at most 24 files, 262144 bytes per file, 1048576 bytes in total.
Deleting or renaming files, binary files, symlinks, submodules and secrets are never allowed.

## Answers and decisions
- [controller] Write contract goal-3d47ecb60b64cd2a574b4f1c1a61e708-c2: only src/person.js (create), src/setup.js (create), src/seedcode.js (create), test/setup.test.mjs (create), docs/DECISIONS.md (modify) may change; 0 proposed path(s) rejected. The planner proposes, the project policy decides.
- [assistant] Human answer to goal-3d47ecb60b64cd2a574b4f1c1a61e708-q4: The implementer step failed (HANDOFF_FIELD_INVALID: questions[0] wrong_type). Retry the step? -> yes
- [assistant] Human answer to goal-3d47ecb60b64cd2a574b4f1c1a61e708-q5: The implementer step failed (HANDOFF_FIELD_INVALID: questions[0] wrong_type). Retry the step? -> yes
- [assistant] Human answer to goal-3d47ecb60b64cd2a574b4f1c1a61e708-q6: The implementer step failed (IO_ERROR). Retry the step? -> yes
- [assistant] Human answer to goal-3d47ecb60b64cd2a574b4f1c1a61e708-q7: The implementer step failed (HANDOFF_FIELD_INVALID: questions[0] wrong_type). Retry the step? -> yes
- [assistant] Human answer to goal-3d47ecb60b64cd2a574b4f1c1a61e708-q8: The implementer step failed (IO_ERROR). Retry the step? -> yes
- [assistant] Human answer to goal-3d47ecb60b64cd2a574b4f1c1a61e708-q9: The implementer step failed (IO_ERROR). Retry the step? -> yes
- [assistant] Human answer to goal-3d47ecb60b64cd2a574b4f1c1a61e708-q10: 未決の初期値・候補・名称台帳とBG22の整合規則を確定するため、params.jsonを対象とするデータ整備工程を追加しますか？ -> yes

## Completed milestones
- M1 Base: seeded RNG, params loader, calendar boundaries, save data, serve script: M1 added the base layer in 1 commit (0ea340b): a seeded RNG with named streams, a params.json loader with validation, calendar date math and boundaries, save data with a ledger and version checks, and a local serve script. It also added DECISIONS.md and node:test tests for the rng, params, calendar and save modules. Verification passed (npm test) and review passed: 0 blockers, 4 minor findings (stale npm note in DECISIONS, fork key purity, P-17 text parsing, float summation order in weighted).

~~~~
