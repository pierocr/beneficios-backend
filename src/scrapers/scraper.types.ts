import { RawBenefit } from "../types/benefit.types";

export interface BenefitScraper {
  scrape(): Promise<RawBenefit[]>;
}
