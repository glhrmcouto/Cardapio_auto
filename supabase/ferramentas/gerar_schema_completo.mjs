// ========================================================================
// Gera supabase/schema_completo.sql — o estado FINAL do banco depois de
// todas as migrações (001, 002, ...), num arquivo só, pra instalação nova.
//
// Como funciona: sobe um Postgres descartável em memória (PGlite, Postgres
// compilado pra WebAssembly — não precisa instalar Postgres nem Docker),
// cria o mínimo do que o Supabase já traz pronto (schema "auth", papéis
// anon/authenticated, publicação supabase_realtime), aplica as migrações
// em ordem e faz um pg_dump do schema "public". No fim, confere o
// resultado: aplica o arquivo gerado num banco limpo e exige que o dump
// dele seja idêntico ao das migrações.
//
// Rode de novo SEMPRE que criar uma migração nova, e commite as duas coisas
// juntas. Pra rodar (Node 20+), a partir da raiz do repositório:
//
//   cd supabase/ferramentas
//   npm install --no-save @electric-sql/pglite @electric-sql/pglite-tools
//   node gerar_schema_completo.mjs
//
// (--no-save: o repositório continua sem package.json de propósito; a
// pasta node_modules criada aqui já está no .gitignore.)
// ========================================================================

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pgDump } from '@electric-sql/pglite-tools/pg_dump';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR_SUPABASE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAIDA = path.join(DIR_SUPABASE, 'schema_completo.sql');

// O que o Supabase já cria sozinho em todo projeto — só o suficiente pras
// migrações rodarem (auth.users é referenciada por perfis; auth.uid() pelas
// políticas de RLS). Nada disso vai pro arquivo gerado.
//
// pgcrypto fica no schema "extensions", com ele no search_path, igual no
// Supabase: assim o pg_dump escreve extensions.gen_random_bytes(...) no
// default do token das mesas — com o pgcrypto em "public" sairia
// public.gen_random_bytes(...), que não existe num projeto Supabase.
const STUBS_SUPABASE = `
  create schema extensions;
  create extension pgcrypto with schema extensions;
  set search_path = "$user", public, extensions;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create publication supabase_realtime;
`;

async function bancoNovo() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUBS_SUPABASE);
  return db;
}

async function dump(db, args) {
  const arquivo = await pgDump({ pg: db, args });
  return arquivo.text();
}

// Tira do dump o que não deve (ou não pode) ir pro SQL Editor do Supabase:
// os SET de sessão do cabeçalho (alguns só existem em Postgres mais novo que
// o do Supabase), a criação do schema public (já existe) e os comentários
// de "Owner"/versão.
function limparDump(sql) {
  return sql
    .replace(/\r\n/g, '\n')
    .replace(/^--\n-- PostgreSQL database dump( complete)?\n--\n/gm, '')
    .replace(/^-- Dumped (from|by) .*\n/gm, '')
    .replace(/^SET [^\n]*;\n/gm, '')
    .replace(/^SELECT pg_catalog\.set_config\('search_path', '', false\);\n/gm, '')
    .replace(/^--\n-- Name: public; Type: SCHEMA;[^\n]*\n--\n\nCREATE SCHEMA public;\n/m, '')
    .replace(/^--\n-- Name: SCHEMA public; Type: COMMENT;[^\n]*\n--\n\nCOMMENT ON SCHEMA public IS [^\n]*\n/m, '')
    .replace(/; Owner: [^\n]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------- 1. aplica as migrações
const migracoes = fs.readdirSync(DIR_SUPABASE).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort();
const dbMigracoes = await bancoNovo();
for (const f of migracoes) {
  try {
    // LF sempre: num checkout Windows (core.autocrlf) os arquivos chegam com
    // CRLF, e o \r iria parar dentro do corpo das funções — o resultado tem
    // que ser o mesmo em qualquer máquina.
    const sql = fs.readFileSync(path.join(DIR_SUPABASE, f), 'utf8').replace(/\r\n/g, '\n');
    await dbMigracoes.exec(sql);
  } catch (erro) {
    console.error(`Erro ao aplicar ${f}: ${erro.message}`);
    process.exit(1);
  }
}
console.log(`${migracoes.length} migrações aplicadas (${migracoes[0]} .. ${migracoes.at(-1)})`);

// ---------- 2. monta o arquivo
const ARGS_SCHEMA = ['--schema=public', '--schema-only', '--no-owner'];
const schema = limparDump(await dump(dbMigracoes, ARGS_SCHEMA));
// Só os dados que o sistema precisa pra funcionar/começar: a configuração
// da taxa de serviço e o cardápio inicial. As mesas NÃO vêm do dump — o
// token de cada uma é um segredo gerado aleatoriamente, e tem que nascer
// no banco novo (ver mais abaixo), nunca copiado deste banco descartável.
const dados = limparDump(await dump(dbMigracoes, ['--data-only', '--column-inserts', '--table=public.configuracoes', '--table=public.produtos']));

const publicadas = (await dbMigracoes.query(
  `select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by 1`
)).rows.map(r => `public.${r.tablename}`);

const conteudo = `-- ========================================================================
-- SCHEMA COMPLETO — instalação NOVA do banco, num passo só
-- ========================================================================
--
-- GERADO AUTOMATICAMENTE por supabase/ferramentas/gerar_schema_completo.mjs
-- a partir de ${migracoes[0]} .. ${migracoes.at(-1)}. Não edite à mão: mude/crie
-- uma migração e rode o gerador de novo.
--
-- Use SÓ num projeto Supabase vazio, no lugar de rodar as migrações uma a
-- uma — o resultado é o mesmo (o gerador confere isso). Num banco que já
-- está rodando, NÃO rode este arquivo: aplique só as migrações novas.
--
-- Depois de rodar: crie os usuários de login e o perfil de admin (ver
-- README, "Como configurar o Supabase do zero").
-- ========================================================================

set check_function_bodies = false;
set client_min_messages = warning;

create extension if not exists "pgcrypto";

${schema}

-- ------------------------------------------------------------------------
-- Realtime (o balcão escuta mudanças nestas tabelas)
-- ------------------------------------------------------------------------

alter publication supabase_realtime add table ${publicadas.join(', ')};

-- ------------------------------------------------------------------------
-- Dados iniciais: configuração da taxa de serviço e cardápio de exemplo
-- ------------------------------------------------------------------------

${dados}

-- Mesas 1 a 20, cada uma com um token novo gerado aqui mesmo (default da coluna)
insert into public.mesas (numero)
select numero from generate_series(1, 20) as gerar(numero)
on conflict (numero) do nothing;
`;

fs.writeFileSync(SAIDA, conteudo);
console.log(`Gerado: ${path.relative(process.cwd(), SAIDA)}`);

// ---------- 3. confere: o arquivo gerado reproduz exatamente as migrações?
const dbConferencia = await bancoNovo();
await dbConferencia.exec(conteudo);

const esperado = await dump(dbMigracoes, ARGS_SCHEMA);
const obtido = await dump(dbConferencia, ARGS_SCHEMA);
const contar = async (db, tabela) => (await db.query(`select count(*)::int as n from public.${tabela}`)).rows[0].n;
const pubs = async db => (await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`)).rows.map(r => r.tablename).join(',');

const problemas = [];
if (esperado !== obtido) {
  // deixa os dois dumps aqui do lado pra dar um diff e ver o que mudou
  fs.writeFileSync('conferencia_esperado.sql', esperado);
  fs.writeFileSync('conferencia_obtido.sql', obtido);
  problemas.push('schema diferente do produzido pelas migrações (ver conferencia_*.sql nesta pasta)');
}
// Conteúdo (não só a quantidade) de cada tabela com dados iniciais — nas
// mesas, tudo menos o token, que é aleatório de propósito. Pega, por
// exemplo, uma migração que muda o default de uma coluna E atualiza as
// linhas já existentes: o arquivo gerado cria as linhas depois, com o
// default novo, e o resultado tem que bater igual.
const linhasDaTabela = async (db, t) => JSON.stringify((await db.query(
  `select to_jsonb(x) - 'token' as linha from public.${t} x order by 1::text`
)).rows.map(r => r.linha).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
for (const t of ['configuracoes', 'produtos', 'mesas']) {
  const [a, b] = [await contar(dbMigracoes, t), await contar(dbConferencia, t)];
  if (a !== b) problemas.push(`${t}: ${a} linha(s) nas migrações, ${b} no arquivo gerado`);
  else if (await linhasDaTabela(dbMigracoes, t) !== await linhasDaTabela(dbConferencia, t)) problemas.push(`${t}: conteúdo diferente do produzido pelas migrações`);
}
if (await pubs(dbMigracoes) !== await pubs(dbConferencia)) problemas.push('tabelas do Realtime diferentes');

if (problemas.length) {
  console.error('FALHOU a conferência:\n - ' + problemas.join('\n - '));
  process.exit(1);
}
console.log('Conferido: schema, dados iniciais e Realtime idênticos aos das migrações.');
