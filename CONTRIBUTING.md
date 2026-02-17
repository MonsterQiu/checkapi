# Contributing

## Development Flow

1. 同步主分支：

```bash
git fetch origin
git switch main
git pull --ff-only origin main
```

2. 新建功能分支：

```bash
git switch -c codex/<topic>
```

3. 开发并本地检查：

```bash
npm run check
```

4. 提交代码（Conventional Commits）：

```bash
git add -A
git commit -m "feat: <summary>"
```

5. 推送并创建 PR（推荐 squash merge）：

```bash
git push -u origin HEAD
```

## Commit Message Convention

- `feat`: 新功能
- `fix`: 缺陷修复
- `refactor`: 重构（不改行为）
- `chore`: 构建/脚手架/依赖等杂项
- `docs`: 文档变更
- `test`: 测试相关

## Safety Rules

- 不要在未确认情况下执行破坏性命令。
- 对已共享的提交优先使用 `git revert`，避免强推历史。
- 遇到冲突时先跑 `git status`，修复后再继续流程。
