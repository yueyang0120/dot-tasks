import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull().default(0),
  data: text('data').notNull(),
  updatedAt: text('updated_at').notNull(),
});
