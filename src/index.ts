import { Client, GatewayIntentBits, Collection, Events, MessageFlags, REST, Routes } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startWebServer } from './services/webServer';

interface Command {
  data: { name: string; toJSON(): unknown }; // loose on purpose — matches any SlashCommandBuilder variant
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const commands = new Collection<string, Command>();
const serverPort = Number(process.env.SERVER_PORT ?? 3000);
if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
  throw new Error('SERVER_PORT must be an integer between 1 and 65535.');
}
startWebServer(serverPort);

// --- Process-level safety nets (from the freeze/logging fix earlier) ---
process.on('unhandledRejection', (reason) => {
  console.error(`[${new Date().toISOString()}] UNHANDLED REJECTION:`, reason);
});
process.on('uncaughtException', (err) => {
  console.error(`[${new Date().toISOString()}] UNCAUGHT EXCEPTION:`, err);
});

// --- Load every command module from src/commands/ ---
const commandsPath = join(import.meta.dir, 'commands');
const commandFiles = readdirSync(commandsPath).filter(f => f.endsWith('.ts'));

for (const file of commandFiles) {
  const filePath = join(commandsPath, file);
  // pathToFileURL matters on Windows specifically — a bare absolute path
  // (C:\...) can fail dynamic import() under strict ESM; the file:// form is safe cross-platform.
  const commandModule = (await import(pathToFileURL(filePath).href)) as Command;

  if ('data' in commandModule && 'execute' in commandModule) {
    commands.set(commandModule.data.name, commandModule);
  } else {
    console.warn(`[commands] ${file} is missing "data" or "execute" — skipped`);
  }
}

// --- Register slash commands with Discord ---
async function registerCommands() {
  const token = process.env.DISCORD_BOT_TOKEN!;
  const clientId = process.env.DISCORD_BOT_CLIENT_ID!;
  const configuredGuildIds = process.env.DISCORD_GUILD_IDS ?? process.env.DISCORD_GUILD_ID;
  const guildIds = configuredGuildIds
    ?.split(',')
    .map(guildId => guildId.trim())
    .filter(Boolean);

  const rest = new REST().setToken(token);
  const body = commands.map(c => c.data.toJSON());

  try {
    if (guildIds?.length) {
      if (guildIds.some(guildId => !/^\d+$/.test(guildId))) {
        throw new Error('DISCORD_GUILD_IDS must contain comma-separated numeric guild IDs.');
      }

      const uniqueGuildIds = [...new Set(guildIds)];
      const results = await Promise.allSettled(
        uniqueGuildIds.map(guildId =>
          rest.put(Routes.applicationGuildCommands(clientId, guildId), { body })
        )
      );
      results.forEach((result, index) => {
        const guildId = uniqueGuildIds[index];
        if (result.status === 'fulfilled') {
          console.log(`[commands] registered ${body.length} command(s) to guild ${guildId}`);
        } else {
          console.error(`[commands] registration failed for guild ${guildId}:`, result.reason);
        }
      });
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body });
      console.log(`[commands] registered ${body.length} command(s) globally (can take up to 1hr to propagate)`);
    }
  } catch (error) {
    console.error('[commands] registration failed:', error);
  }
}

// --- Event handlers ---
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[bot] logged in as ${readyClient.user.tag}`);
  await registerCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) {
    console.warn(`[bot] no handler for command "${interaction.commandName}"`);
    return;
  }

  const guild = interaction.guild;
  console.log(
    `[command] /${interaction.commandName} by ${interaction.user.tag} (${interaction.user.id})`
      + (guild ? ` in ${guild.name} (${guild.id})` : ' in a DM')
  );

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`[bot] error executing "${interaction.commandName}":`, error);

    try {
      if (interaction.deferred || interaction.replied) {
        // Ephemeral can only be set on the *first* reply/defer, not retroactively —
        // every current command defers non-ephemerally, so this just edits that reply.
        await interaction.editReply({ content: 'Something went wrong running that command.' });
      } else {
        await interaction.reply({ content: 'Something went wrong running that command.', flags: MessageFlags.Ephemeral });
      }
    } catch (replyError) {
      // Covers the "Unknown interaction" (code 10062) case from before — the
      // interaction already expired. Nothing more to do besides log it.
      console.error(`[bot] failed to send error reply for "${interaction.commandName}":`, replyError);
    }
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);