<!-- Written by ai-control. Controller only: secrets are masked and the size is capped. Roles cannot change this directory; do not edit it by hand. -->
# Completed milestone summaries

## M1 Base: seeded RNG, params loader, calendar boundaries, save data, serve script

M1 added the base layer in 1 commit (0ea340b): a seeded RNG with named streams, a params.json loader with validation, calendar date math and boundaries, save data with a ledger and version checks, and a local serve script. It also added DECISIONS.md and node:test tests for the rng, params, calendar and save modules. Verification passed (npm test) and review passed: 0 blockers, 4 minor findings (stale npm note in DECISIONS, fork key purity, P-17 text parsing, float summation order in weighted).

## M2 Quick start QS1-3, fixed person template, V setup reroll/lock, seed code

M2 landed in 2 commits (aec08f95fb, 9cd3214c75) touching person.js, seedcode.js, setup.js, setup tests and DECISIONS. It added QS1-3 setup sessions, a fixed person draft (start date only; other fields stay null until data exists), V setup generation with reroll, lock and undo, P-14 compatibility weights, a standalone household generator and a binary seed-code codec. Verification passed 4 times; review passed with 3 findings, 0 blockers and 1 fix round.
