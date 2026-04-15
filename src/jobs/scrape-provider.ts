import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { findProviderBySlug } from "../providers/providers";
import { normalizationService } from "../services/normalization.service";
import { persistenceService } from "../services/persistence.service";
import { scrapingService } from "../services/scraping.service";
import { validationService } from "../services/validation.service";

export interface ProviderScrapeResult {
  provider: string;
  rawCount: number;
  normalizedCount: number;
  validCount: number;
  needsReviewCount: number;
  invalidCount: number;
  outputPath: string;
  dbSummary?:
    | {
        insertedOrUpdatedCount: number;
        deactivatedCount: number;
        runId: string;
      }
    | undefined;
}

const formatTimestamp = (date: Date): string => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");

  return `${year}-${month}-${day}-${hours}-${minutes}`;
};

export const scrapeProvider = async (providerSlug: string): Promise<ProviderScrapeResult> => {
  const provider = findProviderBySlug(providerSlug);

  if (!provider) {
    throw new Error(`Provider "${providerSlug}" is not registered.`);
  }

  const rawBenefits = await scrapingService.scrapeByProvider(providerSlug);
  const normalizedBenefits = normalizationService.normalize(rawBenefits);
  const validatedBenefits = validationService.validate(normalizedBenefits);
  const scrapedAt = new Date().toISOString();

  const summary = {
    provider: providerSlug,
    rawCount: rawBenefits.length,
    normalizedCount: validatedBenefits.length,
    validCount: validatedBenefits.filter((item) => item.validationStatus === "valid").length,
    needsReviewCount: validatedBenefits.filter((item) => item.validationStatus === "needs_review").length,
    invalidCount: validatedBenefits.filter((item) => item.validationStatus === "invalid").length,
  };

  const payload = {
    provider: providerSlug,
    scrapedAt,
    rawBenefits,
    normalizedBenefits: validatedBenefits,
    summary,
  };

  const outputDirectory = path.resolve(process.cwd(), "output");
  await fs.mkdir(outputDirectory, { recursive: true });

  const outputPath = path.join(outputDirectory, `${providerSlug}-${formatTimestamp(new Date())}.json`);
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf-8");

  let dbSummary:
    | {
        insertedOrUpdatedCount: number;
        deactivatedCount: number;
        runId: string;
      }
    | undefined;

  if (env.PERSIST_RESULTS_TO_DB) {
    const previousActiveCount = await persistenceService.getActiveBenefitCount(providerSlug);
    const expectedMinRawBenefits = provider.expectedMinRawBenefits ?? 1;
    const minSafePersistRatio = provider.minSafePersistRatio ?? 0.5;
    const minSafeCount =
      previousActiveCount > 0
        ? Math.max(expectedMinRawBenefits, Math.floor(previousActiveCount * minSafePersistRatio))
        : expectedMinRawBenefits;

    if (summary.rawCount < minSafeCount) {
      throw new Error(
        `Safety guard blocked database update for provider "${providerSlug}". Raw count ${summary.rawCount} is below safe threshold ${minSafeCount}. Previous active count: ${previousActiveCount}.`,
      );
    }

    dbSummary = await persistenceService.persistScrapingResult({
      providerSlug,
      rawBenefits,
      normalizedBenefits: validatedBenefits,
      summary,
      outputPath,
      scrapedAt,
    });
  }

  return {
    ...summary,
    outputPath,
    dbSummary,
  };
};
