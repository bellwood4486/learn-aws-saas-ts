import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * items の本体（RDB 側）。
 * 処理ステータスは DynamoDB 側が持つ（@repo/contracts の Item はこの2つを合成した形）。
 */
export const items = pgTable('items', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ItemRow = typeof items.$inferSelect;
export type NewItemRow = typeof items.$inferInsert;
