# TM Glicko

TM Glicko is a Discord bot for Trackmania COTD ratings using a Glicko-2 style rating system. It ingests Cup of the Day data from Nadeo/Trackmania services, tracks leaderboard results, recalculates player ratings, and exposes rating lookups through Discord slash commands.

## Features

- Trackmania account lookup by username
- COTD qualifying leaderboard ingestion
- Glicko-2 rating calculations and history tracking
- Discord slash commands for rating, rank, and chart queries
- SQLite persistence with Drizzle ORM
- Daily automated ingestion/update jobs
- Rating tier and percentile presentation for Discord embeds

## Project structure

- `src/index.ts` — bot bootstrap and slash command registration
- `src/commands/` — Discord slash commands
- `src/services/` — Trackmania auth, ingestion, rating math, presentation logic
- `src/db/` — SQLite schema and database access helpers
- `src/jobs/` — scheduled update tasks
- `scripts/` — maintenance tasks such as recalculation and data backfills
- `tests/` — rating logic tests

## Tech stack

- Bun
- TypeScript
- Discord.js
- Drizzle ORM
- SQLite
- Glicko-2 library

## Prerequisites

- Node/Bun installed
- A Discord bot token
- Trackmania OAuth credentials
- Nadeo authentication credentials for server-side leaderboard access
- A SQLite database file path or local DB file

## Installation

1. Install dependencies:

```bash
bun install
```

2. Create a `.env` file in the project root with the required variables:

```env
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_BOT_CLIENT_ID=your_discord_application_id
DISCORD_GUILD_ID=optional_test_guild_id
DB_FILE_NAME=local.db
TRACKMANIA_OAUTH_CLIENT_ID=your_trackmania_oauth_client_id
TRACKMANIA_OAUTH_CLIENT_SECRET=your_trackmania_oauth_client_secret
NADEO_SERVER_LOGIN=your_nadeo_login
NADEO_SERVER_PASSWORD=your_nadeo_password
```

3. Start the bot:

```bash
bun run src/index.ts
```

## Commands

The bot registers slash commands from `src/commands/`:

- `playerrating` — lookup a player's COTD qualifying rating
- `playerrank` — lookup a player's rating by leaderboard rank
- `graphrating` — generate a rating history graph for one or more players

## Data flow

1. Daily jobs discover new COTD entries and pending competitions.
2. Leaderboards are fetched from Trackmania/Nadeo endpoints.
3. Player results are processed with the Glicko-2 update logic.
4. Rating state and history are stored in SQLite.
5. Discord commands read from that database and render formatted results.

## Useful maintenance scripts

- Recalculate all qualifying ratings from stored leaderboard history:

```bash
bun run scripts/recalculateRatings.ts
```

- Backfill historical data:

```bash
bun run scripts/backfill.ts
```

- Fetch leaderboard snapshots:

```bash
bun run scripts/fetchLeaderboards.ts
```

## Database

The schema is defined in `src/db/schema.ts` and managed with Drizzle. The default database connection uses `DB_FILE_NAME` and falls back to `local.db` when unset.

## Notes

This project is tailored for Trackmania COTD rating tracking and is designed to run as a background Discord service. It expects valid credentials and a working data ingestion pipeline to populate ratings.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
