import type { SetupRole, WorkspaceTab } from "./types";

export type RoleWorkspaceCapability = {
  visible: boolean;
  primary?: boolean;
  priority: number;
};

export type RoleActionCapabilities = {
  canManageGateway: boolean;
  canManageWeChat: boolean;
  canManageNodes: boolean;
  canManageLocalNode: boolean;
  canBindSessions: boolean;
  canRunConversationTest: boolean;
  canViewLogs: boolean;
  canEditQuickSetup: boolean;
};

export type RoleSectionCapabilities = {
  showGatewayOverview: boolean;
  showWeChatAccess: boolean;
  showRemoteNodeInventory: boolean;
  showLocalNodePanel: boolean;
  showSessionConsole: boolean;
  showSessionInspector: boolean;
  showConversationTest: boolean;
  showLauncherRuntime: boolean;
};

export type RoleCapabilities = {
  role: SetupRole | null;
  variant: "gateway" | "worker" | "console" | "unknown";
  primaryWorkspace: WorkspaceTab;
  workspace: Record<WorkspaceTab, RoleWorkspaceCapability>;
  actions: RoleActionCapabilities;
  sections: RoleSectionCapabilities;
};

export type WorkspacePresentation = {
  label: string;
  kicker: string;
  description: string;
  heroTitle: string;
  heroDescription: string;
  primaryActionLabel?: string;
};

const FULL_WORKSPACE_SET: Record<WorkspaceTab, RoleWorkspaceCapability> = {
  quick_setup: { visible: true, priority: 10 },
  sessions: { visible: true, priority: 20 },
  connection: { visible: true, priority: 30 },
  conversation_test: { visible: true, priority: 40 },
  logs: { visible: true, priority: 50 },
};

function withPrimaryWorkspace(
  primaryWorkspace: WorkspaceTab,
  overrides?: Partial<Record<WorkspaceTab, Partial<RoleWorkspaceCapability>>>,
): Record<WorkspaceTab, RoleWorkspaceCapability> {
  return {
    quick_setup: {
      ...FULL_WORKSPACE_SET.quick_setup,
      ...(overrides?.quick_setup ?? {}),
      primary: primaryWorkspace === "quick_setup",
    },
    sessions: {
      ...FULL_WORKSPACE_SET.sessions,
      ...(overrides?.sessions ?? {}),
      primary: primaryWorkspace === "sessions",
    },
    connection: {
      ...FULL_WORKSPACE_SET.connection,
      ...(overrides?.connection ?? {}),
      primary: primaryWorkspace === "connection",
    },
    conversation_test: {
      ...FULL_WORKSPACE_SET.conversation_test,
      ...(overrides?.conversation_test ?? {}),
      primary: primaryWorkspace === "conversation_test",
    },
    logs: {
      ...FULL_WORKSPACE_SET.logs,
      ...(overrides?.logs ?? {}),
      primary: primaryWorkspace === "logs",
    },
  };
}

export function buildRoleCapabilities(role: SetupRole | null): RoleCapabilities {
  if (role === "gateway_host" || role === "gateway_host_console") {
    return {
      role,
      variant: "gateway",
      primaryWorkspace: "connection",
      workspace: withPrimaryWorkspace("connection"),
      actions: {
        canManageGateway: true,
        canManageWeChat: true,
        canManageNodes: true,
        canManageLocalNode: true,
        canBindSessions: true,
        canRunConversationTest: true,
        canViewLogs: true,
        canEditQuickSetup: true,
      },
      sections: {
        showGatewayOverview: true,
        showWeChatAccess: true,
        showRemoteNodeInventory: true,
        showLocalNodePanel: true,
        showSessionConsole: true,
        showSessionInspector: true,
        showConversationTest: true,
        showLauncherRuntime: true,
      },
    };
  }

  if (role === "worker_node") {
    return {
      role,
      variant: "worker",
      primaryWorkspace: "connection",
      workspace: withPrimaryWorkspace("connection", {
        quick_setup: { priority: 10 },
        sessions: { visible: true, priority: 30 },
        connection: { priority: 20 },
        conversation_test: { priority: 40 },
        logs: { priority: 50 },
      }),
      actions: {
        canManageGateway: false,
        canManageWeChat: false,
        canManageNodes: false,
        canManageLocalNode: true,
        canBindSessions: false,
        canRunConversationTest: true,
        canViewLogs: true,
        canEditQuickSetup: true,
      },
      sections: {
        showGatewayOverview: false,
        showWeChatAccess: false,
        showRemoteNodeInventory: false,
        showLocalNodePanel: true,
        showSessionConsole: true,
        showSessionInspector: true,
        showConversationTest: true,
        showLauncherRuntime: true,
      },
    };
  }

  if (role === "console_only") {
    return {
      role,
      variant: "console",
      primaryWorkspace: "sessions",
      workspace: withPrimaryWorkspace("sessions", {
        quick_setup: { visible: true, priority: 10 },
        sessions: { priority: 20 },
        connection: { priority: 30 },
        conversation_test: { visible: false, priority: 40 },
        logs: { visible: false, priority: 50 },
      }),
      actions: {
        canManageGateway: false,
        canManageWeChat: false,
        canManageNodes: false,
        canManageLocalNode: false,
        canBindSessions: true,
        canRunConversationTest: false,
        canViewLogs: false,
        canEditQuickSetup: true,
      },
      sections: {
        showGatewayOverview: true,
        showWeChatAccess: false,
        showRemoteNodeInventory: true,
        showLocalNodePanel: false,
        showSessionConsole: true,
        showSessionInspector: true,
        showConversationTest: false,
        showLauncherRuntime: false,
      },
    };
  }

  return {
    role,
    variant: "unknown",
    primaryWorkspace: "quick_setup",
    workspace: withPrimaryWorkspace("quick_setup", {
      sessions: { visible: false },
      connection: { visible: false },
      conversation_test: { visible: false },
      logs: { visible: false },
    }),
    actions: {
      canManageGateway: false,
      canManageWeChat: false,
      canManageNodes: false,
      canManageLocalNode: false,
      canBindSessions: false,
      canRunConversationTest: false,
      canViewLogs: false,
      canEditQuickSetup: true,
    },
    sections: {
      showGatewayOverview: false,
      showWeChatAccess: false,
      showRemoteNodeInventory: false,
      showLocalNodePanel: false,
      showSessionConsole: false,
      showSessionInspector: false,
      showConversationTest: false,
      showLauncherRuntime: false,
    },
  };
}

export function resolveVisibleWorkspaces(capabilities: RoleCapabilities): WorkspaceTab[] {
  return (Object.entries(capabilities.workspace) as Array<[WorkspaceTab, RoleWorkspaceCapability]>)
    .filter(([, capability]) => capability.visible)
    .sort(([, left], [, right]) => left.priority - right.priority)
    .map(([workspace]) => workspace);
}

export function roleVariantLabel(capabilities: RoleCapabilities): string {
  if (capabilities.variant === "gateway") return "主网关";
  if (capabilities.variant === "worker") return "工作节点";
  if (capabilities.variant === "console") return "控制台";
  return "待配置";
}

export function roleVariantDescription(capabilities: RoleCapabilities): string {
  if (capabilities.variant === "gateway") {
    return "接入、纳管与运行态。";
  }
  if (capabilities.variant === "worker") {
    return "本机节点与回连自检。";
  }
  if (capabilities.variant === "console") {
    return "会话观察与排障。";
  }
  return "先完成角色配置。";
}

export function workspacePresentation(capabilities: RoleCapabilities, workspace: WorkspaceTab): WorkspacePresentation {
  const base: Record<WorkspaceTab, WorkspacePresentation> = {
    quick_setup: {
      label: "快速配置",
      kicker: "Bootstrap",
      description: "",
      heroTitle: "先选角色，再把当前机器带入稳定运行态",
      heroDescription: "",
      primaryActionLabel: "继续配置",
    },
    sessions: {
      label: "会话观察台",
      kicker: "Session Control",
      description: "",
      heroTitle: "会话轨与详情工作台",
      heroDescription: "",
      primaryActionLabel: "绑定节点",
    },
    connection: {
      label: "接入中心",
      kicker: "Operations Hub",
      description: "",
      heroTitle: "运行态优先",
      heroDescription: "",
      primaryActionLabel: "刷新全部状态",
    },
    conversation_test: {
      label: "对话测试",
      kicker: "Inference Probe",
      description: "",
      heroTitle: "测试输入与链路回执",
      heroDescription: "",
      primaryActionLabel: "发送测试消息",
    },
    logs: {
      label: "日志中心",
      kicker: "Diagnostics",
      description: "",
      heroTitle: "运行日志与配对追踪",
      heroDescription: "",
      primaryActionLabel: "刷新日志",
    },
  };

  if (workspace === "connection" && capabilities.variant === "worker") {
    return {
      label: "节点工作台",
      kicker: "Node Operations",
      description: "",
      heroTitle: "本机节点与回连信息",
      heroDescription: "",
      primaryActionLabel: "刷新节点状态",
    };
  }

  if (workspace === "sessions" && capabilities.variant === "console") {
    return {
      label: "会话观察台",
      kicker: "Console Focus",
      description: "",
      heroTitle: "会话轨与详情工作台",
      heroDescription: "",
      primaryActionLabel: "查看会话",
    };
  }

  if (workspace === "connection" && capabilities.variant === "console") {
    return {
      label: "接入概览",
      kicker: "Read-only Operations",
      description: "",
      heroTitle: "只读接入概览",
      heroDescription: "",
      primaryActionLabel: "返回会话观察",
    };
  }

  if (workspace === "conversation_test" && capabilities.variant === "worker") {
    return {
      label: "节点对话测试",
      kicker: "Node Probe",
      description: "",
      heroTitle: "测试输入与回执",
      heroDescription: "",
      primaryActionLabel: "发送测试消息",
    };
  }

  return base[workspace];
}

export function workspacePrimaryActionLabel(capabilities: RoleCapabilities, workspace: WorkspaceTab): string | undefined {
  return workspacePresentation(capabilities, workspace).primaryActionLabel;
}

export function canAccessWorkspace(capabilities: RoleCapabilities, workspace: WorkspaceTab): boolean {
  return capabilities.workspace[workspace].visible;
}

export function resolvePrimaryWorkspace(capabilities: RoleCapabilities): WorkspaceTab {
  return capabilities.primaryWorkspace;
}
