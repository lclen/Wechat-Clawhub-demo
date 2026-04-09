import { clearPersistedWorkspace, loadPersistedWorkspace } from "./roleWorkspace";
import {
  DEFAULT_CONSOLE_SETUP,
  DEFAULT_GATEWAY_SETUP,
  DEFAULT_WORKER_SETUP,
  SETUP_DRAFT_KEY,
  SUMMARY_STATE_CACHE_KEY,
  UI_STATE_CACHE_KEY,
} from "./quickSetupDefaults";
import type {
  AppSummaryStateCache,
  AppUiStateCache,
  ConsoleSetupConfig,
  GatewaySetupConfig,
  SetupRole,
  WorkerNodeSetupConfig,
} from "./types";

export function loadSetupDraft() {
  const emptyDraft = {
    role: null as SetupRole | null,
    gateway: DEFAULT_GATEWAY_SETUP,
    worker: DEFAULT_WORKER_SETUP,
    console: DEFAULT_CONSOLE_SETUP,
  };
  if (typeof window === "undefined") return emptyDraft;
  try {
    const raw = window.localStorage.getItem(SETUP_DRAFT_KEY);
    if (!raw) return emptyDraft;
    const parsed = JSON.parse(raw) as {
      role?: SetupRole;
      gateway?: GatewaySetupConfig;
      worker?: WorkerNodeSetupConfig;
      console?: ConsoleSetupConfig;
    };
    return {
      role: null,
      gateway: { ...DEFAULT_GATEWAY_SETUP, ...(parsed.gateway ?? {}) },
      worker: { ...DEFAULT_WORKER_SETUP, ...(parsed.worker ?? {}), node_token: "" },
      console: { ...DEFAULT_CONSOLE_SETUP, ...(parsed.console ?? {}) },
    };
  } catch {
    return emptyDraft;
  }
}

export function clearQuickSetupCache() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SETUP_DRAFT_KEY);
  window.localStorage.removeItem(SUMMARY_STATE_CACHE_KEY);
  clearPersistedWorkspace();
  window.localStorage.removeItem(UI_STATE_CACHE_KEY);
}

export function loadUiStateCache(): AppUiStateCache {
  if (typeof window === "undefined") {
    return { workspace: null, selected_session_id: null, selected_node_id: null };
  }
  try {
    const raw = window.localStorage.getItem(UI_STATE_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<AppUiStateCache> : {};
    const workspace =
      parsed.workspace === "quick_setup" || parsed.workspace === "sessions" || parsed.workspace === "connection" || parsed.workspace === "logs"
        ? parsed.workspace
        : loadPersistedWorkspace();
    return {
      workspace,
      selected_session_id: typeof parsed.selected_session_id === "string" ? parsed.selected_session_id : null,
      selected_node_id: null,
    };
  } catch {
    return {
      workspace: loadPersistedWorkspace(),
      selected_session_id: null,
      selected_node_id: null,
    };
  }
}

export function loadSummaryStateCache(): AppSummaryStateCache {
  if (typeof window === "undefined") {
    return { system_status: null, wechat_status: null, node_list: null, sessions: [] };
  }
  try {
    const raw = window.localStorage.getItem(SUMMARY_STATE_CACHE_KEY);
    if (!raw) return { system_status: null, wechat_status: null, node_list: null, sessions: [] };
    const parsed = JSON.parse(raw) as Partial<AppSummaryStateCache>;
    return {
      system_status: parsed.system_status ?? null,
      wechat_status: parsed.wechat_status ?? null,
      node_list: parsed.node_list ?? null,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {
    return { system_status: null, wechat_status: null, node_list: null, sessions: [] };
  }
}
