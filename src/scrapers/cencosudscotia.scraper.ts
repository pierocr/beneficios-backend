import { chromium, BrowserContext, Page } from "playwright";
import { env } from "../config/env";
import { RawBenefit } from "../types/benefit.types";
import { logger } from "../utils/logger";
import { normalizeWhitespace } from "../utils/text";
import { BenefitScraper } from "./scraper.types";

const BENEFITS_HOME_URL = "https://www.tarjetacencosud.cl/publico/beneficios/landing/inicio";
const RUTA_DEL_SABOR_URL = "https://www.tarjetacencosud.cl/publico/beneficios/landing/la-ruta-del-sabor";
const SCRAPE_ATTEMPTS = 3;
const MIN_ACCEPTABLE_BENEFITS = 120;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

interface CencosudApiCard {
  id: number;
  is_active: boolean;
  title?: string;
  short_description?: string;
  long_description?: string;
  locations?: string[];
  legal_text?: string;
  keywords?: string[];
  categories?: string[];
  url?: string;
  logo_card?: string | null;
  banner_img?: string | null;
  card_img?: string | null;
}

interface CencosudRutaCard {
  title: string;
  description: string;
  merchantName: string;
  redirectUrl: string | undefined;
  imageUrl: string | undefined;
  logoUrl: string | undefined;
  location: string | undefined;
  schedule: string | undefined;
  legalText: string | undefined;
  routeCardKey: string;
}

export class CencosudScotiaScraper implements BenefitScraper {
  async scrape(): Promise<RawBenefit[]> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= SCRAPE_ATTEMPTS; attempt += 1) {
      const browser = await chromium.launch({
        headless: env.PLAYWRIGHT_HEADLESS,
      });

      try {
        const context = await browser.newContext({
          userAgent: DEFAULT_USER_AGENT,
          locale: "es-CL",
          viewport: { width: 1366, height: 900 },
        });

        const cardsFromApi = await this.loadCardsApi(context);
        const rutaCards = await this.loadRutaDelSaborCards(context);

        const apiBenefits = cardsFromApi
          .filter((card) => card.is_active)
          .filter((card) => !this.isRutaDelSaborHub(card))
          .map((card, index) => this.toRawBenefitFromApi(card, index));

        const rutaBenefits = rutaCards.map((card, index) => this.toRawBenefitFromRuta(card, apiBenefits.length + index));

        const allBenefits = [...apiBenefits, ...rutaBenefits];
        const uniqueBenefits = Array.from(
          new Map(
            allBenefits.map((item) => {
              const metadata = item.metadata ?? {};
              const key =
                (typeof metadata.cencosudBenefitId === "number" && `api:${metadata.cencosudBenefitId}`) ||
                (typeof metadata.routeCardKey === "string" && `ruta:${metadata.routeCardKey}`) ||
                `${item.rawTitle}:${item.sourceUrl}`;
              return [key, item];
            }),
          ).values(),
        );

        if (uniqueBenefits.length < MIN_ACCEPTABLE_BENEFITS) {
          throw new Error(
            `Suspicious Cencosud Scotiabank scrape result on attempt ${attempt}: expected at least ${MIN_ACCEPTABLE_BENEFITS} benefits and got ${uniqueBenefits.length}.`,
          );
        }

        return uniqueBenefits;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown error");
        logger.warn("Cencosud Scotiabank scrape attempt failed", {
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

    logger.error("Cencosud Scotiabank scraper failed", {
      message: lastError?.message ?? "Unknown error",
    });

    throw new Error(
      `Failed to scrape Tarjeta Cencosud Scotiabank benefits from ${BENEFITS_HOME_URL}: ${
        lastError?.message ?? "Unknown error"
      }`,
    );
  }

  private async loadCardsApi(context: BrowserContext): Promise<CencosudApiCard[]> {
    const page = await context.newPage();

    try {
      await page.goto(BENEFITS_HOME_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForTimeout(4000);

      return await page.evaluate(async () => {
        const decodeHtml = (value: string | undefined | null): string => {
          const source = value ?? "";
          const textarea = document.createElement("textarea");
          textarea.innerHTML = source;
          return textarea.value.replace(/\s+/g, " ").trim();
        };

        const api = (window as typeof window & {
          CardsAPI?: {
            getCards?: () => Promise<CencosudApiCard[]>;
          };
        }).CardsAPI;

        if (!api?.getCards) {
          return [];
        }

        const cards = await api.getCards();

        return cards.map((card) => ({
          ...card,
          title: decodeHtml(card.title),
          short_description: decodeHtml(card.short_description),
          long_description: decodeHtml(card.long_description),
          legal_text: decodeHtml(card.legal_text),
          keywords: (card.keywords ?? []).map((item) => decodeHtml(item)),
          categories: (card.categories ?? []).map((item) => decodeHtml(item)),
          locations: (card.locations ?? []).map((item) => decodeHtml(item)),
        }));
      });
    } finally {
      await page.close();
    }
  }

  private async loadRutaDelSaborCards(context: BrowserContext): Promise<CencosudRutaCard[]> {
    const page = await context.newPage();

    try {
      await page.goto(RUTA_DEL_SABOR_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForTimeout(4000);

      return await page.evaluate(() => {
        const clean = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
        const getImageUrl = (element: Element): string | undefined => {
          const images = Array.from(element.querySelectorAll("img"));
          const image = images.find((item) => {
            const alt = clean(item.getAttribute("alt")).toLowerCase();
            const src = item.currentSrc || item.src || item.getAttribute("src") || "";
            return Boolean(src) && !src.includes("arrow-right") && !src.endsWith(".svg") && !alt.includes("arrow");
          });

          return image?.currentSrc || image?.src || image?.getAttribute("src") || undefined;
        };

        return Array.from(document.querySelectorAll(".grilla_item"))
          .map((element) => {
            const anchor = element.querySelector("a.btn_landing") as HTMLAnchorElement | null;
            const imageUrl = getImageUrl(element);
            const title = clean(element.querySelector(".tit")?.textContent);
            const description = clean(element.querySelector(".desc")?.textContent);
            const bullets = Array.from(element.querySelectorAll("ul li")).map((item) => clean(item.textContent));
            const legalText = clean(element.querySelector("p.legal")?.textContent);
            const location = bullets[0] ?? "";
            const schedule = bullets[1] ?? "";
            const redirectUrl = anchor?.href || undefined;
            const routeCardKey = [title, location, schedule, redirectUrl ?? ""]
              .map((item) => clean(item).toLowerCase())
              .join("::");

            return {
              title,
              merchantName: title,
              description,
              redirectUrl,
              imageUrl,
              logoUrl: imageUrl,
              location,
              schedule,
              legalText,
              routeCardKey,
            };
          })
          .filter((item) => item.title.length > 0);
      });
    } finally {
      await page.close();
    }
  }

  private isRutaDelSaborHub(card: CencosudApiCard): boolean {
    return (
      /ruta del sabor/i.test(card.title ?? "") ||
      (card.url ?? "").includes("/landing/la-ruta-del-sabor")
    );
  }

  private toRawBenefitFromApi(card: CencosudApiCard, index: number): RawBenefit {
    const title = normalizeWhitespace(card.title ?? "Beneficio Tarjeta Cencosud Scotiabank");
    const shortDescription = normalizeWhitespace(card.short_description ?? "");
    const longDescription = normalizeWhitespace(card.long_description ?? "");
    const legalText = normalizeWhitespace(card.legal_text ?? "");
    const locations = (card.locations ?? []).map((item) => normalizeWhitespace(item)).filter(Boolean);
    const keywords = (card.keywords ?? []).map((item) => normalizeWhitespace(item)).filter(Boolean);
    const categories = (card.categories ?? []).map((item) => normalizeWhitespace(item)).filter(Boolean);
    const merchantName = this.extractMerchantFromApiTitle(title);
    const rawText = [title, shortDescription, longDescription, locations.join(" | "), legalText, keywords.join(" | "), categories.join(" | ")]
      .filter(Boolean)
      .join(" | ");

    const rawBenefit: RawBenefit = {
      providerSlug: "cencosudscotia",
      bankName: "Tarjeta Cencosud Scotiabank",
      sourceUrl: card.url ?? BENEFITS_HOME_URL,
      rawText,
      rawTitle: title,
      rawMerchant: merchantName,
      extractedAt: new Date().toISOString(),
      metadata: {
        index,
        cencosudBenefitId: card.id,
        redirectUrl: card.url ?? BENEFITS_HOME_URL,
        imageUrl: card.card_img ?? card.banner_img ?? card.logo_card ?? undefined,
        logoUrl: card.logo_card ?? undefined,
        shortDescription: shortDescription || undefined,
        longDescription: longDescription || undefined,
        legalText: legalText || undefined,
        categoryText: categories.join(" | ") || undefined,
        tagsText: keywords.join(" | ") || undefined,
        locationText: locations.join(" | ") || undefined,
        categories,
        tags: keywords,
        locations,
        offerType: this.detectOfferTypeFromCard(card),
      },
    };

    if (categories.length > 0) {
      rawBenefit.rawCategory = categories.join(" | ");
    }

    return rawBenefit;
  }

  private toRawBenefitFromRuta(card: CencosudRutaCard, index: number): RawBenefit {
    const title = normalizeWhitespace(card.title);
    const description = normalizeWhitespace(card.description);
    const location = normalizeWhitespace(card.location ?? "");
    const schedule = normalizeWhitespace(card.schedule ?? "");
    const legalText = normalizeWhitespace(card.legalText ?? "");
    const rawText = [title, description, location, schedule, legalText].filter(Boolean).join(" | ");

    return {
      providerSlug: "cencosudscotia",
      bankName: "Tarjeta Cencosud Scotiabank",
      sourceUrl: RUTA_DEL_SABOR_URL,
      rawText,
      rawTitle: title,
      rawMerchant: normalizeWhitespace(card.merchantName),
      rawCategory: "restaurantes",
      extractedAt: new Date().toISOString(),
      metadata: {
        index,
        routeCardKey: card.routeCardKey,
        sourceSection: "ruta-del-sabor",
        redirectUrl: card.redirectUrl ?? undefined,
        imageUrl: card.imageUrl ?? undefined,
        logoUrl: card.logoUrl ?? undefined,
        description: description || undefined,
        dayText: schedule || undefined,
        locationText: location || undefined,
        legalText: legalText || undefined,
        discountText: description || undefined,
        categories: ["restaurantes", "ruta-del-sabor"],
        tags: [location, schedule].filter(Boolean),
        offerType: "discount",
      },
    };
  }

  private extractMerchantFromApiTitle(title: string): string {
    const normalizedTitle = normalizeWhitespace(title);

    const cleaned = normalizedTitle
      .replace(/^(hasta\s+)?\d{1,3}\s*%\s*(de\s*)?(dcto|descuento)\.?\s*(en)?\s*/i, "")
      .replace(/^\d+\s*(a\s*\d+\s*)?cuotas?\s+sin\s+inter[eé]s\s+(en)?\s*/i, "")
      .replace(/^\d+\s*cuotas?\s+precio\s+contado\s*(en|exclusivo en)?\s*/i, "")
      .replace(/^\+?\d+(?:\.\d+)?\s*puntos?\s*(extra)?\s*(en|por)?\s*/i, "")
      .replace(/^agrega tu tarjeta cencosud scotiabank a /i, "")
      .replace(/^tu tarjeta es la entrada a /i, "")
      .trim();

    return cleaned || normalizedTitle;
  }

  private detectOfferTypeFromCard(card: CencosudApiCard): string {
    const text = `${card.title ?? ""} ${card.short_description ?? ""} ${(card.categories ?? []).join(" ")}`.toLowerCase();

    if (text.includes("cuotas")) {
      return "installments";
    }

    if (text.includes("puntos")) {
      return "points";
    }

    if (text.includes("cashback")) {
      return "cashback";
    }

    if (/%/.test(text) || text.includes("dcto") || text.includes("descuento")) {
      return "discount";
    }

    return "unknown";
  }
}
