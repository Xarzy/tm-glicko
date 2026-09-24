import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { findAccountIdByUsername } from '../services/accountLookup';
import { getPlayerRatingState, getRatingRank } from '../db';

export const data = new SlashCommandBuilder()
  .setName('playerrating')
  .setDescription("Gets user's Glicko-2 rating from qualifying or cup matches.")
  .addStringOption(o => o.setName('username').setDescription('Exact Trackmania username.').setRequired(true))
  .addStringOption(o => o.setName('mode').setDescription('The mode to get the rating for.').setRequired(true)
    .addChoices({ name: 'Qualifying', value: 'qualifying' }, { name: 'Cup', value: 'cup' }));

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const username = interaction.options.getString('username', true);
  const mode = interaction.options.getString('mode', true);

  const accountId = await findAccountIdByUsername(username);
  if (!accountId) {
    await interaction.editReply(`No exact match for **${username}** — check spelling/casing.`);
    return;
  }
  if (mode === 'cup') {
    await interaction.editReply("Cup rating isn't implemented yet — only qualifying is live.");
    return;
  }

  const state = await getPlayerRatingState(accountId, 'qualifying');
  if (state.lastProcessedCupId === null) {
    await interaction.editReply(`**${username}** hasn't appeared in any processed COTD data yet.`);
    return;
  }

  const { rank, total } = await getRatingRank('qualifying', state.rating);
  await interaction.editReply(
    `**${username}** — Qualifying\n` +
    `Glicko-2 Rating: ${Math.round(state.rating)}\n` +
    `Rank: #${rank} of ${total}\n` +
    `Match Count: ${state.matchCount}\n` +
    `Latest Change: ${state.previousRating !== null ? Math.round(state.rating - state.previousRating) : 'n/a'}\n` +
    `Peak Rating: ${Math.round(state.peakRating)}`
  );
}