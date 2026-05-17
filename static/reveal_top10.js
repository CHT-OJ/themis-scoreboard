const state = {
  data: window.INITIAL_SCOREBOARD || null,
  search: "",
  revealedTopIds: new Set(),
  hiddenLimit: 10,
  lastRevealedId: null,
  lockShuffleOrder: [],
};

const elements = {
  pageTitle: document.querySelector("#pageTitle"),
  snapshotMeta: document.querySelector("#snapshotMeta"),
  revealStatus: document.querySelector("#revealStatus"),
  emptyState: document.querySelector("#emptyState"),
  content: document.querySelector("#scoreboardContent"),
  tableHead: document.querySelector("#tableHead"),
  tableBody: document.querySelector("#tableBody"),
  searchInput: document.querySelector("#searchInput"),
  revealButton: document.querySelector("#revealButton"),
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

function sortByScoreDesc(contestants) {
  return [...contestants].sort((a, b) => {
    const scoreDiff = Number(b.total_score || 0) - Number(a.total_score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    const codeDiff = String(a.code || "").localeCompare(String(b.code || ""), "vi", { sensitivity: "base" });
    if (codeDiff !== 0) return codeDiff;
    return String(a.room || "").localeCompare(String(b.room || ""), "vi", { sensitivity: "base" });
  });
}

function topHiddenIds(sortedContestants) {
  return sortedContestants.slice(0, state.hiddenLimit).map((item) => item.id);
}

function shuffleIds(ids) {
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function sameIdSet(a, b) {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((id) => setA.has(id));
}

function ensureLockShuffleOrder(hiddenIds) {
  if (!sameIdSet(state.lockShuffleOrder, hiddenIds)) {
    state.lockShuffleOrder = shuffleIds(hiddenIds);
  }
}

function top10Context() {
  const sorted = sortByScoreDesc(state.data?.contestants || []);
  const hiddenIds = topHiddenIds(sorted);
  ensureLockShuffleOrder(hiddenIds);
  return {
    sorted,
    hiddenIds,
    hiddenSet: new Set(hiddenIds),
    revealOrderIds: [...hiddenIds].reverse(),
    shuffledLockedIds: state.lockShuffleOrder.filter((id) => hiddenIds.includes(id) && !state.revealedTopIds.has(id)),
  };
}

function revealedCount(hiddenIds) {
  return hiddenIds.filter((id) => state.revealedTopIds.has(id)).length;
}

function markRevealedWithAnimation(contestantId) {
  state.lastRevealedId = contestantId;
  window.setTimeout(() => {
    if (state.lastRevealedId === contestantId) {
      state.lastRevealedId = null;
      renderTable();
    }
  }, 800);
}

function unlockContestantById(contestantId) {
  const { hiddenSet } = top10Context();
  if (!hiddenSet.has(contestantId) || state.revealedTopIds.has(contestantId)) {
    return false;
  }
  state.revealedTopIds.add(contestantId);
  markRevealedWithAnimation(contestantId);
  render();
  return true;
}

function contestantsForRender() {
  const { sorted, hiddenIds, hiddenSet, shuffledLockedIds } = top10Context();
  const byId = new Map(sorted.map((contestant) => [contestant.id, contestant]));
  const displayRows = [];
  let lockedIndex = 0;

  for (let index = 0; index < sorted.length; index += 1) {
    if (index < hiddenIds.length) {
      const slotId = hiddenIds[index];
      const shownId = state.revealedTopIds.has(slotId) ? slotId : (shuffledLockedIds[lockedIndex] ?? slotId);
      if (!state.revealedTopIds.has(slotId)) {
        lockedIndex += 1;
      }
      const contestant = byId.get(shownId);
      if (!contestant) continue;
      const isLocked = hiddenSet.has(shownId) && !state.revealedTopIds.has(shownId);
      displayRows.push({
        ...contestant,
        display_rank: index + 1,
        isLocked,
      });
      continue;
    }

    displayRows.push({
      ...sorted[index],
      display_rank: index + 1,
      isLocked: false,
    });
  }

  const search = state.search.trim().toLowerCase();
  if (!search) return displayRows;
  return displayRows.filter((contestant) => {
    const displayCode = contestant.isLocked ? "thi sinh dang khoa" : String(contestant.code || "");
    const displayRoom = contestant.isLocked ? "phong thi dang khoa" : String(contestant.room || "");
    return `${displayCode} ${displayRoom} ${contestant.display_rank}`.toLowerCase().includes(search);
  });
}

function renderRevealControls() {
  const { hiddenIds } = top10Context();
  const totalHidden = hiddenIds.length;
  const revealed = revealedCount(hiddenIds);
  const remaining = totalHidden - revealed;

  elements.revealStatus.textContent =
    totalHidden === 0
      ? "Không có dữ liệu để ẩn top 10."
      : `Đang mở: ${revealed}/${totalHidden}. Còn ẩn: ${remaining}.`;

  elements.revealButton.disabled = remaining <= 0;
  elements.revealButton.textContent =
    remaining <= 0 ? "Đã mở toàn bộ top 10" : `Mở top tiếp theo (${revealed}/${totalHidden})`;
}

function animateRowReorder(previousPositions) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  const rows = [...elements.tableBody.querySelectorAll("tr[data-contestant-id]")];
  rows.forEach((row) => {
    const id = row.dataset.contestantId;
    const prevTop = previousPositions.get(id);
    if (prevTop === undefined) return;
    const currentTop = row.getBoundingClientRect().top;
    const deltaY = prevTop - currentTop;
    if (Math.abs(deltaY) < 1) return;
    row.animate(
      [{ transform: `translateY(${deltaY}px)` }, { transform: "translateY(0)" }],
      {
        duration: 480,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      }
    );
  });
}

function renderTable() {
  const previousPositions = new Map(
    [...elements.tableBody.querySelectorAll("tr[data-contestant-id]")].map((row) => [
      row.dataset.contestantId,
      row.getBoundingClientRect().top,
    ])
  );

  elements.tableHead.innerHTML = `
    <tr>
      <th class="numeric">Rank</th>
      <th>Mã thí sinh</th>
      <th>Phòng thi</th>
      <th class="numeric">Tổng điểm</th>
    </tr>
  `;

  const rows = contestantsForRender()
    .map((contestant) => {
      const rowClasses = [
        contestant.is_top_35 ? "top-rank" : "",
        contestant.isLocked ? "locked-row" : "",
        contestant.id === state.lastRevealedId ? "reveal-row-enter" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const codeCell = contestant.isLocked
        ? `<span class="contestant-name masked-text">THI SINH DANG KHOA</span><span class="lock-chip">LOCKED</span>`
        : `<a class="contestant-link" href="/contestants/${contestant.id}" style="text-decoration: none; color: inherit;"><span class="contestant-name">${escapeHtml(contestant.code)}</span></a>`;
      const roomCell = contestant.isLocked ? `<span class="masked-text">PHONG THI DANG KHOA</span>` : escapeHtml(contestant.room);
      const scoreCell = contestant.isLocked ? `<span class="masked-text">***</span>` : escapeHtml(formatNumber(contestant.total_score));
      return `
        <tr class="${rowClasses}" data-contestant-id="${contestant.id}" data-locked="${contestant.isLocked ? "1" : "0"}">
          <td class="numeric"><span class="rank-pill">${escapeHtml(contestant.display_rank)}</span></td>
          <td>${codeCell}</td>
          <td>${roomCell}</td>
          <td class="numeric">${scoreCell}</td>
        </tr>
      `;
    })
    .join("");

  elements.tableBody.innerHTML = rows || `<tr><td colspan="4">Không có dữ liệu phù hợp tìm kiếm.</td></tr>`;
  animateRowReorder(previousPositions);
}

function render() {
  if (!state.data?.snapshot) {
    elements.snapshotMeta.textContent = "Chưa có snapshot điểm.";
    elements.revealStatus.textContent = "";
    elements.emptyState.hidden = false;
    elements.content.hidden = true;
    return;
  }

  const title = state.data.snapshot.title || "";
  elements.pageTitle.textContent = title ? `Bảng điểm ẩn top 10 - ${title}` : "Bảng điểm ẩn top 10";
  document.title = `${elements.pageTitle.textContent} - CHTCoder`;
  elements.snapshotMeta.textContent = `cập nhật ${state.data.snapshot.created_at}`;
  elements.emptyState.hidden = true;
  elements.content.hidden = false;
  renderRevealControls();
  renderTable();
}

async function refreshScoreboard() {
  const response = await fetch("/api/scoreboard");
  state.data = await response.json();
  state.revealedTopIds = new Set();
  state.lastRevealedId = null;
  state.lockShuffleOrder = [];
  render();
}

function revealNextTop() {
  const { revealOrderIds } = top10Context();
  const nextRevealedId = revealOrderIds.find((id) => !state.revealedTopIds.has(id));
  if (!nextRevealedId) return;
  state.revealedTopIds.add(nextRevealedId);
  markRevealedWithAnimation(nextRevealedId);
  render();
}

elements.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderTable();
});

elements.tableBody.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-contestant-id]");
  if (!row) return;
  const contestantId = Number(row.dataset.contestantId);
  const isLocked = row.dataset.locked === "1";
  if (isLocked) {
    unlockContestantById(contestantId);
    return;
  }
  if (!event.target.closest("a")) {
    window.location.href = `/contestants/${contestantId}`;
  }
});

elements.revealButton.addEventListener("click", revealNextTop);
elements.refreshButton.addEventListener("click", refreshScoreboard);

render();
