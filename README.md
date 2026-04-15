# pi-notify OMP Wrapper

This repository is not the upstream `pi-notify` project itself. It is an Oh My Pi / OMP-specific wrapper around that upstream project.

Upstream project: `ferologics/pi-notify`
- GitHub: https://github.com/ferologics/pi-notify

This repository has only two purposes:
- preserve the upstream `pi-notify` notification logic
- add a thin OMP wrapper so notifications are emitted only for the main agent (interactive runs with UI), not for subagents

## Install

### Local development

```bash
omp plugin link C:/Users/Anton/.omp/agent/extensions/pi-notify-main-only
```

If OMP is already running, restart it after linking or updating the extension.

### Marketplace install

Add the GitHub repo as a marketplace:

```bash
omp plugin marketplace add anton1615/pi-notify-omp-wrapper
```

Install the plugin from that marketplace:

```bash
omp plugin install pi-notify-omp-wrapper@pi-notify-omp-wrapper
```


## Repository layout

This repository is intentionally both the plugin repo root and the marketplace repo root.

- `index.ts`
  - entry point for the OMP wrapper
  - loads the vendored upstream extension
  - filters out non-interactive / no-UI subagent executions via `ctx.hasUI`
  - also treats `ask` waits as notification points
- `index.test.ts`
  - verifies main-agent vs subagent notification behavior
  - verifies `agent_end` and `tool_execution_start(toolName === "ask")`
- `upstream-pi-notify/`
  - vendored copy of the upstream source
  - sourced from `ferologics/pi-notify`
  - synchronized automatically by workflow rather than maintained manually
- `package.json`
  - OMP plugin manifest for the repo root
- `.claude-plugin/marketplace.json`
  - marketplace catalog that exposes this repo root as `pi-notify-omp-wrapper`
- `.github/workflows/sync-upstream-pr.yml`
  - syncs upstream daily and opens / updates the sync PR
- `.github/workflows/omp-review-sync-pr.yml`
  - uses OMP to review the sync PR automatically
- `.github/workflows/auto-merge-sync-pr.yml`
  - merges the sync PR automatically after review passes

## What this wrapper does

### 1. Notify only the main agent, not subagents

Upstream `pi-notify` does not know about OMP's UI boundary between the main agent and subagents.

This wrapper intercepts the upstream-registered `agent_end` handler and adds an outer guard:
- `if (!ctx.hasUI) return;`

Within OMP, that condition means:
- the main agent (interactive / has UI) may notify
- subagents (`hasUI: false`) do not notify

### 2. Notify when waiting on `ask`

In addition to notifying when an agent turn finishes, the wrapper also reuses the upstream notification handler when:
- `tool_execution_start`
- and `toolName === "ask"`

As a result, when OMP is waiting for user input, the user receives the same `Ready for input` notification style as upstream.

## Relationship to the original upstream

This point should be explicit:

- the original functionality comes from `ferologics/pi-notify`
- this repository is not an upstream fork with long-term manual edits to core logic
- this repository uses a "vendored upstream + outer wrapper" model

In practice, that means:
- `upstream-pi-notify/` stays as close to upstream as possible
- OMP-specific behavior lives only in the root `index.ts`
- upstream updates do not require reapplying a large manual patch set
- synchronization and compatibility checks are handled by GitHub Actions

## Automatic sync / review / merge flow

This repository's automation is a three-stage pipeline.

### 1. Sync upstream

Workflow: `Sync upstream pi-notify`

File:
- `.github/workflows/sync-upstream-pr.yml`

Behavior:
- runs on a daily schedule and can also be triggered manually via `workflow_dispatch`
- clones upstream `ferologics/pi-notify`
- syncs into `upstream-pi-notify/` with `rsync`
- if there are no changes, exits as a no-op
- if there are changes:
  - runs `bun test index.test.ts`
  - pushes to the fixed branch `sync/upstream-pi-notify`
  - creates or updates the PR from `sync/upstream-pi-notify` to `main`

### 2. OMP review sync PR

Workflow: `OMP review sync PR`

File:
- `.github/workflows/omp-review-sync-pr.yml`

Behavior:
- handles only the fixed sync PR:
  - head: `sync/upstream-pi-notify`
  - base: `main`
- on the GitHub runner it:
  - downloads the OMP release binary
  - downloads the corresponding `pi_natives` Linux x64 release assets
  - creates a temporary `models.yml`
  - runs OMP with a read-only toolset
- OMP receives an explicit review prompt and must output:
  - `VERDICT: PASS|BLOCKED`
  - `SUMMARY: ...`
  - blocking reasons
- the result is written back as a PR comment with fixed markers:
  - `<!-- omp-sync-pr-review -->`
  - `<!-- reviewed-head-sha: ... -->`
  - `<!-- verdict: PASS|BLOCKED -->`

### 3. Auto merge sync PR

Workflow: `Auto merge sync PR`

File:
- `.github/workflows/auto-merge-sync-pr.yml`

Behavior:
- listens for successful completion of `OMP review sync PR`
- fetches the current PR head SHA again
- accepts marker comments only from `github-actions[bot]`
- verifies:
  - the `reviewed-head-sha` in the comment must equal the current PR head SHA
  - the verdict must be `PASS`
- merges only if those conditions are satisfied:
  - `gh pr merge --merge --match-head-commit ...`

The purpose of this gate is to prevent cases where:
- the review was performed against an old head
- or the comment source is not trusted
- but new content would otherwise be merged into `main` by mistake

## Has the OMP review actually run?

Yes. It has already been validated in real GitHub Actions runs.

Verified successful runs include:
- probe PR merge chain:
  - sync `24445690410`
  - review `24445704034`
  - auto-merge `24445738870`
- revert PR merge chain:
  - sync `24445827965`
  - review `24445840499`
  - auto-merge `24445876195`

The successful review workflow logs prove that this is not a shell script pretending to review. It actually:
- creates `omp-review-prompt.md`
- writes a temporary `models.yml`
- executes:
  - `"${omp_bin}" -p @"${prompt_file}" --model "ci-review/${OMP_MODEL_ID}" ...`
- then parses OMP output into `VERDICT` and writes it back as a PR comment

## Required GitHub secrets

These three secrets must exist before OMP review can run:

- `OMP_BASE_URL`
  - OpenAI-compatible API base URL
- `OMP_API_KEY`
  - API key
- `OMP_MODEL_ID`
  - model id used for review

The provider transport is currently fixed in the workflow as:
- `openai-completions`

## Local development

### Run tests

```bash
bun test index.test.ts
```

### What the tests cover

The current tests cover:
- interactive `agent_end` sends a notification
- interactive `ask` waits send a notification
- non-interactive / subagent `ask` does not send a notification
- non-interactive / subagent `agent_end` does not send a notification

## Maintenance principles

This repository is designed around the following principles:
- keep upstream logic inside `upstream-pi-notify/` whenever possible
- keep the OMP compatibility layer only in the wrapper file
- do not spread OMP-specific changes throughout the vendored upstream internals
- every upstream sync goes through a PR, then OMP review, and only then auto-merge

Benefits of this approach:
- upstream changes are easier to track
- wrapper responsibilities stay clear
- future upstream comparisons do not require first untangling a stack of historical patches

## Long-lived branches currently kept

- `main`
- `sync/upstream-pi-notify`

`sync/upstream-pi-notify` is a fixed branch reused by the automatic sync workflow, not a one-off test branch.