import { Router } from "express";
import { z } from "zod";
import { getSupabaseAdminClient } from "../lib/supabase";
import { createInMemoryRateLimit } from "../utils/rate-limit";

export const benefitReportsRouter = Router();
const benefitReportRateLimit = createInMemoryRateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
});

const benefitReportSchema = z.object({
  benefitId: z.string().uuid().optional(),
  providerSlug: z.string().trim().min(1).max(80).optional(),
  merchantSlug: z.string().trim().min(1).max(160).optional(),
  reason: z.string().trim().min(3).max(80).default("incorrect_information"),
  message: z.string().trim().min(3).max(1200),
  contactEmail: z.string().trim().email().max(240).optional(),
});

benefitReportsRouter.post("/", benefitReportRateLimit, async (req, res, next) => {
  try {
    const parsed = benefitReportSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid report payload",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const supabase = getSupabaseAdminClient();
    const { error } = await supabase.from("benefit_reports").insert({
      benefit_id: parsed.data.benefitId ?? null,
      provider_slug: parsed.data.providerSlug ?? null,
      merchant_slug: parsed.data.merchantSlug ?? null,
      reason: parsed.data.reason,
      message: parsed.data.message,
      contact_email: parsed.data.contactEmail ?? null,
      status: "open",
    });

    if (error) {
      throw new Error(`Failed to create benefit report: ${error.message}`);
    }

    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});
