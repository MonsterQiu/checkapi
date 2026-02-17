import type { CheckError } from "@/contracts/check";

type ErrorCategory = CheckError["category"];

export function buildCheckError(params: {
  errorCode: string;
  category: ErrorCategory;
  message: string;
  providerStatus?: string;
  retryAdvice?: string;
}): CheckError {
  return {
    error_code: params.errorCode,
    category: params.category,
    message: params.message,
    retry_advice:
      params.retryAdvice ??
      defaultRetryAdvice(params.category, params.errorCode),
    provider_status: params.providerStatus ?? "unknown",
  };
}

export function classifyHttpError(params: {
  status: number;
  providerName: string;
}): CheckError {
  const { status, providerName } = params;

  if (status === 401 || status === 403) {
    return buildCheckError({
      errorCode: "AUTH_FAILED",
      category: "auth",
      message: `${providerName} 鉴权失败，API Key 可能无效或权限不足`,
      providerStatus: `http_${status}`,
      retryAdvice: "检查 Key 是否正确、是否过期、是否具备对应模型权限",
    });
  }

  if (status === 429) {
    return buildCheckError({
      errorCode: "RATE_LIMITED",
      category: "provider",
      message: `${providerName} 返回频率限制`,
      providerStatus: "rate_limited",
      retryAdvice: "稍后重试，或在厂商控制台检查限流与配额策略",
    });
  }

  if (status >= 500) {
    return buildCheckError({
      errorCode: "PROVIDER_UNAVAILABLE",
      category: "provider",
      message: `${providerName} 服务异常（${status}）`,
      providerStatus: "degraded",
      retryAdvice: "稍后重试，并关注厂商状态页是否存在服务异常",
    });
  }

  return buildCheckError({
    errorCode: "PROVIDER_ERROR",
    category: "provider",
    message: `${providerName} 返回异常状态码（${status}）`,
    providerStatus: `http_${status}`,
    retryAdvice: "稍后重试，若持续失败请检查厂商 API 文档与账号状态",
  });
}

function defaultRetryAdvice(
  category: ErrorCategory,
  errorCode: string,
): string {
  if (category === "validation") {
    return "检查输入格式后重试";
  }

  if (category === "auth") {
    return "确认 API Key 正确且具备目标模型权限";
  }

  if (category === "network") {
    return "检查网络连接后重试";
  }

  if (errorCode === "QUOTA_UNAVAILABLE") {
    return "额度接口可能未开放，可前往厂商控制台查看实时额度";
  }

  return "稍后重试，如持续失败请检查厂商状态与账号权限";
}
