import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { findAccountIdByUsername } from '../services/accountLookup';
import { getPlayerRatingState, getPlayerRatingStateByRank, getRatingRank, getCotdDayById } from '../db';
import { getNextRankGoal, getPlayerTier } from '../services/rankService';
import { getUncertaintyCategory } from '../services/ratingPresentation';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export const data = new SlashCommandBuilder()
  .setName('playerrating')
  .setDescription("Gets user's Glicko-2 rating from COTD Qualifying.")
  .addStringOption(o => o.setName('username').setDescription('Exact Trackmania username.').setRequired(true));

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const username = interaction.options.getString('username', true);

  const accountId = await findAccountIdByUsername(username);
  if (!accountId) {
    await interaction.editReply(`No exact match for **${username}** — check spelling/casing.`);
    return;
  }

  const state = await getPlayerRatingState(accountId, 'qualifying');
  if (state.lastProcessedCupId === null) {
    await interaction.editReply(`**${username}** hasn't appeared in any processed COTD data yet.`);
    return;
  }

  const [rankResult, lastCup] = await Promise.all([
    getRatingRank('qualifying', state.accountId, state.rating),
    state.lastProcessedCupId === null ? Promise.resolve(null) : getCotdDayById(state.lastProcessedCupId),
  ]);
  const { rank, total } = rankResult;
  const tierInfo = await getPlayerTier(state.rating, rank, total);
  const nextGoal = getNextRankGoal(rank, total, tierInfo);
  const nextGoalState = nextGoal
    ? await getPlayerRatingStateByRank('qualifying', nextGoal.rank)
    : null;
  if (nextGoal && !nextGoalState) {
    throw new Error(`Could not load the player at next-goal leaderboard position ${nextGoal.rank}.`);
  }

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
      value: `**${nextGoal.name}**\nRating: ${Math.round(nextGoalState.state.rating)} (${nextGoalState.state.rating >= state.rating ? '+' : ''}${(nextGoalState.state.rating - state.rating).toFixed(1)} to go)`,
      inline: false,
    }
    : null;

  const embed = new EmbedBuilder()
    .setColor(tierInfo.rank.tierColor)
    .setTitle(`${username} Rating Info`)
    .addFields(
      {
        name: 'Competitive Rank',
        value: `**${tierInfo.fullName}** (Top ${tierInfo.topPercentage}%)`,
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
        value: `${Math.round(state.peakRating)}`,
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