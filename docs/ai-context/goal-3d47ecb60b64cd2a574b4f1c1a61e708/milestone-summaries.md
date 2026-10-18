<!-- Written by ai-control. Controller only: secrets are masked and the size is capped. Roles cannot change this directory; do not edit it by hand. -->
# Completed milestone summaries

## M1 Base: seeded RNG, params loader, calendar boundaries, save data, serve script

M1 added the base layer in 1 commit (0ea340b): a seeded RNG with named streams, a params.json loader with validation, calendar date math and boundaries, save data with a ledger and version checks, and a local serve script. It also added DECISIONS.md and node:test tests for the rng, params, calendar and save modules. Verification passed (npm test) and review passed: 0 blockers, 4 minor findings (stale npm note in DECISIONS, fork key purity, P-17 text parsing, float summation order in weighted).

## M2 Quick start QS1-3, fixed person template, V setup reroll/lock, seed code

M2 landed in 2 commits (aec08f95fb, 9cd3214c75) touching person.js, seedcode.js, setup.js, setup tests and DECISIONS. It added QS1-3 setup sessions, a fixed person draft (start date only; other fields stay null until data exists), V setup generation with reroll, lock and undo, P-14 compatibility weights, a standalone household generator and a binary seed-code codec. Verification passed 4 times; review passed with 3 findings, 0 blockers and 1 fix round.

## M9 Weekly auto-advance: abilities, activities, money, WeeklySnapshot, run loop

M9 landed in 1 commit (e890942f84) touching sim.js, activity.js, economy.js, params.js, params.json/md, DECISIONS and sim tests. It added a weekly auto-advance with abilities, activities, money, WeeklySnapshot and the run loop, driven by createSimulation using explicit person and run-setup templates. Verification passed 2 times; review passed with 3 minor findings, 0 blockers and 0 fix rounds.

## M10 Data: P-18 distributions, name ledger, BG22 rule, connect person and household

M10 landed in 1 commit (f0857bc002) touching DECISIONS, params.json/md, person.js, setup.js and setup tests. It added the P-18 distributions (age as a truncated normal: 18-45, mean 25, sd 6, from params), the name ledger and the BG22 rule (unmarried 15% become single parents), and connected person generation to the household. Verification passed 2 times; review passed with 4 minor findings, 0 blockers and 0 fix rounds.

## M17 Rework: Data: P-18 distributions, name ledger, BG22 rule, connect person and ...

M17 (rework of M10) landed in 1 commit (b476af05b3) touching DECISIONS, params.json/md, person.js and setup tests. BG22's 15% non-cohabiting case became a single parent living with children, with no forced marriage and a placeholder basis recorded in params. A dedicated TypeError now fires when no initial affiliation is eligible. Regression tests cover AT136/AT138. Verification passed 2 times; review passed with 1 minor finding, 0 blockers and 0 fix rounds.
