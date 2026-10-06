import { bigint, boolean, integer, numeric, pgTable, text } from 'drizzle-orm/pg-core';

// Espelha as tabelas do Supabase usadas pelo fluxo do cliente (supabase/schema_completo.sql).
// O schema continua sendo mantido pelas migrações SQL; aqui só descrevemos o formato para consulta tipada.

export const CATEGORIAS = ['drink', 'cerveja', 'sem_alcool', 'narguile', 'essencia'] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const produtos = pgTable('produtos', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  nome: text('nome').notNull(),
  descricao: text('descricao').notNull().default(''),
  preco: numeric('preco', { precision: 10, scale: 2, mode: 'number' }).notNull(),
  categoria: text('categoria', { enum: CATEGORIAS }).notNull(),
  ativo: boolean('ativo').notNull().default(true),
  ordem: integer('ordem').notNull().default(0),
});

export const mesas = pgTable('mesas', {
  numero: integer('numero').primaryKey(),
  token: text('token').notNull(),
  ativa: boolean('ativa').notNull().default(true),
  statusMesa: text('status_mesa', { enum: ['liberada', 'bloqueada'] }).notNull().default('bloqueada'),
});
