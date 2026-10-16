import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, AttachmentBuilder, escapeMarkdown } from 'discord.js';
import { findAccountIdByUsername, findUsernameByAccountId, findUsernamesByAccountIds } from '../services/accountLookup';
import { getEligiblePeakRating, getPlayerRatingState, getPlayerRatingStateByRank, getPlayerRatingStatesByRankRange, getRatingRank, getCotdDayById } from '../db';
import { MIN_RANKED_COTDS } from '../db/schema';
import { formatTopPercentage, getCotdDivisionEstimate, getNextRankGoal, getPlayerTier } from '../services/rankService';
import { getUncertaintyCategory } from '../services/ratingPresentation';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { SelectPlayerRatingState } from '../db/schema';

export const data = new SlashCommandBuilder()
  .setName('playerrating')
  .setDescription("Gets a player's Glicko-2 rating from COTD Qualifying.")
  .addStringOption(o => o.setName('username').setDescription('Exact Trackmania username.').setRequired(false))
  .addIntegerOption(o =>
    o
      .setName('rank')
      .setDescription('Leaderboard rank (e.g. 20).')
      .setMinValue(1)
      .setRequired(false)
  );

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await executePlayerRatingLookup(
    interaction,
    interaction.options.getString('username'),
    interaction.options.getInteger('rank'),
  );
}

export async function executePlayerRatingLookup(
  interaction: ChatInputCommandInteraction,
  requestedUsername: string | null,
  requestedRank: number | null,
) {
  await interaction.deferReply();

  if ((requestedUsername === null) === (requestedRank === null)) {
    await interaction.editReply('Choose exactly one lookup: **username** or **rank**.');
    return;
  }

  let state: SelectPlayerRatingState;
  let rank = 0;
  let total = 0;
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
    if (requestedUsername === null) {
      throw new Error('Player rating lookup requires either a username or rank.');
    }
    const usernameQuery = requestedUsername;
    const accountId = await findAccountIdByUsername(usernameQuery);
    if (!accountId) {
      await interaction.editReply(`No exact match for **${usernameQuery}** — check spelling/casing.`);
      return;
    }

    state = await getPlayerRatingState(accountId, 'qualifying');
    if (state.lastProcessedCupId === null || state.matchCount < MIN_RANKED_COTDS) {
      await interaction.editReply(
        `**${usernameQuery}** is not ranked yet. Rating stats are unavailable until they complete ${MIN_RANKED_COTDS} COTDs.`
      );
      return;
    }

    username = (await findUsernameByAccountId(state.accountId)) ?? usernameQuery;
  }

  const [rankResult, lastCup, peakRating] = await Promise.all([
    requestedRank === null
      ? getRatingRank('qualifying', state.accountId, state.rating)
      : Promise.resolve(null),
    state.lastProcessedCupId === null ? Promise.resolve(null) : getCotdDayById(state.lastProcessedCupId),
    getEligiblePeakRating(state.accountId, 'qualifying'),
  ]);
  if (peakRating === null) {
    throw new Error(`Could not load eligible-era peak rating for account ${state.accountId}.`);
  }
  if (rankResult) {
    ({ rank, total } = rankResult);
  }
  const closestPlayersFrom = Math.max(1, Math.min(rank - 2, total - 4));
  const closestPlayersTo = Math.min(total, closestPlayersFrom + 4);
  const { states: closestPlayerStates } = await getPlayerRatingStatesByRankRange(
    'qualifying',
    closestPlayersFrom,
    closestPlayersTo - closestPlayersFrom + 1,
  );
  const closestPlayerUsernames = await findUsernamesByAccountIds(
    closestPlayerStates.filter((_, index) => closestPlayersFrom + index !== rank).map(player => player.accountId),
  );
  const closestPlayers = closestPlayerStates
    .map((player, index) => ({ player, rank: closestPlayersFrom + index }))
    .filter(({ rank: playerRank }) => playerRank !== rank)
    .map(({ player, rank: playerRank }) =>
      `**#${playerRank}** ${escapeMarkdown(closestPlayerUsernames.get(player.accountId) ?? player.accountId)}`
    )
    .join(', ');
  const tierInfo = await getPlayerTier(state.rating, rank, total);
  const divisionEstimate = await getCotdDivisionEstimate(state.rating);
  const nextGoal = getNextRankGoal(rank, total, tierInfo);
  const nextGoalState = nextGoal
    ? await getPlayerRatingStateByRank('qualifying', nextGoal.rank)
    : null;
  if (nextGoal && !nextGoalState) {
    throw new Error(`Could not load the player at next-goal leaderboard position ${nextGoal.rank}.`);
  }
  const nextGoalUsername = nextGoal?.name.startsWith('Top ') && nextGoalState
    ? (await findUsernameByAccountId(nextGoalState.state.accountId)) ?? nextGoalState.state.accountId
    : null;

  const ratingChange =
    state.previousRating !== null
      ? state.rating - state.previousRating
      : null;

  let changeDateStr = '';
  if (lastCup?.startDate) {
    changeDateStr = ` on ${formatDate(new Date(lastCup.startDate))}`;
  }

  const formattedLatestChange =
    ratingChange !== null
      ? `${ratingChange >= 0 ? '+' : ''}${ratingChange.toFixed(1)}${changeDateStr}`
      : 'n/a';

  const uncertaintyDesc = `${getUncertaintyCategory(state.rd)} ( ${Math.round(state.rd)} )`;
  const nextGoalField = nextGoal && nextGoalState
    ? {
      name: 'Next Goal',
      value: `**${nextGoal.name}${nextGoalUsername ? ` — ${nextGoalUsername}` : ''}**\nRating: ${Math.round(nextGoalState.state.rating)} (${nextGoalState.state.rating >= state.rating ? '+' : ''}${(nextGoalState.state.rating - state.rating).toFixed(1)} to go)`,
      inline: false,
    }
    : null;

  const embed = new EmbedBuilder()
    .setColor(tierInfo.rank.tierColor)
    .setTitle(requestedRank === null ? `${username} Rating Info` : `Rank ${rank} (${username}) Rating Info`)
    .addFields(
      {
        name: 'Competitive Rank',
        value: `**${tierInfo.fullName}** (Top ${formatTopPercentage(tierInfo.topPercentage)}%)`,
        inline: false,
      },
      {
        name: 'COTD Division Estimate',
        value: divisionEstimate === null
          ? 'Unavailable: no historical COTD results found.'
          : `Div **${divisionEstimate}**`,
        inline: false,
      },
      ...(nextGoalField ? [nextGoalField] : []),
      {
        name: 'Glicko-2 Rating',
        value: `${Math.round(state.rating)}`,
        inline: true,
      },
      {
        name: 'Leaderboard Rank',
        value: `#${rank} of ${total}`,
        inline: true,
      },
      {
        name: 'Closest Players',
        value: closestPlayers || 'No other players on the leaderboard.',
        inline: false,
      },
      {
        name: 'Match Count',
        value: `${state.matchCount}`,
        inline: true,
      },
      {
        name: 'Latest Change',
        value: formattedLatestChange,
        inline: true,
      },
      {
        name: 'Peak Rating',
        value: `${Math.round(peakRating)}`,
        inline: true,
      },
      {
        name: 'Rating Uncertainty',
        value: uncertaintyDesc,
        inline: true,
      }
    );

  const files: AttachmentBuilder[] = [];
  const iconPath = join(process.cwd(), tierInfo.iconPath);
  if (existsSync(iconPath)) {
    const attachment = new AttachmentBuilder(iconPath, { name: tierInfo.rank.iconFile });
    embed.setThumbnail(`attachment://${tierInfo.rank.iconFile}`);
    files.push(attachment);
  }

  await interaction.editReply({ embeds: [embed], files });
}