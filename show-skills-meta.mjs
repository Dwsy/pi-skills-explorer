#!/usr/bin/env node
/**
 * show-skills-meta CLI
 *
 * Node-based agent-facing helper for managing Skills Explorer metadata.
 * Stores data in ~/.pi/show-skills/skill-meta.json and matches by skill name.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
const CONFIG_DIR = join(HOME, ".pi", "show-skills");
const META_FILE = join(CONFIG_DIR, "skill-meta.json");
const SKILL_ROOTS = [
  join(HOME, ".pi", "agent", "skills"),
  join(HOME, ".agents", "skills"),
  join(process.cwd(), ".pi", "skills"),
];

function loadStore() {
  try {
    if (!existsSync(META_FILE)) return { skills: {} };
    const data = JSON.parse(readFileSync(META_FILE, "utf-8"));
    return { skills: data.skills || data || {} };
  } catch {
    return { skills: {} };
  }
}

function saveStore(store) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(META_FILE, JSON.stringify(store, null, 2));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

function discoverSkills() {
  const names = new Set();
  for (const root of SKILL_ROOTS) scan(root, names);
  return Array.from(names).sort();
}

function scan(dir, names) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (!st.isDirectory()) continue;
    const skillFile = findSkillFile(full);
    if (skillFile) names.add(readSkillName(skillFile) || basename(full));
    else scan(full, names);
  }
}

function findSkillFile(dir) {
  for (const name of ["SKILL.md", "SKILL.MD", "skill.md"]) {
    const file = join(dir, name);
    if (existsSync(file)) return file;
  }
  return null;
}

function readSkillName(skillFile) {
  try {
    const text = readFileSync(skillFile, "utf-8");
    const m = text.match(/^name:\s*["']?([^"'\n]+)["']?/m);
    return m ? m[1].trim() : basename(dirname(skillFile));
  } catch { return null; }
}

function printJson(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

function usage() {
  process.stderr.write(`Usage:
  node ~/.pi/show-skills/show-skills-meta.mjs list [--all]
  node ~/.pi/show-skills/show-skills-meta.mjs query <skill-name>
  node ~/.pi/show-skills/show-skills-meta.mjs set <skill-name> [--description text] [--category text] [--notes text]

Data: ${META_FILE}
`);
  process.exit(1);
}

const [cmd, name, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const store = loadStore();

if (cmd === "list") {
  const known = args.all ? discoverSkills() : Object.keys(store.skills).sort();
  printJson(known.map((skill) => ({ name: skill, meta: store.skills[skill] || {} })));
} else if (cmd === "query") {
  if (!name) usage();
  printJson({ name, meta: store.skills[name] || {} });
} else if (cmd === "set") {
  if (!name) usage();
  const current = store.skills[name] || {};
  const next = { ...current, updatedAt: new Date().toISOString() };
  if (typeof args.description === "string") next.customDescription = args.description;
  if (typeof args.category === "string") next.category = args.category;
  if (typeof args.notes === "string") next.notes = args.notes;
  store.skills[name] = next;
  saveStore(store);
  printJson({ name, meta: next, file: META_FILE });
} else {
  usage();
}
