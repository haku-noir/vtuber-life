export const RNG_VERSION = "mulberry32-fnv1a-utf16-v1";
export const RNG_STREAMS = Object.freeze([
  "person", "world", "activity", "household", "epilogue", "expression", "display", "setupV",
]);

function keyPart(value) {
  if (typeof value === "string" && value.length <= 1024) return value;
  if (Number.isSafeInteger(value)) return value;
  throw new TypeError("RNG keys must be strings or safe integers");
}

// FNV-1a over UTF-16 code units; JSON framing prevents ambiguous key concatenation.
export function hashKey(seed, stream, ...keys) {
  if (typeof stream !== "string" || !stream.length) throw new TypeError("Missing RNG stream");
  const text = JSON.stringify([RNG_VERSION, keyPart(seed), keyPart(stream), ...keys.map(keyPart)]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

export function createRng(seed, stream, ...keys) {
  return build(seed, stream, keys, hashKey(seed, stream, ...keys));
}

export function restoreRng(snapshot) {
  if (!snapshot || snapshot.version !== RNG_VERSION || !Array.isArray(snapshot.keys) ||
      snapshot.keys.length > 64 || !Number.isInteger(snapshot.state) ||
      snapshot.state < 0 || snapshot.state > 0xffffffff) throw new TypeError("Invalid RNG snapshot");
  hashKey(snapshot.seed, snapshot.stream, ...snapshot.keys);
  return build(snapshot.seed, snapshot.stream, [...snapshot.keys], snapshot.state);
}

function build(seed, stream, keys, initialState) {
  if (keys.length > 64) throw new RangeError("Too many RNG keys");
  let state = initialState;
  function uint32() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return (t ^ (t >>> 14)) >>> 0;
  }
  return Object.freeze({
    uint32,
    next: () => uint32() / 0x100000000,
    int(min, max) {
      const span = max - min + 1;
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || span < 1 || span > 0x100000000)
        throw new RangeError("Invalid integer range");
      const limit = Math.floor(0x100000000 / span) * span;
      let value;
      do { value = uint32(); } while (value >= limit);
      return min + value % span;
    },
    weighted(items, weights) {
      if (!Array.isArray(items) || !items.length || !Array.isArray(weights) || items.length !== weights.length)
        throw new TypeError("Items and explicit weights are required");
      if (weights.some(w => typeof w !== "number" || !Number.isFinite(w) || w < 0))
        throw new RangeError("Weights must be finite and nonnegative; null is unresolved");
      const total = weights.reduce((sum, w) => sum + w, 0);
      if (!Number.isFinite(total) || total <= 0) throw new RangeError("Invalid weight total");
      let target = uint32() / 0x100000000 * total;
      let last;
      for (let i = 0; i < items.length; i++) {
        if (weights[i] === 0) continue;
        last = items[i];
        if (target < weights[i]) return items[i];
        target -= weights[i];
      }
      return last;
    },
    fork: (...extraKeys) => createRng(seed, stream, ...keys, ...extraKeys),
    snapshot: () => ({ version: RNG_VERSION, seed, stream, keys: [...keys], state }),
  });
}
