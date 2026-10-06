import 'dotenv/config';
import { criarApp } from './app.js';
import { criarDb } from './db/client.js';
import { PgClienteRepository } from './repositories/PgClienteRepository.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL não definida. Copie .env.example para .env e preencha.');
  process.exit(1);
}

const { db, encerrar } = criarDb(databaseUrl);
const app = criarApp(new PgClienteRepository(db), {
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
});

const porta = Number(process.env.PORT ?? 3333);
const servidor = app.listen(porta, () => console.log(`aooba-api ouvindo em http://localhost:${porta}`));

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    servidor.close(() => void encerrar().finally(() => process.exit(0)));
  });
}
