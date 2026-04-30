# Graph Report - wechat-claw-hub  (2026-04-30)

## Corpus Check
- 228 files · ~425,866 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2867 nodes · 8130 edges · 32 communities detected
- Extraction: 65% EXTRACTED · 35% INFERRED · 0% AMBIGUOUS · INFERRED: 2844 edges (avg confidence: 0.68)
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
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]

## God Nodes (most connected - your core abstractions)
1. `Settings` - 117 edges
2. `SetupService` - 115 edges
3. `Worker` - 100 edges
4. `RedisStore` - 93 edges
5. `WeChatBotService` - 88 edges
6. `ProcessManager` - 85 edges
7. `NodeSettings` - 85 edges
8. `DispatchQueue` - 81 edges
9. `SessionManager` - 79 edges
10. `XamlTypeInfoProvider` - 63 edges

## Surprising Connections (you probably didn't know these)
- `ensureClientId()` --calls--> `toString()`  [INFERRED]
  apps\agent-console\src\components\PublicEntryPage.tsx → runtime\liteapp-qrcode.js
- `getSessionPollTabId()` --calls--> `toString()`  [INFERRED]
  apps\agent-console\src\hooks\useSessionWorkspaceEffects.ts → runtime\liteapp-qrcode.js
- `shouldUseFastPolling()` --calls--> `loadMessages()`  [INFERRED]
  apps\agent-console\src\selectors\sessionSelectors.ts → apps\agent-console\__snapshots__\app-refactor-start\App.tsx
- `Settings` --uses--> `Minimal OpenAI-compatible client used for connectivity checks and future interna`  [INFERRED]
  apps\gateway\app\core\config.py → D:\wechat-clawhub\apps\gateway\app\services\openai_compatible_client.py
- `DispatchTask` --uses--> `Receive an event from a node.          Returns a structured receive result so`  [INFERRED]
  apps\gateway\app\models\dispatch.py → D:\wechat-clawhub\apps\gateway\app\services\node_stream.py

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (308): launcherManagedComponentsLabel(), buildLauncherStartPayload(), launcherRoleUsesLocalNode(), _summarize_task_stream_event(), $(), $a(), ac, ad() (+300 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (112): OfficialAccountInboundMessage, Raised when the official account integration fails., Raised when the official account configuration is incomplete., Raised when an inbound callback cannot be verified., WeChatOfficialAccountConfigError, WeChatOfficialAccountError, WeChatOfficialAccountValidationError, syncNodeDiagnosticsCache() (+104 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (46): BaseSettings, NodeSettings, _default_task_stream_state(), events_path(), NodeDiagnosticEvent, NodeDiagnostics, status_path(), DifyClient (+38 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (75): BaseModel, detect_environment(), _LocalNodeInferenceSettings, DispatchModeToggleRequest, InstallRedisRequest, LauncherEnvironmentCheck, LauncherEnvironmentStatus, LauncherMachineRole (+67 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (142): appendPairingClientError(), applyDispatchMode(), applyGatewaySummaryToState(), applyLauncherPolicyForRole(), applyLauncherStatusState(), applyOverview(), applyPreferredGatewayBaseUrlToWorker(), applySessionMessageEntry() (+134 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (57): apply_runtime_overrides(), detect_provider(), interactive_chat(), load_settings(), main(), mask_secret(), parse_args(), resolve_default_node_env_path() (+49 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (33): get_settings(), resolved_diagnostics_dir(), resolved_env_file_path(), settings_customise_sources(), PublicEntrySummaryResponse, PublicEntryTicketCreateRequest, PublicEntryTicketResponse, create_public_entry_ticket() (+25 more)

### Community 7 - "Community 7"
Cohesion: 0.04
Nodes (55): GatewaySummaryResponse, GatewaySummaryBuildError, GatewaySummaryService, Raised when the latest gateway summary truth cannot be assembled., GatewaySummaryStreamBroker, build_node_inventory(), build_node_list_response(), _parse_optional_datetime() (+47 more)

### Community 8 - "Community 8"
Cohesion: 0.03
Nodes (73): _emit_progress(), _latency_growth_limit_ms(), _resolve_round_steps(), run_channel_assessment(), _run_round(), _select_balanced_round(), _utcnow(), _apply_local_node_model_config_in_background() (+65 more)

### Community 9 - "Community 9"
Cohesion: 0.02
Nodes (19): Bl(), cc, dc(), fc, Gi, Ia, ic(), La() (+11 more)

### Community 10 - "Community 10"
Cohesion: 0.02
Nodes (8): App, WechatClawHub.WinUI, WechatClawHub.WinUI.WechatClawHub_WinUI_XamlTypeInfo, XamlMember, XamlMetaDataProvider, XamlSystemBaseType, XamlTypeInfoProvider, XamlUserType

### Community 11 - "Community 11"
Cohesion: 0.04
Nodes (23): Fr(), Qh, sp(), we(), wn, WeChatBotServiceTests, _aes_ecb_padded_size(), _build_asset_label_text() (+15 more)

### Community 12 - "Community 12"
Cohesion: 0.04
Nodes (31): ensure_redis_available(), ingest_inbound_message(), _known_local_hosts(), NodeAuthService, Validate node credentials against pre-shared tokens., NodeDeleteResponse, NodeOperationResponse, delete_node() (+23 more)

### Community 13 - "Community 13"
Cohesion: 0.08
Nodes (33): detect_lan_ip(), directed_broadcast_targets(), _extract_rfc1918_ipv4(), IPv4InterfaceRecord, is_preferred_lan_ip(), is_usable_ipv4(), is_virtual_nic_ip(), launcher_cors_origins() (+25 more)

### Community 14 - "Community 14"
Cohesion: 0.08
Nodes (23): findLauncherComponent(), isExternalGatewayConflict(), isLauncherGatewayOwned(), launcherMachineRoleLabel(), launcherMachineRoleValue(), launcherManagedComponentsLabel(), launcherShouldRunGateway(), launcherShouldRunLocalNode() (+15 more)

### Community 15 - "Community 15"
Cohesion: 0.1
Nodes (4): WeChatOfficialAccountService, _FakeAsyncClient, _FakeResponse, WeChatOfficialAccountServiceTests

### Community 16 - "Community 16"
Cohesion: 0.13
Nodes (19): Ensure-FirewallPortRule(), Get-BundlePathCandidates(), Get-ServiceExecutablePath(), Get-StaleServiceNames(), New-NodeVirtualEnvironment(), Remove-FirewallRuleIfExists(), Remove-ServiceIfInstalled(), Remove-StaleNodeServices() (+11 more)

### Community 17 - "Community 17"
Cohesion: 0.21
Nodes (3): WeChatMediaStoreTests, WeChatMediaRecord, WeChatMediaStore

### Community 18 - "Community 18"
Cohesion: 0.19
Nodes (2): Window, MainWindow

### Community 19 - "Community 19"
Cohesion: 0.17
Nodes (1): sc

### Community 20 - "Community 20"
Cohesion: 0.22
Nodes (4): buildRoleCapabilities(), withPrimaryWorkspace(), workspacePresentation(), workspacePrimaryActionLabel()

### Community 21 - "Community 21"
Cohesion: 0.36
Nodes (2): IDisposable, LauncherSupervisor

### Community 22 - "Community 22"
Cohesion: 0.33
Nodes (5): ConnectionHeroCard(), ConnectionSignalCard(), InfoRow(), PrepStrip(), SnippetBlock()

### Community 24 - "Community 24"
Cohesion: 0.25
Nodes (1): claw-node worker package.

### Community 25 - "Community 25"
Cohesion: 0.38
Nodes (3): Add-Failure(), Test-DirectoryValue(), Write-Pass()

### Community 27 - "Community 27"
Cohesion: 0.4
Nodes (3): clearSessionPollOwner(), getSessionPollTabId(), readSessionPollOwner()

### Community 28 - "Community 28"
Cohesion: 0.47
Nodes (3): App, Program, WechatClawHub.WinUI

### Community 29 - "Community 29"
Cohesion: 0.4
Nodes (2): MainWindow, WechatClawHub.WinUI

### Community 30 - "Community 30"
Cohesion: 0.4
Nodes (2): MainWindow, WechatClawHub.WinUI

### Community 31 - "Community 31"
Cohesion: 0.4
Nodes (2): Application, App

### Community 32 - "Community 32"
Cohesion: 0.5
Nodes (1): WeChatMpRouteTests

### Community 33 - "Community 33"
Cohesion: 0.67
Nodes (2): App, WechatClawHub.WinUI

## Knowledge Gaps
- **7 isolated node(s):** `Thin async Redis wrapper used by gateway services.`, `Build the canonical session key used across the gateway.`, `Raised when cached media cannot be stored or read.`, `Raised when cached media is missing or expired.`, `Raised when WeChat onboarding fails.` (+2 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 18`** (21 nodes): `MainWindow.xaml.cs`, `Window`, `MainWindow`, `.BuildConsoleUri()`, `.BuildLayout()`, `.BuildTitleBar()`, `.ColorFromHex()`, `.CompleteStartupOnUiAsync()`, `.ConfigureSystemTitleBarColors()`, `.EnqueueOnUi()`, `.EnsureConsoleWebView()`, `.MainWindow_Closed()`, `.RefreshButton_Click()`, `.RestartStartupAsync()`, `.RetryButton_Click()`, `.RetryText_Tapped()`, `.Root_Loaded()`, `.ShowFailure()`, `.ShowStarting()`, `.SolidColorBrush()`, `.StartLocalRuntimeAsync()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (12 nodes): `sc`, `.constructor()`, `.env()`, `.httpPost()`, `.initAid()`, `.linkedData()`, `.loadPageStackFromStorage()`, `.readLinkedData()`, `.savePageStackToStorage()`, `.serializeLinkedData()`, `.settle()`, `.updateContext()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (10 nodes): `LauncherSupervisor.cs`, `IDisposable`, `LauncherSupervisor`, `.Dispose()`, `.EnsureRunningAsync()`, `.IsLauncherHealthyAsync()`, `.ResolveLauncherPath()`, `.StartLauncher()`, `.StopOwnedRuntimeAsync()`, `.WaitForLauncherAsync()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (8 nodes): `__init__.py`, `__init__.py`, `__init__.py`, `__init__.py`, `__init__.py`, `claw-node worker package.`, `__init__.py`, `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (6 nodes): `MainWindow.g.cs`, `MainWindow.g.cs`, `MainWindow`, `.Connect()`, `.GetBindingConnector()`, `WechatClawHub.WinUI`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (6 nodes): `MainWindow.g.i.cs`, `MainWindow.g.i.cs`, `MainWindow`, `.InitializeComponent()`, `.UnloadObject()`, `WechatClawHub.WinUI`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (5 nodes): `Application`, `App.xaml.cs`, `App`, `.App_UnhandledException()`, `.OnLaunched()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (4 nodes): `test_wechat_mp_route.py`, `WeChatMpRouteTests`, `.test_get_callback_returns_verified_echo()`, `.test_post_callback_dispatches_text_message_and_returns_success()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (4 nodes): `App`, `WechatClawHub.WinUI`, `App.g.cs`, `App.g.cs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Settings` connect `Community 1` to `Community 2`, `Community 3`, `Community 6`, `Community 7`, `Community 11`, `Community 12`, `Community 15`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `SetupService` connect `Community 3` to `Community 1`, `Community 12`, `Community 13`, `Community 7`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Why does `WeChatBotService` connect `Community 1` to `Community 2`, `Community 3`, `Community 5`, `Community 6`, `Community 7`, `Community 11`, `Community 17`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Are the 114 inferred relationships involving `Settings` (e.g. with `OutboundMarkdownSegment` and `WeChatSessionExpiredError`) actually correct?**
  _`Settings` has 114 INFERRED edges - model-reasoned connections that need verification._
- **Are the 31 inferred relationships involving `SetupService` (e.g. with `Remove node from Redis active set only, keeping pairing token intact.     The n` and `GatewaySummaryBuildError`) actually correct?**
  _`SetupService` has 31 INFERRED edges - model-reasoned connections that need verification._
- **Are the 43 inferred relationships involving `Worker` (e.g. with `NodeSettings` and `NodeDiagnostics`) actually correct?**
  _`Worker` has 43 INFERRED edges - model-reasoned connections that need verification._
- **Are the 62 inferred relationships involving `RedisStore` (e.g. with `OutboundMarkdownSegment` and `WeChatSessionExpiredError`) actually correct?**
  _`RedisStore` has 62 INFERRED edges - model-reasoned connections that need verification._