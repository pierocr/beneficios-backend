import { RawBenefit } from "../types/benefit.types";
import { logger } from "../utils/logger";
import { htmlToText, normalizeWhitespace } from "../utils/text";
import { BenefitScraper } from "./scraper.types";

const SANTANDER_BENEFITS_URL = "https://banco.santander.cl/beneficios";
const SANTANDER_PROMOTIONS_API_URL = "https://banco.santander.cl/beneficios/promociones.json";
const SANTANDER_BANK_NAME = "Santander";
const SANTANDER_PROVIDER_SLUG = "santander";
const SANTANDER_ITEMS_PER_PAGE = 500;
const SANTANDER_SCRAPE_ATTEMPTS = 3;
const SANTANDER_MIN_ACCEPTABLE_PROMOTIONS = 250;
const SANTANDER_DEFAULT_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "es-CL,es;q=0.9",
  referer: SANTANDER_BENEFITS_URL,
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
};

const CATEGORY_TAG_LABELS: Record<string, string> = {
  "cat-multiplica-millas": "Multiplica millas",
  "cat-sabores": "Sabores",
  "cat-cuotas-sin-interes": "Cuotas sin interés",
  "cat-verdes": "Verdes",
  "cat-descuentos": "Descuentos",
  "cat-otros": "Tienda Santander",
};

const DAY_TAG_LABELS: Record<string, string> = {
  lunes: "Lunes",
  martes: "Martes",
  miercoles: "Miércoles",
  jueves: "Jueves",
  viernes: "Viernes",
  sabado: "Sábado",
  domingo: "Domingo",
  "todos-los-dias": "Todos los días",
};

const CARD_TAG_LABELS: Record<string, string> = {
  "todas-las-tarjetas": "Todas las tarjetas",
  "tarjetas-credito": "Crédito",
  "tarjeta-credito": "Crédito",
  "tarjetas-debito": "Débito",
  debitos: "Débito",
  "wm-limited": "WorldMember Limited",
  amex: "Amex",
  empresas: "Empresas",
  "latam-pass": "LATAM Pass",
  "life-y-debito": "Life y Débito",
};

interface SantanderApiResponse {
  promociones?: SantanderPromotion[];
  meta?: {
    total_entries?: number;
    per_page?: number;
    current_page?: number;
    total_pages?: number;
  };
}

interface SantanderCustomField {
  id?: number;
  value?: string | number | boolean | null;
}

interface SantanderPromotion {
  id: number;
  uuid?: string;
  created_at?: string;
  updated_at?: string;
  published_at?: string;
  url?: string;
  title?: string;
  slug?: string;
  excerpt?: string;
  description?: string;
  covers?: string[];
  tags?: string[];
  category?: string | null;
  site_id?: number;
  conditions?: string;
  start_date?: string | null;
  end_date?: string | null;
  discount?: string | number | null;
  location_street?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  custom_fields?: Record<string, SantanderCustomField | undefined>;
}

export class SantanderScraper implements BenefitScraper {
  async scrape(): Promise<RawBenefit[]> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= SANTANDER_SCRAPE_ATTEMPTS; attempt += 1) {
      try {
        const firstPage = await this.fetchPromotionsPage(1);
        const totalPages = firstPage.meta?.total_pages ?? 1;
        const totalEntries = firstPage.meta?.total_entries ?? 0;
        const promotions = [...(firstPage.promociones ?? [])];

        for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) {
          const pageResponse = await this.fetchPromotionsPage(pageNumber);
          promotions.push(...(pageResponse.promociones ?? []));
        }

        const uniquePromotions = Array.from(
          new Map(
            promotions.map((promotion) => [promotion.uuid ?? promotion.slug ?? String(promotion.id), promotion]),
          ).values(),
        );

        logger.info("Santander promotions fetched", {
          attempt,
          totalEntries,
          totalPages,
          promotionsDetected: uniquePromotions.length,
        });

        if (uniquePromotions.length < SANTANDER_MIN_ACCEPTABLE_PROMOTIONS) {
          throw new Error(
            `Suspicious Santander scrape result on attempt ${attempt}: expected at least ${SANTANDER_MIN_ACCEPTABLE_PROMOTIONS} promotions and got ${uniquePromotions.length}.`,
          );
        }

        if (totalEntries > 0 && uniquePromotions.length < totalEntries) {
          throw new Error(
            `Santander API returned ${uniquePromotions.length} unique promotions but reported ${totalEntries} total entries on attempt ${attempt}.`,
          );
        }

        return uniquePromotions.map((promotion, index) => this.toRawBenefit(promotion, index));
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown error");
        logger.warn("Santander scrape attempt failed", {
          attempt,
          message: lastError.message,
        });
      }

      if (attempt < SANTANDER_SCRAPE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }

    logger.error("Santander scraper failed", {
      message: lastError?.message ?? "Unknown error",
    });

    throw new Error(
      `Failed to scrape Santander benefits from ${SANTANDER_BENEFITS_URL}: ${lastError?.message ?? "Unknown error"}`,
    );
  }

  private async fetchPromotionsPage(pageNumber: number): Promise<SantanderApiResponse> {
    const searchParams = new URLSearchParams({
      per_page: String(SANTANDER_ITEMS_PER_PAGE),
      page: String(pageNumber),
      custom_fields: "true",
      tags: "home-disfrutadores",
      orderby: "updated_at",
      order: "desc",
    });

    const response = await fetch(`${SANTANDER_PROMOTIONS_API_URL}?${searchParams.toString()}`, {
      headers: SANTANDER_DEFAULT_HEADERS,
    });

    if (!response.ok) {
      throw new Error(`Santander promotions API returned ${response.status} on page ${pageNumber}.`);
    }

    return (await response.json()) as SantanderApiResponse;
  }

  private toRawBenefit(promotion: SantanderPromotion, index: number): RawBenefit {
    const title = normalizeWhitespace(promotion.title ?? "Beneficio Santander");
    const externalSubtitle = this.getCustomField(promotion, "Bajada externa");
    const internalSubtitle = this.getCustomField(promotion, "Bajada interna");
    const validityText = this.getCustomField(promotion, "Vigencia");
    const regionText = this.getCustomField(promotion, "Región cobertura");
    const communeText = this.getCustomField(promotion, "Comuna cobertura");
    const externalUrl = this.getCustomField(promotion, "Sitio web beneficio");
    const fortyLandingTitle = this.getCustomField(promotion, "Titulo en landing Cuarenta");
    const fortyLandingSubtitle = this.getCustomField(promotion, "Bajada en landing Cuarenta");
    const milesValidityText = this.getCustomField(promotion, "Validez en landing Mas millas");
    const metaDescription = this.getCustomField(promotion, "Meta Description");
    const descriptionText = htmlToText(promotion.description ?? "");
    const conditionsText = normalizeWhitespace(promotion.conditions ?? "");
    const categoryText = this.extractLabels(promotion.tags, CATEGORY_TAG_LABELS).join(" | ");
    const dayLabels = this.extractLabels(promotion.tags, DAY_TAG_LABELS);
    const cardLabels = this.extractLabels(promotion.tags, CARD_TAG_LABELS);
    const regionList = this.splitList(regionText);
    const communeList = this.splitList(communeText);
    const sourceUrl = promotion.url || this.buildDetailUrl(promotion.slug);
    const benefitLabel = normalizeWhitespace(externalSubtitle || internalSubtitle || String(promotion.discount ?? ""));

    const rawPieces = [
      title,
      benefitLabel,
      internalSubtitle,
      descriptionText,
      validityText,
      regionText,
      communeText,
      categoryText,
      dayLabels.join(" | "),
      cardLabels.join(" | "),
      conditionsText,
      metaDescription,
    ]
      .map((item) => normalizeWhitespace(item))
      .filter(Boolean);

    const rawBenefit: RawBenefit = {
      providerSlug: SANTANDER_PROVIDER_SLUG,
      bankName: SANTANDER_BANK_NAME,
      sourceUrl,
      rawTitle: benefitLabel ? `${title} - ${benefitLabel}` : title,
      rawMerchant: title,
      rawText: rawPieces.join(" | "),
      extractedAt: new Date().toISOString(),
      metadata: {
        index,
        sourceType: "modyo_promotions_api",
        promotionId: promotion.id,
        promotionUuid: promotion.uuid,
        promotionSlug: promotion.slug,
        textLength: rawPieces.join(" | ").length,
        imageUrl: promotion.covers?.[0],
        detailImageUrl: promotion.covers?.[1],
        redirectUrl: sourceUrl,
        externalUrl: externalUrl || undefined,
        benefitLabel: benefitLabel || undefined,
        excerpt: normalizeWhitespace(promotion.excerpt ?? "") || undefined,
        description: descriptionText || undefined,
        descriptionHtml: promotion.description || undefined,
        legalText: conditionsText || undefined,
        validityText: validityText || undefined,
        startDate: promotion.start_date,
        endDate: promotion.end_date,
        publishedAt: promotion.published_at,
        updatedAt: promotion.updated_at,
        createdAt: promotion.created_at,
        categoryText: categoryText || undefined,
        categories: categoryText ? categoryText.split(" | ") : [],
        tags: promotion.tags ?? [],
        tagsText: (promotion.tags ?? []).join(" | "),
        dayLabels,
        paymentMethodHints: cardLabels,
        regions: regionList,
        communes: communeList,
        regionText: regionText || undefined,
        communeText: communeText || undefined,
        fortyLandingTitle: fortyLandingTitle || undefined,
        fortyLandingSubtitle: fortyLandingSubtitle || undefined,
        milesValidityText: milesValidityText || undefined,
        metaDescription: metaDescription || undefined,
        latitude: promotion.latitude,
        longitude: promotion.longitude,
        locationStreet: promotion.location_street,
      },
    };

    if (categoryText) {
      rawBenefit.rawCategory = categoryText;
    }

    return rawBenefit;
  }

  private getCustomField(promotion: SantanderPromotion, fieldName: string): string {
    const value = promotion.custom_fields?.[fieldName]?.value;

    if (value === undefined || value === null || value === false) {
      return "";
    }

    return normalizeWhitespace(String(value));
  }

  private extractLabels(tags: string[] | undefined, labelsByTag: Record<string, string>): string[] {
    return (tags ?? [])
      .map((tag) => labelsByTag[tag])
      .filter((label): label is string => Boolean(label));
  }

  private splitList(value: string): string[] {
    return value
      .split(",")
      .map((item) => normalizeWhitespace(item))
      .filter(Boolean);
  }

  private buildDetailUrl(slug: string | undefined): string {
    if (!slug) {
      return SANTANDER_BENEFITS_URL;
    }

    return `${SANTANDER_BENEFITS_URL}/promociones/${slug}`;
  }
}
