import type { CheckError, QuotaStatus } from "@/contracts/check";

export function buildNextActions(params: {
  availability: "available" | "unavailable";
  models: string[];
  quotaStatus: QuotaStatus;
  errors: CheckError[];
}): string[] {
  const actions: string[] = [];

  if (params.availability === "available" && params.models.length > 0) {
    actions.push(`优先尝试模型: ${params.models[0]}`);
  }

  if (params.quotaStatus !== "available") {
    actions.push("额度信息暂不可获取，请前往厂商控制台查看实时额度");
  }

  const retryAdvice = params.errors
    .map((error) => error.retry_advice)
    .find((advice) => advice.length > 0);

  if (retryAdvice) {
    actions.push(retryAdvice);
  }

  if (actions.length === 0) {
    actions.push("检测通过，可直接在你的应用中接入此 API Key");
  }

  return Array.from(new Set(actions)).slice(0, 5);
}
