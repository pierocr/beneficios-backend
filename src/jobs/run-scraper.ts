import { findProviderBySlug } from "../providers/providers";
import { scrapeProvider } from "./scrape-provider";
import { logger } from "../utils/logger";

const run = async (): Promise<void> => {
  const providerSlug = process.argv[2];

  if (!providerSlug) {
    throw new Error("Provider slug is required. Example: npm run scrape falabella");
  }

  const provider = findProviderBySlug(providerSlug);

  if (!provider) {
    throw new Error(`Provider "${providerSlug}" is not registered.`);
  }

  const result = await scrapeProvider(providerSlug);
  logger.info("Scraping job completed", {
    ...result,
  });

  console.log(JSON.stringify(result, null, 2));
};

run().catch((error: unknown) => {
  logger.error("Scraping job failed", {
    message: error instanceof Error ? error.message : "Unknown error",
  });
  process.exitCode = 1;
});
