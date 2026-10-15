import {
  AttachmentBuilder,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import { findAccountIdByUsername, findUsernameByAccountId } from '../services/accountLookup';
import {
  getEligiblePeakRating,
  getPlayerRatingState,
  getPlayerRatingStateByRank,
  getRatingRank,
  getCotdDayById,
} from '../db';
import { MIN_RANKED_COTDS } from '../db/schema';
import {
  getPlayerTier,
  getRankDivisionRatingRanges,
} from '../services/rankService';
import { renderPlayerCard } from '../services/playerCardRenderer';
import type { SelectPlayerRatingState } from '../db/schema';

export const data = new SlashCommandBuilder()
  .setName('playercard')
  .setDescription('Shows a compact player rating card.')
  .addStringOption(option =>
    option
      .setName('name')
      .setDescription('Exact Trackmania username.')
      .setRequired(false)
  )
  .addIntegerOption(option =>
    option
      .setName('rank')
      .setDescription('Leaderboard rank (e.g. 20).')
      .setMinValue(1)
      .setRequired(false)
  );

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const requestedName = interaction.options.getString('name');
  const requestedRank = interaction.options.getInteger('rank');
  if (requestedName === null && requestedRank === null) {
    await interaction.editReply('Choose exactly one lookup: **name** or **rank**.');
    return;
  }
  if (requestedName !== null && requestedRank !== null) {
    await interaction.editReply('Choose exactly one lookup: **name** or **rank**.');
    return;
  }

  let state: SelectPlayerRatingState;
  let rank: number;
  let total: number;
  let username: string;

  if (requestedRank !== null) {
    const result = await getPlayerRatingStateByRank('qualifying', requestedRank);
    if (!result) {
      await interaction.editReply(`No eligible player found at rank **#${requestedRank}**.`);
      return;
    }

    ({ state, total } = result);
    rank = requestedRank;
    username = (await findUsernameByAccountId(state.accountId)) ?? state.accountId;
  } else {
    if (requestedName === null) {
      throw new Error('Player card lookup requires either a name or a rank.');
    }

    const accountId = await findAccountIdByUsername(requestedName);
    if (!accountId) {
      await interaction.editReply(`No exact match for **${requestedName}** — check spelling/casing.`);
      return;
    }

    state = await getPlayerRatingState(accountId, 'qualifying');
    if (state.lastProcessedCupId === null || state.matchCount < MIN_RANKED_COTDS) {
      await interaction.editReply(
        `**${requestedName}** is not ranked yet. Rating stats are unavailable until they complete ${MIN_RANKED_COTDS} COTDs.`
      );
      return;
    }

    const rankResult = await getRatingRank('qualifying', state.accountId, state.rating);
    if (rankResult.rank < 1 || rankResult.total < 1) {
      throw new Error(`Could not determine eligible leaderboard rank for account ${state.accountId}.`);
    }

    ({ rank, total } = rankResult);
    username = (await findUsernameByAccountId(state.accountId)) ?? requestedName;
  }

  const [tier, peakRating, lastCup] = await Promise.all([
    getPlayerTier(state.rating, rank, total),
    getEligiblePeakRating(state.accountId, 'qualifying'),
    state.lastProcessedCupId === null ? Promise.resolve(undefined) : getCotdDayById(state.lastProcessedCupId),
  ]);
  if (peakRating === null) {
    throw new Error(`Could not load eligible-era peak rating for account ${state.accountId}.`);
  }

  const divisionRanges = await getRankDivisionRatingRanges(tier.rank.code, total);
  if (divisionRanges.length !== 4) {
    throw new Error(`Could not load rating ranges for ${tier.rank.name} divisions.`);
  }

  const ratingChange = state.previousRating === null
    ? 'n/a'
    : `${state.rating - state.previousRating >= 0 ? '+' : ''}${(state.rating - state.previousRating).toFixed(1)}`
      + (lastCup?.startDate ? ` on ${formatDate(new Date(lastCup.startDate))}` : '');

  const image = renderPlayerCard({
    username,
    rank,
    total,
    rating: state.rating,
    latestChange: ratingChange,
    peakRating,
    tier,
    divisionRanges,
  });

  await interaction.editReply({
    files: [new AttachmentBuilder(image, { name: 'player-card.png' })],
  });
}
