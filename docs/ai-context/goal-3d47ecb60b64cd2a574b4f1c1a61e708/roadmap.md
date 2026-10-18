<!-- Written by ai-control. Controller only: secrets are masked and the size is capped. Roles cannot change this directory; do not edit it by hand. -->
# Roadmap

```text
Position: milestone 11 of 13 (M19 in progress)
Current milestone: M19
Replans used: 0 of 6
M1 [done] Base: seeded RNG, params loader, calendar boundaries, save data, serve script
M2 [done] Quick start QS1-3, fixed person template, V setup reroll/lock, seed code
M9 [done] Weekly auto-advance: abilities, activities, money, WeeklySnapshot, run loop
M10 [done] Data: P-18 distributions, name ledger, BG22 rule, connect person and household
M17 [done] Rework: Data: P-18 distributions, name ledger, BG22 rule, connect person and ... (rework)
M16 [done] Rework: Data: P-18 distributions, name ledger, BG22 rule, connect person and ... (rework)
M11 [done] Observation UI: weekly 3-series graph, radar, log, speed, pause
M18 [done] Rework: Data: P-18 distributions, name ledger, BG22 rule, connect person and ... (rework)
M12 [done] Events and major choices, heavy events with support notice, marriage/family
M13 [done] Dreams, epilogue, life record, alternate-era comparison
M19 [in progress] Rework: Events and major choices, heavy events with support notice, marriage/... (rework)
    files: src/events.js, src/household.js, test/events.test.mjs; accept: Apply the user's answer to goal-3d47ecb60b64cd2a574b4f1c1a61e708-q17: yes
M14 [pending] Life-position supplementary screen using only allowed sourced stats
    files: src/lifeposition.js, web/lifeposition.js, test/lifeposition.test.mjs; accept: 22.5 life-position ATs pass; A failed stats load only marks the screen as not loaded
M15 [pending] Full AT test coverage and fixed-seed scenarios
    files: test/at.test.mjs, docs/DECISIONS.md; accept: Every applicable AT has a named test; npm test passes
```
