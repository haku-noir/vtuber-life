<!-- Written by ai-control. Controller only: secrets are masked and the size is capped. Roles cannot change this directory; do not edit it by hand. -->
# Final goal

## Request

VTuber-life follow-up: two sequential documentation milestones, one worker. Use current main, AGENTS.md, specs and docs/FOLLOWUP_REVIEW.md. Plan/review Claude; implementation only Codex inside ai-ctl. No runtime/test modifications.

M1: Edit only docs/spec/spec-main.md line 242 (section 2.2), exactly two replacements:
"一周5～10分" -> "一周約60分"
"平均約1.5秒／月相当" -> "平均約20秒／月相当"
Preserve every other byte, line, encoding and newline. Keep 180 calendar months and 0.5/1/2/4 speeds. Params already use about 60 min and 20 sec/month.
User [MASKED] approved the controller's exceptional trusted-setting change of projects[vtuber-life].max_file_bytes 262144->298811, conditional on it being outside auto_extend; source inspection confirmed this. The controller applies it before this new submission after the preceding goal ends. No other setting changes.
Original spec: 298811 bytes, SHA256 6f85d2b1eed081cc9988c8bbfa28ec732724ed002829be309f2d179594a0ed5f. Expected exact result: 298809 bytes, SHA256 3d792844829da52375f4db3f3a6f05ecb08577039eb40de6df1ca911eb103388. Contract must accept this file at cap 298811. If rejected, stop/report, never retry the same rejection or bypass checks.

M2: Create docs/ACCEPTANCE_REVIEW.md in Japanese as a user-review draft, requested in [MASKED] Make acceptance tests readable and distinct from unit tests. Include:
- Requirement/AT ID, spec version/section, prerequisites, user actions, observable expected result, normal/boundary/save-resume scenarios, automatic/visual/unsupported coverage, matching existing test IDs and file locations.
- Actual results with exact tested commit, date/time and evidence; distinguish controller npm results, static code inspection, mock/API tests and actual browser observations. Unknown time/evidence remains unknown. Never mark unperformed checks passed or treat 130 tests as proof of all acceptance requirements.
- A practical core walkthrough and an index of existing AT requirements; mark unmapped/partial coverage explicitly. Focus on external behavior and public interfaces, not fixed private functions.
- Separate implemented acceptance criteria from proposed criteria awaiting user review. Unresolved D14-D24, QS1 reroll visibility and provisional demographic decisions remain 要確認; preserve all existing unanswered questions.
- Change history: why a specification changed, old/new conditions and approval provenance. Cite the existing goal/decision records; do not invent approval. Health-return one-calendar-month approval is q4 of goal-b7c4c1d7911fae39769523ba0a45e7c8; it is a game delay, not medical recovery.
- Explicit missing visual evidence and current missing choice-answer/epilogue UI from FOLLOWUP_REVIEW. Do not claim quick-start-to-epilogue screen success.
- Clearly label this draft 未承認. Give a few short actionable examples and a concise unresolved-items list.

Prior recorded evidence, not new runs: goal-b7c4c1d7911fae39769523ba0a45e7c8 s24 npm PASS exit0, 130/130, 0fail, 101525ms; s25 review and s26 integrate SUCCEEDED, integrated commit 21bcaf0e0d081afbd0c9996b919a2765f6faf54f on 2026-10-19 JST. Also read the subsequent documented follow-up findings. Controller runs normal npm verification for this goal; report it separately.

Write scope only docs/spec/spec-main.md (M1 exact line) and new docs/ACCEPTANCE_REVIEW.md (M2). Do not implement a future protected execution framework or any game/UI fix. No dependencies, API keys, extra charges, provider switching, Cursor, push/remotes/publication, auth/executable changes. Keep existing auto_extend and ceilings; no further policy/limit changes. Report actual tests, draft path, examples and unresolved issues, not blanket completion.
