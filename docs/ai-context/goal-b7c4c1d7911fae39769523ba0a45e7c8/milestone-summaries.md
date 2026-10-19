<!-- Written by ai-control. Controller only: secrets are masked and the size is capped. Roles cannot change this directory; do not edit it by hand. -->
# Completed milestone summaries

## M1 M1 Cycle about 60 min (20 s/month) and decoupling the clock test from the lot…

M1 (commit e01a0820e7) changed docs/spec/params.json, params.md, DECISIONS.md and test/ui.test.mjs: auto-advance is now about 20 s per month (180 months is about 60 min at 1x, speeds 0.5/1/2/4), still read from params. The ui clock test runs on clockParams with every event weight at 0, so it no longer depends on the lottery. Verification passed and the review passed with 3 non-blocking findings: spec-main.md line 242 is not yet updated (path rejected as too large), and DECISIONS.md lines 7-8 are out of date.

## M2 M2 Natural occurrence and intervals for heavy events EV14/25/86-88, with test…

M1 (e01a0820e7): auto-advance changed to about 20 s per month in params.json, params.md and DECISIONS.md, so 180 months is about 60 min at 1x (speeds 0.5/1/2/4). The ui clock test now runs with all event weights at 0. spec-main.md is still pending. M2 (53361be9a5): EV14/25/86-88 now occur naturally with their provisional rates and intervals, via params.json, events.js and params.js, and the at/events/setup/sim tests were updated. Both passed verification (npm test) and review.
