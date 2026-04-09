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

export const DEFAULT_SETUP_ROLES: SetupRole[] = ["gateway_host", "gateway_host_console", "worker_node", "console_only"];

export const DEFAULT_GATEWAY_SETUP: GatewaySetupConfig = {
  redis_url: "redis://localhost:6379/0",
  default_agent_id: "default-agent",
  dify_base_url: "",
  dify_api_key: "",
  builtin_model_base_url: "",
  builtin_model_api_key: "",
  builtin_model_name: "",
  wechat_base_url: "https://ilinkai.weixin.qq.com",
  wechat_token: "",
  dispatch_mode_enabled: false,
};

export const DEFAULT_WORKER_SETUP: WorkerNodeSetupConfig = {
  node_id: "claw-node-local-1",
  gateway_base_url: "",
  node_token: "",
  pairing_key: "",
  dify_base_url: "",
  dify_api_key: "",
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

export const DEFAULT_BUILTIN_MODEL_LABEL = "DashScope OpenAI Compatible（默认 qwen3.5-plus）";
export const GATEWAY_NODE_TOKEN_LOCATION = "apps/gateway/.env → WCH_NODE_TOKENS";
