// roleWorkspace.ts
// 角色感知工作区纯函数集合
// 所有函数均为纯函数，支持属性测试

type SetupRole = "gateway_host" | "gateway_host_console" | "worker_node" | "console_only";
type WorkspaceTab = "quick_setup" | "sessions" | "connection" | "logs";
type SetupTaskStatus = "pending" | "running" | "succeeded" | "failed";

export type RoleBadge = {
  tab: WorkspaceTab;
  label: string;
  variant: "gateway" | "worker" | "console";
};

export const WORKSPACE_STATE_KEY = "wechat-claw-hub.workspace";

/**
 * 属性 1：角色到工作区的路由映射
 * console_only → sessions，其余角色 → connection
 */
export function resolveRoleWorkspace(role: SetupRole): WorkspaceTab {
  if (role === "console_only") return "sessions";
  return "connection";
}

/**
 * 属性 5：角色徽标与主工作区对应
 * 返回的 tab 字段与 resolveRoleWorkspace 保持一致
 */
export function resolveRoleBadge(role: SetupRole | null): RoleBadge | null {
  if (role === "gateway_host" || role === "gateway_host_console") {
    return { tab: "connection", label: "主网关", variant: "gateway" };
  }
  if (role === "worker_node") {
    return { tab: "connection", label: "工作节点", variant: "worker" };
  }
  if (role === "console_only") {
    return { tab: "sessions", label: "控制台", variant: "console" };
  }
  return null;
}

/**
 * 属性 2：SetupProfile 推荐工作区优先
 * setup_completed 为 false → quick_setup
 * 否则使用 recommended_workspace
 */
export function resolveInitialWorkspace(profile: {
  recommended_workspace: WorkspaceTab;
  setup_completed: boolean;
}): WorkspaceTab {
  if (!profile.setup_completed) return "quick_setup";
  return profile.recommended_workspace;
}

/**
 * 属性 3：completed_roles 到工作区的推导
 * 包含网关或工作节点角色 → connection
 * 仅包含 console_only → sessions
 * 空数组 → quick_setup
 */
export function resolveWorkspaceFromCompletedRoles(completedRoles: SetupRole[]): WorkspaceTab {
  const hasGatewayOrWorker = completedRoles.some((r) => r !== "console_only");
  if (hasGatewayOrWorker) return "connection";
  if (completedRoles.includes("console_only")) return "sessions";
  return "quick_setup";
}

/**
 * 属性 4：任务失败时工作区不变
 * succeeded → 按角色路由；其他状态 → 保持 currentWorkspace
 */
export function resolveWorkspaceOnTaskComplete(
  status: SetupTaskStatus,
  role: SetupRole,
  currentWorkspace: WorkspaceTab
): WorkspaceTab {
  if (status === "succeeded") return resolveRoleWorkspace(role);
  return currentWorkspace;
}

/**
 * 属性 7：节点配置向导的网关地址验证
 * 空字符串或纯空白 → false
 */
export function validateWorkerGatewayUrl(url: string): boolean {
  return url.trim().length > 0;
}

/**
 * 属性 8：Token 状态展示逻辑
 * token 为空 → waiting；非空 → paired；始终不显示明文（showToken: false）
 */
export function resolveTokenDisplayState(token: string): {
  status: "waiting" | "paired";
  showToken: false;
} {
  return {
    status: token.trim().length === 0 ? "waiting" : "paired",
    showToken: false,
  };
}

/**
 * 属性 9：角色切换确认保护
 * completedRoles 非空且 newRole 不在其中 → 需要确认
 */
export function requiresRoleSwitchConfirmation(
  completedRoles: SetupRole[],
  newRole: SetupRole
): boolean {
  return completedRoles.length > 0 && !completedRoles.includes(newRole);
}

/**
 * 属性 10：localStorage 工作区持久化
 */
export function persistWorkspace(workspace: WorkspaceTab): void {
  try {
    localStorage.setItem(WORKSPACE_STATE_KEY, workspace);
  } catch {
    // localStorage 不可用时静默失败
  }
}

export function clearPersistedWorkspace(): void {
  try {
    localStorage.removeItem(WORKSPACE_STATE_KEY);
  } catch {
    // localStorage 不可用时静默失败
  }
}

export function loadPersistedWorkspace(): WorkspaceTab | null {
  try {
    const value = localStorage.getItem(WORKSPACE_STATE_KEY);
    if (value === "quick_setup" || value === "sessions" || value === "connection") {
      return value;
    }
    return null;
  } catch {
    return null;
  }
}
