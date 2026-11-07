import { MIN_RANKED_COTDS } from '../../../db/schema';
import { htmlResponse } from '../html';

export function renderRatingsGuide(): Response {
  return htmlResponse('How ratings work', <>
    <p className="muted"><a href="/">← Leaderboard</a></p>
    <h1>How ratings work</h1>
    <p className="intro">A quick guide to the ratings, ranks, and results shown on TM Glicko.</p>

    <section className="panel">
      <h2>Rating players from COTD results</h2>
      <p>TM Glicko calculates a separate qualifying rating from each player's Cup of the Day qualifier placement. Ratings use a calibrated Glicko-2 model: they reflect both results and uncertainty, rather than treating every placement as equally informative.</p>
      <p>Each processed COTD is treated as a rating period. The model compares placements across the full field, so finishing ahead is never treated as worse than a draw and finishing behind is never treated as better than a draw.</p>
    </section>

    <section className="panel">
      <h2>Eligibility and leaderboard rank</h2>
      <p>A player becomes eligible for a competitive rank after completing at least {MIN_RANKED_COTDS} processed COTDs. Until then, their profile reports their completed count but does not show a competitive rank.</p>
      <p>Eligible players are ordered by rating, highest first. Players with the same rating are ordered by account ID to keep the leaderboard deterministic.</p>
    </section>

    <section className="panel">
      <h2>Competitive tiers and divisions</h2>
      <p>Eligible players are assigned a percentile-based tier: Bronze, Silver, Gold, Master, or Trackmaster. Bronze through Master each have three ranks and four divisions. Trackmaster is the highest tier.</p>
      <p>Tier boundaries are estimates based on the current eligible-player distribution; they are not official Trackmania ranks or placements.</p>
    </section>

    <section className="panel">
      <h2>Rating history and changes</h2>
      <p>A profile's chart shows up to its latest 120 eligible rating results. The recent pace summarizes the rating changes from up to the latest five results shown. A missing change means there was no previous eligible rating to compare against.</p>
      <p>Ratings and COTD data may be delayed, incomplete, or recalculated as competition records are processed.</p>
    </section>

    <p><a href="/leaderboard">Browse the leaderboard →</a></p>
  </>);
}
