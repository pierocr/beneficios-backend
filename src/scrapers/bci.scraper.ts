import { chromium, Page } from "playwright";
import { env } from "../config/env";
import { RawBenefit } from "../types/benefit.types";
import { logger } from "../utils/logger";
import { normalizeWhitespace } from "../utils/text";
import { BenefitScraper } from "./scraper.types";

const BCI_BENEFITS_URL = "https://www.bci.cl/beneficios/beneficios-bci/todas";
const BCI_OFFERS_API_URL = "https://api.bciplus.cl/bff-loyalty-beneficios/v1/offers";
const BCI_ITEMS_PER_PAGE = 100;
const BCI_SCRAPE_ATTEMPTS = 3;
const BCI_MIN_ACCEPTABLE_OFFERS = 150;
const BCI_DEFAULT_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "es-CL",
  referer: "https://www.bci.cl/",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

interface BciApiResponse {
  paginado?: {
    cantidadTotal?: number;
    itemsPorPagina?: number;
    paginaActual?: number;
    totalPaginas?: number;
  };
  ofertas?: BciOffer[];
}

interface BciOffer {
  id: string;
  titulo?: string;
  subtitulo?: string;
  descripcion?: string;
  legal?: string;
  tipoOfertaPrincipal?: string;
  fechaInicio?: string;
  fechaTermino?: string;
  slug?: string;
  link?: string;
  categorias?: Array<{ titulo?: string }>;
  tags?: Array<{ nombre?: string }>;
  imagenes?: {
    imagen1?: string;
    imagen2?: string;
    imagen3?: string;
    imagen4?: string;
  };
  comercio?: {
    id?: string;
    nombre?: string;
  };
  beneficio?: {
    discount?: {
      porcentajeDescuento?: number;
    };
  };
  deal?: {
    discount?: {
      percentage?: number;
    };
  };
  partners?: Array<{ nombre?: string; codigo?: string }>;
  scheduling?: {
    isRecurrent?: boolean;
    dayRecurrence?: string[];
    recurrenceLabel?: string;
  };
  tracking?: {
    condiciones?: string;
    exclusiones?: string;
  };
}

export class BciScraper implements BenefitScraper {
  async scrape(): Promise<RawBenefit[]> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= BCI_SCRAPE_ATTEMPTS; attempt += 1) {
      const browser = await chromium.launch({
        headless: env.PLAYWRIGHT_HEADLESS,
      });

      try {
        const context = await browser.newContext({
          userAgent: BCI_DEFAULT_HEADERS["user-agent"],
          locale: "es-CL",
          viewport: { width: 1366, height: 900 },
        });
        const page = await context.newPage();
        const subscriptionKeyPromise = this.captureSubscriptionKey(page);

        await page.goto(BCI_BENEFITS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(5000);

        const subscriptionKey = await subscriptionKeyPromise;

        if (!subscriptionKey) {
          throw new Error("Could not capture BCI API subscription key from page requests.");
        }

        const firstPage = await this.fetchOffersPage(context, 1, subscriptionKey);
        const totalPages = firstPage.paginado?.totalPaginas ?? 1;
        const offers = [...(firstPage.ofertas ?? [])];

        for (let currentPage = 2; currentPage <= totalPages; currentPage += 1) {
          const pageResponse = await this.fetchOffersPage(context, currentPage, subscriptionKey);
          offers.push(...(pageResponse.ofertas ?? []));
        }

        const uniqueOffers = Array.from(new Map(offers.map((offer) => [offer.id, offer])).values());

        if (uniqueOffers.length < BCI_MIN_ACCEPTABLE_OFFERS) {
          throw new Error(
            `Suspicious BCI scrape result on attempt ${attempt}: expected at least ${BCI_MIN_ACCEPTABLE_OFFERS} offers and got ${uniqueOffers.length}.`,
          );
        }

        return uniqueOffers.map((offer, index) => this.toRawBenefit(offer, index));
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown error");
        logger.warn("BCI scrape attempt failed", {
          attempt,
          message: lastError.message,
        });
      } finally {
        await browser.close();
      }

      if (attempt < BCI_SCRAPE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }

    logger.error("BCI scraper failed", {
      message: lastError?.message ?? "Unknown error",
    });

    throw new Error(`Failed to scrape BCI benefits from ${BCI_BENEFITS_URL}: ${lastError?.message ?? "Unknown error"}`);
  }

  private captureSubscriptionKey(page: Page): Promise<string | undefined> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(undefined), 15000);

      page.on("request", (request) => {
        if (!request.url().includes(BCI_OFFERS_API_URL)) {
          return;
        }

        const subscriptionKey = request.headers()["ocp-apim-subscription-key"];

        if (!subscriptionKey) {
          return;
        }

        clearTimeout(timeout);
        resolve(subscriptionKey);
      });
    });
  }

  private async fetchOffersPage(
    context: Awaited<ReturnType<typeof chromium.launch>> extends never ? never : import("playwright").BrowserContext,
    pageNumber: number,
    subscriptionKey: string,
  ): Promise<BciApiResponse> {
    const response = await context.request.get(
      `${BCI_OFFERS_API_URL}?itemsPorPagina=${BCI_ITEMS_PER_PAGE}&pagina=${pageNumber}`,
      {
        headers: {
          ...BCI_DEFAULT_HEADERS,
          "ocp-apim-subscription-key": subscriptionKey,
        },
        timeout: 60000,
      },
    );

    if (!response.ok()) {
      throw new Error(`BCI offers API returned ${response.status()} on page ${pageNumber}.`);
    }

    return (await response.json()) as BciApiResponse;
  }

  private toRawBenefit(offer: BciOffer, index: number): RawBenefit {
    const discountValue =
      offer.beneficio?.discount?.porcentajeDescuento ?? offer.deal?.discount?.percentage ?? undefined;
    const recurrenceText = this.buildRecurrenceText(offer);
    const categoryText = offer.categorias?.map((item) => item.titulo).filter(Boolean).join(" | ") ?? "";
    const tagsText = offer.tags?.map((item) => item.nombre).filter(Boolean).join(" | ") ?? "";
    const merchantName = normalizeWhitespace(offer.comercio?.nombre ?? offer.titulo ?? "Por definir");
    const title = normalizeWhitespace(offer.comercio?.nombre ?? offer.titulo ?? merchantName);
    const description = normalizeWhitespace(offer.subtitulo ?? offer.descripcion ?? "");
    const legalText = normalizeWhitespace(offer.legal ?? "");
    const subtitle = normalizeWhitespace(offer.subtitulo ?? "");
    const redirectUrl = offer.slug ? `https://www.bci.cl/beneficios/beneficios-bci/detalle/${offer.slug}` : offer.link || BCI_BENEFITS_URL;
    const benefitLabel =
      discountValue !== undefined && discountValue > 0
        ? `${discountValue}% descuento`
        : normalizeWhitespace(offer.tipoOfertaPrincipal ?? "");

    const rawPieces = [title, benefitLabel, description, recurrenceText, categoryText, tagsText, legalText]
      .map((item) => normalizeWhitespace(item))
      .filter(Boolean);

    const rawBenefit: RawBenefit = {
      providerSlug: "bci",
      bankName: "Bci",
      sourceUrl: redirectUrl,
      rawText: rawPieces.join(" | "),
      extractedAt: new Date().toISOString(),
      metadata: {
        index,
        offerId: offer.id,
        textLength: rawPieces.join(" | ").length,
        imageUrl: offer.imagenes?.imagen1,
        redirectUrl,
        recurrenceText: recurrenceText || undefined,
        subtitle: subtitle || undefined,
        description: normalizeWhitespace(offer.descripcion ?? "") || undefined,
        legalText: legalText || undefined,
        tagsText: tagsText || undefined,
        categoryText: categoryText || undefined,
        offerType: offer.tipoOfertaPrincipal,
        partnerNames: offer.partners?.map((item) => item.nombre).filter(Boolean) ?? [],
        merchantId: offer.comercio?.id,
        tags: offer.tags?.map((item) => item.nombre).filter(Boolean) ?? [],
        categories: offer.categorias?.map((item) => item.titulo).filter(Boolean) ?? [],
        dayRecurrence: offer.scheduling?.dayRecurrence ?? [],
        recurrenceLabel: offer.scheduling?.recurrenceLabel,
        isRecurrent: offer.scheduling?.isRecurrent ?? false,
        conditions: normalizeWhitespace(offer.tracking?.condiciones ?? "") || undefined,
        exclusions: normalizeWhitespace(offer.tracking?.exclusiones ?? "") || undefined,
        startDate: offer.fechaInicio,
        endDate: offer.fechaTermino,
      },
    };

    if (title) {
      rawBenefit.rawTitle = title;
    }

    if (merchantName) {
      rawBenefit.rawMerchant = merchantName;
    }

    if (categoryText) {
      rawBenefit.rawCategory = categoryText;
    }

    return rawBenefit;
  }

  private buildRecurrenceText(offer: BciOffer): string {
    const fromSchedule = offer.scheduling?.dayRecurrence?.map((value) => normalizeWhitespace(value)).filter(Boolean);

    if (fromSchedule && fromSchedule.length > 0) {
      return fromSchedule.join(", ");
    }

    return normalizeWhitespace(offer.scheduling?.recurrenceLabel ?? "");
  }
}
