<!-- Written by ai-control. Controller only: secrets are masked and the size is capped. Roles cannot change this directory; do not edit it by hand. -->
# Roadmap

```text
Position: 7 of 12 milestones done; the next one is being planned
Current milestone: none
Replans used: 0 of 6
M1 [done] Base: seeded RNG, params loader, calendar boundaries, save data, serve script
M2 [done] Quick start QS1-3, fixed person template, V setup reroll/lock, seed code
M9 [done] Weekly auto-advance: abilities, activities, money, WeeklySnapshot, run loop
M10 [done] Data: P-18 distributions, name ledger, BG22 rule, connect person and household
M17 [done] Rework: Data: P-18 distributions, name ledger, BG22 rule, connect person and ... (rework)
M16 [done] Rework: Data: P-18 distributions, name ledger, BG22 rule, connect person and ... (rework)
M11 [done] Observation UI: weekly 3-series graph, radar, log, speed, pause
M18 [pending] Rework: Data: P-18 distributions, name ledger, BG22 rule, connect person and ... (rework)
    files: docs/spec/params.json, docs/spec/params.md, src/person.js, src/setup.js, test/setup.test.mjs; accept: Apply the user's answer to goal-3d47ecb60b64cd2a574b4f1c1a61e708-q15: yes
M12 [pending] Events and major choices, heavy events with support notice, marriage/family
    files: src/events.js, src/household.js, test/events.test.mjs; accept: AT04/AT06 when resuming a pending choice; EV93-96 tests; Heavy events are never removed or reduced
M13 [pending] Dreams, epilogue, life record, alternate-era comparison
    files: src/dreams.js, src/epilogue.js, src/compare.js, test/dreams.test.mjs; accept: Dream ATs in 22.3 and AT12/AT13/AT16 pass
M14 [pending] Life-position supplementary screen using only allowed sourced stats
    files: src/lifeposition.js, web/lifeposition.js, test/lifeposition.test.mjs; accept: 22.5 life-position ATs pass; A failed stats load only marks the screen as not loaded
M15 [pending] Full AT test coverage and fixed-seed scenarios
    files: test/at.test.mjs, docs/DECISIONS.md; accept: Every applicable AT has a named test; npm test passes
```
