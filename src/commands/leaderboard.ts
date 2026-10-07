import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, escapeMarkdown } from 'discord.js';
import { getPlayerRatingStateByRank } from '../db';
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

  const rows: Array<{ rank: number; state: any }> = [];
  // Fetch only the requested ranks.
  for (let r = from; r <= to; r++) {
    const result = await getPlayerRatingStateByRank(mode, r);
    if (!result) break;
    rows.push({ rank: r, state: result.state });
  }

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

  embed.addFields({ name: `Players (${rows.length})`, value: fieldLines.join('\n'), inline: false });

  await interaction.editReply({ embeds: [embed] });
}
