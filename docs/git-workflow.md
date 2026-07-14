# Git workflow

最後更新：2026-07-14

## Branch roles

| Branch | 用途 | 寫入方式 |
|---|---|---|
| `main` | 可發布、可部署 production 的穩定版本 | 只接受 PR；禁止直接 commit/push |
| `phase1` | Phase 1 平台骨架整合分支 | Phase 1 任務 commit 或 task branch PR |
| `dev` | Phase 1 後的日常整合分支 | 功能與修正 PR |
| `codex/p1-<id>-<slug>` | 需要獨立 review 的單一垂直任務 | 完成後合併至 `phase1` |

目前所有 Phase 1 工作以 `phase1` 為 target。不得在 `main` 開始或完成開發工作。

## Required flow

1. 開始前確認 `git branch --show-current` 不是 `main`。
2. 更新任務狀態與 `docs/worklog.md`。
3. 在 `phase1` 或 task branch 建立小型、可驗收 commit。
4. 執行任務規定的 lint、typecheck、tests、build 與 infrastructure checks。
5. Phase 1 完成後，以 PR 將 `phase1` 合併至 `main`；禁止使用直接 push。

## Local enforcement

Repository 提供 `.githooks/pre-push`。執行下列命令啟用：

```bash
git config core.hooksPath .githooks
```

hook 會拒絕任何更新遠端 `refs/heads/main` 的 push。這是本機護欄，不取代 GitHub branch protection。

## Required GitHub protection for `main`

Repository 管理員應在 GitHub Settings → Branches 或 Rulesets 為 `main` 設定：

- Require a pull request before merging.
- Require conversation resolution before merging.
- Require status checks；CI 建立後加入 lint、typecheck、tests、build、Terraform validate。
- Block force pushes and branch deletion.
- Include administrators／Do not allow bypassing；若帳號與方案支援。
- Require linear history。

若是單人維護，可先不要求另一位 reviewer，但仍必須透過 PR，讓 diff、checks 與交接紀錄存在。

## Emergency changes

production 緊急修正仍由 `codex/hotfix-<slug>` 或 `hotfix/<slug>` 建立 PR。不得以緊急為由直接推送 `main`；若 GitHub 管理員臨時 bypass，必須在 `docs/worklog.md` 記錄原因、commit、批准者與事後修復。
