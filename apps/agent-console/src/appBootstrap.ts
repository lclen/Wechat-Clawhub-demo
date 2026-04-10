import type {
  GatewaySummaryResponse,
  LocalNodeModelConfigRequest,
  LocalNodeStatusResponse,
  NodeListResponse,
  SetupProfileResponse,
  SystemStatus,
  WeChatStatus,
} from "./types";

export function buildLocalNodeModelDraftFromStatus(status: LocalNodeStatusResponse | null): LocalNodeModelConfigRequest {
  return {
    model_provider: status?.model_settings?.model_provider || "auto",
    openai_base_url: status?.model_settings?.openai_base_url || "",
    openai_api_key: status?.model_settings?.openai_api_key || "",
    preserve_openai_api_key: false,
    clear_openai_api_key: false,
    openai_model: status?.model_settings?.openai_model || "",
    openai_enable_thinking: Boolean(status?.model_settings?.openai_enable_thinking),
    openai_temperature: Number(status?.model_settings?.openai_temperature ?? 0.3),
    openai_top_p: Number(status?.model_settings?.openai_top_p ?? 1),
    openai_max_tokens: Number(status?.model_settings?.openai_max_tokens ?? 0),
    openai_seed: Number(status?.model_settings?.openai_seed ?? 0),
    openai_thinking_budget: Number(status?.model_settings?.openai_thinking_budget ?? 0),
    openai_stop: status?.model_settings?.openai_stop || "",
    openai_enable_search: Boolean(status?.model_settings?.openai_enable_search),
    openai_search_forced: Boolean(status?.model_settings?.openai_search_forced),
    openai_search_strategy: status?.model_settings?.openai_search_strategy || "turbo",
    openai_enable_search_extension: Boolean(status?.model_settings?.openai_enable_search_extension),
    openai_multimodal_enabled: status?.model_settings?.openai_multimodal_enabled !== false,
    dify_base_url: status?.model_settings?.dify_base_url || "",
    dify_api_key: status?.model_settings?.dify_api_key || "",
    preserve_dify_api_key: false,
    clear_dify_api_key: false,
    restart_service: true,
  };
}

export function resolvePreferredGatewayBaseUrl(
  profile?: Pick<SetupProfileResponse, "preferred_gateway_base_url" | "console"> | null,
  system?: Pick<SystemStatus, "preferred_gateway_base_url"> | null,
): string {
  return profile?.preferred_gateway_base_url || profile?.console.gateway_base_url || system?.preferred_gateway_base_url || window.location.origin;
}

export function applyGatewaySummaryToState(
  summary: GatewaySummaryResponse,
  handlers: {
    setSystemStatus: (next: SystemStatus) => void;
    setWechatStatus: (next: WeChatStatus) => void;
    setWechatBaseUrl: (next: string) => void;
    syncNodeStateView: (next: NodeListResponse, options?: { selectNode?: boolean }) => void;
  },
) {
  handlers.setSystemStatus(summary.system);
  handlers.setWechatStatus(summary.wechat);
  handlers.setWechatBaseUrl(summary.wechat.base_url || summary.system.preferred_gateway_base_url || window.location.origin);
  handlers.syncNodeStateView(summary.nodes);
}
