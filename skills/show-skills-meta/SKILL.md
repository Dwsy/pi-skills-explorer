---
name: show-skills-meta
description: Manage Skills Explorer metadata for Pi skills: list/query/set custom Chinese descriptions, categories, and notes stored in ~/.pi/show-skills/skill-meta.json without modifying original SKILL.md files.
---

# show-skills-meta

Use this skill when the user asks to classify skills, add Chinese descriptions, add notes, query skill metadata, or improve skill searchability in the Skills Explorer extension.

Data is stored outside original skill files:

```text
~/.pi/show-skills/skill-meta.json
```

The real extension path may be user-level, project-level, npm, or git installed. Do **not** hardcode it. The extension writes a stable wrapper here:

```text
~/.pi/show-skills/show-skills-meta.mjs
```

That wrapper forwards to the real extension CLI path recorded in:

```text
~/.pi/show-skills/extension.json
```

Matching key is always the **skill name**, not file path.

## Commands

Run from any working directory:

```bash
node ~/.pi/show-skills/show-skills-meta.mjs list
node ~/.pi/show-skills/show-skills-meta.mjs list --all
node ~/.pi/show-skills/show-skills-meta.mjs query <skill-name>
node ~/.pi/show-skills/show-skills-meta.mjs set <skill-name> --description "中文描述" --category "分类" --notes "备注"
```

## Workflow

1. Use `list --all` to see discoverable skill names.
2. Use `query <skill-name>` before changing an entry.
3. Use `set` to add or update:
   - `--description`: custom display description, often Chinese translation.
   - `--category`: coarse retrieval category, e.g. `浏览器自动化`, `知识管理`, `Pi扩展开发`.
   - `--notes`: practical notes, caveats, or when to use it.
4. Do not edit original `SKILL.md` files for metadata-only changes.

## Examples

```bash
node ~/.pi/show-skills/show-skills-meta.mjs set agent-browser \
  --description "浏览器自动化：打开网页、点击、填表、截图和抽取页面内容" \
  --category "浏览器自动化" \
  --notes "适合真实 Web UI 验证；先 open，再 snapshot -i 获取 refs。"
```

```bash
node ~/.pi/show-skills/show-skills-meta.mjs query agent-browser
```
