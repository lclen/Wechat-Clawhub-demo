export const DASHSCOPE_PROVIDER_LABEL = "DashScope";
export const DASHSCOPE_PROVIDER_HEADLINE = "DashScope（阿里云通义千问）";
export const DASHSCOPE_ONLY_NOTICE = "当前仅支持阿里云 DashScope / 通义千问模型。";
export const DASHSCOPE_BASE_URL_PLACEHOLDER = "https://dashscope.aliyuncs.com/compatible-mode/v1";
export const DASHSCOPE_MODEL_PLACEHOLDER = "qwen3.5-plus / qwen-plus / qwen-max";
export const DASHSCOPE_DEFAULT_MODEL_LABEL = "DashScope（阿里云通义千问，默认 qwen3.5-plus）";

export function formatModelProviderLabel(value: string | null | undefined): string {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "openai" || normalized === "openai_compatible") return DASHSCOPE_PROVIDER_LABEL;
  if (normalized === "dify") return "Dify";
  if (normalized === "auto") return "自动";
  return value?.trim() || "";
}
