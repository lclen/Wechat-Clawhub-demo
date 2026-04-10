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

if (errors.length > 0) {
  console.error("Forbidden legacy UI copy detected:\n");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("UI copy check passed.");
