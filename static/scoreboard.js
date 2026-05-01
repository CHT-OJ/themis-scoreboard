const state = {
  data: window.INITIAL_SCOREBOARD || null,
  sortKey: "rank",
  sortDirection: "asc",
  search: "",
};

const elements = {
  pageTitle: document.querySelector("#pageTitle"),
  snapshotMeta: document.querySelector("#snapshotMeta"),
  emptyState: document.querySelector("#emptyState"),
  content: document.querySelector("#scoreboardContent"),
  statsGrid: document.querySelector("#statsGrid"),
  tableHead: document.querySelector("#tableHead"),
  tableBody: document.querySelector("#tableBody"),
  searchInput: document.querySelector("#searchInput"),
  refreshButton: document.querySelector("#refreshButton"),
};

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function columnDefinitions() {
  const problems = state.data?.problems || [];
  return [
    { key: "rank", label: "Rank", numeric: true },
    { key: "code", label: "Mã thí sinh" },
    { key: "room", label: "Phòng thi" },
    ...problems.map((problem) => ({ key: `problem:${problem}`, label: problem, numeric: true })),
    { key: "total_score", label: "Tổng điểm", numeric: true },
  ];
}

function valueFor(contestant, key) {
  if (key.startsWith("problem:")) {
    return contestant.problem_scores[key.slice("problem:".length)] || 0;
  }
  return contestant[key];
}

function sortedContestants() {
  const search = state.search.trim().toLowerCase();
  const filtered = (state.data?.contestants || []).filter((contestant) => {
    if (!search) return true;
    return `${contestant.code} ${contestant.room}`.toLowerCase().includes(search);
  });

  filtered.sort((a, b) => {
    const av = valueFor(a, state.sortKey);
    const bv = valueFor(b, state.sortKey);
    let result;
    if (typeof av === "number" || typeof bv === "number") {
      result = Number(av || 0) - Number(bv || 0);
    } else {
      result = String(av || "").localeCompare(String(bv || ""), "vi", { sensitivity: "base" });
    }
    return state.sortDirection === "asc" ? result : -result;
  });
  return filtered;
}

function renderStats() {
  const stats = state.data?.stats || {};
  const cards = [
    ["Số thí sinh", stats.contestant_count || 0, "Quy mô snapshot hiện tại"],
    ["Điểm trung bình", formatNumber(stats.total_average || 0), "Mặt bằng chung toàn kỳ thi"],
    ...Object.entries(stats.problem_averages || {}).map(([problem, average]) => [problem, formatNumber(average), `Điểm trung bình bài ${problem}`]),
  ];
  elements.statsGrid.innerHTML = cards
    .map(([label, value, note]) => `<article class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`)
    .join("");
}

function renderTable() {
  const columns = columnDefinitions();
  elements.tableHead.innerHTML = `<tr>${columns
    .map((column) => {
      const active = column.key === state.sortKey;
      const marker = active ? (state.sortDirection === "asc" ? " ▲" : " ▼") : "";
      return `<th class="${column.numeric ? "numeric" : ""}" data-sort-key="${escapeHtml(column.key)}">${escapeHtml(column.label)}${marker}</th>`;
    })
    .join("")}</tr>`;

  elements.tableBody.innerHTML = sortedContestants()
    .map((contestant) => {
      const cells = columns
        .map((column) => {
          const value = valueFor(contestant, column.key);
          const display = column.numeric ? formatNumber(value) : value;
          if (column.key === "rank") {
            return `<td class="numeric"><span class="rank-pill ${contestant.is_top_35 ? "rank-pill-top" : ""}">${escapeHtml(display)}</span></td>`;
          }
          if (column.key === "code") {
            return `<td><a class="contestant-link" href="/contestants/${contestant.id}" style="text-decoration: none; color: inherit;"><span class="contestant-name">${escapeHtml(display)}</span></a></td>`;
          }
          if (column.key.startsWith("problem:")) {
            const problemCode = column.key.slice("problem:".length);
            return `<td class="numeric"><a class="score-link" href="/contestants/${contestant.id}#problem-${escapeHtml(problemCode)}" style="text-decoration: none; color: inherit; font-weight: 500;">${escapeHtml(display)}</a></td>`;
          }
          return `<td class="${column.numeric ? "numeric" : ""}">${escapeHtml(display)}</td>`;
        })
        .join("");
      return `<tr class="${contestant.is_top_35 ? "top-rank" : ""}">${cells}</tr>`;
    })
    .join("");
}

function render() {
  if (!state.data?.snapshot) {
    elements.snapshotMeta.textContent = "Chưa có snapshot điểm.";
    elements.emptyState.hidden = false;
    elements.content.hidden = true;
    return;
  }
  const title = state.data.snapshot.title || "";
  elements.pageTitle.textContent = title ? `Bảng điểm ${title}` : "Bảng điểm";
  document.title = elements.pageTitle.textContent + " - Themis Scoreboard";
  elements.snapshotMeta.textContent = `cập nhật ${state.data.snapshot.created_at}`;
  elements.emptyState.hidden = true;
  elements.content.hidden = false;
  renderStats();
  renderTable();
}

async function refreshScoreboard() {
  const response = await fetch("/api/scoreboard");
  state.data = await response.json();
  render();
}

function toggleSort(key) {
  if (state.sortKey === key) {
    state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
  } else {
    state.sortKey = key;
    state.sortDirection = key === "code" || key === "room" ? "asc" : "desc";
  }
  renderTable();
}

function openDetail(contestantId) {
  window.location.href = `/contestants/${contestantId}`;
}

const detailCache = {};

const verdictIcons = {
  "AC": `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  "WA": `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  "RTE": `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  "CE": `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  "TLE": `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="2" x2="14" y2="2"/><line x1="12" y1="14" x2="15" y2="11"/><circle cx="12" cy="14" r="8"/></svg>`,
  "Partial": `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M16.404 4.304a10 10 0 0 1 2.923 2.502"/><path d="M21.5 10.1a10 10 0 0 1 0 3.8"/><path d="M19.327 16.404a10 10 0 0 1-2.502 2.923"/><path d="M13.9 21.5a10 10 0 0 1-3.8 0"/><path d="M7.596 19.327a10 10 0 0 1-2.923-2.502"/><path d="M2.5 13.9a10 10 0 0 1 0-3.8"/><path d="M4.673 7.596a10 10 0 0 1 2.502-2.923"/></svg>`,
  "Compile": `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  "Unknown": `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
};

function toggleProblemDetail(button) {
  const contestantId = button.dataset.contestantId;
  const problemCode = button.dataset.problem;
  window.location.href = `/contestants/${contestantId}#problem-${problemCode}`;
}

elements.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderTable();
});

elements.refreshButton.addEventListener("click", refreshScoreboard);

elements.tableHead.addEventListener("click", (event) => {
  const th = event.target.closest("th[data-sort-key]");
  if (!th) return;
  toggleSort(th.dataset.sortKey);
});

// Navigation is now handled by standard <a> tags

render();
