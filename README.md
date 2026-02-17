# CheckApi Web

CheckApi 是一个部署在 Vercel 的 API Key 快速检测工具（目标域名：`check.athinker.net`）。
当前 MVP 支持：

- API Key 可用性检测
- 可用模型列表获取
- 额度状态检测（若厂商可返回）
- 统一错误原因与重试建议

## Getting Started

在 `web/` 目录运行：

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## Golden Path Commands

```bash
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run check
```

说明：

- `check` 会串行执行 `format:check + lint + typecheck + build`。
- 当前 `test` 为占位脚本，后续接入自动化测试后替换。

## API

`POST /api/check`

请求体：

```json
{
  "provider": "auto | openai | anthropic | openrouter",
  "api_key": "sk-...",
  "strict_mode": false,
  "target_model": "gpt-5.3-codex"
}
```

说明：

- `strict_mode=false`：返回平台目录模型（不等于权限白名单）。
- `strict_mode=true`：仅验证 `target_model` 是否可被当前 Key 实际调用。

响应核心字段：

- `availability`
- `models`
- `quota_status`
- `errors`
- `health_score`
- `next_actions`

## Deploy on Vercel

1. 将 `web/` 作为 Vercel Project Root
2. 连接仓库并部署
3. 将域名 `check.athinker.net` 绑定到该项目

参考：[Next.js Deployment](https://nextjs.org/docs/app/building-your-application/deploying)

## Git Workflow (Default)

- 默认分支：`main`
- 开发分支：`codex/<topic>` 或 `feat/<topic>`
- 提交风格：Conventional Commits（如 `feat: ...`、`fix: ...`、`chore: ...`）
- 合并策略：建议 PR + Squash Merge
