import { BrowserContext, chromium } from "playwright";
import { env } from "../config/env";
import { RawBenefit } from "../types/benefit.types";
import { logger } from "../utils/logger";
import { normalizeWhitespace, uniqueStrings } from "../utils/text";
import { BenefitScraper } from "./scraper.types";

const TENPO_BENEFITS_URL = "https://www.tenpo.cl/beneficios";
const TENPO_SCRAPE_ATTEMPTS = 3;
const TENPO_MIN_ACCEPTABLE_BENEFITS = 40;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

interface TenpoListCardData {
  sourceUrl: string;
  benefitPath: string;
  title: string;
  summary: string;
  merchantName: string;
  paymentMethods: string[];
  category: string;
  city: string;
  dayLabels: string[];
  backgroundImageUrl?: string;
  logoImageUrl?: string;
}

interface TenpoDetailData {
  benefitTitle: string;
  detailText: string;
  validityText: string;
  termsLabel: string;
  termsSourceText: string;
  headline: string;
  description: string;
  imageUrl?: string;
}

export class TenpoScraper implements BenefitScraper {
  async scrape(): Promise<RawBenefit[]> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= TENPO_SCRAPE_ATTEMPTS; attempt += 1) {
      const browser = await chromium.launch({
        headless: env.PLAYWRIGHT_HEADLESS,
      });

      try {
        const context = await browser.newContext({
          userAgent: DEFAULT_USER_AGENT,
          locale: "es-CL",
          viewport: { width: 1366, height: 900 },
        });

        await this.blockHeavyResources(context);

        const listCards = await this.loadAllCards(context);
        const benefits: RawBenefit[] = [];

        for (const [index, card] of listCards.entries()) {
          const detail = await this.loadDetail(context, card);
          benefits.push(this.toRawBenefit(card, detail, index));
        }

        const uniqueBenefits = Array.from(
          new Map(benefits.map((benefit) => [benefit.sourceUrl, benefit])).values(),
        );

        if (uniqueBenefits.length < TENPO_MIN_ACCEPTABLE_BENEFITS) {
          throw new Error(
            `Suspicious Tenpo scrape result on attempt ${attempt}: expected at least ${TENPO_MIN_ACCEPTABLE_BENEFITS} benefits and got ${uniqueBenefits.length}.`,
          );
        }

        return uniqueBenefits;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown error");
        logger.warn("Tenpo scrape attempt failed", {
          attempt,
          message: lastError.message,
        });
      } finally {
        await browser.close();
      }

      if (attempt < TENPO_SCRAPE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }

    logger.error("Tenpo scraper failed", {
      message: lastError?.message ?? "Unknown error",
    });

    throw new Error(
      `Failed to scrape Tenpo benefits from ${TENPO_BENEFITS_URL}: ${lastError?.message ?? "Unknown error"}`,
    );
  }

  private async blockHeavyResources(context: BrowserContext): Promise<void> {
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      const resourceType = request.resourceType();

      if (["image", "media", "font"].includes(resourceType)) {
        await route.abort();
        return;
      }

      if (
        url.includes("google-analytics.com") ||
        url.includes("googletagmanager.com") ||
        url.includes("googleadservices.com") ||
        url.includes("doubleclick.net") ||
        url.includes("facebook.net") ||
        url.includes("linkedin.com") ||
        url.includes("ads-twitter.com") ||
        url.includes("analytics.tiktok.com") ||
        url.includes("bing.com") ||
        url.includes("clevertap") ||
        url.includes("singular.net")
      ) {
        await route.abort();
        return;
      }

      await route.continue();
    });
  }

  private async loadAllCards(context: BrowserContext): Promise<TenpoListCardData[]> {
    const page = await context.newPage();
    const cards = new Map<string, TenpoListCardData>();

    try {
      for (let pageNumber = 1; pageNumber <= 20; pageNumber += 1) {
        const pageUrl =
          pageNumber === 1 ? TENPO_BENEFITS_URL : `${TENPO_BENEFITS_URL}?ca01dc3d_page=${pageNumber}`;

        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
        await page.waitForTimeout(2000);

        const result = await page.evaluate(() => {
          const clean = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
          const parseStyleImage = (value: string | null | undefined): string | undefined => {
            const source = clean(value);

            if (!source.toLowerCase().startsWith("url(") || !source.endsWith(")")) {
              return undefined;
            }

            return clean(source.slice(4, -1).trim().replace(/^['"]|['"]$/g, ""));
          };
          const toAbsoluteUrl = (value: string): string => {
            try {
              return new URL(value, window.location.origin).toString();
            } catch {
              return clean(value);
            }
          };

          const pageCards = Array.from(document.querySelectorAll(".beneficio-collection-item")).map((node) => {
            const anchor = node.querySelector("a.cta-beneficio") as HTMLAnchorElement | null;
            const headCard = node.querySelector(".head-card") as HTMLElement | null;
            const logo = node.querySelector(".brand-partner") as HTMLImageElement | null;
            const hiddenName =
              node.querySelector('[fs-cmsfilter-field="Name"]')?.textContent ??
              node.querySelector(".brand-partner")?.getAttribute("alt") ??
              "";

            const paymentMethods = Array.from(
              node.querySelectorAll(
                '.bullets-categorias > .categor-as-beneficios-bullet[fs-cmsfilter-field="Tipo"]',
              ),
            )
              .map((item) => clean(item.textContent))
              .filter(Boolean);

            const dayLabels = Array.from(node.querySelectorAll(".cat-dias .dia-abrev"))
              .map((item) => clean(item.textContent))
              .filter(Boolean);

            const sourcePath = clean(anchor?.getAttribute("href"));

            return {
              sourceUrl: sourcePath ? toAbsoluteUrl(sourcePath) : "",
              benefitPath: sourcePath,
              title: clean(node.querySelector(".titulo-beneficio-all")?.textContent),
              summary: clean(node.querySelector(".p-text-beneficio-copy")?.textContent),
              merchantName: clean(hiddenName),
              paymentMethods,
              category: clean(node.querySelector('[fs-cmsfilter-field="Categoria"]')?.textContent),
              city: clean(node.querySelector('[fs-cmsfilter-field="Ciudad"]')?.textContent),
              dayLabels,
              backgroundImageUrl: parseStyleImage(headCard?.style?.backgroundImage),
              logoImageUrl: clean(logo?.src),
            };
          });

          const nextHref = clean(
            document.querySelector("a.w-pagination-next.paginacion-beneficios")?.getAttribute("href"),
          );

          return {
            cards: pageCards,
            nextHref,
          };
        });

        let newCards = 0;

        for (const card of result.cards.map((item) => this.normalizeListCard(item as TenpoListCardData))) {
          if (!card.sourceUrl || !card.title) {
            continue;
          }

          if (!cards.has(card.sourceUrl)) {
            cards.set(card.sourceUrl, card);
            newCards += 1;
          }
        }

        if (result.cards.length === 0 || newCards === 0 || !result.nextHref) {
          break;
        }
      }

      return Array.from(cards.values());
    } finally {
      await page.close();
    }
  }

  private async loadDetail(context: BrowserContext, card: TenpoListCardData): Promise<TenpoDetailData | undefined> {
    const page = await context.newPage();

    try {
      await page.goto(card.sourceUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForTimeout(1500);

      const detail = await page.evaluate(() => {
        const clean = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
        const safeJsonParse = (value: string): unknown => {
          try {
            return JSON.parse(value);
          } catch {
            return undefined;
          }
        };

        const jsonLdItems = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
          .map((script) => safeJsonParse(script.textContent ?? ""))
          .flatMap((item) => {
            if (!item) {
              return [];
            }

            if (Array.isArray(item)) {
              return item;
            }

            return [item];
          })
          .filter((item) => typeof item === "object" && item !== null) as Array<Record<string, unknown>>;

        const article = jsonLdItems.find((item) => item["@type"] === "Article") ?? {};

        return {
          benefitTitle: clean(document.querySelector("h1.titulo-beneficio-big")?.textContent),
          detailText: clean(document.querySelector(".all-text-beneficios")?.textContent),
          validityText: clean(document.querySelector(".lista-destacada-beneficios .text-block-117")?.textContent),
          termsLabel: clean(document.querySelector(".lista-destacada-beneficios .link-bases-legales")?.textContent),
          termsSourceText: clean(document.querySelector(".lista-destacada-beneficios .tyc")?.textContent),
          headline: clean(typeof article.headline === "string" ? article.headline : ""),
          description: clean(typeof article.description === "string" ? article.description : ""),
          imageUrl: clean(typeof article.image === "string" ? article.image : ""),
        };
      });

      return this.normalizeDetail(detail as TenpoDetailData);
    } catch (error) {
      const detailError = error instanceof Error ? error : new Error("Unknown error");
      logger.warn("Tenpo benefit detail scrape failed", {
        sourceUrl: card.sourceUrl,
        message: detailError.message,
      });
      return undefined;
    } finally {
      await page.close();
    }
  }

  private normalizeListCard(card: TenpoListCardData): TenpoListCardData {
    return {
      sourceUrl: normalizeWhitespace(card.sourceUrl),
      benefitPath: normalizeWhitespace(card.benefitPath),
      title: normalizeWhitespace(card.title),
      summary: normalizeWhitespace(card.summary),
      merchantName: normalizeWhitespace(card.merchantName),
      paymentMethods: uniqueStrings(card.paymentMethods.map((item) => normalizeWhitespace(item)).filter(Boolean)),
      category: normalizeWhitespace(card.category),
      city: normalizeWhitespace(card.city),
      dayLabels: uniqueStrings(card.dayLabels.map((item) => normalizeWhitespace(item)).filter(Boolean)),
      ...(card.backgroundImageUrl ? { backgroundImageUrl: normalizeWhitespace(card.backgroundImageUrl) } : {}),
      ...(card.logoImageUrl ? { logoImageUrl: normalizeWhitespace(card.logoImageUrl) } : {}),
    };
  }

  private normalizeDetail(detail: TenpoDetailData): TenpoDetailData {
    return {
      benefitTitle: normalizeWhitespace(detail.benefitTitle),
      detailText: normalizeWhitespace(detail.detailText),
      validityText: normalizeWhitespace(detail.validityText),
      termsLabel: normalizeWhitespace(detail.termsLabel),
      termsSourceText: normalizeWhitespace(detail.termsSourceText),
      headline: normalizeWhitespace(detail.headline),
      description: normalizeWhitespace(detail.description),
      ...(detail.imageUrl ? { imageUrl: normalizeWhitespace(detail.imageUrl) } : {}),
    };
  }

  private toRawBenefit(card: TenpoListCardData, detail: TenpoDetailData | undefined, index: number): RawBenefit {
    const merchantName = detail?.headline || card.merchantName || card.title;
    const benefitTitle = detail?.benefitTitle || card.title;
    const rawText = [
      merchantName,
      benefitTitle,
      card.summary,
      detail?.description,
      detail?.detailText,
      detail?.validityText,
      card.dayLabels.join(" | "),
      card.paymentMethods.join(" | "),
      card.category,
      card.city,
      detail?.termsLabel,
      detail?.termsSourceText,
    ]
      .map((item) => normalizeWhitespace(item ?? ""))
      .filter(Boolean)
      .join(" | ");

    const rawBenefit: RawBenefit = {
      providerSlug: "tenpo",
      bankName: "Tenpo",
      sourceUrl: card.sourceUrl,
      rawText,
      rawTitle: benefitTitle,
      rawMerchant: merchantName,
      extractedAt: new Date().toISOString(),
      metadata: {
        index,
        benefitPath: card.benefitPath,
        merchantName,
        benefitTitle,
        summary: card.summary || undefined,
        detailDescription: detail?.description || undefined,
        detailText: detail?.detailText || undefined,
        validityText: detail?.validityText || undefined,
        termsLabel: detail?.termsLabel || undefined,
        termsSourceText: detail?.termsSourceText || undefined,
        paymentMethods: card.paymentMethods,
        dayLabels: card.dayLabels,
        city: card.city || undefined,
        category: card.category || undefined,
        backgroundImageUrl: card.backgroundImageUrl,
        logoImageUrl: card.logoImageUrl,
        detailImageUrl: detail?.imageUrl,
      },
    };

    if (card.category) {
      rawBenefit.rawCategory = card.category;
    }

    return rawBenefit;
  }
}
