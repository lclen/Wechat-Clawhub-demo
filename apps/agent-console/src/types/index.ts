export type ModelStatus = { configured: boolean; base_url: string; model: string };
export type SystemStatus = { app_name: string; environment: string; version: string; redis_ok: boolean; dify_configured: boolean; wechat_configured: boolean; active_nodes: number; dispatch_mode_enabled: boolean; gateway_bind_host: string; preferred_lan_ip: string | null; preferred_gateway_base_url: string; timestamp: string };
export type ModelCheck = { ok: boolean; configured_model: string; available_models: string[]; configured_model_available: boolean };
export type WeChatStatus = { configured: boolean; running: boolean; base_url: string; has_token: boolean; last_error: string | null; received_messages: number; sent_messages: number };
export type SessionStatus = "bot_active" | "handoff_pending" | "human_active" | "closing";
export type QueueStatus = "none" | "pending" | "inflight";
export type RoutingMode = "auto" | "manual";
export type SessionSwitchAction = "auto" | "manual";
export type SessionRecord = { session_id: string; channel: string; user_id: string; agent_id: string; status: SessionStatus; assigned_node_id: string | null; assigned_slot_id: string | null; active_task_id: string | null; queue_status: QueueStatus; context_summary: string; context_version: number; routing_mode: RoutingMode; slot_bound_at: string | null; slot_expires_at: string | null; reply_context_token: string | null; handoff_ticket_id: string | null; claimed_by: string | null; message_count: number; last_message_at: string; last_dispatch_at: string | null; created_at: string; updated_at: string; version: number };
export type MessageRecord = { message_id: string; session_id: string; channel: string; user_id: string; role: "user" | "bot" | "human" | "system"; content: string; created_at: string; actor_id: string | null; node_id: string | null; metadata: Record<string, string> };
export type NodeRecord = { node_id: string; base_url: string; advertised_address: string | null; lan_ip: string | null; max_concurrency: number; current_load: number; status: string; last_heartbeat_at: string; updated_at: string; last_error: string | null; load_ratio: number; node_version: string | null; platform: string | null; hostname: string | null; capabilities: string[]; channel_capacity: number; channel_in_use: number };
export type NodeKind = "local" | "remote";
export type NodeInventoryConnectionState = "connected" | "pairing_pending" | "register_failed" | "auth_failed" | "paired_offline" | "online_unpaired";
export type NodeInventoryRecord = { node_id: string; node_kind: NodeKind; paired: boolean; online: boolean; connection_state: NodeInventoryConnectionState; status: string | null; last_heartbeat_at: string | null; updated_at: string | null; hostname: string | null; lan_ip: string | null; platform: string | null; node_version: string | null; advertised_address: string | null; last_error: string | null; base_url: string | null; max_concurrency: number | null; current_load: number | null; channel_capacity: number | null; channel_in_use: number | null; last_pairing_trace_id: string | null; last_register_result: string | null; last_register_at: string | null; last_auth_failure_at: string | null };
export type NodeInventorySummary = { paired_total: number; online_total: number; offline_total: number };
export type NodeListResponse = { nodes: NodeRecord[]; inventory: NodeInventoryRecord[]; summary: NodeInventorySummary };
export type NodeDiagnosticsEvent = { timestamp: string; level: string; category: string; result: string; message: string; trace_id: string; metadata: Record<string, string> };
export type NodeDiagnosticsRecord = { node_id: string; node_kind: NodeKind; connection_state: NodeInventoryConnectionState; last_error: string; last_pairing_trace_id: string; last_pairing_status: string; last_pairing_at: string | null; last_register_result: string; last_register_at: string | null; last_heartbeat_result: string; last_heartbeat_at: string | null; last_auth_failure_at: string | null; last_auth_decision: string; last_auth_client_host: string; last_auth_path: string; expected_token_masked: string; provided_token_masked: string; timeline: NodeDiagnosticsEvent[] };
export type NodeDiagnosticsResponse = { node_id: string; diagnostics: NodeDiagnosticsRecord };
export type NodeDiagnosticsStreamEnvelope = { type: "diagnostics_snapshot"; node_id: string; diagnostics: NodeDiagnosticsRecord };
export type SessionsResponse = { sessions: SessionRecord[] };
export type SessionMessagesResponse = { session: SessionRecord; messages: MessageRecord[]; next_cursor: number; replace_messages: boolean; history_start: number | null; has_more_before: boolean | null };
export type SessionStreamEnvelope = SessionMessagesResponse & { type: "snapshot" | "messages_appended" };
export type SessionOverviewEnvelope = { type: "sessions_snapshot"; sessions: SessionRecord[] };
export type GatewaySummaryResponse = { system: SystemStatus; wechat: WeChatStatus; nodes: NodeListResponse };
export type GatewaySummaryEnvelope = { type: "gateway_summary"; summary: { system: SystemStatus; wechat: WeChatStatus; nodes: NodeListResponse } };
export type ConnectionTone = "good" | "warn";
export type ConnectionHeroCardData = { eyebrow: string; title: string; detail: string; tone: ConnectionTone };
export type ConnectionSignalCardData = { label: string; value: string; meta: string; tone: ConnectionTone };
export type ConnectionPrepItem = { label: string; detail: string; tone: ConnectionTone };
export type SessionMessageCacheEntry = {
  session: SessionRecord | null;
  messages: MessageRecord[];
  cursor: number;
  historyStart: number;
  hasMoreBefore: boolean;
  loaded: boolean;
  lastLoadedAt: number;
};
export type SessionSwitchRequest = { action: SessionSwitchAction; node_id?: string; reason: string };
export type SessionSwitchResponse = { ok: boolean; session: SessionRecord; detail: string };
export type QrStart = { qrcode: string; qrcode_url: string };
export type PollResponse = { status: string; token?: string; base_url?: string; message?: string; bot_id?: string; user_id?: string };
export type SetupRole = "gateway_host" | "gateway_host_console" | "worker_node" | "console_only";
export type SetupTaskStatus = "pending" | "running" | "succeeded" | "failed";
export type GatewaySetupConfig = { redis_url: string; default_agent_id: string; dify_base_url: string; dify_api_key: string; builtin_model_base_url: string; builtin_model_api_key: string; builtin_model_name: string; wechat_base_url: string; wechat_token: string; dispatch_mode_enabled: boolean };
export type WorkerNodeSetupConfig = { node_id: string; gateway_base_url: string; node_token: string; pairing_key: string; dify_base_url: string; dify_api_key: string; max_concurrency: number; install_dir: string; bundle_path: string; discovery_enabled: boolean; discovery_port: number };
export type ConsoleSetupConfig = { gateway_base_url: string };
export type PairingStatus = "pending" | "paired" | "paired_pending_confirm" | "register_failed" | "auth_failed" | "already_paired" | "offline";
export type DiscoveredNodeRecord = { discovery_id: string; node_id: string | null; pairing_label: string | null; hostname: string; lan_ip: string | null; platform: string | null; node_version: string | null; capabilities: string[]; advertised_address: string | null; pairing_required: boolean; already_paired: boolean; pairing_port: number; last_seen_at: string };
export type SetupTaskResult = { task_id: string; kind: "gateway_save" | "gateway_console_setup" | "node_install" | "console_connect" | "gateway_probe" | "discovery_scan" | "discovery_pair" | "manual_pair"; status: SetupTaskStatus; title: string; created_at: string; updated_at: string; summary: string; logs: string[]; metadata: Record<string, string> };
export type SetupProfileResponse = { recommended_workspace: "quick_setup" | "connection" | "sessions"; setup_completed: boolean; completed_roles: SetupRole[]; available_roles: SetupRole[]; preferred_gateway_base_url: string; gateway: GatewaySetupConfig; console: ConsoleSetupConfig; last_task: SetupTaskResult | null };
export type GatewaySetupSaveResponse = { task: SetupTaskResult; restart_required: boolean; applied_runtime: string[] };
export type GatewaySetupSaveRequest = { config: GatewaySetupConfig; console_gateway_base_url?: string };
export type GatewayConsoleSetupRequest = { gateway: GatewaySetupConfig; console: ConsoleSetupConfig };
export type GatewayProbeRequest = { gateway_base_url: string; node_id?: string; timeout_ms?: number };
export type NodeCredentialResetRequest = { node_id: string; install_dir: string };
export type SetupTaskEnvelope = { task: SetupTaskResult };
export type NodeDeleteResponse = { ok: boolean; node_id: string; removed_pairing: boolean; removed_runtime: boolean; detail: string };
export type DiscoveryScanResponse = { task: SetupTaskResult; nodes: DiscoveredNodeRecord[] };
export type DiscoveryPairResponse = { task: SetupTaskResult; pairing_status: PairingStatus; node_id: string | null };
export type ManualPairRequest = { host: string; pairing_port: number; pairing_key: string; gateway_base_url: string; node_id?: string };
export type LauncherState = "stopped" | "starting" | "running" | "degraded" | "failed";
export type LauncherRedisSource = "github" | "mirror";
export type LauncherNodeCachePolicy = "disabled" | "optional" | "enabled";
export type LauncherMachineRole = "gateway" | "node" | "console" | "gateway_console";
export type LauncherComponentStatus = { name: string; state: LauncherState; pid: number | null; detail: string; error_code: string; started_at: string | null; log_path: string | null };
export type LauncherProfile = { workdir: string; gateway_port: number; gateway_base_url?: string; launcher_port: number; host_redis_port: number; node_cache_redis_port: number; enable_local_node: boolean; enable_gateway: boolean; node_cache_policy: LauncherNodeCachePolicy; dispatch_mode_enabled: boolean; redis_source: LauncherRedisSource; node_cache_redis_source: LauncherRedisSource; bootstrap_completed: boolean; local_node_id: string };
export type LauncherRuntimeModel = { machine_role: LauncherMachineRole; gateway_should_run: boolean; host_redis_should_run: boolean; local_node_should_run: boolean; node_cache_should_run: boolean; runtime_authority: string };
export type LauncherWorkdirLayout = { root: string; host_redis_dir: string; transcript_dir: string; identity_dir: string; memory_dir: string; log_dir: string; runtime_dir: string; config_dir: string; node_cache_dir: string };
export type LauncherRedisInstallState = { installed: boolean; source: LauncherRedisSource; archive_path: string; executable_path: string; version: string; detail: string };
export type LauncherEnvironmentCheck = { name: string; ready: boolean; detail: string };
export type LauncherEnvironmentStatus = { ready: boolean; python_version: string; checks: LauncherEnvironmentCheck[] };
export type LauncherStatusResponse = { profile: LauncherProfile; runtime_model: LauncherRuntimeModel; layout: LauncherWorkdirLayout; host_redis: LauncherRedisInstallState; node_cache_redis: LauncherRedisInstallState; environment: LauncherEnvironmentStatus; components: LauncherComponentStatus[]; local_lan_ip: string };
export type LauncherStartRequest = { machine_role?: LauncherMachineRole; enable_local_node?: boolean; enable_gateway?: boolean; enable_node_cache_redis: boolean; dispatch_mode_enabled: boolean; redis_source: LauncherRedisSource; node_cache_redis_source: LauncherRedisSource; local_node_id?: string };
export type LauncherLogResponse = { component: string; log_path: string | null; content: string };
export type LocalNodeModelConfig = { model_provider: string; openai_base_url: string; openai_api_key: string; openai_model: string; openai_enable_thinking: boolean; openai_temperature: number; openai_top_p: number; openai_max_tokens: number; openai_seed: number; openai_thinking_budget: number; openai_stop: string; openai_enable_search: boolean; openai_search_forced: boolean; openai_search_strategy: string; openai_enable_search_extension: boolean; openai_multimodal_enabled: boolean; openai_api_key_configured: boolean; dify_base_url: string; dify_api_key: string; dify_api_key_configured: boolean };
export type LocalNodeModelConfigRequest = { model_provider: string; openai_base_url: string; openai_api_key: string; preserve_openai_api_key: boolean; clear_openai_api_key: boolean; openai_model: string; openai_enable_thinking: boolean; openai_temperature: number; openai_top_p: number; openai_max_tokens: number; openai_seed: number; openai_thinking_budget: number; openai_stop: string; openai_enable_search: boolean; openai_search_forced: boolean; openai_search_strategy: string; openai_enable_search_extension: boolean; openai_multimodal_enabled: boolean; dify_base_url: string; dify_api_key: string; preserve_dify_api_key: boolean; clear_dify_api_key: boolean; restart_service: boolean };
export type LocalNodeConfigApplyState = "idle" | "saving" | "restarting" | "applied" | "failed";
export type LocalNodeStatusResponse = { service_name: string; state: string; pid: number | null; node_kind: NodeKind; config_path: string; diagnostics_path: string; install_dir: string; detail: string; service_state: string; runtime_state: string; last_register_result: string; last_register_error: string; last_register_at: string | null; config_apply_state: LocalNodeConfigApplyState; last_apply_error: string; last_apply_at: string | null; configured_model_provider: string; active_model_provider: string; inference_ready: boolean; inference_detail: string; diagnostics: Record<string, unknown>; model_settings: LocalNodeModelConfig };
export type LocalNodeLogsResponse = { service_name: string; event_log_path: string | null; service_log_path: string | null; wrapper_log_path: string | null; event_log: string; service_log: string; wrapper_log: string };
export type LocalNodeActionResponse = { ok: boolean; detail: string; status: LocalNodeStatusResponse };
export type LocalNodeExportResponse = { ok: boolean; export_path: string; detail: string };
export type WorkspaceTab = "quick_setup" | "sessions" | "connection" | "logs";
export type SessionFilter = "all" | "processing" | "human" | "recent";
export type SetupMode = "status" | "role" | "config" | "preview" | "result";
export type LauncherComponentName = "host-redis" | "gateway" | "local-node" | "node-cache-redis";
export type ManualPairDraft = { host: string; pairing_port: number; pairing_key: string; node_id: string };
export type PairingDebugEntry = {
  id: string;
  kind: "discovery_scan" | "discovery_pair" | "manual_pair" | "gateway_probe" | "node_install" | "client_error";
  title: string;
  status: SetupTaskStatus | "failed";
  summary: string;
  logs: string[];
  target: string;
  updated_at: string;
};
export type WorkerGatewayConnectionState =
  | "idle"
  | "gateway_unreachable"
  | "gateway_reachable_node_missing"
  | "gateway_reachable_node_pending_confirm"
  | "gateway_reachable_node_register_failed"
  | "gateway_reachable_node_connected";

export type AppUiStateCache = {
  workspace: WorkspaceTab | null;
  selected_session_id: string | null;
  selected_node_id: string | null;
};

export type AppSummaryStateCache = {
  system_status: SystemStatus | null;
  wechat_status: WeChatStatus | null;
  node_list: NodeListResponse | null;
  sessions: SessionRecord[];
};
