export interface CotdDivisionSample {
  rating: number;
  rank: number;
  fieldSize: number;
}

const DIVISION_SIZE = 64;
const MAX_NEIGHBOR_SAMPLES = 200;

export function estimateCotdDivision(
  rating: number,
  samples: CotdDivisionSample[],
): number | null {
  const validSamples = samples.filter(sample =>
    Number.isFinite(sample.rating)
    && Number.isInteger(sample.rank)
    && sample.rank >= 1
    && Number.isInteger(sample.fieldSize)
    && sample.fieldSize >= sample.rank
  );
  if (validSamples.length === 0) return null;

  const nearestSamples = validSamples
    .sort((left, right) => Math.abs(left.rating - rating) - Math.abs(right.rating - rating))
    .slice(0, MAX_NEIGHBOR_SAMPLES);
  const averagePercentile = nearestSamples.reduce(
    (sum, sample) => sum + (sample.rank - 1) / Math.max(1, sample.fieldSize - 1),
    0,
  ) / nearestSamples.length;
  const averageFieldSize = nearestSamples.reduce((sum, sample) => sum + sample.fieldSize, 0)
    / nearestSamples.length;
  const estimatedRank = averagePercentile * Math.max(0, averageFieldSize - 1) + 1;

  return Math.floor((estimatedRank - 1) / DIVISION_SIZE) + 1;
}
