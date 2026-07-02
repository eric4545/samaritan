/**
 * Self-contained SPA served by `samaritan serve` at `GET /`. No external
 * scripts/styles/fonts — everything is inlined so the page works offline and
 * without a build step. Vanilla JS only (no framework, no bundler).
 *
 * IMPORTANT: this module intentionally avoids JS template literals (backtick
 * strings) inside `CLIENT_JS` so that string is never mistaken for part of
 * the *outer* TypeScript template literal that assembles the page. Client
 * code below uses string concatenation (`+`) instead of `${...}`.
 */

export interface AppBootstrap {
  name?: string;
  version?: string;
  initialEnv?: string;
}

/** Escape text for safe interpolation into HTML (both element text and
 * attribute values — browsers decode entity refs the same way in both
 * positions, so one helper covers both call sites). */
function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return c;
    }
  });
}

const CSS = `
  :root {
    color-scheme: light dark;
    --bg: #0f1115;
    --panel: #171a21;
    --border: #2a2f3a;
    --text: #e6e8eb;
    --muted: #9399a6;
    --accent: #4f8cff;
    --danger: #e5534b;
    --success: #3fb950;
    --warn: #d29922;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); }
  #app { max-width: 960px; margin: 0 auto; padding: 16px 20px 60px; }
  header h1 { margin: 0 0 4px; font-size: 22px; display: flex; align-items: center; gap: 10px; }
  .badge { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 999px; background: var(--warn); color: #1a1300; }
  .badge.phase { background: #2a2f3a; color: var(--muted); text-transform: uppercase; }
  .badge.status { background: #2a2f3a; color: var(--muted); text-transform: uppercase; }
  .status-completed .badge.status { background: var(--success); color: #04220a; }
  .status-failed .badge.status { background: var(--danger); color: #2a0503; }
  .status-skipped .badge.status { background: var(--warn); color: #1a1300; }
  .muted { color: var(--muted); font-size: 13px; }
  nav { margin: 10px 0 18px; display: flex; gap: 8px; }
  .nav-btn, .tab-btn { background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 14px; }
  .nav-btn.active, .tab-btn.active { border-color: var(--accent); color: var(--accent); }
  .tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  .run-controls { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
  #operator-input, .note-input, .evidence-description, .evidence-content { background: var(--panel); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 6px 10px; font-size: 13px; }
  button { background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
  button:hover { border-color: var(--accent); }
  .progress-bar { height: 8px; background: var(--panel); border: 1px solid var(--border); border-radius: 999px; overflow: hidden; margin-bottom: 18px; }
  .progress-fill { height: 100%; width: 0%; background: var(--accent); transition: width 0.2s ease; }
  .step-card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin-bottom: 12px; }
  .step-card.not-applicable { opacity: 0.5; }
  .step-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
  .step-label { font-weight: 700; color: var(--accent); }
  .step-name { font-weight: 600; }
  .meta-row { display: flex; gap: 16px; font-size: 12px; color: var(--muted); margin-bottom: 8px; }
  .instruction { white-space: pre-wrap; margin-bottom: 8px; font-size: 14px; }
  .command-row { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
  pre.command { flex: 1; background: #0b0d12; border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; margin: 0; overflow-x: auto; font-size: 13px; }
  .expect { font-size: 13px; margin-bottom: 8px; }
  .evidence-meta { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
  .evidence-results, .evidence-list { font-size: 12px; margin-bottom: 8px; }
  .controls { display: flex; gap: 8px; margin-bottom: 8px; }
  .controls button[data-status="completed"]:hover { border-color: var(--success); }
  .controls button[data-status="failed"]:hover { border-color: var(--danger); }
  .notes { margin-bottom: 8px; }
  .note { font-size: 12px; background: #0b0d12; border-radius: 4px; padding: 4px 8px; margin-bottom: 4px; }
  .note-row { display: flex; gap: 8px; margin-bottom: 8px; }
  .note-input { flex: 1; }
  details.evidence-add { margin-bottom: 8px; }
  details.evidence-add > summary { cursor: pointer; font-size: 13px; color: var(--muted); }
  details.evidence-add > div, .evidence-add-body { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
  .history-row { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; margin-bottom: 8px; cursor: pointer; }
  .history-row:hover { border-color: var(--accent); }
  table.ledger { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 12px; }
  table.ledger th, table.ledger td { border: 1px solid var(--border); padding: 6px 8px; text-align: left; vertical-align: top; }
`;

// NOTE: no template literals / "${" here — see file header comment.
const CLIENT_JS = [
  '(function () {',
  '  "use strict";',
  '  var state = {',
  '    view: null,',
  '    selectedEnv: null,',
  '    session: null,',
  '    historyList: [],',
  '    page: "run"',
  '  };',
  '',
  '  function esc(value) {',
  '    return String(value === undefined || value === null ? "" : value).replace(/[&<>"\']/g, function (c) {',
  '      if (c === "&") return "&amp;";',
  '      if (c === "<") return "&lt;";',
  '      if (c === ">") return "&gt;";',
  '      if (c === "\\"") return "&quot;";',
  '      return "&#39;";',
  '    });',
  '  }',
  '',
  '  function api(path, opts) {',
  '    return fetch(path, opts).then(function (res) {',
  '      return res.json().catch(function () { return {}; }).then(function (data) {',
  '        if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));',
  '        return data;',
  '      });',
  '    });',
  '  }',
  '',
  '  function byId(id) { return document.getElementById(id); }',
  '',
  '  function getStepRecord(index) {',
  '    if (!state.session || !state.session.step_log) return null;',
  '    for (var i = 0; i < state.session.step_log.length; i++) {',
  '      if (state.session.step_log[i].index === index) return state.session.step_log[i];',
  '    }',
  '    return null;',
  '  }',
  '',
  '  function renderTabs() {',
  '    var container = byId("env-tabs");',
  '    var html = "";',
  '    for (var i = 0; i < state.view.environments.length; i++) {',
  '      var env = state.view.environments[i];',
  '      var active = env === state.selectedEnv ? " active" : "";',
  '      html += "<button class=\\"tab-btn" + active + "\\" data-env=\\"" + esc(env) + "\\">" + esc(env) + "</button>";',
  '    }',
  '    container.innerHTML = html;',
  '  }',
  '',
  '  function progressPercent() {',
  '    return state.session ? (state.session.completion_percentage || 0) : 0;',
  '  }',
  '',
  '  function renderProgress() {',
  '    byId("progress-fill").style.width = progressPercent() + "%";',
  '    var label = byId("session-label");',
  '    label.textContent = state.session ? ("Session " + state.session.id + " (" + progressPercent() + "%)") : "No run started yet";',
  '  }',
  '',
  '  function renderSteps() {',
  '    var container = byId("steps");',
  '    var out = [];',
  '    for (var i = 0; i < state.view.steps.length; i++) {',
  '      out.push(renderStepCard(state.view.steps[i]));',
  '    }',
  '    container.innerHTML = out.join("");',
  '  }',
  '',
  '  function renderStepCard(step) {',
  '    var envView = step.perEnv[state.selectedEnv];',
  '    var record = getStepRecord(step.index);',
  '    var status = record ? record.status : "pending";',
  '    var html = "";',
  '    if (!envView) {',
  '      html += "<div class=\\"step-card not-applicable\\" data-index=\\"" + step.index + "\\">";',
  '      html += "<div class=\\"step-head\\"><span class=\\"step-label\\">" + esc(step.label) + "</span> <span class=\\"step-name\\">" + esc(step.name) + "</span></div>";',
  '      html += "<div class=\\"muted\\">Not applicable to " + esc(state.selectedEnv) + "</div></div>";',
  '      return html;',
  '    }',
  '    html += "<div class=\\"step-card status-" + esc(status) + "\\" data-index=\\"" + step.index + "\\">";',
  '    html += "<div class=\\"step-head\\">";',
  '    html += "<span class=\\"step-label\\">" + esc(step.label) + "</span>";',
  '    html += "<span class=\\"step-name\\">" + esc(step.name) + "</span>";',
  '    if (step.phase) html += "<span class=\\"badge phase\\">" + esc(step.phase) + "</span>";',
  '    html += "<span class=\\"badge status\\">" + esc(status) + "</span>";',
  '    html += "</div>";',
  '    if (step.pic || step.reviewer) {',
  '      html += "<div class=\\"meta-row\\">";',
  '      if (step.pic) html += "<span>PIC: " + esc(step.pic) + "</span>";',
  '      if (step.reviewer) html += "<span>Reviewer: " + esc(step.reviewer) + "</span>";',
  '      html += "</div>";',
  '    }',
  '    if (envView.instruction) html += "<div class=\\"instruction\\">" + esc(envView.instruction) + "</div>";',
  '    if (envView.command) {',
  '      html += "<div class=\\"command-row\\"><pre class=\\"command\\">" + esc(envView.command) + "</pre>";',
  '      html += "<button data-action=\\"copy\\" data-value=\\"" + esc(envView.command) + "\\">Copy</button></div>";',
  '    }',
  '    if (envView.script) {',
  '      html += "<div class=\\"muted\\">Script: <code>" + esc(envView.script) + "</code></div>";',
  '      if (envView.scriptContent) html += "<pre class=\\"command\\">" + esc(envView.scriptContent) + "</pre>";',
  '    }',
  '    if (envView.expect) html += "<div class=\\"expect\\"><strong>Expected:</strong> " + esc(envView.expect) + "</div>";',
  '    if (envView.evidence) {',
  '      var ev = envView.evidence;',
  '      var types = ev.types && ev.types.length ? (": " + esc(ev.types.join(", "))) : "";',
  '      html += "<div class=\\"evidence-meta\\">Evidence " + (ev.required ? "Required" : "Optional") + types + "</div>";',
  '      if (ev.results && ev.results.length) {',
  '        html += "<div class=\\"evidence-results\\">";',
  '        for (var r = 0; r < ev.results.length; r++) {',
  '          var res = ev.results[r];',
  '          html += "<div>" + esc(res.type) + (res.description ? (": " + esc(res.description)) : "") + "</div>";',
  '        }',
  '        html += "</div>";',
  '      }',
  '    }',
  '    html += "<div class=\\"controls\\">";',
  '    html += "<button data-action=\\"status\\" data-status=\\"completed\\">Done</button>";',
  '    html += "<button data-action=\\"status\\" data-status=\\"failed\\">Failed</button>";',
  '    html += "<button data-action=\\"status\\" data-status=\\"skipped\\">Skip</button>";',
  '    html += "</div>";',
  '    var notes = record && record.notes ? record.notes : [];',
  '    if (notes.length) {',
  '      html += "<div class=\\"notes\\">";',
  '      for (var n = 0; n < notes.length; n++) html += "<div class=\\"note\\">" + esc(notes[n]) + "</div>";',
  '      html += "</div>";',
  '    }',
  '    html += "<div class=\\"note-row\\"><input type=\\"text\\" class=\\"note-input\\" placeholder=\\"Add a note\\" />";',
  '    html += "<button data-action=\\"add-note\\">Add note</button></div>";',
  '    html += "<details class=\\"evidence-add\\"><summary>Add evidence</summary><div class=\\"evidence-add-body\\">";',
  '    html += "<select class=\\"evidence-type\\">";',
  '    var evTypes = ["command_output", "log", "screenshot", "photo", "video", "file"];',
  '    for (var t = 0; t < evTypes.length; t++) html += "<option value=\\"" + evTypes[t] + "\\">" + evTypes[t] + "</option>";',
  '    html += "</select>";',
  '    html += "<input type=\\"text\\" class=\\"evidence-description\\" placeholder=\\"Description (optional)\\" />";',
  '    html += "<textarea class=\\"evidence-content\\" rows=\\"3\\" placeholder=\\"Paste evidence text here\\"></textarea>";',
  '    html += "<button data-action=\\"add-evidence-text\\">Add pasted evidence</button>";',
  '    html += "<input type=\\"file\\" class=\\"evidence-file\\" />";',
  '    html += "<button data-action=\\"add-evidence-file\\">Upload file as evidence</button>";',
  '    html += "</div></details>";',
  '    var refs = record && record.evidence ? record.evidence : [];',
  '    if (refs.length) {',
  '      html += "<div class=\\"evidence-list\\">";',
  '      for (var e = 0; e < refs.length; e++) {',
  '        var ref = refs[e];',
  '        html += "<div>" + esc(ref.type) + (ref.filename ? (" - " + esc(ref.filename)) : "") + (ref.description ? (": " + esc(ref.description)) : "") + "</div>";',
  '      }',
  '      html += "</div>";',
  '    }',
  '    html += "</div>";',
  '    return html;',
  '  }',
  '',
  '  function renderRunView() {',
  '    if (!state.view) return;',
  '    renderTabs();',
  '    renderProgress();',
  '    renderSteps();',
  '  }',
  '',
  '  function loadOperation() {',
  '    return api("/api/operation").then(function (data) {',
  '      state.view = data;',
  '      state.selectedEnv = window.__SAMARITAN_INITIAL_ENV || data.environments[0];',
  '      document.title = data.meta.name + " - SAMARITAN Serve";',
  '      var h1 = document.querySelector("header h1");',
  '      if (h1) h1.childNodes[0].nodeValue = data.meta.name + " ";',
  '      var v = document.querySelector("header .muted");',
  '      if (v) v.textContent = "v" + data.meta.version + (data.meta.description ? (" - " + data.meta.description) : "");',
  '      renderRunView();',
  '    });',
  '  }',
  '',
  '  function loadHistory() {',
  '    return api("/api/history").then(function (data) {',
  '      state.historyList = data;',
  '      renderHistoryList();',
  '    });',
  '  }',
  '',
  '  function renderHistoryList() {',
  '    var container = byId("history-list");',
  '    if (!state.historyList.length) {',
  '      container.innerHTML = "<p class=\\"muted\\">No saved sessions yet.</p>";',
  '      return;',
  '    }',
  '    var html = "";',
  '    for (var i = 0; i < state.historyList.length; i++) {',
  '      var s = state.historyList[i];',
  '      html += "<div class=\\"history-row\\" data-id=\\"" + esc(s.id) + "\\">";',
  '      html += "<div><strong>" + esc(s.operation_id) + "</strong> - " + esc(s.environment) + "</div>";',
  '      html += "<div>Status: " + esc(s.status) + " - " + (s.completion_percentage || 0) + "%</div>";',
  '      html += "<div class=\\"muted\\">Updated: " + esc(new Date(s.updated_at).toLocaleString()) + "</div>";',
  '      html += "</div>";',
  '    }',
  '    container.innerHTML = html;',
  '  }',
  '',
  '  function openHistoryItem(id) {',
  '    api("/api/history/" + encodeURIComponent(id)).then(renderHistoryDetail);',
  '  }',
  '',
  '  function renderHistoryDetail(data) {',
  '    var container = byId("history-detail");',
  '    var session = data.session;',
  '    var stepLog = data.step_log || [];',
  '    var html = "<h3>" + esc(session.operation_id) + " - " + esc(session.environment) + "</h3>";',
  '    html += "<p class=\\"muted\\">Status: " + esc(session.status) + " - Progress: " + (session.completion_percentage || 0) + "% - Mode: " + esc(session.mode || "-") + "</p>";',
  '    if (!stepLog.length) {',
  '      html += "<p class=\\"muted\\">No step records yet.</p>";',
  '    } else {',
  '      html += "<table class=\\"ledger\\"><thead><tr><th>#</th><th>Name</th><th>Status</th><th>Notes</th><th>Evidence</th></tr></thead><tbody>";',
  '      for (var i = 0; i < stepLog.length; i++) {',
  '        var r = stepLog[i];',
  '        var notes = (r.notes || []).map(esc).join("<br>");',
  '        var evidence = (r.evidence || []).map(function (e) {',
  '          return esc(e.type) + (e.filename ? (" (" + esc(e.filename) + ")") : "");',
  '        }).join("<br>");',
  '        html += "<tr><td>" + (r.index + 1) + "</td><td>" + esc(r.name) + "</td><td>" + esc(r.status) + "</td><td>" + notes + "</td><td>" + evidence + "</td></tr>";',
  '      }',
  '      html += "</tbody></table>";',
  '    }',
  '    container.innerHTML = html;',
  '  }',
  '',
  '  function switchPage(page) {',
  '    state.page = page;',
  '    byId("run-view").style.display = page === "run" ? "" : "none";',
  '    byId("history-view").style.display = page === "history" ? "" : "none";',
  '    var buttons = document.querySelectorAll(".nav-btn");',
  '    for (var i = 0; i < buttons.length; i++) {',
  '      buttons[i].classList.toggle("active", buttons[i].getAttribute("data-page") === page);',
  '    }',
  '    if (page === "history") loadHistory();',
  '  }',
  '',
  '  function startRun() {',
  '    var operator = byId("operator-input").value.trim();',
  '    api("/api/runs", {',
  '      method: "POST",',
  '      headers: { "Content-Type": "application/json" },',
  '      body: JSON.stringify({ environment: state.selectedEnv, operator: operator || undefined })',
  '    }).then(function (session) {',
  '      state.session = session;',
  '      renderRunView();',
  '    }).catch(function (err) { alert("Failed to start run: " + err.message); });',
  '  }',
  '',
  '  function setStepStatus(index, status) {',
  '    if (!state.session) { alert("Start a run first"); return; }',
  '    api("/api/runs/" + state.session.id + "/steps/" + index, {',
  '      method: "POST",',
  '      headers: { "Content-Type": "application/json" },',
  '      body: JSON.stringify({ status: status })',
  '    }).then(function (session) {',
  '      state.session = session;',
  '      renderRunView();',
  '    }).catch(function (err) { alert("Failed to update step: " + err.message); });',
  '  }',
  '',
  '  function addNote(index, note) {',
  '    if (!state.session) { alert("Start a run first"); return; }',
  '    if (!note) return;',
  '    api("/api/runs/" + state.session.id + "/steps/" + index, {',
  '      method: "POST",',
  '      headers: { "Content-Type": "application/json" },',
  '      body: JSON.stringify({ note: note })',
  '    }).then(function (session) {',
  '      state.session = session;',
  '      renderRunView();',
  '    }).catch(function (err) { alert("Failed to add note: " + err.message); });',
  '  }',
  '',
  '  function addPastedEvidence(index, type, description, content) {',
  '    if (!state.session) { alert("Start a run first"); return; }',
  '    if (!content) return;',
  '    api("/api/runs/" + state.session.id + "/steps/" + index + "/evidence", {',
  '      method: "POST",',
  '      headers: { "Content-Type": "application/json" },',
  '      body: JSON.stringify({ type: type, description: description || undefined, content: content })',
  '    }).then(function (session) {',
  '      state.session = session;',
  '      renderRunView();',
  '    }).catch(function (err) { alert("Failed to add evidence: " + err.message); });',
  '  }',
  '',
  '  function fileToBase64(file) {',
  '    return new Promise(function (resolve, reject) {',
  '      var reader = new FileReader();',
  '      reader.onload = function () {',
  '        var result = String(reader.result || "");',
  '        var comma = result.indexOf(",");',
  '        resolve(comma === -1 ? result : result.slice(comma + 1));',
  '      };',
  '      reader.onerror = reject;',
  '      reader.readAsDataURL(file);',
  '    });',
  '  }',
  '',
  '  function addFileEvidence(index, type, description, file) {',
  '    if (!state.session) { alert("Start a run first"); return; }',
  '    if (!file) return;',
  '    fileToBase64(file).then(function (dataBase64) {',
  '      return api("/api/runs/" + state.session.id + "/steps/" + index + "/evidence", {',
  '        method: "POST",',
  '        headers: { "Content-Type": "application/json" },',
  '        body: JSON.stringify({ type: type, description: description || undefined, filename: file.name, dataBase64: dataBase64 })',
  '      });',
  '    }).then(function (session) {',
  '      state.session = session;',
  '      renderRunView();',
  '    }).catch(function (err) { alert("Failed to upload evidence: " + err.message); });',
  '  }',
  '',
  '  function copyCommand(text) {',
  '    if (navigator.clipboard && navigator.clipboard.writeText) {',
  '      navigator.clipboard.writeText(text).catch(function () {});',
  '    }',
  '  }',
  '',
  '  document.addEventListener("click", function (e) {',
  '    var navBtn = e.target.closest(".nav-btn");',
  '    if (navBtn) { switchPage(navBtn.getAttribute("data-page")); return; }',
  '',
  '    var tabBtn = e.target.closest(".tab-btn");',
  '    if (tabBtn) { state.selectedEnv = tabBtn.getAttribute("data-env"); renderRunView(); return; }',
  '',
  '    if (e.target.id === "start-run-btn") { startRun(); return; }',
  '',
  '    var historyRow = e.target.closest(".history-row");',
  '    if (historyRow) { openHistoryItem(historyRow.getAttribute("data-id")); return; }',
  '',
  '    var actionEl = e.target.closest("[data-action]");',
  '    if (!actionEl) return;',
  '    var card = e.target.closest(".step-card");',
  '    var index = card ? Number(card.getAttribute("data-index")) : null;',
  '    var action = actionEl.getAttribute("data-action");',
  '',
  '    if (action === "copy") { copyCommand(actionEl.getAttribute("data-value")); }',
  '    else if (action === "status") { setStepStatus(index, actionEl.getAttribute("data-status")); }',
  '    else if (action === "add-note") {',
  '      var noteInput = card.querySelector(".note-input");',
  '      addNote(index, noteInput.value.trim());',
  '      noteInput.value = "";',
  '    } else if (action === "add-evidence-text") {',
  '      var typeSel = card.querySelector(".evidence-type");',
  '      var descInput = card.querySelector(".evidence-description");',
  '      var contentArea = card.querySelector(".evidence-content");',
  '      addPastedEvidence(index, typeSel.value, descInput.value.trim(), contentArea.value);',
  '      contentArea.value = "";',
  '    } else if (action === "add-evidence-file") {',
  '      var typeSel2 = card.querySelector(".evidence-type");',
  '      var descInput2 = card.querySelector(".evidence-description");',
  '      var fileInput = card.querySelector(".evidence-file");',
  '      addFileEvidence(index, typeSel2.value, descInput2.value.trim(), fileInput.files[0]);',
  '    }',
  '  });',
  '',
  '  document.addEventListener("DOMContentLoaded", function () {',
  '    loadOperation();',
  '  });',
  '})();',
].join('\n');

export function renderAppHtml(bootstrap: AppBootstrap = {}): string {
  const name = bootstrap.name ?? 'SAMARITAN Serve';
  const version = bootstrap.version ?? '';
  const initialEnv = bootstrap.initialEnv ?? '';

  return [
    `<title>${esc(name)} - SAMARITAN Serve</title>`,
    '<style>',
    CSS,
    '</style>',
    '<div id="app">',
    '  <header>',
    `    <h1>${esc(name)} <span class="badge">EXPERIMENTAL</span></h1>`,
    `    <div class="muted">v${esc(version)}</div>`,
    '    <nav>',
    '      <button data-page="run" class="nav-btn active">Run</button>',
    '      <button data-page="history" class="nav-btn">History</button>',
    '    </nav>',
    '  </header>',
    '  <main>',
    '    <section id="run-view">',
    '      <div id="env-tabs" class="tabs"></div>',
    '      <div class="run-controls">',
    '        <input id="operator-input" type="text" placeholder="Operator (optional)" />',
    '        <button id="start-run-btn">Start run</button>',
    '        <span id="session-label" class="muted">No run started yet</span>',
    '      </div>',
    '      <div class="progress-bar"><div id="progress-fill" class="progress-fill"></div></div>',
    '      <div id="steps"></div>',
    '    </section>',
    '    <section id="history-view" style="display:none">',
    '      <div id="history-list"></div>',
    '      <div id="history-detail"></div>',
    '    </section>',
    '  </main>',
    '</div>',
    '<script>',
    `window.__SAMARITAN_INITIAL_ENV = ${JSON.stringify(initialEnv || null)};`,
    CLIENT_JS,
    '</script>',
  ].join('\n');
}
