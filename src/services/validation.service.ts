import { NormalizedBenefit } from "../types/benefit.types";

export class ValidationService {
  validate(normalizedBenefits: NormalizedBenefit[]): NormalizedBenefit[] {
    return normalizedBenefits.map((benefit) => this.validateOne(benefit));
  }

  private validateOne(benefit: NormalizedBenefit): NormalizedBenefit {
    const validationErrors: string[] = [];

    if (!benefit.merchantName || benefit.merchantName === "Por definir") {
      validationErrors.push("merchantName is required");
    }

    if (!benefit.title) {
      validationErrors.push("title is required");
    }

    if (benefit.benefitType === "unknown") {
      validationErrors.push("benefitType should not be unknown");
    }

    if (benefit.benefitType === "discount" && benefit.benefitValue === undefined) {
      validationErrors.push("discount benefits should include benefitValue");
    }

    let validationStatus: NormalizedBenefit["validationStatus"] = "valid";

    if (validationErrors.length > 0) {
      const hasHardFailure = validationErrors.includes("title is required");
      validationStatus = hasHardFailure ? "invalid" : "needs_review";
    }

    return {
      ...benefit,
      validationStatus,
      validationErrors,
    };
  }
}

export const validationService = new ValidationService();
