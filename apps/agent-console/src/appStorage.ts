import { clearPersistedWorkspace, loadPersistedWorkspace } from "./roleWorkspace";
import {
  DEFAULT_CONSOLE_SETUP,
  DEFAULT_GATEWAY_SETUP,
  DEFAULT_REMOTE_WORKER_NODE_ID,
  DEFAULT_WORKER_SETUP,
  LEGACY_WORKER_NODE_IDS,
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

function stripNullableValues<T extends Record<string, unknown>>(value: T | undefined): Partial<T> {
  if (!value) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null),
  ) as Partial<T>;
}

function normalizeStoredWorkerNodeId(nodeId: string | undefined) {
  const trimmed = String(nodeId || "").trim();
  if (LEGACY_WORKER_NODE_IDS.has(trimmed)) {
    return DEFAULT_REMOTE_WORKER_NODE_ID;
  }
  return trimmed;
}

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
      gateway: { ...DEFAULT_GATEWAY_SETUP, ...stripNullableValues(parsed.gateway) },
      worker: {
        ...DEFAULT_WORKER_SETUP,
        ...stripNullableValues(parsed.worker),
        node_id: normalizeStoredWorkerNodeId(parsed.worker?.node_id) || DEFAULT_WORKER_SETUP.node_id,
        node_token: "",
      },
      console: { ...DEFAULT_CONSOLE_SETUP, ...stripNullableValues(parsed.console) },
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
    return { workspace: null, selected_session_id: null, selected_node_id: null, session_scroll: null };
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
      session_scroll:
        parsed.session_scroll &&
        typeof parsed.session_scroll.session_id === "string" &&
        typeof parsed.session_scroll.scroll_top === "number" &&
        typeof parsed.session_scroll.offset_from_bottom === "number"
          ? {
              session_id: parsed.session_scroll.session_id,
              scroll_top: parsed.session_scroll.scroll_top,
              offset_from_bottom: parsed.session_scroll.offset_from_bottom,
              follow_bottom: Boolean(parsed.session_scroll.follow_bottom),
            }
          : null,
    };
  } catch {
    return {
      workspace: loadPersistedWorkspace(),
      selected_session_id: null,
      selected_node_id: null,
      session_scroll: null,
    };
  }
}

export function saveUiStateCache(patch: Partial<AppUiStateCache>) {
  if (typeof window === "undefined") return;
  try {
    const current = loadUiStateCache();
    const nextPatch = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as Partial<AppUiStateCache>;
    window.localStorage.setItem(
      UI_STATE_CACHE_KEY,
      JSON.stringify({
        ...current,
        ...nextPatch,
      } satisfies AppUiStateCache),
    );
  } catch {
    // ui state cache is best-effort
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
