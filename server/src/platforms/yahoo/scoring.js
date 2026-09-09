/**
 * A league's own points, from a projection desk's raw components.
 *
 * NO SOURCE PUBLISHES A CUSTOM LEAGUE'S POINTS. Sleeper publishes three presets
 * and ESPN publishes its own default; the league actually read carried 38
 * scoring categories against 35 modifiers, which matches none of them. So the
 * points a user is shown are computed here or they are somebody else's points
 * wearing this league's name — which is why `scoring_type` was never enough to
 * configure anything from, and why both feeds' `pts_ppr` and `appliedTotal` are
 * carried through this project and never read as the answer.
 *
 * `league.js` reads `stat_categories` joined to `stat_modifiers` into a list of
 * points-per-unit. `sources/sleeperProjections.js` and
 * `sources/espnProjections.js` read each desk's raw components into the one
 * vocabulary `sources/components.js` names. This multiplies the two together,
 * and its whole difficulty is the third case in that multiplication: a rule the
 * league scores that no desk projects.
 *
 * THAT CASE IS REPORTED, NEVER ZEROED, and the distinction is the point of the
 * file. A league scoring defensive touchdowns at 6 has no component behind it,
 * and scoring it as zero produces a total that is confidently wrong — it looks
 * like a projection, it is the right shape, it sorts against the others, and
 * nothing about it says a rule was dropped. The same reasoning `inSeason.js`
 * applies to a join that could not run applies here to a rule that cannot be
 * scored: the honest answer is a named absence, not a number.
 *
 * Nothing here reaches the network or holds state.
 */

import { isComponent } from '../../sources/components.js';

/**
 * Yahoo's stat ids against the components a desk projects.
 *
 * A LIST PER ID, BECAUSE YAHOO'S CATEGORIES ARE COARSER THAN THE FEEDS'. Yahoo
 * scores one "2-Point Conversions" where both desks project passing, rushing
 * and receiving conversions separately, and one "Return Touchdowns" where ESPN
 * projects kickoff and punt returns separately. Those are sums, not choices, so
 * a single-component mapping would have scored a two-point conversion at a
 * third of its value and looked plausible doing it. Both fan-ins are exercised
 * by the preset reproductions in the tests, which is why they are checked
 * rather than merely believed.
 *
 * The ids are Yahoo's own, from `/game/nfl/stat_categories`, and they are the
 * same ids a league's `stat_modifiers` are written against — that shared key is
 * the reason points can be computed at all. The vocabulary was read rather than
 * remembered: `4` is Passing Yards and `9` is Rushing Yards, which is not the
 * order a guess would put them in.
 *
 * WHAT IS ABSENT IS ABSENT ON PURPOSE. Yahoo publishes 108 categories, of which
 * this maps eleven. Kickers, team defences, first downs, targets and the
 * distance and points-allowed brackets are all left out, because Y9.0 verified
 * these components against each feed's published points and could not verify
 * those. The temptation was real and was tested: solving for Sleeper's kicker
 * ruleset by least squares fitted all 32 kickers to within 0.008 while
 * returning a 30-39 yard field goal at -0.29 points, and the same method on
 * running backs — whose scoring is known — recovered a lost fumble at -0.68
 * against its true -2. Twelve free parameters fit 32 observations whatever they
 * mean. A rule this table has no entry for reports as unsupported, which is the
 * true statement, rather than as a number that fits.
 */
const COMPONENTS_BY_STAT_ID = Object.freeze({
  4: ['passYd'],
  5: ['passTd'],
  6: ['passInt'],
  9: ['rushYd'],
  10: ['rushTd'],
  11: ['rec'],
  12: ['recYd'],
  13: ['recTd'],
  15: ['kickReturnTd', 'puntReturnTd'],
  16: ['pass2pt', 'rush2pt', 'rec2pt'],
  18: ['fumLost'],
});

for (const [statId, components] of Object.entries(COMPONENTS_BY_STAT_ID)) {
  for (const component of components) {
    if (!isComponent(component)) {
      throw new Error(
        `platforms/yahoo/scoring.js maps Yahoo stat ${statId} to "${component}", `
        + 'which sources/components.js does not name.',
      );
    }
  }
}

/**
 * Whether a rule actually changes a total.
 *
 * Three states arrive from `league.js` and only one of them is worth reporting
 * as a gap. A category the league does not count is not this league's rule at
 * all. A category counted with no modifier against it, or with a modifier of
 * zero, is a rule the league has deliberately priced at nothing — `league.js`
 * keeps those because counting a stat at zero says something different from not
 * counting it, and either way the total does not move. Only a rule with a
 * non-zero modifier can make a projection wrong by going missing, so only those
 * are ever called unsupported. Without this test every ordinary league would
 * report a page of unsupported rules it does not care about, and the state
 * would stop meaning anything — the same failure `resolveSlots` avoids by
 * asking about starting slots only.
 */
const changesTotal = (rule) => !!rule?.enabled
  && typeof rule.points === 'number'
  && Number.isFinite(rule.points)
  && rule.points !== 0;

/** How a rule is named when the point is that it could not be scored. */
const nameFor = (rule) => rule.name || rule.abbr || `stat ${rule.statId}`;

/**
 * The league's rules this source cannot score, whatever player is in front of it.
 *
 * A PROPERTY OF THE SOURCE AND THE LEAGUE, NOT OF A PLAYER, which is what keeps
 * it from being nonsense. A quarterback's record carries no receptions, and that
 * is a desk projecting him to catch nothing rather than a desk that does not
 * project receptions — so asking this question per player would report
 * receptions unsupported for every quarterback in the league. Asking it of the
 * source's vocabulary answers the question actually worth answering: whether
 * this desk has an opinion about this rule at all.
 *
 * `supplied` is the set of components the source can produce, which each source
 * module exports from its own mapping table rather than declaring twice.
 */
export function unsupportedRules(scoring = [], supplied) {
  const has = supplied instanceof Set ? supplied : new Set(supplied || []);
  const out = [];
  for (const rule of scoring) {
    if (!changesTotal(rule)) continue;
    const components = COMPONENTS_BY_STAT_ID[rule.statId];
    if (!components) {
      out.push({
        statId: rule.statId,
        name: nameFor(rule),
        points: rule.points,
        // Said this way round on purpose: the gap is in what the desks publish,
        // not in the user's league, and a message that reads like a complaint
        // about their settings would be both rude and wrong.
        reason: 'no projection source publishes this stat',
      });
      continue;
    }
    const missing = components.filter((component) => !has.has(component));
    if (!missing.length) continue;
    out.push({
      statId: rule.statId,
      name: nameFor(rule),
      points: rule.points,
      reason: missing.length === components.length
        ? 'this source does not project it'
        : `this source projects only part of it (missing ${missing.join(', ')})`,
    });
  }
  return out;
}

/**
 * One player's points under one league's rules, from one desk's components.
 *
 * A missing component inside a rule this source does supply is zero, and that
 * is the one place a zero is right: the desk publishes receptions and projects
 * this quarterback none, so his receptions are nought rather than unknown. The
 * unknown case is the whole rule, and `unsupportedRules` above answers it once
 * for the league instead of once per player.
 *
 * `terms` is returned because a total nobody can take apart is a total nobody
 * can check against Yahoo, and the manual comparison Phase 9 requires is
 * exactly that: sitting the two side by side and finding which line disagrees.
 */
export function scoreComponents(components, scoring = []) {
  if (!components) return null;

  let points = 0;
  const terms = [];
  for (const rule of scoring) {
    if (!changesTotal(rule)) continue;
    const mapped = COMPONENTS_BY_STAT_ID[rule.statId];
    if (!mapped) continue;

    let units = 0;
    let present = false;
    for (const component of mapped) {
      const value = components[component];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      units += value;
      present = true;
    }
    if (!present) continue;

    const scored = units * rule.points;
    points += scored;
    terms.push({
      statId: rule.statId, name: nameFor(rule), units, points: scored,
    });
  }

  return { points, terms };
}
