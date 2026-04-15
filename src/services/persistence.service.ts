import crypto from "node:crypto";
import { providers } from "../providers/providers";
import { BenefitUpsertInput, PersistedScrapingSummary } from "../types/database.types";
import { getSupabaseAdminClient } from "../lib/supabase";

interface RunSummary {
  provider: string;
  rawCount: number;
  normalizedCount: number;
  validCount: number;
  needsReviewCount: number;
  invalidCount: number;
}

export class PersistenceService {
  async getActiveBenefitCount(providerSlug: string): Promise<number> {
    const supabase = getSupabaseAdminClient();
    const { count, error } = await supabase
      .from("benefits")
      .select("id", { count: "exact", head: true })
      .eq("provider_slug", providerSlug)
      .eq("is_active", true);

    if (error) {
      throw new Error(`Failed to load active benefit count: ${error.message}`);
    }

    return count ?? 0;
  }

  async persistScrapingResult(input: {
    providerSlug: string;
    rawBenefits: import("../types/benefit.types").RawBenefit[];
    normalizedBenefits: import("../types/benefit.types").NormalizedBenefit[];
    summary: RunSummary;
    outputPath: string;
    scrapedAt: string;
  }): Promise<PersistedScrapingSummary> {
    const supabase = getSupabaseAdminClient();
    const provider = providers.find((item) => item.slug === input.providerSlug);

    if (!provider) {
      throw new Error(`Provider "${input.providerSlug}" is not registered.`);
    }

    const { error: providerError } = await supabase.from("providers").upsert(
      {
        slug: provider.slug,
        name: provider.name,
        bank_name: provider.bankName,
        country: provider.country,
        source_url: provider.sourceUrl,
        updated_at: input.scrapedAt,
      },
      { onConflict: "slug" },
    );

    if (providerError) {
      throw new Error(`Failed to upsert provider: ${providerError.message}`);
    }

    const { data: runRow, error: runError } = await supabase
      .from("scraping_runs")
      .insert({
        provider_slug: input.providerSlug,
        status: "completed",
        raw_count: input.summary.rawCount,
        normalized_count: input.summary.normalizedCount,
        valid_count: input.summary.validCount,
        needs_review_count: input.summary.needsReviewCount,
        invalid_count: input.summary.invalidCount,
        output_path: input.outputPath,
        started_at: input.scrapedAt,
        completed_at: input.scrapedAt,
        metadata: {
          outputPath: input.outputPath,
        },
      })
      .select("id")
      .single();

    if (runError || !runRow) {
      throw new Error(`Failed to create scraping run: ${runError?.message ?? "Missing run row"}`);
    }

    const { data: existingRows, error: existingRowsError } = await supabase
      .from("benefits")
      .select(
        "id, provider_benefit_key, is_active, merchant_slug, title, benefit_type, benefit_value, redirect_url, raw_metadata",
      )
      .eq("provider_slug", input.providerSlug);

    if (existingRowsError) {
      throw new Error(`Failed to load existing benefits: ${existingRowsError.message}`);
    }

    const existingKeyBySignature = new Map<string, string>();

    for (const row of existingRows ?? []) {
      const signature = this.buildBusinessSignatureFromDatabaseRow(input.providerSlug, row);

      if (!existingKeyBySignature.has(signature) || row.is_active) {
        existingKeyBySignature.set(signature, row.provider_benefit_key as string);
      }
    }

    const benefitInputsByKey = new Map<string, BenefitUpsertInput>();

    input.normalizedBenefits.forEach((normalizedBenefit, index) => {
      const rawBenefit = input.rawBenefits[index];

      if (!rawBenefit) {
        throw new Error(`Missing raw benefit for normalized benefit at index ${index}.`);
      }

      const signature = this.buildBusinessSignature(input.providerSlug, rawBenefit, normalizedBenefit);
      const providerBenefitKey =
        existingKeyBySignature.get(signature) ?? this.buildProviderBenefitKey(input.providerSlug, rawBenefit, normalizedBenefit);
      const benefitInput: BenefitUpsertInput = {
        providerSlug: input.providerSlug,
        providerBenefitKey,
        rawBenefit,
        normalizedBenefit,
        runId: runRow.id as string,
        scrapedAt: input.scrapedAt,
      };
      const existingInput = benefitInputsByKey.get(providerBenefitKey);

      if (!existingInput || this.shouldReplaceBenefitInput(existingInput, benefitInput)) {
        benefitInputsByKey.set(providerBenefitKey, benefitInput);
      }
    });

    const benefitInputs = Array.from(benefitInputsByKey.values());

    const upsertRows = benefitInputs.map((item) => this.toBenefitRow(item));
    const { error: benefitsError } = await supabase.from("benefits").upsert(upsertRows, {
      onConflict: "provider_slug,provider_benefit_key",
    });

    if (benefitsError) {
      throw new Error(`Failed to upsert benefits: ${benefitsError.message}`);
    }

    let deactivatedCount = 0;

    const { data: rowsToDeactivate, error: selectDeactivateError } = await supabase
      .from("benefits")
      .select("id")
      .eq("provider_slug", input.providerSlug)
      .eq("is_active", true)
      .neq("last_run_id", runRow.id as string);

    if (selectDeactivateError) {
      throw new Error(`Failed to query stale benefits: ${selectDeactivateError.message}`);
    }

    if (rowsToDeactivate && rowsToDeactivate.length > 0) {
      deactivatedCount = rowsToDeactivate.length;

      const { error: deactivateError } = await supabase
        .from("benefits")
        .update({
          is_active: false,
          updated_at: input.scrapedAt,
        })
        .eq("provider_slug", input.providerSlug)
        .eq("is_active", true)
        .neq("last_run_id", runRow.id as string);

      if (deactivateError) {
        throw new Error(`Failed to deactivate stale benefits: ${deactivateError.message}`);
      }
    }

    await this.cleanupDuplicateBenefits(input.providerSlug);

    return {
      insertedOrUpdatedCount: benefitInputs.length,
      deactivatedCount,
      runId: runRow.id as string,
    };
  }

  private buildProviderBenefitKey(
    providerSlug: string,
    rawBenefit: import("../types/benefit.types").RawBenefit,
    normalizedBenefit: import("../types/benefit.types").NormalizedBenefit,
  ): string {
    const stableBase = this.buildBusinessSignature(providerSlug, rawBenefit, normalizedBenefit);
    const hash = crypto.createHash("sha256").update(stableBase).digest("hex").slice(0, 24);
    return `${providerSlug}_${hash}`;
  }

  private buildBusinessSignature(
    providerSlug: string,
    rawBenefit: import("../types/benefit.types").RawBenefit,
    normalizedBenefit: import("../types/benefit.types").NormalizedBenefit,
  ): string {
    const metadata = rawBenefit.metadata ?? {};
    const nativeProviderId = this.getProviderNativeId(providerSlug, metadata, rawBenefit.sourceUrl);

    if (nativeProviderId) {
      return [providerSlug, nativeProviderId].join("::");
    }

    const cardId = typeof metadata.cardId === "string" ? metadata.cardId : "";
    const redirectUrl = typeof metadata.redirectUrl === "string" ? metadata.redirectUrl : "";

    return [
      providerSlug,
      cardId,
      redirectUrl,
      normalizedBenefit.merchantSlug,
      normalizedBenefit.title,
      normalizedBenefit.benefitType,
      normalizedBenefit.benefitValue ?? "",
    ].join("::");
  }

  private buildBusinessSignatureFromDatabaseRow(
    providerSlug: string,
    row: {
      merchant_slug?: unknown;
      title?: unknown;
      benefit_type?: unknown;
      benefit_value?: unknown;
      redirect_url?: unknown;
      raw_metadata?: unknown;
    },
  ): string {
    const rawMetadata =
      row.raw_metadata && typeof row.raw_metadata === "object" ? (row.raw_metadata as Record<string, unknown>) : {};
    const nativeProviderId = this.getProviderNativeId(
      providerSlug,
      rawMetadata,
      typeof row.redirect_url === "string" ? row.redirect_url : undefined,
    );

    if (nativeProviderId) {
      return [providerSlug, nativeProviderId].join("::");
    }

    const cardId = typeof rawMetadata.cardId === "string" ? rawMetadata.cardId : "";
    const redirectUrl = typeof row.redirect_url === "string" ? row.redirect_url : "";

    return [
      providerSlug,
      cardId,
      redirectUrl,
      typeof row.merchant_slug === "string" ? row.merchant_slug : "",
      typeof row.title === "string" ? row.title : "",
      typeof row.benefit_type === "string" ? row.benefit_type : "",
      row.benefit_value ?? "",
    ].join("::");
  }

  private getProviderNativeId(
    providerSlug: string,
    metadata: Record<string, unknown>,
    fallbackUrl?: string,
  ): string | undefined {
    if (providerSlug === "bci") {
      const offerId = typeof metadata.offerId === "string" ? metadata.offerId : undefined;
      const merchantId = typeof metadata.merchantId === "string" ? metadata.merchantId : undefined;

      if (offerId) {
        return `offer:${offerId}`;
      }

      if (fallbackUrl) {
        return `url:${fallbackUrl}`;
      }

      if (merchantId) {
        return `merchant:${merchantId}`;
      }
    }

    if (providerSlug === "falabella") {
      const cardId = typeof metadata.cardId === "string" ? metadata.cardId : undefined;
      const redirectUrl = typeof metadata.redirectUrl === "string" ? metadata.redirectUrl : undefined;

      if (cardId) {
        return `card:${cardId}`;
      }

      if (redirectUrl) {
        return `url:${redirectUrl}`;
      }
    }

    if (providerSlug === "bancochile") {
      const benefitUuid = typeof metadata.benefitUuid === "string" ? metadata.benefitUuid : undefined;
      const benefitSlug = typeof metadata.benefitSlug === "string" ? metadata.benefitSlug : undefined;

      if (benefitUuid) {
        return `benefit:${benefitUuid}`;
      }

      if (benefitSlug) {
        return `slug:${benefitSlug}`;
      }

      if (fallbackUrl) {
        return `url:${fallbackUrl}`;
      }
    }

    if (providerSlug === "cencosudscotia") {
      const benefitId =
        typeof metadata.cencosudBenefitId === "number" ? String(metadata.cencosudBenefitId) : undefined;
      const routeCardKey = typeof metadata.routeCardKey === "string" ? metadata.routeCardKey : undefined;
      const redirectUrl = typeof metadata.redirectUrl === "string" ? metadata.redirectUrl : undefined;

      if (benefitId) {
        return `benefit:${benefitId}`;
      }

      if (routeCardKey) {
        return `route:${routeCardKey}`;
      }

      if (redirectUrl) {
        return `url:${redirectUrl}`;
      }

      if (fallbackUrl) {
        return `source:${fallbackUrl}`;
      }
    }

    const genericId =
      (typeof metadata.benefitUuid === "string" && metadata.benefitUuid) ||
      (typeof metadata.benefitSlug === "string" && metadata.benefitSlug) ||
      (typeof metadata.cencosudBenefitId === "number" && String(metadata.cencosudBenefitId)) ||
      (typeof metadata.routeCardKey === "string" && metadata.routeCardKey) ||
      (typeof metadata.offerId === "string" && metadata.offerId) ||
      (typeof metadata.cardId === "string" && metadata.cardId) ||
      (typeof metadata.redirectUrl === "string" && metadata.redirectUrl);

    return genericId ? `generic:${genericId}` : undefined;
  }

  private async cleanupDuplicateBenefits(providerSlug: string): Promise<void> {
    const supabase = getSupabaseAdminClient();
    const { data: rows, error } = await supabase
      .from("benefits")
      .select("id, provider_benefit_key, is_active, updated_at, merchant_slug, title, benefit_type, benefit_value, redirect_url, raw_metadata")
      .eq("provider_slug", providerSlug);

    if (error) {
      throw new Error(`Failed to load benefits for cleanup: ${error.message}`);
    }

    const rowsBySignature = new Map<string, typeof rows>();

    for (const row of rows ?? []) {
      const signature = this.buildBusinessSignatureFromDatabaseRow(providerSlug, row);
      const current = rowsBySignature.get(signature) ?? [];
      current.push(row);
      rowsBySignature.set(signature, current);
    }

    const idsToDelete: string[] = [];

    for (const groupedRows of rowsBySignature.values()) {
      if (groupedRows.length <= 1) {
        continue;
      }

      groupedRows.sort((left, right) => {
        if (left.is_active !== right.is_active) {
          return left.is_active ? -1 : 1;
        }

        return String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? ""));
      });

      idsToDelete.push(...groupedRows.slice(1).map((row) => row.id as string));
    }

    if (idsToDelete.length === 0) {
      return;
    }

    const { error: deleteError } = await supabase.from("benefits").delete().in("id", idsToDelete);

    if (deleteError) {
      throw new Error(`Failed to delete duplicate benefits: ${deleteError.message}`);
    }
  }

  private toBenefitRow(input: BenefitUpsertInput) {
    const metadata = input.rawBenefit.metadata ?? {};

    return {
      provider_slug: input.providerSlug,
      provider_benefit_key: input.providerBenefitKey,
      bank_name: input.normalizedBenefit.bankName,
      merchant_name: input.normalizedBenefit.merchantName,
      merchant_canonical_name: input.normalizedBenefit.merchantCanonicalName,
      merchant_slug: input.normalizedBenefit.merchantSlug,
      merchant_source: input.normalizedBenefit.merchantSource,
      merchant_matched_alias: input.normalizedBenefit.merchantMatchedAlias ?? null,
      category_name: input.normalizedBenefit.categoryName,
      category_source: input.normalizedBenefit.categorySource,
      title: input.normalizedBenefit.title,
      benefit_type: input.normalizedBenefit.benefitType,
      benefit_value: input.normalizedBenefit.benefitValue ?? null,
      benefit_value_unit: input.normalizedBenefit.benefitValueUnit,
      days: input.normalizedBenefit.days ?? null,
      channel: input.normalizedBenefit.channel ?? null,
      payment_methods: input.normalizedBenefit.paymentMethods ?? null,
      cap_amount: input.normalizedBenefit.capAmount ?? null,
      terms_text: input.normalizedBenefit.termsText ?? null,
      source_url: input.normalizedBenefit.sourceUrl,
      redirect_url: typeof metadata.redirectUrl === "string" ? metadata.redirectUrl : null,
      image_url: typeof metadata.imageUrl === "string" ? metadata.imageUrl : null,
      logo_url: typeof metadata.logoUrl === "string" ? metadata.logoUrl : null,
      raw_title: input.rawBenefit.rawTitle ?? null,
      raw_category: input.rawBenefit.rawCategory ?? null,
      raw_merchant: input.rawBenefit.rawMerchant ?? null,
      raw_text: input.rawBenefit.rawText,
      raw_metadata: metadata,
      confidence_score: input.normalizedBenefit.confidenceScore,
      validation_status: input.normalizedBenefit.validationStatus,
      validation_errors: input.normalizedBenefit.validationErrors,
      last_seen_at: input.scrapedAt,
      last_scraped_at: input.scrapedAt,
      is_active: true,
      last_run_id: input.runId,
      updated_at: input.scrapedAt,
    };
  }

  private shouldReplaceBenefitInput(current: BenefitUpsertInput, candidate: BenefitUpsertInput): boolean {
    const currentScore = this.scoreBenefitInput(current);
    const candidateScore = this.scoreBenefitInput(candidate);

    if (candidateScore !== currentScore) {
      return candidateScore > currentScore;
    }

    return candidate.rawBenefit.rawText.length > current.rawBenefit.rawText.length;
  }

  private scoreBenefitInput(input: BenefitUpsertInput): number {
    const statusScore =
      input.normalizedBenefit.validationStatus === "valid"
        ? 3
        : input.normalizedBenefit.validationStatus === "needs_review"
          ? 2
          : 1;

    return statusScore * 10 + input.normalizedBenefit.confidenceScore;
  }
}

export const persistenceService = new PersistenceService();
