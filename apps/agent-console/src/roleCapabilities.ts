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
    return "聚焦接入、纳管、扩容与运行态判断。";
  }
  if (capabilities.variant === "worker") {
    return "聚焦本机节点、模型链路、回连状态与自检。";
  }
  if (capabilities.variant === "console") {
    return "聚焦会话观察、手动绑定、上下文与排障。";
  }
  return "先完成角色配置，再进入联调与观察。";
}

export function workspacePresentation(capabilities: RoleCapabilities, workspace: WorkspaceTab): WorkspacePresentation {
  const base: Record<WorkspaceTab, WorkspacePresentation> = {
    quick_setup: {
      label: "快速配置",
      kicker: "Bootstrap",
      description: "先完成当前机器角色与运行策略，再进入联调。",
      heroTitle: "先选角色，再把当前机器带入稳定运行态",
      heroDescription: "快速配置只负责把当前机器拉到可运行状态，再把控制权交给接入中心和会话观察台。",
      primaryActionLabel: "继续配置",
    },
    sessions: {
      label: "会话观察台",
      kicker: "Session Control",
      description: "聚焦当前会话、绑定节点和时间线排障。",
      heroTitle: "左侧会话轨，右侧详情工作台",
      heroDescription: "先看会话活跃态和路由，再进入当前会话的绑定、上下文和消息时间线。",
      primaryActionLabel: "绑定节点",
    },
    connection: {
      label: "接入中心",
      kicker: "Operations Hub",
      description: "先确认运行态，再进入微信接入、节点纳管和模型配置。",
      heroTitle: "运行态优先，配置与诊断分层展开",
      heroDescription: "第一屏只回答当前是否健康、下一步该点什么，下面再进入节点、微信和本机模型面板。",
      primaryActionLabel: "刷新全部状态",
    },
    conversation_test: {
      label: "对话测试",
      kicker: "Inference Probe",
      description: "直接验证当前保存的推理配置是否能完成真实回复。",
      heroTitle: "左侧发送测试输入，右侧读取链路回执",
      heroDescription: "把 provider、配置来源、回复正文和耗时固定到同一排障视角。",
      primaryActionLabel: "发送测试消息",
    },
    logs: {
      label: "日志中心",
      kicker: "Diagnostics",
      description: "集中查看运行日志、配对日志和本机节点输出。",
      heroTitle: "把运行日志与配对追踪集中到同一条排障视线",
      heroDescription: "日志中心不再承载配置表单，只负责汇总运行、回连和配对过程。",
      primaryActionLabel: "刷新日志",
    },
  };

  if (workspace === "connection" && capabilities.variant === "worker") {
    return {
      label: "节点工作台",
      kicker: "Node Operations",
      description: "聚焦本机节点安装、回连、发现响应与运行时诊断。",
      heroTitle: "本机节点、自检与回连信息集中显示",
      heroDescription: "当前角色只负责这台机器的节点、模型和诊断，不负责纳管其它节点或微信接入。",
      primaryActionLabel: "刷新节点状态",
    };
  }

  if (workspace === "sessions" && capabilities.variant === "console") {
    return {
      label: "会话观察台",
      kicker: "Console Focus",
      description: "默认进入会话轨道，优先观察用户、节点与上下文状态。",
      heroTitle: "控制台角色默认停留在会话轨道",
      heroDescription: "会话、绑定、上下文和异常提示都在这一页收口，不暴露不必要的运维动作。",
      primaryActionLabel: "查看会话",
    };
  }

  if (workspace === "connection" && capabilities.variant === "console") {
    return {
      label: "接入概览",
      kicker: "Read-only Operations",
      description: "只保留运行态总览和节点清单，聚焦观察与排障，不展示执行型接入操作。",
      heroTitle: "先观察当前网关与节点运行态，再回到会话排障",
      heroDescription: "控制台角色只看总览和节点诊断，微信接入、本机模型和纳管动作都交给网关或节点角色完成。",
      primaryActionLabel: "返回会话观察",
    };
  }

  if (workspace === "conversation_test" && capabilities.variant === "worker") {
    return {
      label: "节点对话测试",
      kicker: "Node Probe",
      description: "直接验证当前节点配置是否能完成真实对话。",
      heroTitle: "先看当前链路，再发一条最小测试消息",
      heroDescription: "结果区集中返回 provider、耗时、配置来源和回复正文，便于快速确认本机节点是否可用。",
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
