import type { CheckRequest, NormalizedCheckResult } from "@/contracts/check";
import { normalizedCheckResultSchema } from "@/contracts/check";
import { buildNextActions } from "@/lib/check/normalize";
import { calculateHealthScore } from "@/lib/check/score";
import { runProviderCheck } from "@/lib/providers";

export async function runCheckOrchestration(params: {
  input: CheckRequest;
  requestId: string;
}): Promise<NormalizedCheckResult> {
  const startedAt = Date.now();
  const providerResult = await runProviderCheck({
    provider: params.input.provider,
    apiKey: params.input.api_key,
  });

  const healthScore = calculateHealthScore({
    availability: providerResult.availability,
    models: providerResult.models,
    quotaStatus: providerResult.quota_status,
    errors: providerResult.errors,
  });

  const result: NormalizedCheckResult = {
    provider: providerResult.provider,
    availability: providerResult.availability,
    models: providerResult.models,
    quota_status: providerResult.quota_status,
    errors: providerResult.errors,
    health_score: healthScore,
    next_actions: buildNextActions({
      availability: providerResult.availability,
      models: providerResult.models,
      quotaStatus: providerResult.quota_status,
      errors: providerResult.errors,
    }),
    meta: {
      request_id: params.requestId,
      checked_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    },
  };

  return normalizedCheckResultSchema.parse(result);
}
