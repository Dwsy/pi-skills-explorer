/**
 * Skills HTTP Server
 *
 * Routes:
 *   GET /                 -> index.html
 *   GET /app.js           -> frontend JS (Alpine app)
 *   GET /style.css        -> stylesheet
 *   GET /alpine.min.js    -> Alpine.js (local)
 *   GET /api/skills       -> all skills (summary)
 *   GET /api/skill/:name  -> single skill detail
 *   GET /api/file?path=   -> read associated file
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadAllSkills, type SkillInfo } from "./skill-loader.js";
import { getAllMeta, getCategories, getMeta, setMeta } from "./meta-store.js";
import { getAllUsage, getUsage, loadSettings, saveSettings } from "./usage-store.js";

const HOME = homedir();
const TEXT_EXTENSIONS = new Set([
  ".md",".txt",".ts",".js",".tsx",".jsx",".mjs",".cjs",".json",".json5",".jsonc",
  ".yaml",".yml",".toml",".ini",".cfg",".conf",".config",".env",".properties",
  ".py",".pyi",".pyw",".sh",".bash",".zsh",".fish",".ps1",".bat",".cmd",
  ".go",".rs",".java",".c",".cpp",".cc",".cxx",".h",".hpp",".hh",".hxx",
  ".css",".scss",".sass",".less",".stylus",".html",".htm",".xhtml",".xml",".svg",
  ".rb",".php",".phtml",".swift",".kt",".kts",".scala",".groovy",".gradle",
  ".lua",".r",".dart",".ex",".exs",".erl",".clj",".cljs",".edn",".lisp",
  ".sql",".graphql",".gql",".proto",".thrift",".pegjs",".wasm",".wat",
  ".gitignore",".gitattributes",".dockerignore",".npmignore",".editorconfig",
  ".dockerfile",".makefile",".cmake",".ninja",".csv",".tsv",".log",
  ".vue",".svelte",".astro",".elm",".purs",".hs",".ml",".mli",".fs",".fsx",
  ".cs",".vb",".fsi",".ml4",".mll",".mly",".j",".pl",".pm",".t",
  ".sol",".vy",".move",".cairo",".aptos",".sui",".aleo",
  ".tex",".bib",".rst",".adoc",".asciidoc",".org",".pod",
  ".patch",".diff",".rej",
]);

// Resolve public dir relative to this module file
const _filename = typeof __filename !== "undefined"
  ? __filename
  : fileURLToPath(import.meta.url);
const PUBLIC_DIR = join(dirname(_filename), "public");
const CONFIG_DIR = join(HOME, ".pi", "show-skills");
const FAVORITES_FILE = join(CONFIG_DIR, "favorites.json");
const SERVER_FILE = join(CONFIG_DIR, "server.json");

// ── Favorites persistence ─────────────────────────────────────────────────
function loadFavorites(): string[] {
  try {
    if (!existsSync(FAVORITES_FILE)) return [];
    const data = JSON.parse(readFileSync(FAVORITES_FILE, "utf-8"));
    return Array.isArray(data) ? data : (Array.isArray(data.skills) ? data.skills : []);
  } catch { return []; }
}
function saveFavorites(skills: string[]): void {
  try {
    mkdirSync(dirname(FAVORITES_FILE), { recursive: true });
    writeFileSync(FAVORITES_FILE, JSON.stringify({ skills, updatedAt: new Date().toISOString() }, null, 2));
  } catch {}
}

export interface SkillsServerOptions {
  port: number;
  skills: SkillInfo[];
  autoOpen: boolean;
  projectPath?: string;
}

export class SkillsServer {
  private server: Server | null = null;
  private port: number;
  private skills: SkillInfo[];
  private autoOpen: boolean;
  private projectPath: string | null;

  constructor(options: SkillsServerOptions) {
    this.port = options.port;
    this.skills = options.skills;
    this.autoOpen = options.autoOpen;
    this.projectPath = options.projectPath ? resolve(options.projectPath) : null;
  }

  getPort(): number { return this.port; }

  getUrl(): string { return `http://127.0.0.1:${this.port}`; }

  getProjectPath(): string | null { return this.projectPath; }

  isRunning(): boolean { return this.server !== null && this.server.listening; }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          this.port = randomPort();
          this.server = null;
          this.start().then(resolve).catch(reject);
        } else { reject(err); }
      });
      this.server.listen(this.port, "127.0.0.1", () => {
        this.writeServerState();
        if (this.autoOpen) this.openBrowser(this.getUrl());
        resolve();
      });
    });
  }

  stop(): void {
    if (this.server) { this.server.close(); this.server = null; }
  }

  private writeServerState(): void {
    try {
      mkdirSync(CONFIG_DIR, { recursive: true });
      writeFileSync(SERVER_FILE, JSON.stringify({
        pid: process.pid,
        port: this.port,
        url: this.getUrl(),
        projectPath: this.projectPath,
        updatedAt: new Date().toISOString(),
      }, null, 2));
    } catch {}
  }

  private applyProjectPath(url: URL): void {
    const requested = url.searchParams.get("projectPath");
    if (!requested) return;
    const next = resolve(requested);
    if (next === this.projectPath) return;
    try {
      const stat = statSync(next);
      if (!stat.isDirectory()) return;
      this.projectPath = next;
      this.skills = loadAllSkills(next);
      this.writeServerState();
    } catch {}
  }

  private openBrowser(url: string): void {
    try {
      const p = process.platform;
      if (p === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
      else if (p === "win32") spawn("cmd", ["/c","start",url], { detached: true, stdio: "ignore" }).unref();
      else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    } catch {}
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
    const pathname = url.pathname;
    this.applyProjectPath(url);

    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    try {
      // ── Favicon ─────────────────────────────────────────────────────
      if (pathname === "/favicon.ico" || pathname === "/favicon.svg") {
        res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
        res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%231c1917" stroke-width="1.5"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>');
        return;
      }

      // ── API ──────────────────────────────────────────────────────────
      if (pathname === "/api/health") {
        this.sendJson(res, 200, {
          ok: true,
          pid: process.pid,
          port: this.port,
          url: this.getUrl(),
          projectPath: this.projectPath,
        });
        return;
      }
      if (pathname === "/api/skills") {
        const favs = loadFavorites();
        const usage = getAllUsage();
        this.sendJson(res, 200, {
          skills: this.skills.map(s => ({ ...this.summary(s), favorited: favs.includes(s.name) })),
          total: this.skills.length,
          enabledCount: this.skills.filter(s => s.enabled).length,
          favorites: favs,
          usage: usage.skills,
          categories: getCategories(),
          settings: loadSettings(),
          projectPath: this.projectPath,
        });
        return;
      }
      const m = pathname.match(/^\/api\/skill\/(.+)$/);
      if (m) {
        const name = decodeURIComponent(m[1]);
        const skill = this.skills.find(s => s.name === name);
        if (!skill) { this.sendJson(res, 404, { error: "Not found" }); return; }
        this.sendJson(res, 200, this.detail(skill));
        return;
      }
      if (pathname === "/api/file") {
        const fp = url.searchParams.get("path");
        if (!fp) { this.sendJson(res, 400, { error: "Missing path" }); return; }
        this.serveFile(res, fp);
        return;
      }

      // ── Favorites API ────────────────────────────────────────────────
      if (pathname === "/api/favorites" && req.method === "GET") {
        this.sendJson(res, 200, { skills: loadFavorites() });
        return;
      }
      if (pathname === "/api/favorites" && req.method === "POST") {
        this.handleFavoriteToggle(req, res);
        return;
      }
      if (pathname === "/api/meta" && req.method === "GET") {
        this.sendJson(res, 200, getAllMeta());
        return;
      }
      if (pathname === "/api/meta" && req.method === "POST") {
        this.handleMetaUpdate(req, res);
        return;
      }
      if (pathname === "/api/usage" && req.method === "GET") {
        this.sendJson(res, 200, getAllUsage());
        return;
      }
      if (pathname === "/api/settings" && req.method === "GET") {
        this.sendJson(res, 200, loadSettings());
        return;
      }
      if (pathname === "/api/settings" && req.method === "POST") {
        this.handleSettingsUpdate(req, res);
        return;
      }

      // ── Static files ────────────────────────────────────────────────
      if (pathname === "/" || pathname === "/index.html") {
        this.serveStatic(res, join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
        return;
      }
      if (pathname === "/app.js") {
        this.serveStatic(res, join(PUBLIC_DIR, "app.js"), "application/javascript; charset=utf-8");
        return;
      }
      if (pathname === "/style.css") {
        this.serveStatic(res, join(PUBLIC_DIR, "style.css"), "text/css; charset=utf-8");
        return;
      }
      if (pathname === "/alpine.min.js") {
        this.serveStatic(res, join(PUBLIC_DIR, "alpine.min.js"), "application/javascript; charset=utf-8");
        return;
      }

      this.sendJson(res, 404, { error: "Not found" });
    } catch (err: any) {
      this.sendJson(res, 500, { error: err?.message ?? "Internal error" });
    }
  }

  private async handleFavoriteToggle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const { name, action } = JSON.parse(body);
      if (!name || typeof name !== "string") {
        this.sendJson(res, 400, { error: "Missing 'name'" }); return;
      }
      let favorites = loadFavorites();
      if (action === "add") {
        if (!favorites.includes(name)) favorites.unshift(name);
      } else if (action === "remove") {
        favorites = favorites.filter(n => n !== name);
      } else if (action === "reorder") {
        const { order } = JSON.parse(body);
        if (Array.isArray(order)) {
          favorites = order.filter((n: string) => favorites.includes(n));
        }
      } else {
        this.sendJson(res, 400, { error: "Invalid action" }); return;
      }
      saveFavorites(favorites);
      this.sendJson(res, 200, { skills: favorites });
    } catch (err: any) {
      this.sendJson(res, 500, { error: err?.message ?? "Failed" });
    }
  }

  private async handleMetaUpdate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const { name, customDescription, category, notes } = JSON.parse(body);
      if (!name || typeof name !== "string") {
        this.sendJson(res, 400, { error: "Missing 'name'" }); return;
      }
      const meta = setMeta(name, { customDescription, category, notes });
      this.sendJson(res, 200, { name, meta, categories: getCategories() });
    } catch (err: any) {
      this.sendJson(res, 500, { error: err?.message ?? "Failed" });
    }
  }

  private async handleSettingsUpdate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const patch = JSON.parse(body);
      const settings = saveSettings({
        usageTrackingEnabled: patch.usageTrackingEnabled,
        language: patch.language,
      });
      this.sendJson(res, 200, settings);
    } catch (err: any) {
      this.sendJson(res, 500, { error: err?.message ?? "Failed" });
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    });
  }

  private serveStatic(res: ServerResponse, filePath: string, contentType: string): void {
    if (!existsSync(filePath)) {
      this.sendJson(res, 404, { error: "File not found: " + filePath });
      return;
    }
    const content = readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
    res.end(content);
  }

  private summary(s: SkillInfo) {
    const meta = getMeta(s.name) || {};
    const usage = getUsage(s.name);
    return {
      name: s.name,
      description: meta.customDescription || s.description,
      originalDescription: s.description,
      customDescription: meta.customDescription || "",
      category: meta.category || "",
      notes: meta.notes || "",
      metaUpdatedAt: meta.updatedAt,
      usageCount: usage.count,
      lastUsed: usage.lastUsed,
      enabled: s.enabled,
      disableModelInvocation: s.disableModelInvocation,
      source: s.sourceInfo.source,
      scope: s.sourceInfo.scope,
      origin: s.sourceInfo.origin,
      packageSource: s.sourceInfo.packageSource,
      agent: s.sourceInfo.agent,
      baseDir: shortPath(s.sourceInfo.baseDir),
      filePath: shortPath(s.filePath),
      isSymlink: s.isSymlink,
      fileCount: s.files.length,
    };
  }

  private detail(s: SkillInfo) {
    return {
      ...this.summary(s),
      body: s.body,
      realPath: s.realPath ? shortPath(s.realPath) : undefined,
      files: s.files.map(f => ({
        name: f.name, relativePath: f.relativePath, path: f.path,
        size: f.size, isMarkdown: f.isMarkdown, ext: extname(f.name),
      })),
    };
  }

  private serveFile(res: ServerResponse, filePath: string): void {
    const resolved = resolve(filePath);
    const agentDir = join(HOME, ".pi", "agent");
    const cwd = process.cwd();
    if (!resolved.startsWith(agentDir) && !resolved.startsWith(cwd) && !resolved.startsWith(HOME)) {
      this.sendJson(res, 403, { error: "Access denied" }); return;
    }
    if (!existsSync(resolved)) { this.sendJson(res, 404, { error: "File not found" }); return; }
    try {
      const stat = statSync(resolved);
      if (!stat.isFile()) { this.sendJson(res, 400, { error: "Not a file" }); return; }
      if (stat.size > 1024 * 1024) { this.sendJson(res, 413, { error: "Too large" }); return; }
      const content = readFileSync(resolved, "utf-8");
      this.sendJson(res, 200, {
        path: shortPath(resolved), content, size: stat.size,
        ext: extname(resolved),
        isText: TEXT_EXTENSIONS.has(extname(resolved)) || extname(resolved) === "",
      });
    } catch (err: any) { this.sendJson(res, 500, { error: err?.message }); }
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(JSON.stringify(data));
  }
}

function shortPath(p: string): string {
  if (p === HOME) return "~";
  if (p.startsWith(HOME)) return "~" + p.slice(HOME.length);
  return p;
}

function randomPort(): number {
  return 49152 + Math.floor(Math.random() * (65535 - 49152));
}
