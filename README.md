<h1 align="center">
  TM Glicko
</h1>
<p align="center">
    <a href="https://github.com/Xarzy/tm-glicko/actions/workflows/ci.yml/badge.svg" alt="CI Status">
        <img src="https://github.com/Xarzy/tm-glicko/actions/workflows/ci.yml/badge.svg" /></a>
    <a href="https://hits.dwyl.com/Xarzy/tm-glicko" alt="Repo Hits">
        <img src="https://hits.dwyl.com/Xarzy/tm-glicko.svg" /></a>
</p>

TM Glicko is a Discord bot for Trackmania COTD ratings using a Glicko-2 style rating system. It ingests Cup of the Day data from Nadeo/Trackmania services, tracks leaderboard results, recalculates player ratings, and exposes rating lookups through Discord slash commands.

## Features

- Trackmania account lookup by username
- COTD qualifying leaderboard ingestion
- Glicko-2 rating calculations and history tracking
- Discord slash commands for rating, rank, and chart queries
- Competitive ranking after at least 10 completed COTDs
- SQLite persistence with Drizzle ORM
- Daily automated ingestion/update jobs
- Rating tier and percentile presentation for Discord embeds

Players become eligible for competitive ranks and leaderboard placement after
completing 10 COTDs. Until then, their rating stats are unavailable; leaderboard
ranks and top-percent calculations include only eligible players. Peak rating
tracks ratings from the player's 10th completed COTD onward.

## Project structure

- `src/index.ts` — bot bootstrap and slash command registration
- `src/commands/` — Discord slash commands
- `src/services/` — Trackmania auth, ingestion, rating math, presentation logic
- `src/services/website/` — website layout, page rendering, legal pages, and routes
- `src/db/` — SQLite schema and database access helpers
- `src/jobs/` — scheduled update tasks
- `scripts/` — maintenance tasks such as recalculation and data backfills
- `tests/` — rating logic tests

## Tech stack

- Bun
- TypeScript
- Discord.js
- Hono for website routing
- Escaped HTML templates for server-rendered pages
- Tailwind CSS
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
DISCORD_GUILD_IDS=optional_test_guild_id,another_test_guild_id
DB_FILE_NAME=local.db
# Optional: set these to use a hosted LibSQL database instead of local SQLite.
LIBSQL_URL=
LIBSQL_AUTH_TOKEN=
TRACKMANIA_OAUTH_CLIENT_ID=your_trackmania_oauth_client_id
TRACKMANIA_OAUTH_CLIENT_SECRET=your_trackmania_oauth_client_secret
NADEO_SERVER_LOGIN=your_nadeo_login
NADEO_SERVER_PASSWORD=your_nadeo_password
```

`DISCORD_GUILD_IDS` is optional and accepts comma-separated guild IDs for
instant command registration in multiple servers. `DISCORD_GUILD_ID` remains
supported for existing single-server configurations. If neither is set,
commands are registered globally.

3. Start the bot:

```bash
bun run start
```

The start command builds the Tailwind stylesheet before launching the Bun app.
The website uses Hono routes and escaped HTML templates. Internal navigation
and searches display animated skeleton loaders while pages load, with
reduced-motion preferences respected.

The app serves the public website and JSON health check at `/health`. It listens
on `SERVER_PORT` and binds to `0.0.0.0` for hosting platform proxies; when
running locally without `SERVER_PORT`, it uses port `3000`.

## Automation

GitHub Actions runs the test suite and TypeScript type-check on pushes and pull
requests. Dependabot checks weekly for Bun dependency and GitHub Actions
updates.

On a Linux host with Bash, GNU `date`, and Bun installed, start the daily
19:30 Europe/Paris update scheduler from the project root:

```bash
bash scripts/schedule-daily-update.sh start
```

The scheduler runs in the background and writes job output and run status to
`logs/daily-update.log`. Europe/Berlin time automatically follows CET/CEST
daylight-saving changes. Stop it with:

```bash
bash scripts/schedule-daily-update.sh stop
```

## Commands

The bot registers slash commands from `src/commands/`:

- `playerrating` — lookup a player's COTD qualifying rating by username or leaderboard rank
- `playerrank` — compatibility alias for rank-based `/playerrating`
- `playercard` — show a compact player card by username or leaderboard rank
- `graphrating` — generate a rating history graph for one or more players

## Website

- `/` and `/leaderboard` — browse the eligible-player leaderboard by page, filter by competitive rank, or find an exact Trackmania username
- `/players/:accountId` — shareable player profile with rank, rating, COTD division estimate, eligible-era peak, recent placements, and rating history
- `/cotd` — browse recent processed COTDs
- `/cotd/:cupId` — view the top 100 available placements for a COTD
- `/terms` — Terms of Service
- `/privacy` — Privacy Policy
- `/health` — JSON health check for hosting platforms

Only players with at least 10 completed COTDs appear as ranked players. The
leaderboard and COTD player names use Trackmania's display-name API when OAuth
credentials are configured; otherwise account IDs are shown.

## Data flow

1. Daily jobs discover new COTD entries and pending competitions.
2. Leaderboards are fetched from Trackmania/Nadeo endpoints.
3. Player results are processed with the Glicko-2 update logic.
4. Rating state and history are stored in SQLite.
5. Discord commands read from that database and render formatted results.

Database operations automatically retry up to five times after the initial
attempt, using exponential backoff; the final failure is logged and rethrown.

## Rating model

Qualifying is rated as one calibrated Glicko-2 tournament period. The
leaderboard is represented by rank-quantile opponents covering the whole field,
with continuous placement outcomes: finishing ahead is always at least a draw,
and finishing behind is always at most a draw. This avoids discontinuities from
treating adjacent placements as a near-loss while keeping opponent rating and
uncertainty relevant to every update.

Leaderboard rank, percentile tier, and graph rank-zone cutoffs are ordered by
raw rating, highest first. Players with identical ratings are ordered by account
ID. Commands display the raw rating and RD separately; RD expands when a player
returns after inactivity, then decreases again when informative results are
recorded.

## Useful maintenance scripts

- Evaluate the calibrated model against stored leaderboards without writing to the database:

```bash
bun run scripts/evaluateRatingCalibration.ts
```

- Recalculate all qualifying ratings from stored leaderboard history:

```bash
bun run scripts/recalculateRatings.ts
```

If recalculation stops unexpectedly, continue from its last saved batch with:

```bash
bun run scripts/recalculateRatings.ts --resume
```

The script checkpoints to `.rating-recalculation-progress.json` after each
committed batch. Keep that file until recalculation finishes; starting without
`--resume` while it exists is refused to avoid discarding progress.

- Backfill historical data:

```bash
bun run scripts/backfill.ts
```

- Fetch leaderboard snapshots:

```bash
bun run scripts/fetchLeaderboards.ts
```

## Database

The schema is defined in `src/db/schema.ts` and managed with Drizzle. By
default, the app uses a local SQLite file (`DB_FILE_NAME`, defaulting to
`local.db`). To use a hosted LibSQL-compatible database, set `LIBSQL_URL` to
its `libsql://` or HTTPS endpoint and `LIBSQL_AUTH_TOKEN` if the provider
requires one (`LIBSQL_TOKEN` is also accepted). When `LIBSQL_URL` is set, the
local database file is not used.
PostgreSQL connection strings are not accepted by the LibSQL client.

To initialize an empty hosted database, set `LIBSQL_URL` (and the auth token if
required), then run `bunx drizzle-kit migrate`. This creates the schema; it
does not copy data from the local SQLite file. Do not run the initial migration
against an existing database that already has these tables.

To copy an existing local database, stop the bot, back up `local.db`, and
ensure the hosted tables are empty. Preview the row counts with
`bun run scripts/importLocalDatabase.ts --dry-run`, then import with
`bun run scripts/importLocalDatabase.ts`. The import copies rows in batches,
preserves primary keys, and verifies destination row counts. If it is
interrupted, rerun with `--resume`; keep `.db-import-progress.json` until the
import and verification both complete. The importer will not overwrite
existing destination rows or start a new import into populated tables.

Existing rating history may also need recalculation after rating-model changes;
run `bun run scripts/recalculateRatings.ts` when needed.

## Notes

This project is tailored for Trackmania COTD rating tracking and is designed to run as a background Discord service. It expects valid credentials and a working data ingestion pipeline to populate ratings.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
