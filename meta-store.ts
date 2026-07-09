/**
 * Meta Store - 技能自定义元数据存储
 *
 * 存储用户对技能的自定义描述、分类、备注
 * 按技能名称匹配（不依赖路径），不修改原始文件
 *
 * 存储位置: ~/.pi/agent/extensions/show-skills/skill-meta.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
const META_FILE = join(HOME, ".pi", "show-skills", "skill-meta.json");

export interface SkillMeta {
  customDescription?: string;
  category?: string;
  notes?: string;
  updatedAt?: string;
}

export interface MetaStore {
  skills: Record<string, SkillMeta>;
}

export function loadMeta(): MetaStore {
  try {
    if (!existsSync(META_FILE)) return { skills: {} };
    const data = JSON.parse(readFileSync(META_FILE, "utf-8"));
    return { skills: data.skills || data || {} };
  } catch {
    return { skills: {} };
  }
}

export function getMeta(name: string): SkillMeta | undefined {
  const store = loadMeta();
  return store.skills[name];
}

export function setMeta(name: string, meta: Partial<SkillMeta>): SkillMeta {
  const store = loadMeta();
  const existing = store.skills[name] || {};
  const updated: SkillMeta = {
    ...existing,
    ...meta,
    updatedAt: new Date().toISOString(),
  };
  store.skills[name] = updated;
  saveMeta(store);
  return updated;
}

export function deleteMeta(name: string): void {
  const store = loadMeta();
  delete store.skills[name];
  saveMeta(store);
}

export function getAllMeta(): MetaStore {
  return loadMeta();
}

/** 获取所有分类列表 */
export function getCategories(): string[] {
  const store = loadMeta();
  const cats = new Set<string>();
  for (const meta of Object.values(store.skills)) {
    if (meta.category) cats.add(meta.category);
  }
  return Array.from(cats).sort();
}

function saveMeta(store: MetaStore): void {
  try {
    mkdirSync(dirname(META_FILE), { recursive: true });
    writeFileSync(META_FILE, JSON.stringify(store, null, 2));
  } catch {}
}
