"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  CheckApiFailure,
  CheckApiResponse,
  CheckApiSuccess,
  Provider,
} from "@/contracts/check";

const STORAGE_KEY = "checkapi:key-cache";
const CACHE_TTL_MS = 2 * 60 * 1000;

type RequestState = "idle" | "checking" | "done" | "failed";

type CacheEnvelope = {
  value: string;
  expiresAt: number;
};

function toSummary(data: CheckApiSuccess["data"]): string {
  const modelsPreview = data.models.slice(0, 8).join(", ") || "无";
  const actions = data.next_actions.join(" | ") || "无";
  const modeLabel = data.meta.strict_mode ? "strict_target" : "catalog";

  return [
    `Provider: ${data.provider}`,
    `Mode: ${modeLabel}`,
    `Target Model: ${data.meta.target_model ?? "none"}`,
    `Availability: ${data.availability}`,
    `Models(${data.models.length}): ${modelsPreview}`,
    `Quota: ${data.quota_status}`,
    `Health Score: ${data.health_score}`,
    `Next Actions: ${actions}`,
    `Request ID: ${data.meta.request_id}`,
  ].join("\n");
}

function parseCache(raw: string | null): CacheEnvelope | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as CacheEnvelope;

    if (
      typeof parsed.value !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export default function Home() {
  const [provider, setProvider] = useState<Provider>("auto");
  const [apiKey, setApiKey] = useState("");
  const [strictMode, setStrictMode] = useState(false);
  const [targetModel, setTargetModel] = useState("gpt-5.3-codex");
  const [allowLocalCache, setAllowLocalCache] = useState(true);
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [result, setResult] = useState<CheckApiSuccess["data"] | null>(null);
  const [failure, setFailure] = useState<CheckApiFailure["error"] | null>(null);
  const [cacheCountdown, setCacheCountdown] = useState<number | null>(null);
  const [copyLabel, setCopyLabel] = useState("复制结果摘要");

  useEffect(() => {
    const cached = parseCache(window.localStorage.getItem(STORAGE_KEY));
    if (!cached) {
      return;
    }

    if (cached.expiresAt <= Date.now()) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    const timer = window.setTimeout(() => {
      setApiKey(cached.value);
      setCacheCountdown(Math.ceil((cached.expiresAt - Date.now()) / 1000));
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!cacheCountdown) {
      return;
    }

    const timer = window.setInterval(() => {
      setCacheCountdown((previous) => {
        if (!previous || previous <= 1) {
          window.localStorage.removeItem(STORAGE_KEY);
          return null;
        }
        return previous - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [cacheCountdown]);

  const statusLabel = useMemo(() => {
    if (requestState === "checking") {
      return "正在检测，请稍候...";
    }

    if (requestState === "done") {
      return "检测完成";
    }

    if (requestState === "failed") {
      return "检测失败";
    }

    return "等待开始";
  }, [requestState]);

  const statusTone = useMemo(() => {
    if (requestState === "checking") {
      return "bg-[#fff7ed] text-[#9a3412]";
    }

    if (requestState === "done") {
      return "bg-[#ecfdf5] text-[#065f46]";
    }

    if (requestState === "failed") {
      return "bg-[#fff1f2] text-[#9f1239]";
    }

    return "bg-[#eef3f6] text-[#334155]";
  }, [requestState]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestState("checking");
    setResult(null);
    setFailure(null);

    if (allowLocalCache) {
      const expiresAt = Date.now() + CACHE_TTL_MS;
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          value: apiKey,
          expiresAt,
        }),
      );
      setCacheCountdown(Math.ceil(CACHE_TTL_MS / 1000));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
      setCacheCountdown(null);
    }

    try {
      const response = await fetch("/api/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider,
          api_key: apiKey.trim(),
          strict_mode: strictMode,
          target_model:
            strictMode && targetModel.trim().length > 0
              ? targetModel.trim()
              : undefined,
        }),
      });

      const payload = (await response.json()) as CheckApiResponse;

      if (!payload.ok) {
        setRequestState("failed");
        setFailure(payload.error);
        return;
      }

      setRequestState("done");
      setResult(payload.data);
    } catch {
      setRequestState("failed");
      setFailure({
        error_code: "NETWORK_ERROR",
        category: "network",
        message: "请求失败，请检查网络或稍后重试",
        retry_advice: "确认网络连接后重新检测",
        provider_status: "network_error",
      });
    }
  }

  async function copyResultSummary() {
    if (!result) {
      return;
    }

    await navigator.clipboard.writeText(toSummary(result));
    setCopyLabel("已复制");
    window.setTimeout(() => setCopyLabel("复制结果摘要"), 1200);
  }

  function clearCacheAndInput() {
    setApiKey("");
    setCacheCountdown(null);
    window.localStorage.removeItem(STORAGE_KEY);
  }

  return (
    <div className="min-h-screen px-4 py-8 sm:px-8 lg:py-10">
      <main className="mx-auto w-full max-w-6xl">
        <header className="ux-fade-in mb-6 rounded-3xl border border-[#d8e5ea] bg-white/85 p-6 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.35)] backdrop-blur md:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-mono text-xs tracking-[0.18em] text-[#2f5a68]">
                CHECK.ATHINKER.NET
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#0f2330] md:text-4xl">
                API Key 可用性检测
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#355463] md:text-base">
                单页完成输入、检测、判断与复制结果。默认优先返回可用性结论，
                再提供模型列表、额度状态和重试建议。
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-[#d6e7ea] bg-[#f6fbfd] px-3 py-1 text-[#305665]">
                10s 内返回
              </span>
              <span className="rounded-full border border-[#d6e7ea] bg-[#f6fbfd] px-3 py-1 text-[#305665]">
                Serverless 检测
              </span>
              <span className="rounded-full border border-[#d6e7ea] bg-[#f6fbfd] px-3 py-1 text-[#305665]">
                明文 Key 零落盘
              </span>
            </div>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[400px_minmax(0,1fr)]">
          <section className="ux-fade-in rounded-3xl border border-[#d8e5ea] bg-white p-5 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.4)] md:p-6">
            <h2 className="text-base font-semibold text-[#132f3d] md:text-lg">
              检测输入
            </h2>
            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              <div>
                <label
                  htmlFor="provider"
                  className="block text-sm font-medium text-[#274757]"
                >
                  厂商
                </label>
                <select
                  id="provider"
                  name="provider"
                  value={provider}
                  onChange={(event) =>
                    setProvider(event.target.value as Provider)
                  }
                  className="mt-2 h-11 w-full rounded-xl border border-[#c9dde4] bg-[#f9fcfd] px-3 text-sm text-[#12303e] outline-none ring-[#0f766e] transition focus:ring-2"
                >
                  <option value="auto">自动识别（推荐）</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="api_key"
                  className="block text-sm font-medium text-[#274757]"
                >
                  API Key
                </label>
                <input
                  id="api_key"
                  name="api_key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  required
                  placeholder="例如：sk-..."
                  className="mt-2 h-11 w-full rounded-xl border border-[#c9dde4] bg-[#f9fcfd] px-3 text-sm text-[#12303e] outline-none ring-[#0f766e] transition focus:ring-2"
                />
                <p className="mt-2 text-xs text-[#55707c]">
                  检测请求由服务端发起，浏览器不直连第三方厂商接口。
                </p>
              </div>

              <label className="flex items-center gap-2 rounded-xl border border-[#d7e6ea] bg-[#f8fbfc] px-3 py-2 text-sm text-[#264555]">
                <input
                  type="checkbox"
                  checked={allowLocalCache}
                  onChange={(event) => setAllowLocalCache(event.target.checked)}
                  className="h-4 w-4 rounded border-[#9eb8c2] text-[#0f766e] focus:ring-[#0f766e]"
                />
                允许浏览器本地暂存 2 分钟
              </label>

              <label className="flex items-center gap-2 rounded-xl border border-[#d7e6ea] bg-[#f8fbfc] px-3 py-2 text-sm text-[#264555]">
                <input
                  type="checkbox"
                  checked={strictMode}
                  onChange={(event) => setStrictMode(event.target.checked)}
                  className="h-4 w-4 rounded border-[#9eb8c2] text-[#0f766e] focus:ring-[#0f766e]"
                />
                严格权限检测（仅验证指定模型）
              </label>

              {strictMode ? (
                <div>
                  <label
                    htmlFor="target_model"
                    className="block text-sm font-medium text-[#274757]"
                  >
                    目标模型 ID
                  </label>
                  <input
                    id="target_model"
                    name="target_model"
                    type="text"
                    value={targetModel}
                    onChange={(event) => setTargetModel(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    required={strictMode}
                    placeholder="例如：gpt-5.3-codex"
                    className="mt-2 h-11 w-full rounded-xl border border-[#c9dde4] bg-[#f9fcfd] px-3 text-sm text-[#12303e] outline-none ring-[#0f766e] transition focus:ring-2"
                  />
                  <p className="mt-2 text-xs text-[#55707c]">
                    启用后会对该模型发起最小调用验证，结果可代表真实权限。
                  </p>
                </div>
              ) : null}

              <div className="space-y-2">
                <button
                  type="submit"
                  disabled={
                    requestState === "checking" ||
                    apiKey.trim().length === 0 ||
                    (strictMode && targetModel.trim().length === 0)
                  }
                  className="h-11 w-full rounded-xl bg-[#0f766e] px-4 text-sm font-semibold text-white transition hover:bg-[#0b5a54] disabled:cursor-not-allowed disabled:bg-[#7ea9a5]"
                >
                  {requestState === "checking" ? "检测中..." : "开始检测"}
                </button>
                <button
                  type="button"
                  onClick={clearCacheAndInput}
                  className="h-11 w-full rounded-xl border border-[#ccdee5] bg-white px-4 text-sm font-medium text-[#234253] transition hover:bg-[#f2f8fa]"
                >
                  清空 Key
                </button>
              </div>

              <div className="rounded-xl border border-[#d7e6ea] bg-[#f8fbfc] px-3 py-2 text-xs text-[#41616f]">
                {cacheCountdown ? (
                  <span className="font-mono">
                    本地缓存剩余 {cacheCountdown}s
                  </span>
                ) : (
                  "当前未缓存 Key"
                )}
              </div>
            </form>
          </section>

          <section className="ux-fade-in-delay rounded-3xl border border-[#d8e5ea] bg-white p-5 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.4)] md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-[#132f3d] md:text-lg">
                检测结果
              </h2>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${statusTone}`}
              >
                {statusLabel}
              </span>
            </div>

            {failure ? (
              <div className="mt-4 rounded-2xl border border-[#f5c7d5] bg-[#fff5f8] p-4 text-sm text-[#7f1d3f]">
                <p className="font-semibold">{failure.message}</p>
                <p className="mt-2">错误原因：{failure.error_code}</p>
                <p>厂商状态：{failure.provider_status}</p>
                <p>重试建议：{failure.retry_advice}</p>
              </div>
            ) : null}

            {result ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-[#d8e5ea] bg-[#f8fbfc] p-3">
                    <p className="text-xs text-[#4b6977]">可用性</p>
                    <p
                      className={`mt-1 text-sm font-semibold ${
                        result.availability === "available"
                          ? "text-[#0b5a54]"
                          : "text-[#8b173a]"
                      }`}
                    >
                      {result.availability === "available" ? "可用" : "不可用"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#d8e5ea] bg-[#f8fbfc] p-3">
                    <p className="text-xs text-[#4b6977]">Health Score</p>
                    <p className="mt-1 text-sm font-semibold text-[#123a48]">
                      {result.health_score}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#d8e5ea] bg-[#f8fbfc] p-3">
                    <p className="text-xs text-[#4b6977]">
                      {result.meta.strict_mode
                        ? "通过验证模型数"
                        : "平台返回模型数"}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#123a48]">
                      {result.models.length}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#d8e5ea] bg-[#f8fbfc] p-3">
                    <p className="text-xs text-[#4b6977]">额度状态</p>
                    <p className="mt-1 text-sm font-semibold text-[#123a48]">
                      {result.quota_status}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-[#d8e5ea] bg-[#f9fcfd] p-3 text-xs text-[#3e5e6d]">
                  <p>
                    请求 ID：
                    <span className="ml-1 font-mono">
                      {result.meta.request_id}
                    </span>
                  </p>
                  <p className="mt-1">检测耗时：{result.meta.duration_ms}ms</p>
                  <p className="mt-1">
                    检测模式：
                    {result.meta.strict_mode ? "严格权限检测" : "平台目录检测"}
                    {result.meta.strict_mode && result.meta.target_model
                      ? `（${result.meta.target_model}）`
                      : ""}
                  </p>
                </div>

                <div>
                  <p className="mb-2 text-sm font-semibold text-[#12303e]">
                    {result.meta.strict_mode
                      ? "严格模式验证模型"
                      : "平台返回模型目录"}
                  </p>
                  <div className="max-h-36 overflow-auto rounded-xl border border-[#d8e5ea] bg-[#f9fcfd] p-2">
                    {result.models.length > 0 ? (
                      <ul className="flex flex-wrap gap-2">
                        {result.models.slice(0, 30).map((model) => (
                          <li
                            key={model}
                            className="rounded-lg border border-[#d3e1e6] bg-white px-2 py-1 font-mono text-[11px] text-[#264656]"
                          >
                            {model}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-[#5a7581]">
                        {result.meta.strict_mode
                          ? "目标模型验证未通过或无权限"
                          : "未返回模型目录"}
                      </p>
                    )}
                  </div>
                  {!result.meta.strict_mode ? (
                    <p className="mt-2 text-xs text-[#6a3e18]">
                      注意：平台返回模型目录不等于当前 Key
                      的实际调用权限白名单。
                      若需精确判断，请启用“严格权限检测”并填写目标模型。
                    </p>
                  ) : null}
                </div>

                {result.errors.length > 0 ? (
                  <div>
                    <p className="mb-2 text-sm font-semibold text-[#12303e]">
                      错误 / 提示
                    </p>
                    <ul className="space-y-2">
                      {result.errors.map((error) => (
                        <li
                          key={`${error.error_code}-${error.provider_status}`}
                          className="rounded-xl border border-[#f1d5de] bg-[#fff7fa] p-3 text-xs text-[#7d2340]"
                        >
                          <p className="font-semibold">{error.message}</p>
                          <p className="mt-1">
                            厂商状态：{error.provider_status}
                          </p>
                          <p>重试建议：{error.retry_advice}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div>
                  <p className="mb-2 text-sm font-semibold text-[#12303e]">
                    下一步建议
                  </p>
                  <ul className="space-y-2 text-sm text-[#224554]">
                    {result.next_actions.map((action) => (
                      <li key={action} className="flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#0f766e]" />
                        <span>{action}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={copyResultSummary}
                  className="h-11 w-full rounded-xl border border-[#9ec2bf] bg-[#e6f4f2] px-4 text-sm font-semibold text-[#0f5f59] transition hover:bg-[#d6ece8]"
                >
                  {copyLabel}
                </button>
              </div>
            ) : null}

            {!result && !failure ? (
              <div className="mt-4 rounded-2xl border border-dashed border-[#c9dde4] bg-[#f9fcfd] p-4">
                <p className="text-sm font-semibold text-[#214656]">
                  等待检测结果
                </p>
                <ol className="mt-3 space-y-2 text-xs text-[#4d6a78]">
                  <li>1. 输入 API Key 并点击“开始检测”</li>
                  <li>2. 系统执行可用性、模型、额度状态检测</li>
                  <li>3. 返回统一结果与下一步建议</li>
                </ol>
              </div>
            ) : null}
          </section>
        </div>
      </main>
    </div>
  );
}
