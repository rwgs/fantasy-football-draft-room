/**
 * Yahoo's fantasy JSON, and how to read it.
 *
 * This project reads two different Yahoo scopes — a private league, through the
 * browser and the reader bookmarklet, and the public game scope the service
 * fetches for itself — and both answer in the same dialect. So the reading of
 * the format lives here, apart from either caller:
 * `platforms/yahoo/league.js` for a league, `sources/yahooPlayers.js` for the
 * player pool and the vocabularies.
 *
 * THE SHAPE, WHICH IS THE WHOLE DIFFICULTY
 *
 * Yahoo's JSON is a translation of its XML and carries the scars. Three habits
 * account for nearly all of the code below, and none is a mistake to be worked
 * around — they are simply what the format is:
 *
 *   1. A resource is a two-element array, not an object. `league[0]` holds the
 *      metadata and `league[1]` holds whichever sub-resource was asked for. A
 *      `game` resource is built exactly the same way.
 *   2. A list is an object keyed by stringified index, usually with a `count`
 *      beside it: `{ '0': {...}, '1': {...}, count: 2 }`, not an array. The
 *      `count` is not dependable — `game/nfl/roster_positions` answers 21 slots
 *      and no `count` at all — so `listOf` walks the indices and never reads it.
 *   3. An object's fields arrive as an array of single-key objects, sometimes
 *      with empty ones padding it: `[{a: 1}, {}, {b: 2}]`.
 *
 * A reader that indexes `[0]` and `[1]` by position is doing the ordinary thing
 * here, not the fragile thing. What would be fragile is guessing, so `pick`
 * throws when the shape is not what it expects rather than returning undefined
 * and letting an empty snapshot look like a league with no players in it.
 */

/** A resource arrives as `[metadata, { <name>: … }]`. Take the named half. */
export function subResource(node, name) {
  if (!Array.isArray(node) || node.length < 2) {
    throw new Error(`Expected a two-part ${name} resource, got ${describe(node)}.`);
  }
  const found = node[1]?.[name];
  if (found === undefined) throw new Error(`No ${name} in the second half of the resource.`);
  return found;
}

/** `{ '0': …, '1': …, count }` is Yahoo's array. Make it one. */
export function listOf(node) {
  if (Array.isArray(node)) return node;
  if (!node || typeof node !== 'object') return [];
  const out = [];
  for (let i = 0; ; i += 1) {
    const at = node[String(i)];
    if (at === undefined) break;
    out.push(at);
  }
  return out;
}

/**
 * `[{a: 1}, {}, {b: 2}]` is Yahoo's object. Make it one.
 *
 * The empty entries are real: a player's metadata came back with three of them
 * among twenty-four fields. They carry nothing and are skipped rather than
 * treated as a fault.
 */
export function flatten(parts) {
  // Not every metadata block is split up. A team's arrives as twenty-four
  // single-key objects; a user's arrives as one ordinary object holding the
  // guid. Both are "the metadata", so both are accepted, and the difference is
  // that a split one is a Yahoo list and therefore has a '0'.
  if (parts && typeof parts === 'object' && !Array.isArray(parts) && parts['0'] === undefined) {
    return { ...parts };
  }
  const out = {};
  for (const part of listOf(parts)) {
    if (!part || typeof part !== 'object') continue;
    Object.assign(out, part);
  }
  return out;
}

/** Read a field that has to be there, and say which one was missing when it is not. */
export function pick(obj, key, where) {
  const value = obj?.[key];
  if (value === undefined || value === null) {
    throw new Error(`No ${key} in ${where}.`);
  }
  return value;
}

function describe(node) {
  if (node === null) return 'null';
  if (Array.isArray(node)) return `an array of ${node.length}`;
  return typeof node;
}

/** Yahoo writes team abbreviations as `Phi`; everything else here joins on `PHI`. */
export function teamAbbr(value) {
  return typeof value === 'string' ? value.toUpperCase() : null;
}

export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
