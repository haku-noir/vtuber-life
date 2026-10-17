<!-- Written by ai-control. Controller only: secrets are masked and the size is capped. Roles cannot change this directory; do not edit it by hand. -->
# Completed milestone summaries

## M1 Base: seeded RNG, params loader, calendar boundaries, save data, serve script

M1 added the base layer in 1 commit (0ea340b): a seeded RNG with named streams, a params.json loader with validation, calendar date math and boundaries, save data with a ledger and version checks, and a local serve script. It also added DECISIONS.md and node:test tests for the rng, params, calendar and save modules. Verification passed (npm test) and review passed: 0 blockers, 4 minor findings (stale npm note in DECISIONS, fork key purity, P-17 text parsing, float summation order in weighted).
