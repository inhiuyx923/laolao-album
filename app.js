const state = {
  memories: [],
  baseMemories: [],
  order: [],
  reverseOrder: [],
  sortMode: "chronological",
  viewMode: "waterfall",
  selectedYears: new Set(),
  selectedMembers: new Set(),
  activePanel: null,
  activeMemoryId: null,
  apiPersistent: false,
  adminToken: "",
  localBackup: null,
  localBackupSupported: false,
  admin: {
    file: null,
    previewUrl: "",
    date: "",
    location: "",
    description: "",
    members: [],
    pickerOpen: false,
    uploading: false,
    editingId: null,
    editDraft: null,
    editPickerOpen: false,
    changeLog: [],
  },
};

const app = document.querySelector("#app");
let editBodyScrollBeforeFocus = 0;

const FAMILY_MEMBERS = [
  { name: "吴树山", group: "家庭0" },
  { name: "崔玉兰", group: "家庭0" },
  { name: "吴凤英", group: "家庭1" },
  { name: "王洪年", group: "家庭1" },
  { name: "王宇", group: "家庭1" },
  { name: "王淼", group: "家庭1" },
  { name: "郭艳娇", group: "家庭1" },
  { name: "王赫瑄", group: "家庭1" },
  { name: "王赫文", group: "家庭1" },
  { name: "吴桂焕", group: "家庭2" },
  { name: "缪雄", group: "家庭2" },
  { name: "缪迪姗", group: "家庭2" },
  { name: "李玉凯", group: "家庭2" },
  { name: "李伯瑞", group: "家庭2" },
  { name: "吴凤玉", group: "家庭3" },
  { name: "杨立杰", group: "家庭3" },
  { name: "杨潇", group: "家庭3" },
  { name: "马克", group: "家庭3" },
  { name: "吴沛然", group: "家庭4" },
  { name: "孙国珍", group: "家庭4" },
  { name: "吴安铭", group: "家庭4" },
  { name: "吴沛鸿", group: "家庭5" },
  { name: "高丽凤", group: "家庭5" },
  { name: "吴佳欣", group: "家庭5" },
  { name: "吴志刚", group: "家庭6" },
  { name: "陈民爱", group: "家庭6" },
  { name: "吴天琪", group: "家庭6" },
  { name: "曹操", group: "家庭6" },
];

const MEMBER_ORDER = FAMILY_MEMBERS.map((member) => member.name);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function yearFor(memory) {
  const year = new Date(memory.timestamp).getFullYear();
  return Number.isNaN(year) ? null : year;
}

function parseMemoryTimestamp(dateText) {
  if (!dateText || !dateText.trim()) {
    return Date.now();
  }
  const match = dateText.trim().match(/(\d{4})[-年](\d{1,2})[-月](\d{1,2})|(\d{4})[-年](\d{1,2})|(\d{4})/);
  if (!match) {
    return Date.now();
  }
  let year;
  let month = 0;
  let day = 1;
  if (match[1]) {
    year = Number(match[1]);
    month = Number(match[2]) - 1;
    day = Number(match[3]);
  } else if (match[4]) {
    year = Number(match[4]);
    month = Number(match[5]) - 1;
  } else {
    year = Number(match[6]);
  }
  if (Number.isNaN(year) || year < 1900 || year > 2100) {
    return Date.now();
  }
  return Date.UTC(year, month, day, 0, 0, 0, 0);
}

function sortMembersByOriginalOrder(members) {
  return [...members].sort((left, right) => {
    const leftIndex = MEMBER_ORDER.indexOf(left);
    const rightIndex = MEMBER_ORDER.indexOf(right);
    if (leftIndex === -1 && rightIndex === -1) return 0;
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
}

function sortMemoriesLikeSource(memories, mode = "chronological") {
  return [...memories].sort((left, right) => {
    const diff = mode === "chronological"
      ? left.timestamp - right.timestamp
      : right.timestamp - left.timestamp;
    if (diff !== 0) return diff;
    const leftDescription = left.description || "";
    const rightDescription = right.description || "";
    return mode === "chronological"
      ? leftDescription.localeCompare(rightDescription, "zh-CN", { numeric: true })
      : rightDescription.localeCompare(leftDescription, "zh-CN", { numeric: true });
  });
}

function refreshOrdersFromMemories() {
  state.order = sortMemoriesLikeSource(state.memories, "chronological").map((memory) => memory.id);
  state.reverseOrder = sortMemoriesLikeSource(state.memories, "reverse").map((memory) => memory.id);
}

function makeToast(message, type = "info") {
  const existing = document.querySelector(".toast");
  existing?.remove();
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 2600);
}

function downloadTextFile(filename, text, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function persistChangeLog() {
  localStorage.setItem("laolao-admin-change-log", JSON.stringify(state.admin.changeLog));
}

function recordAdminChange(type, payload) {
  state.admin.changeLog = [
    {
      id: `change:${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      createdAt: new Date().toISOString(),
      payload,
    },
    ...state.admin.changeLog,
  ];
  persistChangeLog();
}

function exportSyncPackage() {
  const now = new Date();
  const payload = {
    exportedAt: now.toISOString(),
    note: "本文件记录管理页本地会话中的新增、编辑、删除操作。真正部署后，同类记录必须同步写入 archive/ 和线上存储。",
    changes: state.admin.changeLog,
  };
  const filename = `姥姥纪念册_本地同步记录_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}.json`;
  downloadTextFile(filename, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  makeToast("同步记录已导出", "success");
}

function resetUploadForm({ keepPreviewUrl = false } = {}) {
  if (state.admin.previewUrl && !keepPreviewUrl) {
    URL.revokeObjectURL(state.admin.previewUrl);
  }
  state.admin.file = null;
  state.admin.previewUrl = "";
  state.admin.date = "";
  state.admin.location = "";
  state.admin.description = "";
  state.admin.members = [];
  state.admin.pickerOpen = false;
  state.admin.uploading = false;
}

function toggleAdminMember(context, member) {
  let targetMembers = state.admin.members;
  if (context === "edit") {
    if (!state.admin.editDraft) return;
    if (!state.admin.editDraft.members) state.admin.editDraft.members = [];
    targetMembers = state.admin.editDraft.members;
  }
  const index = targetMembers.indexOf(member);
  if (index >= 0) {
    targetMembers.splice(index, 1);
  } else {
    targetMembers.push(member);
  }
  const sorted = sortMembersByOriginalOrder(targetMembers);
  targetMembers.splice(0, targetMembers.length, ...sorted);
}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.adminToken) {
    headers.set("x-laolao-admin-token", state.adminToken);
  }
  return fetch(url, { ...options, headers });
}

async function loadAdminSession() {
  const response = await fetch("/api/session").catch(() => null);
  if (!response?.ok) {
    state.adminToken = "";
    return false;
  }
  const data = await response.json();
  state.adminToken = data.token || "";
  return Boolean(state.adminToken);
}

async function exportAdminCsv() {
  if (state.apiPersistent) {
    const response = await apiFetch("/api/export.csv");
    if (!response.ok) {
      makeToast("导出失败，请重试", "error");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "album-export.csv";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    makeToast("导出成功！", "success");
    return;
  }
  const rows = sortMemoriesLikeSource(state.memories, "chronological").map((memory, index) => ({
    序号: index + 1,
    描述: memory.description || "",
    时间显示: memory.date || "",
    地点: memory.location || "",
    timestamp数值: memory.timestamp,
    timestamp日期: new Date(memory.timestamp).toLocaleString("zh-CN"),
    类型: memory.type === "video" ? "视频" : "照片",
    相关成员: (memory.members || []).join("、"),
  }));
  const headers = Object.keys(rows[0] || {
    序号: "",
    描述: "",
    时间显示: "",
    地点: "",
    timestamp数值: "",
    timestamp日期: "",
    类型: "",
    相关成员: "",
  });
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => `"${String(row[header] ?? "").replaceAll('"', '""')}"`).join(",")),
  ].join("\n");
  const now = new Date();
  const filename = `姥姥纪念册_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}.csv`;
  downloadTextFile(filename, csv, "text/csv;charset=utf-8");
  makeToast("导出成功！", "success");
}

function createUploadedMemory() {
  const file = state.admin.file;
  const date = state.admin.date || "未指定时间";
  const location = state.admin.location || "未指定地点";
  const description = state.admin.description || "无描述";
  const timestamp = parseMemoryTimestamp(state.admin.date);
  const objectUrl = state.admin.previewUrl;
  const id = `local:${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    url: objectUrl,
    mediaUrl: objectUrl,
    thumbnailUrl: file.type.startsWith("video/") ? objectUrl : undefined,
    date,
    type: file.type.startsWith("video/") ? "video" : "photo",
    members: state.admin.members.length ? [...state.admin.members] : undefined,
    filePath: file.name,
    location,
    timestamp,
    description,
    localOnly: true,
  };
}

function orderedMemories() {
  const order = state.sortMode === "chronological" ? state.order : state.reverseOrder;
  const byId = new Map(state.memories.map((memory) => [memory.id, memory]));
  return order.map((id) => byId.get(id)).filter(Boolean);
}

function filteredMemories() {
  return orderedMemories().filter((memory) => {
    const memoryYear = yearFor(memory);
    if (state.selectedYears.size && !state.selectedYears.has(memoryYear)) {
      return false;
    }
    if (state.selectedMembers.size) {
      const members = memory.members || [];
      if (!members.some((member) => state.selectedMembers.has(member))) {
        return false;
      }
    }
    return true;
  });
}

function availableYears() {
  return [...new Set(state.memories.map(yearFor).filter((year) => year !== null))]
    .sort((left, right) => right - left);
}

function availableMembers() {
  const members = new Set();
  for (const memory of state.memories) {
    for (const member of memory.members || []) {
      members.add(member);
    }
  }
  return [...members].sort((left, right) => {
    const leftIndex = MEMBER_ORDER.indexOf(left);
    const rightIndex = MEMBER_ORDER.indexOf(right);
    if (leftIndex !== -1 && rightIndex !== -1) return leftIndex - rightIndex;
    if (leftIndex !== -1) return -1;
    if (rightIndex !== -1) return 1;
    return left.localeCompare(right, "zh-CN");
  });
}

function icon(name) {
  const icons = {
    manage: '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.6 19a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 5 8.6a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15.4 5a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.2.36.52.66.9.86.34.18.72.27 1.1.27H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5.87Z"/></svg>',
    time: '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 2v4M16 2v4M3 10h18"/><path d="M5 4h14a2 2 0 0 1 2 2v15H3V6a2 2 0 0 1 2-2Z"/></svg>',
    members: '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    grid: '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>',
    waterfall: '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v8H4zM14 4h6v5h-6zM14 12h6v8h-6zM4 15h6v5H4z"/></svg>',
    ascending: '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 8 4-4 4 4M7 4v16M11 12h4M11 16h7M11 20h10"/></svg>',
    descending: '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 16 4 4 4-4M7 20V4M11 4h10M11 8h7M11 12h4"/></svg>',
    play: '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg>',
    back: '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
    calendar: '<svg class="ui-icon small" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 2v4M16 2v4M3 10h18"/><path d="M5 4h14a2 2 0 0 1 2 2v15H3V6a2 2 0 0 1 2-2Z"/></svg>',
    pin: '<svg class="ui-icon small" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
    edit: '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    download: '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
    refresh: '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 16v5h5M3 12a9 9 0 0 1 15-6.7L21 8M21 8V3h-5"/></svg>',
    check: '<svg class="ui-icon small" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    trash: '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>',
  };
  return icons[name] || "";
}

function homeHref() {
  return location.pathname.endsWith("/admin") ? "./" : "#home";
}

function renderHeader() {
  return `
    <header class="site-header">
      <div class="header-inner">
        <div class="header-top">
          <div class="brand">
            <div class="brand-avatar"><img src="assets/avatar.jpeg" alt="姥姥"></div>
            <h1>时光里的温暖</h1>
          </div>
          <a class="admin-link" href="admin" title="管理">
            ${icon("manage")}
            <span class="admin-text">管理</span>
          </a>
        </div>
        <nav class="toolbar" aria-label="筛选和排序">
          ${renderFilter("years", "时间", availableYears(), state.selectedYears)}
          ${renderFilter("members", "成员", availableMembers(), state.selectedMembers)}
          <button class="icon-button" type="button" data-action="toggle-view" title="${state.viewMode === "waterfall" ? "切换到宫格视图" : "切换到瀑布流"}">
            ${state.viewMode === "waterfall" ? icon("grid") : icon("waterfall")}
          </button>
          <button class="icon-button" type="button" data-action="toggle-sort" title="${state.sortMode === "chronological" ? "时间正序" : "时间倒序"}">
            ${state.sortMode === "chronological" ? icon("ascending") : icon("descending")}
          </button>
        </nav>
      </div>
    </header>
  `;
}

function renderFilter(kind, label, options, selectedSet) {
  return `
    <div class="filter-wrap">
      <button class="filter-button" type="button" data-action="toggle-panel" data-panel="${kind}">
        ${kind === "years" ? icon("time") : icon("members")}
        <span>${label}</span>
      </button>
      <div class="filter-panel ${state.activePanel === kind ? "open" : ""}" data-panel-body="${kind}">
        <h3>${kind === "years" ? "按年份筛选" : "按成员筛选"}</h3>
        <div class="filter-list">
          ${options.map((option) => `
            <button class="filter-option ${selectedSet.has(option) ? "active" : ""}" type="button" data-action="toggle-filter" data-kind="${kind}" data-value="${escapeHtml(option)}">
              <span class="filter-check" aria-hidden="true">${selectedSet.has(option) ? "✓" : ""}</span>
              <span>${escapeHtml(kind === "years" ? `${option}年` : option)}</span>
            </button>
          `).join("")}
        </div>
        <div class="filter-footer">
          <button class="filter-done" type="button" data-action="close-panel">完成</button>
        </div>
      </div>
    </div>
  `;
}

function renderHero() {
  return `
    <section class="hero">
      <h2>时光里的温暖</h2>
      <p class="hero-line">一生温良持家，福泽四世同堂。</p>
      <p class="hero-line">（1928.12.7—2026.1.25）慈母仙逝，寿享97岁。</p>
      <p>——谨以此影集，留存时光里的温暖，后代子孙，怀恩承福，慈风永传。</p>
    </section>
  `;
}

function renderActiveFilters() {
  const resultCount = filteredMemories().length;
  const chips = [
    ...[...state.selectedYears].map((year) => ({ kind: "years", value: year })),
    ...[...state.selectedMembers].map((member) => ({ kind: "members", value: member })),
  ];

  if (!chips.length) {
    return `<div class="active-filters"></div>`;
  }

  return `
    <div class="active-filters visible">
      <div class="active-filter-card">
        <div class="active-filter-list">
          <span>已筛选：</span>
          ${chips.map((chip) => `
            <button class="chip active" type="button" data-action="toggle-filter" data-kind="${chip.kind}" data-value="${escapeHtml(chip.value)}">
              ${escapeHtml(chip.kind === "years" ? `${chip.value}年` : chip.value)}
            </button>
          `).join("")}
        </div>
        <div class="active-filter-actions">
          <span>共 ${resultCount} 条记忆</span>
          <button class="ghost-action" type="button" data-action="clear-filters">清空筛选</button>
        </div>
      </div>
    </div>
  `;
}

function renderCard(memory) {
  const image = memory.type === "video"
    ? memory.thumbnailUrl
    : memory.mediaUrl;
  return `
    <button class="memory-card ${memory.type === "video" ? "video" : ""}" type="button" data-action="open-memory" data-id="${escapeHtml(memory.id)}">
      <div class="media-frame">
        <img src="${escapeHtml(image)}" alt="" loading="lazy">
        ${memory.type === "video" ? `<div class="play-badge"><span>${icon("play")}</span></div>` : ""}
        <div class="grid-date">${escapeHtml(memory.date)}</div>
      </div>
      <div class="card-body">
        <p class="description">${escapeHtml(memory.description)}</p>
        <div class="meta-row">
          ${icon("calendar")}
          <span>${escapeHtml(memory.date)}</span>
        </div>
        <div class="meta-row">
          ${icon("pin")}
          <span>${escapeHtml(memory.location)}</span>
        </div>
      </div>
    </button>
  `;
}

function renderMembers(members = []) {
  if (!members.length) {
    return "";
  }
  return `
    <div class="members">
      ${members.map((member) => `<span class="member-pill">${escapeHtml(member)}</span>`).join("")}
    </div>
  `;
}

function renderGallery() {
  const memories = filteredMemories();
  if (!memories.length) {
    return `
      <section class="empty-state">
        <p>${state.memories.length === 0 ? "还没有添加记忆" : "没有符合筛选条件的记忆"}</p>
        <a class="primary-action" href="admin">开始上传</a>
      </section>
    `;
  }

  if (state.viewMode === "waterfall") {
    const columnCount = window.innerWidth >= 1024 ? 3 : window.innerWidth >= 640 ? 2 : 1;
    const columns = Array.from({ length: columnCount }, () => []);
    memories.forEach((memory, index) => {
      columns[index % columnCount].push(memory);
    });
    return `
      <section class="content">
        <div class="gallery waterfall-view">
          ${columns.map((column) => `
            <div class="waterfall-column">
              ${column.map(renderCard).join("")}
            </div>
          `).join("")}
        </div>
      </section>
    `;
  }

  return `
    <section class="content">
      <div class="gallery ${state.viewMode === "grid" ? "grid-view" : "waterfall-view"}">
        ${memories.map(renderCard).join("")}
      </div>
    </section>
  `;
}

function activeMemory() {
  return state.memories.find((memory) => memory.id === state.activeMemoryId) || null;
}

function modalNavigation(memory) {
  const visible = filteredMemories();
  const index = visible.findIndex((item) => item.id === memory.id);
  return {
    previous: index > 0 ? visible[index - 1] : null,
    next: index >= 0 && index < visible.length - 1 ? visible[index + 1] : null,
  };
}

function renderModal() {
  const memory = activeMemory();
  if (!memory) {
    return `<div class="modal" aria-hidden="true"></div>`;
  }
  const nav = modalNavigation(memory);
  const downloadName = `记忆_${memory.date}_${memory.location}.${memory.type === "video" ? "mp4" : "jpg"}`.replace(/[\\/:*?"<>|]/g, "_");
  return `
    <div class="modal open" role="dialog" aria-modal="true">
      <div class="modal-backdrop" data-action="close-modal"></div>
      <article class="modal-panel">
        <div class="modal-toolbar">
          <div class="modal-actions">
            <button class="modal-tool" type="button" data-action="open-edit" data-id="${escapeHtml(memory.id)}" title="修改">${icon("edit")} 修改</button>
            <a class="modal-tool" href="${escapeHtml(memory.mediaUrl)}" download="${escapeHtml(downloadName)}" title="下载">${icon("download")} 下载</a>
          </div>
          <button class="modal-close" type="button" data-action="close-modal" title="关闭" aria-label="关闭"><span aria-hidden="true">×</span> 关闭</button>
        </div>
        <div class="modal-media">
          ${memory.type === "video"
            ? `<video class="modal-video" src="${escapeHtml(memory.mediaUrl)}" poster="${escapeHtml(memory.thumbnailUrl || "")}" preload="metadata" playsinline data-action="toggle-video-play"></video>`
            : `<img src="${escapeHtml(memory.mediaUrl)}" alt="${escapeHtml(memory.description)}">`}
        </div>
        <div class="modal-bottom-nav">
          <button class="modal-step" type="button" data-action="modal-prev" ${nav.previous ? "" : "disabled"}><span aria-hidden="true">‹</span> 上一张</button>
          <button class="modal-step next" type="button" data-action="modal-next" ${nav.next ? "" : "disabled"}>下一张 <span aria-hidden="true">›</span></button>
        </div>
        <div class="modal-info">
          <p class="modal-description">${escapeHtml(memory.description)}</p>
          <div class="detail-grid">
            <div class="detail-box">
              <div class="detail-label">时间</div>
              <div class="detail-value">${escapeHtml(memory.date)}</div>
            </div>
            <div class="detail-box">
              <div class="detail-label">地点</div>
              <div class="detail-value">${escapeHtml(memory.location)}</div>
            </div>
          </div>
        </div>
      </article>
    </div>
  `;
}

function renderAdminPage() {
  app.innerHTML = `
    <main class="admin-shell">
      ${renderAdminTopbar()}
      ${renderUploadPanel()}
      ${renderSyncPanel()}
      ${renderMemoryList()}
      ${renderEditModal()}
    </main>
  `;
}

function renderAdminTopbar() {
  return `
    <div class="admin-topbar">
      <a class="admin-back" href="${homeHref()}">${icon("back")} 返回</a>
      <div class="admin-actions">
        <button class="admin-primary teal" type="button" data-action="export-admin" title="导出Excel检查排序">${icon("download")} 导出Excel</button>
        <button class="admin-primary" type="button" data-action="fix-sort" title="修复所有照片的排序">${icon("refresh")} 修复排序</button>
        <span class="server-status">${icon("check")} 服务器连接正常</span>
      </div>
    </div>
  `;
}

function renderUploadPanel() {
  const admin = state.admin;
  return `
    <section class="admin-panel upload-panel">
      <h2>上传记忆</h2>
      <form class="admin-form" data-action="submit-upload">
        <div class="form-row">
          <label for="upload-file">文件:</label>
          <input id="upload-file" type="file" accept="image/*,video/*" data-action="admin-file">
        </div>
        ${admin.previewUrl ? `
          <div class="form-row">
            <label>预览:</label>
            <div class="upload-preview">
              ${admin.file?.type.startsWith("video/")
                ? `<video src="${escapeHtml(admin.previewUrl)}" muted controls></video>`
                : `<img src="${escapeHtml(admin.previewUrl)}" alt="Preview">`}
              <button type="button" data-action="clear-upload-file" title="移除文件">×</button>
            </div>
          </div>
        ` : ""}
        <div class="form-row">
          <label for="upload-date">日期:</label>
          <input id="upload-date" type="text" value="${escapeHtml(admin.date)}" placeholder="年份（例如：2023）" data-admin-field="date">
        </div>
        <div class="form-row">
          <label for="upload-location">地点:</label>
          <input id="upload-location" type="text" value="${escapeHtml(admin.location)}" placeholder="地点" data-admin-field="location">
        </div>
        <div class="form-block">
          <label for="upload-description">描述:</label>
          <textarea id="upload-description" rows="4" placeholder="描述（支持换行）" data-admin-field="description">${escapeHtml(admin.description)}</textarea>
        </div>
        ${renderSelectedMembers(admin.members, "upload")}
        <div class="form-row member-row">
          <label>选择成员:</label>
          <div class="member-picker-wrap">
            <button class="member-trigger" type="button" data-action="toggle-upload-picker" title="选择成员">${icon("members")}</button>
            ${admin.pickerOpen ? renderMemberPicker(admin.members, "upload") : ""}
          </div>
        </div>
        <button class="upload-submit" type="submit" ${admin.uploading ? "disabled" : ""}>${admin.uploading ? "上传中..." : "上传"}</button>
      </form>
    </section>
  `;
}

function renderSyncPanel() {
  const changes = state.admin.changeLog;
  const backup = state.localBackup;
  const backupOk = backup?.ok === true;
  const backupTime = backup?.syncedAt ? new Date(backup.syncedAt).toLocaleString("zh-CN") : "尚未生成";
  return `
    <section class="admin-panel sync-panel">
      <div class="sync-head">
        <div>
          <h2>本机资料库</h2>
          <p>${state.apiPersistent ? "新增、编辑、删除会自动保存到本机资料库，并自动生成检查报告和表格备份。" : "当前是静态预览模式，新增、编辑、删除会先记录在浏览器里；启动本地管理服务后可写入本机资料库。"}</p>
        </div>
        <div class="sync-actions">
          ${state.localBackupSupported ? `<button type="button" class="admin-primary" data-action="run-local-backup">立即检查</button>` : ""}
          <button type="button" class="admin-primary teal" data-action="export-sync" ${changes.length ? "" : "disabled"}>${icon("download")} 导出同步包</button>
          <button type="button" class="secondary" data-action="clear-sync" ${changes.length ? "" : "disabled"}>清空记录</button>
        </div>
      </div>
      ${state.localBackupSupported ? `
        <div class="backup-status ${backupOk ? "ok" : "warn"}">
          <strong>${backupOk ? "已自动保存并检查通过" : "等待生成本机检查报告"}</strong>
          <span>最近检查：${escapeHtml(backupTime)}</span>
          <span>记录：${escapeHtml(backup?.records ?? state.memories.length)} 条 / 照片：${escapeHtml(backup?.photos ?? "-")} / 视频：${escapeHtml(backup?.videos ?? "-")}</span>
          <span>资料位置：/Users/yangxiao/LAOLAO-RUNTIME/archive/</span>
        </div>
      ` : ""}
      ${changes.length ? `
        <div class="sync-list">
          ${changes.slice(0, 5).map((change) => `
            <div class="sync-item">
              <span>${escapeHtml(change.type)}</span>
              <strong>${escapeHtml(syncChangeTitle(change))}</strong>
              <time>${escapeHtml(new Date(change.createdAt).toLocaleString("zh-CN"))}</time>
            </div>
          `).join("")}
        </div>
      ` : `<p class="sync-empty">暂无待同步变更。</p>`}
    </section>
  `;
}

function syncChangeTitle(change) {
  if (change.type === "upload") return change.payload.description || change.payload.fileName || "新增记忆";
  if (change.type === "edit") return change.payload.after?.description || change.payload.id || "编辑记忆";
  if (change.type === "delete") return change.payload.description || change.payload.id || "删除记忆";
  return change.id;
}

function renderSelectedMembers(members, context) {
  const sorted = sortMembersByOriginalOrder(members || []);
  if (!sorted.length) return "";
  if (context === "edit") {
    return `
      <div class="selected-members edit-selected-members">
        ${sorted.map((member) => `
          <span class="selected-member">
            ${escapeHtml(member)}
            <button class="selected-member-remove" type="button" data-action="remove-member" data-context="${context}" data-member="${escapeHtml(member)}" title="移除" aria-label="移除 ${escapeHtml(member)}">×</button>
          </span>
        `).join("")}
      </div>
    `;
  }
  return `
    <div class="form-row selected-members-row">
      <label>已选成员:</label>
      <div class="selected-members">
        ${sorted.map((member) => `
          <span class="selected-member">
            ${escapeHtml(member)}
            <button class="selected-member-remove" type="button" data-action="remove-member" data-context="${context}" data-member="${escapeHtml(member)}" title="移除" aria-label="移除 ${escapeHtml(member)}">×</button>
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function renderMemberPicker(selectedMembers, context) {
  const selected = new Set(selectedMembers || []);
  const groups = FAMILY_MEMBERS.reduce((result, member) => {
    result[member.group] ||= [];
    result[member.group].push(member);
    return result;
  }, {});
  return `
    <div class="member-popover">
      <div class="member-popover-head">
        <h3>选择家庭成员</h3>
        <button type="button" data-action="close-member-picker" data-context="${context}" title="关闭">×</button>
      </div>
      ${Object.entries(groups).map(([group, members]) => `
        <div class="member-group">
          <div class="member-group-title">${escapeHtml(group)}</div>
          ${members.map((member) => `
            <button class="member-option ${selected.has(member.name) ? "active" : ""}" type="button" data-action="toggle-member" data-context="${context}" data-member="${escapeHtml(member.name)}">
              <span class="member-check">${selected.has(member.name) ? "✓" : ""}</span>
              <span>${escapeHtml(member.name)}</span>
            </button>
          `).join("")}
        </div>
      `).join("")}
    </div>
  `;
}

function renderMemoryList() {
  const memories = sortMemoriesLikeSource(state.memories, "chronological");
  return `
    <section class="admin-panel list-panel">
      <div class="list-head">
        <h2>记忆列表</h2>
        <span>${memories.length} 条</span>
      </div>
      <div class="admin-memory-list">
        ${memories.map(renderAdminMemoryItem).join("")}
      </div>
    </section>
  `;
}

function renderAdminMemoryItem(memory) {
  const image = memory.type === "video" ? memory.thumbnailUrl || memory.mediaUrl : memory.mediaUrl;
  return `
    <article class="admin-memory-item">
      <div class="admin-thumb">
        <img src="${escapeHtml(image)}" alt="">
        ${memory.type === "video" ? `<span class="admin-video-badge">${icon("play")}</span>` : ""}
      </div>
      <div class="admin-memory-copy">
        <p class="admin-memory-desc">${escapeHtml(memory.description)}</p>
        <p class="admin-memory-meta">${escapeHtml(memory.date)} - ${escapeHtml(memory.location)}</p>
        ${(memory.members || []).length ? `<p class="admin-memory-meta">成员: ${escapeHtml(memory.members.join(", "))}</p>` : ""}
      </div>
      <div class="admin-item-actions">
        <button type="button" data-action="open-edit" data-id="${escapeHtml(memory.id)}" title="编辑">${icon("edit")}</button>
        <button type="button" data-action="delete-memory" data-id="${escapeHtml(memory.id)}" title="删除">${icon("trash")}</button>
      </div>
    </article>
  `;
}

function renderEditModal() {
  const memory = state.memories.find((item) => item.id === state.admin.editingId);
  if (!memory) return "";
  const draft = state.admin.editDraft || memory;
  const media = memory.type === "video"
    ? `<video src="${escapeHtml(memory.mediaUrl)}" poster="${escapeHtml(memory.thumbnailUrl || "")}" controls></video>`
    : `<img src="${escapeHtml(memory.mediaUrl)}" alt="">`;
  return `
    <div class="edit-overlay">
      <section class="edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <div class="edit-head">
          <h2 id="edit-title">编辑记忆</h2>
          <button type="button" data-action="close-edit" aria-label="关闭">×</button>
        </div>
        <div class="edit-body">
          <div class="edit-media">${media}</div>
          <label>年份（可选）<input type="text" value="${escapeHtml(draft.date === "未指定时间" ? "" : draft.date)}" placeholder="例如：2020" data-edit-field="date"></label>
          <p class="field-help">输入4位年份，如：2020</p>
          <label>地点（可选）<input type="text" value="${escapeHtml(draft.location === "未指定地点" ? "" : draft.location)}" placeholder="例如：北京 · 家中" data-edit-field="location"></label>
          <label>事件描述（可选）<textarea rows="4" placeholder="记录下这个特别的时刻..." data-edit-field="description">${escapeHtml(draft.description === "无描述" ? "" : draft.description)}</textarea></label>
          <div class="edit-member-block">
            <div class="edit-member-head">
              <label>相关家庭成员（可选）</label>
              <button type="button" class="member-trigger ${state.admin.editPickerOpen ? "active" : ""}" data-action="toggle-edit-picker" title="从列表选择">${icon("members")}</button>
            </div>
            ${renderSelectedMembers(draft.members || [], "edit")}
            <div class="member-picker-wrap">
              ${state.admin.editPickerOpen ? renderMemberPicker(draft.members || [], "edit") : ""}
            </div>
          </div>
        </div>
        <div class="edit-footer">
          <button type="button" class="danger-icon" data-action="delete-memory" data-id="${escapeHtml(memory.id)}" title="删除记忆">${icon("trash")}</button>
          <div>
            <button type="button" class="secondary" data-action="close-edit">取消</button>
            <button type="button" class="save-edit" data-action="save-edit">保存修改</button>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderHome() {
  app.innerHTML = `
    ${renderHeader()}
    ${renderHero()}
    ${renderActiveFilters()}
    ${renderGallery()}
    ${renderModal()}
    ${renderEditModal()}
  `;
}

function render() {
  if (location.pathname.endsWith("/admin") || location.hash === "#admin") {
    renderAdminPage();
  } else {
    renderHome();
  }
}

function toggleFromSet(set, value) {
  if (set.has(value)) {
    set.delete(value);
  } else {
    set.add(value);
  }
}

function actionTargetFromEvent(event) {
  if (event.target?.closest) {
    const target = event.target.closest("[data-action]");
    if (target) return target;
  }
  return event.composedPath().find((item) => item?.dataset?.action) || null;
}

document.addEventListener("click", (event) => {
  const target = actionTargetFromEvent(event);
  if (!target) {
    if (event.target?.closest?.(".edit-modal, .modal-panel, .admin-shell")) {
      return;
    }
    state.activePanel = null;
    render();
    return;
  }

  const action = target.dataset.action;
  if (action === "toggle-panel") {
    state.activePanel = state.activePanel === target.dataset.panel ? null : target.dataset.panel;
    render();
    return;
  }
  if (action === "toggle-filter") {
    const rawValue = target.dataset.value;
    const value = target.dataset.kind === "years" ? Number(rawValue) : rawValue;
    toggleFromSet(target.dataset.kind === "years" ? state.selectedYears : state.selectedMembers, value);
    render();
    return;
  }
  if (action === "close-panel") {
    state.activePanel = null;
    render();
    return;
  }
  if (action === "toggle-sort") {
    state.sortMode = state.sortMode === "chronological" ? "reverse" : "chronological";
    render();
  }
  if (action === "toggle-view") {
    state.viewMode = state.viewMode === "waterfall" ? "grid" : "waterfall";
    render();
  }
  if (action === "clear-filters") {
    state.selectedYears.clear();
    state.selectedMembers.clear();
    render();
  }
  if (action === "open-memory") {
    state.activeMemoryId = target.dataset.id;
    render();
  }
  if (action === "close-modal") {
    state.activeMemoryId = null;
    render();
  }
  if (action === "modal-prev" || action === "modal-next") {
    const memory = activeMemory();
    if (!memory) return;
    const nav = modalNavigation(memory);
    const nextMemory = action === "modal-prev" ? nav.previous : nav.next;
    if (nextMemory) {
      state.activeMemoryId = nextMemory.id;
      render();
    }
  }
  if (action === "toggle-video-play") {
    event.preventDefault();
    if (target.paused) {
      target.play().catch(() => {});
    } else {
      target.pause();
    }
    return;
  }
  if (action === "export-admin") {
    exportAdminCsv();
    return;
  }
  if (action === "fix-sort") {
    if (confirm("确定要修复所有照片的排序吗？\n\n这会使用UTC时间重新计算所有照片的timestamp，消除时区差异，修复排序问题。")) {
      if (state.apiPersistent) {
        apiFetch("/api/fix-sort", { method: "POST" })
          .then((response) => response.json())
          .then(async (result) => {
            makeToast(`修复完成！已更新 ${result.fixed} 张照片的排序`, "success");
            await reloadMemories();
          })
          .catch((error) => makeToast(error.message || "修复失败，请重试", "error"));
      } else {
        refreshOrdersFromMemories();
        makeToast("修复完成！排序已重新计算。", "success");
        render();
      }
    }
    return;
  }
  if (action === "run-local-backup") {
    if (!state.apiPersistent) return;
    apiFetch("/api/local-backup/run", { method: "POST" })
      .then((response) => {
        if (!response.ok) throw new Error("检查失败");
        return response.json();
      })
      .then((result) => {
        state.localBackup = result.localBackup || null;
        makeToast(state.localBackup?.ok ? "本机资料库检查通过" : "检查完成，请查看状态", state.localBackup?.ok ? "success" : "error");
        render();
      })
      .catch((error) => makeToast(error.message || "检查失败，请重试", "error"));
    return;
  }
  if (action === "toggle-upload-picker") {
    state.admin.pickerOpen = !state.admin.pickerOpen;
    render();
    return;
  }
  if (action === "toggle-edit-picker") {
    state.admin.editPickerOpen = !state.admin.editPickerOpen;
    render();
    return;
  }
  if (action === "close-member-picker") {
    if (target.dataset.context === "edit") {
      state.admin.editPickerOpen = false;
    } else {
      state.admin.pickerOpen = false;
    }
    render();
    return;
  }
  if (action === "toggle-member") {
    toggleAdminMember(target.dataset.context, target.dataset.member);
    render();
    return;
  }
  if (action === "remove-member") {
    toggleAdminMember(target.dataset.context, target.dataset.member);
    render();
    return;
  }
  if (action === "clear-upload-file") {
    if (state.admin.previewUrl) URL.revokeObjectURL(state.admin.previewUrl);
    state.admin.file = null;
    state.admin.previewUrl = "";
    render();
    return;
  }
  if (action === "open-edit") {
    state.admin.editingId = target.dataset.id;
    const memory = state.memories.find((item) => item.id === state.admin.editingId);
    state.admin.editDraft = memory ? structuredClone(memory) : null;
    state.admin.editPickerOpen = false;
    render();
    return;
  }
  if (action === "close-edit") {
    state.admin.editingId = null;
    state.admin.editDraft = null;
    state.admin.editPickerOpen = false;
    render();
    return;
  }
  if (action === "save-edit") {
    const memory = state.memories.find((item) => item.id === state.admin.editingId);
    if (memory) {
      const before = structuredClone(memory);
      const dateInput = document.querySelector("[data-edit-field='date']");
      const locationInput = document.querySelector("[data-edit-field='location']");
      const descriptionInput = document.querySelector("[data-edit-field='description']");
      const nextDate = dateInput?.value || "未指定时间";
      const patch = {
        date: nextDate,
        location: locationInput?.value || "未指定地点",
        description: descriptionInput?.value || "无描述",
        timestamp: dateInput?.value ? parseMemoryTimestamp(dateInput.value) : memory.timestamp,
        members: state.admin.editDraft?.members?.length ? [...state.admin.editDraft.members] : undefined,
      };
      if (state.apiPersistent) {
        apiFetch(`/api/memories/${encodeURIComponent(memory.id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        }).then((response) => {
          if (!response.ok) throw new Error("保存失败，请重试");
          return response.json();
        }).then(async () => {
          state.admin.editingId = null;
          state.admin.editDraft = null;
          state.admin.editPickerOpen = false;
          makeToast("更新成功！", "success");
          await reloadMemories();
        }).catch((error) => makeToast(error.message || "保存失败，请重试", "error"));
      } else {
        Object.assign(memory, patch);
        if (!memory.members?.length) delete memory.members;
        recordAdminChange("edit", {
          id: memory.id,
          before,
          after: structuredClone(memory),
        });
        refreshOrdersFromMemories();
        state.admin.editingId = null;
        state.admin.editDraft = null;
        state.admin.editPickerOpen = false;
        makeToast("更新成功！", "success");
        render();
      }
    }
    return;
  }
  if (action === "delete-memory") {
    const memory = state.memories.find((item) => item.id === target.dataset.id);
    if (memory && confirm(`确定要删除这条记忆吗？\n\n${memory.description}`)) {
      if (state.apiPersistent) {
        apiFetch(`/api/memories/${encodeURIComponent(memory.id)}`, { method: "DELETE" })
          .then((response) => {
            if (!response.ok) throw new Error("删除失败");
            return response.json();
          })
          .then(async () => {
            state.admin.editingId = null;
            state.admin.editDraft = null;
            makeToast("删除成功", "success");
            await reloadMemories();
          })
          .catch((error) => makeToast(error.message || "删除失败", "error"));
      } else {
        recordAdminChange("delete", structuredClone(memory));
        state.memories = state.memories.filter((item) => item.id !== memory.id);
        refreshOrdersFromMemories();
        state.admin.editingId = null;
        state.admin.editDraft = null;
        makeToast("删除成功", "success");
        render();
      }
    }
    return;
  }
  if (action === "export-sync") {
    exportSyncPackage();
    return;
  }
  if (action === "clear-sync") {
    if (confirm("确定要清空本地同步记录吗？\n\n这不会删除相册内容，但会清除当前浏览器里尚未导出的操作记录。")) {
      state.admin.changeLog = [];
      persistChangeLog();
      makeToast("同步记录已清空", "success");
      render();
    }
    return;
  }
});

document.addEventListener("input", (event) => {
  const field = event.target?.dataset?.adminField;
  if (field) {
    state.admin[field] = event.target.value;
    return;
  }
  const editField = event.target?.dataset?.editField;
  if (editField && state.admin.editDraft) {
    state.admin.editDraft[editField] = event.target.value;
  }
});

document.addEventListener("pointerdown", (event) => {
  if (!event.target?.dataset?.editField) return;
  const editBody = event.target.closest(".edit-body");
  editBodyScrollBeforeFocus = editBody?.scrollTop || 0;
}, true);

document.addEventListener("focusin", (event) => {
  if (!event.target?.dataset?.editField) return;
  const editBody = event.target.closest(".edit-body");
  if (!editBody) return;
  const scrollTop = editBodyScrollBeforeFocus;
  requestAnimationFrame(() => {
    editBody.scrollTop = scrollTop;
  });
});

document.addEventListener("change", (event) => {
  if (event.target?.dataset?.action !== "admin-file") return;
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
    makeToast("请选择图片或视频文件", "error");
    return;
  }
  if (state.admin.previewUrl) URL.revokeObjectURL(state.admin.previewUrl);
  state.admin.file = file;
  state.admin.previewUrl = URL.createObjectURL(file);
  render();
});

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (form?.dataset?.action !== "submit-upload") return;
  event.preventDefault();
  if (!state.admin.file) {
    makeToast("请选择文件", "error");
    return;
  }
  state.admin.uploading = true;
  render();
  if (state.apiPersistent) {
    const formData = new FormData();
    formData.append("file", state.admin.file);
    formData.append("date", state.admin.date || "未指定时间");
    formData.append("location", state.admin.location || "未指定地点");
    formData.append("description", state.admin.description || "无描述");
    formData.append("members", JSON.stringify(state.admin.members));
    apiFetch("/api/memories", { method: "POST", body: formData })
      .then((response) => {
        if (!response.ok) return response.json().then((error) => { throw new Error(error.error || "上传失败"); });
        return response.json();
      })
      .then(async () => {
        resetUploadForm();
        makeToast("上传成功！", "success");
        await reloadMemories();
      })
      .catch((error) => {
        state.admin.uploading = false;
        makeToast(error.message || "上传失败", "error");
        render();
      });
    return;
  }
  window.setTimeout(() => {
    const memory = createUploadedMemory();
    recordAdminChange("upload", {
      id: memory.id,
      fileName: state.admin.file?.name || "",
      fileType: state.admin.file?.type || "",
      fileSize: state.admin.file?.size || 0,
      date: memory.date,
      location: memory.location,
      description: memory.description,
      timestamp: memory.timestamp,
      members: memory.members || [],
    });
    state.memories = [...state.memories, memory];
    resetUploadForm({ keepPreviewUrl: true });
    refreshOrdersFromMemories();
    makeToast("上传成功！", "success");
    render();
  }, 350);
});

document.addEventListener("keydown", (event) => {
  if (!state.activeMemoryId) return;
  if (event.key === "Escape") {
    state.activeMemoryId = null;
    render();
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    const memory = activeMemory();
    const nav = modalNavigation(memory);
    const nextMemory = event.key === "ArrowLeft" ? nav.previous : nav.next;
    if (nextMemory) {
      state.activeMemoryId = nextMemory.id;
      render();
    }
  }
});

window.addEventListener("hashchange", render);
let resizeTimer = null;
window.addEventListener("resize", () => {
  if (state.viewMode !== "waterfall") return;
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(render, 120);
});

async function init() {
  try {
    await reloadMemories();
    render();
  } catch (error) {
    app.innerHTML = `
      <main class="error-screen">
        <div class="error-card">
          <h1>相册载入失败</h1>
          <p>${escapeHtml(error.message)}</p>
        </div>
      </main>
    `;
  }
}

async function reloadMemories() {
  await loadAdminSession();
  let response = await fetch("/api/memories").catch(() => null);
  if (response?.ok) {
    const data = await response.json();
    state.apiPersistent = true;
    state.memories = data.memories || [];
    state.baseMemories = structuredClone(state.memories);
    state.admin.changeLog = data.changes || [];
    state.localBackupSupported = Object.prototype.hasOwnProperty.call(data, "localBackup");
    state.localBackup = data.localBackup || null;
    state.order = data.order || sortMemoriesLikeSource(state.memories, "chronological").map((memory) => memory.id);
    state.reverseOrder = data.reverseOrder || sortMemoriesLikeSource(state.memories, "reverse").map((memory) => memory.id);
    render();
    return;
  }

  response = await fetch("data/memories.json");
    if (!response.ok) {
      throw new Error("无法读取相册数据");
    }
    const data = await response.json();
    state.apiPersistent = false;
    state.memories = data.memories || [];
    state.baseMemories = structuredClone(state.memories);
    state.admin.changeLog = JSON.parse(localStorage.getItem("laolao-admin-change-log") || "[]");
    state.localBackup = null;
    state.localBackupSupported = false;
    state.order = data.order || state.memories.map((memory) => memory.id);
    state.reverseOrder = data.reverseOrder || [...state.order].reverse();
}

init();
