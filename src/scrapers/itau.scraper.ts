import { chromium } from "playwright";
import { RawBenefit } from "../types/benefit.types";
import { logger } from "../utils/logger";
import { normalizeWhitespace } from "../utils/text";
import { BenefitScraper } from "./scraper.types";

const ITAU_BENEFITS_URL = "https://itaubeneficios.cl/beneficios/";
const ITAU_SCRAPE_ATTEMPTS = 3;
const ITAU_MIN_ACCEPTABLE_BENEFITS = 120;
const ITAU_BROWSER_ARGS = ["--disable-blink-features=AutomationControlled"];

interface ItauCardData {
  sourceUrl: string;
  title: string;
  address: string;
  attentionMode: string;
  discountText: string;
  category: string;
  backgroundImageUrl?: string;
  logoImageUrl?: string;
  logoBackgroundColor?: string;
}

export class ItauScraper implements BenefitScraper {
  async scrape(): Promise<RawBenefit[]> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= ITAU_SCRAPE_ATTEMPTS; attempt += 1) {
      const browser = await chromium.launch({
        channel: "chrome",
        headless: false,
        args: ITAU_BROWSER_ARGS,
      });

      try {
        const context = await browser.newContext({
          locale: "es-CL",
          viewport: { width: 1366, height: 900 },
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        });
        const page = await context.newPage();

        await page.addInitScript(() => {
          Object.defineProperty(navigator, "webdriver", {
            get: () => undefined,
          });
        });

        await page.goto(ITAU_BENEFITS_URL, {
          waitUntil: "domcontentloaded",
          timeout: 120000,
        });
        await page.waitForTimeout(4000);

        const pageTitle = normalizeWhitespace(await page.title());
        const bodyText = normalizeWhitespace(await page.locator("body").innerText());

        if (
          pageTitle.toLowerCase().includes("un momento") ||
          bodyText.toLowerCase().includes("verificacion de seguridad en curso")
        ) {
          throw new Error("Itau benefits page is behind a Cloudflare anti-bot challenge.");
        }

        await page.waitForSelector(".page-beneficios-list-default__grid", { timeout: 60000 });

        const cards = await page.locator(".page-beneficios-list-default__grid > a.beneficio__item").evaluateAll((nodes) =>
          nodes.map((node) => {
            const href = node.getAttribute("href")?.trim() ?? "";
            const title =
              node.querySelector(".beneficio__item__info-location__title")?.textContent?.trim() ??
              node.getAttribute("title")?.trim() ??
              "";
            const address =
              node.querySelector(".beneficio__item__info-location__address")?.textContent?.trim() ?? "";
            const attentionMode =
              node.querySelector(".beneficio__item__info-location__details")?.textContent?.trim() ?? "";

            const discountCandidates = [
              node.querySelector(".beneficio__item__info-discount-only__info")?.textContent?.trim() ?? "",
              node.querySelector(".beneficio__item__info-discount-pb__discount")?.textContent?.trim() ?? "",
              node.querySelector(".beneficio__item__info-discount-pb-text__discount")?.textContent?.trim() ?? "",
              node.querySelector(".beneficio__item__info-discount-text__info")?.textContent?.trim() ?? "",
            ];

            const discountText = discountCandidates.find((value) => value.length > 0) ?? "";
            const category =
              node.querySelector(".beneficio__item__category__name")?.textContent?.trim() ?? "";
            const backgroundImage = (node.querySelector(".beneficio__item__background") as HTMLElement | null)?.style
              ?.backgroundImage;
            const logo = node.querySelector(".beneficio__item__logo img") as HTMLImageElement | null;
            const logoWrapper = node.querySelector(".beneficio__item__logo") as HTMLElement | null;

            const backgroundImageUrlMatch = backgroundImage?.match(/url\\([\"']?(.*?)[\"']?\\)/);

            return {
              sourceUrl: href,
              title,
              address,
              attentionMode,
              discountText,
              category,
              ...(backgroundImageUrlMatch?.[1] ? { backgroundImageUrl: backgroundImageUrlMatch[1] } : {}),
              ...(logo?.src ? { logoImageUrl: logo.src } : {}),
              ...(logoWrapper?.style?.backgroundColor ? { logoBackgroundColor: logoWrapper.style.backgroundColor } : {}),
            };
          }),
        );

        const uniqueCards = Array.from(
          new Map(
            cards
              .map((card) => this.normalizeCard(card as ItauCardData))
              .filter((card) => card.sourceUrl && card.title)
              .map((card) => [card.sourceUrl, card]),
          ).values(),
        );

        if (uniqueCards.length < ITAU_MIN_ACCEPTABLE_BENEFITS) {
          throw new Error(
            `Suspicious Itau scrape result on attempt ${attempt}: expected at least ${ITAU_MIN_ACCEPTABLE_BENEFITS} unique benefits and got ${uniqueCards.length}.`,
          );
        }

        return uniqueCards.map((card, index) => this.toRawBenefit(card, index));
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown error");
        logger.warn("Itau scrape attempt failed", {
          attempt,
          message: lastError.message,
        });
      } finally {
        await browser.close();
      }

      if (attempt < ITAU_SCRAPE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }

    logger.error("Itau scraper failed", {
      message: lastError?.message ?? "Unknown error",
    });

    throw new Error(`Failed to scrape Itau benefits from ${ITAU_BENEFITS_URL}: ${lastError?.message ?? "Unknown error"}`);
  }

  private normalizeCard(card: ItauCardData): ItauCardData {
    return {
      sourceUrl: normalizeWhitespace(card.sourceUrl),
      title: normalizeWhitespace(card.title),
      address: normalizeWhitespace(card.address),
      attentionMode: normalizeWhitespace(card.attentionMode),
      discountText: normalizeWhitespace(card.discountText),
      category: normalizeWhitespace(card.category),
      ...(card.backgroundImageUrl ? { backgroundImageUrl: normalizeWhitespace(card.backgroundImageUrl) } : {}),
      ...(card.logoImageUrl ? { logoImageUrl: normalizeWhitespace(card.logoImageUrl) } : {}),
      ...(card.logoBackgroundColor ? { logoBackgroundColor: normalizeWhitespace(card.logoBackgroundColor) } : {}),
    };
  }

  private toRawBenefit(card: ItauCardData, index: number): RawBenefit {
    const rawPieces = [card.title, card.discountText, card.address, card.attentionMode, card.category]
      .map((value) => normalizeWhitespace(value))
      .filter(Boolean);

    const rawBenefit: RawBenefit = {
      providerSlug: "itau",
      bankName: "Itau",
      sourceUrl: card.sourceUrl,
      rawText: rawPieces.join(" | "),
      extractedAt: new Date().toISOString(),
      metadata: {
        index,
        title: card.title,
        address: card.address || undefined,
        attentionMode: card.attentionMode || undefined,
        discountText: card.discountText || undefined,
        category: card.category || undefined,
        backgroundImageUrl: card.backgroundImageUrl,
        logoImageUrl: card.logoImageUrl,
        logoBackgroundColor: card.logoBackgroundColor,
      },
    };

    if (card.title) {
      rawBenefit.rawTitle = card.title;
      rawBenefit.rawMerchant = card.title;
    }

    if (card.category) {
      rawBenefit.rawCategory = card.category;
    }

    return rawBenefit;
  }
}
