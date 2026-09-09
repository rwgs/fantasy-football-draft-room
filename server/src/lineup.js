/**
 * The best legal lineup, and the swaps that reach it.
 *
 * Pure. Nothing here reaches the network, holds state or knows which platform
 * the league came from: a seat says which positions it accepts and a player
 * says which positions he fills and what he is projected to score, and that is
 * the whole of the input. `platforms/yahoo/inSeason.js` resolves a composite
 * slot like `W/R/T` into the positions it takes, and
 * `platforms/yahoo/scoring.js` turns a desk's components into this league's
 * points. This puts players in seats.
 *
 * WHY THE OBVIOUS ALGORITHM IS WRONG, since it is the reason this file exists
 * rather than a sort. Filling the lineup best-player-first into the first slot
 * that fits loses points, and it loses them silently. Take a league starting
 * one flex and one wide receiver, holding a 20-point receiver, an 18-point back
 * and a 10-point receiver. Best-first puts the 20 in the flex, because the flex
 * fits him and comes first, then the 10 in the receiver slot, and the 18-point
 * back has nowhere left to go: 30 points. Putting the receiver in the receiver
 * slot and the back in the flex scores 38. Nothing about the 30 looks wrong. It
 * is a full legal lineup of plausible players, and the eight points it dropped
 * are invisible unless something computes the alternative.
 *
 * WHAT IS ACTUALLY TRUE HERE, AND IT MAKES THE PROBLEM EASY. A player is worth
 * the same points in every seat he can fill -- a receiver scores what he scores
 * whether he is in the receiver slot or the flex. So this is not the general
 * assignment problem, where a pairing has its own value. It is the question of
 * which *set* of players can be seated at all, and the sets that can be form a
 * transversal matroid. Greedy is optimal over a matroid: take players in
 * descending points, and keep each one only if the set still fits the seats.
 *
 * That last test is the part best-first gets wrong. "Still fits" is not "there
 * is a free seat for him" -- it is a question about the whole set, answered by
 * trying to seat him and letting the players already seated shuffle to make
 * room. That shuffle is the augmenting path in `seat` below, and it is exactly
 * what moves the 20-point receiver out of the flex and into the receiver slot.
 *
 * The optimality is a theorem, but a theorem about the code as written is only
 * worth what the code is. `lineup.test.js` enumerates every legal lineup for
 * small rosters and checks this against the true maximum, which proves an
 * optimum rather than asserting one, and it runs the best-first greedy on the
 * trap above and checks that it loses.
 */

import { SCOREABLE_POSITIONS } from './sources/components.js';

/**
 * When two desks disagreeing about a player stops being noise.
 *
 * Y9.0 measured the spread between Sleeper and ESPN over a real week and found
 * the two desks rarely more than about three points apart on the same player,
 * so a gap at or above that is a genuine difference of opinion and a gap below
 * it is not. It is a threshold for how loudly a disagreement is reported and
 * never a tie-break: this file never picks a side, because the same measurement
 * ruled a mean out. Averaging showed Tua Tagovailoa at 13.0 where the desks
 * said 15.29 and 10.75 -- a start and a sit, reported as neither.
 * See `docs/in-season-data-sources.md`.
 */
export const MATERIAL_SPREAD = 3;

/**
 * The league's starting slots, one entry per seat, and the ones no advice can
 * cover.
 *
 * TWO DIFFERENT SILENCES, NAMED SEPARATELY, because a caller that cannot tell
 * them apart has to describe both wrongly. `unresolved` is a slot this app
 * could not read -- `resolveSlots` gave it no eligible set, either because the
 * vocabulary did not explain it or because the fetch that would have explained
 * it never answered. `unscoreable` is a slot that was read perfectly and holds
 * a position no projection desk covers, which today means kickers and team
 * defences: Y9.1 established their components against both feeds' published
 * points and could not reproduce them, so `SCOREABLE_POSITIONS` is the rule and
 * this is that rule applied to a seat. The first is a defect to chase and the
 * second is a permanent limit to state on the screen.
 *
 * Both are left out of the seating rather than filled badly. A K slot whose
 * only candidates are unprojected would otherwise sit there attracting
 * whichever player happened to have a number beside him.
 */
export function startingSeats(slots = []) {
  const seats = [];
  const unresolved = [];
  const unscoreable = [];

  for (const slot of slots) {
    if (!slot?.starting) continue;

    if (!slot.accepts) {
      unresolved.push(slot.position);
      continue;
    }
    if (!slot.accepts.some((position) => SCOREABLE_POSITIONS.has(position))) {
      unscoreable.push(slot.position);
      continue;
    }
    const count = Number.isFinite(slot.count) ? slot.count : 0;
    for (let index = 0; index < count; index += 1) {
      seats.push({ slot: slot.position, index, accepts: slot.accepts });
    }
  }

  return { seats, unresolved, unscoreable };
}

/** Which positions a player may fill, however thinly his record is filled in. */
const positionsOf = (player) => (player.positions?.length
  ? player.positions
  : [player.displayPosition].filter(Boolean));

/** How a player is named when the point is that he was or was not seated. */
const nameFor = (player) => player.name || player.playerKey || 'a player with no name';

/**
 * Why a player cannot be put into a starting slot, or null if he can.
 *
 * EVERY ONE OF THESE WOULD OTHERWISE BE A ZERO, and a zero is a projection. A
 * player on bye scored as nought sorts to the bottom of the bench and looks
 * like a bad start, which is nearly the right behaviour and is the wrong
 * statement: he is not projected badly, he is not playing. The difference shows
 * the moment a desk leaves a stale non-zero projection against a bye week, when
 * the zero this file refused to invent would have started him.
 *
 * Order is precedence, and it runs from the hardest constraint to the softest,
 * so the reason a caller shows is the one that would still be true if the
 * others were fixed.
 */
function cannotStart(player, { week, locked, points }) {
  if (player.selectedPosition === 'IR') return 'on injured reserve';
  if (locked.has(player.playerKey)) return 'locked';
  if (week != null && player.byeWeek != null && player.byeWeek === week) return 'on bye';
  if (!points.has(player.playerKey)) return 'not projected';
  return null;
}

/**
 * Seat one more player, shuffling the players already seated if that is what it
 * takes.
 *
 * Kuhn's augmenting path, and the shuffle is the whole point: a player is
 * seatable when some free seat can be reached by displacing a chain of seated
 * players into other seats they also fill. Asking only whether a seat is free
 * is the best-first mistake at the top of this file.
 *
 * BREADTH FIRST, AND THE BREADTH IS THE POINT. Every augmenting path seats the
 * same player and scores the same total, because a player is worth the same in
 * every seat he fills -- so which one is taken never shows up in a number, and
 * shows up in every word of the advice. The length of the path is the count of
 * players displaced to make room, and each of those is a line telling the user
 * to go and move somebody. The shortest path is the fewest such lines.
 *
 * Depth first took whatever it stumbled into. Asked to seat a back where one
 * seat's occupant could shuffle along and another's could not, it walked into
 * the first and displaced two men where one would have done, then reported both
 * -- see `settle`, which is where that was caught, and which is the other half
 * of this. `order` still puts a player's own seat first, so a tie between two
 * paths of equal length goes to the one that leaves him where he is.
 *
 * None of this can move the total, and a maximum matching is still a maximum
 * matching: Kuhn's needs an augmenting path found whenever one exists, and
 * breadth first finds one exactly when depth first would.
 */
function seat(entry, { bySeat, order }) {
  /*
   * `wants` is the search tree, seat by seat: who would move into this seat if
   * the path being built turns out to reach an empty one. `at` is where each
   * displaced player is sitting now, which is how the path is walked back --
   * the source has no entry there, and that is what ends the walk.
   */
  const wants = new Map();
  const at = new Map();
  const queue = [entry];
  let open = null;

  while (queue.length && open === null) {
    const who = queue.shift();
    for (const index of order(who)) {
      if (wants.has(index)) continue;
      wants.set(index, who);
      const held = bySeat.get(index);
      if (held === undefined) {
        open = index;
        break;
      }
      at.set(held, index);
      queue.push(held);
    }
  }

  if (open === null) return false;

  // Back down the path from the empty seat: each player takes the seat ahead of
  // him and gives up the one behind, and the last seat given up is nobody's
  // because the player at the far end came from the bench.
  for (let index = open; index !== undefined;) {
    const who = wants.get(index);
    bySeat.set(index, who);
    index = at.get(who);
  }
  return true;
}

/**
 * The same players, seated so that as few of them move as possible.
 *
 * WHO STARTS AND WHERE THEY SIT ARE TWO QUESTIONS, AND ONLY THE FIRST IS THE
 * GREEDY'S. A player is worth the same points in every seat he fills -- the
 * note at the top of this file -- so every seating of the chosen set scores the
 * same, and the one the greedy ends up holding is merely whichever its search
 * reached first. That is fine for a total and useless for advice, because the
 * advice is the difference between that seating and the user's.
 *
 * Preferring a player's own seat inside the greedy cannot fix it, because the
 * greedy has to take players in descending points and the seat a player wants
 * to keep may be claimed before its owner is reached. Reported from a real
 * board: a back off the bench outprojected the two starting at `RB`, took one
 * of their seats because he was first through, and pushed its owner into the
 * flex -- which was standing empty for want of the tight end who had just been
 * benched out of it, and who the incoming back could have replaced directly.
 * The total was right to the penny and every word of the advice was wrong: the
 * swap named `RB` instead of the flex, and a relocation nobody needed was
 * printed underneath it.
 *
 * So the set is settled first and seated second. Every player who has a seat
 * now and still fills it claims it, which cannot conflict -- a seat holds one
 * player -- and the rest are matched around them. The set is known seatable, so
 * `seat` finds room for each of them from any starting arrangement; that is the
 * same theorem as before, used the same way.
 */
function settle(chosen, { bySeat, currentSeat, order }) {
  const rest = [];
  for (const entry of chosen) {
    const held = currentSeat.get(entry.player.playerKey);
    if (held !== undefined && entry.fills.includes(held)) bySeat.set(held, entry);
    else rest.push(entry);
  }
  for (const entry of rest) seat(entry, { bySeat, order });
}

/**
 * Whoever is in each seat right now.
 *
 * A roster says which slot a player is started in and not which of that slot's
 * seats, because Yahoo does not distinguish them and nothing needs it to: two
 * backs in `RB` are in `RB` twice. So the seats of a slot are handed out in
 * roster order, which is arbitrary and safe -- the pairing that matters is the
 * slot, and a swap is reported against the slot.
 */
function seatedNow(seats, players) {
  const now = new Map();
  const used = new Set();
  for (const s of seats) {
    const owner = players.find((p) => p.selectedPosition === s.slot && !used.has(p.playerKey));
    if (!owner) continue;
    used.add(owner.playerKey);
    now.set(s, owner);
  }
  return now;
}

/**
 * The best legal lineup one desk's projection supports.
 *
 * `points` is a Map from player key to this league's points for this week, and
 * a key it does not hold is a player nobody projected rather than a player
 * projected nothing. `locked` is a Set of player keys, or null where nothing is
 * known about locks at all -- see `lineupAdvice`, which carries that
 * distinction outward rather than resolving it here.
 */
export function bestLineup({
  slots = [], players = [], points = new Map(), locked = null, week = null,
} = {}) {
  const { seats, unresolved, unscoreable } = startingSeats(slots);
  const startingSlots = new Set(seats.map((s) => s.slot));
  const held = new Set(locked || []);
  const now = seatedNow(seats, players);

  /*
   * A LOCKED PLAYER ALREADY IN A STARTING SLOT IS NOT A CANDIDATE, HE IS PART
   * OF THE ANSWER. His seat leaves the problem with him in it, so nothing can
   * be advised into it and he cannot be advised out. Advising a move that
   * cannot be made is worse than saying nothing: it is a lineup the user cannot
   * set, offered as the one they should.
   */
  const fixed = new Map();
  const free = [];
  for (const s of seats) {
    const owner = now.get(s);
    if (owner && held.has(owner.playerKey)) fixed.set(s, owner);
    else free.push(s);
  }

  const fillable = (player) => {
    const eligible = new Set(positionsOf(player));
    const out = [];
    free.forEach((s, index) => {
      if (s.accepts.some((position) => eligible.has(position))) out.push(index);
    });
    return out;
  };

  const seated = new Set([...fixed.values()].map((player) => player.playerKey));

  const sitting = [];
  const candidates = [];
  for (const player of players) {
    if (seated.has(player.playerKey)) continue;
    const reason = cannotStart(player, { week, locked: held, points });
    const starts = startingSlots.has(player.selectedPosition);
    if (reason) {
      // Named only where it matters. A benched player nobody projected is not a
      // finding; a started one is, because he is in the lineup being advised on.
      if (starts) sitting.push({ player: nameFor(player), slot: player.selectedPosition, reason });
      continue;
    }
    const fills = fillable(player);
    if (!fills.length) continue;
    candidates.push({ player, fills, points: points.get(player.playerKey), starts });
  }

  /*
   * Descending points, and a tie broken towards whoever is already starting.
   * Two players projected alike are the same lineup either way, so the tie is
   * settled by the only thing that distinguishes the outcomes: one of them
   * needs the user to do something and the other does not.
   */
  candidates.sort((a, b) => (b.points - a.points) || (Number(b.starts) - Number(a.starts)));

  /*
   * THE SEAT A PLAYER IS IN NOW, NOT A SEAT OF THE SLOT HE IS IN NOW, and the
   * difference is a whole class of advice that says nothing. A roster names the
   * slot, so two backs in `RB` both read as `RB`, and preferring "any RB seat"
   * let each of them be seated in the other's: the total was right to the
   * penny and the advice was two swaps that change nothing. `seatedNow` handed
   * out the seats of a slot in roster order, so it already knows which is
   * which, and this is that answer rather than a second guess at it.
   */
  const currentSeat = new Map();
  free.forEach((s, index) => {
    const owner = now.get(s);
    if (owner) currentSeat.set(owner.playerKey, index);
  });

  const bySeat = new Map();
  const order = (entry) => {
    const held = currentSeat.get(entry.player.playerKey);
    if (held === undefined || !entry.fills.includes(held)) return entry.fills;
    return [held, ...entry.fills.filter((index) => index !== held)];
  };

  for (const entry of candidates) {
    /*
     * Greedy over a transversal matroid, which is optimal -- see the file note.
     * A player worth less than nothing is not worth a seat: an empty seat
     * scores zero, so this is the point at which greedy has taken everything
     * there is to take. It is a break rather than a filter because the list is
     * sorted, so nothing below it can be worth taking either.
     */
    if (!(entry.points > 0)) break;
    seat(entry, { bySeat, order });
  }

  // Who starts is now settled and where they sit is not -- see `settle`, which
  // seats these same players again for the fewest moves rather than the first
  // arrangement the greedy happened to reach.
  const chosen = [...bySeat.values()];
  bySeat.clear();
  settle(chosen, { bySeat, currentSeat, order });

  const lineup = [];
  for (const [index, entry] of bySeat) lineup.push({ seat: free[index], player: entry.player });
  for (const [s, player] of fixed) lineup.push({ seat: s, player });

  const total = lineup.reduce((sum, { player }) => sum + (points.get(player.playerKey) ?? 0), 0);

  return {
    // Sorted so two lineups from two desks can be compared seat by seat, and so
    // the order on a screen is the league's own rather than the matching's.
    lineup: lineup.sort((a, b) => seats.indexOf(a.seat) - seats.indexOf(b.seat)),
    points: total,
    seats,
    // A seat nothing could fill. Real at a thin position in a deep league, and
    // it has to be reported: an eight-slot lineup shown with seven players and
    // no comment reads as a bug in the app.
    empty: free.filter((s, index) => !bySeat.has(index)).map((s) => s.slot),
    unresolved,
    unscoreable,
    // The players in the lineup right now that this desk cannot score, which is
    // what makes a projected difference uncertain rather than wrong.
    unscoredStarters: sitting.filter((s) => s.reason === 'not projected'),
    benched: sitting,
    locked: locked === null ? null : [...held],
  };
}

/**
 * What the user would have to do: the swaps, and the relocations.
 *
 * Reported as pairs rather than as two lists of players, because the pairing is
 * the useful half. "Bench him, start her" is actionable; "these three are out
 * and those three are in" leaves the reader to work out which goes where, which
 * is the same matching problem over again.
 *
 * TWO KINDS OF THING AND NOT ONE, which is the correction that made this right.
 * Whether a player starts is one question; which seat he sits in is another.
 * `moves` answers the first -- somebody out of the lineup, somebody into it --
 * and `moved` answers the second, for a player the answer keeps and reseats.
 * Folding them together put the same player on both sides of `moves`, first per
 * seat and then per slot, and both times it read as a bug on the one part of
 * the screen that tells the user what to do.
 */
export function lineupMoves({ lineup, seats }, players = []) {
  const now = seatedNow(seats, players);
  const named = (player) => ({ playerKey: player.playerKey, name: nameFor(player) });

  /*
   * WHO STARTS IS ONE QUESTION AND WHERE THEY SIT IS ANOTHER, and conflating
   * them is what put the same player on both sides of this table twice.
   *
   * A player starting before and starting after is not being swapped, whatever
   * seat or slot he ends up in -- he is already in the lineup and stays in it.
   * Comparing seats individually said otherwise, and grouping by slot said
   * otherwise too as soon as the slot changed: a back at `RB` that the best
   * lineup wants in the flex came out as "bench Travis Etienne Jr." against
   * "start Travis Etienne Jr." in two rows. Reported from a real board, and the
   * fixture had been doing it in a screenshot nobody read closely.
   *
   * So the swaps are computed over the whole lineup: out is whoever starts now
   * and does not start in the answer, in is whoever starts in the answer and
   * does not start now, and a slot change for somebody who was already starting
   * is reported separately as the relocation it is.
   */
  const slotNow = new Map();
  for (const [seat, player] of now) slotNow.set(player.playerKey, seat.slot);
  const slotNext = new Map();
  for (const entry of lineup) slotNext.set(entry.player.playerKey, entry.seat.slot);

  /*
   * A player the answer keeps but seats elsewhere. Named because the user has
   * to do it -- Yahoo will not move him -- and separated from the swaps because
   * nobody is coming out of the lineup for him.
   */
  const moved = [];
  for (const entry of lineup) {
    const was = slotNow.get(entry.player.playerKey);
    if (was !== undefined && was !== entry.seat.slot) {
      moved.push({ ...named(entry.player), from: was, to: entry.seat.slot });
    }
  }

  const out = [...now.values()].filter((player) => !slotNext.has(player.playerKey));
  const going = lineup
    .map((entry) => entry.player)
    .filter((player) => !slotNow.has(player.playerKey));

  /*
   * `slot` is where the incoming player goes, which is the seat the user opens
   * and sets. It is not necessarily where the outgoing player sat: once a
   * relocation is in play the arrangement shifts, and the only thing to do with
   * whoever leaves is bench him.
   *
   * A player left over with nobody to replace him is not a move, because there
   * is nothing to start in his place. It happens only to a player who was never
   * a candidate -- on bye, on IR, or nobody projected him -- and `benched`
   * already names him with the reason, which is the actionable half. A move
   * reading "bench him, start nobody" would say less.
   */
  const moves = going.map((player, at) => ({
    slot: slotNext.get(player.playerKey),
    out: out[at] ? named(out[at]) : null,
    in: named(player),
  }));

  return { moves, moved, current: [...now.values()] };
}

/**
 * The advice, from every desk that answered, with the disagreements left
 * standing.
 *
 * ONE LINEUP PER DESK AND NEVER A BLENDED ONE. The two desks are two opinions,
 * and the measurement that established how far apart they run also established
 * that averaging them invents a third opinion neither holds -- see
 * `MATERIAL_SPREAD`. So a player one desk starts and the other does not is
 * reported as disputed, carrying what each desk thinks of both players, and
 * this function does not decide it. That is not indecision: the honest output
 * of two sources that disagree is the disagreement.
 *
 * A PLAYER AND NOT A SEAT, which the block below says at length because getting
 * it wrong twice cost two reports from a real board. Where each desk seats its
 * own choice is not a difference of opinion.
 *
 * `locked` is a Set of player keys, or null where nothing is known about which
 * players have locked. Null is carried through to `locksKnown: false` rather
 * than being read as "nothing is locked", because those differ in the one way
 * that matters -- the second is a claim, and a lineup advised as though nothing
 * had locked when no kickoff time was ever fetched is advice to make moves the
 * user may no longer be able to make.
 */
export function lineupAdvice({
  slots = [], players = [], sources = {}, locked = null, week = null,
} = {}) {
  const desks = {};
  for (const [name, points] of Object.entries(sources)) {
    // A desk that did not answer is absent, not empty. An empty Map is a desk
    // that answered and projected nobody, which reports as a lineup it could
    // not fill rather than as a desk nobody asked.
    if (points === null || points === undefined) continue;
    const best = bestLineup({ slots, players, points, locked, week });
    const { moves, moved, current } = lineupMoves(best, players);
    const currentPoints = current.reduce((sum, p) => sum + (points.get(p.playerKey) ?? 0), 0);
    desks[name] = {
      ...best,
      moves,
      moved,
      currentPoints,
      /*
       * Null, not zero, where a player in the lineup now has no projection. The
       * difference between two totals is only a difference if both are totals,
       * and one built over a starter this desk never scored is missing a term
       * of unknown size. A number here would be a confident understatement of
       * the gain, or a confident overstatement, with no way to tell which.
       */
      gain: best.unscoredStarters.length ? null : best.points - currentPoints,
    };
  }

  const names = Object.keys(desks);
  const disputed = [];
  const agreed = [];
  if (names.length > 1) {
    const valueOf = (name, player) => sources[name].get(player.playerKey) ?? 0;

    /*
     * THE SET OF STARTERS, NOT THE SEATS AND NOT THE SLOTS.
     *
     * This has been wrong twice, each time by comparing the desks somewhere
     * narrower than the thing they actually disagree about, so it is worth
     * writing down what the unit is and why it is that.
     *
     * A player is worth the same points in every seat he can fill -- the note at
     * the top of this file, and the reason `bestLineup` is a matroid greedy
     * rather than an assignment. So a *set* of startable players has one score
     * however it is seated, and two desks recommending the same set are giving
     * the same advice whatever slots their two matchings happened to use. The
     * disagreement is about which players start at all.
     *
     * Comparing seats reported a player both desks started, seated in `RB#0` by
     * one and `RB#1` by the other, as two disagreements and no agreement.
     * Grouping by slot fixed that and left the same defect across slots: a back
     * one desk starts at `RB` and the other in `W/R/T` came out as an argument
     * about two seats, when both desks want him on the field. Both were seen on
     * a real board, a day apart, and the second was reported as a partial fix.
     */
    const started = names.map((name) => desks[name].lineup);

    const sameIn = (lineup, entry) => lineup
      .find((other) => other.player.playerKey === entry.player.playerKey);

    // In the first desk's seat order, so the screen reads down the lineup.
    const shared = started[0].filter((entry) => started.every((lineup) => sameIn(lineup, entry)));
    for (const entry of shared) {
      const slots = new Set(started.map((lineup) => sameIn(lineup, entry).seat.slot));
      agreed.push({
        player: nameFor(entry.player),
        /*
         * Null where the desks seat him differently, which is agreement and
         * not a dispute: the same set scores the same however it is seated.
         * One desk's slot printed as though both held it would be a claim
         * neither made.
         */
        slot: slots.size === 1 ? entry.seat.slot : null,
      });
    }

    /*
     * Whoever is left is the decision, each desk's remainder in its own order
     * of points. Any pairing is legal, since what is being compared is two sets
     * rather than two seatings, but pairing them as the matchings happened to
     * seat them could set a desk's 20-point pick against the other's 5-point
     * one and report a spread that is an artifact of the matching.
     */
    const settled = new Set(shared.map((entry) => entry.player.playerKey));
    const left = names.map((name, at) => started[at]
      .filter((entry) => !settled.has(entry.player.playerKey))
      .sort((a, b) => valueOf(name, b.player) - valueOf(name, a.player)));
    const rows = Math.max(...left.map((lineup) => lineup.length));

    for (let row = 0; row < rows; row += 1) {
      const picks = names.map((name, at) => ({ desk: name, entry: left[at][row] ?? null }));
      /*
       * How far apart the desks are about this decision, taken as the widest
       * view any one of them holds of the players it is choosing between. A desk
       * that separates them by a point is reporting a coin flip; one that
       * separates them by six is reporting a real difference that the other desk
       * contradicts, which is more worth a reader's attention rather than less.
       */
      let spread = 0;
      for (const name of names) {
        const values = picks
          .map(({ entry }) => (entry ? sources[name].get(entry.player.playerKey) : null))
          .filter((value) => typeof value === 'number');
        if (values.length > 1) {
          spread = Math.max(spread, Math.max(...values) - Math.min(...values));
        }
      }
      disputed.push({
        picks: picks.map(({ desk, entry }) => ({
          desk,
          player: entry ? nameFor(entry.player) : null,
          // Per pick and not per row, because the two desks seat their picks in
          // different slots -- which is the whole reason a row has none of its
          // own. It says where the change would be made as well as what it is.
          slot: entry ? entry.seat.slot : null,
          points: Object.fromEntries(names.map((name) => [
            name, entry ? sources[name].get(entry.player.playerKey) ?? null : null,
          ])),
        })),
        spread,
        // Whether the disagreement is worth acting on or is two desks splitting
        // hairs. Reported, not applied: nothing here picks a winner.
        material: spread >= MATERIAL_SPREAD,
      });
    }
  }

  return {
    desks,
    agreed,
    disputed,
    // Which desks answered at all, so a caller can tell one opinion from two.
    // A single desk's advice is usable and is not the same claim as two agreeing.
    answered: names,
    locksKnown: locked !== null,
  };
}
