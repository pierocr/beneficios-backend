import { env } from "../config/env";
import { providers } from "../providers/providers";
import { getSupabaseAdminClient } from "../lib/supabase";

interface BenefitDashboardRow {
  provider_slug: string;
  bank_name: string;
  category_name: string;
  benefit_type: string;
  benefit_value: number | string | null;
  validation_status: string;
  is_active: boolean;
  first_seen_at: string;
  last_seen_at: string;
  last_scraped_at: string;
  updated_at: string;
  days: unknown;
  channel: unknown;
  payment_methods: unknown;
}

interface ScrapingRunDashboardRow {
  id: string;
  provider_slug: string;
  status: string;
  raw_count: number;
  normalized_count: number;
  valid_count: number;
  needs_review_count: number;
  invalid_count: number;
  started_at: string;
  completed_at: string | null;
  output_path: string | null;
}

interface ProviderDashboardSummary {
  slug: string;
  name: string;
  bankName: string;
  activeCount: number;
  inactiveCount: number;
  totalCount: number;
  currentMonthActiveCount: number;
  newThisMonthCount: number;
  validCount: number;
  needsReviewCount: number;
  invalidCount: number;
  todayCount: number;
  onlineCount: number;
  inPersonCount: number;
  averageDiscount: number | null;
  maxDiscount: number | null;
  topCategory: string | null;
  lastSeenAt: string | null;
  lastScrapedAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunRawCount: number | null;
  lastRunValidCount: number | null;
  hoursSinceLastRun: number | null;
}

export interface AdminDashboardData {
  generatedAt: string;
  timezone: string;
  currentMonthLabel: string;
  totals: {
    activeBenefits: number;
    inactiveBenefits: number;
    totalBenefits: number;
    currentMonthActiveBenefits: number;
    newThisMonthBenefits: number;
    validBenefits: number;
    needsReviewBenefits: number;
    invalidBenefits: number;
    todayBenefits: number;
    onlineBenefits: number;
    inPersonBenefits: number;
    providersWithActiveBenefits: number;
  };
  providers: ProviderDashboardSummary[];
  topCategories: Array<{ name: string; count: number }>;
  benefitTypes: Array<{ name: string; count: number }>;
  validationStatuses: Array<{ name: string; count: number }>;
  paymentMethods: Array<{ name: string; count: number }>;
  recentRuns: Array<{
    id: string;
    providerSlug: string;
    status: string;
    rawCount: number;
    validCount: number;
    needsReviewCount: number;
    invalidCount: number;
    completedAt: string | null;
    outputPath: string | null;
  }>;
}

const BATCH_SIZE = 1000;

export class AdminDashboardService {
  async getDashboardData(): Promise<AdminDashboardData> {
    const supabase = getSupabaseAdminClient();
    const generatedAt = new Date();
    const currentMonthKey = this.monthKey(generatedAt.toISOString());

    const [benefitRows, runRows] = await Promise.all([
      this.loadAllRows<BenefitDashboardRow>("benefits", [
        "provider_slug",
        "bank_name",
        "category_name",
        "benefit_type",
        "benefit_value",
        "validation_status",
        "is_active",
        "first_seen_at",
        "last_seen_at",
        "last_scraped_at",
        "updated_at",
        "days",
        "channel",
        "payment_methods",
      ].join(", ")),
      supabase
        .from("scraping_runs")
        .select(
          "id, provider_slug, status, raw_count, normalized_count, valid_count, needs_review_count, invalid_count, started_at, completed_at, output_path",
        )
        .order("completed_at", { ascending: false })
        .limit(80),
    ]);

    if (runRows.error) {
      throw new Error(`Failed to load scraping runs for dashboard: ${runRows.error.message}`);
    }

    const runs = ((runRows.data ?? []) as unknown as ScrapingRunDashboardRow[]).filter(Boolean);
    const latestRunByProvider = new Map<string, ScrapingRunDashboardRow>();

    for (const run of runs) {
      if (!latestRunByProvider.has(run.provider_slug)) {
        latestRunByProvider.set(run.provider_slug, run);
      }
    }

    const activeRows = benefitRows.filter((row) => row.is_active);
    const categoryCounts = new Map<string, number>();
    const typeCounts = new Map<string, number>();
    const validationCounts = new Map<string, number>();
    const paymentCounts = new Map<string, number>();

    for (const row of activeRows) {
      this.increment(categoryCounts, row.category_name || "Sin categoria");
      this.increment(typeCounts, row.benefit_type || "Sin tipo");
      this.increment(validationCounts, row.validation_status || "Sin estado");

      for (const paymentMethod of this.toStringArray(row.payment_methods)) {
        this.increment(paymentCounts, paymentMethod);
      }
    }

    const providerSummaries = providers.map((provider) => {
      const rows = benefitRows.filter((row) => row.provider_slug === provider.slug);
      const activeProviderRows = rows.filter((row) => row.is_active);
      const latestRun = latestRunByProvider.get(provider.slug);
      const percentageValues = activeProviderRows
        .filter((row) => row.benefit_type === "discount")
        .map((row) => Number(row.benefit_value))
        .filter((value) => Number.isFinite(value) && value > 0);
      const providerCategories = new Map<string, number>();

      for (const row of activeProviderRows) {
        this.increment(providerCategories, row.category_name || "Sin categoria");
      }

      const lastRunAt = latestRun?.completed_at ?? latestRun?.started_at ?? null;

      return {
        slug: provider.slug,
        name: provider.name,
        bankName: provider.bankName,
        activeCount: activeProviderRows.length,
        inactiveCount: rows.filter((row) => !row.is_active).length,
        totalCount: rows.length,
        currentMonthActiveCount: activeProviderRows.filter((row) => this.monthKey(row.last_seen_at) === currentMonthKey)
          .length,
        newThisMonthCount: activeProviderRows.filter((row) => this.monthKey(row.first_seen_at) === currentMonthKey)
          .length,
        validCount: activeProviderRows.filter((row) => row.validation_status === "valid").length,
        needsReviewCount: activeProviderRows.filter((row) => row.validation_status === "needs_review").length,
        invalidCount: activeProviderRows.filter((row) => row.validation_status === "invalid").length,
        todayCount: activeProviderRows.filter((row) => this.isAvailableToday(row.days)).length,
        onlineCount: activeProviderRows.filter((row) => this.includesValue(row.channel, "online")).length,
        inPersonCount: activeProviderRows.filter((row) => this.includesValue(row.channel, "presencial")).length,
        averageDiscount: this.average(percentageValues),
        maxDiscount: percentageValues.length > 0 ? Math.max(...percentageValues) : null,
        topCategory: this.topEntries(providerCategories, 1)[0]?.name ?? null,
        lastSeenAt: this.maxDate(activeProviderRows.map((row) => row.last_seen_at)),
        lastScrapedAt: this.maxDate(activeProviderRows.map((row) => row.last_scraped_at)),
        lastRunAt,
        lastRunStatus: latestRun?.status ?? null,
        lastRunRawCount: latestRun?.raw_count ?? null,
        lastRunValidCount: latestRun?.valid_count ?? null,
        hoursSinceLastRun: lastRunAt ? this.hoursBetween(lastRunAt, generatedAt) : null,
      };
    });

    return {
      generatedAt: generatedAt.toISOString(),
      timezone: env.APP_TIMEZONE,
      currentMonthLabel: this.monthLabel(generatedAt.toISOString()),
      totals: {
        activeBenefits: activeRows.length,
        inactiveBenefits: benefitRows.filter((row) => !row.is_active).length,
        totalBenefits: benefitRows.length,
        currentMonthActiveBenefits: activeRows.filter((row) => this.monthKey(row.last_seen_at) === currentMonthKey)
          .length,
        newThisMonthBenefits: activeRows.filter((row) => this.monthKey(row.first_seen_at) === currentMonthKey).length,
        validBenefits: activeRows.filter((row) => row.validation_status === "valid").length,
        needsReviewBenefits: activeRows.filter((row) => row.validation_status === "needs_review").length,
        invalidBenefits: activeRows.filter((row) => row.validation_status === "invalid").length,
        todayBenefits: activeRows.filter((row) => this.isAvailableToday(row.days)).length,
        onlineBenefits: activeRows.filter((row) => this.includesValue(row.channel, "online")).length,
        inPersonBenefits: activeRows.filter((row) => this.includesValue(row.channel, "presencial")).length,
        providersWithActiveBenefits: providerSummaries.filter((provider) => provider.activeCount > 0).length,
      },
      providers: providerSummaries.sort((left, right) => right.activeCount - left.activeCount),
      topCategories: this.topEntries(categoryCounts, 10),
      benefitTypes: this.topEntries(typeCounts, 10),
      validationStatuses: this.topEntries(validationCounts, 10),
      paymentMethods: this.topEntries(paymentCounts, 10),
      recentRuns: runs.slice(0, 20).map((run) => ({
        id: run.id,
        providerSlug: run.provider_slug,
        status: run.status,
        rawCount: run.raw_count,
        validCount: run.valid_count,
        needsReviewCount: run.needs_review_count,
        invalidCount: run.invalid_count,
        completedAt: run.completed_at,
        outputPath: run.output_path,
      })),
    };
  }

  private async loadAllRows<T>(tableName: "benefits", columns: string): Promise<T[]> {
    const supabase = getSupabaseAdminClient();
    const rows: T[] = [];
    let offset = 0;

    while (true) {
      const { data, error } = await supabase
        .from(tableName)
        .select(columns)
        .order("updated_at", { ascending: false })
        .range(offset, offset + BATCH_SIZE - 1);

      if (error) {
        throw new Error(`Failed to load ${tableName} for dashboard: ${error.message}`);
      }

      const batch = ((data ?? []) as unknown as T[]).filter(Boolean);
      rows.push(...batch);

      if (batch.length < BATCH_SIZE) {
        break;
      }

      offset += BATCH_SIZE;
    }

    return rows;
  }

  private increment(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  private topEntries(map: Map<string, number>, limit: number): Array<{ name: string; count: number }> {
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
      .slice(0, limit);
  }

  private monthKey(value: string | null | undefined): string {
    if (!value) {
      return "";
    }

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: env.APP_TIMEZONE,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date(value));
    const year = parts.find((part) => part.type === "year")?.value ?? "";
    const month = parts.find((part) => part.type === "month")?.value ?? "";

    return `${year}-${month}`;
  }

  private monthLabel(value: string): string {
    return new Intl.DateTimeFormat("es-CL", {
      timeZone: env.APP_TIMEZONE,
      month: "long",
      year: "numeric",
    }).format(new Date(value));
  }

  private maxDate(values: Array<string | null | undefined>): string | null {
    const timestamps = values
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value));

    if (timestamps.length === 0) {
      return null;
    }

    return new Date(Math.max(...timestamps)).toISOString();
  }

  private hoursBetween(value: string, now: Date): number {
    return Math.max(0, Math.round(((now.getTime() - new Date(value).getTime()) / 3_600_000) * 10) / 10);
  }

  private average(values: number[]): number | null {
    if (values.length === 0) {
      return null;
    }

    return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10;
  }

  private isAvailableToday(days: unknown): boolean {
    const values = this.toStringArray(days).map((value) => value.toLowerCase());

    if (values.length === 0) {
      return false;
    }

    if (values.some((value) => value.includes("todos"))) {
      return true;
    }

    const today = new Intl.DateTimeFormat("es-CL", {
      timeZone: env.APP_TIMEZONE,
      weekday: "long",
    })
      .format(new Date())
      .toLowerCase();
    const aliases: Record<string, string[]> = {
      lunes: ["lunes", "lu"],
      martes: ["martes", "ma"],
      miercoles: ["miercoles", "mi", "miércoles"],
      jueves: ["jueves", "ju"],
      viernes: ["viernes", "vi"],
      sabado: ["sabado", "sa", "sábado", "sá"],
      domingo: ["domingo", "do"],
    };
    const normalizedToday = today.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    return values.some((value) =>
      (aliases[normalizedToday] ?? [normalizedToday]).some((alias) =>
        value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(alias),
      ),
    );
  }

  private includesValue(value: unknown, needle: string): boolean {
    return this.toStringArray(value).some((item) => item.toLowerCase().includes(needle));
  }

  private toStringArray(value: unknown): string[] {
    if (!value) {
      return [];
    }

    if (Array.isArray(value)) {
      return value.flatMap((item) => this.toStringArray(item));
    }

    if (typeof value === "string") {
      return value
        .split(/[|,]/g)
        .map((item) => item.trim())
        .filter(Boolean);
    }

    if (typeof value === "object") {
      return Object.values(value as Record<string, unknown>).flatMap((item) => this.toStringArray(item));
    }

    return [];
  }
}

export const adminDashboardService = new AdminDashboardService();
