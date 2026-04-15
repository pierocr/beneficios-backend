import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { RawBenefit } from "../types/benefit.types";
import { logger } from "../utils/logger";
import { normalizeWhitespace, toLowerNormalized } from "../utils/text";
import { BenefitScraper } from "./scraper.types";

const SANTANDER_PDF_FILENAME = "BENEFICIOS_ABRIL_2026.pdf";
const SANTANDER_PDF_RELATIVE_PATH = path.join("src", "data", "santander", SANTANDER_PDF_FILENAME);
const SANTANDER_PDF_SOURCE_URL = `local://${SANTANDER_PDF_RELATIVE_PATH.replace(/\\/g, "/")}`;
const SANTANDER_PDF_PATH = path.resolve(process.cwd(), SANTANDER_PDF_RELATIVE_PATH);
const SANTANDER_BANK_NAME = "Santander";
const SANTANDER_PROVIDER_SLUG = "santander";
const SANTANDER_MONTH = "abril";
const SANTANDER_YEAR = 2026;
const MIN_EXPECTED_BENEFITS = 20;

const CATEGORY_NAMES = [
  "Multiplica millas",
  "Sabores",
  "Cuotas sin interés",
  "Verdes",
  "Otros descuentos",
] as const;

const CATEGORY_LINE_MAP = new Map<string, string>(
  CATEGORY_NAMES.map((category) => [toLowerNormalized(category), category]),
);

const IGNORE_LINES = new Set(
  [
    "Inicio",
    "Multiplica millas",
    "Sabores",
    "Cuotas sin interés",
    "Verdes",
    "Otros descuentos",
    "Exclusivo pagando con tus Tarjetas de Crédito Santander",
    "Ingresa los 6 primeros dígitos de tu Tarjeta como código de descuento",
  ].map((value) => toLowerNormalized(value)),
);

const DAY_LINE_PATTERN =
  /^(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|lunes y miércoles|lunes y miercoles|martes y jueves|martes y viernes|lunes, martes y miércoles|lunes, martes y miercoles|todos los días|todos los dias|lunes a jueves|sábados a miércoles|sabados a miercoles|lunes, miércoles y viernes|lunes, miercoles y viernes|martes y jueves|lunes, martes y miércoles)$/i;
const PAGE_MARKER_PATTERN = /^--\s*\d+\s+of\s+\d+\s*--$/i;
const BLOCK_MAX_LINES = 10;
const DISCOUNT_PATTERN =
  /(?:hasta\s+)?\d{1,2}\s*%\s*dcto\.?|(?:hasta\s+un\s+)?\d{1,2}\s*%\s*de\s*descuento|\d+\s*milla(?:s)?\s+adicional(?:es)?|cuotas\s*sin\s*inter[eé]s|\d+\s*a\s*\d+\s*cuotas\s*sin\s*inter[eé]s|\d+\s*cuotas\s*sin\s*inter[eé]s/i;
const CONDITION_HINT_PATTERN =
  /^(válido|valido|exclusivo|tope|sin tope|código|codigo|cupón|cupon|descuento|compras|compra|presencial|online|delivery|retiro|excluye|no aplica|no acumulable|acumulable|hasta|desde|solo|aplica|incluye|cae|calculado|operación|operacion)/i;
const DOMAIN_PATTERN = /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*)\.cl\b/gi;
const GENERIC_MERCHANTS = new Set(
  [
    "local",
    "locales",
    "tienda",
    "tiendas",
    "presencial",
    "online",
    "santiago y regiones",
    "santander beneficio",
    "multiplica",
    "sabores",
    "verdes",
    "otros descuentos",
  ].map((value) => toLowerNormalized(value)),
);

interface SantanderPdfBenefit {
  title: string;
  merchant: string;
  category?: string;
  discount?: string;
  description?: string;
  conditions?: string;
  rawText: string;
}

interface ParsedLine {
  value: string;
  normalized: string;
}

export class SantanderScraper implements BenefitScraper {
  async scrape(): Promise<RawBenefit[]> {
    await this.ensurePdfExists();

    logger.info("Santander PDF file located", {
      sourceFile: SANTANDER_PDF_FILENAME,
      filePath: SANTANDER_PDF_PATH,
    });

    const buffer = await readFile(SANTANDER_PDF_PATH);
    const parser = new PDFParse({ data: buffer });

    try {
      const result = await parser.getText();
      const text = normalizeWhitespace(result.text ?? "").length > 0 ? result.text : "";

      logger.info("Santander PDF parsed", {
        sourceFile: SANTANDER_PDF_FILENAME,
        charactersExtracted: text.length,
      });

      if (normalizeWhitespace(text).length === 0) {
        throw new Error(`Santander PDF ${SANTANDER_PDF_FILENAME} does not contain extractable text.`);
      }

      const benefits = this.extractBenefitsFromText(text);

      logger.info("Santander PDF benefits detected", {
        sourceFile: SANTANDER_PDF_FILENAME,
        benefitsDetected: benefits.length,
      });

      if (benefits.length < MIN_EXPECTED_BENEFITS) {
        logger.warn("Santander PDF detected fewer benefits than expected", {
          sourceFile: SANTANDER_PDF_FILENAME,
          benefitsDetected: benefits.length,
          minimumExpected: MIN_EXPECTED_BENEFITS,
        });
      }

      if (benefits.length === 0) {
        throw new Error(`No Santander benefits were detected in ${SANTANDER_PDF_FILENAME}.`);
      }

      return benefits.map((benefit, index) => this.toRawBenefit(benefit, index));
    } finally {
      await parser.destroy();
    }
  }

  private async ensurePdfExists(): Promise<void> {
    try {
      await access(SANTANDER_PDF_PATH);
    } catch {
      throw new Error(`Santander PDF file not found at ${SANTANDER_PDF_PATH}.`);
    }
  }

  private extractBenefitsFromText(text: string): SantanderPdfBenefit[] {
    const lines = this.parseLines(text);
    const triggerIndexes = this.findBenefitTriggerIndexes(lines);
    const benefits: SantanderPdfBenefit[] = [];
    const seen = new Set<string>();

    for (let index = 0; index < triggerIndexes.length; index += 1) {
      const triggerIndex = triggerIndexes[index]!;
      const nextTriggerIndex = triggerIndexes[index + 1];
      const category = this.findNearestCategory(lines, triggerIndex);
      const blockLines = this.buildBenefitBlock(lines, triggerIndex, nextTriggerIndex);

      if (blockLines.length === 0) {
        continue;
      }

      const rawText = normalizeWhitespace(blockLines.map((line) => line.value).join(" | "));
      const rawKey = toLowerNormalized(rawText);

      if (!rawText || seen.has(rawKey)) {
        continue;
      }

      const discount = this.extractDiscount(blockLines);
      const merchant = this.extractMerchant(blockLines);
      const description = this.extractDescription(blockLines, merchant, discount);
      const conditions = this.extractConditions(blockLines, discount);
      const title = this.buildTitle({ merchant, discount, category, description });

      if (!title || !merchant || !this.isValidExtractedBenefit(merchant, rawText, category)) {
        continue;
      }

      seen.add(rawKey);

      const benefit: SantanderPdfBenefit = {
        title,
        merchant,
        rawText,
      };

      if (category) {
        benefit.category = category;
      }

      if (discount) {
        benefit.discount = discount;
      }

      if (description) {
        benefit.description = description;
      }

      if (conditions) {
        benefit.conditions = conditions;
      }

      benefits.push(benefit);
    }

    return benefits;
  }

  private parseLines(text: string): ParsedLine[] {
    return text
      .split(/\r?\n/)
      .map((line) => normalizeWhitespace(line))
      .filter((line) => line.length > 0)
      .filter((line) => !PAGE_MARKER_PATTERN.test(line))
      .map((value) => ({
        value,
        normalized: toLowerNormalized(value),
      }));
  }

  private findBenefitTriggerIndexes(lines: ParsedLine[]): number[] {
    const indexes: number[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const nextLine = lines[index + 1];
      const combined = nextLine ? normalizeWhitespace(`${line.value} ${nextLine.value}`) : line.value;

      if (this.isBenefitTrigger(line.value, combined)) {
        indexes.push(index);
      }
    }

    return indexes.filter((index, currentPosition) => {
      const previousIndex = indexes[currentPosition - 1];

      return previousIndex === undefined || index - previousIndex > 1;
    });
  }

  private isBenefitTrigger(currentLine: string, combinedLine: string): boolean {
    const normalizedCurrent = toLowerNormalized(currentLine);
    const normalizedCombined = toLowerNormalized(combinedLine);

    if (
      IGNORE_LINES.has(normalizedCurrent) ||
      CATEGORY_LINE_MAP.has(normalizedCurrent) ||
      this.isNavigationLine(currentLine) ||
      this.isNavigationLine(combinedLine)
    ) {
      return false;
    }

    if (
      /cuotas\s*sin\s*inter[eé]s/i.test(currentLine) &&
      !/\d|cae|válido|valido|calculado/i.test(combinedLine)
    ) {
      return false;
    }

    if (DISCOUNT_PATTERN.test(currentLine)) {
      return true;
    }

    if (normalizedCurrent === "hasta" && /%/.test(combinedLine) && /(dcto|descuento)/i.test(combinedLine)) {
      return true;
    }

    return DISCOUNT_PATTERN.test(combinedLine) && !this.isNavigationLine(combinedLine);
  }

  private findNearestCategory(lines: ParsedLine[], startIndex: number): string | undefined {
    for (let index = startIndex; index >= 0; index -= 1) {
      const category = CATEGORY_LINE_MAP.get(lines[index]!.normalized);

      if (category) {
        return category;
      }
    }

    return undefined;
  }

  private buildBenefitBlock(
    lines: ParsedLine[],
    triggerIndex: number,
    nextTriggerIndex: number | undefined,
  ): ParsedLine[] {
    let startIndex = triggerIndex;

    for (let index = triggerIndex - 1; index >= Math.max(0, triggerIndex - 2); index -= 1) {
      const line = lines[index]!;

      if (this.isNavigationLine(line.value) || CATEGORY_LINE_MAP.has(line.normalized)) {
        break;
      }

      startIndex = index;
    }

    const upperBound = Math.min(
      lines.length - 1,
      triggerIndex + BLOCK_MAX_LINES,
      nextTriggerIndex !== undefined ? nextTriggerIndex - 1 : lines.length - 1,
    );
    const block: ParsedLine[] = [];

    for (let index = startIndex; index <= upperBound; index += 1) {
      const line = lines[index]!;

      if (CATEGORY_LINE_MAP.has(line.normalized) || this.isNavigationLine(line.value)) {
        continue;
      }

      if (IGNORE_LINES.has(line.normalized)) {
        continue;
      }

      if (PAGE_MARKER_PATTERN.test(line.value)) {
        continue;
      }

      block.push(line);
    }

    return this.compactBlockLines(block);
  }

  private compactBlockLines(lines: ParsedLine[]): ParsedLine[] {
    const compacted: ParsedLine[] = [];

    for (const line of lines) {
      const previous = compacted[compacted.length - 1];

      if (previous?.normalized === line.normalized) {
        continue;
      }

      compacted.push(line);
    }

    return compacted;
  }

  private extractDiscount(lines: ParsedLine[]): string | undefined {
    const joined = lines.map((line) => line.value).join(" ");
    const match = joined.match(DISCOUNT_PATTERN);

    if (!match?.[0]) {
      return undefined;
    }

    return normalizeWhitespace(match[0]);
  }

  private extractMerchant(lines: ParsedLine[]): string {
    const lineValues = lines.map((line) => line.value);
    const domainMerchant = this.extractMerchantFromDomains(lineValues);

    if (domainMerchant) {
      return domainMerchant;
    }

    for (const line of lineValues) {
      const merchant = this.extractMerchantFromSentence(line);

      if (merchant) {
        return merchant;
      }
    }

    for (const line of lineValues) {
      if (this.isLikelyMerchantLabel(line)) {
        return normalizeWhitespace(line);
      }
    }

    return this.extractHeadlineCandidate(lines) ?? "Santander Beneficio";
  }

  private extractMerchantFromDomains(lines: string[]): string | undefined {
    for (const line of lines) {
      const matches = Array.from(line.matchAll(DOMAIN_PATTERN));
      const firstMatch = matches[0];

      if (!firstMatch?.[1]) {
        continue;
      }

      const domainRoot = firstMatch[1].split(".")[0] ?? "";
      const cleaned = domainRoot.replace(/[-_]+/g, " ").trim();

      if (!cleaned) {
        continue;
      }

      return this.toTitleCase(cleaned);
    }

    return undefined;
  }

  private extractMerchantFromSentence(line: string): string | undefined {
    if (/^exclusivo pagando/i.test(line)) {
      return undefined;
    }

    const match = line.match(
      /\b(?:válido|valido|exclusivo|en)\s+(?:en\s+)?([A-Z0-9][^.,;]+?)(?=\s+(?:y|o)\s+(?:www\.|[a-z0-9-]+\.cl\b)|[.,;]|$)/i,
    );

    if (!match?.[1]) {
      return undefined;
    }

    const merchant = normalizeWhitespace(match[1])
      .replace(/^tiendas?\s+y\s+/i, "")
      .replace(/^tiendas?\s+/i, "")
      .replace(/^local(?:es)?\s+y\s+/i, "")
      .replace(/^local(?:es)?\s+/i, "")
      .trim();

    if (
      !merchant ||
      merchant.length < 3 ||
      CONDITION_HINT_PATTERN.test(merchant) ||
      GENERIC_MERCHANTS.has(toLowerNormalized(merchant))
    ) {
      return undefined;
    }

    return merchant;
  }

  private isLikelyMerchantLabel(line: string): boolean {
    const normalized = toLowerNormalized(line);

    if (
      normalized.length < 3 ||
      IGNORE_LINES.has(normalized) ||
      CATEGORY_LINE_MAP.has(normalized) ||
      this.isNavigationLine(line) ||
      DAY_LINE_PATTERN.test(line) ||
      CONDITION_HINT_PATTERN.test(line) ||
      DISCOUNT_PATTERN.test(line) ||
      GENERIC_MERCHANTS.has(normalized)
    ) {
      return false;
    }

    return /^[\p{L}\p{N}&'().\- ]+$/u.test(line);
  }

  private extractDescription(
    lines: ParsedLine[],
    merchant: string,
    discount: string | undefined,
  ): string | undefined {
    const descriptionLines = lines
      .map((line) => line.value)
      .filter((line) => {
        if (line === merchant || line === discount) {
          return false;
        }

        if (DAY_LINE_PATTERN.test(line)) {
          return false;
        }

        if (this.isNavigationLine(line)) {
          return false;
        }

        if (CONDITION_HINT_PATTERN.test(line)) {
          return false;
        }

        return !DISCOUNT_PATTERN.test(line);
      })
      .slice(0, 3);

    if (descriptionLines.length === 0) {
      return undefined;
    }

    return normalizeWhitespace(descriptionLines.join(" "));
  }

  private extractConditions(lines: ParsedLine[], discount: string | undefined): string | undefined {
    const conditionLines = lines
      .map((line) => line.value)
      .filter((line) => line !== discount)
      .filter((line) => CONDITION_HINT_PATTERN.test(line) || DAY_LINE_PATTERN.test(line))
      .slice(0, 6);

    if (conditionLines.length === 0) {
      return undefined;
    }

    return normalizeWhitespace(conditionLines.join(" "));
  }

  private buildTitle(input: {
    merchant: string;
    discount: string | undefined;
    category: string | undefined;
    description: string | undefined;
  }): string {
    const titleParts = [input.merchant];

    if (input.discount) {
      titleParts.push(input.discount);
    } else if (input.category) {
      titleParts.push(input.category);
    } else if (input.description) {
      titleParts.push(input.description);
    }

    return normalizeWhitespace(titleParts.join(" - "));
  }

  private toRawBenefit(benefit: SantanderPdfBenefit, index: number): RawBenefit {
    return {
      providerSlug: SANTANDER_PROVIDER_SLUG,
      bankName: SANTANDER_BANK_NAME,
      sourceUrl: SANTANDER_PDF_SOURCE_URL,
      rawTitle: benefit.title,
      rawMerchant: benefit.merchant,
      rawText: benefit.rawText,
      extractedAt: new Date().toISOString(),
      metadata: {
        index,
        sourceType: "pdf",
        sourceFile: SANTANDER_PDF_FILENAME,
        month: SANTANDER_MONTH,
        year: SANTANDER_YEAR,
        category: benefit.category,
        discount: benefit.discount,
        description: benefit.description,
        conditions: benefit.conditions,
      },
    };
  }

  private toTitleCase(value: string): string {
    return value
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  private isValidExtractedBenefit(merchant: string, rawText: string, category: string | undefined): boolean {
    const normalizedMerchant = toLowerNormalized(merchant);
    const normalizedRawText = toLowerNormalized(rawText);
    const categoryMentions = CATEGORY_NAMES.filter((item) =>
      normalizedRawText.includes(toLowerNormalized(item)),
    ).length;
    const hasDomainSignal = /\.(?:cl|com)\b/i.test(rawText);
    const hasNamedVenueSignal =
      /\b(?:válido|valido|exclusivo)\s+en\s+(?!local(?:es)?\b|tiendas?\b|tienda\b)([a-z0-9][^.,;]+)/i.test(rawText);

    if (
      GENERIC_MERCHANTS.has(normalizedMerchant) ||
      normalizedMerchant.includes("beneficio") ||
      normalizedMerchant.includes("categoría") ||
      normalizedMerchant.includes("categoria") ||
      normalizedMerchant.includes("pagando con tus tarjetas") ||
      normalizedMerchant.includes("encuentra descuentos") ||
      /^\d+\s*(?:cuotas?|millas?)/i.test(merchant) ||
      /^[\d% ]+$/.test(merchant)
    ) {
      return false;
    }

    if (categoryMentions >= 2 || this.isNavigationLine(rawText)) {
      return false;
    }

    if (hasDomainSignal || hasNamedVenueSignal) {
      return true;
    }

    return category === "Multiplica millas" && /latam pass|milla(?:s)? adicional/i.test(rawText);
  }

  private extractHeadlineCandidate(lines: ParsedLine[]): string | undefined {
    for (const line of lines) {
      if (
        this.isNavigationLine(line.value) ||
        DAY_LINE_PATTERN.test(line.value) ||
        CONDITION_HINT_PATTERN.test(line.value) ||
        DISCOUNT_PATTERN.test(line.value)
      ) {
        continue;
      }

      const candidate = normalizeWhitespace(line.value);

      if (!candidate || GENERIC_MERCHANTS.has(toLowerNormalized(candidate))) {
        continue;
      }

      return candidate;
    }

    return undefined;
  }

  private isNavigationLine(line: string): boolean {
    const normalized = toLowerNormalized(line);
    const categoryMatches = CATEGORY_NAMES.filter((category) =>
      normalized.includes(toLowerNormalized(category)),
    ).length;

    if (categoryMatches >= 2) {
      return true;
    }

    return (
      normalized.includes("beneficios santander") ||
      normalized.includes("santander rewards") ||
      normalized.includes("haz clic en una categoría") ||
      normalized.includes("haz click en una categoría") ||
      normalized.includes("únete a nuestro canal") ||
      normalized.includes("unete a nuestro canal") ||
      normalized.includes("entérate de tus beneficios") ||
      normalized.includes("enterate de tus beneficios") ||
      normalized.includes("dale gusto a tus antojos") ||
      normalized.includes("relájate y paga") ||
      normalized.includes("relajate y paga") ||
      normalized.includes("beneficios para ti y para el planeta") ||
      normalized.includes("y disfruta muchos beneficios más") ||
      normalized.includes("y disfruta muchos beneficios mas") ||
      normalized === "multiplica" ||
      normalized === "millas" ||
      normalized === "descuentos"
    );
  }
}
