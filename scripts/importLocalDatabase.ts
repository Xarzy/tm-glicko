import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type InValue } from '@libsql/client';

const TABLES = [
  {
    name: 'player_rating_state',
    columns: [
      'account_id', 'mode', 'rating', 'rd', 'vol', 'match_count', 'peak_rating',
      'previous_rating', 'last_processed_cup_id', 'last_rated_at', 'last_fetched_at', 'updated_at',
    ],
  },
  {
    name: 'player_rating_history',
    columns: [
      'id', 'account_id', 'cup_id', 'cotd_date', 'mode', 'rating', 'rd', 'rank', 'is_flagged',
    ],
  },
] as const;

const BATCH_SIZE = 1000;
const PROGRESS_FILE = resolve('.db-import-progress.json');
const args = new Set(process.argv.slice(2));
const resume = args.has('--resume');
const dryRun = args.has('--dry-run');

if (process.argv.slice(2).some(arg => !['--resume', '--dry-run'].includes(arg))) {
  throw new Error('Usage: bun run scripts/importLocalDatabase.ts [--dry-run] [--resume]');
}

const hostedUrl = process.env.LIBSQL_URL || '';
if (!hostedUrl) {
  throw new Error('Set LIBSQL_URL to the hosted LibSQL database before importing.');
}
if (!/^(libsql|https?):\/\//i.test(hostedUrl)) {
  throw new Error('LIBSQL_URL must use the libsql://, https://, or http:// protocol.');
}

const sourcePath = (process.env.DB_FILE_NAME || 'local.db').replace(/^file:/, '');
if (!existsSync(sourcePath)) {
  throw new Error(`Local database file not found: ${sourcePath}`);
}

interface ImportProgress {
  tableIndex: number;
  lastRowId: number;
}

function saveProgress(progress: ImportProgress): void {
  const temporaryPath = `${PROGRESS_FILE}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(progress));
  renameSync(temporaryPath, PROGRESS_FILE);
}

function readProgress(): ImportProgress {
  if (!existsSync(PROGRESS_FILE)) {
    throw new Error('No import checkpoint found. Start a new import without --resume.');
  }
  const progress = JSON.parse(readFileSync(PROGRESS_FILE, 'utf8')) as ImportProgress;
  if (
    !Number.isInteger(progress.tableIndex)
    || progress.tableIndex < 0
    || progress.tableIndex > TABLES.length
    || !Number.isSafeInteger(progress.lastRowId)
    || progress.lastRowId < 0
  ) {
    throw new Error('Import checkpoint is invalid. Do not delete it until the import is complete.');
  }
  return progress;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function rowValue(value: unknown, tableName: string, column: string): InValue {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'bigint'
    || typeof value === 'boolean'
    || value instanceof Uint8Array
    || value instanceof ArrayBuffer
    || value instanceof Date
  ) {
    return value;
  }
  throw new Error(`Unsupported value type in ${tableName}.${column}.`);
}

async function tableNames(client: ReturnType<typeof createClient>): Promise<Set<string>> {
  const result = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  return new Set(result.rows.map(row => String(row.name)));
}

async function tableCount(
  client: ReturnType<typeof createClient>,
  tableName: string,
): Promise<number> {
  const result = await client.execute(`SELECT count(*) AS count FROM ${quoteIdentifier(tableName)}`);
  const count = Number(result.rows[0]?.count);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Could not read a valid row count for ${tableName}.`);
  }
  return count;
}

async function main(): Promise<void> {
  const authToken = process.env.LIBSQL_AUTH_TOKEN || process.env.LIBSQL_TOKEN;
  const source = createClient({ url: `file:${sourcePath}` });
  const destination = createClient({
    url: hostedUrl,
    ...(authToken ? { authToken } : {}),
  });

  try {
    await source.execute('PRAGMA query_only = ON');
    const [sourceTables, destinationTables] = await Promise.all([
      tableNames(source),
      tableNames(destination),
    ]);

    for (const table of TABLES) {
      if (!sourceTables.has(table.name)) {
        throw new Error(`Local database is missing expected table "${table.name}".`);
      }
      if (!destinationTables.has(table.name)) {
        throw new Error(`Hosted database is missing "${table.name}". Apply its schema migration first.`);
      }
    }

    const sourceCounts = new Map<string, number>();
    const destinationCounts = new Map<string, number>();
    for (const table of TABLES) {
      sourceCounts.set(table.name, await tableCount(source, table.name));
      destinationCounts.set(table.name, await tableCount(destination, table.name));
    }

    console.log('Rows to import (local -> hosted):');
    for (const table of TABLES) {
      console.log(
        `  ${table.name}: ${sourceCounts.get(table.name)} -> ${destinationCounts.get(table.name)}`,
      );
    }

    if (dryRun) {
      console.log('Dry run only; no rows were written.');
      return;
    }

    let progress: ImportProgress;
    if (resume) {
      progress = readProgress();
    } else {
      const populated = TABLES.filter(table => destinationCounts.get(table.name) !== 0);
      if (populated.length > 0) {
        throw new Error(
          `Hosted tables are not empty (${populated.map(table => table.name).join(', ')}). `
          + 'Use --resume only to continue an import started by this script.',
        );
      }
      if (existsSync(PROGRESS_FILE)) {
        throw new Error(`An import checkpoint already exists at ${PROGRESS_FILE}. Use --resume.`);
      }
      progress = { tableIndex: 0, lastRowId: 0 };
      saveProgress(progress);
    }

    for (let tableIndex = progress.tableIndex; tableIndex < TABLES.length; tableIndex++) {
      const table = TABLES[tableIndex];
      let lastRowId = tableIndex === progress.tableIndex ? progress.lastRowId : 0;
      let insertedRows = 0;

      console.log(`Importing ${table.name}...`);
      while (true) {
        const rows = await source.execute({
          sql: `SELECT rowid AS "__import_rowid", ${table.columns.map(quoteIdentifier).join(', ')}`
            + ` FROM ${quoteIdentifier(table.name)}`
            + ' WHERE rowid > ? ORDER BY rowid LIMIT ?',
          args: [lastRowId, BATCH_SIZE],
        });
        if (rows.rows.length === 0) break;

        const placeholders = `(${table.columns.map(() => '?').join(', ')})`;
        const values = rows.rows.flatMap(row =>
          table.columns.map(column => rowValue(row[column], table.name, column)),
        );
        const sql = `INSERT OR IGNORE INTO ${quoteIdentifier(table.name)} `
          + `(${table.columns.map(quoteIdentifier).join(', ')}) VALUES `
          + Array.from({ length: rows.rows.length }, () => placeholders).join(', ');
        const result = await destination.execute({ sql, args: values });

        const nextRowId = Number(rows.rows[rows.rows.length - 1].__import_rowid);
        if (!Number.isSafeInteger(nextRowId) || nextRowId <= lastRowId) {
          throw new Error(`Invalid source cursor while importing ${table.name}.`);
        }
        lastRowId = nextRowId;
        insertedRows += Number(result.rowsAffected);
        saveProgress({ tableIndex, lastRowId });

        if (insertedRows > 0 && insertedRows % 10_000 < BATCH_SIZE) {
          console.log(`  ${table.name}: ${insertedRows} new rows written`);
        }
      }

      console.log(`  ${table.name}: complete (${insertedRows} new rows written)`);
      progress = { tableIndex: tableIndex + 1, lastRowId: 0 };
      saveProgress(progress);
    }

    console.log('Verifying row counts...');
    for (const table of TABLES) {
      const sourceCount = sourceCounts.get(table.name);
      const destinationCount = await tableCount(destination, table.name);
      if (sourceCount !== destinationCount) {
        throw new Error(
          `Row-count mismatch for ${table.name}: local=${sourceCount}, hosted=${destinationCount}. `
          + 'The checkpoint was kept; inspect the target before resuming.',
        );
      }
      console.log(`  ${table.name}: ${destinationCount} rows verified`);
    }

    console.log('Import and row-count verification completed.');
  } finally {
    source.close();
    destination.close();
  }
}

main().catch(error => {
  console.error('[import] Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
