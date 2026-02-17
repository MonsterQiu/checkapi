import { z } from "zod";

export const providerSchema = z.enum([
  "auto",
  "openai",
  "anthropic",
  "openrouter",
]);
export type Provider = z.infer<typeof providerSchema>;

export const checkRequestSchema = z.object({
  provider: providerSchema.default("auto"),
  api_key: z
    .string()
    .min(8, "API Key 长度太短")
    .max(256, "API Key 长度超出限制")
    .trim(),
});

export type CheckRequest = z.infer<typeof checkRequestSchema>;

export const errorCategorySchema = z.enum([
  "validation",
  "auth",
  "network",
  "provider",
  "quota",
  "unknown",
]);

export const checkErrorSchema = z.object({
  error_code: z.string(),
  category: errorCategorySchema,
  message: z.string(),
  retry_advice: z.string(),
  provider_status: z.string(),
});

export type CheckError = z.infer<typeof checkErrorSchema>;

export const quotaStatusSchema = z.enum([
  "available",
  "unavailable",
  "unknown",
]);
export type QuotaStatus = z.infer<typeof quotaStatusSchema>;

export const availabilitySchema = z.enum(["available", "unavailable"]);
export type Availability = z.infer<typeof availabilitySchema>;

export const normalizedCheckResultSchema = z.object({
  provider: z.string(),
  availability: availabilitySchema,
  models: z.array(z.string()),
  quota_status: quotaStatusSchema,
  errors: z.array(checkErrorSchema),
  health_score: z.number().int().min(0).max(100),
  next_actions: z.array(z.string()),
  meta: z.object({
    request_id: z.string(),
    checked_at: z.string(),
    duration_ms: z.number().int().nonnegative(),
  }),
});

export type NormalizedCheckResult = z.infer<typeof normalizedCheckResultSchema>;

export const checkApiSuccessSchema = z.object({
  ok: z.literal(true),
  data: normalizedCheckResultSchema,
  meta: z.object({
    request_id: z.string(),
  }),
});

export const checkApiFailureSchema = z.object({
  ok: z.literal(false),
  error: checkErrorSchema,
  meta: z.object({
    request_id: z.string(),
  }),
});

export type CheckApiSuccess = z.infer<typeof checkApiSuccessSchema>;
export type CheckApiFailure = z.infer<typeof checkApiFailureSchema>;
export type CheckApiResponse = CheckApiSuccess | CheckApiFailure;
