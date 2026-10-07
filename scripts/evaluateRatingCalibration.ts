import { asc, sql } from 'drizzle-orm';
import { db, getChallengeLeaderboard, leaderboardScore } from '../src/db';
import { cotdDaysTable } from '../src/db/schema';
import {
  applyQualifyingCupResult,
  getRatingSeedRanks,
  isLikelyAbandonedQualifyingRun,
  prepareQualifyingState,
  QUALIFYING_RATING_CONFIG,
  type QualifyingRatingConfig,
} from '../src/services/glickoService';
import { getUncertaintyCategory } from '../src/services/ratingPresentation';

interface RatingState {
  rating: number;
  rd: number;
  vol: number;
  matchCount: number;
  lastRatedAt: Date | null;
  peakRating: number;
  latestChange: number;
}

interface CalibrationResult {
  initialRating: number;
  initialRd: number;
  initialVolatility: number;
  rankPerformanceSoftness: number;
  tournamentInformation: number;
  ratingEvidenceMultiplier: number;
  provisionalMinimum: number;
  provisionalCups: number;
  tau: number;
  snapshots: TargetSnapshotResult[];
  exactModelTargets: boolean;
  exactMatchCounts: boolean;
  maximumAbsoluteDelta: number;
  score: number;
  passes: boolean;
}

interface TargetSnapshot {
  name: string;
  accountId: string;
  date: string;
  rank: number;
  rating: number;
  matchCount: number;
  latestChange: number;
  peakRating: number;
  rd: number;
  uncertainty: string;
}

interface TargetSnapshotResult {
  target: TargetSnapshot;
  actual: RatingState & { rank: number };
  exactModelFields: boolean;
  exactMatchCount: boolean;
  score: number;
}

interface ReplayCup {
  ratedAt: Date;
  results: Array<{ player: string; rank: number }>;
}

const NUMERIC_TOLERANCE = 5;

function withinTolerance(actual: number, expected: number, tolerance = NUMERIC_TOLERANCE): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

const TARGET_SNAPSHOTS: TargetSnapshot[] = [
  {
    name: 'GranaDy.', accountId: '05477e79-25fd-48c2-84c7-e1621aa46517', date: '2026-02-06',
    rank: 1, rating: 2977, matchCount: 1125, latestChange: 1.3, peakRating: 2979, rd: 190, uncertainty: 'very high',
  },
  {
    name: 'L1ngo...', accountId: 'b981e0b1-2d6a-4470-9b52-c1f6b0b1d0a6', date: '2026-02-06',
    rank: 2, rating: 2963, matchCount: 1019, latestChange: 0.7, peakRating: 2963, rd: 185, uncertainty: 'high',
  },
  {
    name: 'Scrapie98', accountId: 'da4642f9-6acf-43fe-88b6-b120ff1308ba', date: '2026-02-06',
    rank: 3, rating: 2910, matchCount: 1190, latestChange: -1.4, peakRating: 2917, rd: 191, uncertainty: 'very high',
  },
  {
    name: 'Ivancicus', accountId: 'c35a454d-2c1a-4e5c-a031-b4361e7dbe10', date: '2026-03-31',
    rank: 1864, rating: 2059, matchCount: 337, latestChange: 5.9, peakRating: 2059, rd: 95, uncertainty: 'very low',
  },
  {
    name: 'Nauu', accountId: 'bb4af693-5190-44c5-8448-d4ec36d95400', date: '2026-03-31',
    rank: 58, rating: 2669, matchCount: 676, latestChange: 1.8, peakRating: 2669, rd: 143, uncertainty: 'low-moderate',
  },
  {
    name: 'xRubiixx', accountId: '50513aca-7225-46e9-8fad-231a69e5dc81', date: '2026-03-31',
    rank: 2001, rating: 2042, matchCount: 123, latestChange: -46.1, peakRating: 2134, rd: 222, uncertainty: 'very high',
  },
];

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const index = (values.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return values[lower];
  return values[lower] + (values[upper] - values[lower]) * (index - lower);
}

function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0] ?? 0,
    p05: percentile(sorted, 0.05),
    p25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function formatSummary(label: string, values: number[]) {
  const summary = summarize(values);
  console.log(
    `${label}: n=${values.length} min=${summary.min.toFixed(1)} p05=${summary.p05.toFixed(1)} `
      + `p25=${summary.p25.toFixed(1)} median=${summary.median.toFixed(1)} `
      + `p75=${summary.p75.toFixed(1)} p95=${summary.p95.toFixed(1)} max=${summary.max.toFixed(1)}`,
  );
}

function readPositiveValues(variable: string, fallback: number[]): number[] {
  const values = process.env[variable]
    ?.split(',')
    .map(value => Number(value.trim()))
    .filter(value => Number.isFinite(value) && value > 0);
  return values?.length ? values : fallback;
}

async function main() {
  const cups = await db
    .select()
    .from(cotdDaysTable)
    .where(sql`${cotdDaysTable.qualifierChallengeId} IN (
      SELECT DISTINCT challenge_id FROM challenge_leaderboards
    )`)
    .orderBy(asc(cotdDaysTable.startDate));

  const replayCups: ReplayCup[] = [];
  const latestTargetDate = TARGET_SNAPSHOTS
    .map(target => target.date)
    .sort()
    .at(-1);
  for (const cup of cups) {
    if (!cup.qualifierChallengeId) continue;
    const ratedAt = new Date(cup.startDate);
    if (latestTargetDate && ratedAt.toISOString().slice(0, 10) > latestTargetDate) continue;
    const results = await getChallengeLeaderboard(cup.qualifierChallengeId);
    if (results.length < 2) continue;
    replayCups.push({ ratedAt, results });
  }
  console.log(`Loaded ${replayCups.length} historical cups for calibration.`);

  const requestedSoftnesses = readPositiveValues(
    'CALIBRATION_SOFTNESSES',
    [0.000075, 0.0003, 0.001],
  );
  const requestedInformation = readPositiveValues(
    'CALIBRATION_INFORMATION',
    [0.25, 0.5, 1],
  );
  const requestedRatingEvidence = readPositiveValues('CALIBRATION_RATING_EVIDENCE', [2, 4, 8]);
  const requestedInitialRatings = readPositiveValues('CALIBRATION_INITIAL_RATINGS', [1500]);
  const requestedInitialRds = readPositiveValues('CALIBRATION_INITIAL_RDS', [250, 350]);
  const requestedInitialVolatilities = readPositiveValues('CALIBRATION_INITIAL_VOLS', [0.06]);
  const requestedTaus = readPositiveValues('CALIBRATION_TAUS', [0.5, 1.2]);
  const requestedProvisionalMinimums = readNonNegativeValues('CALIBRATION_PROVISIONAL_MINIMUMS', [0.35]);
  const requestedProvisionalCups = readPositiveValues('CALIBRATION_PROVISIONAL_CUPS', [150, 225]);

  const results: CalibrationResult[] = [];
  for (const initialRating of requestedInitialRatings) {
    for (const initialRd of requestedInitialRds) {
      for (const initialVolatility of requestedInitialVolatilities) {
        for (const softness of requestedSoftnesses) {
          for (const tournamentInformation of requestedInformation) {
            for (const ratingEvidenceMultiplier of requestedRatingEvidence) {
              for (const tau of requestedTaus) {
                for (const provisionalMinimum of requestedProvisionalMinimums) {
                  for (const provisionalCups of requestedProvisionalCups) {
                    const config = {
                      ...QUALIFYING_RATING_CONFIG,
                      initialRating,
                      initialRd,
                      initialVolatility,
                      rankPerformanceSoftness: softness,
                      tournamentInformation,
                      ratingEvidenceMultiplier,
                      tau,
                      provisionalMinimum,
                      provisionalCups,
                    };
                    const result = await evaluateConfiguration(replayCups, config);
                    results.push(result);
                    console.log(
                      `Candidate prior=${initialRating}/${initialRd}/${initialVolatility} `
                        + `softness=${softness} info=${tournamentInformation} `
                        + `ratingEvidence=${ratingEvidenceMultiplier} tau=${tau} `
                        + `provisional=${provisionalMinimum}/${provisionalCups}: `
                        + `score=${result.score.toFixed(1)} `
                        + `within ${NUMERIC_TOLERANCE}pt model=${result.snapshots.filter(snapshot => snapshot.exactModelFields).length}/6 `
                        + `within ${NUMERIC_TOLERANCE}pt counts=${result.snapshots.filter(snapshot => snapshot.exactMatchCount).length}/6 `
                        + `${result.passes ? 'PASS' : 'outside targets'}`,
                    );
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  const best = results.sort((left, right) => left.score - right.score)[0];
  if (!best) throw new Error('No calibration candidates were evaluated.');

  console.log('\nBest candidate by dated profile-target fit:');
  console.log(JSON.stringify(best, null, 2));
  console.log('Per-player snapshot comparisons:');
  for (const snapshot of best.snapshots) {
    console.log(JSON.stringify({
      name: snapshot.target.name,
      date: snapshot.target.date,
      target: snapshot.target,
      actual: {
        rank: snapshot.actual.rank,
        rating: snapshot.actual.rating,
        matchCount: snapshot.actual.matchCount,
        latestChange: snapshot.actual.latestChange,
        peakRating: snapshot.actual.peakRating,
        rd: snapshot.actual.rd,
        uncertainty: getUncertaintyCategory(snapshot.actual.rd),
      },
    }));
  }
  if (process.env.CALIBRATION_APPLY !== 'true') {
    console.log('Report only. Set CALIBRATION_APPLY=true to write a passing configuration artifact.');
    return;
  }
  if (!best.passes) {
    console.warn('Best candidate does not match every target field; no config was written.');
    return;
  }

  const artifact = {
    schemaVersion: 1,
    calibratedAt: new Date().toISOString(),
    cups: replayCups.length,
    initialRating: best.initialRating,
    initialRd: best.initialRd,
    initialVolatility: best.initialVolatility,
    rankPerformanceSoftness: best.rankPerformanceSoftness,
    tournamentInformation: best.tournamentInformation,
    ratingEvidenceMultiplier: best.ratingEvidenceMultiplier,
    provisionalMinimum: best.provisionalMinimum,
    provisionalCups: best.provisionalCups,
    tau: best.tau,
    metrics: {
      snapshots: best.snapshots,
      maximumAbsoluteDelta: best.maximumAbsoluteDelta,
    },
  };
  const artifactUrl = new URL('../rating-calibration.json', import.meta.url);
  await Bun.write(artifactUrl, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Wrote validated model configuration to ${artifactUrl.pathname}`);
}

async function evaluateConfiguration(
  cups: ReplayCup[],
  config: QualifyingRatingConfig,
): Promise<CalibrationResult> {
  const states = new Map<string, RatingState>();
  const targetResults = new Map<string, TargetSnapshotResult>();
  const initialState: RatingState = {
    rating: config.initialRating,
    rd: config.initialRd,
    vol: config.initialVolatility,
    matchCount: 0,
    lastRatedAt: null,
    peakRating: config.initialRating,
    latestChange: 0,
  };
  const deltas: number[] = [];
  const eliteDeltas: number[] = [];
  let processedCups = 0;

  for (const cup of cups) {
    const ratedAt = cup.ratedAt;
    const results = cup.results;
    const preparedStates = results.map(entry => {
      const state = states.get(entry.player) ?? initialState;
      return {
        ...state,
        ...prepareQualifyingState(state, state.lastRatedAt, ratedAt),
        matchCount: state.matchCount,
      };
    });
    const ratingSeedRanks = getRatingSeedRanks(preparedStates.map(state => state.rating));
    const ratedResults = results
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry, index }) => !isLikelyAbandonedQualifyingRun({
        rating: preparedStates[index].rating,
        matchCount: preparedStates[index].matchCount,
        rank: entry.rank,
        ratingSeedRank: ratingSeedRanks[index],
        fieldSize: results.length,
      }));
    const participants = ratedResults.map(({ entry, index }) => ({
      player: entry.player,
      rank: entry.rank,
      rating: preparedStates[index].rating,
      rd: preparedStates[index].rd,
    }));

    for (let playerIndex = 0; playerIndex < ratedResults.length; playerIndex++) {
      const { entry, index } = ratedResults[playerIndex];
      const previous = preparedStates[index];
      const updated = applyQualifyingCupResult(
        previous,
        entry.player,
        entry.rank,
        participants,
        playerIndex,
        config,
      );
      const delta = updated.rating - previous.rating;
      deltas.push(delta);
      if (previous.rating >= 2850) eliteDeltas.push(delta);
      states.set(entry.player, {
        ...updated,
        matchCount: previous.matchCount + 1,
        lastRatedAt: ratedAt,
        peakRating: Math.max(previous.peakRating, updated.rating),
        latestChange: delta,
      });
    }
    processedCups++;

    const date = ratedAt.toISOString().slice(0, 10);
    const dateTargets = TARGET_SNAPSHOTS.filter(target => target.date === date);
    if (dateTargets.length > 0) {
      const ordered = Array.from(states, ([player, state]) => ({
        player,
        state,
        score: leaderboardScore(state.rating, state.rd),
      })).sort((left, right) => right.score - left.score
        || right.state.rating - left.state.rating
        || left.player.localeCompare(right.player));

      for (const target of dateTargets) {
        const rank = ordered.findIndex(entry => entry.player === target.accountId) + 1;
        const state = states.get(target.accountId);
        if (!state || rank === 0) continue;
        const exactModelFields = withinTolerance(rank, target.rank)
          && withinTolerance(Math.round(state.rating), target.rating)
          && withinTolerance(Number(state.latestChange.toFixed(1)), target.latestChange)
          && withinTolerance(Math.round(state.peakRating), target.peakRating)
          && withinTolerance(Math.round(state.rd), target.rd)
          && getUncertaintyCategory(state.rd) === target.uncertainty;
        const exactMatchCount = withinTolerance(state.matchCount, target.matchCount);
        const score = Math.abs(state.rating - target.rating) * 5
          + Math.abs(state.rd - target.rd) * 0.25
          + Math.abs(state.latestChange - target.latestChange) * 2
          + Math.abs(state.peakRating - target.peakRating) * 0.5
          + Math.abs(rank - target.rank) * 0.05;
        targetResults.set(`${target.accountId}:${target.date}`, {
          target,
          actual: { ...state, rank },
          exactModelFields,
          exactMatchCount,
          score,
        });
      }
    }
  }

  const snapshots = TARGET_SNAPSHOTS.map(target => targetResults.get(`${target.accountId}:${target.date}`))
    .filter((snapshot): snapshot is TargetSnapshotResult => snapshot !== undefined);
  const ratings = Array.from(states.values(), state => state.rating);
  const maximumAbsoluteDelta = deltas.reduce(
    (maximum, delta) => Math.max(maximum, Math.abs(delta)),
    0,
  );
  const eliteCount = ratings.filter(rating => rating >= 2850 && rating <= 2999).length;
  const aboveReferenceRange = ratings.filter(rating => rating > 2999).length;
  const minimumRating = Math.min(...ratings);
  const score = snapshots.reduce((sum, snapshot) => sum + snapshot.score, 0)
    + Math.max(0, 150 - minimumRating) * 10
    + Math.max(0, maximumAbsoluteDelta - 150) * 2
    + aboveReferenceRange * 10;
  const exactModelTargets = snapshots.length === TARGET_SNAPSHOTS.length
    && snapshots.every(snapshot => snapshot.exactModelFields);
  const exactMatchCounts = snapshots.length === TARGET_SNAPSHOTS.length
    && snapshots.every(snapshot => snapshot.exactMatchCount);
  const passes = exactModelTargets
    && minimumRating > 100
    && maximumAbsoluteDelta <= 150
    && aboveReferenceRange === 0;

  if (process.env.CALIBRATION_VERBOSE === 'true') {
    console.log(`Replayed ${processedCups} cups for ${states.size} players.`);
    formatSummary('Final ratings', ratings);
    formatSummary('All per-cup rating deltas', deltas);
    formatSummary('Elite (pre-cup >= 2850) per-cup deltas', eliteDeltas);
    console.log(`Elite 2850–2999=${eliteCount}; above 2999=${aboveReferenceRange}.`);
  }

  return {
    initialRating: config.initialRating,
    initialRd: config.initialRd,
    initialVolatility: config.initialVolatility,
    rankPerformanceSoftness: config.rankPerformanceSoftness,
    tournamentInformation: config.tournamentInformation,
    ratingEvidenceMultiplier: config.ratingEvidenceMultiplier,
    provisionalMinimum: config.provisionalMinimum,
    provisionalCups: config.provisionalCups,
    tau: config.tau,
    snapshots,
    exactModelTargets,
    exactMatchCounts,
    maximumAbsoluteDelta,
    score,
    passes,
  };
}

function readNonNegativeValues(variable: string, fallback: number[]): number[] {
  const values = process.env[variable]
    ?.split(',')
    .map(value => Number(value.trim()))
    .filter(value => Number.isFinite(value) && value >= 0);
  return values?.length ? values : fallback;
}

await main();
