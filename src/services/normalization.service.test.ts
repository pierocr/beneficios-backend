import assert from "node:assert/strict";
import test from "node:test";
import { RawBenefit } from "../types/benefit.types";
import { normalizationService } from "./normalization.service";
import { validationService } from "./validation.service";

const baseRawBenefit = (overrides: Partial<RawBenefit>): RawBenefit => ({
  providerSlug: "test-provider",
  bankName: "Banco Test",
  sourceUrl: "https://example.com",
  rawText: "",
  extractedAt: "2026-06-04T21:00:00.000Z",
  ...overrides,
});

const normalizeAndValidate = (rawBenefit: RawBenefit) => {
  const [normalized] = normalizationService.normalize([rawBenefit]);
  assert.ok(normalized);
  const [validated] = validationService.validate([normalized]);
  assert.ok(validated);
  return validated;
};

test("normalizes CLP discount amounts without treating them as percentages", () => {
  const benefit = normalizeAndValidate(
    baseRawBenefit({
      rawTitle: "Hasta $300 dcto por litro de bencina",
      rawMerchant: "Apps de Bencina",
      rawText: "Hasta $300 dcto por litro de bencina pagando con tarjeta.",
    }),
  );

  assert.equal(benefit.benefitType, "discount");
  assert.equal(benefit.benefitValue, 300);
  assert.equal(benefit.benefitValueUnit, "amount");
  assert.equal(benefit.validationStatus, "valid");
});

test("normalizes CLP cashback from devolucion copy", () => {
  const benefit = normalizeAndValidate(
    baseRawBenefit({
      rawTitle: "$50.000 de devolucion en Despegar",
      rawMerchant: "Despegar",
      rawText: "$50.000 de devolucion en Despegar comprando online.",
    }),
  );

  assert.equal(benefit.benefitType, "cashback");
  assert.equal(benefit.benefitValue, 50000);
  assert.equal(benefit.benefitValueUnit, "amount");
  assert.equal(benefit.validationStatus, "valid");
});

test("classifies free shipping without requiring a numeric value", () => {
  const benefit = normalizeAndValidate(
    baseRawBenefit({
      rawTitle: "Despacho gratis",
      rawMerchant: "Tienda Test",
      rawText: "Despacho gratis pagando con tarjeta de credito.",
    }),
  );

  assert.equal(benefit.benefitType, "free_shipping");
  assert.equal(benefit.benefitValue, undefined);
  assert.equal(benefit.validationStatus, "valid");
});

test("classifies access and presale benefits without forcing discount values", () => {
  const benefit = normalizeAndValidate(
    baseRawBenefit({
      rawTitle: "Preventas exclusivas",
      rawMerchant: "Colo-Colo",
      rawText: "Preventas exclusivas para eventos seleccionados.",
    }),
  );

  assert.equal(benefit.benefitType, "access");
  assert.equal(benefit.benefitValue, undefined);
  assert.equal(benefit.validationStatus, "valid");
});
