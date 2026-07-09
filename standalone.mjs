#!/usr/bin/env node
/**
 * Standalone runner for show-skills.
 *
 * Runs the Skills Explorer WebUI without loading Pi extension APIs.
 * It reuses the existing TypeScript source files by creating a tiny .mjs cache
 * under ~/.pi/show-skills/standalone-cache.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripTypeScriptTypes } from "node:module";

const THIS_FILE = fileURLToPath(import.meta.url);
const EXTENSION_ROOT = dirname(THIS_FILE);
const CONFIG_DIR = join(homedir(), ".pi", "show-skills");
const CACHE_DIR = join(CONFIG_DIR, "standalone-cache");
const SERVER_FILE = join(CONFIG_DIR, "server.json");
const TS_FILES = [
  "meta-store.ts",
  "usage-store.ts",
  "skill-loader.ts",
  "server.ts",
];

function parseArgs(argv) {
  const out = { port: 9488, autoOpen: true, projectPath: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--no-open") out.autoOpen = false;
    else if (arg === "--project") {
      const next = argv[i + 1];
      if (!next) throw new Error("--project requires a path");
      out.projectPath = resolve(next);
      i++;
    } else if (arg === "--port") {
      const next = Number(argv[i + 1]);
      if (!Number.isInteger(next) || next < 1 || next > 65535) {
        throw new Error("--port must be an integer between 1 and 65535");
      }
      out.port = next;
      i++;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error("Unknown argument: " + arg);
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(`Usage:
  node standalone.mjs [--port 9488] [--project /path/to/project] [--no-open]

By default, standalone mode does not read project-level .pi/skills or .pi/settings.json.
Use --project or the Web URL projectPath query parameter to opt in.

Examples:
  node ~/.pi/agent/extensions/show-skills/standalone.mjs
  node ~/.pi/agent/extensions/show-skills/standalone.mjs --port 9490 --no-open
  node ~/.pi/agent/extensions/show-skills/standalone.mjs --project "$PWD"
`);
}

function compileSource(fileName) {
  const sourcePath = join(EXTENSION_ROOT, fileName);
  if (!existsSync(sourcePath)) throw new Error("Missing source file: " + sourcePath);

  let source = readFileSync(sourcePath, "utf-8");
  source = source.replace(/from\s+["']\.\/(meta-store|usage-store|skill-loader|server)\.js["']/g, 'from "./$1.mjs"');
  source = source.replace(/import\(["']\.\/(meta-store|usage-store|skill-loader|server)\.js["']\)/g, 'import("./$1.mjs")');
  if (fileName === "server.ts") {
    source = source.replace(
      'const PUBLIC_DIR = join(dirname(_filename), "public");',
      'const PUBLIC_DIR = ' + JSON.stringify(join(EXTENSION_ROOT, "public")) + ';',
    );
  }
  return stripTypeScriptTypes(source, { mode: "transform" });
}

function buildCache() {
  mkdirSync(CACHE_DIR, { recursive: true });
  for (const file of TS_FILES) {
    const outName = file.replace(/\.ts$/, ".mjs");
    writeFileSync(join(CACHE_DIR, outName), compileSource(file));
  }
}

function openBrowser(url) {
  try {
    const p = process.platform;
    if (p === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    else if (p === "win32") spawn("cmd", ["/c", "start", url], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {}
}

async function findReusableServer(projectPath) {
  try {
    if (!existsSync(SERVER_FILE)) return null;
    const state = JSON.parse(readFileSync(SERVER_FILE, "utf-8"));
    if (!state?.port || !state?.url) return null;
    const res = await fetch(`http://127.0.0.1:${state.port}/api/health`, { signal: AbortSignal.timeout(800) });
    if (!res.ok) return null;
    const health = await res.json();
    const current = health.projectPath ? resolve(health.projectPath) : null;
    const requested = projectPath ? resolve(projectPath) : null;
    if (current !== requested) return null;
    return health;
  } catch { return null; }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const reusable = await findReusableServer(options.projectPath);
  if (reusable) {
    process.stdout.write(`Reusing Skills Explorer at ${reusable.url}\n`);
    if (options.autoOpen) openBrowser(reusable.url);
    return;
  }

  buildCache();

  const loader = await import(pathToFileURL(join(CACHE_DIR, "skill-loader.mjs")).href + "?t=" + Date.now());
  const serverModule = await import(pathToFileURL(join(CACHE_DIR, "server.mjs")).href + "?t=" + Date.now());

  const skills = loader.loadAllSkills(options.projectPath);
  const server = new serverModule.SkillsServer({
    port: options.port,
    skills,
    autoOpen: options.autoOpen,
    projectPath: options.projectPath,
  });

  await server.start();
  process.stdout.write(`Skills Explorer running at ${server.getUrl()}\n`);
  process.stdout.write(`${skills.length} skills loaded. Press Ctrl+C to stop.\n`);

  const stop = () => {
    server.stop();
    process.stdout.write("Skills Explorer stopped.\n");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  process.stderr.write((err?.stack || err?.message || String(err)) + "\n");
  process.exit(1);
});
