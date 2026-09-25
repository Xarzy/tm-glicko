import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { findUsernameByAccountId } from '../services/accountLookup';
import { getPlayerRatingStateByRank, getCotdDayById } from '../db';
import { getPlayerTier } from '../services/rankService';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export const data = new SlashCommandBuilder()
  .setName('playerrank')
  .setDescription("Gets player's Glicko-2 rating info by their leaderboard rank.")
  .addIntegerOption(o =>
    o
      .setName('rank')
      .setDescription('The rank position on the leaderboard (e.g. 1, 2, 10).')
      .setRequired(true)
      .setMinValue(1)
  );

function getUncertaintyCategory(rd: number): string {
  if (rd < 100) return 'very low';
  if (rd < 130) return 'low';
  if (rd < 150) return 'low-moderate';
  if (rd < 175) return 'moderate';
  if (rd < 200) return 'moderate-high';
  if (rd < 225) return 'high';
  if (rd < 250) return 'very high';
  return 'extremely high';
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const rank = interaction.options.getInteger('rank', true);

  const result = await getPlayerRatingStateByRank('qualifying', rank);
  if (!result) {
    await interaction.editReply(`No player found at rank **#${rank}**.`);
    return;
  }

  const { state, total } = result;

  // Resolve player username from account ID
  const username = (await findUsernameByAccountId(state.accountId)) ?? state.accountId;
  const tierInfo = await getPlayerTier(state.rating, rank, total);

  const ratingChange =
    state.previousRating !== null ? state.rating - state.previousRating : null;

  let changeDateStr = '';
  if (state.lastProcessedCupId !== null) {
    const lastCup = await getCotdDayById(state.lastProcessedCupId);
    if (lastCup?.startDate) {
      changeDateStr = ` on ${formatDate(new Date(lastCup.startDate))}`;
    }
  }

  const formattedLatestChange =
    ratingChange !== null
      ? `${ratingChange >= 0 ? '+' : ''}${ratingChange.toFixed(1)}${changeDateStr}`
      : 'n/a';

  const uncertaintyDesc = `${getUncertaintyCategory(state.rd)} ( ${Math.round(state.rd)} )`;

  const embed = new EmbedBuilder()
    .setColor(tierInfo.rank.tierColor)
    .setTitle(`Rank ${rank} (${username}) Rating Info`)
    .addFields(
      {
        name: 'Competitive Rank',
        value: `**${tierInfo.fullName}** (Top ${tierInfo.topPercentage}%)`,
        inline: false,
      },
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
