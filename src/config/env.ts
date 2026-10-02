import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  GITHUB_APP_ID: z.string().default("0"),
  GITHUB_PRIVATE_KEY: z.string().default(""),
  GITHUB_WEBHOOK_SECRET: z.string().default("development_secret"),
  SMEE_URL: z.string().optional(),
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  DATABASE_URL: z.string().default("postgres://postgres:postgres@localhost:5432/deus_meus_cobot"),
  ANTHROPIC_API_KEY: z.string().default(""),
  ANTHROPIC_BASE_URL: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-3-7-sonnet-20250219"),
  GIT_COMMITTER_NAME: z.string().default("Deus Meus CoBot"),
  GIT_COMMITTER_EMAIL: z.string().optional(),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
