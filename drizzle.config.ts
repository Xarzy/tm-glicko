import { defineConfig } from 'drizzle-kit';

const libsqlUrl = process.env.LIBSQL_URL;
const authToken = process.env.LIBSQL_AUTH_TOKEN || process.env.LIBSQL_TOKEN;

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: libsqlUrl ? 'turso' : 'sqlite',
  dbCredentials: {
    url: libsqlUrl || process.env.DB_FILE_NAME || 'local.db',
    ...(libsqlUrl && authToken ? { authToken } : {}),
  },
});
