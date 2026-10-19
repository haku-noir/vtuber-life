<!-- Written by ai-control. Controller only: secrets are masked and the size is capped. Roles cannot change this directory; do not edit it by hand. -->
# Final goal

## Request

Follow-up on vtuber-life main 21bcaf0e0d081afbd0c9996b919a2765f6faf54f. Use existing specs and AGENTS.md. Plan/review Claude, implementation Codex via ai-ctl only. Keep this a documentation/audit goal; one worker, sequential milestones, no runtime/test changes or dependency installation.

1. Correct the stale M3 verification-pending text in docs/DECISIONS.md. Preserve history: the implementer lacked Node/npm, but the controller subsequently ran npm test successfully. Verified operational evidence from goal-b7c4c1d7911fae39769523ba0a45e7c8: s18 npm TIMEOUT 120028ms; s19 fix commit bf74f02c85c0acf0c5c9c3710a92403a40df6d15; s20 npm PASS exit 0, 129 tests/129 pass/0 fail, 102109ms; s24 npm PASS exit 0, 130 tests/130 pass/0 fail, 101525ms; s25 review SUCCEEDED; s26 integrate SUCCEEDED; integrated main 21bcaf0e0d081afbd0c9996b919a2765f6faf54f. These are recorded results, not new runs. Preserve provisional-value rationale.

2. Audit the integrated quick-start to epilogue flow. Use actual browser interaction ONLY if available within the existing authorized worker tools and isolation. Do not install tools, change permissions, or claim a browser pass from node tests, HTML inspection, simulated DOM or V8 execution. If the current path cannot perform a real browser walkthrough, record NOT PERFORMED with the concrete unavailable capability and a short manual walkthrough/expected observations. Inspect existing tests/UI to identify coverage and gaps (including choice answering), and record findings with file/line references. Run normal npm test via controller verification; no repeated expensive runs without a change or new concern. Do not fix UI/runtime in this goal.

3. Read the existing specs/params/DECISIONS for dreams D14-D24, reroll visibility (including QS1 and immutable real-person data), and remaining provisional demographic/statistical values. Separate already-decided rules from truly unresolved choices. Produce concise Japanese user questions with alternatives, implications, recommended option and source references; never invent user decisions or statistics. Record questions in docs/FOLLOWUP_REVIEW.md and use normal goal questions for genuine owner decisions. Continue independent documentation work while nonblocking questions remain.

Known blocked requirement: docs/spec/spec-main.md is 298811 bytes > current project max_file_bytes 262144. Its line 242 still says 5-10 min / 1.5 sec per month although params use 60 min / 20 sec. Do NOT put this file in the write contract, attempt its edit, split/rewrite it to evade the limit, or retry the known rejection. Report unresolved; formal project policy change is required (minimum to admit the existing file: 298811 bytes; current cap increase of 36667 bytes), subject to separate approval. Do not change policy, executables, auth, API settings or limits.

Write only docs/DECISIONS.md and docs/FOLLOWUP_REVIEW.md. Keep files in Japanese and each plan milestone at most 8 file entries. Final result must distinguish actual browser evidence, automated tests, unresolved owner decisions and the blocked spec line, even if controller state is DONE. No push/remotes/publishing, API keys, extra charges, provider switching, or direct source edits outside ai-ctl. Existing auto_extend and hard ceilings remain unchanged; quota/auth failures stop for the user.

## Final goal (immutable, version 1)

Purpose: Docs/audit only: fix stale verification records, record the quick-start-to-epilogue audit, and organize owner questions on unresolved choices

Acceptance:
- DECISIONS M3 section separates recorded verification results from implementation-time history
- FOLLOWUP_REVIEW.md separates real-browser evidence (or NOT PERFORMED), automated tests, unresolved owner decisions and the blocked spec line
- Changes only docs/DECISIONS.md and docs/FOLLOWUP_REVIEW.md; npm test PASS

Constraints:
- No runtime/test/spec-main.md changes; no dependency installs or policy/limit changes
- Japanese; no push/publishing; do not invent decisions or statistics; at most 8 files per milestone

No role can change the final goal; a change needs an answered user question.
