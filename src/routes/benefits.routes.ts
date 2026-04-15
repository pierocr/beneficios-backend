import { Router } from "express";
import { scrapingService } from "../services/scraping.service";

export const benefitsRouter = Router();

benefitsRouter.get("/raw/:providerSlug", async (req, res, next) => {
  try {
    // Development only: in production, scraping should run in background jobs or cron, not public requests.
    const rawBenefits = await scrapingService.scrapeByProvider(req.params.providerSlug);
    res.status(200).json(rawBenefits);
  } catch (error) {
    next(error);
  }
});
