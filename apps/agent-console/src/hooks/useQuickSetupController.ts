import { useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { persistWorkspace, requiresRoleSwitchConfirmation } from "../roleWorkspace";
import { clearQuickSetupCache } from "../appStorage";
import { resolvePreferredGatewayBaseUrl } from "../appBootstrap";
import {
  DEFAULT_CONSOLE_SETUP,
  DEFAULT_GATEWAY_SETUP,
  DEFAULT_MANUAL_PAIR,
  DEFAULT_WORKER_SETUP,
} from "../quickSetupDefaults";
import { resolveWorkerGatewayBaseUrl, resolveWorkerNodeId } from "../selectors/quickSetupSelectors";
import { hasText, safeTrim } from "../stringUtils";
import type {
  ConsoleSetupConfig,
  DiscoveredNodeRecord,
  GatewaySetupConfig,
  LauncherStatusResponse,
  ManualPairDraft,
  PairingDebugEntry,
  PairingStatus,
  SetupMode,
  SetupProfileResponse,
  SetupRole,
  SetupTaskResult,
  SystemStatus,
  WorkerNodeSetupConfig,
} from "../types";

type QuickSetupDraft = {
  role: SetupRole | null;
  gateway: GatewaySetupConfig;
  worker: WorkerNodeSetupConfig;
  console: ConsoleSetupConfig;
};

type QuickSetupControllerOptions = {
  initialDraft: QuickSetupDraft;
  systemStatus: SystemStatus | null;
  launcherStatus: LauncherStatusResponse | null;
  onRoleSelected?: (role: SetupRole) => void;
  onDraftReset?: () => void;
};

type SyncSetupProfileOptions = {
  syncLastTask?: boolean;
  system?: SystemStatus | null;
};

export type QuickSetupControllerState = {
  setupProfile: SetupProfileResponse | null;
  setupRole: SetupRole | null;
  setupMode: SetupMode;
  gatewaySetup: GatewaySetupConfig;
  workerSetup: WorkerNodeSetupConfig;
  consoleSetup: ConsoleSetupConfig;
  setupTask: SetupTaskResult | null;
  discoveredNodes: DiscoveredNodeRecord[];
  pairingSecrets: Record<string, string>;
  pairingStatuses: Record<string, PairingStatus>;
  manualPair: ManualPairDraft;
  pairingDebugEntries: PairingDebugEntry[];
  pairingModalTaskId: string | null;
  pairingModalTask: SetupTaskResult | null;
  pairingModalStartedAt: number;
  reconfigureConfirmOpen: boolean;
  workerGatewayProbeTask: SetupTaskResult | null;
  workerPairingKeyVisible: boolean;
  workerModelExpanded: boolean;
  pairingModalTimerRef: MutableRefObject<number | null>;
};

export type QuickSetupControllerActions = {
  setSetupProfile: Dispatch<SetStateAction<SetupProfileResponse | null>>;
  setSetupRole: Dispatch<SetStateAction<SetupRole | null>>;
  setSetupMode: Dispatch<SetStateAction<SetupMode>>;
  setGatewaySetup: Dispatch<SetStateAction<GatewaySetupConfig>>;
  setWorkerSetup: Dispatch<SetStateAction<WorkerNodeSetupConfig>>;
  setConsoleSetup: Dispatch<SetStateAction<ConsoleSetupConfig>>;
  setSetupTask: Dispatch<SetStateAction<SetupTaskResult | null>>;
  setDiscoveredNodes: Dispatch<SetStateAction<DiscoveredNodeRecord[]>>;
  setPairingSecrets: Dispatch<SetStateAction<Record<string, string>>>;
  setPairingStatuses: Dispatch<SetStateAction<Record<string, PairingStatus>>>;
  setManualPair: Dispatch<SetStateAction<ManualPairDraft>>;
  setPairingDebugEntries: Dispatch<SetStateAction<PairingDebugEntry[]>>;
  setPairingModalTaskId: Dispatch<SetStateAction<string | null>>;
  setPairingModalTask: Dispatch<SetStateAction<SetupTaskResult | null>>;
  setPairingModalStartedAt: Dispatch<SetStateAction<number>>;
  setReconfigureConfirmOpen: Dispatch<SetStateAction<boolean>>;
  setWorkerGatewayProbeTask: Dispatch<SetStateAction<SetupTaskResult | null>>;
  setWorkerPairingKeyVisible: Dispatch<SetStateAction<boolean>>;
  setWorkerModelExpanded: Dispatch<SetStateAction<boolean>>;
  toggleReconfigureConfirm: () => void;
  toggleWorkerPairingKeyVisible: () => void;
  toggleWorkerModelExpanded: () => void;
  backToConfig: () => void;
  advanceToPreview: () => void;
  clearPairingDebugEntries: () => void;
  selectSetupRole: (role: SetupRole) => void;
  returnToSetupStatus: () => void;
  resetCurrentSetupDraft: () => void;
  syncSetupProfileState: (
    profile: SetupProfileResponse,
    preferredGatewayBaseUrl: string,
    options?: SyncSetupProfileOptions,
  ) => void;
  updateGatewaySetup: <K extends keyof GatewaySetupConfig>(key: K, value: GatewaySetupConfig[K]) => void;
  updateWorkerSetup: <K extends keyof WorkerNodeSetupConfig>(key: K, value: WorkerNodeSetupConfig[K]) => void;
  updateConsoleSetup: <K extends keyof ConsoleSetupConfig>(key: K, value: ConsoleSetupConfig[K]) => void;
  updateManualPair: <K extends keyof ManualPairDraft>(key: K, value: ManualPairDraft[K]) => void;
  updatePairingSecret: (discoveryId: string, value: string) => void;
  clearAndReselectRole: () => void;
};

export function useQuickSetupController(options: QuickSetupControllerOptions) {
  const { initialDraft, systemStatus, launcherStatus, onRoleSelected, onDraftReset } = options;

  const [setupProfile, setSetupProfile] = useState<SetupProfileResponse | null>(null);
  const [setupRole, setSetupRole] = useState<SetupRole | null>(initialDraft.role);
  const [setupMode, setSetupMode] = useState<SetupMode>("role");
  const [gatewaySetup, setGatewaySetup] = useState<GatewaySetupConfig>(initialDraft.gateway);
  const [workerSetup, setWorkerSetup] = useState<WorkerNodeSetupConfig>(initialDraft.worker);
  const [consoleSetup, setConsoleSetup] = useState<ConsoleSetupConfig>(initialDraft.console);
  const [setupTask, setSetupTask] = useState<SetupTaskResult | null>(null);
  const [discoveredNodes, setDiscoveredNodes] = useState<DiscoveredNodeRecord[]>([]);
  const [pairingSecrets, setPairingSecrets] = useState<Record<string, string>>({});
  const [pairingStatuses, setPairingStatuses] = useState<Record<string, PairingStatus>>({});
  const [manualPair, setManualPair] = useState<ManualPairDraft>(DEFAULT_MANUAL_PAIR);
  const [pairingDebugEntries, setPairingDebugEntries] = useState<PairingDebugEntry[]>([]);
  const [pairingModalTaskId, setPairingModalTaskId] = useState<string | null>(null);
  const [pairingModalTask, setPairingModalTask] = useState<SetupTaskResult | null>(null);
  const [pairingModalStartedAt, setPairingModalStartedAt] = useState<number>(0);
  const pairingModalTimerRef = useRef<number | null>(null);
  const [reconfigureConfirmOpen, setReconfigureConfirmOpen] = useState(false);
  const [workerGatewayProbeTask, setWorkerGatewayProbeTask] = useState<SetupTaskResult | null>(null);
  const [workerPairingKeyVisible, setWorkerPairingKeyVisible] = useState(false);
  const [workerModelExpanded, setWorkerModelExpanded] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(
      "wechat-claw-hub.quick-setup.draft",
      JSON.stringify({
        gateway: gatewaySetup,
        worker: workerSetup,
        console: consoleSetup,
      }),
    );
  }, [gatewaySetup, workerSetup, consoleSetup]);

  useEffect(() => {
    if (!hasText(workerSetup.pairing_key)) return;
    setManualPair((current) => (hasText(current.pairing_key) ? current : { ...current, pairing_key: safeTrim(workerSetup.pairing_key) }));
  }, [workerSetup.pairing_key]);

  function selectSetupRole(role: SetupRole) {
    const completedRoles = setupProfile?.completed_roles ?? [];
    if (requiresRoleSwitchConfirmation(completedRoles, role)) {
      setReconfigureConfirmOpen(true);
      return;
    }
    setSetupRole(role);
    setSetupMode("config");
    setSetupTask(null);
    setReconfigureConfirmOpen(false);
    onRoleSelected?.(role);
  }

  function returnToSetupStatus() {
    setSetupRole(null);
    setSetupTask(null);
    setReconfigureConfirmOpen(false);
    setSetupMode(setupProfile?.setup_completed ? "status" : "role");
  }

  function resetCurrentSetupDraft() {
    const preferredGatewayBaseUrl = resolvePreferredGatewayBaseUrl(setupProfile, systemStatus);
    setGatewaySetup(setupProfile?.gateway ?? DEFAULT_GATEWAY_SETUP);
    setConsoleSetup(
      setupProfile?.console
        ? { ...setupProfile.console, gateway_base_url: setupProfile.console.gateway_base_url || preferredGatewayBaseUrl }
        : { ...DEFAULT_CONSOLE_SETUP, gateway_base_url: preferredGatewayBaseUrl },
    );
    setWorkerSetup((current) => ({
      ...DEFAULT_WORKER_SETUP,
      ...current,
      node_id: resolveWorkerNodeId(current.node_id, launcherStatus?.profile),
      gateway_base_url: setupProfile?.console.gateway_base_url || preferredGatewayBaseUrl,
      dify_base_url: setupProfile?.gateway.dify_base_url || DEFAULT_WORKER_SETUP.dify_base_url,
      dify_api_key: setupProfile?.gateway.dify_api_key || DEFAULT_WORKER_SETUP.dify_api_key,
      node_token: "",
    }));
    setDiscoveredNodes([]);
    setPairingSecrets({});
    setPairingStatuses({});
    setManualPair((current) => ({ ...DEFAULT_MANUAL_PAIR, pairing_key: current.pairing_key || workerSetup.pairing_key || "" }));
    setSetupTask(null);
    setWorkerGatewayProbeTask(null);
    onDraftReset?.();
  }

  function syncSetupProfileState(
    profile: SetupProfileResponse,
    preferredGatewayBaseUrl: string,
    syncOptions?: SyncSetupProfileOptions,
  ) {
    setSetupProfile(profile);
    if (syncOptions?.syncLastTask) {
      setSetupTask(profile.last_task);
    }
    setWorkerGatewayProbeTask(profile.last_task?.kind === "gateway_probe" ? profile.last_task : null);
    setGatewaySetup(profile.gateway);
    setConsoleSetup({ ...profile.console, gateway_base_url: profile.console.gateway_base_url || preferredGatewayBaseUrl });
    setWorkerSetup((current) => ({
      ...current,
      node_id: resolveWorkerNodeId(current.node_id, launcherStatus?.profile),
      gateway_base_url: resolveWorkerGatewayBaseUrl(current.gateway_base_url, profile, syncOptions?.system ?? systemStatus),
      dify_base_url: profile.gateway.dify_base_url || current.dify_base_url,
      dify_api_key: profile.gateway.dify_api_key || current.dify_api_key,
      node_token: "",
    }));
  }

  function updateGatewaySetup<K extends keyof GatewaySetupConfig>(key: K, value: GatewaySetupConfig[K]) {
    setGatewaySetup((current) => ({ ...current, [key]: value }));
  }

  function updateWorkerSetup<K extends keyof WorkerNodeSetupConfig>(key: K, value: WorkerNodeSetupConfig[K]) {
    setWorkerSetup((current) => ({ ...current, [key]: value }));
  }

  function updateConsoleSetup<K extends keyof ConsoleSetupConfig>(key: K, value: ConsoleSetupConfig[K]) {
    setConsoleSetup((current) => ({ ...current, [key]: value }));
  }

  function updateManualPair<K extends keyof ManualPairDraft>(key: K, value: ManualPairDraft[K]) {
    setManualPair((current) => ({ ...current, [key]: value }));
  }

  function updatePairingSecret(discoveryId: string, value: string) {
    setPairingSecrets((current) => ({ ...current, [discoveryId]: value }));
  }

  function toggleReconfigureConfirm() {
    setReconfigureConfirmOpen((current) => !current);
  }

  function toggleWorkerPairingKeyVisible() {
    setWorkerPairingKeyVisible((current) => !current);
  }

  function toggleWorkerModelExpanded() {
    setWorkerModelExpanded((current) => !current);
  }

  function backToConfig() {
    setSetupMode("config");
  }

  function advanceToPreview() {
    setSetupMode("preview");
  }

  function clearPairingDebugEntries() {
    setPairingDebugEntries([]);
  }

  function clearAndReselectRole() {
    clearQuickSetupCache();
    persistWorkspace("quick_setup");
    setSetupRole(null);
    setSetupTask(null);
    setSetupMode("role");
  }

  return {
    state: {
      setupProfile,
      setupRole,
      setupMode,
      gatewaySetup,
      workerSetup,
      consoleSetup,
      setupTask,
      discoveredNodes,
      pairingSecrets,
      pairingStatuses,
      manualPair,
      pairingDebugEntries,
      pairingModalTaskId,
      pairingModalTask,
      pairingModalStartedAt,
      reconfigureConfirmOpen,
      workerGatewayProbeTask,
      workerPairingKeyVisible,
      workerModelExpanded,
      pairingModalTimerRef,
    } satisfies QuickSetupControllerState,
    actions: {
      setSetupProfile,
      setSetupRole,
      setSetupMode,
      setGatewaySetup,
      setWorkerSetup,
      setConsoleSetup,
      setSetupTask,
      setDiscoveredNodes,
      setPairingSecrets,
      setPairingStatuses,
      setManualPair,
      setPairingDebugEntries,
      setPairingModalTaskId,
      setPairingModalTask,
      setPairingModalStartedAt,
      setReconfigureConfirmOpen,
      setWorkerGatewayProbeTask,
      setWorkerPairingKeyVisible,
      setWorkerModelExpanded,
      toggleReconfigureConfirm,
      toggleWorkerPairingKeyVisible,
      toggleWorkerModelExpanded,
      backToConfig,
      advanceToPreview,
      clearPairingDebugEntries,
      selectSetupRole,
      returnToSetupStatus,
      resetCurrentSetupDraft,
      syncSetupProfileState,
      updateGatewaySetup,
      updateWorkerSetup,
      updateConsoleSetup,
      updateManualPair,
      updatePairingSecret,
      clearAndReselectRole,
    } satisfies QuickSetupControllerActions,
  };
}
