import { chromium, BrowserContext } from "playwright";
import { env } from "../config/env";
import { RawBenefit } from "../types/benefit.types";
import { logger } from "../utils/logger";
import { htmlToText, normalizeWhitespace } from "../utils/text";
import { BenefitScraper } from "./scraper.types";

const SCOTIA_RUTA_GOURMET_URL = "https://www.scotiarewards.cl/scclubfront/categoria/platosycomida/rutagourmet";
const SCOTIA_DISCOUNTS_URL = "https://www.scotiarewards.cl/scclubfront/categoria/mundos/descuentos";
const SCOTIA_SCRAPE_ATTEMPTS = 3;
const SCOTIA_MIN_ACCEPTABLE_BENEFITS = 110;
const SCOTIA_DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

interface ScotiaDiscountData {
  id: number;
  nombre?: string;
  imagen?: string;
  codigo?: string;
  titulo?: string;
  subtitulo?: string;
  descuento?: string;
  descripcion?: string;
  acceder?: string;
  condicionesComercio?: string;
  direcciones?: string | string[];
  terminosYCondiciones?: string;
  generaCanje?: boolean;
  tags?: string[];
  categoryClasses?: string[];
}

interface ScotiaRouteSiteData {
  nombre?: string;
  direccion?: string;
  telefono?: string;
  web?: string;
  especialidad?: string;
  imagen?: string;
  descripcion?: string;
  id_sitio: number;
  id_region?: number;
}

export class ScotiabankScraper implements BenefitScraper {
  async scrape(): Promise<RawBenefit[]> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= SCOTIA_SCRAPE_ATTEMPTS; attempt += 1) {
      const browser = await chromium.launch({
        headless: env.PLAYWRIGHT_HEADLESS,
      });

      try {
        const context = await browser.newContext({
          userAgent: SCOTIA_DEFAULT_USER_AGENT,
          locale: "es-CL",
          viewport: { width: 1440, height: 900 },
        });

        const discounts = await this.loadDiscounts(context);
        const rutaGourmetSites = await this.loadRutaGourmetSites(context);

        const discountBenefits = discounts.map((item, index) => this.toRawBenefitFromDiscount(item, index));
        const rutaBenefits = rutaGourmetSites.map((item, index) =>
          this.toRawBenefitFromRuta(item, discountBenefits.length + index),
        );

        const uniqueBenefits = Array.from(
          new Map(
            [...discountBenefits, ...rutaBenefits].map((benefit) => {
              const metadata = benefit.metadata ?? {};
              const key =
                (typeof metadata.sectionKey === "string" && metadata.sectionKey) ||
                `${benefit.sourceUrl}::${benefit.rawTitle ?? ""}`;
              return [key, benefit];
            }),
          ).values(),
        );

        if (uniqueBenefits.length < SCOTIA_MIN_ACCEPTABLE_BENEFITS) {
          throw new Error(
            `Suspicious Scotiabank scrape result on attempt ${attempt}: expected at least ${SCOTIA_MIN_ACCEPTABLE_BENEFITS} benefits and got ${uniqueBenefits.length}.`,
          );
        }

        return uniqueBenefits;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown error");
        logger.warn("Scotiabank scrape attempt failed", {
          attempt,
          message: lastError.message,
        });
      } finally {
        await browser.close();
      }

      if (attempt < SCOTIA_SCRAPE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }

    logger.error("Scotiabank scraper failed", {
      message: lastError?.message ?? "Unknown error",
    });

    throw new Error(
      `Failed to scrape Scotiabank benefits from ${SCOTIA_DISCOUNTS_URL} and ${SCOTIA_RUTA_GOURMET_URL}: ${
        lastError?.message ?? "Unknown error"
      }`,
    );
  }

  private async loadDiscounts(context: BrowserContext): Promise<ScotiaDiscountData[]> {
    const page = await context.newPage();

    try {
      await page.goto(SCOTIA_DISCOUNTS_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForTimeout(3000);

      return await page.evaluate(() => {
        const decode = (value: string | null | undefined): string => {
          const textarea = document.createElement("textarea");
          textarea.innerHTML = value ?? "";
          return textarea.value.replace(/\s+/g, " ").trim();
        };

        const genericClasses = new Set([
          "scotia-col-12",
          "scotia-col-sm-12",
          "scotia-col-md-6",
          "scotia-col-lg-4",
          "marketing-card",
          "mb-3",
          "h-100",
          "descuento",
          "animated",
          "fadeIn",
        ]);

        const categoryMap = new Map<number, string[]>();

        Array.from(document.querySelectorAll(".marketing-card[data-id]")).forEach((node) => {
          const id = Number(node.getAttribute("data-id"));
          const classes = Array.from(node.classList).filter((value) => !genericClasses.has(value));

          if (Number.isFinite(id)) {
            categoryMap.set(id, classes);
          }
        });

        const rawDiscounts =
          (
            window as typeof window & {
              descuentos?: ScotiaDiscountData[];
            }
          ).descuentos ?? [];

        return rawDiscounts.map((item) => ({
          ...item,
          nombre: decode(item.nombre),
          imagen: decode(item.imagen),
          codigo: decode(item.codigo),
          titulo: decode(item.titulo),
          subtitulo: decode(item.subtitulo),
          descuento: decode(item.descuento),
          descripcion: decode(item.descripcion),
          acceder: decode(item.acceder),
          condicionesComercio: decode(item.condicionesComercio),
          direcciones: Array.isArray(item.direcciones)
            ? item.direcciones.map((entry) => decode(String(entry)))
            : decode(typeof item.direcciones === "string" ? item.direcciones : ""),
          terminosYCondiciones: decode(item.terminosYCondiciones),
          tags: (item.tags ?? []).map((tag) => decode(tag)).filter(Boolean),
          categoryClasses: categoryMap.get(item.id) ?? [],
        }));
      });
    } finally {
      await page.close();
    }
  }

  private async loadRutaGourmetSites(context: BrowserContext): Promise<ScotiaRouteSiteData[]> {
    const page = await context.newPage();

    try {
      await page.goto(SCOTIA_RUTA_GOURMET_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForTimeout(3000);

      return await page.evaluate(() => {
        const decode = (value: string | null | undefined): string => {
          const textarea = document.createElement("textarea");
          textarea.innerHTML = value ?? "";
          return textarea.value.replace(/\s+/g, " ").trim();
        };

        const scripts = Array.from(document.scripts)
          .map((item) => item.textContent ?? "")
          .find((text) => text.includes("const sitiosSantiago") && text.includes("const sitiosRegiones"));

        if (!scripts) {
          return [];
        }

        const santiagoMatch = scripts.match(/const sitiosSantiago = (\[[\s\S]*?\]);/);
        const regionesMatch = scripts.match(/const sitiosRegiones = (\[[\s\S]*?\]);/);

        const santiago = santiagoMatch?.[1] ? (JSON.parse(santiagoMatch[1]) as ScotiaRouteSiteData[]) : [];
        const regiones = regionesMatch?.[1] ? (JSON.parse(regionesMatch[1]) as ScotiaRouteSiteData[]) : [];

        return [...santiago, ...regiones].map((item) => ({
          ...item,
          nombre: decode(item.nombre),
          direccion: decode(item.direccion),
          telefono: decode(item.telefono),
          web: decode(item.web),
          especialidad: decode(item.especialidad),
          imagen: decode(item.imagen),
          descripcion: decode(item.descripcion),
        }));
      });
    } finally {
      await page.close();
    }
  }

  private toRawBenefitFromDiscount(item: ScotiaDiscountData, index: number): RawBenefit {
    const title = this.cleanText(item.titulo ?? "Beneficio Scotiabank");
    const merchantName = this.cleanText(title);
    const subtitle = this.cleanText(item.subtitulo ?? "");
    const dayText = this.cleanText(item.descuento ?? "");
    const description = this.cleanText(htmlToText(item.descripcion ?? ""));
    const howToUse = this.cleanText(htmlToText(item.acceder ?? ""));
    const commerceConditions = this.cleanText(htmlToText(item.condicionesComercio ?? ""));
    const addresses = this.normalizeDirections(item.direcciones);
    const terms = this.cleanText(htmlToText(item.terminosYCondiciones ?? ""));
    const categoryClasses = (item.categoryClasses ?? []).map((value) => this.cleanText(value)).filter(Boolean);
    const tags = (item.tags ?? []).map((value) => this.cleanText(value)).filter(Boolean);
    const imageUrl = this.toAbsoluteUrl(item.imagen, SCOTIA_DISCOUNTS_URL);
    const sourceUrl = `https://www.scotiarewards.cl/scclubfront/categoria/mundos/descuentos/detalle/${item.id}`;
    const rawText = [
      title,
      subtitle,
      dayText,
      description,
      howToUse,
      commerceConditions,
      addresses,
      terms,
      categoryClasses.join(" | "),
      tags.join(" | "),
    ]
      .map((value) => normalizeWhitespace(value))
      .filter(Boolean)
      .join(" | ");

    const rawBenefit: RawBenefit = {
      providerSlug: "scotiabank",
      bankName: "Scotiabank",
      sourceUrl,
      rawText,
      extractedAt: new Date().toISOString(),
      metadata: {
        index,
        sectionKey: `descuentos:${item.id}`,
        sourceSection: "mundos/descuentos",
        scotiaBenefitId: item.id,
        internalName: this.cleanText(item.nombre ?? "") || undefined,
        imageUrl,
        title,
        subtitle: subtitle || undefined,
        dayText: dayText || undefined,
        description: description || undefined,
        howToUse: howToUse || undefined,
        commerceConditions: commerceConditions || undefined,
        addresses: addresses || undefined,
        terms: terms || undefined,
        categoryClasses,
        tags,
        couponCode: this.cleanText(item.codigo ?? "") || undefined,
        generatesCoupon: item.generaCanje ?? false,
      },
    };

    if (title) {
      rawBenefit.rawTitle = title;
      rawBenefit.rawMerchant = merchantName;
    }

    if (categoryClasses.length > 0) {
      rawBenefit.rawCategory = categoryClasses.join(" | ");
    }

    return rawBenefit;
  }

  private toRawBenefitFromRuta(item: ScotiaRouteSiteData, index: number): RawBenefit {
    const title = this.cleanText(item.nombre ?? "Ruta Gourmet");
    const merchantName = this.cleanText(title);
    const address = this.cleanText(item.direccion ?? "");
    const discountText = this.cleanText(item.telefono ?? "");
    const schedule = this.cleanText(item.especialidad ?? "");
    const website = this.cleanText(item.web ?? "");
    const descriptionText = this.cleanText(htmlToText(item.descripcion ?? ""));
    const sourceUrl = website || `${SCOTIA_RUTA_GOURMET_URL}#sitio-${item.id_sitio}`;
    const imageUrl = this.toAbsoluteUrl(item.imagen, SCOTIA_RUTA_GOURMET_URL);
    const rawText = [title, discountText, schedule, address, descriptionText, website, "Ruta Gourmet"]
      .map((value) => normalizeWhitespace(value))
      .filter(Boolean)
      .join(" | ");

    return {
      providerSlug: "scotiabank",
      bankName: "Scotiabank",
      sourceUrl,
      rawText,
      rawTitle: title,
      rawMerchant: merchantName,
      rawCategory: "ruta-gourmet | restaurantes",
      extractedAt: new Date().toISOString(),
      metadata: {
        index,
        sectionKey: `ruta-gourmet:${item.id_sitio}`,
        sourceSection: "platosycomida/rutagourmet",
        routeSiteId: item.id_sitio,
        regionId: item.id_region,
        imageUrl,
        address: address || undefined,
        discountText: discountText || undefined,
        schedule: schedule || undefined,
        website: website || undefined,
        description: descriptionText || undefined,
      },
    };
  }

  private normalizeDirections(value: string | string[] | undefined): string {
    if (!value) {
      return "";
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this.cleanText(htmlToText(entry))).filter(Boolean).join(" | ");
    }

    return this.cleanText(htmlToText(value));
  }

  private cleanText(value: string): string {
    const normalized = normalizeWhitespace(value);

    if (!/[ÃÂâ€]/.test(normalized)) {
      return normalized;
    }

    try {
      return normalizeWhitespace(Buffer.from(normalized, "latin1").toString("utf8"));
    } catch {
      return normalized;
    }
  }

  private toAbsoluteUrl(value: string | undefined, baseUrl: string): string | undefined {
    const normalized = normalizeWhitespace(value ?? "");

    if (!normalized) {
      return undefined;
    }

    return new URL(normalized, baseUrl).toString();
  }
}
