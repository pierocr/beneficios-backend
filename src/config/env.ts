import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PLAYWRIGHT_HEADLESS: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  APP_TIMEZONE: z.string().default("America/Santiago"),
  PERSIST_RESULTS_TO_DB: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(`Invalid environment configuration: ${parsedEnv.error.message}`);
}

export const env = parsedEnv.data;
