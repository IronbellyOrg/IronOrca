# Orca sessions idle or asleep: remediation spec

Issue: IronbellyOrg/IronOrca#10. Branch: `ironbelly/orca-idle-sleep` (from origin/main `e0f32dcac1`, 2026-10-28 02:40 UTC).
Status: loose spec for owner review. Read-only investigation; no Orca settings, sessions, terminals or source code were changed.
Investigated: 2026-11-02, 23:10 to 23:30 UTC.

## 0. Summary and owner decisions

| # | Question | Answer | Confidence |
|---|---|---|---|
| 1 | Can a parent report done while hidden sub-agents work, so hibernation sleeps it? | No for Claude's own sub-agents and background tasks: they keep the pane `working` (live data agrees). Yes in principle for a coordinator whose workers run in other terminals, if it ends its turn without a blocking wait. `subagentObservation` is irrelevant to hibernation. | Code and live data VERIFIED; coordinator case VERIFIED in code only |
| 2 | Should hibernation be on? | Recommend off for now: not the cause of the symptom, host has memory headroom, coordinator gap open. | Recommendation |
| 3 | How to get 60 minutes? | This host: Settings > Experimental > Agent sleep on, Sleep after = 60. Fork default: `agent-hibernation-planner.ts:14` and `default-global-settings.ts:260`. No test edits needed. The fork default does not change this host. | VERIFIED |
| 4 | Who kills and relaunches OrcaCLICommandRefactor-Specs? | Its own orchestration coordinator (Run `run_8c464f208721`), releasing each finished worker and starting the next. 17 of 18 kills match a worker release to the second; the other was a user closing a tab on the phone. Expected; no fix. | VERIFIED |
| 5 | Does the `unclean_host_death` pause explain "asleep until clicked"? | Yes, for panes after a restart. The pause has been active since 2026-10-31 12:24:43 UTC and is still active. Clear it with `orca serve restore resume`. It will likely return after the next workspace restart unless Orca is stopped cleanly first. | Pause VERIFIED active; recurrence cause inferred |

Owner decisions, one at a time, in this order:

1. **Clear the restore pause now?** Run `orca serve restore resume` on this host (or click "Resume automatic restores" on a sleeping pane). Recommended: yes. Effect: after the next restart, up to 8 agents restore by themselves instead of waiting for a click.
2. **Make workspace stops clean?** Add a step that sends SIGTERM to Orca's terminal daemon before the Coder workspace stops. Recommended: yes, otherwise decision 1 has to be repeated after each restart. Implementation is outside this repo (Coder template or shutdown script) and UNVERIFIED.
3. **Turn agent hibernation on?** Recommended: no, for now.
4. **Only if 3 is yes:** set 60 minutes on this host (section 3a), and decide whether the fork default should also become 60 minutes (section 3b).
5. **Only if 3 is yes:** fund hardening H1 (protect coordinators with live workers) first.

## 1. Can a parent agent report done while hidden sub-agents still work?

**Answer: refuted for Claude's own sub-agents and background tasks (VERIFIED in code and live data). Confirmed from code, but not seen live, for work the parent hands to other Orca terminals. Unknown for detached processes.**

### The premise needs correcting

`subagentObservation` is not what decides sleep. It is a display label that says whether a row's child list is backed by current evidence. It is set in two places, and only on rows that carry a `subagents` or `children` field (even an empty one):

- the host's agent listing for `orca worktree ps` and the sidebar, where `unverifiable` means the row is not fresh: its evidence is older than 30 minutes, or it was restored from disk and not yet confirmed (`src/main/runtime/runtime-worktree-agent-rows.ts:62-64`, `src/shared/agent-status-freshness.ts:4,62-79`);
- the renderer's projection of native-chat (structured) sessions, from the session feed's confirmation (`src/renderer/src/components/native-chat/structured-agent-session-status-projection.ts:139-141`), copied onto live entries by `agent-status-live-entry-builder.ts:253`.

The hibernation planner and eligibility files never read it. Eligibility refuses any pane whose `subagents` list is non-empty, fresh or stale (`src/renderer/src/lib/agent-hibernation-pane-eligibility.ts:92`); it does not look at `children`. So an `unverifiable` label cannot open a gap, and "no `subagents` list" is only a gap if nothing else keeps the pane's combined state at `working`.

### What keeps a Claude parent "working" after its own turn ends

Hibernation needs the pane's combined `state` to be `done` (`agent-hibernation-pane-eligibility.ts:90`). For Claude, the combined state stays `working` while any of these exist (`src/shared/agent-hook-listener/providers/claude-pane-hold-evidence.ts:20-82`):

1. a sub-agent in Orca's roster that is still working (Task tool agents and teammates, fed by Claude hooks);
2. a running background shell or an active session cron, from the inventory Claude sends in its hook payloads (`claude-events.ts:144-156`);
3. a finished sub-agent or shell whose result Claude has not yet been told about (the "owed notification").

The main agent's own state is published separately as `mainAgent`; readers fall back to `state` when it is missing (`src/shared/agent-status-types.ts:138-140`).

### Live data (`orca worktree ps --json`, 2026-11-02 23:13 UTC)

| Worktree | Combined state | Main agent | Sub-agents listed | Why it is held |
|---|---|---|---|---|
| post-release-v5.0.0 | working | done | 6, all working, observation `live` | rule 1 |
| codegraph-handoff (pane A) | working | done | 1 working, `live` | rule 1 |
| codegraph-handoff (pane B) | working, mode `monitoring` | done | none | rule 2 (Bash `sleep 20; ...` in background) |
| feat-codememory-codegraph-init | working, mode `monitoring` | done | none | rule 2 |
| IB-CPlus-01 | working, mode `monitoring` | done | none | rule 2 |
| OrcaCLICommandRefactor-Specs (coordinator) | done | done | 7 idle teammates | not held, but still ineligible because sub-agents are listed |

Every parent whose main agent was done while children ran showed combined `working`, so hibernation would skip it. The installed build has the same guard (`t.state!==\`done\`||Go(t)||t.subagents?.length||...` in `/opt/Orca/resources/app.asar.unpacked/out/renderer/assets/App-DlxHLhEz.js`) and the same hold logic (`claudeTaskWakeupPending` present in 7 installed files).

### Where a real gap remains

- **G1, coordinators (VERIFIED from code, not observed live).** A coordinator's workers run in other terminals. The coordinator's own row lists no sub-agents, and the dispatch check in the planner covers only the pane's own dispatch, that is, it protects a worker, not its coordinator (`agent-hibernation-pane-eligibility.ts:50-54`; context type at `agent-status-types.ts:58-71`). If a coordinator ends its turn without a blocking wait, hibernation can stop it once the idle window passes. A search of `src/main/runtime/orchestration` and `src/main/runtime/rpc/methods/orchestration` found no reference to sleeping or hibernated sessions, so a worker's `worker_done` message would not wake it (runtime behaviour UNVERIFIED). Today's coordinators avoid this by blocking on `orca orchestration check ... --wait` (seen in `ps`: pids 426454 and 578081), which keeps them `working`. This is a pattern risk, not something that happened.
- **G2, detached work (UNVERIFIED).** Processes started with `nohup`, `setsid` or a disowned `&`, and remote jobs (CI runs, other hosts), are invisible to both Claude's inventory and Orca.
- **G3, timed wake-ups (UNVERIFIED).** Session crons are tracked (rule 2). Other ways a Claude session schedules its own later wake-up were not checked.
- **G4, older Claude builds (low risk now).** Rule 2 depends on Claude including the inventory fields; if they are absent Orca keeps the previous value (`claude-events.ts:144-156`). The live `monitoring` rows show the installed Claude sends them.

Extra protection already in place: a candidate must match on two consecutive 60-second ticks, the second including output silence (`agent-hibernation-coordinator.ts:226-227`), and ticks run only while an Orca window is visible (`agent-hibernation-coordinator.ts:295-301`).

### Hardening, for the owner to choose later (not part of this issue)

- **H1 (do this before turning hibernation on, if coordinators matter):** treat a pane as busy while it is the coordinator of a Run that has any unsettled worker dispatch, and wake a hibernated coordinator when a message arrives for it. Feasibility of getting that fact to the renderer is UNVERIFIED.
- **Drop** the two ideas in FINDINGS section 6.4: "block when `subagentObservation` is `unverifiable`" adds nothing (the label only appears on rows that carry a child list, and a non-empty `subagents` list already blocks; a native-chat row with only `children` is not a terminal pane hibernation acts on, because the planner walks terminal tabs only and eligibility needs a live PTY in the pane layout, `agent-hibernation-planner.ts:113-142`, `agent-hibernation-pane-eligibility.ts:132-140`), and "block when the main agent has background work pending" is already covered by rules 2 and 3.

## 2. Should agent hibernation be on?

**Current state (VERIFIED):** off. A private copy of `~/.config/orca/profiles/local-default/profile-state.db` (table `profile_state_documents`, domain `settings`, revision 3) holds `experimentalAgentHibernation=false` and `agentHibernationIdleMs=1800000`.

**Recommendation: keep it off for now.** Owner decides.

What it does: once a finished background agent has been idle for the set time, Orca stops its terminal process and keeps a record so the conversation resumes (`claude --resume`) when the pane is opened again. It only acts on resumable agents with a known provider session (`agent-hibernation-pane-eligibility.ts:104-109`), never on the foreground tab, a floating terminal, or a pane with recent typed input (`agent-hibernation-planner.ts:118-131`, `agent-hibernation-pane-eligibility.ts:123-131`).

| Pros | Cons |
|---|---|
| Frees memory from finished agents. Measured 23:20 UTC: 18 `claude` processes using 7,387 MB resident in total. | It did not cause the reported symptom; the restore pause did (section 5). Turning it on adds a second way for panes to be asleep. |
| Fewer live processes on a shared host whose swap is 100% used by other tenants. | The coordinator gap G1 (section 1) is real in code. |
| Conversation is kept: resume uses the provider session id. | Marked experimental in the UI: "Experimental while we tune the safety model" (`ExperimentalPane.tsx:176`). |
| Idle window is adjustable from 1 to 1,440 minutes. | Manually started agents "may resume with your current Orca defaults" rather than their original launch options (same text). |
| | Waking costs a Claude restart and transcript reload each time a pane is opened (cost not measured, UNVERIFIED). |
| | The host is not short of memory: 21,194 MB available, no cgroup memory limit (`memory.max` = `max`), memory pressure 0.00. |

When to revisit: if available memory falls below a few GB or memory pressure appears, turn it on with a 60-minute window (section 3), ideally after hardening H1.

## 3. How to set a 60-minute idle time

Two separate things, and they do not substitute for each other on this host.

### 3a. This host (takes effect immediately, no code change)

In Orca: Settings > Experimental > **Agent sleep**. Turn the toggle on, then set **Sleep after** to `60` minutes. The minutes field only appears once the toggle is on (`src/renderer/src/components/settings/ExperimentalPane.tsx:180-218`, field shown at line 193). This writes `experimentalAgentHibernation: true` and `agentHibernationIdleMs: 3600000` to the host's settings.

- Both values are needed. With the toggle off the planner returns no candidates whatever the minutes are (`src/renderer/src/lib/agent-hibernation-planner.ts:102-104`).
- Allowed range is 60,000 to 86,400,000 ms (1 to 1,440 minutes); anything outside silently falls back to the default (`agent-hibernation-planner.ts:15-16,30-37`). 3,600,000 is inside the range.
- Do not edit `profile-state.db` by hand: the settings row carries a revision and a content hash. Use the UI.
- Only do this if the owner decides to turn hibernation on (section 2). Setting 60 minutes while the toggle stays off has no effect.

### 3b. Fork default (code change, affects new profiles only)

| File (this branch) | Line | Change |
|---|---|---|
| `src/renderer/src/lib/agent-hibernation-planner.ts` | 14 | `DEFAULT_AGENT_HIBERNATION_IDLE_MS = 30 * 60 * 1000` to `60 * 60 * 1000` |
| `src/shared/default-global-settings.ts` | **260** | `agentHibernationIdleMs: 30 * 60 * 1000` to `60 * 60 * 1000` |

Line note: on this branch line 259 is `experimentalAgentHibernation: false` and the idle value is on line 260. The "259" in the issue matches the installed build's `out/shared/default-global-settings.js`, which is one line shorter.

Leave `experimentalAgentHibernation: false` (line 259) alone unless the owner also wants hibernation on by default.

What the fork default does **not** do: change this host. Stored settings are spread over the defaults, so a stored value wins (`src/main/persistence/loading-store/normalize-loaded-global-settings.ts:64-67`), and this host's stored settings already contain `agentHibernationIdleMs=1800000`. This host still needs 3a. The constant also becomes the fallback for out-of-range stored values.

### Tests

- **No test file needs editing.** Every hibernation test that depends on the default imports the constant rather than a literal: `agent-hibernation-planner.test.ts`, `agent-hibernation-coordinator.test.ts`, `agent-hibernation-coordinator-test-fixture.ts` (all in `src/renderer/src/lib/`) and `src/renderer/src/store/slices/agent-hibernation-live-anchor-e2e.test.ts`. They move to 60 minutes automatically.
- `src/renderer/src/lib/agent-hibernation-pane-age.test.ts:13` has its own `IDLE_MS = 30 * 60 * 1000`, which it passes in as a parameter. It does not test the default and stays as is.
- No test asserts the literal default value. Adding one would be a low-value test under `docs/agents-md-refs/test-antipatterns.md`; not recommended.
- Verification for the implementer: `ORCA_BACKGROUND_LAUNCH=1 pnpm test src/renderer/src/lib/agent-hibernation-planner.test.ts src/renderer/src/lib/agent-hibernation-coordinator.test.ts src/renderer/src/store/slices/agent-hibernation-live-anchor-e2e.test.ts`, then `pnpm check:changed --maxWorkers=2`. Not run in this investigation (read-only).
- Process: two source files, so under the owner's rules this goes through a written plan (`/sc:workflow`, level 3), not a direct edit.

## 4. Who kills and relaunches OrcaCLICommandRefactor-Specs

**Answer (VERIFIED): an orchestration coordinator running inside that same worktree.** It works through a task list one task at a time. For each task it starts a fresh Claude worker terminal, waits for the worker to finish, then calls `orca orchestration worker-release`, which archives the worker's transcript and closes its terminal. The "relaunch" a fraction of a second later is the coordinator starting the next task's worker. This is expected behaviour and nothing is lost: every released worker finished with `workerState=succeeded` and its transcript was captured (`archive.status=captured`).

- Coordinator: Run `run_8c464f208721`, objective "Round 4: apply owner-approved decisions to the Orca worker-contract spec and review only the changes (.dev/orca-command-refactor/)", created 2026-11-02 21:40:23 UTC. Its coordinator terminal `term_cddf23a9-82f5-45ee-a9b8-1fdd61d80197` is the Claude Code tab titled "CommandsWorkflowCompare · Claude Code" in `/home/coder/workspaces/worktrees/IronClaude/OrcaCLICommandRefactor-Specs` (PTY `...@@9943ddb7`, from `orca terminal show`).
- Client `c67342c2-e23a-4f58-abc8-1ffa17ec043c` is not a separate actor. It connected to the terminal daemon at 17:11:17 UTC, the moment the daemon started under the Orca server process (`orca-ide --serve`, pid 451). It carries every terminal kill the server makes, whoever asked: for example the web UI tab closes at 17:37:16 and 17:42:26 (`runtime.session-tabs.close`, origin `runtime`, in `main.trace.ndjson`) also appear as `session-killed` from `c67342c2`. The client id is a random id per daemon connection (`src/main/daemon/client.ts:43`).
- `immediate=true` is what Orca's PTY stop path always sends (`src/main/ipc/pty/runtime/kill.ts:270-274`); the daemon logs it in `src/main/daemon/daemon-terminal-kill.ts:20,33`. It does not indicate a forced or abnormal kill.
- Release closes the terminal by design: for a terminal worker, `completeWorkerTerminalRelease` captures the archive, then calls `runtime.closeTerminal` (`src/main/runtime/rpc/methods/orchestration/worker/worker-release-completion.ts:184-250`; native-chat workers stop through `stopStructuredWorkerForRelease` at lines 238-249 instead). It is reached from the `orchestration.workerRelease` RPC (`worker-release.ts:18-89`), from release recovery after a restart or reconnect (`src/main/runtime/orchestration/worker-terminal-release-reconciliation.ts:81`), from a retry start that releases the failed attempt it replaces (`src/main/runtime/rpc/methods/orchestration/worker/retried-worker-terminal-release.ts:21-32`, failed dispatches only), and for remote workers from `orchestration.federationRelease` (`src/main/runtime/rpc/methods/orchestration/federation/federation-control.ts:47-59`), which, like remote recovery, goes through `releaseRemoteAttachment` and also closes the terminal (`federated-worker-release-host.ts:212`). None of these fires on idleness. All 17 worker kills below were releases of succeeded workers, so the failed-retry path does not apply (table below), not retries or recovery.
- The coordinator was caught mid-release: its last tool call shown by `orca worktree ps` was `orca-ide orchestration worker-release --dispatch ctx_c23312d...`.

Every `session-killed` for this worktree in `daemon.log` (18 events, 2026-10-31 to 2026-11-02) matched by PTY id:

| daemon.log kill (UTC) | PTY suffix | Matching release | Run | Task |
|---|---|---|---|---|
| 2026-10-31 00:26:00, `immediate=false`, client `a6ad5f08` | 6571ebec | none: a user tab close from the phone app (`runtime.session-tabs.close`, origin `mobile`, closeReason `user`, 00:26:00) | - | - |
| 2026-11-02 03:36:45 to 14:52:12 (11 kills), client `ec6ddbcf` | fff3b3fd ... 23623077 | 11 worker releases, same second each | `run_b8d9b2357993` ("Write a reviewed planning spec: Orca coordinates IronClaude commands as workers") | 11 workers |
| 21:55:51 | 18ee868f | `ctx_e1a39e2b48fd` released 21:55:50 | `run_8c464f208721` | Task 12, combined revision |
| 22:13:57 | 661d3da6 | `ctx_cd9d8ab9b360` released 22:13:57 | same | Task 13, independent review |
| 22:55:31 | 2ab4bb59 | `ctx_860971fd5a73` released 22:55:31 | same | Task 14, fix pass 1 |
| 22:59:39 | a7ba0816 | `ctx_325fac87b297` released 22:59:39 | same | Task 15, recheck |
| 23:01:18 | 4ce8b99c | `ctx_d5b0d2a8b31d` released 23:01:17 | same | Task 16, fix pass 2 |
| 23:03:42 | 2e761629 | `ctx_c23312ddcd81` released 23:03:41 | same | Task 17, final recheck |

So the lead in the request (coordinator plus worker-release) is confirmed for all 17 worker kills; the 18th was a user closing a tab. The four times named in the issue (22:13, 22:55, 22:59, 23:01) are Tasks 13 to 16. The 22:13 kill had no immediate relaunch because Tasks 14 and 15 were not created until 22:52 (the reason for the 38-minute gap is UNVERIFIED).

**Remediation: none needed.** If the owner wants these to be easier to recognise in `daemon.log`, a later change could log the dispatch id or the requesting RPC method on `session-killed` (out of scope here).

## 5. Does the unclean_host_death restore pause explain "asleep until clicked"?

**Answer: yes for the "after a restart, panes sleep until I open them" symptom (VERIFIED that the pause is still active). No for sessions that go quiet while running.**

### The pause is still on right now

- Marker file `~/.config/orca/daemon/daemon-v50.automatic-work-run.json` (read 23:15 UTC) contains `"mode":{"kind":"paused","reason":"unclean_host_death","since":1793449483134}`. `since` is 2026-10-31 12:24:43 UTC.
- `daemon.log` has no `automatic-work-resumed` event, and the marker was last written at 17:11 (daemon start). The resume code rewrites the marker and logs that event (`src/main/daemon/automatic-work-run-marker-store.ts:93-102`), so no resume has happened.
- So restores have been paused continuously since 2026-10-31 12:24:43 UTC. The 2026-11-02 17:11 event says `carriedOver=true`: the 17:11 restart did not cause a new pause, it inherited the old one.

### How the pause behaves

- A pause starts when the daemon starts and finds the previous marker in state `running` from the same boot (`src/shared/automatic-work-run-marker.ts:33-48`). `running` is written only after automatic restores have been admitted (`arm()`, `automatic-work-run-marker-store.ts:83-90`) and is cleared to `clean-exit` on an orderly stop or on SIGTERM/SIGINT to the daemon (`daemon-entry.ts:164-193`).
- Pauses never expire. They survive reboots and are lifted only by an explicit resume (`automatic-work-run-marker.ts:32,41-43`).
- While paused, every restore request that declares its intent and is not a `user-resume` is deferred with reason `paused` (`src/shared/host-spawn-admission.ts:228,239-242`; under critical pressure the reason is `pressure` instead, lines 229-232). Requests from older clients that declare no intent are not deferred by the pause; those carrying an agent-session claim are paced, the rest are admitted (lines 187-193, 219-221). A user-opened pane (`user-resume`) is exempt from the pause: within its per-client allowance it is admitted, or waits briefly if 3 user resumes are already in flight (lines 194-204, 222-227), and past that allowance it is still excluded from the `paused` deferral (line 239). The one case where a user-opened pane can be deferred is critical host pressure past its allowance, with reason `pressure` (lines 229-232); this host showed memory pressure 0.00, so that does not apply here.
- The renderer shows a sleeping overlay for the deferred pane. For reason `paused` there is deliberately no background retry; the pane starts when the user opens it, and the overlay offers "Resume automatic restores" (`src/renderer/src/components/terminal-pane/pty-connection/spawn-deferred-sleep.ts:122-189`).

That is exactly "asleep until I click it in the left pane" after the 17:11 restart. It does not explain a session that was running and went quiet with no restart: the pause only affects restores at startup.

### Why it started (partly VERIFIED, partly inferred)

- No daemon in `daemon.log` has ever logged `shutdown` (searched all 1,038 lines). Every Orca stop on this host so far has been unclean.
- This workspace is a sysbox container (`/.dockerenv` exists; `/proc/uptime` and `/proc/sys` are served by `sysboxfs`). Container uptime starts 2026-11-02 17:11:14, but the kernel booted 2026-10-27 18:48:01 UTC (`btime` in `/proc/stat`). All four v50 daemon starts (10-27 19:06, 10-28 02:41, 10-31 12:24, 11-02 17:11) happened after that single kernel boot.
- Orca identifies a boot by `/proc/sys/kernel/random/boot_id` (`automatic-work-run-marker-store.ts:19-30`). The 10-31 12:24 start was a workspace restart (Run `run_b8e8e4824e11` at 13:26 says "after the Coder instance update and workspace restart"), yet Orca judged it the same boot. **Inference (high confidence, not directly observed):** inside this container `boot_id` does not change when the workspace restarts, so any workspace stop that kills Orca without SIGTERM, after at least one automatic restore, will set a new pause.

### How to clear it

Recommended owner action (not run by this investigation, because it changes host state):

```
orca serve restore resume
```

The installed CLI has this command (`orca serve restore --help` lists `resume`; source `src/cli/handlers/serve-restore.ts:66-70`, RPC `runtime.automaticWork.resume`). Expected output: "Automatic restores resumed. They were paused at 2026-10-31T12:24:43.134Z because the terminal host stopped unexpectedly." Alternative: click "Resume automatic restores" on any sleeping pane overlay.

After resuming, a second limit still applies: at most 8 automatic restores may be live at once (`live_cap`); extra restores sleep but retry in the background (`host-spawn-admission.ts:243-245`, `spawn-deferred-sleep.ts:178-184`).

### How to avoid it coming back

1. Stop Orca cleanly before stopping or restarting the Coder workspace: send SIGTERM to the terminal daemon (today pid 1027, `daemon-entry.js`) or stop the Orca server so the daemon receives SIGTERM. The daemon then writes `clean-exit` (`daemon-entry.ts:164-170,192`). Whether the Coder workspace stop already delivers SIGTERM to the daemon is UNVERIFIED; the absence of any `shutdown` log line suggests it does not.
2. Check after the next workspace restart: `grep automatic-work ~/.config/orca/logs/daemon.log | tail -2`. A new line with `carriedOver=false` means the pause came back and step 1 is needed (for example a Coder shutdown script).
3. Optional fork change for the owner to consider later (not specified here): treat a container restart as a new boot on Linux containers, for example by also comparing container start time. Risk: weakens the crash-loop protection the pause exists for.

## 6. Version gap

- Installed: `1.4.237-aidev02.0e4491a95e92` (`orca --version`). Commit `0e4491a95e92` is not in this branch's object store (`git cat-file` fails). Every file under `/opt/Orca/resources/app.asar.unpacked/out` has mtime 2026-10-26 02:12 UTC; only the directories are dated 2026-11-02 14:03, so the 14:03 event was a re-extraction of the same build, not a new build.
- This branch: `e0f32dcac1`, committed 2026-10-28 02:40 UTC, about two days newer.
- Checked against the installed build: the hibernation guard string, the two defaults (installed `out/shared/default-global-settings.js:258-259`), presence of `claudeTaskWakeupPending` and `subagentObservation`, the `automatic-work-paused` log string, the `orca serve restore resume` command and its RPC `runtime.automaticWork.resume`.
- Everything in sections 4 and 5 and the live table in section 1 comes from the running installed build (logs, `orca` CLI, marker file), so it describes the installed behaviour directly.
- Not compared line by line with the installed build: the Claude hold rules (section 1 rules 1-3), the hibernation tick and visibility rules, and the restore admission thresholds. Their effects were observed live where noted; otherwise they are branch facts.
- The code changes proposed in section 3b target this branch. Line numbers are this branch's.

## 7. Evidence index

Read-only commands and files used (all on 2026-11-02, UTC):

- `~/.config/orca/logs/daemon.log` (1,038 lines): `session-killed`, `client-hello-accepted`, `automatic-work-paused`, `startup` events; no `shutdown` or `automatic-work-resumed` events.
- `~/.config/orca/logs/main.trace.ndjson`: `runtime.session-tabs.close`, `terminal.close`, `persistence.terminal-topology` (`close_tab` then `admit_pane` at each worker release).
- `orca orchestration run-list --json`, `orca orchestration worker-list --run <id> --json` for every Run, `orca orchestration task-list --run run_8c464f208721 --json`, `orca terminal show --terminal term_cddf23a9-... --json`.
- `orca worktree ps --json` at 23:13 UTC.
- `~/.config/orca/daemon/daemon-v50.automatic-work-run.json`, `/proc/sys/kernel/random/boot_id`, `/proc/stat` btime, `/proc/mounts`, `/.dockerenv`.
- `profile-state.db`: read from a private copy in a temporary directory that was then deleted; the live database was not opened.
- `ps`, `free -m`, `/sys/fs/cgroup/memory.max`, `/proc/pressure/memory`.
- Source on this branch as cited inline; installed bundle under `/opt/Orca/resources/app.asar.unpacked/out` as cited in section 6.

Background: `/home/coder/workspaces/Coder/.dev/research/orca-idle-sleep-20261102/FINDINGS.md`. Corrections to it: (a) `subagentObservation` is a display label for child-list evidence and plays no part in hibernation (section 1); (b) the idle default is on line 260 of `default-global-settings.ts` on this branch (section 3b); (c) "whether the pause is still active" is now VERIFIED active (section 5); (d) the two hardening ideas in its section 6.4 add nothing (section 1).
