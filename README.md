# claude-supervisor-pane

A small plugin ("mod") for Claude Code's terminal UI that opens a side pane listing subagent runs, and optionally chosen shell commands, with their state and elapsed time.

日本語の説明は [README.ja.md](README.ja.md) にあります。

## When to use

- When Claude runs several subagents (reviewers, verifiers, explorers) and the one-line status in the transcript is not enough to see who is running, who finished, and who failed.
- When a pipeline step is a shell command you want to watch in the same list (for example `deploy.sh` or a review script): add its name to the `commands` setting.
- When you want this without spending tokens: the pane is drawn by the mod, and the model never sees it.

Not for you if you run Claude non-interactively (`claude -p`), or on a narrow terminal: when there is no room for a side pane, nothing opens, and `/supervisor` reports that instead.

## What it looks like

A pane titled **Supervisors** opens beside the conversation when the first matching call starts. Each row is one call:

```
… code-reviewer 12s
✓ test-runner 41s
✗ deploy.sh 3s
done 2 / 3
```

`…` is running, `✓` finished, `✗` failed. `/supervisor` opens or closes the pane.

## Requirements

- Built on Claude Code's plugin hooks ("mods") API, which is in early access and may change between versions.
- Developed and tested with Claude Code 2.1.295 on macOS.
- Windows is untested.

## Install

From the marketplace in this repository:

```
claude plugin marketplace add i-noma-ru/claude-supervisor-pane
claude plugin install supervisor-pane@claude-supervisor-pane
```

Or for one session only, from a clone:

```
claude --plugin-dir /path/to/claude-supervisor-pane
```

## Configuration

All settings have defaults, so the mod works without configuration. Change them with `/plugin configure supervisor-pane@claude-supervisor-pane` or in `/config`.

| Setting | Default | Meaning |
| --- | --- | --- |
| `agents` | empty | `subagent_type` values to list. Empty lists every subagent. |
| `commands` | empty | Substrings of Bash commands to list as rows. Empty lists no shell commands. |
| `max_rows` | 30 | Oldest finished rows are dropped beyond this count. |

## How it works

- On each `Agent` tool call whose `subagent_type` matches (or on every one when `agents` is empty), a row starts. A subagent launched in the background returns before it finishes, so the mod keeps the row running and checks the engine's agent list every 5 seconds to mark it finished or failed.
- On each `Bash` tool call whose command contains one of `commands`, a row starts and finishes with the call. A non-zero exit or an error result marks it failed.
- Rows live in the session state and survive a reload of the mod. The 5-second timer does not: after a hot reload, background rows are settled again only when a new session starts.

## What the plugin reads

The `subagent_type` and result status of `Agent` calls, the command text of `Bash` calls, and the engine's list of agents. It reads no files and sends nothing anywhere.

## Tests

```
claude plugin validate .
claude plugin test .
```

## Notes

- Written with AI assistance (Claude Code).
- Companion mods by the same author: [claude-decision-tracker](https://github.com/i-noma-ru/claude-decision-tracker), [claude-confirm-gate](https://github.com/i-noma-ru/claude-confirm-gate). Each is independent.

## License

MIT. See [LICENSE](LICENSE).
