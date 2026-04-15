import { providers } from "../providers/providers";
import { logger } from "../utils/logger";
import { scrapeProvider } from "./scrape-provider";

const run = async (): Promise<void> => {
  const results: Array<{
    provider: string;
    status: "success" | "failed";
    rawCount?: number;
    normalizedCount?: number;
    validCount?: number;
    needsReviewCount?: number;
    invalidCount?: number;
    outputPath?: string;
    error?: string;
  }> = [];

  for (const provider of providers) {
    logger.info("Starting scraping job", {
      provider: provider.slug,
    });

    try {
      const result = await scrapeProvider(provider.slug);
      results.push({
        provider: provider.slug,
        status: "success",
        rawCount: result.rawCount,
        normalizedCount: result.normalizedCount,
        validCount: result.validCount,
        needsReviewCount: result.needsReviewCount,
        invalidCount: result.invalidCount,
        outputPath: result.outputPath,
      });

      logger.info("Scraping job completed", result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";

      results.push({
        provider: provider.slug,
        status: "failed",
        error: message,
      });

      logger.error("Scraping job failed", {
        provider: provider.slug,
        message,
      });
    }
  }

  console.log(JSON.stringify(results, null, 2));

  if (results.some((result) => result.status === "failed")) {
    process.exitCode = 1;
  }
};

run().catch((error: unknown) => {
  logger.error("Scrape all job failed", {
    message: error instanceof Error ? error.message : "Unknown error",
  });
  process.exitCode = 1;
});
