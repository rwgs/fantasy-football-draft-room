// Every league platform this service can read, by the name that appears in a
// route path.
//
// A platform answers five questions and validates its own IDs. That is the
// whole contract, and it is the same five things the settings screen and the
// draft assistant have always needed:
//
//   importLeague(id, force)              the roster shape, scoring and rounds
//   leagueUsers(id, force)               who is in it
//   leagueSetup(id, boardQuery, force)   seats, keepers, trades, draft state
//   draftState(draftId)                  has it opened, who sits where
//   draftPicks(draftId, boardQuery)      every pick so far, on this board
//
// Adding one is adding a directory here and a line below. Nothing else in the
// service knows how many there are.
//
// A platform may also expose `ingest`, which Yahoo does and Sleeper does not.
// Sleeper is pulled: the service asks an open feed whenever it needs to know
// something. Yahoo cannot be pulled at all, because its draft room authenticates
// on a browser session cookie, so a userscript in the user's own tab posts to
// the service instead and the five methods answer from what arrived. The route
// still names no platform: it offers the ingestion path to whichever ones have
// one. See `DECISIONS.md`.
//
// This is deliberately not a plugin loader. Two platforms do not need a
// registry that scans a directory, and a service that imports whatever it finds
// on disk is a worse thing to run than one with an explicit list.

import sleeper from './sleeper/index.js';
import yahoo from './yahoo/index.js';

export const PLATFORMS = {
  [sleeper.id]: sleeper,
  [yahoo.id]: yahoo,
};

/** The platform named in a path, or null when nothing answers to that name. */
export function platformFor(name) {
  return PLATFORMS[String(name || '').toLowerCase()] || null;
}

/** The names a route may carry, for the health response and for error text. */
export const PLATFORM_NAMES = Object.keys(PLATFORMS);
