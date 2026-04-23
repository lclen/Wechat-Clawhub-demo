# Graph Report - D:\wechat-claw-hub  (2026-04-23)

## Corpus Check
- 200 files · ~616,248 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1971 nodes · 6431 edges · 65 communities detected
- Extraction: 33% EXTRACTED · 67% INFERRED · 0% AMBIGUOUS · INFERRED: 4308 edges (avg confidence: 0.61)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]

## God Nodes (most connected - your core abstractions)
1. `Settings` - 129 edges
2. `SetupService` - 116 edges
3. `Worker` - 102 edges
4. `RedisStore` - 100 edges
5. `NodeSettings` - 95 edges
6. `WeChatBotService` - 93 edges
7. `DispatchQueue` - 87 edges
8. `SessionManager` - 87 edges
9. `ProcessManager` - 75 edges
10. `DispatchQueueError` - 64 edges

## Surprising Connections (you probably didn't know these)
- `shouldUseFastPolling()` --calls--> `loadMessages()`  [INFERRED]
  D:\wechat-claw-hub\apps\agent-console\src\selectors\sessionSelectors.ts → D:\wechat-claw-hub\apps\agent-console\__snapshots__\app-refactor-start\App.tsx
- `Settings` --uses--> `Minimal OpenAI-compatible client used for connectivity checks and future interna`  [INFERRED]
  D:\wechat-claw-hub\apps\gateway\app\core\config.py → apps\gateway\app\services\openai_compatible_client.py
- `DispatchTask` --uses--> `Register a node's WebSocket connection.`  [INFERRED]
  D:\wechat-claw-hub\apps\gateway\app\models\dispatch.py → apps\gateway\app\services\node_stream.py
- `DispatchTask` --uses--> `Unregister a node's WebSocket connection.`  [INFERRED]
  D:\wechat-claw-hub\apps\gateway\app\models\dispatch.py → apps\gateway\app\services\node_stream.py
- `DispatchTask` --uses--> `Push a task to a node via WebSocket.          Returns True if pushed successfull`  [INFERRED]
  D:\wechat-claw-hub\apps\gateway\app\models\dispatch.py → apps\gateway\app\services\node_stream.py

## Communities

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (123): Settings, ChannelReleasedRequest, DispatchTask, PullTaskRequest, PullTaskResponse, TaskFailureRequest, TaskResultRequest, InboundAggregationResult (+115 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (57): apply_runtime_overrides(), detect_provider(), interactive_chat(), load_settings(), main(), mask_secret(), parse_args(), DifyClient (+49 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (87): ensure_redis_available(), GatewaySummaryResponse, GatewaySummaryBuildError, GatewaySummaryService, Raised when the latest gateway summary truth cannot be assembled., GatewaySummaryStreamBroker, _known_local_hosts(), NodeAuthService (+79 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (135): appendPairingClientError(), applyDispatchMode(), applyGatewaySummaryToState(), applyLauncherPolicyForRole(), applyLauncherStatusState(), applyOverview(), applyPreferredGatewayBaseUrlToWorker(), applySessionMessageEntry() (+127 more)

### Community 4 - "Community 4"
Cohesion: 0.04
Nodes (29): _run_local_node_channel_assessment_task(), BaseSettings, get_settings(), NodeSettings, resolve_default_node_env_path(), resolved_diagnostics_dir(), resolved_env_file_path(), settings_customise_sources() (+21 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (24): Register a node's WebSocket connection., stream_node_tasks(), connect_console_setup(), get_discovery_task(), get_setup_profile(), get_setup_task(), install_worker_node(), probe_worker_gateway() (+16 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (27): _gateway_summary_loop(), lifespan(), create_public_entry_ticket(), get_public_entry_page(), get_public_entry_ticket(), PublicEntrySummaryResponse, PublicEntryTicketCreateRequest, PublicEntryTicketResponse (+19 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (34): create_app(), _resolve_gateway_proxy_base_url(), configure_logging(), _main(), run_gateway(), run_launcher(), run_node(), apply_machine_role() (+26 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (68): _LocalNodeInferenceSettings, Prefer loopback when this machine hosts the gateway, even if the public LAN URL, Prefer loopback when this machine hosts the gateway, even if the public LAN URL, BaseModel, detect_environment(), DispatchModeToggleRequest, InstallRedisRequest, LauncherEnvironmentCheck (+60 more)

### Community 9 - "Community 9"
Cohesion: 0.05
Nodes (46): _apply_local_node_model_config_in_background(), _build_local_node_assessment_blocking_result(), _build_local_node_channel_assessment_result(), _build_local_node_inference_settings(), _build_local_node_task_stream_health(), _build_node_model_config_from_gateway_env(), _create_local_node_inference_client(), _escape_env_value() (+38 more)

### Community 10 - "Community 10"
Cohesion: 0.08
Nodes (4): Unregister a node's WebSocket connection., Push a task to a node via WebSocket.          Returns True if pushed successfull, DispatchQueue, DispatchQueueSlotTests

### Community 11 - "Community 11"
Cohesion: 0.1
Nodes (25): detect_lan_ip(), directed_broadcast_targets(), _extract_rfc1918_ipv4(), IPv4InterfaceRecord, is_preferred_lan_ip(), is_usable_ipv4(), is_virtual_nic_ip(), launcher_cors_origins() (+17 more)

### Community 12 - "Community 12"
Cohesion: 0.07
Nodes (23): buildLauncherStartPayload(), findLauncherComponent(), isExternalGatewayConflict(), isLauncherGatewayOwned(), launcherMachineRoleLabel(), launcherMachineRoleValue(), launcherRoleUsesLocalNode(), launcherShouldRunGateway() (+15 more)

### Community 13 - "Community 13"
Cohesion: 0.1
Nodes (0): 

### Community 14 - "Community 14"
Cohesion: 0.21
Nodes (8): _emit_progress(), _latency_growth_limit_ms(), _resolve_round_steps(), run_channel_assessment(), _run_round(), _select_balanced_round(), _utcnow(), ChannelAssessmentTests

### Community 15 - "Community 15"
Cohesion: 0.16
Nodes (12): formatDayLabel(), formatDurationLabel(), formatSessionName(), formatTimeAgo(), getReplyDurationLabel(), getSessionBadgeLabel(), getTypingState(), hasCompletedReplyAfterDispatch() (+4 more)

### Community 16 - "Community 16"
Cohesion: 0.22
Nodes (4): buildRoleCapabilities(), withPrimaryWorkspace(), workspacePresentation(), workspacePrimaryActionLabel()

### Community 17 - "Community 17"
Cohesion: 0.22
Nodes (0): 

### Community 18 - "Community 18"
Cohesion: 0.33
Nodes (5): ConnectionHeroCard(), ConnectionSignalCard(), InfoRow(), PrepStrip(), SnippetBlock()

### Community 19 - "Community 19"
Cohesion: 0.25
Nodes (1): claw-node worker package.

### Community 20 - "Community 20"
Cohesion: 0.4
Nodes (2): clearSessionPollOwner(), readSessionPollOwner()

### Community 21 - "Community 21"
Cohesion: 0.4
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 0.4
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 0.67
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 0.67
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (0): 

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (0): 

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (0): 

### Community 39 - "Community 39"
Cohesion: 1.0
Nodes (0): 

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (0): 

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (0): 

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (0): 

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (0): 

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (0): 

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (0): 

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (0): 

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (0): 

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (0): 

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (0): 

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (0): 

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (0): 

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (0): 

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (0): 

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (0): 

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (0): 

### Community 57 - "Community 57"
Cohesion: 1.0
Nodes (0): 

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (0): 

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (0): 

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (0): 

### Community 61 - "Community 61"
Cohesion: 1.0
Nodes (0): 

### Community 62 - "Community 62"
Cohesion: 1.0
Nodes (0): 

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (0): 

### Community 64 - "Community 64"
Cohesion: 1.0
Nodes (1): Raised when WeChat onboarding fails.

## Knowledge Gaps
- **13 isolated node(s):** `Thin async Redis wrapper used by gateway services.`, `Build the canonical session key used across the gateway.`, `Raised when cached media cannot be stored or read.`, `Raised when cached media is missing or expired.`, `Raised when WeChat onboarding fails.` (+8 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 25`** (2 nodes): `handleRunTest()`, `ConversationTestWorkspace.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (2 nodes): `useGatewayRuntimeController.ts`, `useGatewayRuntimeController()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (2 nodes): `useGatewaySummaryEffects.ts`, `useGatewaySummaryEffects()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (2 nodes): `useLocalNodeController.ts`, `useLocalNodeController()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (2 nodes): `useNodeDiagnosticsEffects.ts`, `useNodeDiagnosticsEffects()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (2 nodes): `usePairingDebug.ts`, `usePairingDebug()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (2 nodes): `usePairingOperations.ts`, `usePairingOperations()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (2 nodes): `useQuickSetupController.ts`, `useQuickSetupController()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (2 nodes): `useQuickSetupOperations.ts`, `useQuickSetupOperations()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (2 nodes): `useSetupTaskEffects.ts`, `useSetupTaskEffects()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (2 nodes): `useWechatOnboarding.ts`, `useWechatOnboarding()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (2 nodes): `useWorkspacePollingEffects.ts`, `useWorkspacePollingEffects()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (1 nodes): `vite.config.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (1 nodes): `vite.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (1 nodes): `main.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (1 nodes): `qrcode.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (1 nodes): `quickSetupDefaults.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (1 nodes): `ConnectionWorkspace.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (1 nodes): `DiagnosticsConsole.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (1 nodes): `NodeInventoryPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (1 nodes): `NodeModelConfigPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (1 nodes): `OverviewPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (1 nodes): `PairingStatusModal.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (1 nodes): `RuntimeLogsPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (1 nodes): `WeChatConfigCard.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (1 nodes): `LogsWorkspace.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (1 nodes): `LauncherControlPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (1 nodes): `QuickSetupConfigStage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (1 nodes): `QuickSetupExecutionStage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (1 nodes): `QuickSetupRolePanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (1 nodes): `QuickSetupStatusPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (1 nodes): `QuickSetupWorkspace.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (1 nodes): `MessageContent.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (1 nodes): `SessionsWorkspace.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (1 nodes): `NodeModelConfigPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (1 nodes): `OverviewPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (1 nodes): `router.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (1 nodes): `Raised when WeChat onboarding fails.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Settings` connect `Community 0` to `Community 1`, `Community 2`, `Community 4`, `Community 5`, `Community 6`, `Community 8`, `Community 10`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Why does `syncSessionMessageCache()` connect `Community 3` to `Community 1`, `Community 5`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Why does `RedisStore` connect `Community 0` to `Community 1`, `Community 2`, `Community 5`, `Community 6`, `Community 7`, `Community 8`, `Community 10`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Are the 127 inferred relationships involving `Settings` (e.g. with `get_settings()` and `OutboundMarkdownSegment`) actually correct?**
  _`Settings` has 127 INFERRED edges - model-reasoned connections that need verification._
- **Are the 32 inferred relationships involving `SetupService` (e.g. with `Remove node from Redis active set only, keeping pairing token intact.     The n` and `GatewaySummaryBuildError`) actually correct?**
  _`SetupService` has 32 INFERRED edges - model-reasoned connections that need verification._
- **Are the 45 inferred relationships involving `Worker` (e.g. with `NodeSettings` and `NodeDiagnostics`) actually correct?**
  _`Worker` has 45 INFERRED edges - model-reasoned connections that need verification._
- **Are the 69 inferred relationships involving `RedisStore` (e.g. with `OutboundMarkdownSegment` and `WeChatSessionExpiredError`) actually correct?**
  _`RedisStore` has 69 INFERRED edges - model-reasoned connections that need verification._