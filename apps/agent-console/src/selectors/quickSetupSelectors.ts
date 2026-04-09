import { DEFAULT_BUILTIN_MODEL_LABEL } from "../quickSetupDefaults";
import type {
  ConsoleSetupConfig,
  GatewaySetupConfig,
  LauncherMachineRole,
  LauncherProfile,
  SetupProfileResponse,
  SetupRole,
  WorkerNodeSetupConfig,
} from "../types";

export function resolveEffectiveRole(currentRole: SetupRole | null, completedRoles: SetupRole[]): SetupRole | null {
  if (currentRole) return currentRole;
  if (completedRoles.includes("gateway_host_console")) return "gateway_host_console";
  if (completedRoles.includes("gateway_host")) return "gateway_host";
  if (completedRoles.includes("worker_node")) return "worker_node";
  if (completedRoles.includes("console_only")) return "console_only";
  return null;
}

export function isGatewayRole(role: SetupRole | null) {
  return role === "gateway_host" || role === "gateway_host_console";
}

export function isWorkerRole(role: SetupRole | null) {
  return role === "worker_node";
}

export function isConsoleRole(role: SetupRole | null) {
  return role === "console_only";
}

export function roleName(role: SetupRole) {
  if (role === "gateway_host") return "网关主机";
  if (role === "gateway_host_console") return "网关主机+控制台";
  if (role === "worker_node") return "工作节点";
  return "控制台";
}

export function isPairingTaskKind(kind: string) {
  return kind === "discovery_scan" || kind === "discovery_pair" || kind === "manual_pair" || kind === "gateway_probe";
}

export function roleDescription(role: SetupRole) {
  if (role === "gateway_host") return "保存网关基础配置，并主动搜索局域网里已经运行的可配对节点。";
  if (role === "gateway_host_console") return "一次完成网关配置保存与控制台目标校验，适合本机同时承担主网关和运维控制台。";
  if (role === "worker_node") return "把这台机器配置成节点，重点完成本机安装、回连主网关、凭据维护与发现响应设置。";
  return "校验控制台要连接的主网关地址，适合纯观察和接管机器。";
}

export function roleAction(role: SetupRole) {
  if (role === "gateway_host") return "会写入网关 .env、刷新微信运行配置，并通过 UDP 广播搜索候选节点。";
  if (role === "gateway_host_console") return "会先写入网关配置，再串行校验控制台目标网关地址，并把该地址保存为后续默认值。";
  if (role === "worker_node") return "会调用 install-claw-node.ps1，并把主网关地址、节点凭据、配对密钥和发现端口写入本机配置。";
  return "会验证目标主网关健康状态，不会安装任何服务。";
}

export function workerEnvLocations(installDir: string) {
  if (!installDir.trim()) return "节点安装目录下的 bundle\\claw-node\\.env（或 bundle\\claw-node\\services\\claw-node\\.env）";
  return [
    `${installDir}\\bundle\\claw-node\\.env`,
    `${installDir}\\bundle\\claw-node\\services\\claw-node\\.env`,
  ].join("\n");
}

export function previewContent(role: SetupRole, gateway: GatewaySetupConfig, worker: WorkerNodeSetupConfig, consoleConfig: ConsoleSetupConfig) {
  if (role === "gateway_host") return [
    `写入网关配置：Redis=${gateway.redis_url}`,
    `默认 Agent=${gateway.default_agent_id}`,
    `节点回连地址=${consoleConfig.gateway_base_url || "未填写"}`,
    `Dify=${gateway.dify_base_url || "未填写（将默认使用内置模型）"}`,
    `内置模型=${gateway.builtin_model_name || DEFAULT_BUILTIN_MODEL_LABEL}`,
    `微信 Base URL=${gateway.wechat_base_url}`,
    gateway.wechat_token ? "若 token 已填写，将尝试刷新微信运行配置。" : "本次不会刷新微信 token。",
    "保存成功后即可点击“搜索局域网节点”，对候选机器输入配对密钥完成连接。",
  ].join("\n");
  if (role === "gateway_host_console") return [
    `写入网关配置：Redis=${gateway.redis_url}`,
    `默认 Agent=${gateway.default_agent_id}`,
    `控制台目标网关=${consoleConfig.gateway_base_url || "未填写"}`,
    `Dify=${gateway.dify_base_url || "未填写（将默认使用内置模型）"}`,
    `内置模型=${gateway.builtin_model_name || DEFAULT_BUILTIN_MODEL_LABEL}`,
    `微信 Base URL=${gateway.wechat_base_url}`,
    gateway.wechat_token ? "若 token 已填写，将尝试刷新微信运行配置。" : "本次不会刷新微信 token。",
    "执行时会先保存网关配置，再校验控制台目标网关；若校验失败，不回滚已保存的网关配置。",
  ].join("\n");
  if (role === "worker_node") return [
    `安装当前机器节点，节点 ID=${worker.node_id}`,
    `连接局域网网关=${worker.gateway_base_url || "未填写"}`,
    `安装目录=${worker.install_dir}`,
    `最大并发=${worker.max_concurrency}`,
    "节点 Token=安装阶段不生成，将在配对时由网关自动下发",
    `配对密钥=${worker.pairing_key ? "已填写" : "未填写"}`,
    `发现响应=${worker.discovery_enabled ? `开启（UDP ${worker.discovery_port}）` : "关闭"}`,
    `Bundle=${worker.bundle_path || "自动查找常见路径；缺失时尝试现打包"}`,
  ].join("\n");
  return [
    `校验控制台目标网关=${consoleConfig.gateway_base_url}`,
    "成功后会把这个地址作为后续重配默认值保存。",
  ].join("\n");
}

export function previewOutcome(role: SetupRole) {
  if (role === "gateway_host") return "保存后的配置会体现在快速配置档案中；部分运行时配置会即时应用，仍建议重启网关确认最终状态。";
  if (role === "gateway_host_console") return "成功后会同时记录网关配置和控制台默认网关地址；若控制台校验失败，会保留已保存的网关配置并在结果页提示失败原因。";
  if (role === "worker_node") return "成功后会返回当前机器节点的安装日志、节点 ID、主网关回连信息和安装目录；失败时保留错误摘要，便于重试。";
  return "成功后会记录控制台默认网关地址，并可继续进入接入中心或会话观察台。";
}

export function setupRoleToLauncherMachineRole(role: SetupRole): LauncherMachineRole {
  return role === "gateway_host" ? "gateway" : role === "gateway_host_console" ? "gateway_console" : role === "worker_node" ? "node" : "console";
}

export function launcherRoleUsesLocalNode(machineRole: LauncherMachineRole) {
  return machineRole === "node" || machineRole === "gateway_console";
}

export function resolveWorkerNodeId(currentValue: string, launcherProfile?: LauncherProfile | null) {
  return currentValue.trim() || launcherProfile?.local_node_id || "local-node";
}

export function resolveWorkerGatewayBaseUrl(
  currentGatewayBaseUrl: string,
  profile?: Pick<SetupProfileResponse, "console" | "preferred_gateway_base_url" | "last_task"> | null,
  system?: { preferred_gateway_base_url?: string | null } | null,
) {
  const trimmedCurrent = currentGatewayBaseUrl.trim();
  if (trimmedCurrent) return trimmedCurrent;
  const taskGatewayBaseUrl = profile?.last_task?.kind === "node_install" ? profile.last_task.metadata.gateway_base_url?.trim() : "";
  if (taskGatewayBaseUrl) return taskGatewayBaseUrl;
  return profile?.preferred_gateway_base_url || profile?.console.gateway_base_url || system?.preferred_gateway_base_url || "";
}
