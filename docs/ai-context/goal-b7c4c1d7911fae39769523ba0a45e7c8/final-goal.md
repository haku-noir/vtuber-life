<!-- Written by ai-control. Controller only: secrets are masked and the size is capped. Roles cannot change this directory; do not edit it by hand. -->
# Final goal

## Request

既存プロジェクト vtuber-life の仕上げ（やり直し）。仕様は docs/spec、設計判断は docs/DECISIONS.md。前の目標（M1〜M15）は完了済みで main に統合済み。今回は次の2点を行う。

【A】1サイクルを約60分にする（1倍速）
- 観察期間180暦月を1倍速で約60分、1暦月は平均約20秒（1週は約4.6秒）。速度は0.5・1・2・4倍のまま。
- docs/spec/params.json の「自動送り」の暫定値（現在「平均約1.5秒／月相当」）、docs/spec/params.md、docs/spec/spec-main.md の2.1節242行目付近（現在「一周5〜10分」）を更新。コードはparamsから読む形を維持（web/graph.jsが「平均約X秒／月相当」を解析している）。値の直書きを増やさない。spec-main.md は大きいので、その1行だけの狭い編集にする。
- 1.5秒や5〜10分に依存するテストを直し、180×20秒＝約60分を確認するテストを足す。

【B】仮置き値の反映
- 対象はEV14、EV25、EV86〜EV88の頻度・間隔と、育児費用。現在は未設定。
- 前の中止した作業に実装済みのブランチがある（git ブランチ ai/goal-d48e73bede562a379c3656592476a214、読み取り専用の参考。cherry-pick元にしてよい）。採用する値は、月ごとの発生率 EV14 1%、EV25 1%、EV86 1.5%、EV87 0.5%、EV88 1.5%、再発までの間隔 12/12/12/24/6か月、育児費は子1人あたり月3万円。
- これらは統計ではなく仮置きである旨を params.md と docs/DECISIONS.md に明記する。

【重要：前回の失敗】
- 前回は重大選択が自然に発生するようになった結果、test/ui.test.mjs の「only one boundary is scheduled」（AT02/AT05、期待1・実際0）が失敗し続け、そのファイルが変更範囲に入っていなかったため修正回数の上限で止まった。
- 今回は最初から test/ui.test.mjs と test/setup.test.mjs、test/at.test.mjs、test/sim.test.mjs、test/events.test.mjs を変更範囲に含める（ユーザー承認済み）。時計のテストは抽選から切り離し、完走テストでは重大選択に回答する形にする。
- マイルストーンは分けすぎず、テストの修正をイベント変更と同じマイルストーンに入れて、検証が通る状態でコミットする。

【共通】既存の仕様の振る舞いを壊さない。npm test が全件通ること。pushしない。

## Final goal (immutable, version 1)

Purpose: Set one cycle to about 60 min at 1x and apply the provisional frequencies, intervals and childcare cost for EV14/25/86-88, keeping all existing behavior and passing npm test

Acceptance:
- 180 months x about 20 s ≈ 60 min at 1x; speeds 0.5/1/2/4; value read from params
- EV14 1%, EV25 1%, EV86 1.5%, EV87 0.5%, EV88 1.5% per month; recurrence intervals 12/12/12/24/6 months; heavy events occur naturally
- Childcare cost of 30,000 yen per child per month is added to fixed expenses
- params.md and DECISIONS.md state these are provisional values, not statistics
- npm test passes in full; no push

Constraints:
- Plain ES Modules, no external dependencies; deterministic seeded RNG only
- Values are read from params.json, not hard-coded
- Only a one-line edit to spec-main.md
- The reference branch ai/goal-d48e73bede562a379c3656592476a214 is read-only (cherry-picking from it is allowed)
- Each milestone commits only when its tests pass

No role can change the final goal; a change needs an answered user question.
