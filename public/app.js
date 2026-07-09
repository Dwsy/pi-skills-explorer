/**
 * Skills Explorer - Alpine.js Application
 */

function skillsApp() {
  return {
    // ── State ──────────────────────────────────────────────────────
    loading: true,
    detailLoading: false,
    allSkills: [],
    total: 0,
    enabledCount: 0,
    search: "",
    currentFilter: "all",
    sourceFilter: "",
    scopeFilter: "",
    agentFilter: "",
    agentDropdownOpen: false,
    filters: [
      { key: "all", label: "All" },
      { key: "enabled", label: "Enabled" },
      { key: "disabled", label: "Disabled" },
      { key: "package", label: "Packages" },
      { key: "fav", label: "★" },
    ],
    selectedName: null,
    selected: null,
    activeFilePath: null,
    fileViewer: { open: false, path: "", content: "", loading: false, error: null },
    fileTree: [],
    _expandedDirs: {},
    favorites: [],
    favOnly: false,
    usage: {},
    categories: [],
    settings: { usageTrackingEnabled: true, language: "auto" },
    lang: "en",
    editingMeta: false,
    metaDraft: { customDescription: "", category: "", notes: "" },
    projectPath: "",

    // ── Computed: agent list ───────────────────────────────────────
    get agentList() {
      var s = new Set();
      this.allSkills.forEach(function (sk) {
        if (sk.agent) s.add(sk.agent);
      });
      return Array.from(s).sort();
    },

    // ── Computed: filtered skills ──────────────────────────────────
    get filteredSkills() {
      var f = this.allSkills;
      if (this.currentFilter === "enabled") f = f.filter(s => s.enabled);
      else if (this.currentFilter === "disabled") f = f.filter(s => !s.enabled);
      else if (this.currentFilter === "package") f = f.filter(s => s.origin === "package");
      else if (this.currentFilter === "fav") f = f.filter(s => this.favorites.includes(s.name));
      if (this.sourceFilter) f = f.filter(s => s.source === this.sourceFilter);
      if (this.scopeFilter) f = f.filter(s => s.scope === this.scopeFilter);
      if (this.agentFilter) f = f.filter(s => s.agent === this.agentFilter);
      if (this.search) {
        var q = this.search.toLowerCase();
        f = f.filter(s =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          (s.originalDescription || "").toLowerCase().includes(q) ||
          (s.category || "").toLowerCase().includes(q) ||
          (s.notes || "").toLowerCase().includes(q) ||
          (s.packageSource || "").toLowerCase().includes(q) ||
          (s.agent || "").toLowerCase().includes(q)
        );
      }
      // Sort: favorites first (in fav order), then alphabetical
      var self = this;
      return f.slice().sort(function (a, b) {
        var ai = self.favorites.indexOf(a.name);
        var bi = self.favorites.indexOf(b.name);
        if (ai >= 0 && bi < 0) return -1;
        if (ai < 0 && bi >= 0) return 1;
        if (ai >= 0 && bi >= 0) return ai - bi;
        return a.name.localeCompare(b.name);
      });
    },

    // ── Computed: dashboard data ───────────────────────────────────
    get sourceBreakdown() {
      var counts = {};
      this.allSkills.forEach(function (s) {
        counts[s.source] = (counts[s.source] || 0) + 1;
      });
      var labels = { auto: "Auto", agent: "Agent", git: "Git", npm: "NPM", local: "Settings" };
      var colors = { auto: "var(--green)", agent: "var(--blue)", git: "var(--amber)", npm: "var(--purple, var(--text-2))", local: "var(--text-3)" };
      var total = this.allSkills.length || 1;
      return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).map(function (key) {
        return {
          key: key,
          label: labels[key] || key,
          count: counts[key],
          percent: Math.round((counts[key] / total) * 100),
          color: colors[key] || "var(--text-3)",
        };
      });
    },

    get agentBreakdown() {
      var counts = {};
      this.allSkills.forEach(function (s) {
        if (s.agent) counts[s.agent] = (counts[s.agent] || 0) + 1;
      });
      return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).map(function (key) {
        return { agent: key, count: counts[key] };
      });
    },

    get gallerySkills() {
      return this.allSkills.filter(s => s.enabled).slice(0, 24);
    },

    get favCount() {
      return this.favorites.length;
    },

    get totalUsage() {
      return this.allSkills.reduce(function (sum, s) { return sum + (s.usageCount || 0); }, 0);
    },

    get topUsedSkills() {
      return this.allSkills.filter(function (s) { return (s.usageCount || 0) > 0; })
        .sort(function (a, b) { return (b.usageCount || 0) - (a.usageCount || 0); })
        .slice(0, 8);
    },

    // ── Init ───────────────────────────────────────────────────────
    async init() {
      this.initTheme();
      this.initLanguage();
      this.setupShortcuts();
      this.initProjectPath();
      window.addEventListener("popstate", () => this.restoreRoute(false));
      try {
        var data = await this.fetchJSON("/api/skills");
        this.allSkills = data.skills || [];
        this.total = data.total;
        this.enabledCount = data.enabledCount;
        this.favorites = data.favorites || [];
        this.usage = data.usage || {};
        this.categories = data.categories || [];
        this.settings = data.settings || this.settings;
        this.applyLanguageSetting();
        this.restoreRoute(true);
      } catch (err) {
        console.error("Failed to load skills:", err);
      } finally {
        this.loading = false;
      }
    },

    // ── Theme ──────────────────────────────────────────────────────
    initTheme() {
      var saved = localStorage.getItem("skills-theme");
      if (saved) document.documentElement.setAttribute("data-theme", saved);
      else {
        var dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
      }
    },
    toggleTheme() {
      var cur = document.documentElement.getAttribute("data-theme");
      var next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("skills-theme", next);
    },

    // ── i18n ───────────────────────────────────────────────────────
    initLanguage() {
      var saved = localStorage.getItem("skills-lang");
      this.settings.language = saved || "auto";
      this.applyLanguageSetting();
    },
    applyLanguageSetting() {
      var pref = this.settings.language || "auto";
      var browserZh = (navigator.language || "").toLowerCase().startsWith("zh");
      this.lang = pref === "auto" ? (browserZh ? "zh" : "en") : pref;
      document.documentElement.setAttribute("lang", this.lang === "zh" ? "zh-CN" : "en");
    },
    async setLanguage(lang) {
      this.settings.language = lang;
      this.applyLanguageSetting();
      localStorage.setItem("skills-lang", lang);
      try {
        this.settings = await this.fetchJSON("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: lang }),
        });
        this.applyLanguageSetting();
      } catch (err) { console.error("Failed to save language:", err); }
    },
    t(key) {
      var dict = I18N[this.lang] || I18N.en;
      return dict[key] || I18N.en[key] || key;
    },

    async toggleUsageTracking() {
      var next = !this.settings.usageTrackingEnabled;
      try {
        this.settings = await this.fetchJSON("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usageTrackingEnabled: next }),
        });
      } catch (err) { console.error("Failed to save settings:", err); }
    },

    // ── Routing / Shortcuts ────────────────────────────────────────
    initProjectPath() {
      var params = new URLSearchParams(window.location.search);
      this.projectPath = params.get("projectPath") || "";
    },

    setupShortcuts() {
      window.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
          e.preventDefault();
          if (this.$refs && this.$refs.searchInput) {
            this.$refs.searchInput.focus();
            this.$refs.searchInput.select();
          }
        }
      });
    },

    restoreRoute(allowMemory) {
      var params = new URLSearchParams(window.location.search);
      var routeSkill = params.get("skill");
      if (!routeSkill && allowMemory) routeSkill = localStorage.getItem("skills-current-skill");
      if (!routeSkill) {
        this.selectedName = null;
        this.selected = null;
        return;
      }
      if (!this.allSkills.some(s => s.name === routeSkill)) return;
      if (this.selectedName !== routeSkill) this.selectSkill(routeSkill, { replaceRoute: true });
    },

    updateRoute(name, replace) {
      var url = new URL(window.location.href);
      if (name) {
        url.searchParams.set("skill", name);
        localStorage.setItem("skills-current-skill", name);
      } else {
        url.searchParams.delete("skill");
        localStorage.removeItem("skills-current-skill");
      }
      var next = url.pathname + url.search + url.hash;
      if (replace) history.replaceState({ skill: name || null }, "", next);
      else history.pushState({ skill: name || null }, "", next);
    },

    // ── Skill Selection ────────────────────────────────────────────
    async selectSkill(name, options) {
      options = options || {};
      this.selectedName = name;
      this.updateRoute(name, !!options.replaceRoute);
      this.selected = null;
      this.detailLoading = true;
      this.fileViewer.open = false;
      this.activeFilePath = null;
      this.fileTree = [];
      this._expandedDirs = {};
      try {
        var s = await this.fetchJSON("/api/skill/" + encodeURIComponent(name));
        this.selected = s;
        this.metaDraft = {
          customDescription: s.customDescription || "",
          category: s.category || "",
          notes: s.notes || "",
        };
        this.editingMeta = false;
        this.rebuildTreeWithExpansion();
      } catch (err) {
        console.error("Failed to load skill:", err);
      } finally {
        this.detailLoading = false;
      }
    },

    selectFirstSkill() {
      var list = this.filteredSkills;
      if (list.length > 0) this.selectSkill(list[0].name);
    },

    // ── Favorites ──────────────────────────────────────────────────
    async toggleFavorite(name) {
      var isFav = this.favorites.includes(name);
      try {
        var data = await this.fetchJSON("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name, action: isFav ? "remove" : "add" }),
        });
        this.favorites = data.skills || [];
        // Update allSkills favorited flag
        this.allSkills.forEach(function (s) {
          s.favorited = this.includes(s.name);
        }, this.favorites);
      } catch (err) {
        console.error("Failed to toggle favorite:", err);
      }
    },

    isFavorite(name) {
      return this.favorites.includes(name);
    },

    isViewingSkillFile() {
      if (!this.fileViewer.open || !this.activeFilePath) return false;
      return /\/skill\.md$/i.test(String(this.activeFilePath).replace(/\\/g, "/"));
    },

    isViewingRegularFile() {
      return this.fileViewer.open && !this.isViewingSkillFile();
    },

    // ── Custom Meta ─────────────────────────────────────────────────
    async saveMeta() {
      if (!this.selected) return;
      try {
        var data = await this.fetchJSON("/api/meta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: this.selected.name,
            customDescription: this.metaDraft.customDescription,
            category: this.metaDraft.category,
            notes: this.metaDraft.notes,
          }),
        });
        this.categories = data.categories || this.categories;
        Object.assign(this.selected, {
          description: this.metaDraft.customDescription || this.selected.originalDescription,
          customDescription: this.metaDraft.customDescription,
          category: this.metaDraft.category,
          notes: this.metaDraft.notes,
          metaUpdatedAt: data.meta.updatedAt,
        });
        var item = this.allSkills.find(s => s.name === this.selected.name);
        if (item) Object.assign(item, {
          description: this.selected.description,
          customDescription: this.metaDraft.customDescription,
          category: this.metaDraft.category,
          notes: this.metaDraft.notes,
        });
        this.editingMeta = false;
      } catch (err) {
        console.error("Failed to save metadata:", err);
      }
    },

    cancelMetaEdit() {
      if (!this.selected) return;
      this.metaDraft = {
        customDescription: this.selected.customDescription || "",
        category: this.selected.category || "",
        notes: this.selected.notes || "",
      };
      this.editingMeta = false;
    },

    // ── File Tree ──────────────────────────────────────────────────
    rebuildTreeWithExpansion() {
      var files = this.selected ? this.selected.files : [];
      var root = { children: {} };
      var self = this;
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var parts = f.relativePath.split("/");
        var node = root;
        for (var j = 0; j < parts.length; j++) {
          var part = parts[j];
          var isLast = j === parts.length - 1;
          if (!node.children) node.children = {};
          if (isLast) {
            node.children[part] = { type: "file", name: part, path: f.path, size: f.size, ext: f.ext, depth: j, expanded: false };
          } else {
            var key = parts.slice(0, j + 1).join("/");
            if (!node.children[part]) {
              node.children[part] = { type: "dir", name: part, depth: j, expanded: self._expandedDirs[key] !== false, children: {} };
            }
            node = node.children[part];
          }
        }
      }
      var result = [];
      function walk(node, parentParts) {
        var entries = Object.values(node.children || {});
        entries.sort(function (a, b) {
          var aSkill = a.type === "file" && a.name.toLowerCase() === "skill.md";
          var bSkill = b.type === "file" && b.name.toLowerCase() === "skill.md";
          if (aSkill !== bSkill) return aSkill ? -1 : 1;
          if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        for (var k = 0; k < entries.length; k++) {
          var e = entries[k];
          if (e.type === "dir") {
            var dkey = parentParts.concat([e.name]).join("/");
            e.expanded = self._expandedDirs[dkey] !== false;
            result.push(e);
            if (e.expanded) walk(e, parentParts.concat([e.name]));
          } else {
            result.push(e);
          }
        }
      }
      walk(root, []);
      this.fileTree = result;
    },

    toggleDir(node) {
      // Reconstruct directory key
      var key = this._getDirKey(node);
      this._expandedDirs[key] = !node.expanded;
      this.rebuildTreeWithExpansion();
    },

    _getDirKey(node) {
      if (!this.selected || !this.selected.files) return node.name;
      for (var i = 0; i < this.selected.files.length; i++) {
        var parts = this.selected.files[i].relativePath.split("/");
        if (parts.length > node.depth && parts[node.depth] === node.name) {
          return parts.slice(0, node.depth + 1).join("/");
        }
      }
      return node.name;
    },

    // ── File Viewer ────────────────────────────────────────────────
    async openFileByPath(path) {
      this.activeFilePath = path;
      this.fileViewer = { open: true, path: path, content: "", loading: true, error: null };
      try {
        var data = await this.fetchJSON("/api/file?path=" + encodeURIComponent(path));
        this.fileViewer.content = data.content;
      } catch (err) {
        this.fileViewer.error = err.message;
      } finally {
        this.fileViewer.loading = false;
      }
    },
    closeFileViewer() {
      this.fileViewer.open = false;
      this.activeFilePath = null;
    },

    async readFile(path) {
      if (!path) return;
      try {
        var data = await this.fetchJSON("/api/file?path=" + encodeURIComponent(path));
        alert(data.content.slice(0, 5000) + (data.content.length > 5000 ? "\n... (truncated)" : ""));
      } catch (err) {
        alert("Cannot read: " + err.message);
      }
    },

    // ── API ────────────────────────────────────────────────────────
    withProjectPath(url) {
      if (!this.projectPath) return url;
      var u = new URL(url, window.location.origin);
      u.searchParams.set("projectPath", this.projectPath);
      return u.pathname + u.search;
    },

    async fetchJSON(url, options) {
      var res = await fetch(this.withProjectPath(url), options);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    },

    // ── Helpers ────────────────────────────────────────────────────
    truncate(s, n) { if (!s) return ""; return s.length > n ? s.slice(0, n) + "..." : s; },
    stripTilde(s) { if (s && s.startsWith("~")) return s.slice(1); return s; },
    formatSize(b) {
      if (b < 1024) return b + "B";
      if (b < 1048576) return (b / 1024).toFixed(1) + "KB";
      return (b / 1048576).toFixed(1) + "MB";
    },
    formatDate(s) {
      if (!s) return "—";
      try { return new Date(s).toLocaleString(this.lang === "zh" ? "zh-CN" : "en-US"); }
      catch { return s; }
    },

    renderHighlightedCode(code) {
      if (!code) return "";
      var comments = [];
      var escaped = escapeHtml(code).replace(/(\/\/.*$|#.*$|\/\*[\s\S]*?\*\/)/gm, function (m) {
        var token = "@@COMMENT_" + comments.length + "@@";
        comments.push('<span class="hl-comment">' + m + '</span>');
        return token;
      });
      escaped = escaped.replace(/\b(import|export|from|function|return|const|let|var|class|interface|type|if|else|for|while|try|catch|await|async|new|throw|extends|implements|public|private|protected|static|final|def|fn|struct|enum|match|case|switch|break|continue)\b/g, '<span class="hl-keyword">$1</span>');
      escaped = escaped.replace(/([{}()\[\]])/g, '<span class="hl-bracket">$1</span>');
      return escaped.replace(/@@COMMENT_(\d+)@@/g, function (_, i) { return comments[Number(i)] || ""; });
    },

    // ── Markdown Renderer ──────────────────────────────────────────
    renderMarkdown(md) {
      if (!md) return '<p style="color:var(--text-3)">No content</p>';
      var html = md;
      var FENCE = String.fromCharCode(96, 96, 96);
      var fenceRe = new RegExp(FENCE + "(\\w*)\n([\\s\\S]*?)" + FENCE, "g");
      html = html.replace(fenceRe, function (m, lang, code) { return '<pre><code>' + escapeHtml(code) + '</code></pre>'; });
      html = html.replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)*)/gm, function (m, header, sep, body) {
        var headers = header.split("|").filter(function (c) { return c.trim(); }).map(function (c) { return "<th>" + escapeHtml(c.trim()) + "</th>"; });
        var rows = body.trim().split("\n").map(function (row) {
          var cells = row.split("|").filter(function (c) { return c.trim(); }).map(function (c) { return "<td>" + escapeHtml(c.trim()) + "</td>"; });
          return "<tr>" + cells.join("") + "</tr>";
        });
        return '<table><thead><tr>' + headers.join("") + '</tr></thead><tbody>' + rows.join("") + '</tbody></table>';
      });
      html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
      html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
      html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
      html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
      var tick = String.fromCharCode(96);
      var inlineRe = new RegExp(tick + "([^" + tick + "]+)" + tick, "g");
      html = html.replace(inlineRe, "<code>$1</code>");
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
      html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");
      html = html.replace(/^---$/gm, "<hr>");
      html = html.replace(/^(\d+)\. (.+)$/gm, '<oli>$2</oli>');
      html = html.replace(/^[-*] (.+)$/gm, '<uli>$1</uli>');
      html = html.replace(/(<oli>[\s\S]*?<\/oli>)/g, "<ol>$1</ol>");
      html = html.replace(/(<uli>[\s\S]*?<\/uli>)/g, "<ul>$1</ul>");
      html = html.replace(/<\/(oli|uli)>\n<(?:oli|uli)>/g, "");
      html = html.split("\n\n").map(function (block) {
        block = block.trim();
        if (!block) return "";
        if (/^<(h[1-6]|pre|ul|ol|blockquote|table|hr)/.test(block)) return block;
        return "<p>" + block.replace(/\n/g, "<br>") + "</p>";
      }).join("\n");
      return html;

      function escapeHtml(s) {
        if (s == null) return "";
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      }
    },
  };
}


function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const I18N = {
  en: {
    search: "Search skills...", status: "Status", source: "Source", scope: "Scope", agent: "Agent",
    all: "All", enabled: "Enabled", disabled: "Disabled", packages: "Packages", user: "User", project: "Project",
    allAgents: "All Agents", loadingSkills: "Loading skills...", noMatchingSkills: "No matching skills",
    skills: "skills", on: "on", title: "Skills Explorer",
    subtitle: "Browse, classify, translate, and inspect all agent skills in one place",
    totalSkills: "Total Skills", favorites: "Favorites", agents: "Agents", reads: "Reads",
    bySource: "By Source", byAgent: "By Agent", topUsed: "Top Used Skills", enabledSkills: "Enabled Skills",
    loadingDetail: "Loading detail...", metadata: "Metadata", customMeta: "Custom Metadata", edit: "Edit",
    save: "Save", cancel: "Cancel", customDescription: "Custom Description", category: "Category", notes: "Notes",
    originalDescription: "Original Description", usageTracking: "Usage Tracking", lastUsed: "Last Used",
    filePath: "File Path", baseDir: "Base Dir", files: "Files", skillContent: "Skill Content",
    associatedFiles: "Associated Files", selectFile: "Select a file to view", loading: "Loading...", language: "Language"
  },
  zh: {
    search: "搜索技能...", status: "状态", source: "来源", scope: "范围", agent: "Agent",
    all: "全部", enabled: "启用", disabled: "禁用", packages: "包", user: "用户", project: "项目",
    allAgents: "全部 Agent", loadingSkills: "正在加载技能...", noMatchingSkills: "没有匹配技能",
    skills: "技能", on: "启用", title: "技能浏览器",
    subtitle: "集中浏览、分类、汉化、备注并检查所有 Agent 技能",
    totalSkills: "技能总数", favorites: "收藏", agents: "Agents", reads: "读取次数",
    bySource: "按来源", byAgent: "按 Agent", topUsed: "常用技能", enabledSkills: "已启用技能",
    loadingDetail: "正在加载详情...", metadata: "元信息", customMeta: "自定义元数据", edit: "编辑",
    save: "保存", cancel: "取消", customDescription: "自定义描述 / 汉化描述", category: "分类", notes: "备注",
    originalDescription: "原始描述", usageTracking: "使用统计", lastUsed: "最后使用",
    filePath: "文件路径", baseDir: "基础目录", files: "文件", skillContent: "技能正文",
    associatedFiles: "关联文件", selectFile: "选择左侧文件查看内容", loading: "加载中...", language: "语言"
  }
};
