import { chromium, Page } from "playwright";
import { env } from "../config/env";
import { RawBenefit } from "../types/benefit.types";
import { logger } from "../utils/logger";
import { normalizeWhitespace } from "../utils/text";
import { BenefitScraper } from "./scraper.types";

const FALABELLA_DISCOUNTS_URL = "https://www.bancofalabella.cl/descuentos";
const CARD_SELECTOR = "div.BenefitsCard_card__wo__P";
const NO_MORE_RESULTS_SELECTOR = "[class*='BenefitsCard_no-more-results']";
const SCROLL_PAUSE_MS = 1200;
const MAX_SCROLL_ITERATIONS = 80;
const SCRAPE_ATTEMPTS = 3;
const MIN_ACCEPTABLE_CARD_COUNT = 120;

interface FalabellaCardPayload {
  id: string;
  title: string;
  description: string;
  dayText: string;
  discountText: string;
  capText: string;
  merchantName: string;
  imageUrl: string | undefined;
  logoUrl: string | undefined;
  redirectUrl: string | undefined;
  rawText: string;
}

export class FalabellaScraper implements BenefitScraper {
  async scrape(): Promise<RawBenefit[]> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= SCRAPE_ATTEMPTS; attempt += 1) {
      const browser = await chromium.launch({
        headless: env.PLAYWRIGHT_HEADLESS,
      });

      try {
        const page = await browser.newPage();
        await page.goto(FALABELLA_DISCOUNTS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(2500);
        await this.scrollUntilAllCardsLoaded(page);

        const cards = await page.$$eval(
          CARD_SELECTOR,
          (elements): FalabellaCardPayload[] =>
            elements
              .map((element) => {
                const card = element as HTMLElement;
                const getText = (selector: string): string => {
                  const found = card.querySelector(selector) as HTMLElement | null;
                  return found?.innerText?.trim() ?? "";
                };
                const getImageSource = (selector: string): string | undefined => {
                  const found = card.querySelector(selector) as HTMLImageElement | null;
                  return found?.currentSrc || found?.src || undefined;
                };
                const anchor = card.querySelector("a") as HTMLAnchorElement | null;
                const title = getText(".NewCardBenefits_title__fpDao");
                const description = getText(".NewCardBenefits_description__R054f");
                const dayText = getText(".NewCardBenefits_days__XZpWE");
                const discountText = getText(".NewCardBenefits_text-uppercase__DRpVQ");
                const capText = getText(".NewCardBenefits_text-bottom__Yn598");
                const merchantName = title.replace(/^Descuento en\s+/i, "").trim();
                const pieces = [title, description, dayText, discountText, capText].filter(Boolean);

                return {
                  id: card.dataset.id ?? "",
                  title,
                  description,
                  dayText,
                  discountText,
                  capText,
                  merchantName,
                  imageUrl: getImageSource(".NewCardBenefits_image__E2fVT"),
                  logoUrl: getImageSource(".NewCardBenefits_logo__ZQn3q"),
                  redirectUrl: anchor?.href || undefined,
                  rawText: pieces.join(" | "),
                };
              })
              .filter((card) => card.rawText.length > 0),
        );

        const uniqueCards = Array.from(
          new Map(cards.map((card) => [`${card.id}:${card.title}:${card.discountText}`, card])).values(),
        );

        if (uniqueCards.length < MIN_ACCEPTABLE_CARD_COUNT) {
          throw new Error(
            `Suspicious Falabella scrape result on attempt ${attempt}: expected at least ${MIN_ACCEPTABLE_CARD_COUNT} cards and got ${uniqueCards.length}.`,
          );
        }

        return uniqueCards.map((card, index) => {
          const rawBenefit: RawBenefit = {
            providerSlug: "falabella",
            bankName: "Banco Falabella",
            sourceUrl: FALABELLA_DISCOUNTS_URL,
            rawText: normalizeWhitespace(card.rawText),
            extractedAt: new Date().toISOString(),
            metadata: {
              index,
              textLength: card.rawText.length,
            },
          };

          const rawTitle = normalizeWhitespace(card.title);
          const rawMerchant = normalizeWhitespace(card.merchantName);
          const description = normalizeWhitespace(card.description);
          const dayText = normalizeWhitespace(card.dayText);
          const discountText = normalizeWhitespace(card.discountText);
          const capText = normalizeWhitespace(card.capText);

          if (rawTitle) {
            rawBenefit.rawTitle = rawTitle;
          }

          if (rawMerchant) {
            rawBenefit.rawMerchant = rawMerchant;
          }

          if (card.id) {
            rawBenefit.metadata!.cardId = card.id;
          }

          if (description) {
            rawBenefit.metadata!.description = description;
          }

          if (card.imageUrl) {
            rawBenefit.metadata!.imageUrl = card.imageUrl;
          }

          if (card.logoUrl) {
            rawBenefit.metadata!.logoUrl = card.logoUrl;
          }

          if (card.redirectUrl) {
            rawBenefit.metadata!.redirectUrl = card.redirectUrl;
          }

          if (dayText) {
            rawBenefit.metadata!.dayText = dayText;
          }

          if (discountText) {
            rawBenefit.metadata!.discountText = discountText;
          }

          if (capText) {
            rawBenefit.metadata!.capText = capText;
          }

          return rawBenefit;
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown error");
        logger.warn("Falabella scrape attempt failed", {
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

    logger.error("Falabella scraper failed", {
      message: lastError?.message ?? "Unknown error",
    });

    throw new Error(
      `Failed to scrape Banco Falabella discounts from ${FALABELLA_DISCOUNTS_URL}: ${
        lastError?.message ?? "Unknown error"
      }`,
    );
  }

  private async scrollUntilAllCardsLoaded(page: Page): Promise<void> {
    let previousCount = 0;
    let stableIterations = 0;

    for (let iteration = 0; iteration < MAX_SCROLL_ITERATIONS; iteration += 1) {
      const currentCount = await page.locator(CARD_SELECTOR).count();
      const noMoreResultsVisible = await page.locator(NO_MORE_RESULTS_SELECTOR).isVisible().catch(() => false);

      if (currentCount === previousCount) {
        stableIterations += 1;
      } else {
        stableIterations = 0;
      }

      if (noMoreResultsVisible && stableIterations >= 2) {
        break;
      }

      if (stableIterations >= 4) {
        break;
      }

      previousCount = currentCount;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(SCROLL_PAUSE_MS);
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
  }
}
