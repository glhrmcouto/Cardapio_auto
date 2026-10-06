import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export function criarDb(databaseUrl: string) {
  // prepare:false é exigido pelo pooler em modo transaction do Supabase.
  const conexao = postgres(databaseUrl, { prepare: false, max: 10 });
  return { db: drizzle(conexao, { schema }), encerrar: () => conexao.end() };
}

export type Db = ReturnType<typeof criarDb>['db'];
