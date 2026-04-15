import { findProviderBySlug } from "../providers/providers";
import { RawBenefit } from "../types/benefit.types";

export class ScrapingService {
  async scrapeByProvider(providerSlug: string): Promise<RawBenefit[]> {
    const provider = findProviderBySlug(providerSlug);

    if (!provider) {
      throw new Error(`Provider "${providerSlug}" is not registered.`);
    }

    return provider.scraper.scrape();
  }
}

export const scrapingService = new ScrapingService();
