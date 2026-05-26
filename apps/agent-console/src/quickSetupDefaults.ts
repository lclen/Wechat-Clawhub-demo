import type {
  ConsoleSetupConfig,
  GatewaySetupConfig,
  LocalNodeModelConfigRequest,
  ManualPairDraft,
  SessionFilter,
  SetupRole,
  WorkerNodeSetupConfig,
} from "./types";

export const SETUP_DRAFT_KEY = "wechat-claw-hub.quick-setup.draft";
export const UI_STATE_CACHE_KEY = "wechat-claw-hub.ui-state";
export const SUMMARY_STATE_CACHE_KEY = "wechat-claw-hub.summary-state";

export const FILTERS: { key: SessionFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "processing", label: "处理中" },
  { key: "human", label: "人工中" },
  { key: "recent", label: "最近活跃" },
];

// 开源版本仅支持 gateway_host 和 gateway_host_console 角色
// worker_node 和 console_only 为商业版功能
export const DEFAULT_SETUP_ROLES: SetupRole[] = ["gateway_host", "gateway_host_console"];
export const DEFAULT_REMOTE_WORKER_NODE_ID = "claw-node-1";
export const LEGACY_WORKER_NODE_IDS = new Set(["claw-node-local-1"]);

export const DEFAULT_GATEWAY_SETUP: GatewaySetupConfig = {
  redis_url: "redis://localhost:6379/0",
  default_agent_id: "default-agent",
  public_entry_enabled: false,
  public_entry_base_url: "",
  public_entry_display_name: "",
  public_entry_qr_url: "",
  public_entry_contact_hint: "",
  public_entry_notes: "",
  public_entry_greeting_message: "你好，已成功连接到专属 Claw。你可以直接发送问题，我会在这里回复你。",
  dify_base_url: "",
  dify_api_key: "",
  builtin_model_base_url: "",
  builtin_model_api_key: "",
  builtin_model_name: "",
  builtin_model_enable_thinking: false,
  builtin_model_temperature: 0.3,
  builtin_model_top_p: 1,
  builtin_model_max_tokens: 0,
  builtin_model_seed: 0,
  builtin_model_thinking_budget: 0,
  builtin_model_stop: "",
  builtin_model_enable_search: false,
  builtin_model_search_forced: false,
  builtin_model_search_strategy: "turbo",
  builtin_model_enable_search_extension: false,
  builtin_model_multimodal_enabled: true,
  wechat_base_url: "https://ilinkai.weixin.qq.com",
  wechat_token: "",
  dispatch_mode_enabled: false,
};

export const DEFAULT_WORKER_SETUP: WorkerNodeSetupConfig = {
  node_id: DEFAULT_REMOTE_WORKER_NODE_ID,
  gateway_base_url: "",
  node_token: "",
  pairing_key: "",
  dify_base_url: "",
  dify_api_key: "",
  openai_base_url: "",
  openai_api_key: "",
  openai_model: "",
  openai_enable_thinking: false,
  openai_temperature: 0.3,
  openai_top_p: 1,
  openai_max_tokens: 0,
  openai_seed: 0,
  openai_thinking_budget: 0,
  openai_stop: "",
  openai_enable_search: false,
  openai_search_forced: false,
  openai_search_strategy: "turbo",
  openai_enable_search_extension: false,
  openai_multimodal_enabled: true,
  max_concurrency: 1,
  install_dir: "C:\\wechat-claw-node",
  bundle_path: "",
  discovery_enabled: true,
  discovery_port: 9531,
};

export const DEFAULT_CONSOLE_SETUP: ConsoleSetupConfig = {
  gateway_base_url: "",
};

export const DEFAULT_MANUAL_PAIR: ManualPairDraft = {
  host: "",
  pairing_port: 9532,
  pairing_key: "",
  node_id: "",
};

export const DEFAULT_LOCAL_NODE_MODEL_CONFIG: LocalNodeModelConfigRequest = {
  model_provider: "auto",
  openai_base_url: "",
  openai_api_key: "",
  preserve_openai_api_key: false,
  clear_openai_api_key: false,
  openai_model: "",
  openai_enable_thinking: false,
  openai_temperature: 0.3,
  openai_top_p: 1,
  openai_max_tokens: 0,
  openai_seed: 0,
  openai_thinking_budget: 0,
  openai_stop: "",
  openai_enable_search: false,
  openai_search_forced: false,
  openai_search_strategy: "turbo",
  openai_enable_search_extension: false,
  openai_multimodal_enabled: true,
  dify_base_url: "",
  dify_api_key: "",
  preserve_dify_api_key: false,
  clear_dify_api_key: false,
  restart_service: true,
};

export const DEFAULT_BUILTIN_MODEL_LABEL = "DashScope（阿里云通义千问，默认 qwen3.5-plus）";
export const GATEWAY_NODE_TOKEN_LOCATION = "apps/gateway/.env → WCH_NODE_TOKENS";
