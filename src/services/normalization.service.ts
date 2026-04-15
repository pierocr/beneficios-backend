import { SIMPLE_CATEGORY_KEYWORDS } from "../config/categories";
import { MERCHANT_CATALOG, MerchantCatalogEntry } from "../config/merchants";
import { env } from "../config/env";
import {
  BenefitCategory,
  BenefitType,
  BenefitValueUnit,
  CategorySource,
  MerchantSource,
  NormalizedBenefit,
  RawBenefit,
} from "../types/benefit.types";
import { normalizeWhitespace, toLowerNormalized, truncateText } from "../utils/text";

const DAYS_MAP: Record<string, string> = {
  lunes: "lunes",
  martes: "martes",
  miercoles: "miercoles",
  jueves: "jueves",
  viernes: "viernes",
  sabado: "sabado",
  domingo: "domingo",
};

const CHANNEL_KEYWORDS: Record<string, string> = {
  online: "online",
  web: "web",
  app: "app",
  presencial: "presencial",
  tienda: "tienda",
};

const PAYMENT_KEYWORDS: Record<string, string> = {
  debito: "debito",
  credito: "credito",
  cmr: "cmr",
  tarjeta: "tarjeta",
};

interface ResolvedMerchant {
  merchantName: string;
  merchantCanonicalName: string;
  merchantSlug: string;
  merchantSource: MerchantSource;
  merchantMatchedAlias?: string;
  categoryFromCatalog?: BenefitCategory;
}

export class NormalizationService {
  normalize(rawBenefits: RawBenefit[]): NormalizedBenefit[] {
    return rawBenefits.map((rawBenefit) => this.normalizeOne(rawBenefit));
  }

  private normalizeOne(rawBenefit: RawBenefit): NormalizedBenefit {
    const metadata = rawBenefit.metadata ?? {};
    const text = normalizeWhitespace(rawBenefit.rawText);
    const lowerText = toLowerNormalized(text);
    const title = rawBenefit.rawTitle ? normalizeWhitespace(rawBenefit.rawTitle) : truncateText(text, 120);
    const benefitValue =
      this.extractNumericValue(this.getMetadataText(metadata.discountText)) ?? this.extractDiscountPercentage(lowerText);
    const benefitType = this.detectBenefitType(
      lowerText,
      benefitValue,
      this.getMetadataText(metadata.offerType),
      this.getMetadataStringArray(metadata.tags),
      this.getMetadataStringArray(metadata.categories),
    );
    const benefitValueUnit: BenefitValueUnit = benefitValue !== undefined ? "percent" : "unknown";
    const days = this.detectDays(this.buildDayText(text, metadata), rawBenefit.extractedAt);
    const channel = this.detectChannel(lowerText, metadata);
    const paymentMethods = this.detectPaymentMethods(lowerText, metadata);
    const rawMerchantName = this.resolveRawMerchant(rawBenefit, metadata, text);
    const resolvedMerchant = this.resolveMerchant(rawMerchantName, title, text);
    const { categoryName, categorySource } = this.resolveCategory(rawBenefit, resolvedMerchant, title, text);
    const capAmount =
      this.extractCapAmount(this.getMetadataText(metadata.capText) ?? "") ?? this.extractCapAmount(text);
    const confidenceScore = this.calculateConfidenceScore(
      resolvedMerchant.merchantCanonicalName,
      benefitType,
      benefitValue,
      days,
      categoryName,
    );

    const normalizedBenefit: NormalizedBenefit = {
      providerSlug: rawBenefit.providerSlug,
      bankName: rawBenefit.bankName,
      merchantName: resolvedMerchant.merchantName,
      merchantCanonicalName: resolvedMerchant.merchantCanonicalName,
      merchantSlug: resolvedMerchant.merchantSlug,
      merchantSource: resolvedMerchant.merchantSource,
      categoryName,
      categorySource,
      title,
      benefitType,
      benefitValueUnit,
      sourceUrl: rawBenefit.sourceUrl,
      confidenceScore,
      validationStatus: "needs_review",
      validationErrors: [],
    };

    if (resolvedMerchant.merchantMatchedAlias) {
      normalizedBenefit.merchantMatchedAlias = resolvedMerchant.merchantMatchedAlias;
    }

    if (benefitValue !== undefined) {
      normalizedBenefit.benefitValue = benefitValue;
    }

    if (days.length > 0) {
      normalizedBenefit.days = days;
    }

    if (channel.length > 0) {
      normalizedBenefit.channel = channel;
    }

    if (paymentMethods.length > 0) {
      normalizedBenefit.paymentMethods = paymentMethods;
    }

    if (capAmount !== undefined) {
      normalizedBenefit.capAmount = capAmount;
    }

    if (text) {
      normalizedBenefit.termsText = text;
    }

    return normalizedBenefit;
  }

  private extractDiscountPercentage(text: string): number | undefined {
    const match = text.match(/(\d{1,3})\s?%/);
    return match ? Number(match[1]) : undefined;
  }

  private extractNumericValue(text: string | undefined): number | undefined {
    if (!text) {
      return undefined;
    }

    const match = text.match(/(\d{1,3})/);
    return match ? Number(match[1]) : undefined;
  }

  private detectBenefitType(
    text: string,
    discountPercentage: number | undefined,
    offerType?: string,
    tags: string[] = [],
    categories: string[] = [],
  ): BenefitType {
    const normalizedOfferType = offerType ? toLowerNormalized(offerType) : "";
    const normalizedTags = tags.map((item) => toLowerNormalized(item));
    const normalizedCategories = categories.map((item) => toLowerNormalized(item));

    if (normalizedOfferType.includes("cashback") || normalizedTags.includes("cashback") || normalizedCategories.includes("cashback")) {
      return "cashback";
    }

    if (
      normalizedOfferType.includes("installment") ||
      normalizedTags.some((item) => item.includes("cuotas")) ||
      normalizedCategories.some((item) => item.includes("cuotas")) ||
      text.includes("cuotas sin interes")
    ) {
      return "installments";
    }

    if (text.includes("cashback")) {
      return "cashback";
    }

    if (text.includes("puntos") || text.includes("doble puntos") || /d[oó]lares?[- ]premio/.test(text) || text.includes("millas")) {
      return "points";
    }

    if (discountPercentage !== undefined || text.includes("descuento") || text.includes("dcto")) {
      return "discount";
    }

    return "unknown";
  }

  private detectDays(text: string, extractedAt: string): string[] {
    const detectedDays = Object.entries(DAYS_MAP)
      .filter(([keyword]) => text.includes(keyword))
      .map(([, normalizedDay]) => normalizedDay);

    if (text.includes("hoy")) {
      detectedDays.push(this.resolveCurrentBusinessDay(extractedAt));
    }

    if (text.includes("todos los dias")) {
      detectedDays.push(...Object.values(DAYS_MAP));
    }

    return Array.from(new Set(detectedDays));
  }

  private buildDayText(text: string, metadata: Record<string, unknown>): string {
    const metadataDayText = this.getMetadataText(metadata.dayText);
    const recurrenceLabel = this.getMetadataText(metadata.recurrenceLabel);
    const dayRecurrence = this.getMetadataStringArray(metadata.dayRecurrence);

    return toLowerNormalized([metadataDayText, recurrenceLabel, ...dayRecurrence, text].filter(Boolean).join(" "));
  }

  private detectChannel(text: string, metadata: Record<string, unknown>): string[] {
    const metadataPool = [
      text,
      this.getMetadataText(metadata.subtitle) ?? "",
      this.getMetadataText(metadata.description) ?? "",
      ...this.getMetadataStringArray(metadata.tags),
      ...this.getMetadataStringArray(metadata.categories),
    ].join(" ");

    return this.detectKeywordGroup(toLowerNormalized(metadataPool), CHANNEL_KEYWORDS);
  }

  private detectPaymentMethods(text: string, metadata: Record<string, unknown>): string[] {
    const metadataPool = [
      text,
      this.getMetadataText(metadata.subtitle) ?? "",
      this.getMetadataText(metadata.description) ?? "",
      this.getMetadataText(metadata.legalText) ?? "",
      ...this.getMetadataStringArray(metadata.tags),
      ...this.getMetadataStringArray(metadata.categories),
      ...this.getMetadataStringArray(metadata.paymentMethodHints),
      ...this.getMetadataStringArray(metadata.allowedCards),
    ].join(" ");

    const methods = this.detectKeywordGroup(toLowerNormalized(metadataPool), PAYMENT_KEYWORDS);
    const metadataText = toLowerNormalized(metadataPool);

    if (metadataText.includes("credito bci") && !methods.includes("credito")) {
      methods.push("credito");
    }

    if (metadataText.includes("debito bci") && !methods.includes("debito")) {
      methods.push("debito");
    }

    return Array.from(new Set(methods));
  }

  private detectKeywordGroup(text: string, keywordMap: Record<string, string>): string[] {
    const detected = Object.entries(keywordMap)
      .filter(([keyword]) => text.includes(keyword))
      .map(([, normalizedValue]) => normalizedValue);

    return Array.from(new Set(detected));
  }

  private extractMerchantName(text: string): string {
    const byContext = text.match(/(?:en|con)\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ&.\-]*(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ&.\-]*){0,3})/);

    if (byContext?.[1]) {
      return normalizeWhitespace(byContext[1]);
    }

    const upperSequence = text.match(/\b([A-ZÁÉÍÓÚÑ]{3,}(?:\s+[A-ZÁÉÍÓÚÑ0-9&.\-]{2,}){0,3})\b/);

    if (upperSequence?.[1]) {
      return normalizeWhitespace(upperSequence[1]);
    }

    return "Por definir";
  }

  private resolveRawMerchant(rawBenefit: RawBenefit, metadata: Record<string, unknown>, text: string): string {
    if (rawBenefit.rawMerchant) {
      return normalizeWhitespace(rawBenefit.rawMerchant);
    }

    const title = rawBenefit.rawTitle ? normalizeWhitespace(rawBenefit.rawTitle) : "";

    if (rawBenefit.providerSlug === "bci") {
      return this.extractMerchantNameForBci(title, metadata, text);
    }

    return this.extractMerchantName(text);
  }

  private extractMerchantNameForBci(title: string, metadata: Record<string, unknown>, text: string): string {
    const categoryTitles = this.getMetadataStringArray(metadata.categories).map((item) => toLowerNormalized(item));
    const titleLower = toLowerNormalized(title);

    if (
      title &&
      !categoryTitles.includes("paga en cuotas") &&
      !titleLower.startsWith("paga en ") &&
      !titleLower.includes("cashback en ")
    ) {
      return title
        .replace(/\s*-\s*descuento.*$/i, "")
        .replace(/\s*-\s*cashback.*$/i, "")
        .trim();
    }

    const tags = this.getMetadataStringArray(metadata.tags);
    const titleCandidate = this.findMerchantCatalogMatch(`${title} ${text}`);

    if (titleCandidate) {
      return titleCandidate.entry.canonicalName;
    }

    const viajesTag = tags.find((item) => toLowerNormalized(item).includes("viajes"));

    if (viajesTag && titleLower.includes("viajes")) {
      return "Viajes Bci";
    }

    return title || this.extractMerchantName(text);
  }

  private resolveMerchant(rawMerchantName: string, title: string, text: string): ResolvedMerchant {
    const cleanedMerchantName = this.cleanMerchantLabel(rawMerchantName);
    const cleanedTitle = this.cleanMerchantLabel(title);
    const catalogMatch =
      this.findMerchantCatalogMatch(cleanedMerchantName) ?? this.findMerchantCatalogMatch(`${cleanedTitle} ${text}`);

    if (catalogMatch) {
      return {
        merchantName: cleanedMerchantName,
        merchantCanonicalName: catalogMatch.entry.canonicalName,
        merchantSlug: catalogMatch.entry.slug,
        merchantSource: "catalog_alias",
        merchantMatchedAlias: catalogMatch.alias,
        categoryFromCatalog: catalogMatch.entry.categoryName,
      };
    }

    if (cleanedMerchantName && cleanedMerchantName !== "Por definir") {
      return {
        merchantName: cleanedMerchantName,
        merchantCanonicalName: cleanedMerchantName,
        merchantSlug: this.slugify(cleanedMerchantName),
        merchantSource: "raw_merchant",
      };
    }

    const extractedMerchantName = this.extractMerchantName(text);

    if (extractedMerchantName && extractedMerchantName !== "Por definir") {
      return {
        merchantName: extractedMerchantName,
        merchantCanonicalName: extractedMerchantName,
        merchantSlug: this.slugify(extractedMerchantName),
        merchantSource: "text_extraction",
      };
    }

    return {
      merchantName: "Por definir",
      merchantCanonicalName: "Por definir",
      merchantSlug: "por-definir",
      merchantSource: "fallback",
    };
  }

  private resolveCategory(
    rawBenefit: RawBenefit,
    resolvedMerchant: ResolvedMerchant,
    title: string,
    text: string,
  ): { categoryName: BenefitCategory; categorySource: CategorySource } {
    const providerCategory = this.mapToSimpleCategory(rawBenefit.rawCategory);

    if (providerCategory) {
      return {
        categoryName: providerCategory,
        categorySource: "provider",
      };
    }

    if (resolvedMerchant.categoryFromCatalog) {
      return {
        categoryName: resolvedMerchant.categoryFromCatalog,
        categorySource: "merchant_rule",
      };
    }

    const textCategory = this.matchCategoryByKeywords(`${title} ${text}`);

    if (textCategory) {
      return {
        categoryName: textCategory,
        categorySource: "text_rule",
      };
    }

    return {
      categoryName: "otros",
      categorySource: "fallback",
    };
  }

  private mapToSimpleCategory(rawCategory: string | undefined): BenefitCategory | undefined {
    if (!rawCategory) {
      return undefined;
    }

    return this.matchCategoryByKeywords(rawCategory);
  }

  private matchCategoryByKeywords(text: string): BenefitCategory | undefined {
    const normalizedText = toLowerNormalized(text);

    for (const [categoryName, keywords] of Object.entries(SIMPLE_CATEGORY_KEYWORDS) as [BenefitCategory, string[]][]) {
      if (categoryName === "otros") {
        continue;
      }

      if (keywords.some((keyword) => normalizedText.includes(toLowerNormalized(keyword)))) {
        return categoryName;
      }
    }

    return undefined;
  }

  private findMerchantCatalogMatch(text: string): { entry: MerchantCatalogEntry; alias: string } | undefined {
    const normalizedText = toLowerNormalized(text);

    for (const entry of MERCHANT_CATALOG) {
      const matchedAlias = entry.aliases.find((alias) => normalizedText.includes(toLowerNormalized(alias)));

      if (matchedAlias) {
        return {
          entry,
          alias: matchedAlias,
        };
      }
    }

    return undefined;
  }

  private extractCapAmount(text: string): number | undefined {
    const match = text.match(/\$\s?([\d.]+)/);

    if (!match?.[1]) {
      return undefined;
    }

    return Number(match[1].replace(/\./g, ""));
  }

  private getMetadataText(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
  }

  private cleanMerchantLabel(value: string): string {
    return normalizeWhitespace(value)
      .replace(/\s*d[oó]lares?[- ]premio\b/gi, "")
      .replace(/\s*-\s*descuento\b.*$/i, "")
      .replace(/\s*-\s*cashback\b.*$/i, "")
      .replace(/\s*-\s*cupon\b.*$/i, "")
      .trim();
  }

  private getMetadataStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }

  private resolveCurrentBusinessDay(extractedAt: string): string {
    const formatter = new Intl.DateTimeFormat("es-CL", {
      weekday: "long",
      timeZone: env.APP_TIMEZONE,
    });

    return formatter
      .format(new Date(extractedAt))
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  private slugify(value: string): string {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-");
  }

  private calculateConfidenceScore(
    merchantCanonicalName: string,
    benefitType: BenefitType,
    benefitValue: number | undefined,
    days: string[],
    categoryName: BenefitCategory,
  ): number {
    let score = 0.35;

    if (merchantCanonicalName !== "Por definir") {
      score += 0.2;
    }

    if (benefitType !== "unknown") {
      score += 0.2;
    }

    if (benefitValue !== undefined) {
      score += 0.15;
    }

    if (days.length > 0) {
      score += 0.05;
    }

    if (categoryName !== "otros") {
      score += 0.05;
    }

    return Math.min(Number(score.toFixed(2)), 0.99);
  }
}

export const normalizationService = new NormalizationService();
