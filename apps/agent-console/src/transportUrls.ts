export function buildSessionWebSocketUrl(sessionId: string, remoteGateway?: string | null) {
  const baseUrl = remoteGateway?.trim() || window.location.origin;
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/api/sessions/${encodeURIComponent(sessionId)}/ws`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildSessionOverviewWebSocketUrl(remoteGateway?: string | null) {
  const baseUrl = remoteGateway?.trim() || window.location.origin;
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/sessions/overview/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildNodeDiagnosticsWebSocketUrl(nodeId: string, remoteGateway?: string | null) {
  const baseUrl = remoteGateway?.trim() || window.location.origin;
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/api/nodes/${encodeURIComponent(nodeId)}/diagnostics/ws`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildGatewaySummaryWebSocketUrl(remoteGateway?: string | null) {
  const baseUrl = remoteGateway?.trim() || window.location.origin;
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/system/summary/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}
