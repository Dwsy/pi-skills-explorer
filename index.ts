/**
 * show-skills - Pi Skills Explorer
 *
 * 斜杠命令 /show-skills：启动本地 Web 服务器展示技能列表
 *
 * 功能:
 *   - 技能来源、名称、元信息展示
 *   - 自定义描述/分类/备注 (存储在 ~/.pi/show-skills/，不修改原文件)
 *   - 收藏置顶
 *   - 使用次数统计 (hook read tool)
 *   - 中英文 i18n
 *
 * 用法:
 *   /show-skills              启动服务器并打开浏览器
 *   /show-skills --port 8765  指定端口
 *   /show-skills --no-open    不自动打开浏览器
 *   /show-skills stop         停止运行中的服务器
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadAllSkills, type SkillInfo } from "./skill-loader.js";
import { SkillsServer } from "./server.js";
import { incrementUsage, loadSettings } from "./usage-store.js";

const EXTENSION_ROOT = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(homedir(), ".pi", "show-skills");

function commandLang(): "zh" | "en" {
  const lang = loadSettings().language;
  if (lang === "zh" || lang === "en") return lang;
  return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function msg(key: string, vars: Record<string, string | number> = {}): string {
  const dict: Record<string, Record<string, string>> = {
    zh: {
      description: "启动 Web UI 浏览、分类、汉化并管理 Pi Skills",
      stop: "停止运行中的 Skills 服务器",
      port: "指定端口（默认 9488）",
      noOpen: "不自动打开浏览器",
      stopped: "Skills 服务器已停止（端口 {port}）。",
      notRunning: "没有正在运行的 Skills 服务器。",
      alreadyRunning: "Skills 服务器已在运行：{url}\n使用 /show-skills stop 关闭。",
      loading: "正在加载技能…",
      loadFailed: "加载技能失败：{error}",
      none: "未找到技能。请把技能放到 ~/.pi/agent/skills/",
      started: "✦ Skills Explorer 已启动：{url}\n   已加载 {count} 个技能 · 使用 /show-skills stop 关闭",
      startFailed: "启动服务器失败：{error}",
    },
    en: {
      description: "Launch web UI to browse, classify, translate, and manage Pi skills",
      stop: "Stop the running skills server",
      port: "Specify a port (default: 9488)",
      noOpen: "Do not auto-open the browser",
      stopped: "Skills server stopped (port {port}).",
      notRunning: "No skills server is running.",
      alreadyRunning: "Skills server already running at {url}\nUse /show-skills stop to shut it down.",
      loading: "Loading skills…",
      loadFailed: "Failed to load skills: {error}",
      none: "No skills found. Place skills in ~/.pi/agent/skills/",
      started: "✦ Skills Explorer running at {url}\n   {count} skills loaded · /show-skills stop to shut down",
      startFailed: "Failed to start server: {error}",
    },
  };
  let text = (dict[commandLang()] || dict.en)[key] || key;
  for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, String(v));
  return text;
}

function writeRuntimePointers(): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(join(CONFIG_DIR, "extension.json"), JSON.stringify({
      extensionRoot: EXTENSION_ROOT,
      cli: join(EXTENSION_ROOT, "show-skills-meta.mjs"),
      updatedAt: new Date().toISOString(),
    }, null, 2));
    const wrapperPath = join(CONFIG_DIR, "show-skills-meta.mjs");
    writeFileSync(wrapperPath, `#!/usr/bin/env node\nimport { readFileSync } from "node:fs";\nimport { join } from "node:path";\nimport { homedir } from "node:os";\nimport { spawnSync } from "node:child_process";\nconst config = JSON.parse(readFileSync(join(homedir(), ".pi", "show-skills", "extension.json"), "utf-8"));\nconst cli = config.cli || join(config.extensionRoot, "show-skills-meta.mjs");\nconst result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: "inherit" });\nprocess.exit(result.status ?? 1);\n`);
  } catch {}
}

export default function (pi: ExtensionAPI) {
  let server: SkillsServer | null = null;
  writeRuntimePointers();

  // ── Hook read tool: 统计 SKILL.md 读取 ──────────────────────────
  // 当 agent 用 read tool 读取 SKILL.md 文件时自增使用次数
  pi.on("tool_result", async (event, _ctx) => {
    try {
      if (event.toolName !== "read") return;
      if (!loadSettings().usageTrackingEnabled) return;

      const input = (event as any).input || {};
      const filePath: string = String(input.path || input.file_path || "");

      const normalizedPath = filePath.replace(/\\/g, "/");
      if (!normalizedPath || !/\/skill\.md$/i.test(normalizedPath)) return;

      // 从路径提取技能名 (SKILL.md 的父目录名)
      const parts = normalizedPath.split("/");
      const skillName = parts[parts.length - 2];
      if (!skillName) return;

      // 异步自增，不阻塞
      incrementUsage(skillName);
    } catch {}
  });

  pi.registerCommand("show-skills", {
    description: "Launch web UI to browse/classify skills · 启动技能浏览/分类界面",
    getArgumentCompletions: (prefix: string) => {
      const opts = [
        { value: "stop", label: msg("stop") },
        { value: "--port", label: msg("port") },
        { value: "--no-open", label: msg("noOpen") },
      ];
      return opts.filter((o) => o.value.startsWith(prefix));
    },
    handler: async (args: string, ctx) => {
      const raw = (args ?? "").trim();

      // ── stop ───────────────────────────────────────────────────────
      if (raw === "stop") {
        if (server) {
          const port = server.getPort();
          server.stop();
          server = null;
          ctx.ui.notify(msg("stopped", { port }), "info");
        } else {
          ctx.ui.notify(msg("notRunning"), "info");
        }
        return;
      }

      // ── already running ────────────────────────────────────────────
      if (server && server.isRunning()) {
        ctx.ui.notify(msg("alreadyRunning", { url: server.getUrl() }), "info");
        return;
      }

      // ── parse args ─────────────────────────────────────────────────
      let port = 9488;
      const portMatch = raw.match(/--port\s+(\d+)/);
      if (portMatch) port = parseInt(portMatch[1], 10);
      const noOpen = raw.includes("--no-open");

      // ── load skills ────────────────────────────────────────────────
      ctx.ui.setStatus("show-skills", msg("loading"));
      let skills: SkillInfo[];
      try {
        skills = loadAllSkills();
      } catch (err: any) {
        ctx.ui.setStatus("show-skills", undefined);
        ctx.ui.notify(msg("loadFailed", { error: err?.message ?? err }), "error");
        return;
      }
      ctx.ui.setStatus("show-skills", undefined);

      if (skills.length === 0) {
        ctx.ui.notify(msg("none"), "warning");
        return;
      }

      // ── start server ───────────────────────────────────────────────
      try {
        server = new SkillsServer({ port, skills, autoOpen: !noOpen });
        await server.start();
        ctx.ui.notify(msg("started", { url: server.getUrl(), count: skills.length }));
      } catch (err: any) {
        ctx.ui.notify(msg("startFailed", { error: err?.message ?? err }), "error");
        server = null;
      }
    },
  });
}
