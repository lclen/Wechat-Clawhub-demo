# Graph Report - wechat-claw-hub  (2026-05-07)

## Corpus Check
- 230 files · ~430,154 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3077 nodes · 8643 edges · 36 communities detected
- Extraction: 66% EXTRACTED · 34% INFERRED · 0% AMBIGUOUS · INFERRED: 2961 edges (avg confidence: 0.66)
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
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 91|Community 91]]

## God Nodes (most connected - your core abstractions)
1. `Settings` - 131 edges
2. `SetupService` - 115 edges
3. `WeChatBotService` - 100 edges
4. `RedisStore` - 100 edges
5. `Worker` - 99 edges
6. `NodeSettings` - 96 edges
7. `DispatchQueue` - 94 edges
8. `SessionManager` - 93 edges
9. `ProcessManager` - 85 edges
10. `TranscriptWriter` - 75 edges

## Surprising Connections (you probably didn't know these)
- `getSessionPollTabId()` --calls--> `toString()`  [INFERRED]
  apps\agent-console\src\hooks\useSessionWorkspaceEffects.ts → runtime\liteapp-qrcode.js
- `shouldUseFastPolling()` --calls--> `loadMessages()`  [INFERRED]
  apps\agent-console\src\selectors\sessionSelectors.ts → apps\agent-console\__snapshots__\app-refactor-start\App.tsx
- `Settings` --uses--> `Minimal OpenAI-compatible client used for connectivity checks and future interna`  [INFERRED]
  apps\gateway\app\core\config.py → D:\wechat-clawhub\apps\gateway\app\services\openai_compatible_client.py
- `SessionRecord` --uses--> `Persist user/session snapshots alongside Redis for durability and inspection.`  [INFERRED]
  apps\gateway\app\models\session.py → D:\wechat-clawhub\apps\gateway\app\services\user_data_store.py
- `WeChatOnboardService` --uses--> `Raised when public entry ticket orchestration fails.`  [INFERRED]
  apps\gateway\app\services\wechat_onboard.py → D:\wechat-clawhub\apps\gateway\app\services\public_entry_service.py

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (311): syncNodeDiagnosticsCache(), $(), $a(), ac, ad(), addCatcher(), af, ah() (+303 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (124): InboundWeChatMediaRef, OutboundMarkdownSegment, ParsedInboundMessage, Match OpenAkita's outbound media encoding by default.      OpenAkita sends bas, Match OpenAkita's outbound media encoding by default.      OpenAkita sends bas, Match OpenAkita's outbound media encoding by default.      OpenAkita sends bas, Match OpenAkita's outbound media encoding by default.      OpenAkita sends bas, Raised when the upstream WeChat bot session has expired. (+116 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (60): BaseSettings, Best-effort Dify client for the worker node., ChannelLeaseState, 尝试通过 WebSocket 发送事件，失败时返回 False。          注意：WebSocket 检查和发送都在锁内执行，避免竞态条件。, 通过 WebSocket 发送事件（带锁保护）。          注意：此方法假设调用者已经检查了 task_stream_enabled。, 持续接收网关下行控制帧，直到真正拿到任务。          `ready/noop` 仅作为兼容旧协议的控制帧保留，新主链路只依赖网关主动推送, get_settings(), NodeSettings (+52 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (81): BaseModel, detect_environment(), _build_local_node_connectivity_check_report(), _connectivity_item_status(), _LocalNodeInferenceSettings, DispatchModeToggleRequest, InstallRedisRequest, LauncherEnvironmentCheck (+73 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (141): appendPairingClientError(), applyDispatchMode(), applyGatewaySummaryToState(), applyLauncherPolicyForRole(), applyLauncherStatusState(), applyOverview(), applyPreferredGatewayBaseUrlToWorker(), applySessionMessageEntry() (+133 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (61): _emit_progress(), _latency_growth_limit_ms(), _resolve_round_steps(), run_channel_assessment(), _run_round(), _select_balanced_round(), _utcnow(), apply_runtime_overrides() (+53 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (57): GatewaySummaryResponse, GatewaySummaryBuildError, GatewaySummaryService, Raised when the latest gateway summary truth cannot be assembled., GatewaySummaryStreamBroker, NodeDiagnosticsStreamBroker, build_node_inventory(), build_node_list_response() (+49 more)

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (72): _emit_progress(), _latency_growth_limit_ms(), _resolve_round_steps(), run_channel_assessment(), _run_round(), _select_balanced_round(), _utcnow(), DifyClient (+64 more)

### Community 8 - "Community 8"
Cohesion: 0.03
Nodes (19): MultiWeChatBotService, PublicEntrySummaryResponse, PublicEntryTicketCreateRequest, PublicEntryTicketResponse, create_public_entry_ticket(), get_public_entry_page(), get_public_entry_ticket(), Raised when public entry ticket orchestration fails. (+11 more)

### Community 9 - "Community 9"
Cohesion: 0.03
Nodes (24): _aes_ecb_padded_size(), _build_asset_label_text(), _build_delivery_text(), _build_markdown_image_summary(), _decrypt_aes_ecb(), _emit_wechat_debug(), _encode_wechat_media_aes_key(), _encrypt_aes_ecb() (+16 more)

### Community 10 - "Community 10"
Cohesion: 0.03
Nodes (13): Bl(), cc, fc, Gi, Ia, ic(), lc, Ma() (+5 more)

### Community 11 - "Community 11"
Cohesion: 0.02
Nodes (8): App, WechatClawHub.WinUI, WechatClawHub.WinUI.WechatClawHub_WinUI_XamlTypeInfo, XamlMember, XamlMetaDataProvider, XamlSystemBaseType, XamlTypeInfoProvider, XamlUserType

### Community 12 - "Community 12"
Cohesion: 0.04
Nodes (36): ensure_redis_available(), ingest_inbound_message(), _known_local_hosts(), NodeAuthService, Validate node credentials against pre-shared tokens., NodeDeleteResponse, NodeOperationResponse, delete_node() (+28 more)

### Community 13 - "Community 13"
Cohesion: 0.05
Nodes (34): DownloadedGatewayMedia, GatewayClient, detect_lan_ip(), directed_broadcast_targets(), _extract_rfc1918_ipv4(), IPv4InterfaceRecord, is_preferred_lan_ip(), is_usable_ipv4() (+26 more)

### Community 14 - "Community 14"
Cohesion: 0.09
Nodes (1): Worker

### Community 15 - "Community 15"
Cohesion: 0.07
Nodes (24): describeInventoryConnection(), describeTaskStreamHealth(), nodeInventoryBadgeLabel(), nodeInventoryBadgeTone(), nodeRoleLabel(), normalizeInventoryRuntimeMetrics(), resolveInventoryNodePresentation(), summarizeRemoteNode() (+16 more)

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (4): WeChatOfficialAccountService, _FakeAsyncClient, _FakeResponse, WeChatOfficialAccountServiceTests

### Community 17 - "Community 17"
Cohesion: 0.14
Nodes (3): _default_task_stream_state(), NodeDiagnosticEvent, NodeDiagnostics

### Community 18 - "Community 18"
Cohesion: 0.13
Nodes (5): Fr(), Qh, sp(), we(), wn

### Community 19 - "Community 19"
Cohesion: 0.13
Nodes (19): Ensure-FirewallPortRule(), Get-BundlePathCandidates(), Get-ServiceExecutablePath(), Get-StaleServiceNames(), New-NodeVirtualEnvironment(), Remove-FirewallRuleIfExists(), Remove-ServiceIfInstalled(), Remove-StaleNodeServices() (+11 more)

### Community 20 - "Community 20"
Cohesion: 0.19
Nodes (2): Window, MainWindow

### Community 21 - "Community 21"
Cohesion: 0.17
Nodes (1): sc

### Community 22 - "Community 22"
Cohesion: 0.22
Nodes (4): buildRoleCapabilities(), withPrimaryWorkspace(), workspacePresentation(), workspacePrimaryActionLabel()

### Community 23 - "Community 23"
Cohesion: 0.36
Nodes (2): IDisposable, LauncherSupervisor

### Community 24 - "Community 24"
Cohesion: 0.33
Nodes (5): ConnectionHeroCard(), ConnectionSignalCard(), InfoRow(), PrepStrip(), SnippetBlock()

### Community 26 - "Community 26"
Cohesion: 0.25
Nodes (1): claw-node worker package.

### Community 27 - "Community 27"
Cohesion: 0.38
Nodes (3): App, Program, WechatClawHub.WinUI

### Community 28 - "Community 28"
Cohesion: 0.76
Nodes (5): _audio_block(), build_message_content(), _normalize_block(), _parse_content_blocks(), _video_block()

### Community 29 - "Community 29"
Cohesion: 0.38
Nodes (3): Add-Failure(), Test-DirectoryValue(), Write-Pass()

### Community 31 - "Community 31"
Cohesion: 0.4
Nodes (3): clearSessionPollOwner(), getSessionPollTabId(), readSessionPollOwner()

### Community 32 - "Community 32"
Cohesion: 0.4
Nodes (2): MainWindow, WechatClawHub.WinUI

### Community 33 - "Community 33"
Cohesion: 0.4
Nodes (2): MainWindow, WechatClawHub.WinUI

### Community 34 - "Community 34"
Cohesion: 0.4
Nodes (2): Application, App

### Community 36 - "Community 36"
Cohesion: 0.5
Nodes (1): WeChatMpRouteTests

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (2): App, WechatClawHub.WinUI

### Community 91 - "Community 91"
Cohesion: 1.0
Nodes (1): Thin async Redis wrapper used by gateway services.

## Knowledge Gaps
- **8 isolated node(s):** `Thin async Redis wrapper used by gateway services.`, `Build the canonical session key used across the gateway.`, `Raised when cached media cannot be stored or read.`, `Raised when cached media is missing or expired.`, `Raised when WeChat onboarding fails.` (+3 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 14`** (56 nodes): `Worker`, `._cancel_active_task()`, `._cancel_register_retry_task()`, `._channel_maintenance_loop()`, `._coerce_int()`, `._coerce_usage_int()`, `._effective_inference_provider()`, `._effective_provider_name()`, `._enqueue_diagnostics_event()`, `._ensure_fallback_polling_started()`, `._ensure_gateway_loops_started()`, `._extract_reasoning_tokens()`, `._flush_pending_diagnostics_events()`, `._format_inference_event_details()`, `._handle_inference_event()`, `._handle_pair_request()`, `._handle_task()`, `._handle_task_stream_disconnect()`, `._heartbeat_loop()`, `._is_auth_error()`, `._mark_channel_task_completed()`, `._mark_channel_task_started()`, `._mask_token()`, `._maybe_run_task_stream_fallback()`, `._normalized_provider()`, `._on_task_done()`, `._parse_runtime_datetime()`, `._persist_runtime_pairing()`, `._poll_loop()`, `._poll_once()`, `._preview_text()`, `._publish_inference_status()`, `._receive_task_stream_assignment()`, `._record_task_event()`, `._register_retry_loop()`, `._register_with_gateway()`, `._release_idle_channels_if_needed()`, `.run()`, `._schedule_register_retry()`, `._send_task_stream_event()`, `._start_task_assignment()`, `._stop_fallback_polling()`, `._stop_gateway_loops()`, `._stringify_mapping()`, `._submit_channel_released()`, `._submit_task_failure()`, `._submit_task_result()`, `._summarize_task_stream_event()`, `._sync_channel_states_from_gateway()`, `._task_metadata()`, `._task_stream_diagnostics_loop()`, `._task_stream_loop()`, `._try_send_task_stream_event()`, `._update_latest_task()`, `._utcnow()`, `worker.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (21 nodes): `MainWindow.xaml.cs`, `Window`, `MainWindow`, `.BuildConsoleUri()`, `.BuildLayout()`, `.BuildTitleBar()`, `.ColorFromHex()`, `.CompleteStartupOnUiAsync()`, `.ConfigureSystemTitleBarColors()`, `.EnqueueOnUi()`, `.EnsureConsoleWebView()`, `.MainWindow_Closed()`, `.RefreshButton_Click()`, `.RestartStartupAsync()`, `.RetryButton_Click()`, `.RetryText_Tapped()`, `.Root_Loaded()`, `.ShowFailure()`, `.ShowStarting()`, `.SolidColorBrush()`, `.StartLocalRuntimeAsync()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (12 nodes): `sc`, `.constructor()`, `.env()`, `.httpPost()`, `.initAid()`, `.linkedData()`, `.loadPageStackFromStorage()`, `.readLinkedData()`, `.savePageStackToStorage()`, `.serializeLinkedData()`, `.settle()`, `.updateContext()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (10 nodes): `LauncherSupervisor.cs`, `IDisposable`, `LauncherSupervisor`, `.Dispose()`, `.EnsureRunningAsync()`, `.IsLauncherHealthyAsync()`, `.ResolveLauncherPath()`, `.StartLauncher()`, `.StopOwnedRuntimeAsync()`, `.WaitForLauncherAsync()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (8 nodes): `__init__.py`, `__init__.py`, `__init__.py`, `__init__.py`, `__init__.py`, `claw-node worker package.`, `__init__.py`, `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (6 nodes): `MainWindow.g.cs`, `MainWindow.g.cs`, `MainWindow`, `.Connect()`, `.GetBindingConnector()`, `WechatClawHub.WinUI`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (6 nodes): `MainWindow.g.i.cs`, `MainWindow.g.i.cs`, `MainWindow`, `.InitializeComponent()`, `.UnloadObject()`, `WechatClawHub.WinUI`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (5 nodes): `Application`, `App.xaml.cs`, `App`, `.App_UnhandledException()`, `.OnLaunched()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (4 nodes): `test_wechat_mp_route.py`, `WeChatMpRouteTests`, `.test_get_callback_returns_verified_echo()`, `.test_post_callback_dispatches_text_message_and_returns_success()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (4 nodes): `App`, `WechatClawHub.WinUI`, `App.g.cs`, `App.g.cs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 91`** (1 nodes): `Thin async Redis wrapper used by gateway services.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NodeSettings` connect `Community 2` to `Community 3`, `Community 5`, `Community 7`, `Community 13`, `Community 14`, `Community 17`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Why does `Settings` connect `Community 1` to `Community 2`, `Community 3`, `Community 6`, `Community 8`, `Community 9`, `Community 12`, `Community 16`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Why does `WeChatBotService` connect `Community 9` to `Community 1`, `Community 3`, `Community 6`, `Community 8`, `Community 12`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **Are the 128 inferred relationships involving `Settings` (e.g. with `OutboundMarkdownSegment` and `WeChatSessionExpiredError`) actually correct?**
  _`Settings` has 128 INFERRED edges - model-reasoned connections that need verification._
- **Are the 31 inferred relationships involving `SetupService` (e.g. with `Remove node from Redis active set only, keeping pairing token intact.     The n` and `GatewaySummaryBuildError`) actually correct?**
  _`SetupService` has 31 INFERRED edges - model-reasoned connections that need verification._
- **Are the 33 inferred relationships involving `WeChatBotService` (e.g. with `Settings` and `DispatchQueueError`) actually correct?**
  _`WeChatBotService` has 33 INFERRED edges - model-reasoned connections that need verification._
- **Are the 66 inferred relationships involving `RedisStore` (e.g. with `OutboundMarkdownSegment` and `WeChatSessionExpiredError`) actually correct?**
  _`RedisStore` has 66 INFERRED edges - model-reasoned connections that need verification._