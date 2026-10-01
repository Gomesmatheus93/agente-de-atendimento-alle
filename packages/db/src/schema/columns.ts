import { timestamp } from "drizzle-orm/pg-core";

// Com fuso: o Postgres guarda o instante exato, e a data volta igual para a API e o worker.
export const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // O Postgres não tem "ON UPDATE CURRENT_TIMESTAMP" como o MySQL: o Drizzle preenche a cada update.
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
