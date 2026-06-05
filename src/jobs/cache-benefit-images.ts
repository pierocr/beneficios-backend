import { getSupabaseAdminClient } from "../lib/supabase";
import { imageCacheService, isCachedBenefitImage } from "../services/image-cache.service";
import { logger } from "../utils/logger";

interface BenefitImageRow {
  id: string;
  provider_slug: string;
  provider_benefit_key: string;
  merchant_slug: string;
  image_url: string | null;
  source_image_url: string | null;
  image_status: string | null;
}

const DEFAULT_LIMIT = 100;
const DEFAULT_CONCURRENCY = 4;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = args.limit ?? DEFAULT_LIMIT;
  const concurrency = args.concurrency ?? DEFAULT_CONCURRENCY;
  const providerSlug = args.provider;
  const retryFailed = args.retryFailed ?? false;
  const supabase = getSupabaseAdminClient();

  let query = supabase
    .from("benefits")
    .select("id, provider_slug, provider_benefit_key, merchant_slug, image_url, source_image_url, image_status")
    .eq("is_active", true)
    .neq("validation_status", "invalid")
    .not("image_url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (providerSlug) {
    query = query.eq("provider_slug", providerSlug);
  }

  if (retryFailed) {
    query = query.eq("image_status", "failed");
  } else {
    query = query.or("image_status.is.null,image_status.eq.source");
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to load benefits for image cache: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as BenefitImageRow[];
  let cachedCount = 0;
  let failedCount = 0;

  logger.info("Starting benefit image cache backfill", {
    count: rows.length,
    providerSlug,
    retryFailed,
    concurrency,
  });

  let index = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (index < rows.length) {
      const row = rows[index];
      index += 1;

      if (!row) {
        continue;
      }

      const sourceUrl = row.source_image_url || row.image_url;

      if (!sourceUrl) {
        continue;
      }

      const result = await imageCacheService.cacheBenefitImage({
        providerSlug: row.provider_slug,
        providerBenefitKey: row.provider_benefit_key,
        merchantSlug: row.merchant_slug,
        benefitId: row.id,
        sourceUrl,
        imageKind: "banner",
      });

      if (isCachedBenefitImage(result)) {
        cachedCount += 1;
        const { error: updateError } = await supabase
          .from("benefits")
          .update({
            source_image_url: sourceUrl,
            cached_image_url: result.publicUrl,
            image_url: result.publicUrl,
            image_storage_path: result.storagePath,
            image_status: "cached",
            image_updated_at: new Date().toISOString(),
            image_error: null,
          })
          .eq("id", row.id);

        if (updateError) {
          throw new Error(`Failed to update cached image on benefit ${row.id}: ${updateError.message}`);
        }
      } else {
        failedCount += 1;
        await supabase
          .from("benefits")
          .update({
            source_image_url: sourceUrl,
            image_status: "failed",
            image_updated_at: new Date().toISOString(),
            image_error: result.errorMessage,
          })
          .eq("id", row.id);
      }
    }
  });

  await Promise.all(workers);

  logger.info("Finished benefit image cache backfill", {
    requestedCount: rows.length,
    cachedCount,
    failedCount,
  });
}

function parseArgs(args: string[]) {
  const parsed: {
    limit?: number;
    provider?: string;
    retryFailed?: boolean;
    concurrency?: number;
  } = {};

  for (const arg of args) {
    if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      if (Number.isInteger(value) && value > 0) {
        parsed.limit = value;
      }
    } else if (arg.startsWith("--provider=")) {
      parsed.provider = arg.slice("--provider=".length);
    } else if (arg.startsWith("--concurrency=")) {
      const value = Number(arg.slice("--concurrency=".length));
      if (Number.isInteger(value) && value > 0) {
        parsed.concurrency = value;
      }
    } else if (arg === "--retry-failed") {
      parsed.retryFailed = true;
    }
  }

  return parsed;
}

main().catch((error) => {
  logger.error("Benefit image cache job failed", {
    message: error instanceof Error ? error.message : "Unknown error",
  });
  process.exitCode = 1;
});
