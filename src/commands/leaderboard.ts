import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, escapeMarkdown } from 'discord.js';
import { getPlayerRatingStatesByRankRange } from '../db';
import { findUsernamesByAccountIds } from '../services/accountLookup';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Shows a Glicko leaderboard range.')
  .addIntegerOption(o =>
    o.setName('from').setDescription('Start rank (inclusive).').setRequired(true).setMinValue(1)
  )
  .addIntegerOption(o =>
    o.setName('to').setDescription('End rank (inclusive).').setRequired(true).setMinValue(1)
  );

function formatSigned(n: number): string {
  return n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
}

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();

  const from = interaction.options.getInteger('from', true);
  const to = interaction.options.getInteger('to', true);

  if (to < from) {
    await interaction.editReply('Invalid range: **to** must be >= **from**.');
    return;
  }

  const maxPlayers = 50;
  const requested = to - from + 1;
  if (requested > maxPlayers) {
    await interaction.editReply(`Range too large: please request at most **${maxPlayers}** players.`);
    return;
  }

  const mode = 'qualifying' as const;

  const { states } = await getPlayerRatingStatesByRankRange(mode, from, requested);
  const rows = states.map((state, index) => ({ rank: from + index, state }));

  if (rows.length === 0) {
    await interaction.editReply(`No players found for ranks **#${from}–#${to}**.`);
    return;
  }

  // Resolve account IDs -> Trackmania display names for display in the embed.
  const accountIds = rows.map(r => r.state.accountId).filter(Boolean);
  const usernameMap = await findUsernamesByAccountIds(accountIds);

  const firstRank = rows[0].rank;
  const lastRank = rows[rows.length - 1].rank;
  const embed = new EmbedBuilder()
    .setTitle(`Glicko Leaderboard — #${firstRank}-#${lastRank}`)
    .setColor(0x00f5d4);

  // Build a compact list: Rank. Name — Rating (Δ)
  // We only have accountId here; name resolution isn't implemented in this command yet.
  // We'll display accountId until you add a username lookup helper.
  const fieldLines = rows.map(({ rank, state }) => {
    const delta = state.previousRating !== null ? state.rating - state.previousRating : null;
    const deltaStr = delta === null ? 'Δ n/a' : `Δ ${formatSigned(delta)}`;
    const username = escapeMarkdown(usernameMap.get(state.accountId) ?? state.accountId);
    return `#${rank} — ${username} — ${Math.round(state.rating)} (${deltaStr})`;
  });

  const fields: { name: string; value: string; inline: false }[] = [];
  let currentLines: string[] = [];
  let currentLength = 0;
  for (const line of fieldLines) {
    const nextLength = currentLength + (currentLines.length > 0 ? 1 : 0) + line.length;
    if (nextLength > 1024) {
      fields.push({
        name: fields.length === 0 ? `Players (${rows.length})` : 'Players (continued)',
        value: currentLines.join('\n'),
        inline: false,
      });
      currentLines = [];
      currentLength = 0;
    }
    currentLines.push(line);
    currentLength += (currentLines.length > 1 ? 1 : 0) + line.length;
  }
  if (currentLines.length > 0) {
    fields.push({
      name: fields.length === 0 ? `Players (${rows.length})` : 'Players (continued)',
      value: currentLines.join('\n'),
      inline: false,
    });
  }
  embed.addFields(fields);

  await interaction.editReply({ embeds: [embed] });
}
