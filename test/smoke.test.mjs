import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("params.json is valid JSON", () => {
  const raw = readFileSync(new URL("../docs/spec/params.json", import.meta.url), "utf8");
  assert.ok(JSON.parse(raw));
});