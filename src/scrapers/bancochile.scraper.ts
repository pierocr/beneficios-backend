import { chromium, BrowserContext } from "playwright";
import { env } from "../config/env";
import { RawBenefit } from "../types/benefit.types";
import { logger } from "../utils/logger";
import { htmlToText, normalizeWhitespace } from "../utils/text";
import { BenefitScraper } from "./scraper.types";

const BANCO_CHILE_CATEGORY_URL = "https://sitiospublicos.bancochile.cl/personas/beneficios/categoria#todos";
const BANCO_CHILE_API_BASE_URL = "https://sitiospublicos.bancochile.cl/api/content/spaces/personas/types/beneficios/entries";
const BANCO_CHILE_DETAIL_URL = "https://sitiospublicos.bancochile.cl/personas/beneficios/detalle";
const ITEMS_PER_PAGE = 100;
const SCRAPE_ATTEMPTS = 3;
const MIN_ACCEPTABLE_BENEFITS = 700;
const DEFAULT_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "es-CL,es;q=0.9",
  referer: "https://sitiospublicos.bancochile.cl/personas/beneficios/categoria",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
};

interface BancoChileApiResponse {
  entries?: BancoChileEntry[];
  meta?: {
    total_entries?: number;
    per_page?: number;
    current_page?: number;
    total_pages?: number;
  };
}

interface BancoChileEntry {
  meta: {
    name?: string;
    slug?: string;
    tags?: string[];
    type?: string;
    uuid?: string;
    excerpt?: string;
    category?: string | null;
    category_name?: string | null;
    category_slug?: string | null;
    created_at?: string;
    updated_at?: string;
    published_at?: string;
    unpublish_at?: string | null;
  };
  fields: {
    Titulo?: string;
    Extracto?: string;
    Keywords?: string;
    Vigencia?: string;
    Descripcion?: string;
    "Tipo Beneficio"?: string;
    "Condiciones Comerciales"?: string;
    "Tarjetas Permitidas"?: string[];
    Sucursales?: string;
    Logo?: {
      url?: string;
      thumb?: string;
    };
    Portada?: {
      url?: string;
      thumb?: string;
    };
    "Url Beneficio Externa"?: string;
    "Sitio web"?: string;
    "Call To Action"?: string;
    Url?: string;
  };
}

interface BancoChileBranch {
  name?: string;
  address?: string;
  region?: string;
  commune?: string;
  latitude?: number;
  longitude?: number;
}

export class BancoChileScraper implements BenefitScraper {
  async scrape(): Promise<RawBenefit[]> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= SCRAPE_ATTEMPTS; attempt += 1) {
      const browser = await chromium.launch({
        headless: env.PLAYWRIGHT_HEADLESS,
      });

      try {
        const context = await browser.newContext({
          userAgent: DEFAULT_HEADERS["user-agent"],
          locale: "es-CL",
          viewport: { width: 1366, height: 900 },
        });

        const firstPage = await this.fetchPage(context, 1);
        const totalPages = firstPage.meta?.total_pages ?? 1;
        const totalEntries = firstPage.meta?.total_entries ?? 0;
        const entries = [...(firstPage.entries ?? [])];

        for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) {
          const pageResponse = await this.fetchPage(context, pageNumber);
          entries.push(...(pageResponse.entries ?? []));
        }

        const uniqueEntries = Array.from(
          new Map(entries.map((entry) => [entry.meta.uuid ?? entry.meta.slug ?? "", entry])).values(),
        ).filter((entry) => Boolean(entry.meta.uuid ?? entry.meta.slug));

        if (uniqueEntries.length < MIN_ACCEPTABLE_BENEFITS) {
          throw new Error(
            `Suspicious Banco de Chile scrape result on attempt ${attempt}: expected at least ${MIN_ACCEPTABLE_BENEFITS} entries and got ${uniqueEntries.length}.`,
          );
        }

        if (totalEntries > 0 && uniqueEntries.length < totalEntries) {
          throw new Error(
            `Banco de Chile API returned ${uniqueEntries.length} unique entries but reported ${totalEntries} total entries on attempt ${attempt}.`,
          );
        }

        return uniqueEntries.map((entry, index) => this.toRawBenefit(entry, index));
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown error");
        logger.warn("Banco de Chile scrape attempt failed", {
          attempt,
          message: lastError.message,
        });
      } finally {
        await browser.close();
      }

      if (attempt < SCRAPE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }

    logger.error("Banco de Chile scraper failed", {
      message: lastError?.message ?? "Unknown error",
    });

    throw new Error(
      `Failed to scrape Banco de Chile benefits from ${BANCO_CHILE_CATEGORY_URL}: ${
        lastError?.message ?? "Unknown error"
      }`,
    );
  }

  private async fetchPage(context: BrowserContext, pageNumber: number): Promise<BancoChileApiResponse> {
    const response = await context.request.get(
      `${BANCO_CHILE_API_BASE_URL}?page=${pageNumber}&per_page=${ITEMS_PER_PAGE}`,
      {
        headers: DEFAULT_HEADERS,
        timeout: 60000,
      },
    );

    if (!response.ok()) {
      throw new Error(`Banco de Chile API returned ${response.status()} on page ${pageNumber}.`);
    }

    return (await response.json()) as BancoChileApiResponse;
  }

  private toRawBenefit(entry: BancoChileEntry, index: number): RawBenefit {
    const title = normalizeWhitespace(entry.fields.Titulo ?? entry.meta.name ?? "Beneficio Banco de Chile");
    const excerpt = normalizeWhitespace(entry.fields.Extracto ?? entry.meta.excerpt ?? "");
    const benefitLabel = normalizeWhitespace(entry.fields["Tipo Beneficio"] ?? "");
    const vigencyText = normalizeWhitespace(entry.fields.Vigencia ?? "");
    const descriptionHtml = entry.fields.Descripcion ?? "";
    const conditionsText = normalizeWhitespace(entry.fields["Condiciones Comerciales"] ?? "");
    const descriptionText = htmlToText(descriptionHtml);
    const keywordsText = normalizeWhitespace(entry.fields.Keywords ?? "");
    const categoryText = normalizeWhitespace(
      [entry.meta.category_name, entry.meta.category_slug, entry.meta.category].filter(Boolean).join(" | "),
    );
    const tagText = (entry.meta.tags ?? []).map((tag) => normalizeWhitespace(tag)).filter(Boolean).join(" | ");
    const rawText = [
      title,
      benefitLabel,
      excerpt,
      vigencyText,
      descriptionText,
      conditionsText,
      keywordsText,
      categoryText,
      tagText,
    ]
      .map((value) => normalizeWhitespace(value))
      .filter(Boolean)
      .join(" | ");

    const slug = entry.meta.slug ?? entry.meta.uuid ?? `beneficio-${index}`;
    const detailUrl = `${BANCO_CHILE_DETAIL_URL}/${slug}`;
    const branches = this.parseBranches(entry.fields.Sucursales);
    const allowedCards = (entry.fields["Tarjetas Permitidas"] ?? []).map((item) => normalizeWhitespace(item));
    const paymentMethodHints = this.buildPaymentMethodHints(allowedCards);
    const externalUrl = this.resolveExternalUrl(entry);

    const rawBenefit: RawBenefit = {
      providerSlug: "bancochile",
      bankName: "Banco de Chile",
      sourceUrl: detailUrl,
      rawText,
      rawTitle: title,
      rawMerchant: title,
      extractedAt: new Date().toISOString(),
      metadata: {
        index,
        benefitUuid: entry.meta.uuid,
        benefitSlug: entry.meta.slug,
        contentType: entry.meta.type,
        textLength: rawText.length,
        redirectUrl: detailUrl,
        imageUrl: entry.fields.Portada?.url ?? entry.fields.Portada?.thumb,
        logoUrl: entry.fields.Logo?.url ?? entry.fields.Logo?.thumb,
        excerpt: excerpt || undefined,
        benefitLabel: benefitLabel || undefined,
        description: descriptionText || undefined,
        descriptionHtml: descriptionHtml || undefined,
        legalText: conditionsText || undefined,
        keywordsText: keywordsText || undefined,
        categoryText: categoryText || undefined,
        tagsText: tagText || undefined,
        tags: entry.meta.tags ?? [],
        categories: categoryText ? [categoryText] : [],
        allowedCards,
        paymentMethodHints,
        vigencyText: vigencyText || undefined,
        branches,
        branchCount: branches.length,
        externalUrl: externalUrl || undefined,
        publishedAt: entry.meta.published_at,
        updatedAt: entry.meta.updated_at,
        unpublishAt: entry.meta.unpublish_at,
      },
    };

    if (categoryText) {
      rawBenefit.rawCategory = categoryText;
    }

    return rawBenefit;
  }

  private resolveExternalUrl(entry: BancoChileEntry): string | undefined {
    const candidates = [
      entry.fields["Url Beneficio Externa"],
      entry.fields["Sitio web"],
      entry.fields.Url,
      entry.fields["Call To Action"],
    ];

    return candidates
      .map((value) => normalizeWhitespace(value ?? ""))
      .find((value) => value.length > 0 && /^https?:\/\//i.test(value));
  }

  private buildPaymentMethodHints(allowedCards: string[]): string[] {
    const hints = new Set<string>();

    for (const card of allowedCards) {
      if (card.includes("credito")) {
        hints.add("credito");
      }

      if (card.includes("debito") || card.includes("cuenta-fan")) {
        hints.add("debito");
      }

      if (card.includes("visa")) {
        hints.add("visa");
      }

      if (card.includes("mastercard")) {
        hints.add("mastercard");
      }
    }

    return Array.from(hints);
  }

  private parseBranches(value: string | undefined): BancoChileBranch[] {
    if (!value) {
      return [];
    }

    const lines = value
      .split(/<\/li>/i)
      .map((line) => htmlToText(line))
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean);

    return lines.map((line) => {
      const parts = line
        .split(";")
        .map((part) => normalizeWhitespace(part).replace(/^-+\s*/, ""))
        .filter(Boolean);

      const [name, address, region, commune, extra, latitude, longitude] = parts;
      const branch: BancoChileBranch = {};

      if (name && name !== "VACIO") {
        branch.name = name;
      }

      if (address && address !== "VACIO") {
        branch.address = address;
      }

      if (region && region !== "VACIO") {
        branch.region = region;
      }

      if (commune && commune !== "VACIO") {
        branch.commune = commune;
      }

      const lat = Number(latitude ?? extra);
      const lng = Number(longitude);

      if (Number.isFinite(lat)) {
        branch.latitude = lat;
      }

      if (Number.isFinite(lng)) {
        branch.longitude = lng;
      }

      return branch;
    });
  }
}
