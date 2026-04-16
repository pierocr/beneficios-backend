import { Router } from "express";
import { benefitsCatalogService, BenefitSearchFilters } from "../services/benefits-catalog.service";
import { scrapingService } from "../services/scraping.service";

export const benefitsRouter = Router();

benefitsRouter.get("/", async (req, res, next) => {
  try {
    const benefits = await benefitsCatalogService.listBenefits(parseBenefitSearchFilters(req.query));
    res.status(200).json(benefits);
  } catch (error) {
    next(error);
  }
});

benefitsRouter.get("/search", async (req, res, next) => {
  try {
    const benefits = await benefitsCatalogService.listBenefits(parseBenefitSearchFilters(req.query));
    res.status(200).json(benefits);
  } catch (error) {
    next(error);
  }
});

benefitsRouter.get("/raw/:providerSlug", async (req, res, next) => {
  try {
    // Development only: in production, scraping should run in background jobs or cron, not public requests.
    const rawBenefits = await scrapingService.scrapeByProvider(req.params.providerSlug);
    res.status(200).json(rawBenefits);
  } catch (error) {
    next(error);
  }
});

benefitsRouter.get("/:providerSlug/:merchantSlug", async (req, res, next) => {
  try {
    const benefit = await benefitsCatalogService.getBenefitByMerchant(req.params.providerSlug, req.params.merchantSlug);

    if (!benefit) {
      res.status(404).json({ error: "Benefit not found" });
      return;
    }

    res.status(200).json(benefit);
  } catch (error) {
    next(error);
  }
});

function parseBenefitSearchFilters(query: Record<string, unknown>): BenefitSearchFilters {
  const filters: BenefitSearchFilters = {
    todayOnly: firstQueryValue(query.todayOnly) === "true",
  };

  const providerSlugs = queryValues(query.providerSlug);
  if (providerSlugs.length > 0) filters.providerSlugs = providerSlugs;

  const paymentMethods = queryValues(query.paymentMethod);
  if (paymentMethods.length > 0) filters.paymentMethods = paymentMethods;

  const channels = queryValues(query.channel);
  if (channels.length > 0) filters.channels = channels as NonNullable<BenefitSearchFilters["channels"]>;

  const days = queryValues(query.day);
  if (days.length > 0) filters.days = days;

  const benefitTypes = queryValues(query.benefitType);
  if (benefitTypes.length > 0) filters.benefitTypes = benefitTypes;

  const search = firstQueryValue(query.search);
  if (search !== undefined) filters.search = search;

  const category = firstQueryValue(query.category);
  if (category !== undefined) filters.category = category;

  const minBenefitValue = numberQueryValue(query.minBenefitValue);
  if (minBenefitValue !== undefined) filters.minBenefitValue = minBenefitValue;

  const maxBenefitValue = numberQueryValue(query.maxBenefitValue);
  if (maxBenefitValue !== undefined) filters.maxBenefitValue = maxBenefitValue;

  const sortBy = firstQueryValue(query.sortBy);
  if (sortBy === "best" || sortBy === "discount" || sortBy === "ending") {
    filters.sortBy = sortBy;
  }

  return filters;
}

function queryValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(queryValues);
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstQueryValue(value: unknown): string | undefined {
  return queryValues(value)[0];
}

function numberQueryValue(value: unknown): number | undefined {
  const firstValue = firstQueryValue(value);

  if (!firstValue) {
    return undefined;
  }

  const parsed = Number(firstValue);
  return Number.isFinite(parsed) ? parsed : undefined;
}
