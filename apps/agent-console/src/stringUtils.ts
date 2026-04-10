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
