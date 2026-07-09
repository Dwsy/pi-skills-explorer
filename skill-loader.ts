/**
 * Skill Loader - 复刻 Pi 的 skills 加载与来源分类逻辑
 *
 * 参考:
 *   - core/skills.js          → loadSkills / loadSkillFromFile
 *   - core/package-manager.js → resolve / addAutoDiscoveredResources
 *   - core/config.js          → getAgentDir / CONFIG_DIR_NAME
 *   - utils/frontmatter.js    → parseFrontmatter
 *
 * 加载来源 (metadata):
 *   origin="package"  → 来自 npm/git 安装的包 (settings.packages)
 *   source="auto"     → 自动发现于 ~/.pi/agent/skills/ 或 .pi/skills/
 *   source="local"    → settings.json 中显式配置的 skills 条目
 *
 * scope:
 *   "user"    → 全局用户级 (~/.pi/agent/)
 *   "project" → 项目级 (./.pi/)
 */

import { existsSync, readdirSync, readFileSync, statSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────

export interface SkillSourceInfo {
  source: string; // "auto" | "local" | "npm" | "git" | "cli" | "agent"
  scope: string; // "user" | "project" | "temporary"
  origin: string; // "top-level" | "package"
  baseDir: string;
  /** 包来源标识 (仅 package origin): 如 "npm:glimpseui" 或 "git:github.com/coctostan/pi-superpowers" */
  packageSource?: string;
  /** Agent 标识 (仅 agent 来源): 如 "claude-code", "codex", "cursor" */
  agent?: string;
}

export interface SkillFileEntry {
  name: string;
  path: string;
  relativePath: string;
  size: number;
  isMarkdown: boolean;
}

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  sourceInfo: SkillSourceInfo;
  disableModelInvocation: boolean;
  enabled: boolean;
  /** SKILL.md 的正文内容 (去除 frontmatter) */
  body: string;
  /** 技能目录下的关联文件列表 */
  files: SkillFileEntry[];
  /** 是否为符号链接 */
  isSymlink: boolean;
  /** 符号链接指向的真实路径 */
  realPath?: string;
}

// ── Constants ────────────────────────────────────────────────────────────

const HOME = homedir();
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || join(HOME, ".pi", "agent");
const CONFIG_DIR_NAME = ".pi";
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

// ── Frontmatter Parser (复刻 utils/frontmatter.js) ──────────────────────

interface ParsedFrontmatter {
  frontmatter: Record<string, any>;
  body: string;
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) {
    return { frontmatter: {}, body: normalized };
  }
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: normalized };
  }
  const yamlString = normalized.slice(4, endIndex);
  const body = normalized.slice(endIndex + 4).trim();
  const frontmatter = parseSimpleYaml(yamlString);
  return { frontmatter, body };
}

/**
 * 轻量 YAML 解析器 - 支持 frontmatter 中常见的 key: value 格式
 * (不依赖 yaml 库，在扩展环境中更健壮)
 */
function parseSimpleYaml(yamlString: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = yamlString.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();

    // 去除引号
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // 布尔值
    if (value === "true") value = true;
    else if (value === "false") value = false;

    result[key] = value;
  }
  return result;
}

// ── Path Helpers ─────────────────────────────────────────────────────────

function toPosixPath(p: string): string {
  return p.split(sep).join("/");
}

function formatBaseDir(baseDir: string): string {
  if (baseDir === HOME) return "~";
  if (baseDir.startsWith(HOME)) {
    return "~" + baseDir.slice(HOME.length).replace(/\\/g, "/");
  }
  return baseDir.replace(/\\/g, "/");
}

function isUnderPath(target: string, root: string): boolean {
  const normalizedRoot = resolve(root);
  if (target === normalizedRoot) return true;
  const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep;
  return target.startsWith(prefix);
}

// ── Skill File Loader (复刻 core/skills.js loadSkillFromFile) ────────────

interface RawSkill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  body: string;
  isSymlink: boolean;
  realPath?: string;
}

function loadSkillFromFile(
  filePath: string,
): { skill: RawSkill | null; rawContent: string } {
  try {
    const rawContent = readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(rawContent);
    const skillDir = dirname(filePath);
    const parentDirName = basename(skillDir);

    const description = frontmatter.description ?? "";
    if (!description || description.trim() === "") {
      return { skill: null, rawContent };
    }

    const name = frontmatter.name || parentDirName;
    const disableModelInvocation = frontmatter["disable-model-invocation"] === true;

    // 检测符号链接
    let isSymlink = false;
    let realPath: string | undefined;
    try {
      const lstat = statSync(filePath);
      isSymlink = lstat.isSymbolicLink?.() ?? false;
      // 更准确：用 lstatSync
    } catch {}
    try {
      const fs = require("node:fs");
      if (fs.lstatSync && fs.lstatSync(filePath).isSymbolicLink()) {
        isSymlink = true;
        realPath = realpathSync(filePath);
      }
    } catch {}

    return {
      skill: {
        name,
        description: String(description).slice(0, MAX_DESCRIPTION_LENGTH),
        filePath,
        baseDir: skillDir,
        disableModelInvocation,
        body,
        isSymlink,
        realPath,
      },
      rawContent,
    };
  } catch {
    return { skill: null, rawContent: "" };
  }
}

// ── Skill Directory Scanner (复刻 collectSkillEntries) ───────────────────

const IGNORE_NAMES = new Set([".git", "node_modules", ".DS_Store"]);

function isSkillFileName(name: string): boolean {
  return name.toLowerCase() === "skill.md";
}

function collectSkillFiles(dir: string): string[] {
  const entries: string[] = [];
  if (!existsSync(dir)) return entries;

  try {
    const dirEntries = readdirSync(dir, { withFileTypes: true });

    // 优先检查当前目录是否有 SKILL.md / SKILL.MD / skill.md
    for (const entry of dirEntries) {
      if (isSkillFileName(entry.name)) {
        const fullPath = join(dir, entry.name);
        let isFile = entry.isFile();
        if (entry.isSymbolicLink()) {
          try {
            isFile = statSync(fullPath).isFile();
          } catch {
            continue;
          }
        }
        if (isFile) {
          entries.push(fullPath);
          return entries; // 找到 SKILL.md 则不再递归
        }
      }
    }

    // 递归子目录
    for (const entry of dirEntries) {
      if (entry.name.startsWith(".") || IGNORE_NAMES.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);
      let isDir = entry.isDirectory();

      if (entry.isSymbolicLink()) {
        try {
          isDir = statSync(fullPath).isDirectory();
        } catch {
          continue;
        }
      }

      if (isDir) {
        entries.push(...collectSkillFiles(fullPath));
      }
    }
  } catch {}

  return entries;
}

// ── Associated Files Scanner ─────────────────────────────────────────────

const TEXT_EXTENSIONS = new Set([
  ".md", ".txt", ".ts", ".js", ".tsx", ".jsx", ".json", ".yaml", ".yml",
  ".py", ".sh", ".bash", ".zsh", ".go", ".rs", ".java", ".c", ".cpp",
  ".h", ".hpp", ".css", ".html", ".xml", ".toml", ".ini", ".cfg",
  ".env", ".gitignore", ".dockerignore", ".rb", ".php", ".swift",
  ".kt", ".scala", ".lua", ".r", ".sql", ".graphql", ".proto",
]);

const MAX_ASSOCIATED_FILES = 100;

function scanAssociatedFiles(baseDir: string, skillFilePath: string): SkillFileEntry[] {
  const entries: SkillFileEntry[] = [];
  if (!existsSync(baseDir)) return entries;

  try {
    const stat = statSync(skillFilePath);
    entries.push({
      name: basename(skillFilePath),
      path: skillFilePath,
      relativePath: relative(baseDir, skillFilePath),
      size: stat.size,
      isMarkdown: true,
    });
  } catch {}

  function walk(dir: string, depth: number) {
    if (entries.length >= MAX_ASSOCIATED_FILES || depth > 4) return;
    try {
      const dirEntries = readdirSync(dir, { withFileTypes: true });
      for (const entry of dirEntries) {
        if (entries.length >= MAX_ASSOCIATED_FILES) return;
        if (IGNORE_NAMES.has(entry.name)) continue;
        if (entry.name.startsWith(".") && entry.name !== ".env") continue;

        const fullPath = join(dir, entry.name);
        const relPath = relative(baseDir, fullPath);

        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (entry.isFile()) {
          // 技能入口文件已手动放在顶部，避免重复
          if (fullPath === skillFilePath) continue;
          // 跳过过大文件
          try {
            const stat = statSync(fullPath);
            if (stat.size > 512 * 1024) continue; // 跳过 >512KB
            entries.push({
              name: entry.name,
              path: fullPath,
              relativePath: relPath,
              size: stat.size,
              isMarkdown: entry.name.toLowerCase().endsWith(".md"),
            });
          } catch {}
        }
      }
    } catch {}
  }

  walk(baseDir, 0);
  entries.sort((a, b) => {
    if (a.path === skillFilePath) return -1;
    if (b.path === skillFilePath) return 1;
    // Markdown 优先，然后按路径排序
    if (a.isMarkdown !== b.isMarkdown) return a.isMarkdown ? -1 : 1;
    return a.relativePath.localeCompare(b.relativePath);
  });
  return entries;
}

// ── Settings Loader ──────────────────────────────────────────────────────

interface PackageConfig {
  source: string;
  scope: string;
  skills?: string[]; // filter patterns like "+skills/xxx/SKILL.md" or "-skills/xxx/SKILL.md"
  extensions?: string[];
  prompts?: string[];
  installedPath?: string;
}

interface SettingsData {
  packages: PackageConfig[];
  skills: string[]; // top-level skills filters
}

function loadSettings(cwd?: string | null): { global: SettingsData; project: SettingsData } {
  const globalSettingsPath = join(AGENT_DIR, "settings.json");
  const projectSettingsPath = cwd ? join(cwd, CONFIG_DIR_NAME, "settings.json") : "";

  function parseSettings(path: string): SettingsData {
    try {
      if (!existsSync(path)) return { packages: [], skills: [] };
      const raw = readFileSync(path, "utf-8");
      const data = JSON.parse(raw);
      return {
        packages: data.packages ?? [],
        skills: data.skills ?? [],
      };
    } catch {
      return { packages: [], skills: [] };
    }
  }

  return {
    global: parseSettings(globalSettingsPath),
    project: parseSettings(projectSettingsPath),
  };
}

// ── Package Source Parser (复刻 package-manager.js parseSource) ──────────

interface ParsedSource {
  type: "npm" | "git" | "local";
  name?: string;
  host?: string;
  path?: string;
  raw: string;
}

function parsePackageSource(source: string): ParsedSource {
  if (source.startsWith("npm:")) {
    return { type: "npm", name: source.slice(4), raw: source };
  }
  if (source.startsWith("git:") || source.startsWith("https://") || source.startsWith("http://")) {
    const url = source.startsWith("git:") ? source.slice(4) : source;
    const match = /([^/]+)\/(.+)/.exec(url.replace(/^https?:\/\//, ""));
    if (match) {
      return { type: "git", host: match[1], path: match[2], raw: source };
    }
    return { type: "git", raw: source };
  }
  return { type: "local", path: source, raw: source };
}

// ── Package Install Path Resolver (复刻 getInstalledPath) ────────────────

function getNpmInstallPath(source: string, scope: string, cwd: string): string | undefined {
  const parsed = parsePackageSource(source);
  if (parsed.type !== "npm" || !parsed.name) return undefined;
  if (scope === "project") {
    return join(cwd, CONFIG_DIR_NAME, "npm", "node_modules", parsed.name);
  }
  return join(AGENT_DIR, "npm", "node_modules", parsed.name);
}

function getGitInstallPath(source: string, scope: string, cwd: string): string | undefined {
  const parsed = parsePackageSource(source);
  if (parsed.type !== "git") return undefined;
  const installRoot = scope === "project"
    ? join(cwd, CONFIG_DIR_NAME, "git")
    : join(AGENT_DIR, "git");
  if (parsed.host && parsed.path) {
    return join(installRoot, parsed.host, parsed.path);
  }
  return undefined;
}

function getPackageInstallPath(source: string, scope: string, cwd: string): string | undefined {
  const parsed = parsePackageSource(source);
  let path: string | undefined;
  if (parsed.type === "npm") path = getNpmInstallPath(source, scope, cwd);
  else if (parsed.type === "git") path = getGitInstallPath(source, scope, cwd);
  if (path && existsSync(path)) return path;
  return undefined;
}

// ── Filter Pattern Matcher (复刻 applyPatterns / isEnabledByOverrides) ────

/**
 * 判断 skill path 是否被 settings 中的 filter pattern 启用或禁用
 * pattern 格式: "+skills/xxx/SKILL.md" (启用) 或 "-skills/xxx/SKILL.md" (禁用)
 */
function isSkillEnabled(
  skillPath: string,
  baseDir: string,
  overrides: string[],
): boolean {
  if (overrides.length === 0) return true;

  // 计算相对于 baseDir 的路径
  let relPath: string;
  try {
    relPath = relative(baseDir, skillPath);
  } catch {
    return true;
  }
  const posixRel = toPosixPath(relPath);

  // 默认启用，除非有明确的 - pattern 匹配
  let enabled = true;
  for (const pattern of overrides) {
    if (!pattern) continue;
    const sign = pattern[0];
    const patternPath = pattern.slice(1);

    if (patternMatches(patternPath, posixRel)) {
      enabled = sign !== "-";
    }
  }
  return enabled;
}

function patternMatches(pattern: string, path: string): boolean {
  if (!pattern) return false;
  // 支持通配符 *
  if (pattern.includes("*")) {
    const regex = new RegExp(
      "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
    );
    return regex.test(path);
  }
  // 前缀匹配 (目录) 或精确匹配
  return path === pattern || path.startsWith(pattern + "/") || path.endsWith("/" + pattern);
}

// ── Main Loader ──────────────────────────────────────────────────────────

export function loadAllSkills(cwd?: string | null): SkillInfo[] {
  const resolvedCwd = cwd ? resolve(cwd) : null;
  const { global: globalSettings, project: projectSettings } = loadSettings(resolvedCwd);

  const skillMap = new Map<string, SkillInfo>();
  const realPathSet = new Set<string>();

  function tryAdd(
    filePath: string,
    sourceInfo: SkillSourceInfo,
    enabled: boolean,
  ): void {
    // 去重：通过 realpath 检测符号链接重复
    let realPath: string;
    try {
      realPath = realpathSync(filePath);
    } catch {
      realPath = filePath;
    }
    if (realPathSet.has(realPath)) return;

    const { skill } = loadSkillFromFile(filePath);
    if (!skill) return;

    const files = scanAssociatedFiles(skill.baseDir, filePath);

    const info: SkillInfo = {
      ...skill,
      sourceInfo,
      enabled,
      files,
    };

    // 名称冲突时，先到先得 (复刻 skills.js 的 collision 逻辑)
    if (!skillMap.has(skill.name)) {
      skillMap.set(skill.name, info);
      realPathSet.add(realPath);
    }
  }

  // ── 1. Package Skills (origin="package") ──────────────────────────────
  // 来自 settings.packages 中安装的 npm/git 包
  const allPackages: Array<{ pkg: PackageConfig; scope: string }> = [];
  if (resolvedCwd) {
    for (const pkg of projectSettings.packages) {
      allPackages.push({ pkg, scope: "project" });
    }
  }
  for (const pkg of globalSettings.packages) {
    allPackages.push({ pkg, scope: "user" });
  }

  for (const { pkg, scope } of allPackages) {
    const source = typeof pkg === "string" ? pkg : pkg.source;
    const pkgConfig = typeof pkg === "string" ? { source: pkg, skills: [] } : pkg;
    const installPath = getPackageInstallPath(source, scope, resolvedCwd ?? "");
    if (!installPath) continue;

    // 在包安装路径下搜索 skills
    const skillsDir = join(installPath, "skills");
    let skillPaths: string[] = [];
    if (existsSync(skillsDir)) {
      skillPaths = collectSkillFiles(skillsDir);
    } else {
      // 有些包可能直接在根目录有 SKILL.md
      skillPaths = collectSkillFiles(installPath);
    }

    for (const skillPath of skillPaths) {
      const skillEnabled = isSkillEnabled(skillPath, installPath, pkgConfig.skills ?? []);
      tryAdd(skillPath, {
        source: parsePackageSource(source).type,
        scope,
        origin: "package",
        baseDir: installPath,
        packageSource: source,
      }, skillEnabled);
    }
  }

  // ── 2. Auto-discovered User Skills (~/.pi/agent/skills/) ──────────────
  const userSkillsDir = join(AGENT_DIR, "skills");
  const userSkillPaths = collectSkillFiles(userSkillsDir);
  for (const skillPath of userSkillPaths) {
    const enabled = isSkillEnabled(skillPath, AGENT_DIR, globalSettings.skills);
    tryAdd(skillPath, {
      source: "auto",
      scope: "user",
      origin: "top-level",
      baseDir: AGENT_DIR,
    }, enabled);
  }

  // ── 3. Auto-discovered User Skills from ~/.agents/skills/ ─────────────
  const userAgentsSkillsDir = join(HOME, ".agents", "skills");
  const userAgentsBaseDir = join(HOME, ".agents");
  if (existsSync(userAgentsSkillsDir)) {
    const agentsSkillPaths = collectSkillFiles(userAgentsSkillsDir);
    for (const skillPath of agentsSkillPaths) {
      const enabled = isSkillEnabled(skillPath, userAgentsBaseDir, globalSettings.skills);
      tryAdd(skillPath, {
        source: "auto",
        scope: "user",
        origin: "top-level",
        baseDir: userAgentsBaseDir,
      }, enabled);
    }
  }

  // ── 4. Auto-discovered Project Skills (./.pi/skills/) ─────────────────
  const projectSkillsDir = resolvedCwd ? join(resolvedCwd, CONFIG_DIR_NAME, "skills") : "";
  if (resolvedCwd && existsSync(projectSkillsDir)) {
    const projectSkillPaths = collectSkillFiles(projectSkillsDir);
    for (const skillPath of projectSkillPaths) {
      const projectBaseDir = join(resolvedCwd, CONFIG_DIR_NAME);
      const enabled = isSkillEnabled(skillPath, projectBaseDir, projectSettings.skills);
      tryAdd(skillPath, {
        source: "auto",
        scope: "project",
        origin: "top-level",
        baseDir: projectBaseDir,
      }, enabled);
    }
  }

  // ── 5. Project Skills from .agents/skills/ (ancestor dirs) ────────────
  const projectAgentsSkillDirs = resolvedCwd ? collectAncestorAgentsSkillDirs(resolvedCwd) : [];
  for (const agentsSkillsDir of projectAgentsSkillDirs) {
    if (resolve(agentsSkillsDir) === resolve(userAgentsSkillsDir)) continue;
    const agentsBaseDir = dirname(agentsSkillsDir);
    if (!existsSync(agentsSkillsDir)) continue;
    const agentsSkillPaths = collectSkillFiles(agentsSkillsDir);
    for (const skillPath of agentsSkillPaths) {
      const enabled = isSkillEnabled(skillPath, agentsBaseDir, projectSettings.skills);
      tryAdd(skillPath, {
        source: "auto",
        scope: "project",
        origin: "top-level",
        baseDir: agentsBaseDir,
      }, enabled);
    }
  }

  // ── 6. Extension-bundled Skills (~/.pi/agent/extensions/show-skills/skills/) ─
  const extensionSkillsDir = join(AGENT_DIR, "extensions", "show-skills", "skills");
  if (existsSync(extensionSkillsDir)) {
    const extensionSkillPaths = collectSkillFiles(extensionSkillsDir);
    for (const skillPath of extensionSkillPaths) {
      tryAdd(skillPath, {
        source: "auto",
        scope: "user",
        origin: "top-level",
        baseDir: join(AGENT_DIR, "extensions", "show-skills"),
        agent: "pi-extension",
      }, true);
    }
  }

  // ── 7. Non-standard Agent Skills (Claude, Codex, Cursor, etc.) ──────
  // 扫描其他 agent 的 skills 目录（标准目录如 .agents/skills 已在前面处理）
  // 只扫描那些有独立路径的 agent，避免与已处理的重复
  const seenAgentDirs = new Set([
    resolve(userAgentsSkillsDir),      // ~/.agents/skills (universal)
    resolve(join(AGENT_DIR, "skills")), // ~/.pi/agent/skills (pi)
  ]);

  for (const agentDir of AGENT_SKILL_DIRS) {
    // 全局级: ~/ + globalPath
    const globalSkillDir = join(HOME, agentDir.globalPath);
    if (existsSync(globalSkillDir) && !seenAgentDirs.has(resolve(globalSkillDir))) {
      seenAgentDirs.add(resolve(globalSkillDir));
      const skillPaths = collectSkillFiles(globalSkillDir);
      for (const skillPath of skillPaths) {
        tryAdd(skillPath, {
          source: "agent",
          scope: "user",
          origin: "top-level",
          baseDir: dirname(globalSkillDir),
          agent: agentDir.agent,
        }, true);
      }
    }

    // 项目级: cwd + projectPath（仅显式传入 projectPath 时启用）
    const projectSkillDir = resolvedCwd ? join(resolvedCwd, agentDir.projectPath) : "";
    if (resolvedCwd && existsSync(projectSkillDir) && !seenAgentDirs.has(resolve(projectSkillDir))) {
      seenAgentDirs.add(resolve(projectSkillDir));
      const skillPaths = collectSkillFiles(projectSkillDir);
      for (const skillPath of skillPaths) {
        tryAdd(skillPath, {
          source: "agent",
          scope: "project",
          origin: "top-level",
          baseDir: dirname(projectSkillDir),
          agent: agentDir.agent,
        }, true);
      }
    }
  }

  return Array.from(skillMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function collectAncestorAgentsSkillDirs(cwd: string): string[] {
  const dirs: string[] = [];
  let dir = resolve(cwd);
  while (true) {
    dirs.push(join(dir, ".agents", "skills"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

// ── Non-standard Agent Skills Directories ────────────────────────────────
// 参考 https://github.com/vercel-labs/skills 的 Supported Agents 表
// 标准目录 (.agents/skills 和 ~/.pi/agent/skills) 已由前面步骤处理
// 这里扫描其他 agent 的 skills 目录

interface AgentSkillDir {
  agent: string;       // agent 标识
  label: string;       // agent 显示名
  projectPath: string; // 项目级相对路径
  globalPath: string;  // 全局级路径 (相对于 HOME)
}

const AGENT_SKILL_DIRS: AgentSkillDir[] = [
  { agent: "claude-code", label: "Claude Code", projectPath: ".claude/skills", globalPath: ".claude/skills" },
  { agent: "codex", label: "Codex", projectPath: ".agents/skills", globalPath: ".codex/skills" },
  { agent: "cursor", label: "Cursor", projectPath: ".agents/skills", globalPath: ".cursor/skills" },
  { agent: "windsurf", label: "Windsurf", projectPath: ".windsurf/skills", globalPath: ".codeium/windsurf/skills" },
  { agent: "cline", label: "Cline", projectPath: ".agents/skills", globalPath: ".agents/skills" },
  { agent: "augment", label: "Augment", projectPath: ".augment/skills", globalPath: ".augment/skills" },
  { agent: "gemini-cli", label: "Gemini CLI", projectPath: ".agents/skills", globalPath: ".gemini/skills" },
  { agent: "github-copilot", label: "GitHub Copilot", projectPath: ".agents/skills", globalPath: ".copilot/skills" },
  { agent: "continue", label: "Continue", projectPath: ".continue/skills", globalPath: ".continue/skills" },
  { agent: "roo", label: "Roo Code", projectPath: ".roo/skills", globalPath: ".roo/skills" },
  { agent: "kilocode", label: "Kilo Code", projectPath: ".kilocode/skills", globalPath: ".kilocode/skills" },
  { agent: "zed", label: "Zed", projectPath: ".agents/skills", globalPath: ".agents/skills" },
  { agent: "warp", label: "Warp", projectPath: ".agents/skills", globalPath: ".agents/skills" },
  { agent: "aider-desk", label: "AiderDesk", projectPath: ".aider-desk/skills", globalPath: ".aider-desk/skills" },
  { agent: "qoder", label: "Qoder", projectPath: ".qoder/skills", globalPath: ".qoder/skills" },
  { agent: "trae", label: "Trae", projectPath: ".trae/skills", globalPath: ".trae/skills" },
  { agent: "goose", label: "Goose", projectPath: ".goose/skills", globalPath: ".config/goose/skills" },
  { agent: "opencode", label: "OpenCode", projectPath: ".agents/skills", globalPath: ".config/opencode/skills" },
  { agent: "openhands", label: "OpenHands", projectPath: ".openhands/skills", globalPath: ".openhands/skills" },
  { agent: "devin", label: "Devin", projectPath: ".devin/skills", globalPath: ".config/devin/skills" },
  { agent: "factory", label: "Droid", projectPath: ".factory/skills", globalPath: ".factory/skills" },
  { agent: "tabnine", label: "Tabnine CLI", projectPath: ".tabnine/agent/skills", globalPath: ".tabnine/agent/skills" },
  { agent: "qwen-code", label: "Qwen Code", projectPath: ".qwen/skills", globalPath: ".qwen/skills" },
  { agent: "firebender", label: "Firebender", projectPath: ".agents/skills", globalPath: ".firebender/skills" },
  { agent: "deepagents", label: "Deep Agents", projectPath: ".agents/skills", globalPath: ".deepagents/agent/skills" },
  { agent: "crush", label: "Crush", projectPath: ".crush/skills", globalPath: ".config/crush/skills" },
  { agent: "cortex", label: "Cortex Code", projectPath: ".cortex/skills", globalPath: ".snowflake/cortex/skills" },
  { agent: "amp", label: "Amp", projectPath: ".agents/skills", globalPath: ".config/agents/skills" },
  { agent: "hermes", label: "Hermes Agent", projectPath: ".hermes/skills", globalPath: ".hermes/skills" },
  { agent: "iflow", label: "iFlow CLI", projectPath: ".iflow/skills", globalPath: ".iflow/skills" },
  { agent: "kiro", label: "Kiro CLI", projectPath: ".kiro/skills", globalPath: ".kiro/skills" },
  { agent: "kode", label: "Kode", projectPath: ".kode/skills", globalPath: ".kode/skills" },
  { agent: "lingma", label: "Lingma", projectPath: ".lingma/skills", globalPath: ".lingma/skills" },
  { agent: "mux", label: "Mux", projectPath: ".mux/skills", globalPath: ".mux/skills" },
  { agent: "vibe", label: "Mistral Vibe", projectPath: ".vibe/skills", globalPath: ".vibe/skills" },
  { agent: "junie", label: "Junie", projectPath: ".junie/skills", globalPath: ".junie/skills" },
  { agent: "jazz", label: "Jazz", projectPath: ".jazz/skills", globalPath: ".jazz/skills" },
  { agent: "codebuddy", label: "CodeBuddy", projectPath: ".codebuddy/skills", globalPath: ".codebuddy/skills" },
  { agent: "codearts", label: "CodeArts Agent", projectPath: ".codeartsdoer/skills", globalPath: ".codeartsdoer/skills" },
  { agent: "codemaker", label: "Codemaker", projectPath: ".codemaker/skills", globalPath: ".codemaker/skills" },
  { agent: "command-code", label: "Command Code", projectPath: ".commandcode/skills", globalPath: ".commandcode/skills" },
  { agent: "forge", label: "ForgeCode", projectPath: ".forge/skills", globalPath: ".forge/skills" },
  { agent: "mcpjam", label: "MCPJam", projectPath: ".mcpjam/skills", globalPath: ".mcpjam/skills" },
  { agent: "moxby", label: "Moxby", projectPath: ".moxby/skills", globalPath: ".moxby/skills" },
  { agent: "ona", label: "Ona", projectPath: ".ona/skills", globalPath: ".ona/skills" },
  { agent: "openhands", label: "OpenHands", projectPath: ".openhands/skills", globalPath: ".openhands/skills" },
  { agent: "reasonix", label: "Reasonix", projectPath: ".reasonix/skills", globalPath: ".reasonix/skills" },
  { agent: "rovodev", label: "Rovo Dev", projectPath: ".rovodev/skills", globalPath: ".rovodev/skills" },
  { agent: "tinycloud", label: "Tinycloud", projectPath: ".tinycloud/skills", globalPath: ".tinycloud/skills" },
  { agent: "terramind", label: "Terramind", projectPath: ".terramind/skills", globalPath: ".terramind/skills" },
  { agent: "zencoder", label: "Zencoder", projectPath: ".zencoder/skills", globalPath: ".zencoder/skills" },
  { agent: "neovate", label: "Neovate", projectPath: ".neovate/skills", globalPath: ".neovate/skills" },
  { agent: "pochi", label: "Pochi", projectPath: ".pochi/skills", globalPath: ".pochi/skills" },
  { agent: "adal", label: "AdaL", projectPath: ".adal/skills", globalPath: ".adal/skills" },
  { agent: "astrbot", label: "AstrBot", projectPath: "data/skills", globalPath: ".astrbot/data/skills" },
  { agent: "autohand", label: "Autohand Code CLI", projectPath: ".autohand/skills", globalPath: ".autohand/skills" },
  { agent: "bob", label: "IBM Bob", projectPath: ".bob/skills", globalPath: ".bob/skills" },
  { agent: "openclaw", label: "OpenClaw", projectPath: "skills", globalPath: ".openclaw/skills" },
  { agent: "codestudio", label: "Code Studio", projectPath: ".codestudio/skills", globalPath: ".codestudio/skills" },
  { agent: "dexto", label: "Dexto", projectPath: ".agents/skills", globalPath: ".agents/skills" },
  { agent: "kimi-code-cli", label: "Kimi Code CLI", projectPath: ".agents/skills", globalPath: ".agents/skills" },
  { agent: "loaf", label: "Loaf", projectPath: ".agents/skills", globalPath: ".agents/skills" },
  { agent: "inference-sh", label: "inference.sh", projectPath: ".inferencesh/skills", globalPath: ".inferencesh/skills" },
];

// ── Utility exports ──────────────────────────────────────────────────────

export { formatBaseDir };
