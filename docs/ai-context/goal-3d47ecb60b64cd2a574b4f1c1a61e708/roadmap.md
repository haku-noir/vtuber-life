<!-- Written by ai-control. Controller only: secrets are masked and the size is capped. Roles cannot change this directory; do not edit it by hand. -->
# Roadmap

```text
Position: 1 of 8 milestones done; the next one is being planned
Current milestone: none
Replans used: 0 of 6
M1 [done] Base: seeded RNG, params loader, calendar boundaries, save data, serve script
M2 [pending] Quick start QS1-3, fixed person template, V setup reroll/lock, seed code
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
```
