import { defineConfig } from 'drizzle-kit';

// Só para o drizzle-kit (studio). O schema do banco é gerenciado pelo Supabase (../aooba-react/supabase/*.sql).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
