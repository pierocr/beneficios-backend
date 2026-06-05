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
  ADMIN_DASHBOARD_TOKEN: z.string().optional(),
  PUBLIC_SCRAPE_TOKEN: z.string().optional(),
  CACHE_BENEFIT_IMAGES: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  BENEFIT_IMAGES_BUCKET: z.string().default("benefit-images"),
  BENEFIT_IMAGE_MAX_WIDTH: z.coerce.number().int().positive().default(800),
  BENEFIT_IMAGE_WEBP_QUALITY: z.coerce.number().int().min(20).max(100).default(72),
  BENEFIT_IMAGE_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((origin) => origin.trim())
            .filter(Boolean)
        : [],
    ),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(`Invalid environment configuration: ${parsedEnv.error.message}`);
}

export const env = parsedEnv.data;
