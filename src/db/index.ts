import fs from 'fs';
import path from 'path';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
  var _postgresPoolKey: string | undefined;
  var _postgresSchemaReady: boolean | undefined;
}

const RUNTIME_DB_URL_PATHS = [
  path.resolve(process.cwd(), '.folio-db-url.txt'),
  '/tmp/folio-db-url.txt',
];

let runtimeDatabaseUrl = '';

function loadSavedRuntimeDbUrl(): string {
  if (runtimeDatabaseUrl) return runtimeDatabaseUrl;
  for (const p of RUNTIME_DB_URL_PATHS) {
    try {
      if (fs.existsSync(p)) {
        const val = fs.readFileSync(p, 'utf-8').trim();
        if (val.startsWith('postgres://') || val.startsWith('postgresql://')) {
          runtimeDatabaseUrl = val;
          return val;
        }
      }
    } catch {
      // ignore
    }
  }
  return '';
}

export function setRuntimeDatabaseUrl(rawUrl?: string): void {
  const clean = String(rawUrl || '').trim();
  if (!clean.startsWith('postgres://') && !clean.startsWith('postgresql://')) {
    return;
  }
  if (clean === runtimeDatabaseUrl) return;
  runtimeDatabaseUrl = clean;
  for (const p of RUNTIME_DB_URL_PATHS) {
    try {
      fs.writeFileSync(p, clean, 'utf-8');
      break;
    } catch {
      // ignore
    }
  }
}

export function getConfiguredConnectionString(): string {
  const fromRuntime = loadSavedRuntimeDbUrl();
  if (fromRuntime) return fromRuntime;
  const fromEnv =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.NEON_DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    '';
  return fromEnv.trim();
}

export const isSqlConfigured = (): boolean => {
  if (getConfiguredConnectionString()) return true;
  return Boolean(
    process.env.SQL_HOST &&
      process.env.SQL_USER &&
      process.env.SQL_DB_NAME
  );
};

export const createPool = (): Pool => {
  const connStr = getConfiguredConnectionString();
  const desiredKey = connStr
    ? `url:${connStr}`
    : `host:${process.env.SQL_HOST || ''}:${process.env.SQL_DB_NAME || ''}`;

  if (!global._postgresPool || global._postgresPoolKey !== desiredKey) {
    if (global._postgresPool) {
      global._postgresPool.end().catch(() => {});
    }
    global._postgresSchemaReady = false;
    global._postgresPoolKey = desiredKey;

    if (connStr) {
      const needsSsl =
        !connStr.includes('localhost') &&
        !connStr.includes('127.0.0.1') &&
        (connStr.includes('sslmode=') ||
          connStr.includes('neon.tech') ||
          connStr.includes('supabase.') ||
          connStr.includes('vercel-storage.com') ||
          connStr.includes('railway.') ||
          connStr.includes('render.com') ||
          connStr.includes('amazonaws.com'));

      global._postgresPool = new Pool({
        connectionString: connStr,
        ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
        max: 10,
        connectionTimeoutMillis: 4000,
        idleTimeoutMillis: 10000,
      });
    } else {
      global._postgresPool = new Pool({
        host: process.env.SQL_HOST,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
        max: 10,
        connectionTimeoutMillis: 2500,
        idleTimeoutMillis: 10000,
      });
    }

    global._postgresPool.on('error', err => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

export function getDb(): NodePgDatabase<typeof schema> {
  return drizzle(createPool(), { schema });
}

export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const active = getDb();
    const val = Reflect.get(active as object, prop, receiver);
    return typeof val === 'function' ? val.bind(active) : val;
  },
});

export async function ensureSqlSchemaInitialized(): Promise<void> {
  if (global._postgresSchemaReady) return;
  const activePool = createPool();
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      uid TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT 'Reader',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sql_books (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      book_key TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      current_page INTEGER NOT NULL DEFAULT 1,
      total_pages INTEGER NOT NULL DEFAULT 1,
      bookmark_count INTEGER NOT NULL DEFAULT 0,
      highlight_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sql_notes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      note_key TEXT NOT NULL,
      book_key TEXT NOT NULL,
      book_title TEXT NOT NULL,
      page INTEGER NOT NULL DEFAULT 1,
      note_text TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sql_vocabulary (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      word TEXT NOT NULL,
      part_of_speech TEXT NOT NULL DEFAULT '',
      persian_meaning TEXT NOT NULL,
      english_meaning TEXT NOT NULL,
      context_explanation TEXT NOT NULL DEFAULT '',
      book_title TEXT NOT NULL DEFAULT '',
      page INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  global._postgresSchemaReady = true;
}

