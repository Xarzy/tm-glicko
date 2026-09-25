import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { findAccountIdByUsername } from '../services/accountLookup';
import { getPlayerRatingState, getRatingRank, getCotdDayById } from '../db';

export const data = new SlashCommandBuilder()
  .setName('playerrating')
  .setDescription("Gets user's Glicko-2 rating from COTD Qualifying.")
  .addStringOption(o => o.setName('username').setDescription('Exact Trackmania username.').setRequired(true));

function getUncertaintyCategory(rd: number): string {
  if (rd < 100) return 'very low'
  if (rd < 130) return 'low'
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

  const { rank } = await getRatingRank('qualifying', state.rating);
  const ratingChange =
    state.previousRating !== null
      ? state.rating - state.previousRating
      : null;

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
    .setColor(0x00ff00)
    .setTitle(`${username} Rating Info`)
    .addFields(
      {
        name: 'Glicko-2 Rating',
        value: `${Math.round(state.rating)}`,
        inline: true,
      },
      {
        name: 'Rank',
        value: `${rank}`,
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
        inline: false,
      }
    );

  await interaction.editReply({ embeds: [embed] });
}