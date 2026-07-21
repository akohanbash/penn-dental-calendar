const $ = (id) => document.getElementById(id);
const DIM = "type";
const TERMS_VERSION = "1.0-2026-07-15";
const SETTINGS_KEY = "pdmCalendarPreferencesV2";
let categories = [], tab = null, activeEmojiType = null;

const DEFAULTS = {
  "Lecture": "📚", "Lab": "🧪", "Exam": "📝", "Quiz": "❓", "Review": "🔄",
  "Mastery": "🏆", "Seminar": "💬", "Reflect & Connect": "🤝", "DAU": "🦷", "Other": "📅"
};
const PRESETS = {
  classic: { ...DEFAULTS },
  academic: { "Lecture":"📖", "Lab":"🔬", "Exam":"✍️", "Quiz":"❔", "Review":"📑", "Mastery":"🎓", "Seminar":"🗣️", "Reflect & Connect":"💭", "DAU":"🦷", "Other":"📌" },
  minimal: { "Lecture":"●", "Lab":"◆", "Exam":"▲", "Quiz":"?", "Review":"↻", "Mastery":"★", "Seminar":"◌", "Reflect & Connect":"◇", "DAU":"◈", "Other":"•" },
  dental: { "Lecture":"🦷", "Lab":"🧤", "Exam":"📝", "Quiz":"❓", "Review":"🔍", "Mastery":"🏅", "Seminar":"💬", "Reflect & Connect":"🤝", "DAU":"🪥", "Other":"📅" }
};
const PRESET_LABELS = { classic: "Classic preset", academic: "Academic preset", minimal: "Minimal preset", dental: "Dental preset", none: "No emoji", custom: "Custom icons" };

// Curated, tap-to-pick emoji set. No free typing — every icon is exactly one emoji.
const EMOJI_CHOICES = [
  "📚","📖","📝","✍️","❓","❔","🔬","🧪","🧤","🦷","🪥","🏆","🎓","🏅","💬","🗣️",
  "🤝","💭","📅","📌","🔍","🔄","⭐","✅","❌","⚠️","📎","🗂️","🧮","🩺","💉","🩹",
  "🦴","😁","🙂","🤓","🧠","💡","🔥","⏰","📈","📊","✨","🎯","🧬","🩻","🖊️","📐",
  "🧾","●","◆","▲","★","◇","◈","•"
];

let preferences = {
  calendarName: "Penn Dental", futureOnly: true, emojisEnabled: true, emojis: { ...DEFAULTS }, preset: "classic",
  textTagsEnabled: false,
  reminderEnabled: true, reminderMinutes: 10,
  examReminderEnabled: true, examReminderDays: 7,
};
function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function setStatus(el, text, cls = "") { el.textContent = text; el.className = "status " + cls; }
async function getTab() { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t; }
function send(msg) {
  return new Promise((resolve) => chrome.tabs.sendMessage(tab.id, msg, (res) => {
    if (chrome.runtime.lastError) resolve({ ok: false, error: "Reload the Penn schedule page and try again." });
    else resolve(res);
  }));
}
function escapeHtml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function defaultEmoji(label) { return DEFAULTS[label] || DEFAULTS.Other; }
function currentEmoji(label) { return preferences.emojis[label] || defaultEmoji(label); }

async function savePreferences() {
  preferences.calendarName = $("calendarName").value.trim() || "Penn Dental";
  preferences.futureOnly = $("futureOnly").checked;
  preferences.reminderEnabled = $("reminderEnabled").checked;
  preferences.reminderMinutes = clampInt($("reminderMinutes").value, 10, 0, 120);
  $("reminderMinutes").value = preferences.reminderMinutes;
  preferences.examReminderEnabled = $("examReminderEnabled").checked;
  preferences.examReminderDays = clampInt($("examReminderDays").value, 7, 0, 30);
  $("examReminderDays").value = preferences.examReminderDays;
  preferences.textTagsEnabled = $("textTagsEnabled").checked;
  await chrome.storage.local.set({ [SETTINGS_KEY]: preferences });
}

function syncReminderRows() {
  $("reminderMinutesRow").hidden = !preferences.reminderEnabled;
  $("examReminderDaysRow").hidden = !preferences.examReminderEnabled;
}

function updateEditorButton() {
  const emoji = preferences.emojisEnabled ? currentEmoji(categories[0]?.label || "Lecture") : "🚫";
  $("emojiEditorPreview").textContent = emoji;
  $("emojiEditorSubtext").textContent = PRESET_LABELS[preferences.preset] || "Custom icons";
}

function renderEditor() {
  const ordered = [...categories];
  $("emojiEditor").innerHTML = ordered.map((c) => `
    <div class="emoji-row" data-type="${escapeHtml(c.label)}">
      <button class="emoji-pick" data-type="${escapeHtml(c.label)}" type="button" aria-label="Choose icon for ${escapeHtml(c.label)}">${preferences.emojisEnabled ? escapeHtml(currentEmoji(c.label)) : "🚫"}</button>
      <span class="emoji-type"><strong>${escapeHtml(c.label)}</strong><small>${c.count} event${c.count === 1 ? "" : "s"}</small></span>
      <button class="row-reset" data-reset="${escapeHtml(c.label)}" type="button" title="Reset ${escapeHtml(c.label)}">↺</button>
    </div>`).join("");

  document.querySelectorAll(".emoji-pick").forEach((btn) => btn.addEventListener("click", () => openEmojiPicker(btn.dataset.type)));
  document.querySelectorAll(".row-reset").forEach((button) => button.addEventListener("click", async () => {
    const type = button.dataset.reset;
    const base = PRESETS[preferences.preset] ? (PRESETS[preferences.preset][type] || PRESETS[preferences.preset].Other) : null;
    preferences.emojis[type] = base || defaultEmoji(type);
    preferences.emojisEnabled = true;
    renderEditor(); updatePresetButtons(); updateEditorButton(); await savePreferences();
  }));
  updateEditorButton();
}

function updatePresetButtons() {
  document.querySelectorAll(".preset").forEach((b) => b.classList.toggle("active", b.dataset.preset === preferences.preset));
}

async function applyPreset(name) {
  if (name === "none") {
    preferences.preset = "none";
    preferences.emojisEnabled = false;
  } else {
    const preset = PRESETS[name]; if (!preset) return;
    preferences.preset = name;
    preferences.emojisEnabled = true;
    for (const c of categories) preferences.emojis[c.label] = preset[c.label] || preset.Other || defaultEmoji(c.label);
  }
  renderEditor(); updatePresetButtons(); await savePreferences();
}

function renderEmojiGrid() {
  $("emojiGrid").innerHTML = EMOJI_CHOICES.map((e) => `<button class="emoji-choice" type="button" data-emoji="${escapeHtml(e)}">${escapeHtml(e)}</button>`).join("");
  document.querySelectorAll(".emoji-choice").forEach((btn) => btn.addEventListener("click", async () => {
    if (!activeEmojiType) return;
    preferences.emojis[activeEmojiType] = btn.dataset.emoji;
    preferences.emojisEnabled = true;
    preferences.preset = "custom";
    closeEmojiPicker();
    renderEditor(); updatePresetButtons(); await savePreferences();
  }));
}

function openEmojiPicker(type) {
  activeEmojiType = type;
  $("pickerTypeName").textContent = type;
  $("emojiPicker").hidden = false;
}
function closeEmojiPicker() { $("emojiPicker").hidden = true; activeEmojiType = null; }

async function loadData() {
  const res = await send({ action: "analyze", dim: DIM });
  if (!res.ok) { setStatus($("loading"), res.error, "error"); return; }
  categories = res.categories;
  $("loading").hidden = true; $("ui").hidden = false;
  renderEditor(); updatePresetButtons();
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
function showTerms() { $("app").hidden = true; $("termsGate").hidden = false; $("agreeTerms").checked = false; $("acceptTerms").disabled = true; }
async function showApp() {
  $("termsGate").hidden = true; $("app").hidden = false;
  const stored = await chrome.storage.local.get([SETTINGS_KEY]);
  preferences = { ...preferences, ...(stored[SETTINGS_KEY] || {}), emojis: { ...DEFAULTS, ...((stored[SETTINGS_KEY] || {}).emojis || {}) } };
  $("calendarName").value = preferences.calendarName;
  $("futureOnly").checked = preferences.futureOnly;
  $("reminderEnabled").checked = preferences.reminderEnabled;
  $("reminderMinutes").value = preferences.reminderMinutes;
  $("examReminderEnabled").checked = preferences.examReminderEnabled;
  $("examReminderDays").value = preferences.examReminderDays;
  $("textTagsEnabled").checked = preferences.textTagsEnabled;
  syncReminderRows();
  tab = await getTab();
  if (!tab || !/inside\.apps\.dental\.upenn\.edu/.test(tab.url || "")) { setStatus($("loading"), "Open your Penn Dental schedule page first, then click the extension.", "error"); return; }
  loadData();
}

$("agreeTerms").addEventListener("change", () => $("acceptTerms").disabled = !$("agreeTerms").checked);
$("acceptTerms").addEventListener("click", async () => { if (!$("agreeTerms").checked) return; await chrome.storage.local.set({ acceptedTermsVersion: TERMS_VERSION, acceptedTermsAt: new Date().toISOString() }); showApp(); });
$("viewTerms").addEventListener("click", showTerms);

$("openEmojiEditor").addEventListener("click", () => { $("mainView").hidden = true; $("emojiPage").hidden = false; });
$("backFromEmoji").addEventListener("click", () => { $("emojiPage").hidden = true; $("mainView").hidden = false; });
$("closePicker").addEventListener("click", closeEmojiPicker);
$("emojiPicker").addEventListener("click", (e) => { if (e.target.id === "emojiPicker") closeEmojiPicker(); });

$("resetEmojis").addEventListener("click", () => applyPreset("classic"));
document.querySelectorAll(".preset").forEach((b) => b.addEventListener("click", () => applyPreset(b.dataset.preset)));
$("calendarName").addEventListener("change", savePreferences);
$("futureOnly").addEventListener("change", savePreferences);
$("reminderEnabled").addEventListener("change", async () => { preferences.reminderEnabled = $("reminderEnabled").checked; syncReminderRows(); await savePreferences(); });
$("reminderMinutes").addEventListener("change", savePreferences);
$("examReminderEnabled").addEventListener("change", async () => { preferences.examReminderEnabled = $("examReminderEnabled").checked; syncReminderRows(); await savePreferences(); });
$("examReminderDays").addEventListener("change", savePreferences);
$("textTagsEnabled").addEventListener("change", savePreferences);

$("export").addEventListener("click", async () => {
  $("export").disabled = true; $("next").hidden = true; setStatus($("status"), "Building your calendar…");
  await savePreferences();
  const calendarName = preferences.calendarName;
  const mapping = {}; for (const c of categories) mapping[c.key] = { calendarName };
  const options = {
    emojis: preferences.emojis, emojisEnabled: preferences.emojisEnabled, textTagsEnabled: preferences.textTagsEnabled,
    reminderEnabled: preferences.reminderEnabled, reminderMinutes: preferences.reminderMinutes,
    examReminderEnabled: preferences.examReminderEnabled, examReminderDays: preferences.examReminderDays,
  };
  const res = await send({ action:"build", dim:DIM, mapping, futureOnly:preferences.futureOnly, options });
  $("export").disabled = false;
  if (!res.ok || !res.files.length) { setStatus($("status"), res.error || "No classes matched.", "error"); return; }
  const f = res.files[0]; downloadBlob(new Blob([f.ics], { type:"text/calendar" }), f.name);
  $("chosenName").textContent = calendarName; setStatus($("status"), `Downloaded ${f.count} events.`, "done"); $("next").hidden = false;
});
$("openImport").addEventListener("click", () => chrome.tabs.create({ url:"https://calendar.google.com/calendar/u/0/r/settings/export" }));

renderEmojiGrid();
(async function init() { const stored = await chrome.storage.local.get(["acceptedTermsVersion"]); if (stored.acceptedTermsVersion === TERMS_VERSION) showApp(); else showTerms(); })();
