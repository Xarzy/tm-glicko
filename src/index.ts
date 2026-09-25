import { Client, GatewayIntentBits, Collection, Events, MessageFlags, REST, Routes } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

interface Command {
  data: { name: string; toJSON(): unknown }; // loose on purpose — matches any SlashCommandBuilder variant
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const commands = new Collection<string, Command>();

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
  const guildId = process.env.DISCORD_GUILD_ID; // optional — set during dev for instant registration to one server

  const rest = new REST().setToken(token);
  const body = commands.map(c => c.data.toJSON());

  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
      console.log(`[commands] registered ${body.length} command(s) to guild ${guildId}`);
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