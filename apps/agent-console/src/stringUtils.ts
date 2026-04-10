export function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

export function safeTrim(value: unknown): string {
  return asString(value).trim();
}

export function hasText(value: unknown): boolean {
  return safeTrim(value).length > 0;
}

export function formatModelProviderLabel(value: unknown): string {
  const normalized = safeTrim(value).toLowerCase();
  if (!normalized) return "";
  if (normalized === "openai" || normalized === "openai_compatible") return "DashScope";
  if (normalized === "dify") return "Dify";
  if (normalized === "auto") return "自动";
  return safeTrim(value);
}
