// content.js — fetches the PDM feed, parses/classifies every event, and builds
// one .ics per calendar the user defines. Same-origin fetch uses the existing
// session; no password, no server, no Google account.

const KIND = /^(Lecture|Lab|Blue Lab|Clinic|Exam|Quiz|Review|Mastery|Make-up lab)$/i;
const HILITE = /^(Exam|Quiz|Mastery)$/i;

let RAW = null; // cached parsed events for this page load

function findFeedUrl() {
  const html = document.documentElement.innerHTML;
  const m = html.match(/data\s*:\s*["']([^"']*calendar_json[^"']*)["']/i);
  return m ? new URL(m[1], location.href).href : null;
}
const toUnix = (d) => Math.floor(d.getTime() / 1000);

async function fetchAllEvents(feedUrl) {
  const base = new URL(feedUrl);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const merged = new Map();
  for (let i = 0; i < 7; i++) {
    const wStart = new Date(start.getFullYear(), start.getMonth() + i * 2, 1);
    const wEnd = new Date(start.getFullYear(), start.getMonth() + i * 2 + 2, 1);
    const u = new URL(base);
    u.searchParams.set("start", toUnix(wStart));
    u.searchParams.set("end", toUnix(wEnd));
    const res = await fetch(u.href, { credentials: "include" });
    if (!res.ok) throw new Error(`Feed error ${res.status}`);
    for (const ev of await res.json()) merged.set(`${ev.start}|${ev.title}`, ev);
  }
  return [...merged.values()];
}

function parseTitle(raw) {
  const parts = raw.split(/<br\s*\/?>/i)
    .map((s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim())
    .filter(Boolean);
  const courseCode = parts.shift() || "";
  let room = null, roomText = null, kind = null; const notes = [];
  for (const p of parts) {
    const rm = p.match(/^Room:\s*(.+)$/i);
    if (rm) { room = rm[1].trim(); roomText = p; continue; }
    if (!kind && KIND.test(p)) { kind = p; continue; }
    notes.push(p);
  }
  return { courseCode, room, roomText, kind, notes };
}

function deriveType(p, rawTitle, courseName) {
  if (p.kind) {
    if (/lab/i.test(p.kind)) return "Lab";
    return p.kind.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (/\bDAU\b/i.test(rawTitle)) return "DAU";
  if (/seminar/i.test(courseName)) return "Seminar";
  if (/reflect/i.test(courseName)) return "Reflect & Connect";
  return "Other";
}

const COURSE_MAP = {
  "5331": "Building Bridges (5331)",
  "5031": "Cell & Molecular (5031)",
  "5821": "Dental Anatomy (5821)",
  "5841": "DAU (5841)",
  "Class of 2030": "Reflect & Connect",
};
function deriveCourse(code, courseName) {
  if (COURSE_MAP[code]) return COURSE_MAP[code];
  if (/seminar/i.test(courseName)) return "Seminars";
  return code || "Other";
}

function parseEvent(ev) {
  const p = parseTitle(ev.title);
  const courseName = ev.description || p.courseCode;
  return {
    start: ev.start, end: ev.end, room: p.room, roomText: p.roomText, kind: p.kind, notes: p.notes,
    courseCode: p.courseCode, courseName,
    type: deriveType(p, ev.title, courseName),
    course: deriveCourse(p.courseCode, courseName),
  };
}

async function ensureData() {
  if (RAW) return RAW;
  const feedUrl = findFeedUrl();
  if (!feedUrl) throw new Error("Couldn't find the schedule feed. Open your PDM schedule page first.");
  RAW = (await fetchAllEvents(feedUrl)).map(parseEvent);
  return RAW;
}

function categoryOf(ev, dim) {
  if (dim === "course") return ev.course;
  if (dim === "both") return `${ev.course} — ${ev.type}`;
  return ev.type;
}

function analyze(dim) {
  const counts = new Map();
  for (const ev of RAW) {
    const c = categoryOf(ev, dim);
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  const cats = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a))
    .map((c) => ({ key: c, label: c, count: counts.get(c) }));
  return { categories: cats };
}

// ---- ICS building -----------------------------------------------------------
function alarmsFor(type, opts) {
  const alarms = [];
  const minutes = Number(opts.reminderMinutes);
  if (opts.reminderEnabled !== false && Number.isFinite(minutes) && minutes > 0) {
    alarms.push(`-PT${minutes}M`);
  }
  const days = Number(opts.examReminderDays);
  if (opts.examReminderEnabled !== false && Number.isFinite(days) && days > 0 && /^(exam|quiz|mastery)$/i.test(type)) {
    alarms.push(`-P${days}D`);
  }
  return alarms;
}
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const dt = (iso) => iso.replace(/[-:]/g, "");
function fold(line) {
  if (line.length <= 73) return line;
  let out = line.slice(0, 73), rest = line.slice(73);
  while (rest.length > 72) { out += "\r\n " + rest.slice(0, 72); rest = rest.slice(72); }
  return out + "\r\n " + rest;
}
async function uid(str) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
  return "pdm-" + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 20) + "@pdm";
}
const VTZ = [
  "BEGIN:VTIMEZONE", "TZID:America/New_York",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "TZNAME:EDT",
  "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "TZNAME:EST",
  "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
  "END:VTIMEZONE",
].join("\r\n");

function defaultEmojiForEvent(ev) {
  const type = String(ev.type || ev.kind || "");
  if (/^Lecture$/i.test(type)) return "📚";
  if (/^Lab$/i.test(type)) return "🧪";
  if (/^Exam$/i.test(type)) return "📝";
  if (/^Quiz$/i.test(type)) return "❓";
  if (/^Review$/i.test(type)) return "🔄";
  if (/^Mastery$/i.test(type)) return "🏆";
  if (/seminar/i.test(type)) return "💬";
  if (/reflect/i.test(type)) return "🤝";
  if (/DAU/i.test(type)) return "🦷";
  return "📅";
}

async function vevent(ev, stamp, opts = {}) {
  const name = ev.courseName || ev.courseCode;
  const extra = ev.notes.map((n) => (n.startsWith(name) ? n.slice(name.length).trim() : n)).filter(Boolean);

  const chosenEmoji = opts.emojisEnabled === false ? "" :
    (opts.emojis?.[ev.type] || defaultEmojiForEvent(ev));
  const tag = opts.textTagsEnabled && /^(exam|quiz)$/i.test(ev.type) ? `${ev.type.toUpperCase()}: ` : "";
  const summary = `${chosenEmoji ? chosenEmoji + " " : ""}${tag}${name}`;

  const desc = [ev.courseCode, ev.kind, ...extra].filter(Boolean).join("\n");
  const alarms = alarmsFor(ev.type, opts).flatMap((t) => [
    "BEGIN:VALARM", "ACTION:DISPLAY", fold(`DESCRIPTION:${esc(summary)}`), `TRIGGER:${t}`, "END:VALARM",
  ]);
  return [
    "BEGIN:VEVENT",
    `UID:${await uid(ev.start + name + (ev.room || ""))}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=America/New_York:${dt(ev.start)}`,
    `DTEND;TZID=America/New_York:${dt(ev.end)}`,
    fold(`SUMMARY:${esc(summary)}`),
    ev.roomText ? fold(`LOCATION:${esc(ev.roomText)}`) : (ev.room ? fold(`LOCATION:${esc(ev.room)}`) : null),
    desc ? fold(`DESCRIPTION:${esc(desc)}`) : null,
    ev.type ? `CATEGORIES:${esc(ev.type.toUpperCase())}` : null,
    ...alarms,
    "END:VEVENT",
  ].filter(Boolean).join("\r\n");
}

async function buildCalendar(calName, events, stamp, opts) {
  const veArr = [];
  for (const ev of events) veArr.push(await vevent(ev, stamp, opts));
  const head = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PDM Schedule Export//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", fold(`X-WR-CALNAME:${esc(calName)}`), fold(`NAME:${esc(calName)}`)];
  return [...head, VTZ, ...veArr, "END:VCALENDAR"].join("\r\n");
}

// mapping: { [categoryKey]: { calendarName } }
async function build(dim, mapping, futureOnly, opts) {
  let events = RAW.slice();
  if (futureOnly) {
    const todayISO = new Date().toISOString().slice(0, 10);
    events = events.filter((e) => e.start.slice(0, 10) >= todayISO);
  }
  events.sort((a, b) => (a.start < b.start ? -1 : 1));

  const byCal = new Map();
  for (const ev of events) {
    const m = mapping[categoryOf(ev, dim)];
    if (!m || !m.calendarName) continue;
    if (!byCal.has(m.calendarName)) byCal.set(m.calendarName, []);
    byCal.get(m.calendarName).push(ev);
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const files = [];
  for (const [cal, evs] of byCal) {
    const ics = await buildCalendar(cal, evs, stamp, opts || {});
    files.push({ name: cal.replace(/[^\w \-]+/g, "").trim() + ".ics", ics, count: evs.length });
  }
  return files;
}


chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.action === "analyze") { await ensureData(); sendResponse({ ok: true, ...analyze(msg.dim) }); }
      else if (msg.action === "build") { sendResponse({ ok: true, files: await build(msg.dim, msg.mapping, msg.futureOnly, msg.options) }); }
    } catch (err) { sendResponse({ ok: false, error: err.message }); }
  })();
  return true;
});
