/* eCOA Demo Backend — Express + SQLite + Nodemailer */
"use strict";
require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { DatabaseSync } = require("node:sqlite"); // Node 22+ 내장 SQLite
const nodemailer = require("nodemailer");

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ADMIN_ID = process.env.ADMIN_ID || "admin";
const ADMIN_PW = process.env.ADMIN_PW || "admin1234";
const GMAIL_USER = process.env.GMAIL_USER || "";
const GMAIL_APP_PASS = process.env.GMAIL_APP_PASS || "";

const STUDY = { id: "DEMO-001", visit: "Week 1", formId: "PRO-NRS-LIKERT", formVersion: "1.0.0" };

/* ---------- DB ---------- */
const db = new DatabaseSync(path.join(__dirname, "ecoa.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    visit TEXT NOT NULL,
    registered_at TEXT NOT NULL,
    reminders INTEGER NOT NULL DEFAULT 0,
    last_reminder_at TEXT
  );
  CREATE TABLE IF NOT EXISTS responses (
    subject_id TEXT PRIMARY KEY REFERENCES patients(id),
    payload TEXT NOT NULL,
    completed_at TEXT NOT NULL
  );
`);

// 최초 실행 시 시드
if (db.prepare("SELECT COUNT(*) AS c FROM patients").get().c === 0) {
  const ins = db.prepare("INSERT INTO patients (id,email,visit,registered_at) VALUES (?,?,?,?)");
  const now = Date.now();
  ins.run("S-001", "minji.kim@example.com", STUDY.visit, new Date(now - 86400000).toISOString());
  ins.run("S-002", "jihoon.lee@example.com", STUDY.visit, new Date(now - 86400000).toISOString());
  ins.run("S-003", "sora.park@example.com", STUDY.visit, new Date(now - 86400000).toISOString());
}

/* ---------- 메일 ---------- */
const mailEnabled = !!(GMAIL_USER && GMAIL_APP_PASS);
const transporter = mailEnabled
  ? nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASS },
    })
  : null;

/* ---------- 세션 (메모리) ---------- */
const sessions = new Map(); // token -> { user, createdAt }
const SESSION_TTL = 1000 * 60 * 60 * 8; // 8h

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function getSession(req) {
  const tok = parseCookies(req)["ecoa_session"];
  if (!tok) return null;
  const s = sessions.get(tok);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL) { sessions.delete(tok); return null; }
  return { token: tok, ...s };
}
function requireAuth(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: "unauthorized" });
  req.session = s;
  next();
}

/* ---------- 앱 ---------- */
const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ----- 인증 ----- */
app.post("/api/login", (req, res) => {
  const { id, pw } = req.body || {};
  if (id !== ADMIN_ID || pw !== ADMIN_PW) {
    return res.status(401).json({ error: "invalid_credentials" });
  }
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { user: id, createdAt: Date.now() });
  res.setHeader("Set-Cookie", `ecoa_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`);
  res.json({ ok: true, user: id });
});

app.post("/api/logout", (req, res) => {
  const s = getSession(req);
  if (s) sessions.delete(s.token);
  res.setHeader("Set-Cookie", "ecoa_session=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/session", (req, res) => {
  const s = getSession(req);
  res.json({ authed: !!s, user: s ? s.user : null, study: STUDY, mailEnabled });
});

/* ----- 환자 (관리자) ----- */
function patientRow(r) {
  const resp = db.prepare("SELECT payload FROM responses WHERE subject_id=?").get(r.id);
  return {
    id: r.id, email: r.email, visit: r.visit,
    registeredAt: r.registered_at,
    reminders: r.reminders, lastReminderAt: r.last_reminder_at,
    response: resp ? JSON.parse(resp.payload) : null,
  };
}

app.get("/api/patients", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM patients ORDER BY id").all();
  res.json({ study: STUDY, patients: rows.map(patientRow) });
});

app.post("/api/patients", requireAuth, (req, res) => {
  const id = String((req.body || {}).id || "").trim().toUpperCase();
  const email = String((req.body || {}).email || "").trim();
  if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(id)) return res.status(400).json({ error: "bad_id" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "bad_email" });
  if (db.prepare("SELECT 1 FROM patients WHERE id=?").get(id)) return res.status(409).json({ error: "duplicate_id" });
  db.prepare("INSERT INTO patients (id,email,visit,registered_at) VALUES (?,?,?,?)")
    .run(id, email, STUDY.visit, new Date().toISOString());
  res.status(201).json({ ok: true, patient: patientRow(db.prepare("SELECT * FROM patients WHERE id=?").get(id)) });
});

/* ----- 알림 이메일 ----- */
app.post("/api/patients/:id/remind", requireAuth, async (req, res) => {
  const pt = db.prepare("SELECT * FROM patients WHERE id=?").get(req.params.id);
  if (!pt) return res.status(404).json({ error: "not_found" });

  const link = `${BASE_URL}/?subject=${encodeURIComponent(pt.id)}`;
  const subject = `[임상시험 ${STUDY.id}] 오늘의 증상 자가보고를 완료해 주세요`;
  const text = `안녕하세요, ${pt.id}님.\n\n${STUDY.visit} 방문의 증상 자가보고(NRS·Likert) 응답을 요청드립니다.\n아래 링크에서 약 1분 내로 완료할 수 있습니다.\n\n${link}\n\n감사합니다.\n임상연구팀`;

  let sent = false, error = null;
  if (mailEnabled) {
    try {
      await transporter.sendMail({ from: `"임상연구팀" <${GMAIL_USER}>`, to: pt.email, subject, text });
      sent = true;
    } catch (e) {
      error = e.message;
    }
  }
  if (sent || !mailEnabled) {
    db.prepare("UPDATE patients SET reminders=reminders+1, last_reminder_at=? WHERE id=?")
      .run(new Date().toISOString(), pt.id);
  }
  res.status(error ? 502 : 200).json({ ok: !error, sent, simulated: !mailEnabled, error, to: pt.email, subject, body: text, link });
});

/* ----- 환자 화면 (공개) ----- */
app.get("/api/subjects/:id", (req, res) => {
  const pt = db.prepare("SELECT * FROM patients WHERE id=?").get(req.params.id);
  if (!pt) return res.status(404).json({ error: "not_found" });
  const done = !!db.prepare("SELECT 1 FROM responses WHERE subject_id=?").get(pt.id);
  res.json({ id: pt.id, visit: pt.visit, hasResponse: done, study: STUDY });
});

app.post("/api/subjects/:id/response", (req, res) => {
  const pt = db.prepare("SELECT * FROM patients WHERE id=?").get(req.params.id);
  if (!pt) return res.status(404).json({ error: "not_found" });

  const p = req.body || {};
  const items = Array.isArray(p.items) ? p.items : [];
  const pain = items.find((i) => i.itemId === "PAIN_NRS");
  const fatigue = items.find((i) => i.itemId === "FATIGUE_LIKERT");
  if (!pain || !Number.isInteger(pain.value) || pain.value < 0 || pain.value > 10)
    return res.status(400).json({ error: "bad_pain_value" });
  if (!fatigue || !Number.isInteger(fatigue.value) || fatigue.value < 0 || fatigue.value > 4)
    return res.status(400).json({ error: "bad_fatigue_value" });

  const payload = {
    studyId: STUDY.id, subjectId: pt.id, visit: pt.visit,
    formId: STUDY.formId, formVersion: STUDY.formVersion, locale: "ko-KR",
    startedAt: p.startedAt || null,
    completedAt: new Date().toISOString(),
    durationSec: Number.isFinite(p.durationSec) ? p.durationSec : null,
    items: [pain, fatigue],
  };
  db.prepare(`
    INSERT INTO responses (subject_id, payload, completed_at) VALUES (?,?,?)
    ON CONFLICT(subject_id) DO UPDATE SET payload=excluded.payload, completed_at=excluded.completed_at
  `).run(pt.id, JSON.stringify(payload), payload.completedAt);
  res.status(201).json({ ok: true, payload });
});

app.listen(PORT, () => {
  console.log(`eCOA demo server: ${BASE_URL}`);
  console.log(`  admin: ${ADMIN_ID} / ${ADMIN_PW === "admin1234" ? "admin1234 (기본값, .env에서 변경 권장)" : "(.env 설정값)"}`);
  console.log(`  email: ${mailEnabled ? "Gmail SMTP 활성 (" + GMAIL_USER + ")" : "미설정 → 시뮬레이션 모드"}`);
});
