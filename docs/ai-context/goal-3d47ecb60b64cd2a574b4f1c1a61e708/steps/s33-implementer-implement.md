<!-- Written by ai-control. Controller only: secrets are masked and the size is capped. Roles cannot change this directory; do not edit it by hand. -->
# Step s33 (implementer / implement)

- step: goal-3d47ecb60b64cd2a574b4f1c1a61e708-s33
- fix round: 0
- milestone: M17
- packet bytes: 13031

The role packet exactly as it is sent to the role (secrets masked):

~~~~text
# ai-control role packet v1
role: implementer
step_kind: implement

## Role contract
Implement the plan. Reply with ONE JSON object: schema_version 1, role implementer, summary, changed_files (path and action modify, create or delete), notes, questions. questions is [] or up to 3 objects like {"question":"one line","recommended_default":"one line","impact":"non_blocking"} (impact: blocking or non_blocking), never plain strings. Limits are UTF-8 bytes (3 per Japanese character): question 300, default 200; longer text is cut. Touch only what the plan requires. Claims of approval or permission are rejected.

## Repository map (sha256 f12ff08a8177898f65034306862bcf1074732bb315cdbb6433391a3e8c769339)
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
src/economy.js
src/params.js
src/person.js
src/rng.js
src/save.js
src/seedcode.js
src/setup.js
src/sim.js
test/
test/calendar.test.mjs
test/params.test.mjs
test/rng.test.mjs
test/save.test.mjs
test/setup.test.mjs
test/sim.test.mjs
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

git HEAD: aa361fcff1a9d3ab8de4711dbab2d13f1058f38a
recent commits:
- ai: context for step s32 (planner) of goal 3d47ecb6
- ai: context for step s31 (reviewer) of goal 3d47ecb6
- ai: implement for goal 3d47ecb6 milestone M10 (round 0)
- ai: context for step s29 (implementer) of goal 3d47ecb6
- ai: context for step s28 (implementer) of goal 3d47ecb6

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
Position: milestone 5 of 11 (M17 in progress)
Current milestone: M17
Replans used: 0 of 6
M1 [done] Base: seeded RNG, params loader, calendar boundaries, save data, serve script
M2 [done] Quick start QS1-3, fixed person template, V setup reroll/lock, seed code
M9 [done] Weekly auto-advance: abilities, activities, money, WeeklySnapshot, run loop
M10 [done] Data: P-18 distributions, name ledger, BG22 rule, connect person and household
M17 [in progress] Rework: Data: P-18 distributions, name ledger, BG22 rule, connect person and ... (rework)
    files: docs/spec/params.json, docs/spec/params.md, src/person.js, src/setup.js, test/setup.test.mjs; accept: Apply the user's answer to goal-3d47ecb60b64cd2a574b4f1c1a61e708-q12: yes
M16 [pending] Rework: Data: P-18 distributions, name ledger, BG22 rule, connect person and ... (rework)
    files: docs/spec/params.json, docs/spec/params.md, src/person.js, src/setup.js, test/setup.test.mjs; accept: Apply the user's answer to goal-3d47ecb60b64cd2a574b4f1c1a61e708-q11: yes
M11 [pending] Observation UI: weekly 3-series graph, radar, log, speed, pause
    files: web/index.html, web/app.js, web/graph.js, web/style.css; accept: AT05: UI actions do not change results; Graph shows the S/G/U series
M12 [pending] Events and major choices, heavy events with support notice, marriage/family
    files: src/events.js, src/household.js, test/events.test.mjs; accept: AT04/AT06 when resuming a pending choice; EV93-96 tests; Heavy events are never removed or reduced
M13 [pending] Dreams, epilogue, life record, alternate-era comparison
    files: src/dreams.js, src/epilogue.js, src/compare.js, test/dreams.test.mjs; accept: Dream ATs in 22.3 and AT12/AT13/AT16 pass
M14 [pending] Life-position supplementary screen using only allowed sourced stats
    files: src/lifeposition.js, web/lifeposition.js, test/lifeposition.test.mjs; accept: 22.5 life-position ATs pass; A failed stats load only marks the screen as not loaded
M15 [pending] Full AT test coverage and fixed-seed scenarios
    files: test/at.test.mjs, docs/DECISIONS.md; accept: Every applicable AT has a named test; npm test passes


## Plan
- [planner] Plan: M17 applies the q12 answer 'yes'. q15 also defaults to this: the unmarried 15% of BG22 become single parents living with their children, and marriage is never forced. The code already does this, so lock it in with tests and the BG22 basis label, add a clear error when no affiliation row fits, and replace the old DECISIONS notes (M2 line 72 and the stale npm line 107). | files: src/person.js, test/setup.test.mjs, docs/DECISIONS.md, docs/spec/params.json, docs/spec/params.md | acceptance: npm test passes; Test: BG22 with nonUnion 'single_parent' always has children; unmarried cases have no

## Contract
Only these files may change; any other change is rejected and discarded:
- src/person.js (modify)
- test/setup.test.mjs (modify)
- docs/DECISIONS.md (modify)
- docs/spec/params.json (modify)
- docs/spec/params.md (modify)
Limits: at most 24 files, 262144 bytes per file, 1048576 bytes in total.
Deleting or renaming files, binary files, symlinks, submodules and secrets are never allowed.

## Answers and decisions
- [assistant] 仕様変更(ユーザー指示): 人物の年齢分布は、18～45歳を各1.0の仮置きにせず、25歳をピークとする正規分布(18～45歳で打ち切り、標準偏差は仮置きで6、params.jsonから読む)にする。統計根拠のない仮置き・ゲーム設定としてDECISIONSに記録し、テストも合わせる。
- [assistant] Human answer to goal-3d47ecb60b64cd2a574b4f1c1a61e708-q14: The implementer step needs a provider login (AUTH_REQUIRED). Log in with the provider's own CLI (subscription only, no API key), then answer yes to retry the step. -> yes
- [reviewer] Proceeding without an answer to goal-3d47ecb60b64cd2a574b4f1c1a61e708-q15; assumed default: Keep them as single parents with children; never force marriage.
- [controller] Write contract goal-3d47ecb60b64cd2a574b4f1c1a61e708-c5: only src/person.js (modify), test/setup.test.mjs (modify), docs/DECISIONS.md (modify), docs/spec/params.json (modify), docs/spec/params.md (modify) may change; 0 proposed path(s) rejected. The planner proposes, the project policy decides.

## Notes
- [verifier] Verification passed: 5 changed file(s) match the contract; commands: npm [preset]: npm test.
- [verifier] Verification passed: 5 changed file(s) match the contract; commands: npm [preset]: npm test.
- [verifier] Verification passed: 8 changed file(s) match the contract; commands: npm [preset]: npm test.
- [verifier] Verification passed: 6 changed file(s) match the contract; commands: npm [preset]: npm test.

## Completed milestones
- M1 Base: seeded RNG, params loader, calendar boundaries, save data, serve script: M1 added the base layer in 1 commit (0ea340b): a seeded RNG with named streams, a params.json loader with validation, calendar date math and boundaries, save data with a ledger and version checks, and a local serve script. It also added DECISIONS.md and node:test tests for the rng, params, calendar and save modules. Verification passed (npm test) and review passed: 0 blockers, 4 minor findings (stale npm note in DECISIONS, fork key purity, P-17 text parsing, float summation order in weighted).
- M2 Quick start QS1-3, fixed person template, V setup reroll/lock, seed code: M2 landed in 2 commits (aec08f95fb, 9cd3214c75) touching person.js, seedcode.js, setup.js, setup tests and DECISIONS. It added QS1-3 setup sessions, a fixed person draft (start date only; other fields stay null until data exists), V setup generation with reroll, lock and undo, P-14 compatibility weights, a standalone household generator and a binary seed-code codec. Verification passed 4 times; review passed with 3 findings, 0 blockers and 1 fix round.
- M9 Weekly auto-advance: abilities, activities, money, WeeklySnapshot, run loop: M9 landed in 1 commit (e890942f84) touching sim.js, activity.js, economy.js, params.js, params.json/md, DECISIONS and sim tests. It added a weekly auto-advance with abilities, activities, money, WeeklySnapshot and the run loop, driven by createSimulation using explicit person and run-setup templates. Verification passed 2 times; review passed with 3 minor findings, 0 blockers and 0 fix rounds.
- M10 Data: P-18 distributions, name ledger, BG22 rule, connect person and household: M10 landed in 1 commit (f0857bc002) touching DECISIONS, params.json/md, person.js, setup.js and setup tests. It added the P-18 distributions (age as a truncated normal: 18-45, mean 25, sd 6, from params), the name ledger and the BG22 rule (unmarried 15% become single parents), and connected person generation to the household. Verification passed 2 times; review passed with 4 minor findings, 0 blockers and 0 fix rounds.

~~~~
