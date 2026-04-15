# pi-notify OMP Wrapper

這個 repo 不是 `pi-notify` 的原始上游，而是給 Oh My Pi / OMP 使用的包裝層。

原始上游專案：`ferologics/pi-notify`
- GitHub: https://github.com/ferologics/pi-notify

本 repo 的目的只有兩件事：
- 保留上游 `pi-notify` 的通知邏輯
- 在 OMP 上加一層薄包裝，讓通知只發生在主代理（有 UI 的互動執行），不要讓 subagents 也跳通知

## Repo 結構

- `index.ts`
  - OMP wrapper 入口
  - 載入 vendored upstream extension
  - 用 `ctx.hasUI` 過濾非互動 / 無 UI 的 subagent 執行
  - 額外把 `ask` 等待也視為需要通知的時點
- `index.test.ts`
  - 驗證主代理 / subagent 通知行為
  - 驗證 `agent_end` 與 `tool_execution_start(toolName === "ask")`
- `upstream-pi-notify/`
  - vendored 上游原始碼副本
  - 來源是 `ferologics/pi-notify`
  - 這個目錄會由 workflow 自動同步，不手動維護
- `.github/workflows/sync-upstream-pr.yml`
  - 每日同步上游並建立 / 更新 sync PR
- `.github/workflows/omp-review-sync-pr.yml`
  - 用 OMP 自動 review sync PR
- `.github/workflows/auto-merge-sync-pr.yml`
  - 在 review 通過後自動合併 sync PR

## 這個 wrapper 做了什麼

### 1. 只通知主代理，不通知 subagents

上游 `pi-notify` 本身不知道 OMP 的主代理 / subagent UI 邊界。

本 wrapper 的做法是攔截上游註冊的 `agent_end` handler，外層加上：
- `if (!ctx.hasUI) return;`

在 OMP 裡，這個條件等同於：
- 主代理（interactive / 有 UI）可以通知
- subagent（`hasUI: false`）不通知

### 2. 在 `ask` 等待時也通知

除了完成一輪 agent 執行時通知之外，wrapper 也會在：
- `tool_execution_start`
- 且 `toolName === "ask"`

時重用上游通知 handler。

因此使用者在 OMP 等待輸入時，也會收到和上游一致的 `Ready for input` 通知。

## 與原始上游的關係

這點要特別講清楚：

- 原始功能來源是 `ferologics/pi-notify`
- 本 repo 不是上游 fork 後直接改核心邏輯持續手修
- 本 repo 採用「vendored upstream + 外層 wrapper」模式

也就是：
- `upstream-pi-notify/` 盡量保持接近上游
- OMP 專屬行為只放在 repo 根的 `index.ts`
- 上游更新時，不需要重新手 patch 一堆檔案
- 同步與相容性檢查交由 GitHub Actions 自動處理

## 自動同步 / review / merge 流程

這個 repo 的自動化流程是三段式。

### 1. Sync upstream

Workflow: `Sync upstream pi-notify`

檔案：
- `.github/workflows/sync-upstream-pr.yml`

行為：
- 每日排程執行，也可手動 `workflow_dispatch`
- clone 上游 `ferologics/pi-notify`
- 用 `rsync` 同步到 `upstream-pi-notify/`
- 若沒有變更：no-op 結束
- 若有變更：
  - 執行 `bun test index.test.ts`
  - push 到固定分支 `sync/upstream-pi-notify`
  - 建立或更新 `sync/upstream-pi-notify -> main` 的 PR

### 2. OMP review sync PR

Workflow: `OMP review sync PR`

檔案：
- `.github/workflows/omp-review-sync-pr.yml`

行為：
- 只處理固定 sync PR：
  - head: `sync/upstream-pi-notify`
  - base: `main`
- 在 GitHub runner 上：
  - 下載 OMP release binary
  - 下載相對應的 `pi_natives` Linux x64 release assets
  - 建立暫時 `models.yml`
  - 以唯讀工具集執行 OMP
- OMP 會收到一份明確的 review prompt，要求輸出：
  - `VERDICT: PASS|BLOCKED`
  - `SUMMARY: ...`
  - blocking reasons
- 成果會被寫回 PR comment，帶固定 marker：
  - `<!-- omp-sync-pr-review -->`
  - `<!-- reviewed-head-sha: ... -->`
  - `<!-- verdict: PASS|BLOCKED -->`

### 3. Auto merge sync PR

Workflow: `Auto merge sync PR`

檔案：
- `.github/workflows/auto-merge-sync-pr.yml`

行為：
- 監聽 `OMP review sync PR` 成功完成
- 重新抓當前 PR head SHA
- 只接受 `github-actions[bot]` 發出的 marker comment
- 驗證：
  - comment 裡的 `reviewed-head-sha` 必須等於目前 PR head SHA
  - verdict 必須是 `PASS`
- 條件成立才執行：
  - `gh pr merge --merge --match-head-commit ...`

這個 gate 的目的，是避免：
- review 是針對舊 head 做的
- 或 comment 來源不可信
- 卻錯把新內容放進 `main`

## OMP review 真的有執行嗎？

有，而且已經做過真實 GitHub Actions 驗證。

已驗證的成功 run 包含：
- probe PR 合併鏈：
  - sync `24445690410`
  - review `24445704034`
  - auto-merge `24445738870`
- revert PR 合併鏈：
  - sync `24445827965`
  - review `24445840499`
  - auto-merge `24445876195`

review workflow 的成功 log 已證明它不是只在 shell 裡假裝 review，而是真的：
- 建立 `omp-review-prompt.md`
- 寫暫時 `models.yml`
- 執行：
  - `"${omp_bin}" -p @"${prompt_file}" --model "ci-review/${OMP_MODEL_ID}" ...`
- 之後再把 OMP 的輸出解析成 `VERDICT`，寫回 PR comment

## 必要 GitHub Secrets

這三個 secrets 要先存在，OMP review 才能跑：

- `OMP_BASE_URL`
  - OpenAI-compatible API base URL
- `OMP_API_KEY`
  - API key
- `OMP_MODEL_ID`
  - 要用來做 review 的模型 id

目前 workflow 內 provider transport 固定為：
- `openai-completions`

## 本地開發

### 跑測試

```bash
bun test index.test.ts
```

### 主要驗證內容

測試目前覆蓋：
- interactive `agent_end` 會通知
- interactive `ask` 等待會通知
- non-interactive / subagent `ask` 不通知
- non-interactive / subagent `agent_end` 不通知

## 維護原則

這個 repo 的設計原則是：
- 上游邏輯盡量維持在 `upstream-pi-notify/`
- OMP 相容層只放在 wrapper 檔案
- 不直接把 OMP 專屬改動散佈到 vendored upstream 內部
- 所有 upstream 同步都先走 PR，再由 OMP review，最後才自動 merge

這樣做的好處是：
- 上游更新容易追
- wrapper 責任邊界清楚
- 未來若要重新比對上游變更，不需要先拆一堆歷史 patch

## 目前保留的長期分支

- `main`
- `sync/upstream-pi-notify`

其中 `sync/upstream-pi-notify` 是自動同步流程會重複使用的固定分支，不是一次性測試分支。