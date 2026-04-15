import { Router } from "express";
import { providers } from "../providers/providers";

export const providersRouter = Router();

providersRouter.get("/", (_req, res) => {
  res.status(200).json(
    providers.map((provider) => ({
      slug: provider.slug,
      name: provider.name,
      bankName: provider.bankName,
      country: provider.country,
      sourceUrl: provider.sourceUrl,
    })),
  );
});
