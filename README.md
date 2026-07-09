# Pi Skills Explorer

A Pi extension that launches a local Web UI for browsing, inspecting, classifying, translating, and annotating agent skills.

It is designed for large skill libraries where many skills come from different places: Pi user skills, project skills, installed packages, and other supported agent directories such as Claude Code, Codex, Hermes, Cursor, and more.

> "The details are not the details. They make the design." — Charles Eames

## Features

- `/show-skills` slash command for Pi.
- Standalone mode that runs without Pi.
- Local Web UI for browsing skills and associated files.
- Source, scope, agent, enabled/disabled, favorite, and search filters.
- Custom metadata per skill:
  - custom display description
  - category
  - notes
- Metadata is matched by **skill name**, not file path.
- Metadata is stored outside original skill files and never mutates `SKILL.md`.
- Favorites / pinned skills.
- Usage statistics from Pi `read` tool events.
- Right-side associated file browser with built-in lightweight code highlighting.
- URL routing for current skill pages, for example `/?skill=agent-browser`.
- Optional project-level skill loading via `?projectPath=/path/to/project`.
- English / Chinese UI switching.
- Bundled helper skill for agents: `show-skills-meta`.

## Screenshots

Run the extension and open the local Web UI:

```bash
/show-skills
```

Or run standalone:

```bash
node standalone.mjs
```

## Installation

### As a Pi package / extension

This package exposes both an extension and a bundled skill through `package.json`:

```json
{
  "pi": {
    "extensions": ["."],
    "skills": ["./skills"]
  }
}
```

After installing or placing the extension in a Pi extension directory, reload Pi:

```text
/reload
/show-skills
```

### Local extension directory

For local development, place the directory under:

```text
~/.pi/agent/extensions/show-skills/
```

Then reload Pi:

```text
/reload
```

## Usage

### Pi slash command

```text
/show-skills
/show-skills --port 9488
/show-skills --no-open
/show-skills stop
```

The command starts a local HTTP server and opens the Web UI unless `--no-open` is used.

### Standalone mode

Standalone mode does not require Pi extension APIs. It reuses the same loader and HTTP server.

```bash
node standalone.mjs
node standalone.mjs --port 9490 --no-open
node standalone.mjs --project "$PWD"
```

By default, standalone mode does **not** read project-level `.pi/skills` or `.pi/settings.json`. Use `--project` or the Web URL `projectPath` query parameter to opt in.

## Project-level skills

The Web UI is global by default. It does not bind itself to the current shell working directory.

To include project-level skills, pass a project path through the URL:

```text
http://127.0.0.1:9488/?projectPath=/path/to/project
```

You can combine this with skill routing:

```text
http://127.0.0.1:9488/?projectPath=/path/to/project&skill=my-skill
```

## Skill routing

The current skill is stored in the URL:

```text
/?skill=knowledge-base
```

This makes skill pages refreshable and shareable.

## Configuration files

Runtime data is stored in:

```text
~/.pi/show-skills/
```

Important files:

```text
~/.pi/show-skills/skill-meta.json       # custom descriptions, categories, notes
~/.pi/show-skills/favorites.json        # pinned / favorite skills
~/.pi/show-skills/usage.json            # read usage statistics
~/.pi/show-skills/settings.json         # UI language and usage tracking settings
~/.pi/show-skills/server.json           # currently running server info
~/.pi/show-skills/extension.json        # real extension path pointer
~/.pi/show-skills/show-skills-meta.mjs  # stable metadata CLI wrapper
```

## Custom skill metadata

Custom metadata is stored by skill name:

```json
{
  "skills": {
    "agent-browser": {
      "customDescription": "Browser automation for opening pages, clicking, filling forms, screenshots, and extraction.",
      "category": "Browser Automation",
      "notes": "Use for real Web UI verification. Open first, then snapshot -i to obtain refs.",
      "updatedAt": "2026-07-09T00:00:00.000Z"
    }
  }
}
```

Original `SKILL.md` files are not modified.

## Agent helper skill

This extension bundles a skill named `show-skills-meta`.

Use it when an agent needs to classify skills, add Chinese translations, improve searchability, or query metadata.

The stable CLI wrapper is:

```bash
node ~/.pi/show-skills/show-skills-meta.mjs list
node ~/.pi/show-skills/show-skills-meta.mjs list --all
node ~/.pi/show-skills/show-skills-meta.mjs query agent-browser
node ~/.pi/show-skills/show-skills-meta.mjs set agent-browser \
  --description "Browser automation for opening pages, clicking, filling forms, screenshots, and extraction." \
  --category "Browser Automation" \
  --notes "Use for real Web UI verification."
```

The wrapper resolves the real extension path from:

```text
~/.pi/show-skills/extension.json
```

This allows the extension to work whether it is installed as a user extension, project extension, npm package, or git package.

## Usage statistics

When loaded inside Pi, the extension listens to `read` tool results. If the file path ends with any of the following case variants, the matching skill usage count is incremented:

```text
SKILL.md
SKILL.MD
skill.md
```

Usage tracking is enabled by default and can be disabled in the Web UI.

## Server reuse and ports

The server exposes:

```text
GET /api/health
```

Server state is stored at:

```text
~/.pi/show-skills/server.json
```

Standalone mode checks this file and reuses an existing compatible server when possible. If the requested port is busy, the server falls back to a random high port.

## API endpoints

```text
GET  /api/health
GET  /api/skills
GET  /api/skill/:name
GET  /api/file?path=...
GET  /api/favorites
POST /api/favorites
GET  /api/meta
POST /api/meta
GET  /api/usage
GET  /api/settings
POST /api/settings
```

## Development

Check JavaScript files:

```bash
npm run check
```

Run standalone:

```bash
npm run start
```

The standalone runner uses Node's TypeScript stripping support and creates a small cache under:

```text
~/.pi/show-skills/standalone-cache/
```

## Design notes

- No CDN is required at runtime. Alpine.js is served locally from `public/alpine.min.js`.
- The UI avoids mutating original skill files.
- Associated files include the original skill entry file and keep it at the top.
- Clicking `SKILL.md` keeps the skill header and metadata visible.
- Clicking other associated files focuses the file viewer and hides unrelated detail sections.

## License

MIT
