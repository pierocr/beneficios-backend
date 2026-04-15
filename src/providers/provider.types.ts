import { BenefitScraper } from "../scrapers/scraper.types";

export interface Provider {
  slug: string;
  name: string;
  bankName: string;
  country: string;
  sourceUrl: string;
  expectedMinRawBenefits?: number;
  minSafePersistRatio?: number;
  scraper: BenefitScraper;
}
