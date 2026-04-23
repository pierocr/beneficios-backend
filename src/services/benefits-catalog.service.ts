import { getSupabaseAdminClient } from "../lib/supabase";

type BenefitSort = "best" | "discount" | "ending";
type WebBenefitChannel = "online" | "presencial" | "ambos";
type WebBenefitValueUnit = "percentage" | "clp" | "months" | "points" | "unknown";
type WebValidationStatus = "validated" | "monitoring" | "needs_review";

export interface BenefitSearchFilters {
  search?: string;
  category?: string;
  providerSlugs?: string[];
  paymentMethods?: string[];
  channels?: WebBenefitChannel[];
  days?: string[];
  minBenefitValue?: number;
  maxBenefitValue?: number;
  benefitTypes?: string[];
  todayOnly?: boolean;
  sortBy?: BenefitSort;
  page?: number;
  limit?: number;
}

interface BenefitDatabaseRow {
  id: string;
  provider_slug: string;
  bank_name: string;
  merchant_name: string;
  merchant_canonical_name: string;
  merchant_slug: string;
  category_name: string;
  title: string;
  benefit_type: string;
  benefit_value: number | string | null;
  benefit_value_unit: string;
  days: unknown;
  channel: unknown;
  payment_methods: unknown;
  cap_amount: number | string | null;
  terms_text: string | null;
  source_url: string;
  redirect_url: string | null;
  image_url: string | null;
  logo_url: string | null;
  raw_metadata: Record<string, unknown> | null;
  confidence_score: number | string;
  validation_status: string;
  last_seen_at: string;
  last_scraped_at: string;
  updated_at: string;
}

export interface WebBenefit {
  id: string;
  providerSlug: string;
  bankName: string;
  merchantName: string;
  merchantCanonicalName: string;
  merchantSlug: string;
  categoryName: string;
  title: string;
  benefitType: "discount" | "cashback" | "installments" | "points" | "unknown";
  benefitValue: number;
  benefitValueUnit: WebBenefitValueUnit;
  days: string[];
  channel: WebBenefitChannel;
  paymentMethods: string[];
  capAmount: number | null;
  termsText: string;
  sourceUrl: string;
  confidenceScore: number;
  validationStatus: WebValidationStatus;
  validUntil: string;
  lastUpdated: string;
  summary: string;
  conditions: string[];
  featuredTag: string | null;
  redirectUrl: string | null;
  imageUrl: string | null;
  logoUrl: string | null;
}

export interface BenefitsSearchResult {
  items: WebBenefit[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 240;
const MAX_FETCH_LIMIT = 700;

const PROVIDER_ALIASES: Record<string, string> = {
  "banco-de-chile": "bancochile",
  "banco-falabella": "falabella",
  "cencosud-scotiabank": "cencosudscotia",
};

const CATEGORY_LABELS: Record<string, string> = {
  restaurantes: "Restaurantes",
  cafeterias: "Cafeterias",
  comida_rapida: "Comida rapida",
  delivery: "Delivery",
  supermercados: "Supermercados",
  retail: "Retail",
  moda: "Moda",
  hogar: "Hogar",
  tecnologia: "Tecnologia",
  viajes: "Viajes",
  entretencion: "Entretencion",
  salud: "Salud",
  belleza: "Belleza",
  deportes_bienestar: "Deportes y bienestar",
  mascotas: "Mascotas",
  educacion: "Educacion",
  automotriz: "Automotriz",
  movilidad: "Movilidad",
  estacionamientos: "Estacionamientos",
  combustible: "Combustible",
  seguros: "Seguros",
  servicios: "Servicios",
  sustentabilidad: "Sustentabilidad",
  programas_puntos: "Programas de puntos",
  donaciones: "Donaciones",
  otros: "Otros",
};

const DAY_LABELS: Record<string, string> = {
  lunes: "Lunes",
  martes: "Martes",
  miercoles: "Miercoles",
  jueves: "Jueves",
  viernes: "Viernes",
  sabado: "Sabado",
  domingo: "Domingo",
};

const DAY_ORDER = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];

export class BenefitsCatalogService {
  async listBenefits(filters: BenefitSearchFilters = {}): Promise<WebBenefit[]> {
    const result = await this.searchBenefits(filters);
    return result.items;
  }

  async searchBenefits(filters: BenefitSearchFilters = {}): Promise<BenefitsSearchResult> {
    const supabase = getSupabaseAdminClient();
    const page = normalizePage(filters.page);
    const limit = normalizeLimit(filters.limit);
    const fetchLimit = getFetchLimit(filters, page, limit);

    let query = supabase
      .from("benefits")
      .select(
        [
          "id",
          "provider_slug",
          "bank_name",
          "merchant_name",
          "merchant_canonical_name",
          "merchant_slug",
          "category_name",
          "title",
          "benefit_type",
          "benefit_value",
          "benefit_value_unit",
          "days",
          "channel",
          "payment_methods",
          "cap_amount",
          "terms_text",
          "source_url",
          "redirect_url",
          "image_url",
          "logo_url",
          "raw_metadata",
          "confidence_score",
          "validation_status",
          "last_seen_at",
          "last_scraped_at",
          "updated_at",
        ].join(", "),
      )
      .eq("is_active", true)
      .neq("validation_status", "invalid")
      .limit(fetchLimit);

    const providerSlugs = normalizeProviderSlugs(filters.providerSlugs);
    if (providerSlugs.length > 0) {
      query = query.in("provider_slug", providerSlugs);
    }

    const category = normalizeCategoryFilter(filters.category);
    if (category) {
      query = query.eq("category_name", category);
    }

    const benefitTypes = filters.benefitTypes?.filter(Boolean) ?? [];
    if (benefitTypes.length > 0) {
      query = query.in("benefit_type", benefitTypes);
    }

    if (filters.minBenefitValue !== undefined) {
      query = query.gte("benefit_value", filters.minBenefitValue);
    }

    if (filters.maxBenefitValue !== undefined) {
      query = query.lte("benefit_value", filters.maxBenefitValue);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to load benefits: ${error.message}`);
    }

    const benefits = ((data ?? []) as unknown as BenefitDatabaseRow[])
      .map((row) => toWebBenefit(row))
      .filter((benefit) => runtimeFilterBenefit(benefit, filters))
      .sort((left, right) => compareBenefits(left, right, filters.sortBy));
    const offset = (page - 1) * limit;
    const items = benefits.slice(offset, offset + limit);

    return {
      items,
      page,
      limit,
      total: benefits.length,
      hasMore: offset + items.length < benefits.length || (data?.length ?? 0) === fetchLimit,
    };
  }

  async getBenefitByMerchant(providerSlug: string, merchantSlug: string): Promise<WebBenefit | null> {
    const supabase = getSupabaseAdminClient();
    const [normalizedProviderSlug] = normalizeProviderSlugs([providerSlug]);

    const { data, error } = await supabase
      .from("benefits")
      .select(
        [
          "id",
          "provider_slug",
          "bank_name",
          "merchant_name",
          "merchant_canonical_name",
          "merchant_slug",
          "category_name",
          "title",
          "benefit_type",
          "benefit_value",
          "benefit_value_unit",
          "days",
          "channel",
          "payment_methods",
          "cap_amount",
          "terms_text",
          "source_url",
          "redirect_url",
          "image_url",
          "logo_url",
          "raw_metadata",
          "confidence_score",
          "validation_status",
          "last_seen_at",
          "last_scraped_at",
          "updated_at",
        ].join(", "),
      )
      .eq("is_active", true)
      .neq("validation_status", "invalid")
      .eq("provider_slug", normalizedProviderSlug ?? providerSlug)
      .eq("merchant_slug", merchantSlug)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load benefit: ${error.message}`);
    }

    return data ? toWebBenefit(data as unknown as BenefitDatabaseRow) : null;
  }
}

function toWebBenefit(row: BenefitDatabaseRow): WebBenefit {
  const days = normalizeDays(toStringArray(row.days));
  const channel = normalizeChannel(toStringArray(row.channel));
  const paymentMethods = normalizePaymentMethods(toStringArray(row.payment_methods));
  const termsText = row.terms_text || row.title;
  const confidenceScore = toNumber(row.confidence_score) ?? 0;
  const benefitValue = toNumber(row.benefit_value) ?? 0;
  const capAmount = toNumber(row.cap_amount);
  const lastUpdated = row.last_scraped_at || row.last_seen_at || row.updated_at;
  const validUntil = extractValidUntil(row.raw_metadata) ?? addDaysIsoDate(lastUpdated, 45);
  const categoryName = CATEGORY_LABELS[row.category_name] ?? titleize(row.category_name);
  const benefitType = normalizeBenefitType(row.benefit_type);
  const benefitValueUnit = normalizeBenefitValueUnit(row.benefit_value_unit, benefitType);

  return {
    id: row.id,
    providerSlug: row.provider_slug,
    bankName: row.bank_name,
    merchantName: row.merchant_name,
    merchantCanonicalName: row.merchant_canonical_name,
    merchantSlug: row.merchant_slug,
    categoryName,
    title: row.title,
    benefitType,
    benefitValue,
    benefitValueUnit,
    days,
    channel,
    paymentMethods,
    capAmount,
    termsText,
    sourceUrl: row.redirect_url || row.source_url,
    confidenceScore,
    validationStatus: normalizeValidationStatus(row.validation_status, confidenceScore),
    validUntil,
    lastUpdated,
    summary: buildSummary({
      merchantName: row.merchant_name,
      bankName: row.bank_name,
      benefitType,
      benefitValue,
      benefitValueUnit,
      days,
      channel,
      capAmount,
    }),
    conditions: buildConditions(termsText, paymentMethods, capAmount),
    featuredTag: confidenceScore >= 0.9 && benefitValue >= 30 ? "Alta oportunidad" : null,
    redirectUrl: row.redirect_url,
    imageUrl: row.image_url,
    logoUrl: row.logo_url,
  };
}

function runtimeFilterBenefit(benefit: WebBenefit, filters: BenefitSearchFilters): boolean {
  const search = normalizeSearch(filters.search);
  const channels = filters.channels ?? [];
  const paymentMethods = filters.paymentMethods?.map(normalizeSearch).filter(Boolean) ?? [];
  const days = filters.days && filters.days.length > 0 ? normalizeDays(filters.days) : [];
  const today = DAY_LABELS[getTodayKey()] ?? "";
  const haystack = normalizeSearch(
    [
      benefit.bankName,
      benefit.merchantName,
      benefit.merchantCanonicalName,
      benefit.categoryName,
      benefit.title,
      benefit.summary,
      benefit.termsText,
      benefit.paymentMethods.join(" "),
      benefit.days.join(" "),
    ].join(" "),
  );

  const matchesSearch = !search || haystack.includes(search);
  const matchesChannels = channels.length === 0 || channels.includes(benefit.channel);
  const benefitPaymentMethods = benefit.paymentMethods.map(normalizeSearch);
  const matchesPayment =
    paymentMethods.length === 0 || paymentMethods.some((method) => benefitPaymentMethods.includes(method));
  const matchesDays =
    days.length === 0 || benefit.days.includes("Todos los dias") || days.some((day) => benefit.days.includes(day));
  const matchesMinDiscount =
    filters.minBenefitValue === undefined || (isDiscountLike(benefit) && benefit.benefitValue >= filters.minBenefitValue);
  const matchesToday =
    !filters.todayOnly || benefit.days.includes("Todos los dias") || (today ? benefit.days.includes(today) : false);

  return matchesSearch && matchesChannels && matchesPayment && matchesDays && matchesMinDiscount && matchesToday;
}

function compareBenefits(left: WebBenefit, right: WebBenefit, sortBy: BenefitSort = "best"): number {
  if (sortBy === "discount") {
    return discountComparableValue(right) - discountComparableValue(left);
  }

  if (sortBy === "ending") {
    return new Date(left.validUntil).getTime() - new Date(right.validUntil).getTime();
  }

  const leftScore = discountComparableValue(left) * left.confidenceScore + (left.featuredTag ? 10 : 0);
  const rightScore = discountComparableValue(right) * right.confidenceScore + (right.featuredTag ? 10 : 0);
  return rightScore - leftScore;
}

function discountComparableValue(benefit: WebBenefit): number {
  return isDiscountLike(benefit) ? benefit.benefitValue : 0;
}

function isDiscountLike(benefit: WebBenefit): boolean {
  return ["discount", "cashback"].includes(benefit.benefitType) && benefit.benefitValueUnit === "percentage";
}

function normalizeProviderSlugs(providerSlugs: string[] | undefined): string[] {
  return Array.from(new Set((providerSlugs ?? []).map((slug) => PROVIDER_ALIASES[slug] ?? slug).filter(Boolean)));
}

function normalizeCategoryFilter(category: string | undefined): string | undefined {
  if (!category) {
    return undefined;
  }

  const normalized = normalizeSearch(category).replace(/ /g, "_");
  const match = Object.entries(CATEGORY_LABELS).find(([, label]) => normalizeSearch(label).replace(/ /g, "_") === normalized);
  return match?.[0] ?? normalized;
}

function normalizeDays(days: string[]): string[] {
  const normalizedDays = days
    .map((day) => normalizeSearch(day))
    .flatMap((day) => {
      if (day.includes("todos")) {
        return ["Todos los dias"];
      }

      const dayKey = DAY_ORDER.find((item) => normalizeSearch(item) === day);
      const dayLabel = dayKey ? DAY_LABELS[dayKey] : undefined;
      return dayLabel ? [dayLabel] : [];
    });

  return Array.from(new Set(normalizedDays.length > 0 ? normalizedDays : ["Todos los dias"]));
}

function normalizeChannel(channels: string[]): WebBenefitChannel {
  const normalized = channels.map(normalizeSearch);
  const hasOnline = normalized.some((item) => ["online", "web", "app"].includes(item));
  const hasPresencial = normalized.some((item) => ["presencial", "tienda"].includes(item));

  if (hasOnline && hasPresencial) {
    return "ambos";
  }

  if (hasOnline) {
    return "online";
  }

  if (hasPresencial) {
    return "presencial";
  }

  return "ambos";
}

function normalizePaymentMethods(methods: string[]): string[] {
  const normalized = methods
    .map((method) => {
      const value = normalizeSearch(method);
      if (value.includes("credito") || value === "cmr") return "Credito";
      if (value.includes("debito")) return "Debito";
      if (value.includes("prepago")) return "Prepago";
      if (value.includes("tarjeta")) return "Tarjeta";
      return titleize(method);
    })
    .filter(Boolean);

  return Array.from(new Set(normalized.length > 0 ? normalized : ["Tarjeta"]));
}

function normalizeBenefitType(value: string): WebBenefit["benefitType"] {
  if (["discount", "cashback", "installments", "points"].includes(value)) {
    return value as WebBenefit["benefitType"];
  }

  return "unknown";
}

function normalizeBenefitValueUnit(value: string, benefitType: WebBenefit["benefitType"]): WebBenefitValueUnit {
  if (benefitType === "installments") return "months";
  if (benefitType === "points") return "points";
  if (value === "percent") return "percentage";
  if (value === "amount") return "clp";
  return "unknown";
}

function normalizeValidationStatus(value: string, confidenceScore: number): WebValidationStatus {
  if (value === "valid") return "validated";
  if (value === "needs_review") return "needs_review";
  return confidenceScore >= 0.82 ? "monitoring" : "needs_review";
}

function buildSummary(input: {
  merchantName: string;
  bankName: string;
  benefitType: WebBenefit["benefitType"];
  benefitValue: number;
  benefitValueUnit: WebBenefitValueUnit;
  days: string[];
  channel: WebBenefitChannel;
  capAmount: number | null;
}): string {
  const value =
    input.benefitValueUnit === "percentage"
      ? `${input.benefitValue}%`
      : input.benefitValue > 0
        ? String(input.benefitValue)
        : "beneficio";
  const days = input.days.includes("Todos los dias") ? "todos los dias" : input.days.join(", ");
  const channel = input.channel === "ambos" ? "online y presencial" : input.channel;
  const cap = input.capAmount ? ` con tope de ${new Intl.NumberFormat("es-CL").format(input.capAmount)} CLP` : "";

  if (input.benefitType === "cashback") {
    return `${value} de cashback en ${input.merchantName} con ${input.bankName}, disponible ${days} por canal ${channel}${cap}.`;
  }

  if (input.benefitType === "installments") {
    return `Cuotas o financiamiento preferente en ${input.merchantName} con ${input.bankName}, disponible ${days} por canal ${channel}${cap}.`;
  }

  return `${value} de descuento en ${input.merchantName} con ${input.bankName}, disponible ${days} por canal ${channel}${cap}.`;
}

function buildConditions(termsText: string, paymentMethods: string[], capAmount: number | null): string[] {
  const sentences = termsText
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 20)
    .slice(0, 3);

  if (paymentMethods.length > 0) {
    sentences.unshift(`Medio de pago detectado: ${paymentMethods.join(", ")}.`);
  }

  if (capAmount !== null) {
    sentences.unshift(`Tope informado: ${new Intl.NumberFormat("es-CL").format(capAmount)} CLP.`);
  }

  return Array.from(new Set(sentences)).slice(0, 4);
}

function extractValidUntil(metadata: Record<string, unknown> | null): string | undefined {
  if (!metadata) {
    return undefined;
  }

  const candidates = [metadata.endDate, metadata.validUntil, metadata.fechaTermino, metadata.validityEnd];
  const value = candidates.find((item) => typeof item === "string" && !Number.isNaN(Date.parse(item)));
  return typeof value === "string" ? new Date(value).toISOString() : undefined;
}

function addDaysIsoDate(date: string, days: number): string {
  const parsedDate = Number.isNaN(Date.parse(date)) ? new Date() : new Date(date);
  parsedDate.setDate(parsedDate.getDate() + days);
  return parsedDate.toISOString();
}

function getTodayKey(): string {
  const dayIndex = new Date().getDay();
  return DAY_ORDER[dayIndex === 0 ? 6 : dayIndex - 1] ?? "lunes";
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }

  if (typeof value === "string" && value.trim()) {
    return [value];
  }

  return [];
}

function toNumber(value: number | string | null): number | null {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function titleize(value: string): string {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function normalizeSearch(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizePage(page: number | undefined): number {
  return Number.isInteger(page) && page !== undefined && page > 0 ? page : 1;
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isInteger(limit) || limit === undefined || limit <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(limit, MAX_LIMIT);
}

function getFetchLimit(filters: BenefitSearchFilters, page: number, limit: number): number {
  const needsRuntimeFiltering =
    Boolean(filters.todayOnly) ||
    Boolean(filters.channels?.length) ||
    Boolean(filters.days?.length) ||
    Boolean(filters.paymentMethods?.length) ||
    Boolean(filters.search);

  if (needsRuntimeFiltering || filters.sortBy === "best") {
    return Math.min(MAX_FETCH_LIMIT, Math.max(limit, page * limit * 3));
  }

  return Math.min(MAX_FETCH_LIMIT, page * limit);
}


export const benefitsCatalogService = new BenefitsCatalogService();
