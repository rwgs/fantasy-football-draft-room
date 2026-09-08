# What is available for weekly advice, by source

Reference for the four feeds this project can reach, judged on whether they can
support weekly and remaining-season advice rather than a draft. Companion to
`yahoo-in-season-data.md`, which covers one platform's league in depth; this
covers the player data all four publish about the world.

Everything here was read on 2026-09-08, from a shell, with no account and no
key. NFL week 1 had not kicked off, which limits one row and is called out where
it does. Fantasy Football Calculator was assessed alongside the three the task
named, because the project already depends on it and leaving it out would have
looked like a judgement rather than an omission.

**None of this is promised.** Sleeper's and Fantasy Football Calculator's
endpoints are public and documented by use rather than contract; ESPN's and
Yahoo's are what their own apps call. Any of them can change in a deploy.

FantasyPros is deliberately absent. `DECISIONS.md` for 2026-09-05 records why —
ten rows on the free tier — and nothing here changes that condition.

## The thing that decides the shape of all of it

**A custom league's points cannot be fetched from anywhere.** They have to be
computed.

Every source publishes points under its own scoring: Sleeper gives `pts_std`,
`pts_half_ppr` and `pts_ppr`, ESPN gives an `appliedTotal` under its default
league. A Yahoo league carries 38 scoring categories against 35 modifiers, and
no combination of three preset formats reproduces that.

What makes it tractable is that all three of the useful sources publish the raw
components underneath the points — receptions, targets, rushing yards,
touchdowns — keyed by their own stat ids. So the arithmetic is: take projected
components from a source, take the modifiers from the league, multiply and sum.

That is the same conclusion the Yahoo study reached from the other direction,
where stats arrive as raw `stat_id` values and never as points. Two independent
routes to it is worth something. **It means a scoring join is unavoidable
work**, not a refinement to add later, and it is the reason the settings read is
load-bearing.

## Yahoo, at game scope

Free, no key, no account. See `yahoo-in-season-data.md` for the detail; what
matters here is the comparison.

| Carries | State |
| --- | --- |
| The pool, 2888 players, paged | observed |
| Injury `status`, `status_full`, `injury_note` | observed, on ~20% of players — absent means healthy |
| `bye_weeks` | observed, every player |
| Ownership percentage with a weekly `delta` | observed, every player |
| ADP via `;out=draft_analysis` | observed |
| The stat vocabulary, 108 stats | observed |
| Week start and end dates | observed, 18 weeks |
| Raw weekly and season stat values | shape observed, **every value zero — nothing played** |
| **Projections of any kind** | **none found at any public path** |
| Kickoff times | **none found** |

Yahoo is the source for *what a league is* and for identity within it. It is
**not** a projection source: nothing public was found that projects a week.

## Sleeper

Free, no key. Already fetched by `server/src/sources/sleeper.js` for season
projections; the weekly feed is a different path and is not yet used.

    https://api.sleeper.app/projections/nfl/2026/<week>?season_type=regular&position[]=RB

| Carries | State |
| --- | --- |
| Weekly projections, weeks 1-18 | observed at weeks 1, 4, 8, 14 and 18 |
| Points for three formats: `pts_std`, `pts_half_ppr`, `pts_ppr` | observed |
| Raw projected components | observed — `rec`, `rec_yd`, `rec_td`, `rec_tgt`, `rush_att`, `rush_yd`, `rush_td`, `fum_lost`, and length buckets like `rec_10_19` |
| Projected usage | observed — `rec_tgt` is projected targets, which is the usage number weekly advice actually wants |
| Opponent and date | observed — `opponent`, `team`, `game_id`, `date` |
| Injury detail | observed — `injury_status`, `injury_body_part`, `injury_notes`, `injury_start_date` |
| Who projected it | observed — `company: rotowire`, `category: proj` |
| Freshness | observed — `last_modified` and `updated_at` per record |
| Week 19 and beyond | records returned, **no points in any of them** |

**The count that matters is not the record count.** One week for six positions
returned 3304 records and only 463 carried points. The rest are players nobody
projected, and the existing season-projection code already treats that
distinction correctly: dropped, not scored as zero. Weekly is the same shape, so
the same rule applies.

Sampled across all six positions at week 8, which unlike week 1 has byes:

| Position | Projected | Returned |
| --- | --- | --- |
| QB | 28 | 355 |
| RB | 108 | 681 |
| WR | 168 | 1364 |
| TE | 100 | 642 |
| K | 28 | 153 |
| DEF | 28 | 28 |

28 quarterbacks, 28 kickers and 28 defences against exactly 28 teams playing
that week. So the projected set is close to "the starters on teams with a game",
and the depth a waiver comparison wants may simply not be projected at all.

**A bye is invisible in this feed.** 109 of the returned players were on one of
the four teams idle in week 8, and **not one carried a projection.** That is the
same absence as a player nobody rated, so the two cannot be told apart from the
projection alone — it takes the schedule to know which is which. Anything
saying "no projection, so sit him" would say it identically for a bye and for a
deep bench player, and only one of those is useful advice.

Injury statuses seen in that one week, across positions: `Questionable` 162,
`IR` 63, `NA` 15, `PUP` 7, `Sus` 2, `DNR` 2, `Out` 1. A different vocabulary
from Yahoo's `Q`/`O`/`IR`/`IR-R`/`PUP-R`/`NA`/`CEL`, so the two need mapping
rather than comparing.

`/v1/state/nfl` answers which week it is — `week`, `season`, `season_type` —
without a league, which is the cheapest way to know what "this week" means.

`/v1/stats/nfl/regular/2026/1` is the actuals path. It answered `{}` on the day,
consistent with nothing having kicked off, so **the actuals feed is untested**.

## ESPN

Free, no key. Already fetched by `server/src/sources/espnRanks.js` for draft
ranks, from a different path.

    https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/3?view=kona_player_info

| Carries | State |
| --- | --- |
| Weekly projections, every week 0-18 for 2026 | observed, one player checked across all 19 |
| Weekly actuals for the prior season | observed, 2025 weeks 0-18 |
| Points and raw components per week | observed — `appliedTotal` plus a `stats` map |
| Which is which | observed — `statSourceId` `1` projected, `0` actual; `scoringPeriodId` is the week, `0` the season |
| Ownership, ADP, auction value, with change deltas | observed under `ownership` |
| Injury | observed — `injured`, `injuryStatus` |
| Slot eligibility | observed — `eligibleSlots`, `droppable` |
| Editorial outlook | observed — `seasonOutlook` |

Two details worth having before anyone builds on it.

**A bye reads as an absent week, not a zero.** The player checked had 2025
actuals for every week except 8, which was his bye. Anything averaging weekly
actuals has to decide what an absent week means, and it does not mean nothing
happened.

**This path honours `X-Fantasy-Filter`; the one already in use does not.** A
limit of 3 returned 3 players and 112 KB here. The same header against
`/seasons/2026/players?scoringPeriodId=0`, which `espnRanks.js` uses, returned
11617 players and 39.6 MB whether the limit was 3 or 1000 — so that file's
comment about the filter being ignored is accurate for the path it calls, and
stays. Recorded because weekly projections would not need a forty megabyte
download, not as a criticism of the draft path.

**A limit alone is refused**, and ESPN says why rather than guessing for you:

    {"messages":["Filter: Limit request must be accompanied by a sort"]}

So a filter needs a sort beside the limit — `sortPercOwned` and
`sortDraftRanks` both satisfy it. `offset` is accepted with them, so this path
pages as well as limits.

## Fantasy Football Calculator

Free, commercial use allowed, attribution asked. The project's primary ADP
source, and **it has nothing weekly.**

| Path | Result |
| --- | --- |
| `/api/v1/adp/<format>?teams=&year=` | 200, in use, draft ADP with a standard deviation |
| `/api/v1/players` | 200, 143 KB — `player_id`, `full_name`, `team`, `position`, `bye` |
| `/api/v1/weekly-rankings?week=1` | **404** |
| `/api/v1/projections?week=1` | **404** |

So its role does not change: it measures where players go in real drafts, which
is a draft question. It contributes byes and nothing else in season, and byes
are already free from two other places.

This is the answer to whether it belongs in the weekly picture. It does not, and
that is a property of the feed rather than a preference.

## Coverage, by what weekly advice needs

| Need | Yahoo | Sleeper | ESPN | FFC |
| --- | --- | --- | --- | --- |
| Weekly projection | — | **yes, 1-18** | **yes, 0-18** | — |
| Rest-of-season projection | — | sum of weeks | **yes, period 0** | — |
| Raw projected components | — | **yes** | **yes** | — |
| Projected usage (targets) | — | **yes** | in the stats map | — |
| Weekly actuals | shape only, all zero | untested, `{}` | **yes, prior season** | — |
| Injury status | yes | yes | yes | — |
| Injury detail | `injury_note` | body part, notes, start date | status only | — |
| Bye weeks | yes | via schedule | absent week | yes |
| Kickoff time | week dates only | **date only, no time** | **yes, to the minute** | — |
| Live game state | — | `status` per game | **yes, clock and period** | — |
| Ownership percentage | **yes, with delta** | — | yes, with delta | — |
| ADP | yes | yes | yes | **yes, with deviation** |
| Scoring rules for a league | **yes, only source** | — | — | — |
| Roster slots for a league | **yes, only source** | — | — | — |

Three rows have exactly one source, and they are the load-bearing ones: a
league's scoring and slots come only from Yahoo, and kickoff times come only
from ESPN. **`game_weeks` is not a substitute for kickoff times** — it says
which dates belong to a week, not when a game starts, and a lineup lock is a
kickoff.

## Horizons

| Horizon | Supportable | From |
| --- | --- | --- |
| This week | yes | Sleeper or ESPN weekly projection |
| Any single future week to 18 | yes | either, both cover the full regular season |
| Rest of season | yes | ESPN period 0, or Sleeper's weeks summed |
| Playoffs, weeks 19+ | **no** | Sleeper returns records with no points; ESPN stops at 18 |
| A past season | ESPN only | 2025 weekly actuals present; Yahoo cannot address a past league at all |

## Identity, and a negative result worth keeping

Joining a Yahoo player to a projection is the hinge of the whole feature, and
the obvious shortcut does not work.

Sleeper's `/v1/players/nfl` — 12226 players, 14.7 MB, free — carries `yahoo_id`
on 6750 records and `espn_id` on 6736. That looks like the authoritative join
`DECISIONS.md` wished for on 2026-09-05 when it recorded that FantasyPros'
`yahoo_id` and `espn_id` "would replace the six matching tiers in `names.js`".

**It is not, and the reason is that the field is legacy.** Coverage against
Sleeper's own `years_exp`, over active QB, RB, WR, TE and K:

| Years experience | `yahoo_id` present |
| --- | --- |
| 0 (rookies) | **0 of 317** |
| 1 | **13 of 726, 2%** |
| 2 | 120 of 346, 35% |
| 3 | 180 of 347, 52% |
| 4 | 203 of 327, 62% |
| 5 | 225 of 293, 77% |
| 6 and up | ~100% |

Sleeper appears to have stopped populating it around five years ago. Checked
directly rather than inferred: Ja'Marr Chase, Jahmyr Gibbs, Bijan Robinson,
Puka Nacua, Amon-Ra St. Brown and De'Von Achane are all in Sleeper, all active,
and all carry `yahoo_id: null`.

Matching Yahoo's top 300 by `player_id` against the field found only 75, and
those 75 were the veterans. So the coverage is inverted against need: the field
is complete for players nobody is deciding about and empty for the ones everyone
is.

**So the 2026-09-05 decision stands, now with numbers behind it.** Nothing free
replaces name matching, and a future attempt to fix `names.js` with Sleeper's
cross-ids would look promising, pass a spot check on a veteran, and fail on
every rookie.

One useful thing did come out of the 75 that matched: all four name
disagreements were generational suffixes — Yahoo's "Chris Godwin Jr.", "Michael
Pittman Jr.", "Aaron Jones Sr.", "Deebo Samuel Sr." against Sleeper's unsuffixed
forms. That is a real and narrow class of mismatch, and evidence for what any
matcher has to handle.

## Freshness and access terms

| Source | Freshness signal | Terms |
| --- | --- | --- |
| Yahoo game scope | `@refresh_rate: 30` on every response, **never tested** | undocumented, public, no key |
| Sleeper | `last_modified`, `updated_at` per record | free, no key, public |
| ESPN | `ownership.date` timestamp | undocumented, no key |
| FFC | none in the payload; cached 6h in this app | free, commercial use allowed, **attribution asked and already given** |

## Missing-data behaviour to build to

Each of these was observed, and each has a wrong answer that looks right:

- **A player with no projection is not a zero.** 463 of 3304 Sleeper records
  carried points. The existing season code drops the rest, and weekly must too.
- **A missing projection does not say why it is missing.** A bye and an
  unprojected bench player are the same absence — 109 players on bye in week 8,
  none with a projection. Distinguishing them needs the schedule.
- **An absent injury field means healthy**, on both Yahoo and ESPN. It does not
  mean the shape changed.
- **The injury vocabularies differ between sources** and have to be mapped, not
  string-compared.
- **An absent weekly actual may be a bye**, not a zero performance.
- **Week 19+ returns rows with no points.** A response that parses is not a
  response with an answer in it.
- **A past season is out of reach for a Yahoo league** by construction:
  `nfl.l.<id>` names the current season's game.

## Not observed, and not to be assumed

- **Every actual stat value.** Nothing had kicked off, so all actuals read zero
  or empty. Both the values and how fast they land during a game are unknown,
  and no claim about live scoring should rest on this document.
- Whether Sleeper's `{}` actuals path fills in once games are played.
- Whether the three sources agree, and by how much. No comparison was made, and
  a projection nobody has checked against another is one opinion.
- Defensive and kicker projection quality, sampled only for shape.
- Rate limits on any of the four. Nothing was fetched hard enough to find one,
  which is not the same as there being none.

## Reproducing this

All of it, from a shell, no key:

    curl "https://api.sleeper.app/projections/nfl/2026/1?season_type=regular&position[]=RB"
    curl "https://api.sleeper.app/v1/state/nfl"
    curl "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20260909-20260915"
    curl -H 'X-Fantasy-Filter: {"players":{"limit":3,"sortPercOwned":{"sortAsc":false,"sortPriority":1}}}' \
      "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/3?view=kona_player_info"
    curl "https://fantasyfootballcalculator.com/api/v1/adp/half-ppr?teams=12&year=2026"

The Yahoo game-scope lines are in `yahoo-in-season-data.md` rather than repeated
here.
