// The raw components a projection is made of, in one vocabulary.
//
// No source publishes a custom league's points, and no league's scoring can be
// read off a source's preset, so points are computed: components from a
// projection desk multiplied by modifiers from the league. That leaves three
// readers — Sleeper's weekly feed, ESPN's, and the Yahoo scoring join — needing
// to agree on what a component is called, and nothing in the shape of the data
// would tell them if they stopped agreeing. A Sleeper record naming `passYds`
// where the scoring table says `passYd` would score every quarterback at zero,
// look exactly like a league that does not score passing, and say nothing.
//
// Hence one list, and `checkComponents` so each mapping is checked against it
// when its module loads rather than when somebody reads a wrong number.
//
// WHAT IS IN HERE IS WHAT WAS VERIFIED, WHICH IS NARROWER THAN WHAT THE FEEDS
// PUBLISH. Y9.0 established these against each feed's own published points, to
// 0.05 on 98.0% and 99.8% of players, so a component below is a reading rather
// than a guess at what an undocumented field means. Sleeper publishes about
// seventy more — targets, first downs, kicker distance buckets, team defence —
// and they are deliberately absent: see `docs/in-season-data-sources.md` for
// why a kicker's could not be verified rather than merely written down. A rule
// this vocabulary has no component for is reported as unsupported, which is the
// one honest answer available and is never the same as scoring it zero.

/**
 * Every component a source may report and the scoring join may consume.
 *
 * Named for the quantity rather than for either feed's spelling, because both
 * feeds' spellings are already wrong for the other one: Sleeper writes
 * `pass_yd` and ESPN writes `3`.
 */
export const COMPONENTS = Object.freeze([
  'passYd',
  'passTd',
  'passInt',
  'pass2pt',
  'rushYd',
  'rushTd',
  'rush2pt',
  'rec',
  'recYd',
  'recTd',
  'rec2pt',
  'fumLost',
  'kickReturnTd',
  'puntReturnTd',
]);

const KNOWN = new Set(COMPONENTS);

/** Whether one name is a component this project has verified. */
export const isComponent = (name) => KNOWN.has(name);

/**
 * The positions this vocabulary can actually add up.
 *
 * A CONSEQUENCE OF THE LIST ABOVE, AND IT HAS TO BE STATED RATHER THAN LEFT TO
 * FALL OUT. Nothing here scores a field goal, an extra point, a sack, a points-
 * allowed bracket or a defensive touchdown, so a kicker and a team defence have
 * no projection at all — not a small one, none.
 *
 * The reason to say so explicitly is what happens otherwise, which was observed
 * rather than imagined. ESPN files a return-touchdown projection against every
 * team defence, so a reader keeping any row with any component kept all 32 of
 * them carrying two hundredths of a return touchdown between them. Under a
 * league scoring return touchdowns that defence projects 0.14 points, and under
 * one that does not it projects zero — and both are a defence sitting on a
 * lineup screen with a number beside it, ranked against the other 31, looking
 * exactly like advice. The truth is that no desk was asked a question this can
 * read the answer to.
 *
 * So the test for whether a player is projected is not "is any component
 * present" but "is this a position whose scoring these components can
 * represent".
 */
export const SCOREABLE_POSITIONS = Object.freeze(new Set(['QB', 'RB', 'WR', 'TE']));

/**
 * Refuse a mapping that names something this vocabulary does not hold.
 *
 * Called at module load by each mapping that targets these names, so a typo is
 * a service that will not start rather than a position that silently scores
 * nothing. `where` names the mapping, because the message is read by whoever
 * broke it and "unknown component" on its own does not say which file.
 */
export function checkComponents(names, where) {
  const wrong = [...new Set(names)].filter((name) => !KNOWN.has(name));
  if (wrong.length) {
    throw new Error(
      `${where} maps to ${wrong.length === 1 ? 'a component' : 'components'} `
      + `no source publishes: ${wrong.join(', ')}. `
      + 'Add it to COMPONENTS in sources/components.js, with the reading that verifies it.',
    );
  }
  return names;
}
