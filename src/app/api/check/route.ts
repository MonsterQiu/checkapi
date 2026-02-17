import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { checkRequestSchema, type CheckApiFailure } from "@/contracts/check";
import { buildCheckError } from "@/lib/check/errors";
import { runCheckOrchestration } from "@/lib/check/orchestrator";
import { checkSimpleRateLimit } from "@/lib/security/rate-limit";
import { redactText } from "@/lib/security/redact";
import { generateRequestId } from "@/lib/utils/id";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = generateRequestId();
  const forwardedFor = request.headers.get("x-forwarded-for") ?? "unknown";
  const clientIdentity = forwardedFor.split(",")[0]?.trim() || "unknown";
  const rateLimit = checkSimpleRateLimit(clientIdentity);

  if (!rateLimit.allowed) {
    const failure: CheckApiFailure = {
      ok: false,
      error: buildCheckError({
        errorCode: "RATE_LIMITED",
        category: "provider",
        message: "请求过于频繁，请稍后再试",
        providerStatus: "rate_limited",
        retryAdvice: "建议等待 1 分钟后重试",
      }),
      meta: {
        request_id: requestId,
      },
    };

    return NextResponse.json(failure, {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  try {
    const json = (await request.json()) as unknown;
    const input = checkRequestSchema.parse(json);
    const result = await runCheckOrchestration({
      input,
      requestId,
    });

    return NextResponse.json(
      {
        ok: true,
        data: result,
        meta: {
          request_id: requestId,
        },
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      const failure: CheckApiFailure = {
        ok: false,
        error: buildCheckError({
          errorCode: "INVALID_INPUT",
          category: "validation",
          message: "输入格式不正确，请检查厂商与 API Key",
          providerStatus: "invalid_input",
          retryAdvice: "确认已选择厂商并粘贴完整 API Key 后重试",
        }),
        meta: {
          request_id: requestId,
        },
      };

      return NextResponse.json(failure, {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      });
    }

    const message =
      error instanceof Error ? redactText(error.message) : "unknown";
    console.error(`[check-api][${requestId}] ${message}`);

    const failure: CheckApiFailure = {
      ok: false,
      error: buildCheckError({
        errorCode: "INTERNAL_ERROR",
        category: "unknown",
        message: "服务端暂时不可用，请稍后重试",
        providerStatus: "internal_error",
        retryAdvice: "稍后重试，若持续失败请检查部署日志",
      }),
      meta: {
        request_id: requestId,
      },
    };

    return NextResponse.json(failure, {
      status: 500,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
}
