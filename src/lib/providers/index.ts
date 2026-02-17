import type { CheckError, Provider, QuotaStatus } from "@/contracts/check";
import { buildCheckError, classifyHttpError } from "@/lib/check/errors";
import { fetchWithTimeout } from "@/lib/check/timeout";

type ProviderRunResult = {
  provider: Exclude<Provider, "auto"> | "unknown";
  availability: "available" | "unavailable";
  models: string[];
  quota_status: QuotaStatus;
  errors: CheckError[];
};

type Adapter = {
  name: Exclude<Provider, "auto">;
  endpoint: string;
  buildHeaders: (apiKey: string) => HeadersInit;
};

const ADAPTERS: Record<Exclude<Provider, "auto">, Adapter> = {
  openai: {
    name: "openai",
    endpoint: "https://api.openai.com/v1/models",
    buildHeaders: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`,
    }),
  },
  anthropic: {
    name: "anthropic",
    endpoint: "https://api.anthropic.com/v1/models",
    buildHeaders: (apiKey) => ({
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    }),
  },
  openrouter: {
    name: "openrouter",
    endpoint: "https://openrouter.ai/api/v1/models",
    buildHeaders: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`,
    }),
  },
};

export async function runProviderCheck(params: {
  provider: Provider;
  apiKey: string;
}): Promise<ProviderRunResult> {
  const candidates =
    params.provider === "auto"
      ? detectProviderCandidates(params.apiKey)
      : [params.provider];

  if (candidates.length === 0) {
    return {
      provider: "unknown",
      availability: "unavailable",
      models: [],
      quota_status: "unknown",
      errors: [
        buildCheckError({
          errorCode: "PROVIDER_NOT_DETECTED",
          category: "validation",
          message: "无法自动识别厂商，请手动选择厂商后重试",
          providerStatus: "unsupported_provider",
          retryAdvice: "选择 OpenRouter、OpenAI 或 Anthropic 后再次检测",
        }),
      ],
    };
  }

  let firstFailure: ProviderRunResult | null = null;
  let authFailure: ProviderRunResult | null = null;

  for (const provider of candidates) {
    const result = await runSingleProviderCheck(provider, params.apiKey);

    if (result.availability === "available") {
      return result;
    }

    if (!firstFailure) {
      firstFailure = result;
    }

    if (result.errors.some((error) => error.error_code === "AUTH_FAILED")) {
      authFailure = result;
      continue;
    }

    return result;
  }

  return authFailure ?? firstFailure!;
}

async function runSingleProviderCheck(
  selectedProvider: Exclude<Provider, "auto">,
  apiKey: string,
): Promise<ProviderRunResult> {
  const adapter = ADAPTERS[selectedProvider];

  try {
    const response = await fetchWithTimeout(
      adapter.endpoint,
      {
        method: "GET",
        headers: adapter.buildHeaders(apiKey),
      },
      8_000,
    );

    if (!response.ok) {
      return {
        provider: selectedProvider,
        availability: "unavailable",
        models: [],
        quota_status: "unknown",
        errors: [
          classifyHttpError({
            status: response.status,
            providerName: formatProviderName(selectedProvider),
          }),
        ],
      };
    }

    const payload = (await response.json()) as unknown;
    const models = extractModelIds(payload).slice(0, 50);
    const quotaStatus = resolveQuotaStatus(response.headers);
    const errors: CheckError[] = [];

    if (quotaStatus !== "available") {
      errors.push(
        buildCheckError({
          errorCode: "QUOTA_UNAVAILABLE",
          category: "quota",
          message:
            "额度信息暂不可获取（可能是厂商接口未开放或当前 Key 无权限）",
          providerStatus: "quota_unknown",
          retryAdvice:
            "可用性检测已完成，可稍后重试，或前往厂商控制台查看实时额度",
        }),
      );
    }

    return {
      provider: selectedProvider,
      availability: "available",
      models,
      quota_status: quotaStatus,
      errors,
    };
  } catch (error) {
    const timeoutError = error instanceof Error && error.name === "AbortError";

    return {
      provider: selectedProvider,
      availability: "unavailable",
      models: [],
      quota_status: "unknown",
      errors: [
        buildCheckError({
          errorCode: timeoutError ? "PROVIDER_TIMEOUT" : "NETWORK_ERROR",
          category: "network",
          message: timeoutError
            ? "检测超时，请稍后重试"
            : "请求厂商 API 失败，请检查网络后重试",
          providerStatus: timeoutError ? "timeout" : "network_error",
          retryAdvice: timeoutError
            ? "稍后重试，若频繁超时可更换网络或错峰检测"
            : "检查网络连接后重试，必要时查看厂商状态页",
        }),
      ],
    };
  }
}

function detectProviderCandidates(apiKey: string): Exclude<Provider, "auto">[] {
  const normalized = apiKey.trim();

  if (normalized.startsWith("sk-ant-")) {
    return ["anthropic"];
  }

  if (normalized.startsWith("sk-or-v1-") || normalized.startsWith("sk-or-")) {
    return ["openrouter"];
  }

  if (normalized.startsWith("sk-proj-") || normalized.startsWith("sk-live-")) {
    return ["openai"];
  }

  if (normalized.startsWith("sk-")) {
    return ["openrouter", "openai"];
  }

  return [];
}

function extractModelIds(payload: unknown): string[] {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    !Array.isArray((payload as { data?: unknown }).data)
  ) {
    return [];
  }

  const data = (payload as { data: unknown[] }).data;

  return data
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }

      const id = (item as { id?: unknown }).id;
      return typeof id === "string" ? id : null;
    })
    .filter((id): id is string => Boolean(id));
}

function resolveQuotaStatus(headers: Headers): QuotaStatus {
  const potentialHeaders = [
    "x-ratelimit-limit-requests",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-limit-tokens",
    "anthropic-ratelimit-requests-limit",
    "anthropic-ratelimit-tokens-limit",
  ];

  const hasRateHint = potentialHeaders.some((key) => headers.has(key));
  return hasRateHint ? "available" : "unknown";
}

function formatProviderName(provider: Exclude<Provider, "auto">): string {
  if (provider === "openai") {
    return "OpenAI";
  }

  if (provider === "openrouter") {
    return "OpenRouter";
  }

  if (provider === "anthropic") {
    return "Anthropic";
  }

  return provider;
}
