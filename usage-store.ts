/**
 * Usage Tracker - 技能使用次数追踪
 *
 * 通过 hook pi 的 read tool，当读取以 SKILL.md 结尾的文件时自增计数
 * 存储位置: ~/.pi/agent/extensions/show-skills/usage.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
const CONFIG_DIR = join(HOME, ".pi", "show-skills");
const USAGE_FILE = join(CONFIG_DIR, "usage.json");
const SETTINGS_FILE = join(CONFIG_DIR, "settings.json");

export interface UsageData {
  skills: Record<string, { count: number; lastUsed: string }>;
}

export interface ShowSkillsSettings {
  usageTrackingEnabled: boolean;
  language: "auto" | "zh" | "en";
}

export function loadSettings(): ShowSkillsSettings {
  try {
    if (!existsSync(SETTINGS_FILE)) return { usageTrackingEnabled: true, language: "auto" };
    const data = JSON.parse(readFileSync(SETTINGS_FILE, "utf-8"));
    return {
      usageTrackingEnabled: data.usageTrackingEnabled !== false,
      language: data.language === "zh" || data.language === "en" ? data.language : "auto",
    };
  } catch {
    return { usageTrackingEnabled: true, language: "auto" };
  }
}

export function saveSettings(settings: Partial<ShowSkillsSettings>): ShowSkillsSettings {
  const updated = { ...loadSettings(), ...settings };
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));
  } catch {}
  return updated;
}

export function loadUsage(): UsageData {
  try {
    if (!existsSync(USAGE_FILE)) return { skills: {} };
    const data = JSON.parse(readFileSync(USAGE_FILE, "utf-8"));
    return { skills: data.skills || {} };
  } catch {
    return { skills: {} };
  }
}

export function incrementUsage(skillName: string): void {
  const data = loadUsage();
  const existing = data.skills[skillName] || { count: 0, lastUsed: "" };
  existing.count++;
  existing.lastUsed = new Date().toISOString();
  data.skills[skillName] = existing;
  saveUsage(data);
}

export function getUsage(skillName: string): { count: number; lastUsed: string } {
  const data = loadUsage();
  return data.skills[skillName] || { count: 0, lastUsed: "" };
}

export function getAllUsage(): UsageData {
  return loadUsage();
}

function saveUsage(data: UsageData): void {
  try {
    mkdirSync(dirname(USAGE_FILE), { recursive: true });
    writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2));
  } catch {}
}
