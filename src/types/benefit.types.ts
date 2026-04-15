export type BenefitType = "discount" | "cashback" | "installments" | "points" | "unknown";
export type BenefitValueUnit = "percent" | "amount" | "unknown";
export type ValidationStatus = "valid" | "needs_review" | "invalid";
export type BenefitCategory =
  | "restaurantes"
  | "cafeterias"
  | "comida_rapida"
  | "delivery"
  | "supermercados"
  | "retail"
  | "moda"
  | "hogar"
  | "tecnologia"
  | "viajes"
  | "entretencion"
  | "salud"
  | "belleza"
  | "deportes_bienestar"
  | "mascotas"
  | "educacion"
  | "automotriz"
  | "movilidad"
  | "estacionamientos"
  | "combustible"
  | "seguros"
  | "servicios"
  | "sustentabilidad"
  | "programas_puntos"
  | "donaciones"
  | "otros";
export type CategorySource = "provider" | "merchant_rule" | "text_rule" | "fallback";
export type MerchantSource = "catalog_alias" | "raw_merchant" | "text_extraction" | "fallback";

export interface RawBenefit {
  providerSlug: string;
  bankName: string;
  sourceUrl: string;
  rawText: string;
  rawTitle?: string;
  rawCategory?: string;
  rawMerchant?: string;
  extractedAt: string;
  metadata?: Record<string, unknown>;
}

export interface NormalizedBenefit {
  providerSlug: string;
  bankName: string;
  merchantName: string;
  merchantCanonicalName: string;
  merchantSlug: string;
  merchantSource: MerchantSource;
  merchantMatchedAlias?: string;
  categoryName: BenefitCategory;
  categorySource: CategorySource;
  title: string;
  benefitType: BenefitType;
  benefitValue?: number;
  benefitValueUnit: BenefitValueUnit;
  days?: string[];
  channel?: string[];
  paymentMethods?: string[];
  capAmount?: number;
  termsText?: string;
  sourceUrl: string;
  confidenceScore: number;
  validationStatus: ValidationStatus;
  validationErrors: string[];
}
