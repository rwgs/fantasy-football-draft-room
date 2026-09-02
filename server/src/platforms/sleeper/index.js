// Sleeper, as one platform among however many end up here.
//
// The two modules beside this file are unchanged from when they were the only
// way to read a league. This wraps them in the shape every platform answers to,
// so the routes can stop naming Sleeper and start naming whichever platform the
// caller asked for.

import { importLeague } from './league.js';
import { draftPicks, draftState, leagueSetup, leagueUsers } from './draft.js';

/**
 * A Sleeper league or draft ID is a long run of digits and nothing else.
 *
 * This lives with the platform rather than in the routes because it is a fact
 * about Sleeper, not about this service. Yahoo writes a league key as
 * `461.l.123456`, which the routes would reject out of hand if they went on
 * holding one rule for everybody.
 */
const IS_ID = /^\d{6,25}$/;

export default {
  id: 'sleeper',
  label: 'Sleeper',
  isValidId: (id) => IS_ID.test(id),
  idHint: 'A Sleeper ID is a long run of digits. Check the one you sent.',
  importLeague,
  leagueUsers,
  leagueSetup,
  draftState,
  draftPicks,
};
