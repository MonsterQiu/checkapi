import type { CheckError, Provider, QuotaStatus } from "@/contracts/check";
import { buildCheckError, classifyHttpError } from "@/lib/check/errors";
import { fetchWithTimeout } from "@/lib/check/timeout";

type ProviderRunMode = "catalog" | "strict_target";

type ProviderRunResult = {
  provider: Exclude<Provider, "auto"> | "unknown";
  availability: "available" | "unavailable";
  models: string[];
  quota_status: QuotaStatus;
  errors: CheckError[];
  mode: ProviderRunMode;
  target_model: string | null;
};

type StrictProbeAttempt = {
  endpoint: string;
  buildBody: (targetModel: string) => Record<string, unknown>;
};

type Adapter = {
  name: Exclude<Provider, "auto">;
  modelsEndpoint: string;
  buildHeaders: (apiKey: string) => HeadersInit;
  strictProbes: StrictProbeAttempt[];
};

const ADAPTERS: Record<Exclude<Provider, "auto">, Adapter> = {
  openai: {
    name: "openai",
    modelsEndpoint: "https://api.openai.com/v1/models",
    buildHeaders: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`,
    }),
    strictProbes: [
      {
        endpoint: "https://api.openai.com/v1/chat/completions",
        buildBody: (targetModel) => ({
          model: targetModel,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          temperature: 0,
        }),
      },
      {
        endpoint: "https://api.openai.com/v1/responses",
        buildBody: (targetModel) => ({
          model: targetModel,
          input: "ping",
          max_output_tokens: 1,
        }),
      },
    ],
  },
  anthropic: {
    name: "anthropic",
    modelsEndpoint: "https://api.anthropic.com/v1/models",
    buildHeaders: (apiKey) => ({
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    }),
    strictProbes: [
      {
        endpoint: "https://api.anthropic.com/v1/messages",
        buildBody: (targetModel) => ({
          model: targetModel,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
      },
    ],
  },
  openrouter: {
    name: "openrouter",
    modelsEndpoint: "https://openrouter.ai/api/v1/models",
    buildHeaders: (apiKey) => ({
      Authorization: `Bearer ${apiKey}`,
    }),
    strictProbes: [
      {
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        buildBody: (targetModel) => ({
          model: targetModel,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          temperature: 0,
        }),
      },
      {
        endpoint: "https://openrouter.ai/api/v1/responses",
        buildBody: (targetModel) => ({
          model: targetModel,
          input: "ping",
          max_output_tokens: 1,
        }),
      },
    ],
  },
};

export async function runProviderCheck(params: {
  provider: Provider;
  apiKey: string;
  strictMode: boolean;
  targetModel: string | null;
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
      mode: params.strictMode ? "strict_target" : "catalog",
      target_model: params.targetModel,
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
  let strictUnavailableFailure: ProviderRunResult | null = null;

  for (const provider of candidates) {
    const result = await runSingleProviderCheck({
      selectedProvider: provider,
      apiKey: params.apiKey,
      strictMode: params.strictMode,
      targetModel: params.targetModel,
    });

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

    if (
      params.strictMode &&
      result.errors.some(
        (error) => error.error_code === "TARGET_MODEL_UNAVAILABLE",
      )
    ) {
      strictUnavailableFailure = result;
      continue;
    }

    return result;
  }

  return authFailure ?? strictUnavailableFailure ?? firstFailure!;
}

async function runSingleProviderCheck(params: {
  selectedProvider: Exclude<Provider, "auto">;
  apiKey: string;
  strictMode: boolean;
  targetModel: string | null;
}): Promise<ProviderRunResult> {
  const selectedProvider = params.selectedProvider;
  const adapter = ADAPTERS[selectedProvider];

  if (params.strictMode) {
    if (!params.targetModel) {
      return {
        provider: selectedProvider,
        availability: "unavailable",
        models: [],
        quota_status: "unknown",
        mode: "strict_target",
        target_model: null,
        errors: [
          buildCheckError({
            errorCode: "MISSING_TARGET_MODEL",
            category: "validation",
            message: "已启用严格权限检测，请填写目标模型 ID",
            providerStatus: "missing_target_model",
            retryAdvice: "例如填写 gpt-5.3-codex 后再检测",
          }),
        ],
      };
    }

    return runStrictTargetModelCheck({
      adapter,
      apiKey: params.apiKey,
      targetModel: params.targetModel,
    });
  }

  try {
    const response = await fetchWithTimeout(
      adapter.modelsEndpoint,
      {
        method: "GET",
        headers: adapter.buildHeaders(params.apiKey),
      },
      8_000,
    );

    if (!response.ok) {
      return {
        provider: selectedProvider,
        availability: "unavailable",
        models: [],
        quota_status: "unknown",
        mode: "catalog",
        target_model: null,
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
      mode: "catalog",
      target_model: null,
      errors,
    };
  } catch (error) {
    const timeoutError = error instanceof Error && error.name === "AbortError";

    return {
      provider: selectedProvider,
      availability: "unavailable",
      models: [],
      quota_status: "unknown",
      mode: "catalog",
      target_model: null,
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

async function runStrictTargetModelCheck(params: {
  adapter: Adapter;
  apiKey: string;
  targetModel: string;
}): Promise<ProviderRunResult> {
  const providerName = formatProviderName(params.adapter.name);
  let lastUnavailableStatus: number | null = null;

  for (const probe of params.adapter.strictProbes) {
    try {
      const response = await fetchWithTimeout(
        probe.endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...params.adapter.buildHeaders(params.apiKey),
          },
          body: JSON.stringify(probe.buildBody(params.targetModel)),
        },
        8_000,
      );

      if (response.ok) {
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
                "严格权限检测已通过，可稍后重试，或前往厂商控制台查看实时额度",
            }),
          );
        }

        return {
          provider: params.adapter.name,
          availability: "available",
          models: [params.targetModel],
          quota_status: quotaStatus,
          mode: "strict_target",
          target_model: params.targetModel,
          errors,
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          provider: params.adapter.name,
          availability: "unavailable",
          models: [],
          quota_status: "unknown",
          mode: "strict_target",
          target_model: params.targetModel,
          errors: [
            classifyHttpError({
              status: response.status,
              providerName,
            }),
          ],
        };
      }

      if (response.status === 429 || response.status >= 500) {
        return {
          provider: params.adapter.name,
          availability: "unavailable",
          models: [],
          quota_status: "unknown",
          mode: "strict_target",
          target_model: params.targetModel,
          errors: [
            classifyHttpError({
              status: response.status,
              providerName,
            }),
          ],
        };
      }

      if (
        response.status === 400 ||
        response.status === 404 ||
        response.status === 422
      ) {
        lastUnavailableStatus = response.status;
        continue;
      }

      return {
        provider: params.adapter.name,
        availability: "unavailable",
        models: [],
        quota_status: "unknown",
        mode: "strict_target",
        target_model: params.targetModel,
        errors: [
          buildCheckError({
            errorCode: "STRICT_PROBE_FAILED",
            category: "provider",
            message: `${providerName} 严格权限检测失败（${response.status}）`,
            providerStatus: `http_${response.status}`,
            retryAdvice: "稍后重试，若持续失败请切换厂商或确认模型 ID",
          }),
        ],
      };
    } catch (error) {
      const timeoutError =
        error instanceof Error && error.name === "AbortError";

      return {
        provider: params.adapter.name,
        availability: "unavailable",
        models: [],
        quota_status: "unknown",
        mode: "strict_target",
        target_model: params.targetModel,
        errors: [
          buildCheckError({
            errorCode: timeoutError ? "PROVIDER_TIMEOUT" : "NETWORK_ERROR",
            category: "network",
            message: timeoutError
              ? "严格权限检测超时，请稍后重试"
              : "严格权限检测请求失败，请检查网络后重试",
            providerStatus: timeoutError ? "timeout" : "network_error",
            retryAdvice: timeoutError
              ? "稍后重试，若频繁超时可错峰检测"
              : "检查网络连接后重试，必要时查看厂商状态页",
          }),
        ],
      };
    }
  }

  return {
    provider: params.adapter.name,
    availability: "unavailable",
    models: [],
    quota_status: "unknown",
    mode: "strict_target",
    target_model: params.targetModel,
    errors: [
      buildCheckError({
        errorCode: "TARGET_MODEL_UNAVAILABLE",
        category: "provider",
        message: `目标模型 ${params.targetModel} 在 ${providerName} 不可用或当前 Key 无权限`,
        providerStatus:
          lastUnavailableStatus !== null
            ? `http_${lastUnavailableStatus}`
            : "target_model_unavailable",
        retryAdvice: "请确认模型 ID 与 Key 权限，或切换厂商后重试",
      }),
    ],
  };
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
