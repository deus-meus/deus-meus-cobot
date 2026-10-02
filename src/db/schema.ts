import { integer, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const installations = pgTable("installations", {
  id: varchar("id", { length: 64 }).primaryKey(),
  installationId: integer("installation_id").notNull().unique(),
  accountLogin: varchar("account_login", { length: 255 }).notNull(),
  accountType: varchar("account_type", { length: 50 }).notNull(),
  repositorySelection: varchar("repository_selection", { length: 50 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const webhookEvents = pgTable("webhook_events", {
  id: varchar("id", { length: 64 }).primaryKey(),
  deliveryId: varchar("delivery_id", { length: 128 }).notNull().unique(),
  event: varchar("event", { length: 64 }).notNull(),
  action: varchar("action", { length: 64 }),
  repository: varchar("repository", { length: 255 }).notNull(),
  sender: varchar("sender", { length: 255 }).notNull(),
  payload: jsonb("payload").notNull(),
  status: varchar("status", { length: 32 }).default("queued").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const botJobs = pgTable("bot_jobs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  deliveryId: varchar("delivery_id", { length: 128 }),
  repository: varchar("repository", { length: 255 }).notNull(),
  issueOrPrNumber: integer("issue_or_pr_number"),
  jobType: varchar("job_type", { length: 64 }).notNull(),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  resultPrUrl: varchar("result_pr_url", { length: 512 }),
  error: text("error"),
  tokensUsed: integer("tokens_used").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
