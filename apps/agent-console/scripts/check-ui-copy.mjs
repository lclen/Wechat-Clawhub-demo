import { readFileSync, statSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = new URL("..", import.meta.url);

const checks = [
  {
    file: "src/App.tsx",
    forbidden: [
      "OpenAI 或 Dify 配置",
      "OpenAI 或 Dify",
    ],
  },
  {
    file: "src/components/Workspaces/Connection/NodeModelConfigPanel.tsx",
    forbidden: [
      "OpenAI Base URL",
      "OpenAI Model",
      "OpenAI API Key",
      "OpenAI Key",
      "启用 OpenAI Thinking",
      "OpenAI 兼容接口",
    ],
  },
  {
    file: "src/components/Workspaces/ConversationTest/ConversationTestWorkspace.tsx",
    forbidden: [
      "OpenAI Base URL",
      "OpenAI Model",
      "OpenAI API Key",
      "OpenAI Key",
      "启用 OpenAI Thinking",
      "OpenAI 兼容接口",
      "OpenAI 或 Dify",
    ],
  },
  {
    file: "src/components/Workspaces/QuickSetup/QuickSetupConfigStage.tsx",
    forbidden: [
      "OpenAI Base URL",
      "OpenAI Model",
      "OpenAI API Key",
      "OpenAI Key",
      "启用 OpenAI Thinking",
      "OpenAI 兼容接口",
    ],
  },
  {
    file: "src/hooks/useLocalNodeController.ts",
    forbidden: [
      "OpenAI Base URL",
      "OpenAI Model",
      "OpenAI API Key",
      "OpenAI Key",
      "启用 OpenAI Thinking",
      "OpenAI 兼容接口",
    ],
  },
];

const requiredChecks = [
  {
    file: "src/components/Workspaces/QuickSetup/QuickSetupWorkspace.tsx",
    required: [
      "快速配置工作台",
      "quick-setup-command-strip",
      "quick-setup-rail",
    ],
  },
  {
    file: "src/components/Workspaces/QuickSetup/QuickSetupRolePanel.tsx",
    required: [
      "选择本机角色",
      "role-card-arrow",
    ],
  },
  {
    file: "src/components/Workspaces/QuickSetup/QuickSetupStatusPanel.tsx",
    required: [
      "健康度",
      "quick-setup-status-command",
    ],
  },
  {
    file: "src/components/Workspaces/Connection/ConnectionWorkspace.tsx",
    required: [
      "接入中心工作台",
      "connection-command-strip",
      "connection-flow-rail",
      "推荐路径",
      "接入能力",
      "执行摘要",
      "connection-capability-grid",
      "connection-summary-panel",
    ],
  },
  {
    file: "src/App.tsx",
    required: [
      "sidebar-system-card",
      "当前工作区",
    ],
  },
  {
    file: "src/styles.css",
    required: [
      "--canvas: #f7fbf6",
      "--app-gradient:",
      "--accent: #2f6feb",
      ".console-sidebar-neutral",
    ],
  },
];

const errors = [];

for (const check of checks) {
  const fileUrl = new URL(check.file, rootDir);
  statSync(fileUrl);
  const content = readFileSync(fileUrl, "utf8");
  const filePath = fileURLToPath(fileUrl);
  for (const needle of check.forbidden) {
    if (content.includes(needle)) {
      errors.push(`${relative(process.cwd(), filePath)} still contains forbidden UI copy: "${needle}"`);
    }
  }
}

for (const check of requiredChecks) {
  const fileUrl = new URL(check.file, rootDir);
  statSync(fileUrl);
  const content = readFileSync(fileUrl, "utf8");
  const filePath = fileURLToPath(fileUrl);
  for (const needle of check.required) {
    if (!content.includes(needle)) {
      errors.push(`${relative(process.cwd(), filePath)} is missing required quick setup UI contract: "${needle}"`);
    }
  }
}

if (errors.length > 0) {
  console.error("UI copy contract check failed:\n");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("UI copy check passed.");
