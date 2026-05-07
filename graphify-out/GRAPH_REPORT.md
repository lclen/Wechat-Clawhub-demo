# Graph Report - D:\wechat-clawhub  (2026-05-07)

## Corpus Check
- 220 files · ~686,660 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2277 nodes · 6790 edges · 85 communities detected
- Extraction: 56% EXTRACTED · 44% INFERRED · 0% AMBIGUOUS · INFERRED: 2963 edges (avg confidence: 0.69)
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
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]

## God Nodes (most connected - your core abstractions)
1. `Settings` - 117 edges
2. `SetupService` - 115 edges
3. `WeChatBotService` - 100 edges
4. `Worker` - 100 edges
5. `RedisStore` - 90 edges
6. `ProcessManager` - 88 edges
7. `NodeSettings` - 85 edges
8. `DispatchQueue` - 79 edges
9. `SessionManager` - 77 edges
10. `TranscriptWriter` - 60 edges

## Surprising Connections (you probably didn't know these)
- `loadMessages()` --calls--> `shouldUseFastPolling()`  [INFERRED]
  D:\wechat-clawhub\apps\agent-console\__snapshots__\app-refactor-start\App.tsx → D:\wechat-clawhub\apps\agent-console\src\selectors\sessionSelectors.ts
- `Minimal OpenAI-compatible client used for connectivity checks and future interna` --uses--> `Settings`  [INFERRED]
  D:\wechat-clawhub\apps\gateway\app\services\openai_compatible_client.py → D:\wechat-clawhub\apps\gateway\app\core\config.py
- `Node event stream broker for real-time node-to-gateway communication.` --uses--> `DispatchTask`  [INFERRED]
  D:\wechat-clawhub\apps\gateway\app\services\node_stream.py → D:\wechat-clawhub\apps\gateway\app\models\dispatch.py
- `Manages WebSocket connections for node event streams.` --uses--> `DispatchTask`  [INFERRED]
  D:\wechat-clawhub\apps\gateway\app\services\node_stream.py → D:\wechat-clawhub\apps\gateway\app\models\dispatch.py
- `Register a node's WebSocket connection.` --uses--> `DispatchTask`  [INFERRED]
  D:\wechat-clawhub\apps\gateway\app\services\node_stream.py → D:\wechat-clawhub\apps\gateway\app\models\dispatch.py

## Communities

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (94): Settings, ChannelReleasedRequest, DispatchTask, PullTaskRequest, PullTaskResponse, TaskFailureRequest, TaskResultRequest, InboundAggregationResult (+86 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (56): _infer_local_node_runtime_status(), _query_local_node_gateway_activity(), DifyClient, DifyClient, DownloadedGatewayMedia, GatewayClient, identity(), create_inference_client() (+48 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (138): appendPairingClientError(), applyDispatchMode(), applyGatewaySummaryToState(), applyLauncherPolicyForRole(), applyLauncherStatusState(), applyOverview(), applyPreferredGatewayBaseUrlToWorker(), applySessionMessageEntry() (+130 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (48): stream_node_tasks(), PublicEntryTicketStats, connect_console_setup(), ConsoleConnectRequest, ConsoleSetupConfig, DiscoveredNodeRecord, DiscoveryPairRequest, DiscoveryPairResponse (+40 more)

### Community 4 - "Community 4"
Cohesion: 0.04
Nodes (27): AppLog, BaseSettings, NodeSettings, _default_task_stream_state(), events_path(), NodeDiagnosticEvent, NodeDiagnostics, status_path() (+19 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (53): GatewaySummaryResponse, GatewaySummaryBuildError, GatewaySummaryService, Raised when the latest gateway summary truth cannot be assembled., GatewaySummaryStreamBroker, build_node_inventory(), build_node_list_response(), _parse_optional_datetime() (+45 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (44): create_app(), _resolve_gateway_proxy_base_url(), apply_runtime_overrides(), detect_provider(), interactive_chat(), load_settings(), main(), mask_secret() (+36 more)

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (90): _apply_local_node_model_config_in_background(), _build_local_node_assessment_blocking_result(), _build_local_node_channel_assessment_result(), _build_local_node_connectivity_check_report(), _build_local_node_inference_settings(), _build_local_node_task_stream_health(), _build_node_model_config_from_gateway_env(), _connectivity_item_status() (+82 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (23): get_settings(), resolve_default_node_env_path(), resolved_diagnostics_dir(), resolved_env_file_path(), settings_customise_sources(), create_public_entry_ticket(), get_public_entry_page(), get_public_entry_ticket() (+15 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (29): ensure_redis_available(), ingest_inbound_message(), _known_local_hosts(), NodeAuthService, Validate node credentials against pre-shared tokens., NodeDiagnosticsStreamBroker, NodeDeleteResponse, NodeDiagnosticsResponse (+21 more)

### Community 10 - "Community 10"
Cohesion: 0.04
Nodes (8): App, WechatClawHub.WinUI, WechatClawHub.WinUI.WechatClawHub_WinUI_XamlTypeInfo, XamlMember, XamlMetaDataProvider, XamlSystemBaseType, XamlTypeInfoProvider, XamlUserType

### Community 11 - "Community 11"
Cohesion: 0.08
Nodes (7): _gateway_summary_loop(), lifespan(), WeChatMediaStoreTests, WeChatMediaRecord, WeChatMediaStore, ManagedWeChatAccountConfig, MultiWeChatBotService

### Community 12 - "Community 12"
Cohesion: 0.08
Nodes (32): detect_lan_ip(), directed_broadcast_targets(), _extract_rfc1918_ipv4(), IPv4InterfaceRecord, is_preferred_lan_ip(), is_usable_ipv4(), is_virtual_nic_ip(), launcher_cors_origins() (+24 more)

### Community 13 - "Community 13"
Cohesion: 0.07
Nodes (27): buildLauncherStartPayload(), findLauncherComponent(), isExternalGatewayConflict(), isLauncherGatewayOwned(), launcherMachineRoleLabel(), launcherMachineRoleValue(), launcherRoleUsesLocalNode(), launcherShouldRunGateway() (+19 more)

### Community 14 - "Community 14"
Cohesion: 0.09
Nodes (9): App, Application, IDisposable, LauncherSupervisor, global_exception_handler(), log_requests_middleware(), validation_exception_handler(), MainWindow (+1 more)

### Community 15 - "Community 15"
Cohesion: 0.09
Nodes (6): _FakeAsyncClient, WeChatOfficialAccountServiceTests, handle_wechat_mp_callback(), _send_notice_safely(), verify_wechat_mp_callback(), WeChatOfficialAccountService

### Community 16 - "Community 16"
Cohesion: 0.13
Nodes (19): Ensure-FirewallPortRule(), Get-BundlePathCandidates(), Get-ServiceExecutablePath(), Get-StaleServiceNames(), New-NodeVirtualEnvironment(), Remove-FirewallRuleIfExists(), Remove-ServiceIfInstalled(), Remove-StaleNodeServices() (+11 more)

### Community 17 - "Community 17"
Cohesion: 0.11
Nodes (10): NodeStreamBroker, NodeStreamConnection, Node event stream broker for real-time node-to-gateway communication., Receive an event from a node.          Returns a structured receive result so, Get list of currently connected node IDs., Manages WebSocket connections for node event streams., Register a node's WebSocket connection., Unregister a node's WebSocket connection. (+2 more)

### Community 18 - "Community 18"
Cohesion: 0.19
Nodes (8): _emit_progress(), _latency_growth_limit_ms(), _resolve_round_steps(), run_channel_assessment(), _run_round(), _select_balanced_round(), _utcnow(), ChannelAssessmentTests

### Community 19 - "Community 19"
Cohesion: 0.16
Nodes (12): formatDayLabel(), formatDurationLabel(), formatSessionName(), formatTimeAgo(), getReplyDurationLabel(), getSessionBadgeLabel(), getTypingState(), hasCompletedReplyAfterDispatch() (+4 more)

### Community 20 - "Community 20"
Cohesion: 0.22
Nodes (4): buildRoleCapabilities(), withPrimaryWorkspace(), workspacePresentation(), workspacePrimaryActionLabel()

### Community 21 - "Community 21"
Cohesion: 0.33
Nodes (5): ConnectionHeroCard(), ConnectionSignalCard(), InfoRow(), PrepStrip(), SnippetBlock()

### Community 22 - "Community 22"
Cohesion: 0.22
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 0.25
Nodes (1): claw-node worker package.

### Community 24 - "Community 24"
Cohesion: 0.38
Nodes (3): Add-Failure(), Test-DirectoryValue(), Write-Pass()

### Community 25 - "Community 25"
Cohesion: 0.29
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 0.4
Nodes (2): clearSessionPollOwner(), readSessionPollOwner()

### Community 27 - "Community 27"
Cohesion: 0.33
Nodes (3): App, Program, WechatClawHub.WinUI

### Community 28 - "Community 28"
Cohesion: 0.4
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 0.4
Nodes (2): MainWindow, WechatClawHub.WinUI

### Community 30 - "Community 30"
Cohesion: 0.4
Nodes (2): MainWindow, WechatClawHub.WinUI

### Community 31 - "Community 31"
Cohesion: 0.5
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 0.67
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 0.67
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 0.67
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 0.67
Nodes (2): build_session_id(), Build the canonical session key used across the gateway.

### Community 36 - "Community 36"
Cohesion: 0.67
Nodes (2): App, WechatClawHub.WinUI

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
Nodes (0): 

### Community 65 - "Community 65"
Cohesion: 1.0
Nodes (0): 

### Community 66 - "Community 66"
Cohesion: 1.0
Nodes (0): 

### Community 67 - "Community 67"
Cohesion: 1.0
Nodes (0): 

### Community 68 - "Community 68"
Cohesion: 1.0
Nodes (0): 

### Community 69 - "Community 69"
Cohesion: 1.0
Nodes (0): 

### Community 70 - "Community 70"
Cohesion: 1.0
Nodes (0): 

### Community 71 - "Community 71"
Cohesion: 1.0
Nodes (0): 

### Community 72 - "Community 72"
Cohesion: 1.0
Nodes (0): 

### Community 73 - "Community 73"
Cohesion: 1.0
Nodes (0): 

### Community 74 - "Community 74"
Cohesion: 1.0
Nodes (0): 

### Community 75 - "Community 75"
Cohesion: 1.0
Nodes (0): 

### Community 76 - "Community 76"
Cohesion: 1.0
Nodes (0): 

### Community 77 - "Community 77"
Cohesion: 1.0
Nodes (0): 

### Community 78 - "Community 78"
Cohesion: 1.0
Nodes (0): 

### Community 79 - "Community 79"
Cohesion: 1.0
Nodes (0): 

### Community 80 - "Community 80"
Cohesion: 1.0
Nodes (0): 

### Community 81 - "Community 81"
Cohesion: 1.0
Nodes (0): 

### Community 82 - "Community 82"
Cohesion: 1.0
Nodes (0): 

### Community 83 - "Community 83"
Cohesion: 1.0
Nodes (0): 

### Community 84 - "Community 84"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **13 isolated node(s):** `Thin async Redis wrapper used by gateway services.`, `Build the canonical session key used across the gateway.`, `Raised when cached media cannot be stored or read.`, `Raised when cached media is missing or expired.`, `Raised when WeChat onboarding fails.` (+8 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 37`** (2 nodes): `handleRunTest()`, `ConversationTestWorkspace.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (2 nodes): `LogsWorkspace.tsx`, `LogsWorkspace()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (2 nodes): `SessionsWorkspace.tsx`, `systemStatus()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (2 nodes): `useGatewaySummaryEffects.ts`, `useGatewaySummaryEffects()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (2 nodes): `useLocalNodeController.ts`, `useLocalNodeController()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (2 nodes): `useNodeDiagnosticsEffects.ts`, `useNodeDiagnosticsEffects()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (2 nodes): `usePairingDebug.ts`, `usePairingDebug()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (2 nodes): `usePairingOperations.ts`, `usePairingOperations()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (2 nodes): `useQuickSetupController.ts`, `useQuickSetupController()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (2 nodes): `useQuickSetupOperations.ts`, `useQuickSetupOperations()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (2 nodes): `useSetupTaskEffects.ts`, `useSetupTaskEffects()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (2 nodes): `useWechatOnboarding.ts`, `useWechatOnboarding()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (2 nodes): `useWorkspacePollingEffects.ts`, `useWorkspacePollingEffects()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (2 nodes): `install-graphify-codex.ps1`, `Resolve-PythonCommand()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (2 nodes): `Invoke-Checked()`, `build-desktop-launcher.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (2 nodes): `Invoke-Checked()`, `build-winui-client.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (1 nodes): `vite.config.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (1 nodes): `vite.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (1 nodes): `vite.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (1 nodes): `check-ui-copy.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (1 nodes): `main.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (1 nodes): `qrcode.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (1 nodes): `quickSetupDefaults.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (1 nodes): `ConnectionWorkspace.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (1 nodes): `DiagnosticsConsole.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (1 nodes): `NodeInventoryPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (1 nodes): `NodeModelConfigPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (1 nodes): `OverviewPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `PairingStatusModal.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `RuntimeLogsPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (1 nodes): `WeChatConfigCard.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (1 nodes): `LauncherControlPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (1 nodes): `QuickSetupConfigStage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (1 nodes): `QuickSetupExecutionStage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (1 nodes): `QuickSetupRolePanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (1 nodes): `QuickSetupStatusPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (1 nodes): `QuickSetupWorkspace.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (1 nodes): `MessageContent.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (1 nodes): `NodeModelConfigPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (1 nodes): `OverviewPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (1 nodes): `router.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (1 nodes): `WechatClawHub.WinUI.AssemblyInfo.cs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (1 nodes): `WechatClawHub.WinUI.GlobalUsings.g.cs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (1 nodes): `LauncherRuntimeState.cs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (1 nodes): `LauncherStartResult.cs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (1 nodes): `build-claw-node-bundle.ps1`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Settings` connect `Community 0` to `Community 1`, `Community 3`, `Community 4`, `Community 5`, `Community 8`, `Community 9`, `Community 11`, `Community 15`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `SetupService` connect `Community 3` to `Community 0`, `Community 1`, `Community 5`, `Community 9`, `Community 11`, `Community 12`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Why does `PublicEntryService` connect `Community 8` to `Community 0`, `Community 3`, `Community 10`, `Community 11`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Are the 114 inferred relationships involving `Settings` (e.g. with `OutboundMarkdownSegment` and `WeChatSessionExpiredError`) actually correct?**
  _`Settings` has 114 INFERRED edges - model-reasoned connections that need verification._
- **Are the 31 inferred relationships involving `SetupService` (e.g. with `Remove node from Redis active set only, keeping pairing token intact.     The n` and `GatewaySummaryBuildError`) actually correct?**
  _`SetupService` has 31 INFERRED edges - model-reasoned connections that need verification._
- **Are the 33 inferred relationships involving `WeChatBotService` (e.g. with `Settings` and `DispatchQueueError`) actually correct?**
  _`WeChatBotService` has 33 INFERRED edges - model-reasoned connections that need verification._
- **Are the 43 inferred relationships involving `Worker` (e.g. with `NodeSettings` and `NodeDiagnostics`) actually correct?**
  _`Worker` has 43 INFERRED edges - model-reasoned connections that need verification._