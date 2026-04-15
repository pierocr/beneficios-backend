import { NormalizedBenefit, RawBenefit } from "./benefit.types";

export interface BenefitUpsertInput {
  providerSlug: string;
  providerBenefitKey: string;
  rawBenefit: RawBenefit;
  normalizedBenefit: NormalizedBenefit;
  runId: string;
  scrapedAt: string;
}

export interface PersistedScrapingSummary {
  insertedOrUpdatedCount: number;
  deactivatedCount: number;
  runId: string;
}
