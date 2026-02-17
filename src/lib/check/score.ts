import type { CheckError, QuotaStatus } from "@/contracts/check";

export function calculateHealthScore(params: {
  availability: "available" | "unavailable";
  models: string[];
  quotaStatus: QuotaStatus;
  errors: CheckError[];
}): number {
  let score = 0;

  if (params.availability === "available") {
    score += 50;
  }

  if (params.models.length > 0) {
    score += 30;
  }

  if (params.quotaStatus === "available") {
    score += 20;
  } else if (params.quotaStatus === "unknown") {
    score += 8;
  }

  if (params.errors.some((error) => error.category === "auth")) {
    score = Math.min(score, 20);
  }

  if (params.errors.some((error) => error.error_code === "PROVIDER_TIMEOUT")) {
    score = Math.max(score - 10, 0);
  }

  return Math.max(0, Math.min(100, score));
}
