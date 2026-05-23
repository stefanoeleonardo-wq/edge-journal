import React from "react";
import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, ReferenceLine, Area, AreaChart,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, Cell, PieChart, Pie, ScatterChart, Scatter
} from "recharts";
import {
  Plus, X, TrendingUp, BarChart2, BookOpen,
  Clock, Upload, Trash2,
  Edit3, Save, Activity,
  Search, Check,
  ArrowUpRight, ArrowDownRight, Calendar, Flame, BarChart3
} from "lucide-react";

// ── Supabase config ───────────────────────────────────────────────────────────
const SUPA_URL = import.meta.env.VITE_SUPA_URL || "https://ymdzrhdbogdpsoflkxva.supabase.co";
const SUPA_KEY = import.meta.env.VITE_SUPA_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InltZHpyaGRib2dkcHNvZmxreHZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MTkwNzcsImV4cCI6MjA5NTA5NTA3N30.iQwOpGgCXGrtSF0ZDePEFb-amoWFdeyWTCm8LixUWoI";

const getUserId = () => {
  let uid = localStorage.getItem("ej_uid");
  if (!uid) { uid = "user_" + Math.random().toString(36).slice(2, 11); localStorage.setItem("ej_uid", uid); }
  return uid;
};

const supaFetch = async (path, opts = {}) => {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates", ...opts.headers },
    ...opts
  });
  if (!res.ok) { const e = await res.text(); throw new Error(e); }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

const dbLoad = async (table, fallback) => {
  try {
    const uid = getUserId();
    const rows = await supaFetch(`${table}?user_id=eq.${uid}&select=id,data`);
    if (!rows || !rows.length) return fallback;
    return rows.map(r => r.data);
  } catch (e) { console.error("dbLoad", e); return fallback; }
};

const dbSave = async (table, items) => {
  try {
    const uid = getUserId();
    if (!items.length) return;
    // Upsert all current items
    const rows = items.map(item => ({ id: item.id, user_id: uid, data: item, updated_at: new Date().toISOString() }));
    await supaFetch(table, { method: "POST", body: JSON.stringify(rows), headers: { "Prefer": "resolution=merge-duplicates" } });
    // Delete rows no longer in list
    const existing = await supaFetch(`${table}?user_id=eq.${uid}&select=id`);
    if (existing && existing.length) {
      const currentIds = new Set(items.map(i => String(i.id)));
      const toDelete = existing.filter(r => !currentIds.has(String(r.id))).map(r => r.id);
      if (toDelete.length) {
        await supaFetch(`${table}?user_id=eq.${uid}&id=in.(${toDelete.join(",")})`, { method: "DELETE" });
      }
    }
  } catch (e) { console.error("dbSave error", table, e); }
};

const lsLoad = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };

const calcRR = (dir, entry, sl, tp) => {
  entry = parseFloat(entry); sl = parseFloat(sl); tp = parseFloat(tp);
  if (!entry || !sl || !tp) return null;
  const risk = Math.abs(entry - sl), reward = Math.abs(tp - entry);
  return risk === 0 ? null : parseFloat((reward / risk).toFixed(2));
};
const calcRealRR = (dir, entry, sl, exit) => {
  entry = parseFloat(entry); sl = parseFloat(sl); exit = parseFloat(exit);
  if (!entry || !sl || !exit) return null;
  const risk = Math.abs(entry - sl);
  if (risk === 0) return null;
  const pnl = dir === "Long" ? exit - entry : entry - exit;
  return parseFloat((pnl / risk).toFixed(2));
};

// Per-trade RR: reads the manual override or calculates — stable reference per trade id
const _rrCache = new Map();
const getTradeRR = (t) => {
  const key = `${t.id}_${t.rr_realized}_${t.entry}_${t.sl}_${t.exit}`;
  if (_rrCache.has(key)) return _rrCache.get(key);
  const val = t.rr_realized !== "" ? parseFloat(t.rr_realized) : calcRealRR(t.direction, t.entry, t.sl, t.exit);
  _rrCache.set(key, val);
  // Prevent unbounded growth (keep last 2000 entries)
  if (_rrCache.size > 2000) _rrCache.delete(_rrCache.keys().next().value);
  return val;
};
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—";
const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "";
const todayStr = () => new Date().toISOString().slice(0, 10);

// ── AUTO-DETECT: Session from datetime (NY timezone) ─────────────────────────
const autoDetectSession = (datetimeLocal) => {
  if (!datetimeLocal) return "";
  // Parse the local datetime-local value (browser local time)
  const d = new Date(datetimeLocal);
  // Get NY time: use toLocaleString trick for robust offset
  const nyStr = d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
  const [hStr, mStr] = nyStr.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const mins = h * 60 + m; // minutes since midnight NY
  // London Open: 03:00–07:59 NY
  if (mins >= 180 && mins < 480) return "London Open";
  // NY Open killzone: 09:30–10:30 NY
  if (mins >= 570 && mins < 630) return "NY Open";
  // NY AM: 10:30–12:00 NY
  if (mins >= 630 && mins < 720) return "NY AM";
  // NY PM: 13:30–16:00 NY
  if (mins >= 810 && mins < 960) return "NY PM";
  // Asian: 20:00–03:00 NY (prev night)
  if (mins >= 1200 || mins < 180) return "Asian";
  return "Other";
};

// ── AUTO-DETECT: HTF Bias from MMXM ─────────────────────────────────────────
const autoDetectHTFBias = (mmxm) => {
  if (!mmxm) return "";
  if (mmxm.includes("Buy")) return "Bullish";
  if (mmxm.includes("Sell")) return "Bearish";
  if (mmxm.includes("MMSM>MMBM")) return "Bullish"; // transitioning to bull
  if (mmxm.includes("MMBM>MMSM")) return "Bearish"; // transitioning to bear
  return "";
};

// ── AUTO-TAG: Suggest setup tags from filled fields ──────────────────────────
const autoSuggestSetupGrade = (f) => {
  if (!f) return "";
  let score = 0;
  if (f.trueManipulation) score += 3;
  if (f.stophunt?.includes("Turtle Soup (wick only)")) score += 2;
  if (f.stophunt?.includes("Accumulation swept")) score += 1;
  if (f.smtPresent) score += 1;
  if (f.po3) score += 1;
  if (f.displacingClose) score += 1;
  if (f.manipulation?.includes("True Manipulation")) score += 1;
  if (f.candlesForIFVG && parseInt(f.candlesForIFVG) <= 3) score += 1;
  if (f.closeQuality === "Body-dominant") score += 1;
  if (!f.openLiquidity) score += 1;
  if (f.irlErl === "IRL > ERL") score += 1;

  if (score >= 9) return "A+";
  if (score >= 6) return "A";
  if (score >= 3) return "B";
  return "C (BM)";
};

const OUTCOMES = ["Win", "Loss", "BE"];
const DIRECTIONS = ["Long", "Short"];
const TF_LABELS = ["HTF", "MTF", "LTF"];
const SESSION_OPTS = ["London Open", "NY Open", "NY AM", "NY PM", "Asian", "Other"];
const MANIPULATION_OPTS = ["True Manipulation", "PO3 (after HTF open)", "HTF Key Level", "SMT Divergence", "Stop Hunt Only"];
const STOPHUNT_OPTS = ["Turtle Soup (wick only)", "Body close swept", "Accumulation swept", "No Stop Hunt", "ERL sweep", "IRL sweep"];
const CLOSE_QUALITY_OPTS = ["Body-dominant", "Wick-dominant", "Barely through FVG", "Mixed"];
const LIQUIDITY_TYPE_OPTS = ["LR (Low Resistance)", "HR (High Resistance)", "PDH/PDL", "ITH/ITL", "Session Highs/Lows", "Data High/Low", "Unmitigated FVG", "Previously Manipulated"];
const IRL_ERL_OPTS = ["IRL > ERL", "ERL > IRL", "IRL > IRL", "ERL > ERL"];
const MMXM_OPTS = ["MMBM (Buy Side Curve)", "MMSM (Sell Side Curve)", "Transition MMSM>MMBM", "Transition MMBM>MMSM"];
const SETUP_GRADE = ["A+", "A", "B", "C (BM)"];
const BIAS_OPTS = ["Bullish", "Bearish", "Neutral"];
const CANDLE_COUNT = ["1", "2", "3", "4", "5+"];

const EMPTY_TRADE = {
  id: null, datetime: new Date().toISOString().slice(0, 16), instrument: "", direction: "Long",
  entry: "", sl: "", tp: "", exit: "",
  outcome: "Win", rr_realized: "", pnl_dollars: "", notes: "", review: "",
  session: "", setupGrade: "", mmxm: "", htfBias: "", irlErl: "",
  manipulation: [], stophunt: [], closeQuality: "", candlesForIFVG: "",
  targetType: [], po3: false, smtPresent: false, trueManipulation: false,
  displacingClose: false, openLiquidity: false, htfDol: "",
  images: { HTF: [], MTF: [], LTF: [] }
};

const EMPTY_JOURNAL = {
  id: null, date: todayStr(), mindset: "", good: "", improve: "",
  rating: 3, notes: ""
};

const C = {
  bg: "#050507",
  surface: "#0B0B11",
  surfaceHigh: "#0F0F17",
  border: "#16161F",
  borderMid: "#1E1E2A",
  text: "#E2E0EC",
  textMid: "#7A788C",
  textLow: "#3A384A",
  accent: "#3B82F6",
  accentGlow: "rgba(59,130,246,0.12)",
  cyan: "#06B6D4",
  win: "#22C55E",
  winGlow: "rgba(34,197,94,0.10)",
  loss: "#EF4444",
  lossGlow: "rgba(239,68,68,0.10)",
  be: "#EAB308",
  beGlow: "rgba(234,179,8,0.10)",
  long: "#38BDF8",
  short: "#F43F5E",
};
C.grade = { "A+": C.win, A: "#86EFAC", B: C.be, "C (BM)": C.loss };

const OC = { Win: C.win, Loss: C.loss, BE: C.be };
const gradeColor = g => C.grade[g] || C.textMid;

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Inter+Tight:wght@400;500;600;700&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:#050507}

  /* ── Scrollbar ── */
  ::-webkit-scrollbar{width:4px;height:4px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:#1E1E2A;border-radius:4px;transition:background .2s}
  ::-webkit-scrollbar-thumb:hover{background:#2A2A3A}

  /* ── Inputs ── */
  input,textarea,select{
    background:#050507!important;border:1px solid #16161F!important;color:#E2E0EC!important;
    border-radius:6px;padding:9px 12px;font-family:'Inter Tight',sans-serif;font-size:12px;outline:none;
    transition:border-color .22s cubic-bezier(.4,0,.2,1),box-shadow .22s cubic-bezier(.4,0,.2,1),background .22s;width:100%
  }
  input:hover,textarea:hover,select:hover{border-color:#1E1E2A!important}
  input:focus,textarea:focus,select:focus{
    border-color:#3B82F6!important;
    box-shadow:0 0 0 3px rgba(59,130,246,.12),0 0 12px rgba(59,130,246,.06)!important;
    background:#070710!important
  }
  option{background:#0B0B11}
  button{cursor:pointer;font-family:'Inter',sans-serif}

  /* ── Nav ── */
  .nav-btn{
    background:none;border:none;color:#7A788C;padding:0 14px;height:52px;font-size:13px;
    font-weight:500;letter-spacing:.01em;border-bottom:2px solid transparent;
    transition:color .2s cubic-bezier(.4,0,.2,1),border-color .2s cubic-bezier(.4,0,.2,1);
    display:flex;align-items:center;gap:7px;white-space:nowrap;position:relative
  }
  .nav-btn::after{
    content:'';position:absolute;bottom:-1px;left:50%;right:50%;height:2px;
    background:#3B82F6;border-radius:2px 2px 0 0;
    transition:left .25s cubic-bezier(.4,0,.2,1),right .25s cubic-bezier(.4,0,.2,1)
  }
  .nav-btn:hover{color:#C4C2D4}
  .nav-btn:hover::after{left:14px;right:14px}
  .nav-btn.active{color:#3B82F6}
  .nav-btn.active::after{left:14px;right:14px}

  /* ── Cards ── */
  .card{
    background:#0B0B11;border:1px solid #16161F;border-radius:10px;padding:18px;
    transition:border-color .25s cubic-bezier(.4,0,.2,1),box-shadow .25s cubic-bezier(.4,0,.2,1)
  }
  .card:hover{border-color:#1E1E2A}
  .card-accent{
    background:#0B0B11;border:1px solid #16161F;border-radius:10px;padding:18px;
    position:relative;overflow:hidden;
    transition:border-color .25s,box-shadow .25s
  }
  .card-accent::before{
    content:'';position:absolute;inset:0;
    background:radial-gradient(ellipse at top left,rgba(59,130,246,.04) 0%,transparent 55%);
    pointer-events:none
  }

  /* ── Buttons ── */
  .btn-primary{
    background:#3B82F6;border:none;color:white;padding:8px 16px;border-radius:7px;
    font-size:13px;font-weight:600;
    transition:background .18s,box-shadow .22s cubic-bezier(.4,0,.2,1),transform .15s cubic-bezier(.34,1.56,.64,1);
    display:inline-flex;align-items:center;gap:6px;position:relative;overflow:hidden
  }
  .btn-primary::after{
    content:'';position:absolute;inset:0;background:white;opacity:0;
    transition:opacity .15s
  }
  .btn-primary:hover{
    background:#2563EB;
    box-shadow:0 4px 20px rgba(59,130,246,.35),0 1px 4px rgba(59,130,246,.2);
    transform:translateY(-1px)
  }
  .btn-primary:active{transform:translateY(0) scale(.97)}

  .btn-ghost{
    background:none;border:1px solid #16161F;color:#7A788C;padding:7px 13px;border-radius:7px;
    font-size:12px;font-weight:500;
    transition:border-color .18s,color .18s,background .18s,box-shadow .18s,transform .12s cubic-bezier(.34,1.56,.64,1);
    display:inline-flex;align-items:center;gap:6px
  }
  .btn-ghost:hover{border-color:#2A2A3A;color:#E2E0EC;background:rgba(255,255,255,.02);transform:translateY(-1px)}
  .btn-ghost:active{transform:translateY(0) scale(.97)}

  /* ── Labels ── */
  .lbl{font-family:'Inter Tight',sans-serif;font-size:10px;color:#3A384A;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;font-weight:500}

  /* ── Overlay / Modal — glass blur ── */
  .overlay{
    position:fixed;inset:0;
    background:rgba(2,2,5,.75);
    z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;
    backdrop-filter:blur(16px) saturate(140%);
    -webkit-backdrop-filter:blur(16px) saturate(140%);
    animation:overlayIn .2s ease forwards
  }
  @keyframes overlayIn{from{opacity:0}to{opacity:1}}
  .modal{
    background:rgba(11,11,17,.92);
    border:1px solid #1E1E2A;border-radius:16px;width:100%;max-width:820px;max-height:92vh;overflow-y:auto;
    backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
    box-shadow:0 24px 80px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.03);
    animation:modalIn .25s cubic-bezier(.34,1.2,.64,1) forwards
  }
  @keyframes modalIn{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}

  /* ── Stat num ── */
  .stat-num{font-family:'Inter Tight',sans-serif;font-weight:500;font-variant-numeric:tabular-nums}

  /* ── Badges ── */
  .badge{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;font-family:'Inter Tight',sans-serif;transition:opacity .15s}
  .bw{background:rgba(34,197,94,0.10);color:#22C55E;border:1px solid rgba(34,197,94,.2)}
  .bl{background:rgba(239,68,68,0.10);color:#EF4444;border:1px solid rgba(239,68,68,.2)}
  .bb{background:rgba(234,179,8,0.10);color:#EAB308;border:1px solid rgba(234,179,8,.2)}
  .blong{background:rgba(56,189,248,.08);color:#38BDF8;border:1px solid rgba(56,189,248,.2)}
  .bshort{background:rgba(244,63,94,.08);color:#F43F5E;border:1px solid rgba(244,63,94,.2)}

  /* ── Pills ── */
  .pill{
    display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:5px;
    font-size:11px;font-weight:500;font-family:'Inter Tight',sans-serif;cursor:pointer;
    transition:all .18s cubic-bezier(.4,0,.2,1);
    border:1px solid #16161F;color:#7A788C;background:none
  }
  .pill:hover{border-color:#2A2A3A;color:#C4C2D4;background:rgba(255,255,255,.02);transform:translateY(-1px)}
  .pill:active{transform:translateY(0)}
  .pill.active{background:rgba(59,130,246,0.12);border-color:#3B82F6;color:#3B82F6;box-shadow:0 0 8px rgba(59,130,246,.15)}
  .pill-green.active{background:rgba(34,197,94,0.10);border-color:#22C55E;color:#22C55E;box-shadow:0 0 8px rgba(34,197,94,.12)}
  .pill-red.active{background:rgba(239,68,68,0.10);border-color:#EF4444;color:#EF4444;box-shadow:0 0 8px rgba(239,68,68,.12)}
  .pill-yellow.active{background:rgba(234,179,8,0.10);border-color:#EAB308;color:#EAB308;box-shadow:0 0 8px rgba(234,179,8,.12)}

  /* ── Trade rows ── */
  .row-tr{
    border:1px solid #16161F;border-radius:8px;padding:12px 16px;margin-bottom:5px;cursor:pointer;
    transition:border-color .2s,background .2s,transform .18s cubic-bezier(.4,0,.2,1),box-shadow .2s;
    display:flex;align-items:center;gap:12px;background:#050507;
    will-change:transform
  }
  .row-tr:hover{
    border-color:#1E1E2A;background:#0B0B11;
    transform:translateX(3px);
    box-shadow:inset 3px 0 0 #3B82F6,0 2px 12px rgba(0,0,0,.3)
  }
  .row-tr:active{transform:translateX(2px) scale(.995)}

  /* ── Image thumbnails ── */
  .img-th{
    width:64px;height:46px;object-fit:cover;border-radius:4px;border:1px solid #16161F;cursor:pointer;
    transition:border-color .2s,transform .2s cubic-bezier(.34,1.56,.64,1),box-shadow .2s
  }
  .img-th:hover{border-color:#3B82F6;transform:scale(1.08);box-shadow:0 4px 16px rgba(59,130,246,.2)}

  /* ── Check rows ── */
  .check-row{
    display:flex;align-items:flex-start;gap:10px;padding:9px 11px;border-radius:7px;cursor:pointer;
    transition:background .15s,border-color .15s,transform .12s;
    border:1px solid transparent
  }
  .check-row:hover{background:#0F0F17;border-color:#16161F;transform:translateX(2px)}

  /* ── Divider ── */
  .divider{height:1px;background:#16161F;margin:16px 0}

  /* ── Section titles ── */
  .section-title{
    font-family:'Inter Tight',sans-serif;font-weight:500;font-size:10px;text-transform:uppercase;
    letter-spacing:.12em;color:#3A384A;margin-bottom:12px;display:flex;align-items:center;gap:10px
  }
  .section-title::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,#16161F,transparent)}

  /* ── KPI cards ── */
  .kpi-card{
    background:#0B0B11;border:1px solid #16161F;border-radius:8px;padding:16px;position:relative;overflow:hidden;
    transition:border-color .22s,transform .22s cubic-bezier(.34,1.2,.64,1),box-shadow .22s
  }
  .kpi-card:hover{
    border-color:var(--ka,#3B82F6);
    transform:translateY(-3px);
    box-shadow:0 8px 32px rgba(0,0,0,.3),0 0 0 1px var(--ka,#3B82F6)22
  }
  .kpi-card::after{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:var(--ka,#3B82F6);opacity:.7;transition:opacity .22s}
  .kpi-card:hover::after{opacity:1}

  /* ── Animations ── */
  @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  @keyframes slideInRight{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:translateX(0)}}
  @keyframes pulseGlow{0%,100%{opacity:.5}50%{opacity:1}}
  @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}

  .fade-in{animation:fadeUp .28s cubic-bezier(.4,0,.2,1) forwards}
  .slide-in{animation:slideInRight .22s cubic-bezier(.4,0,.2,1) forwards}

  /* ── Range input ── */
  input[type=range]{padding:0!important;height:4px!important;accent-color:#3B82F6}

  /* ── Floating glass panels (dashboard) ── */
  .glass-panel{
    background:rgba(11,11,17,.8);
    border:1px solid rgba(255,255,255,.04);
    border-radius:14px;
    backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
    box-shadow:0 4px 24px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.03);
    transition:border-color .25s,box-shadow .25s,transform .25s cubic-bezier(.4,0,.2,1)
  }
  .glass-panel:hover{
    border-color:rgba(255,255,255,.07);
    box-shadow:0 8px 40px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.04)
  }

  /* ── Live indicator ── */
  .live-dot{
    width:6px;height:6px;border-radius:50%;background:#22C55E;
    animation:pulseGlow 2s ease-in-out infinite;
    box-shadow:0 0 6px #22C55E
  }

  /* ── Tooltip custom ── */
  .recharts-tooltip-wrapper{transition:opacity .15s!important}

  /* ── Smooth number transitions ── */
  .stat-num{transition:color .3s}

  /* ── Replay timeline ── */
  @keyframes replayPulse{0%,100%{opacity:.4;transform:scale(1)}50%{opacity:1;transform:scale(1.15)}}
  @keyframes tradeReveal{from{opacity:0;transform:translateY(8px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
  @keyframes equityDraw{from{stroke-dashoffset:1000}to{stroke-dashoffset:0}}
  @keyframes numberCount{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
  .replay-trade-node{transition:all .3s cubic-bezier(.34,1.2,.64,1)}
  .replay-trade-node:hover{transform:scale(1.08)}
  .replay-scrubber::-webkit-slider-thumb{
    -webkit-appearance:none;width:18px;height:18px;border-radius:50%;
    background:#3B82F6;border:2px solid #050507;
    box-shadow:0 0 12px rgba(59,130,246,.5);cursor:pointer;
    transition:transform .15s,box-shadow .15s
  }
  .replay-scrubber::-webkit-slider-thumb:hover{transform:scale(1.2);box-shadow:0 0 20px rgba(59,130,246,.7)}
  .replay-scrubber::-webkit-slider-runnable-track{
    height:4px;border-radius:2px;
    background:linear-gradient(90deg,#3B82F6 var(--pct,0%),#16161F var(--pct,0%))
  }
  .replay-scrubber{width:100%;-webkit-appearance:none;appearance:none;height:4px;border-radius:2px;outline:none;cursor:pointer}
`;

// ── Notion seed trades (GYM Journal – last 5) ──────────────────────────────
const NOTION_SEED_KEY = "ej_notion_seed_v1";
const NOTION_TRADES = [
  {
    id: 1748390400001,
    datetime: "2026-05-20T10:00",
    instrument: "NQ",
    direction: "Short",
    entry: "", sl: "", tp: "", exit: "",
    outcome: "BE",
    rr_realized: "0",
    pnl_dollars: "",
    notes: "Trade molto piacevole: ottima reazione dopo che il prezzo è entrato nell'M30 FVG. Avrei voluto shortare dall'RB, ma shortare vicino a HTH non è mai una buona idea. Trade molto buono, ottima LR. Unico problema: ES aveva già preso HTH. Vedendo mercato lento ho preferito andare BE — è andata bene.",
    review: "",
    session: "NY Open",
    setupGrade: "A",
    mmxm: "MMSM (Sell Side Curve)",
    htfBias: "Bearish",
    irlErl: "IRL > ERL",
    manipulation: ["HTF Key Level"],
    stophunt: [],
    closeQuality: "Body-dominant",
    candlesForIFVG: "",
    targetType: ["LR (Low Resistance)"],
    po3: true,
    smtPresent: true,
    trueManipulation: false,
    displacingClose: false,
    openLiquidity: false,
    htfDol: "",
    images: { HTF: [], MTF: [], LTF: [] },
  },
  {
    id: 1748390400002,
    datetime: "2026-05-20T10:30",
    instrument: "NQ",
    direction: "Long",
    entry: "", sl: "", tp: "", exit: "",
    outcome: "Loss",
    rr_realized: "-1",
    pnl_dollars: "",
    notes: "Loss davvero sfortunata. Stop loss posto vicino a una wick lunghissima M1 che ne ha toccato il 50%, appena sopra lo swing. Long entrato vicino ad ATH con ottima reazione da H4 RB — AMD bellissimo, trade A+. ES aveva già preso gli highs target, ma i DOL su ES erano più in alto quindi ho lasciato andare. Stoppato per soli 5 tick.",
    review: "",
    session: "NY Open",
    setupGrade: "A+",
    mmxm: "MMBM (Buy Side Curve)",
    htfBias: "Bullish",
    irlErl: "IRL > ERL",
    manipulation: ["HTF Key Level", "PO3 (after HTF open)"],
    stophunt: ["Turtle Soup (wick only)"],
    closeQuality: "Body-dominant",
    candlesForIFVG: "2",
    targetType: ["PDH/PDL", "Session Highs/Lows"],
    po3: true,
    smtPresent: false,
    trueManipulation: true,
    displacingClose: true,
    openLiquidity: false,
    htfDol: "ATH / Session Highs",
    images: { HTF: [], MTF: [], LTF: [] },
  },
  {
    id: 1748390400003,
    datetime: "2026-05-20T09:30",
    instrument: "NQ",
    direction: "Long",
    entry: "", sl: "", tp: "", exit: "",
    outcome: "Win",
    rr_realized: "3.3",
    pnl_dollars: "",
    notes: "Forse uno dei migliori trade mai eseguiti — sia per esecuzione che per gestione. Tantissima LR sopra, M30 FVG poco sotto. Mercato apre, entra nell'M30 FVG, fa un'ulteriore manipolazione, reazione istantanea con entry. Non imposto subito BE: aspetto che il prezzo ritorni e crei un M5 FVG per conferma. Chiusura corpo sopra l'HIGH → BE. Ottima gestione. Tornati ad ATH.",
    review: "Da studiare come gestione ideale del BE discrezionale.",
    session: "NY Open",
    setupGrade: "A+",
    mmxm: "MMBM (Buy Side Curve)",
    htfBias: "Bullish",
    irlErl: "IRL > ERL",
    manipulation: ["True Manipulation", "PO3 (after HTF open)", "HTF Key Level"],
    stophunt: ["Accumulation swept", "Turtle Soup (wick only)"],
    closeQuality: "Body-dominant",
    candlesForIFVG: "2",
    targetType: ["Session Highs/Lows", "LR (Low Resistance)"],
    po3: true,
    smtPresent: false,
    trueManipulation: true,
    displacingClose: true,
    openLiquidity: false,
    htfDol: "ATH",
    images: { HTF: [], MTF: [], LTF: [] },
  },
  {
    id: 1748390400004,
    datetime: "2026-05-17T10:00",
    instrument: "NQ",
    direction: "Short",
    entry: "", sl: "", tp: "", exit: "",
    outcome: "Loss",
    rr_realized: "-1",
    pnl_dollars: "",
    notes: "Trade da prendere 10/10 volte. Non mi piaceva la situazione su ES e siamo in downtrend. Setup confermato alle 10:00 — se manipola potrei anche pensare a una re-entry. Buon A+ anche se loss.",
    review: "",
    session: "NY Open",
    setupGrade: "A+",
    mmxm: "MMSM (Sell Side Curve)",
    htfBias: "Bearish",
    irlErl: "IRL > ERL",
    manipulation: ["PO3 (after HTF open)", "HTF Key Level"],
    stophunt: [],
    closeQuality: "Body-dominant",
    candlesForIFVG: "",
    targetType: ["LR (Low Resistance)"],
    po3: true,
    smtPresent: false,
    trueManipulation: false,
    displacingClose: false,
    openLiquidity: false,
    htfDol: "Sell Side Liquidity",
    images: { HTF: [], MTF: [], LTF: [] },
  },
  {
    id: 1748390400005,
    datetime: "2026-05-01T10:30",
    instrument: "NQ",
    direction: "Long",
    entry: "", sl: "", tp: "", exit: "",
    outcome: "Win",
    rr_realized: "1.2",
    pnl_dollars: "",
    notes: "Settimana con PA veramente pessima, nessuna entry per l'intera settimana, ma venerdì il riscatto. Entry bellissima a tarda mattinata: tap al 50%, discount. Su ES stessa cosa ma superando ATH, NQ vicinissima a ATH. Entry molto bella dopo una struttura super bullish. Bel setup complessivo.",
    review: "",
    session: "NY AM",
    setupGrade: "A",
    mmxm: "MMBM (Buy Side Curve)",
    htfBias: "Bullish",
    irlErl: "IRL > ERL",
    manipulation: ["HTF Key Level"],
    stophunt: ["Accumulation swept"],
    closeQuality: "Body-dominant",
    candlesForIFVG: "3",
    targetType: ["PDH/PDL", "Session Highs/Lows"],
    po3: false,
    smtPresent: false,
    trueManipulation: false,
    displacingClose: true,
    openLiquidity: false,
    htfDol: "ATH / Buy Side Liquidity",
    images: { HTF: [], MTF: [], LTF: [] },
  },
];

export default function TradingJournal() {
  const [tab, setTab] = useState("dashboard");
  const [trades, setTrades] = useState([]);
  const [journal, setJournal] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState("synced");
  const saveTimer = useRef({});

  // ── Load from Supabase on mount ──────────────────────────────────────────
  const loadedRef = useRef(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // Load trades from Supabase
        let loadedTrades = await dbLoad("trades", null);
        if (loadedTrades === null) {
          // First time ever: check localStorage migration
          loadedTrades = lsLoad("ej_trades_v4", []);
        }
        // Inject seed trades only once (tracked in localStorage)
        if (!localStorage.getItem("ej_seed_done")) {
          const ids = new Set(loadedTrades.map(t => t.id));
          const seeds = NOTION_TRADES.filter(t => !ids.has(t.id));
          if (seeds.length) loadedTrades = [...seeds, ...loadedTrades];
          localStorage.setItem("ej_seed_done", "1");
          // Save seeds to Supabase immediately
          if (loadedTrades.length) await dbSave("trades", loadedTrades);
        }
        setTrades(loadedTrades);

        let loadedJournal = await dbLoad("journal", null);
        if (loadedJournal === null) loadedJournal = lsLoad("ej_journal_v4", []);
        setJournal(loadedJournal);
      } catch(e) {
        console.error(e);
        setSyncStatus("error");
      }
      // Mark load as complete — saves will now be enabled
      loadedRef.current = true;
      setLoading(false);
    })();
  }, []);

  // ── Debounced save to Supabase (only after initial load) ─────────────────
  const debouncedSave = useCallback((table, items) => {
    if (!loadedRef.current) return; // never save during load
    if (saveTimer.current[table]) clearTimeout(saveTimer.current[table]);
    setSyncStatus("saving");
    saveTimer.current[table] = setTimeout(async () => {
      try { await dbSave(table, items); setSyncStatus("synced"); }
      catch (e) { console.error(e); setSyncStatus("error"); }
    }, 1200);
  }, []);

  useEffect(() => { debouncedSave("trades", trades); }, [trades]);
  useEffect(() => { debouncedSave("journal", journal); }, [journal]);

  const [tradeForm, setTradeForm] = useState(null);
  const [journalForm, setJournalForm] = useState(null);
  const [detailTrade, setDetailTrade] = useState(null);
  const [imgPreview, setImgPreview] = useState(null);
  const [filter, setFilter] = useState({ outcome: "", direction: "", grade: "", search: "" });

  const openNewTrade = useCallback(() => setTradeForm({ ...EMPTY_TRADE, id: Date.now() }), []);
  const openEditTrade = useCallback(t => setTradeForm({ ...EMPTY_TRADE, ...t }), []);
  const deleteTrade = useCallback(id => { setTrades(p => p.filter(t => t.id !== id)); setDetailTrade(null); }, []);
  const saveTrade = useCallback(f => {
    setTrades(prev => prev.find(t => t.id === f.id) ? prev.map(t => t.id === f.id ? f : t) : [f, ...prev]);
    setTradeForm(null);
  }, []);
  const openJournal = useCallback(entry => setJournalForm(entry ? { ...entry } : { ...EMPTY_JOURNAL, id: Date.now() }), []);
  const saveJournal = useCallback(f => {
    setJournal(prev => prev.find(j => j.id === f.id) ? prev.map(j => j.id === f.id ? f : j) : [f, ...prev]);
    setJournalForm(null);
  }, []);

  // ── Stats: computed once per trades change ──────────────────────────────
  const stats = useMemo(() => {
    if (!trades.length) return null;
    const wins = trades.filter(t => t.outcome === "Win").length;
    const losses = trades.filter(t => t.outcome === "Loss").length;
    const bes = trades.filter(t => t.outcome === "BE").length;
    const rrList = trades.map(t => getTradeRR(t)).filter(r => r !== null && !isNaN(r));
    const avgRR = rrList.length ? (rrList.reduce((a, b) => a + b, 0) / rrList.length).toFixed(2) : 0;
    const winRRs = rrList.filter((_, i) => trades[i]?.outcome === "Win");
    const lossRRs = rrList.filter((_, i) => trades[i]?.outcome === "Loss").map(Math.abs);
    const grossW = winRRs.reduce((a, b) => a + b, 0), grossL = lossRRs.reduce((a, b) => a + b, 0);
    const pf = grossL > 0 ? (grossW / grossL).toFixed(2) : grossW > 0 ? "inf" : "0";
    const bestRR = rrList.length ? Math.max(...rrList) : null;
    const worstRR = rrList.length ? Math.min(...rrList) : null;
    let streak = 0, streakType = "";
    for (const t of trades) {
      if (t.outcome === "BE") continue;
      if (!streakType) { streakType = t.outcome; streak = 1; }
      else if (t.outcome === streakType) streak++;
      else break;
    }
    let cum = 0;
    const equity = [...trades].reverse().map((t, i) => {
      cum += getTradeRR(t) || 0;
      return { n: i + 1, v: parseFloat(cum.toFixed(2)) };
    });
    const byInst = {};
    trades.forEach(t => {
      if (!t.instrument) return;
      if (!byInst[t.instrument]) byInst[t.instrument] = { win: 0, loss: 0, be: 0 };
      byInst[t.instrument][t.outcome.toLowerCase()]++;
    });
    const byGrade = {};
    trades.forEach(t => {
      if (!t.setupGrade) return;
      if (!byGrade[t.setupGrade]) byGrade[t.setupGrade] = { win: 0, loss: 0, total: 0 };
      byGrade[t.setupGrade].total++;
      if (t.outcome === "Win") byGrade[t.setupGrade].win++;
      else if (t.outcome === "Loss") byGrade[t.setupGrade].loss++;
    });
    const longT = trades.filter(t => t.direction === "Long");
    const shortT = trades.filter(t => t.direction === "Short");
    const longWR = longT.length ? ((longT.filter(t => t.outcome === "Win").length / longT.length) * 100).toFixed(0) : 0;
    const shortWR = shortT.length ? ((shortT.filter(t => t.outcome === "Win").length / shortT.length) * 100).toFixed(0) : 0;
    const aplusTrades = trades.filter(t => t.setupGrade === "A+");
    const aplusWR = aplusTrades.length ? ((aplusTrades.filter(t => t.outcome === "Win").length / aplusTrades.length) * 100).toFixed(0) : 0;
    const tmTrades = trades.filter(t => t.trueManipulation);
    const tmWR = tmTrades.length ? ((tmTrades.filter(t => t.outcome === "Win").length / tmTrades.length) * 100).toFixed(0) : 0;
    const pnlList = trades.map(t => parseFloat(t.pnl_dollars)).filter(v => !isNaN(v));
    const totalPnl = pnlList.length ? pnlList.reduce((a, b) => a + b, 0) : null;
    return { wins, losses, bes, winRate: trades.length ? ((wins / trades.length) * 100).toFixed(1) : 0, avgRR, pf, bestRR, worstRR, streak, streakType, equity, byInst, byGrade, longT, shortT, longWR, shortWR, aplusTrades, aplusWR, tmTrades, tmWR, totalPnl };
  }, [trades]);

  // ── Filtered list: recomputed only when trades or filter changes ─────────
  const filtered = useMemo(() => trades.filter(t => {
    if (filter.outcome && t.outcome !== filter.outcome) return false;
    if (filter.direction && t.direction !== filter.direction) return false;
    if (filter.grade && t.setupGrade !== filter.grade) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      if (!t.instrument?.toLowerCase().includes(q) && !t.notes?.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [trades, filter]);

  const todayJ = useMemo(() => journal.find(j => j.date === todayStr()), [journal]);

  // ── Loading screen ──────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: C.bg, minHeight: "100vh", color: C.text, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <style>{CSS}</style>
      <div style={{ width: 44, height: 44, background: `linear-gradient(135deg, ${C.accent}, #6366F1)`, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 24px rgba(59,130,246,.4)`, animation: "pulseGlow 1.8s ease-in-out infinite" }}>
        <Activity size={20} color="white" strokeWidth={2.5} />
      </div>
      <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 13, color: C.textMid }}>Caricamento journal...</div>
      <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.textLow }}>Sincronizzazione dal cloud ☁</div>
    </div>
  );

  // ── Sync badge ─────────────────────────────────────────────────────────
  const syncCfg = { synced: { color: C.win, label: "Synced ☁" }, saving: { color: C.be, label: "Salvataggio..." }, error: { color: C.loss, label: "Errore sync" } }[syncStatus];

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: C.bg, minHeight: "100vh", color: C.text }}>
      <style>{CSS}</style>
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "0 24px", display: "flex", alignItems: "center", position: "sticky", top: 0, background: "rgba(5,5,7,.94)", zIndex: 100, backdropFilter: "blur(20px) saturate(160%)", WebkitBackdropFilter: "blur(20px) saturate(160%)", boxShadow: "0 1px 0 rgba(255,255,255,.03)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingRight: 24, marginRight: 8, borderRight: `1px solid ${C.border}`, height: 52 }}>
          <div style={{ width: 28, height: 28, background: `linear-gradient(135deg, ${C.accent}, #6366F1)`, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 12px rgba(59,130,246,.35)`, transition: "box-shadow .3s, transform .2s cubic-bezier(.34,1.56,.64,1)" }}
            onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.1) rotate(-3deg)"; e.currentTarget.style.boxShadow = `0 0 20px rgba(59,130,246,.5)`; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "scale(1) rotate(0deg)"; e.currentTarget.style.boxShadow = `0 0 12px rgba(59,130,246,.35)`; }}>
            <Activity size={14} color="white" strokeWidth={2.5} />
          </div>
          <div>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 500, fontSize: 13, color: C.text, lineHeight: 1.1 }}>EDGE</div>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, letterSpacing: ".08em" }}>JOURNAL</div>
          </div>
        </div>
        {[{ id: "dashboard", icon: <BarChart2 size={13} />, label: "Overview" }, { id: "history", icon: <Clock size={13} />, label: "Trade Log" }, { id: "daily", icon: <BookOpen size={13} />, label: "Daily Notes" }, { id: "replay", icon: <TrendingUp size={13} />, label: "Replay" }, { id: "analytics", icon: <BarChart3 size={13} />, label: "Analytics" }].map(t => (
          <button key={t.id} className={`nav-btn ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>{t.icon}{t.label}</button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: syncCfg.color, background: `${syncCfg.color}15`, border: `1px solid ${syncCfg.color}30`, padding: "3px 8px", borderRadius: 20 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: syncCfg.color, animation: syncStatus === "saving" ? "pulseGlow 1s ease infinite" : "none" }} />
            {syncCfg.label}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: C.textLow }}>
            <div className="live-dot" />
            {trades.length} trades
          </div>
          {/* Export backup */}
          <button className="btn-ghost" title="Esporta backup JSON" onClick={() => {
            const data = JSON.stringify({ trades, journal, exported: new Date().toISOString() }, null, 2);
            const blob = new Blob([data], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url;
            a.download = `edge-journal-backup-${new Date().toISOString().slice(0,10)}.json`;
            a.click(); URL.revokeObjectURL(url);
          }} style={{ padding: "7px 10px" }}>
            <Upload size={13} />
          </button>
          {/* Import backup */}
          <button className="btn-ghost" title="Importa backup JSON" onClick={() => {
            const input = document.createElement("input"); input.type = "file"; input.accept = ".json";
            input.onchange = e => {
              const file = e.target.files[0]; if (!file) return;
              const reader = new FileReader();
              reader.onload = ev => {
                try {
                  const parsed = JSON.parse(ev.target.result);
                  if (parsed.trades) setTrades(parsed.trades);
                  if (parsed.journal) setJournal(parsed.journal);
                  alert("✅ Backup importato con successo!");
                } catch { alert("❌ File non valido."); }
              };
              reader.readAsText(file);
            };
            input.click();
          }} style={{ padding: "7px 10px" }}>
            <Save size={13} />
          </button>
          <button className="btn-primary" onClick={openNewTrade}><Plus size={13} />New Trade</button>
        </div>
      </div>

      <div style={{ padding: "24px", maxWidth: 1360, margin: "0 auto" }}>
        {tab === "dashboard" && <div key="dashboard" className="fade-in"><DashboardTab stats={stats} trades={trades} todayJ={todayJ} openJournal={openJournal} setDetailTrade={setDetailTrade} /></div>}
        {tab === "history" && <div key="history" className="fade-in"><HistoryTab trades={filtered} filter={filter} setFilter={setFilter} onView={setDetailTrade} onEdit={openEditTrade} onDelete={deleteTrade} /></div>}
        {tab === "daily" && <div key="daily" className="fade-in"><DailyTab journal={journal} onOpen={openJournal} onDelete={id => setJournal(p => p.filter(j => j.id !== id))} /></div>}
        {tab === "replay" && <div key="replay" className="fade-in"><TimelineReplayTab trades={trades} journal={journal} onViewTrade={setDetailTrade} /></div>}
        {tab === "analytics" && <div key="analytics" className="fade-in"><AnalyticsTab trades={trades} /></div>}
      </div>

      {tradeForm && <TradeFormModal form={tradeForm} setForm={setTradeForm} onSave={saveTrade} />}
      {journalForm && <JournalFormModal form={journalForm} setForm={setJournalForm} onSave={saveJournal} />}
      {detailTrade && <TradeDetailModal trade={detailTrade} onClose={() => setDetailTrade(null)} onEdit={() => { openEditTrade(detailTrade); setDetailTrade(null); }} onDelete={() => deleteTrade(detailTrade.id)} onImgClick={(src, lbl) => setImgPreview({ src, lbl })} />}
      {imgPreview && (
        <div className="overlay" onClick={() => setImgPreview(null)}>
          <div style={{ position: "relative", maxWidth: "88vw", animation: "modalIn .25s cubic-bezier(.34,1.2,.64,1) forwards" }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setImgPreview(null)} style={{ position: "absolute", top: -14, right: -14, background: "rgba(11,11,17,.9)", border: `1px solid ${C.borderMid}`, color: C.textMid, borderRadius: "50%", width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)", transition: "color .15s, background .15s, transform .18s cubic-bezier(.34,1.56,.64,1)" }}
              onMouseEnter={e => { e.currentTarget.style.color = C.text; e.currentTarget.style.background = C.borderMid; e.currentTarget.style.transform = "scale(1.12) rotate(90deg)"; }}
              onMouseLeave={e => { e.currentTarget.style.color = C.textMid; e.currentTarget.style.background = "rgba(11,11,17,.9)"; e.currentTarget.style.transform = "scale(1) rotate(0deg)"; }}>
              <X size={12} />
            </button>
            <div className="lbl" style={{ marginBottom: 8 }}>{imgPreview.lbl}</div>
            <img src={imgPreview.src} style={{ maxWidth: "85vw", maxHeight: "85vh", borderRadius: 10, border: `1px solid ${C.borderMid}`, display: "block", boxShadow: "0 32px 80px rgba(0,0,0,.7)" }} alt="chart" />
          </div>
        </div>
      )}
    </div>
  );
}

function DrawdownOverlay({ equity }) {
  if (!equity.length) return null;
  let peak = equity[0].v;
  const dd = equity.map(p => {
    if (p.v > peak) peak = p.v;
    const drawdown = peak > 0 ? parseFloat(((p.v - peak) / Math.abs(peak) * 100).toFixed(1)) : 0;
    return { n: p.n, dd: Math.min(drawdown, 0) };
  });
  const maxDD = Math.min(...dd.map(d => d.dd));
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".1em" }}>Drawdown</div>
        <div className="stat-num" style={{ fontSize: 11, color: C.loss }}>{maxDD.toFixed(1)}% max</div>
      </div>
      <ResponsiveContainer width="100%" height={52}>
        <AreaChart data={dd} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="ddg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.loss} stopOpacity={0.25} />
              <stop offset="100%" stopColor={C.loss} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <ReferenceLine y={0} stroke={C.borderMid} strokeDasharray="3 3" />
          <Area type="monotone" dataKey="dd" stroke={C.loss} strokeWidth={1} fill="url(#ddg)" dot={false} />
          <Tooltip contentStyle={{ background: "#0F0F17", border: `1px solid ${C.borderMid}`, borderRadius: 6, color: C.text, fontSize: 10, fontFamily: "Inter Tight" }} formatter={v => [`${v}%`, "DD"]} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const SessionHeatmap = memo(function SessionHeatmap({ trades }) {
  const sessions = ["London Open", "NY Open", "NY AM", "NY PM", "Asian", "Other"];
  const data = sessions.map(sess => {
    const sessTrades = trades.filter(t => t.session === sess);
    const wins = sessTrades.filter(t => t.outcome === "Win").length;
    const losses = sessTrades.filter(t => t.outcome === "Loss").length;
    const wr = sessTrades.length ? Math.round(wins / sessTrades.length * 100) : null;
    const rrList = sessTrades.map(t => getTradeRR(t)).filter(r => r !== null && !isNaN(r));
    const avgRR = rrList.length ? (rrList.reduce((a, b) => a + b, 0) / rrList.length).toFixed(1) : null;
    return { sess, total: sessTrades.length, wins, losses, wr, avgRR };
  }).filter(d => d.total > 0);

  if (!data.length) return (
    <div style={{ color: C.textLow, fontSize: 11, fontFamily: "'Inter Tight',sans-serif", textAlign: "center", padding: "24px 0" }}>No session data</div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {data.map(d => {
        const intensity = d.wr !== null ? d.wr / 100 : 0;
        const col = d.wr >= 60 ? C.win : d.wr >= 45 ? C.be : C.loss;
        return (
          <div key={d.sess} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.textMid, width: 88, flexShrink: 0 }}>{d.sess}</div>
            <div style={{ flex: 1, height: 20, background: C.bg, borderRadius: 4, overflow: "hidden", position: "relative", border: `1px solid ${C.border}` }}>
              <div style={{ position: "absolute", inset: 0, width: `${d.wr ?? 0}%`, background: `${col}22`, borderRadius: 3, transition: "width .6s ease" }} />
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", paddingLeft: 8 }}>
                <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: col }}>{d.wr !== null ? `${d.wr}% WR` : "—"}</span>
              </div>
            </div>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: d.avgRR >= 0 ? C.win : C.loss, width: 36, textAlign: "right", flexShrink: 0 }}>
              {d.avgRR !== null ? `${d.avgRR > 0 ? "+" : ""}${d.avgRR}R` : "—"}
            </div>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, width: 24, textAlign: "right", flexShrink: 0 }}>{d.total}</div>
          </div>
        );
      })}
    </div>
  );
});

const AplusTracker = memo(function AplusTracker({ trades }) {
  const grades = ["A+", "A", "B", "C (BM)"];
  const rows = grades.map(g => {
    const gt = trades.filter(t => t.setupGrade === g);
    if (!gt.length) return null;
    const wins = gt.filter(t => t.outcome === "Win").length;
    const losses = gt.filter(t => t.outcome === "Loss").length;
    const bes = gt.filter(t => t.outcome === "BE").length;
    const wr = Math.round(wins / gt.length * 100);
    const rrList = gt.map(t => getTradeRR(t)).filter(r => r !== null && !isNaN(r));
    const avgRR = rrList.length ? (rrList.reduce((a, b) => a + b, 0) / rrList.length).toFixed(1) : "—";
    return { g, total: gt.length, wins, losses, bes, wr, avgRR };
  }).filter(Boolean);

  if (!rows.length) return <div style={{ color: C.textLow, fontSize: 11, fontFamily: "'Inter Tight',sans-serif", textAlign: "center", padding: "24px 0" }}>No graded setups</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map(r => {
        const col = gradeColor(r.g);
        return (
          <div key={r.g} style={{ background: C.bg, borderRadius: 8, padding: "10px 12px", border: `1px solid ${C.border}`, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: col, borderRadius: "3px 0 0 3px" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 8 }}>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 700, fontSize: 13, color: col, width: 42, flexShrink: 0 }}>{r.g}</div>
              <div style={{ flex: 1 }}>
                <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${r.wr}%`, background: col, borderRadius: 2, transition: "width .5s" }} />
                </div>
              </div>
              <div className="stat-num" style={{ fontSize: 15, color: col, width: 40, textAlign: "right", flexShrink: 0 }}>{r.wr}%</div>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.textMid, width: 32, textAlign: "right", flexShrink: 0 }}>{r.avgRR !== "—" ? `${r.avgRR}R` : "—"}</div>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, width: 28, textAlign: "right", flexShrink: 0 }}>{r.total}T</div>
            </div>
          </div>
        );
      })}
    </div>
  );
});

const LongShortBias = memo(function LongShortBias({ s }) {
  const total = s.longT.length + s.shortT.length;
  const longPct = total ? Math.round(s.longT.length / total * 100) : 50;
  const shortPct = 100 - longPct;
  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, background: "rgba(56,189,248,.06)", border: "1px solid rgba(56,189,248,.15)", borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.long, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>Long</div>
          <div className="stat-num" style={{ fontSize: 26, color: C.long, lineHeight: 1 }}>{s.longWR}%</div>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.textLow, marginTop: 5 }}>{s.longT.length} trades · WR</div>
        </div>
        <div style={{ flex: 1, background: "rgba(244,63,94,.06)", border: "1px solid rgba(244,63,94,.15)", borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.short, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>Short</div>
          <div className="stat-num" style={{ fontSize: 26, color: C.short, lineHeight: 1 }}>{s.shortWR}%</div>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.textLow, marginTop: 5 }}>{s.shortT.length} trades · WR</div>
        </div>
      </div>
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, marginBottom: 5, display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: C.long }}>LONG {longPct}%</span>
          <span style={{ color: C.short }}>SHORT {shortPct}%</span>
        </div>
        <div style={{ height: 8, background: C.border, borderRadius: 4, overflow: "hidden", display: "flex" }}>
          <div style={{ width: `${longPct}%`, background: `linear-gradient(90deg, ${C.long}, ${C.long}99)`, borderRadius: "4px 0 0 4px", transition: "width .6s" }} />
          <div style={{ flex: 1, background: `linear-gradient(90deg, ${C.short}99, ${C.short})`, borderRadius: "0 4px 4px 0" }} />
        </div>
      </div>
    </div>
  );
});

const DashboardTab = memo(function DashboardTab({ stats: s, trades, todayJ, openJournal, setDetailTrade }) {
  if (!trades.length) return (
    <div style={{ textAlign: "center", padding: "120px 0" }}>
      <div style={{ width: 52, height: 52, background: "#0F0F17", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}>
        <Activity size={22} color={C.textMid} />
      </div>
      <div style={{ fontWeight: 600, fontSize: 18, color: C.textMid }}>No trades recorded</div>
      <div style={{ color: C.textLow, marginTop: 8, fontSize: 13, fontFamily: "'Inter Tight',sans-serif" }}>Log your first trade to begin tracking performance</div>
    </div>
  );

  const finalEquity = s.equity[s.equity.length - 1]?.v || 0;
  const eqPos = finalEquity >= 0;

  /* ── ROW 1: KPI Cards ── */
  const row1Kpis = [
    { label: "Win Rate", value: `${s.winRate}%`, ka: s.winRate >= 50 ? C.win : C.loss, sub: `${s.wins}W · ${s.losses}L · ${s.bes}BE`, icon: "◎" },
    { label: "Avg RR", value: `${s.avgRR}R`, ka: C.accent, sub: "realized r:r", icon: "⇥" },
    { label: "Profit Factor", value: s.pf, ka: C.be, sub: "gross W ÷ gross L", icon: "∑" },
    { label: "Current Streak", value: `${s.streak}`, ka: s.streakType === "Win" ? C.win : C.loss, sub: s.streakType || "—", icon: s.streakType === "Win" ? "▲" : "▼" },
    ...(s.totalPnl !== null ? [{ label: "Total P&L", value: `${s.totalPnl >= 0 ? "+" : ""}$${Math.abs(s.totalPnl).toLocaleString()}`, ka: s.totalPnl >= 0 ? C.win : C.loss, sub: `${trades.filter(t => t.pnl_dollars !== "" && t.pnl_dollars != null).length} trades tracked`, icon: "$" }] : []),
  ];

  return (
    <div className="fade-in">

      {/* ── ROW 1: KPI floating cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${row1Kpis.length},1fr)`, gap: 10, marginBottom: 14 }}>
        {row1Kpis.map((k, i) => (
          <div key={k.label} className="glass-panel" style={{
            padding: "16px 18px",
            position: "relative",
            overflow: "hidden",
            animation: `fadeUp .32s cubic-bezier(.4,0,.2,1) ${i * 0.06}s both`,
          }}>
            {/* top accent line */}
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, ${k.ka}66, transparent 70%)` }} />
            {/* bg glow */}
            <div style={{ position: "absolute", top: -24, right: -12, width: 90, height: 90, background: `radial-gradient(circle, ${k.ka}0E 0%, transparent 70%)`, pointerEvents: "none", transition: "opacity .3s" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em" }}>{k.label}</div>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 14, color: `${k.ka}66`, transition: "color .2s" }}>{k.icon}</div>
            </div>
            <div className="stat-num" style={{ fontSize: 28, color: k.ka, lineHeight: 1, marginBottom: 6 }}>{k.value}</div>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.textLow }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── ROW 2: Equity HERO + Drawdown ── */}
      <div className="glass-panel" style={{ padding: "22px 24px", marginBottom: 14, position: "relative", overflow: "hidden", animation: "fadeUp .35s cubic-bezier(.4,0,.2,1) .18s both" }}>
        {/* bg mesh */}
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 20% 50%, ${eqPos ? C.win : C.loss}07 0%, transparent 60%)`, pointerEvents: "none" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, position: "relative" }}>
          <div>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 6 }}>Equity Curve</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <div className="stat-num" style={{ fontSize: 36, color: eqPos ? C.win : C.loss, lineHeight: 1 }}>{eqPos ? "+" : ""}{finalEquity}R</div>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: C.textLow }}>cumulative</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, marginBottom: 3 }}>BEST</div>
              <div className="stat-num" style={{ fontSize: 14, color: C.win }}>{s.bestRR != null ? `+${s.bestRR}R` : "—"}</div>
            </div>
            <div style={{ width: 1, height: 30, background: C.border }} />
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, marginBottom: 3 }}>WORST</div>
              <div className="stat-num" style={{ fontSize: 14, color: C.loss }}>{s.worstRR != null ? `${s.worstRR}R` : "—"}</div>
            </div>
            <div style={{ width: 1, height: 30, background: C.border }} />
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, marginBottom: 3 }}>TRADES</div>
              <div className="stat-num" style={{ fontSize: 14, color: C.textMid }}>{trades.length}</div>
            </div>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={s.equity} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="eqg2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={eqPos ? C.win : C.loss} stopOpacity={0.18} />
                <stop offset="85%" stopColor={eqPos ? C.win : C.loss} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 8" stroke={C.border} vertical={false} />
            <XAxis dataKey="n" tick={{ fill: C.textLow, fontSize: 9, fontFamily: "Inter Tight" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: C.textLow, fontSize: 9, fontFamily: "Inter Tight" }} axisLine={false} tickLine={false} width={36} />
            <ReferenceLine y={0} stroke={C.borderMid} strokeDasharray="4 4" strokeWidth={1} />
            <Tooltip contentStyle={{ background: "#0F0F17", border: `1px solid ${C.borderMid}`, borderRadius: 8, color: C.text, fontSize: 11, fontFamily: "Inter Tight" }} formatter={v => [`${v}R`, "Equity"]} />
            <Area type="monotone" dataKey="v" stroke={eqPos ? C.win : C.loss} strokeWidth={2} fill="url(#eqg2)" dot={false} activeDot={{ r: 4, fill: eqPos ? C.win : C.loss, strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>

        <DrawdownOverlay equity={s.equity} />
      </div>

      {/* ── ROW 3: Session · A+ Setup · Long vs Short ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>

        {/* Session Performance */}
        <div className="glass-panel" style={{ padding: "18px 20px", animation: "fadeUp .35s cubic-bezier(.4,0,.2,1) .24s both" }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 2 }}>Session Performance</div>
            <div style={{ fontSize: 11, color: C.textMid }}>Win rate &amp; avg RR by session</div>
          </div>
          <SessionHeatmap trades={trades} />
        </div>

        {/* A+ Setup Performance */}
        <div className="glass-panel" style={{ padding: "18px 20px", animation: "fadeUp .35s cubic-bezier(.4,0,.2,1) .3s both" }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 2 }}>Setup Grade Tracker</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div>
                <div className="stat-num" style={{ fontSize: 22, color: C.cyan }}>{s.aplusWR}%</div>
                <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow }}>A+ win rate · {s.aplusTrades.length} setups</div>
              </div>
              <div style={{ width: 1, height: 28, background: C.border }} />
              <div>
                <div className="stat-num" style={{ fontSize: 22, color: C.win }}>{s.tmWR}%</div>
                <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow }}>True Manip · {s.tmTrades.length}</div>
              </div>
            </div>
          </div>
          <AplusTracker trades={trades} />
        </div>

        {/* Long vs Short Bias */}
        <div className="glass-panel" style={{ padding: "18px 20px", animation: "fadeUp .35s cubic-bezier(.4,0,.2,1) .36s both" }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 2 }}>Directional Bias</div>
            <div style={{ fontSize: 11, color: C.textMid }}>Long vs Short edge</div>
          </div>
          <LongShortBias s={s} />
          <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 8 }}>Recent Trades</div>
            {trades.slice(0, 4).map(t => <MiniTradeRow key={t.id} trade={t} onClick={() => setDetailTrade(t)} />)}
          </div>
        </div>
      </div>
    </div>
  );
});

const MiniTradeRow = memo(function MiniTradeRow({ trade, onClick }) {
  const rr = getTradeRR(trade);
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderBottom: `1px solid ${C.border}`, cursor: "pointer", transition: "opacity .18s, transform .18s cubic-bezier(.4,0,.2,1), padding-left .18s", willChange: "transform" }}
      onMouseEnter={e => { e.currentTarget.style.opacity = ".8"; e.currentTarget.style.paddingLeft = "6px"; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.paddingLeft = "0px"; }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: OC[trade.outcome] || C.textMid, flexShrink: 0, boxShadow: `0 0 6px ${OC[trade.outcome] || C.textMid}66`, transition: "transform .2s" }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{trade.instrument || "—"}</div>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.textLow }}>{fmtDate(trade.datetime)}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div className="stat-num" style={{ fontSize: 14, color: rr != null ? (rr >= 0 ? C.win : C.loss) : C.textLow, transition: "color .2s" }}>{rr != null ? `${rr >= 0 ? "+" : ""}${rr}R` : "—"}</div>
        {trade.setupGrade && <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: gradeColor(trade.setupGrade) }}>{trade.setupGrade}</div>}
      </div>
    </div>
  );
});

// ── Virtualized list row ─────────────────────────────────────────────────
const VIRT_ROW_H = 54; // px — must match the rendered row height

const VirtualTradeListRow = memo(function VirtualTradeListRow({ t, onView, onEdit, onDelete }) {
  const r = getTradeRR(t);
  return (
    <div className="row-tr" onClick={() => onView(t)} style={{ height: VIRT_ROW_H - 5, marginBottom: 5 }}>
      <div style={{ width: 3, height: 34, borderRadius: 2, background: OC[t.outcome] || C.textLow, flexShrink: 0 }} />
      <div style={{ minWidth: 78 }}>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.textMid }}>{fmtDate(t.datetime)}</div>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow }}>{fmtTime(t.datetime)}</div>
      </div>
      <div style={{ minWidth: 96 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{t.instrument || "—"}</div>
        <span className={`badge ${t.direction === "Long" ? "blong" : "bshort"}`}>{t.direction}</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
        {t.setupGrade && <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: gradeColor(t.setupGrade), background: `${gradeColor(t.setupGrade)}12`, padding: "2px 7px", borderRadius: 4, border: `1px solid ${gradeColor(t.setupGrade)}25` }}>{t.setupGrade}</span>}
        {t.session && <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.textLow }}>{SESSION_ICONS[t.session]} {t.session}</span>}
        {t.trueManipulation && <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.accent, background: "rgba(59,130,246,.1)", padding: "2px 7px", borderRadius: 4, border: "1px solid rgba(59,130,246,.2)" }}>TM</span>}
      </div>
      <div style={{ textAlign: "right", minWidth: 76 }}>
        <div className="stat-num" style={{ fontSize: 15, color: r != null ? (r >= 0 ? C.win : C.loss) : C.textLow }}>{r != null ? `${r >= 0 ? "+" : ""}${r}R` : "—"}</div>
        <span className={`badge ${t.outcome === "Win" ? "bw" : t.outcome === "Loss" ? "bl" : "bb"}`}>{t.outcome}</span>
      </div>
      <div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}>
        <button className="btn-ghost" style={{ padding: "5px 8px" }} onClick={() => onEdit(t)}><Edit3 size={11} /></button>
        <button onClick={() => onDelete(t.id)} style={{ background: "none", border: "1px solid transparent", color: `${C.loss}44`, borderRadius: 7, padding: "5px 8px", cursor: "pointer", transition: "all .15s", display: "flex" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = `${C.loss}44`; e.currentTarget.style.color = C.loss; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.color = `${C.loss}44`; }}>
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
});

function VirtualTradeList({ trades, onView, onEdit, onDelete }) {
  const containerRef = useRef(null);
  const { totalHeight, visibleItems } = useVirtualList(trades, {
    itemHeight: VIRT_ROW_H,
    overscan: 8,
    containerRef,
  });

  return (
    <div
      ref={containerRef}
      style={{ height: Math.min(totalHeight, 640), overflowY: "auto", position: "relative" }}
    >
      {/* spacer — creates native scrollbar for full list height */}
      <div style={{ height: totalHeight, position: "relative" }}>
        {visibleItems.map(({ item: t, index, offsetTop }) => (
          <div key={t.id} style={{ position: "absolute", top: offsetTop, left: 0, right: 0 }}>
            <VirtualTradeListRow t={t} onView={onView} onEdit={onEdit} onDelete={onDelete} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Lightweight virtualizer — renders only visible rows ─────────────────
function useVirtualList(items, { itemHeight, overscan = 5, containerRef }) {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setContainerHeight(entries[0].contentRect.height);
    });
    ro.observe(el);
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener("scroll", onScroll); };
  }, [containerRef]);

  const totalHeight = items.length * itemHeight;
  const startIdx = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(containerHeight / itemHeight) + overscan * 2;
  const endIdx = Math.min(items.length, startIdx + visibleCount);
  const visibleItems = items.slice(startIdx, endIdx).map((item, i) => ({
    item,
    index: startIdx + i,
    offsetTop: (startIdx + i) * itemHeight,
  }));

  return { totalHeight, visibleItems, startIdx, endIdx };
}

function HistoryTab({ trades, filter, setFilter, onView, onEdit, onDelete }) {
  const [viewMode, setViewMode] = useState("cards");
  const listRef = useRef(null);
  return (
    <div className="fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 20, color: C.text }}>Trade Log</div>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: C.textLow, marginTop: 2 }}>{trades.length} records</div>
        </div>
        <div style={{ display: "flex", gap: 4, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 3 }}>
          {[["cards", "⊞"], ["list", "☰"]].map(([mode, icon]) => (
            <button key={mode} onClick={() => setViewMode(mode)} style={{
              background: viewMode === mode ? C.surface : "none",
              border: `1px solid ${viewMode === mode ? C.borderMid : "transparent"}`,
              color: viewMode === mode ? C.text : C.textLow,
              borderRadius: 6, padding: "5px 10px", fontSize: 14, cursor: "pointer",
              transition: "all .15s", fontFamily: "'Inter Tight',sans-serif",
            }}>{icon}</button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 200px" }}>
          <Search size={12} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: C.textLow }} />
          <input placeholder="Search…" style={{ paddingLeft: 30 }} value={filter.search} onChange={e => setFilter(p => ({ ...p, search: e.target.value }))} />
        </div>
        {[["outcome", OUTCOMES], ["direction", DIRECTIONS], ["grade", SETUP_GRADE]].map(([key, opts]) => (
          <select key={key} value={filter[key]} onChange={e => setFilter(p => ({ ...p, [key]: e.target.value }))} style={{ flex: "0 0 120px", width: "auto" }}>
            <option value="">{key.charAt(0).toUpperCase() + key.slice(1)}</option>
            {opts.map(o => <option key={o}>{o}</option>)}
          </select>
        ))}
        {Object.values(filter).some(Boolean) && (
          <button className="btn-ghost" onClick={() => setFilter({ outcome: "", direction: "", grade: "", search: "" })}><X size={12} />Clear</button>
        )}
      </div>
      {!trades.length ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: C.textLow, fontFamily: "'Inter Tight',sans-serif", fontSize: 12 }}>No trades match filters</div>
      ) : viewMode === "cards" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {trades.map((t, i) => (
            <div key={t.id} style={{ animationDelay: `${i * 0.04}s` }}>
              <TradeCard trade={t} onClick={() => onView(t)} onEdit={() => onEdit(t)} onDelete={() => onDelete(t.id)} />
            </div>
          ))}
        </div>
      ) : (
        <VirtualTradeList trades={trades} onView={onView} onEdit={onEdit} onDelete={onDelete} />
      )}
    </div>
  );
}

/* ── Session icon map ── */
const SESSION_ICONS = {
  "London Open": "🇬🇧",
  "NY Open": "🗽",
  "NY AM": "🌅",
  "NY PM": "🌆",
  "Asian": "🏯",
  "Other": "🌐",
};

/* ── Mini sparkline for price path simulation ── */
function MiniSparkline({ outcome, rr }) {
  const col = OC[outcome] || C.textMid;
  const w = 88, h = 36;
  // generate a simple path based on outcome
  const pts = (() => {
    if (outcome === "Win") {
      return [[0,28],[16,24],[28,22],[40,18],[52,12],[64,8],[76,4],[88,2]];
    } else if (outcome === "Loss") {
      return [[0,8],[16,10],[28,14],[40,20],[52,26],[64,30],[76,32],[88,34]];
    } else {
      return [[0,18],[16,16],[28,22],[40,14],[52,20],[64,16],[76,18],[88,18]];
    }
  })();
  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
  const fillD = pathD + ` L${w},${h} L0,${h} Z`;
  return (
    <svg width={w} height={h} style={{ overflow: "visible", opacity: 0.85 }}>
      <defs>
        <linearGradient id={`sg_${outcome}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity={0.3} />
          <stop offset="100%" stopColor={col} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={fillD} fill={`url(#sg_${outcome})`} />
      <path d={pathD} stroke={col} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* entry dot */}
      <circle cx={pts[0][0]} cy={pts[0][1]} r={2.5} fill={col} opacity={0.6} />
      {/* exit dot */}
      <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r={3} fill={col} />
    </svg>
  );
}

const TradeCard = memo(function TradeCard({ trade, onClick, onEdit, onDelete }) {
  const rr = getTradeRR(trade);
  const outcomeColor = OC[trade.outcome] || C.textMid;
  const isWin = trade.outcome === "Win";
  const isLoss = trade.outcome === "Loss";
  const isBE = trade.outcome === "BE";

  // ICT tags to show
  const ictTags = [
    trade.trueManipulation && { label: "TRUE M", color: C.accent },
    trade.smtPresent && { label: "SMT", color: C.long },
    trade.po3 && { label: "PO3", color: C.be },
    trade.displacingClose && { label: "DISP", color: C.win },
    trade.openLiquidity && { label: "OPEN LIQ", color: C.loss },
  ].filter(Boolean);

  const sessionIcon = SESSION_ICONS[trade.session] || "";

  // Confidence score: count positive signals
  const signals = [
    trade.trueManipulation,
    trade.smtPresent,
    trade.po3,
    trade.displacingClose,
    trade.setupGrade === "A+" || trade.setupGrade === "A",
    trade.stophunt?.some(s => s.includes("Turtle")),
    !trade.openLiquidity,
    trade.candlesForIFVG && parseInt(trade.candlesForIFVG) <= 3,
  ].filter(Boolean).length;
  const confidence = Math.min(100, Math.round((signals / 8) * 100));
  const confColor = confidence >= 75 ? C.win : confidence >= 50 ? C.be : C.loss;

  const previewImg = trade.images?.LTF?.[0] || trade.images?.MTF?.[0] || trade.images?.HTF?.[0];

  return (
    <div
      onClick={onClick}
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        overflow: "hidden",
        cursor: "pointer",
        position: "relative",
        transition: "border-color .22s, box-shadow .22s, transform .22s cubic-bezier(.34,1.2,.64,1)",
        animation: "fadeUp .28s cubic-bezier(.4,0,.2,1) both",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = `${outcomeColor}44`;
        e.currentTarget.style.transform = "translateY(-3px)";
        e.currentTarget.style.boxShadow = `0 12px 40px rgba(0,0,0,.4), 0 0 0 1px ${outcomeColor}22`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = C.border;
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* Outcome color sidebar */}
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
        background: `linear-gradient(180deg, ${outcomeColor}, ${outcomeColor}66)`,
        borderRadius: "14px 0 0 14px",
      }} />

      {/* Top ambient glow */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 80,
        background: `radial-gradient(ellipse at 20% 0%, ${outcomeColor}0A 0%, transparent 70%)`,
        pointerEvents: "none",
      }} />

      <div style={{ paddingLeft: 16, paddingRight: 14, paddingTop: 14, paddingBottom: 14 }}>

        {/* ── Row 1: Header ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            {/* Direction pill */}
            <span style={{
              fontFamily: "'Inter Tight',sans-serif", fontSize: 10, fontWeight: 700,
              color: trade.direction === "Long" ? C.long : C.short,
              background: trade.direction === "Long" ? "rgba(56,189,248,.1)" : "rgba(244,63,94,.1)",
              border: `1px solid ${trade.direction === "Long" ? "rgba(56,189,248,.25)" : "rgba(244,63,94,.25)"}`,
              padding: "3px 8px", borderRadius: 5, textTransform: "uppercase", letterSpacing: ".06em",
            }}>
              {trade.direction === "Long" ? "▲" : "▼"} {trade.direction}
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: C.text, lineHeight: 1 }}>{trade.instrument || "—"}</div>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, marginTop: 3 }}>
                {fmtDate(trade.datetime)} {fmtTime(trade.datetime) && `· ${fmtTime(trade.datetime)}`}
              </div>
            </div>
          </div>

          {/* Session icon + actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={e => e.stopPropagation()}>
            {trade.session && (
              <div title={trade.session} style={{
                fontSize: 18, lineHeight: 1, background: C.bg, border: `1px solid ${C.border}`,
                borderRadius: 7, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {sessionIcon}
              </div>
            )}
            <button className="btn-ghost" style={{ padding: "5px 7px" }} onClick={onEdit}><Edit3 size={10} /></button>
            <button onClick={onDelete} style={{
              background: "none", border: "1px solid transparent", color: `${C.loss}44`,
              borderRadius: 7, padding: "5px 7px", cursor: "pointer", transition: "all .15s", display: "flex"
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = `${C.loss}44`; e.currentTarget.style.color = C.loss; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.color = `${C.loss}44`; }}>
              <Trash2 size={10} />
            </button>
          </div>
        </div>

        {/* ── Row 2: Chart snapshot + RR badge ── */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 12 }}>
          {/* Mini chart or placeholder */}
          <div style={{ position: "relative" }}>
            {previewImg ? (
              <img src={previewImg.src} alt="chart" style={{
                width: 88, height: 52, objectFit: "cover", borderRadius: 7,
                border: `1px solid ${C.border}`, display: "block",
              }} />
            ) : (
              <div style={{
                width: 88, height: 52, borderRadius: 7, border: `1px solid ${C.border}`,
                background: C.bg, display: "flex", alignItems: "flex-end", padding: "8px 0 4px 0",
                overflow: "hidden",
              }}>
                <MiniSparkline outcome={trade.outcome} rr={rr} />
              </div>
            )}
          </div>

          {/* RR Badge — huge */}
          <div style={{
            textAlign: "center",
            background: rr != null ? `${rr >= 0 ? C.win : C.loss}0D` : C.bg,
            border: `1px solid ${rr != null ? (rr >= 0 ? C.win : C.loss) : C.border}22`,
            borderRadius: 10, padding: "8px 14px", minWidth: 72,
          }}>
            <div className="stat-num" style={{
              fontSize: 26, fontWeight: 700, lineHeight: 1,
              color: rr != null ? (rr >= 0 ? C.win : C.loss) : C.textLow,
            }}>
              {rr != null ? `${rr >= 0 ? "+" : ""}${rr}` : "—"}
            </div>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, marginTop: 2 }}>R · REALIZED</div>
            {trade.pnl_dollars !== "" && trade.pnl_dollars != null && !isNaN(parseFloat(trade.pnl_dollars)) && (
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, fontWeight: 600, color: parseFloat(trade.pnl_dollars) >= 0 ? C.win : C.loss, marginTop: 4, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>
                {parseFloat(trade.pnl_dollars) >= 0 ? "+" : ""}${Math.abs(parseFloat(trade.pnl_dollars)).toLocaleString()}
              </div>
            )}
          </div>

          {/* Outcome badge */}
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4
          }}>
            <div style={{
              fontFamily: "'Inter Tight',sans-serif", fontSize: 11, fontWeight: 700,
              color: outcomeColor,
              background: `${outcomeColor}15`,
              border: `1px solid ${outcomeColor}33`,
              padding: "5px 12px", borderRadius: 7, textTransform: "uppercase", letterSpacing: ".07em",
            }}>
              {trade.outcome}
            </div>
            {trade.setupGrade && (
              <div style={{
                fontFamily: "'Inter Tight',sans-serif", fontSize: 10, fontWeight: 700,
                color: gradeColor(trade.setupGrade),
                background: `${gradeColor(trade.setupGrade)}12`,
                border: `1px solid ${gradeColor(trade.setupGrade)}25`,
                padding: "3px 10px", borderRadius: 5, letterSpacing: ".05em",
              }}>
                {trade.setupGrade}
              </div>
            )}
          </div>
        </div>

        {/* ── Row 3: Confidence bar ── */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 8, color: C.textLow, textTransform: "uppercase", letterSpacing: ".1em" }}>Setup Confidence</div>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: confColor, fontWeight: 600 }}>{confidence}%</div>
          </div>
          <div style={{ height: 3, background: C.border, borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${confidence}%`,
              background: `linear-gradient(90deg, ${confColor}99, ${confColor})`,
              borderRadius: 4, transition: "width .6s cubic-bezier(.4,0,.2,1)",
            }} />
          </div>
        </div>

        {/* ── Row 4: ICT Tags ── */}
        {(ictTags.length > 0 || trade.session) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {ictTags.map(tag => (
              <span key={tag.label} style={{
                fontFamily: "'Inter Tight',sans-serif", fontSize: 9, fontWeight: 700,
                color: tag.color, background: `${tag.color}10`,
                border: `1px solid ${tag.color}25`,
                padding: "2px 6px", borderRadius: 4, letterSpacing: ".06em",
              }}>{tag.label}</span>
            ))}
            {trade.session && (
              <span style={{
                fontFamily: "'Inter Tight',sans-serif", fontSize: 9,
                color: C.textLow, background: C.bg,
                border: `1px solid ${C.border}`,
                padding: "2px 7px", borderRadius: 4,
              }}>{sessionIcon} {trade.session}</span>
            )}
            {trade.mmxm && (
              <span style={{
                fontFamily: "'Inter Tight',sans-serif", fontSize: 9,
                color: C.cyan, background: `${C.cyan}0C`,
                border: `1px solid ${C.cyan}20`,
                padding: "2px 7px", borderRadius: 4,
              }}>{trade.mmxm.split(" ")[0]}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

const DailyTab = memo(function DailyTab({ journal, onOpen, onDelete }) {
  const ratingColor = { 5: C.win, 4: C.accent, 3: C.be, 2: "#F97316", 1: C.loss };
  return (
    <div className="fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 20, color: C.text }}>Daily Notes</div>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: C.textLow, marginTop: 2 }}>mindset · execution · observations</div>
        </div>
        <button className="btn-primary" onClick={() => onOpen()}><Plus size={13} />New Entry</button>
      </div>
      {!journal.length && <div style={{ textAlign: "center", padding: "80px 0", color: C.textLow, fontFamily: "'Inter Tight',sans-serif", fontSize: 12 }}>No entries yet</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[...journal].sort((a, b) => b.date.localeCompare(a.date)).map((j, idx) => (
          <div key={j.id} className="card" style={{ borderLeft: `2px solid ${ratingColor[j.rating] || C.border}`, transition: "border-color .2s,box-shadow .2s,transform .2s cubic-bezier(.4,0,.2,1)", animation: `fadeUp .28s cubic-bezier(.4,0,.2,1) ${idx * 0.04}s both` }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 24px rgba(0,0,0,.25)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15, color: C.text }}>{fmtDate(j.date)}</div>
                <div style={{ display: "flex", gap: 2, marginTop: 5 }}>
                  {[1,2,3,4,5].map(s => <span key={s} style={{ fontSize: 14, color: s <= j.rating ? C.be : C.border }}>&#9733;</span>)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                <button className="btn-ghost" style={{ padding: "4px 8px" }} onClick={() => onOpen(j)}><Edit3 size={11} /></button>
                <button onClick={() => onDelete(j.id)} style={{ background: "none", border: "none", color: `${C.loss}44`, padding: "4px 8px", borderRadius: 7 }}
                  onMouseEnter={e => e.currentTarget.style.color = C.loss}
                  onMouseLeave={e => e.currentTarget.style.color = `${C.loss}44`}><Trash2 size={11} /></button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
              {[["Mindset", j.mindset, C.long], ["Did Well", j.good, C.win], ["Improve", j.improve, C.be]].map(([l, v, c]) => (
                <div key={l} style={{ background: C.bg, borderRadius: 7, padding: "9px 11px" }}>
                  <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: c, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 4 }}>{l}</div>
                  <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.6 }}>{v || "—"}</div>
                </div>
              ))}
            </div>
            {j.notes && <div style={{ marginTop: 10, fontSize: 12, color: C.textLow, lineHeight: 1.7, fontFamily: "'Inter Tight',sans-serif", borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>{j.notes}</div>}
          </div>
        ))}
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// TIMELINE REPLAY TAB
// ═══════════════════════════════════════════════════════════════════════════

function TimelineReplayTab({ trades, journal, onViewTrade }) {
  // Sort trades oldest→newest for replay
  const sorted = useMemo(() =>
    [...trades].sort((a, b) => new Date(a.datetime) - new Date(b.datetime)),
  [trades]);

  const [cursor, setCursor] = useState(sorted.length > 0 ? sorted.length - 1 : 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1200); // ms per step
  const intervalRef = useRef(null);
  const chartRef = useRef(null);

  // Stop autoplay when reaching end
  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setCursor(prev => {
          if (prev >= sorted.length - 1) { setPlaying(false); return prev; }
          return prev + 1;
        });
      }, speed);
    }
    return () => clearInterval(intervalRef.current);
  }, [playing, speed, sorted.length]);

  // ── Derived data at cursor position ─────────────────────────────────────
  const visibleTrades = useMemo(() => sorted.slice(0, cursor + 1), [sorted, cursor]);
  const currentTrade  = sorted[cursor];

  // Equity series up to cursor
  const equitySeries = useMemo(() => {
    let cum = 0;
    return visibleTrades.map((t, i) => {
      const rr = getTradeRR(t) || 0;
      cum += rr;
      return { n: i + 1, v: parseFloat(cum.toFixed(2)), rr, outcome: t.outcome, date: t.datetime, instrument: t.instrument };
    });
  }, [visibleTrades]);

  const currentEquity = equitySeries[equitySeries.length - 1]?.v ?? 0;
  const equityPos = currentEquity >= 0;

  // Running stats at cursor
  const stats = useMemo(() => {
    if (!visibleTrades.length) return null;
    const wins = visibleTrades.filter(t => t.outcome === "Win").length;
    const losses = visibleTrades.filter(t => t.outcome === "Loss").length;
    const bes = visibleTrades.filter(t => t.outcome === "BE").length;
    const rrList = visibleTrades.map(t => getTradeRR(t)).filter(r => r !== null && !isNaN(r));
    const avgRR = rrList.length ? (rrList.reduce((a, b) => a + b, 0) / rrList.length) : 0;
    const winRate = visibleTrades.length ? (wins / visibleTrades.length * 100) : 0;

    // Drawdown
    let peak = 0, maxDD = 0, curDD = 0;
    equitySeries.forEach(p => {
      if (p.v > peak) peak = p.v;
      curDD = peak > 0 ? ((p.v - peak) / peak * 100) : 0;
      if (curDD < maxDD) maxDD = curDD;
    });

    // Current streak
    let streak = 0, streakType = "";
    for (let i = visibleTrades.length - 1; i >= 0; i--) {
      const t = visibleTrades[i];
      if (t.outcome === "BE") continue;
      if (!streakType) { streakType = t.outcome; streak = 1; }
      else if (t.outcome === streakType) streak++;
      else break;
    }

    return { wins, losses, bes, winRate, avgRR: avgRR.toFixed(2), maxDD: maxDD.toFixed(1), streak, streakType };
  }, [visibleTrades, equitySeries]);

  // Find journal entry for current trade's date
  const tradeDate = currentTrade?.datetime?.slice(0, 10);
  const journalEntry = useMemo(() =>
    journal.find(j => j.date === tradeDate),
  [journal, tradeDate]);

  const pct = sorted.length > 1 ? (cursor / (sorted.length - 1)) * 100 : 100;

  if (!sorted.length) return (
    <div style={{ textAlign: "center", padding: "120px 0" }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>⏱</div>
      <div style={{ fontWeight: 600, fontSize: 18, color: C.textMid }}>No trades to replay</div>
      <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 12, color: C.textLow, marginTop: 8 }}>Log some trades first to use Timeline Replay</div>
    </div>
  );

  const ratingColor = { 5: C.win, 4: C.accent, 3: C.be, 2: "#F97316", 1: C.loss };

  return (
    <div className="fade-in" style={{ maxWidth: 1200, margin: "0 auto" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 20, color: C.text, display: "flex", alignItems: "center", gap: 10 }}>
            Timeline Replay
            <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: C.textLow, fontWeight: 400, background: C.surface, border: `1px solid ${C.border}`, padding: "2px 9px", borderRadius: 5 }}>
              {cursor + 1} / {sorted.length}
            </span>
          </div>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: C.textLow, marginTop: 4 }}>
            {currentTrade ? `${fmtDate(currentTrade.datetime)} · ${currentTrade.instrument || "—"} · ${currentTrade.session || "—"}` : "—"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.textLow }}>Speed</div>
          {[[2000,"0.5×"],[1200,"1×"],[600,"2×"],[300,"4×"]].map(([ms, lbl]) => (
            <button key={ms} onClick={() => setSpeed(ms)} style={{
              background: speed === ms ? "rgba(59,130,246,.14)" : "none",
              border: `1px solid ${speed === ms ? C.accent : C.border}`,
              color: speed === ms ? C.accent : C.textLow,
              borderRadius: 6, padding: "4px 10px",
              fontFamily: "'Inter Tight',sans-serif", fontSize: 11, cursor: "pointer",
              transition: "all .15s",
            }}>{lbl}</button>
          ))}
        </div>
      </div>

      {/* ── Main grid: chart left, details right ───────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 14, marginBottom: 14 }}>

        {/* LEFT: Equity chart */}
        <div className="glass-panel" style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <div>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 4 }}>Equity Curve</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <div key={currentEquity} className="stat-num" style={{ fontSize: 32, color: equityPos ? C.win : C.loss, lineHeight: 1, animation: "numberCount .25s ease forwards" }}>
                  {equityPos ? "+" : ""}{currentEquity}R
                </div>
                <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.textLow }}>cumulative</div>
              </div>
            </div>
            {stats && (
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ textAlign: "center" }}>
                  <div key={stats.winRate} className="stat-num" style={{ fontSize: 18, color: stats.winRate >= 50 ? C.win : C.loss, animation: "numberCount .2s ease forwards" }}>{stats.winRate.toFixed(0)}%</div>
                  <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow }}>WR</div>
                </div>
                <div style={{ width: 1, height: 28, background: C.border }} />
                <div style={{ textAlign: "center" }}>
                  <div key={stats.avgRR} className="stat-num" style={{ fontSize: 18, color: C.accent, animation: "numberCount .2s ease forwards" }}>{stats.avgRR}R</div>
                  <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow }}>Avg RR</div>
                </div>
                <div style={{ width: 1, height: 28, background: C.border }} />
                <div style={{ textAlign: "center" }}>
                  <div key={stats.maxDD} className="stat-num" style={{ fontSize: 18, color: C.loss, animation: "numberCount .2s ease forwards" }}>{stats.maxDD}%</div>
                  <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow }}>Max DD</div>
                </div>
              </div>
            )}
          </div>

          {/* Equity Line Chart */}
          <div style={{ height: 220 }} ref={chartRef}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equitySeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="replayEqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={equityPos ? C.win : C.loss} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={equityPos ? C.win : C.loss} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                <XAxis dataKey="n" tick={{ fontFamily: "Inter Tight", fontSize: 9, fill: C.textLow }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontFamily: "Inter Tight", fontSize: 9, fill: C.textLow }} axisLine={false} tickLine={false} width={36} />
                <Tooltip
                  contentStyle={{ background: "#0F0F17", border: `1px solid ${C.borderMid}`, borderRadius: 8, color: C.text, fontSize: 11, fontFamily: "Inter Tight", boxShadow: "0 8px 32px rgba(0,0,0,.5)" }}
                  formatter={(v, name) => [`${v >= 0 ? "+" : ""}${v}R`, "Equity"]}
                  labelFormatter={n => {
                    const t = equitySeries[n - 1];
                    return t ? `${fmtDate(t.date)} · ${t.instrument || ""}` : `Trade ${n}`;
                  }}
                />
                <ReferenceLine y={0} stroke={C.borderMid} strokeDasharray="4 4" />
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={equityPos ? C.win : C.loss}
                  strokeWidth={2}
                  fill="url(#replayEqGrad)"
                  dot={(props) => {
                    const { cx, cy, payload, index } = props;
                    const isCurrent = index === equitySeries.length - 1;
                    const col = OC[payload.outcome] || C.textMid;
                    return (
                      <circle
                        key={index}
                        cx={cx} cy={cy}
                        r={isCurrent ? 6 : 3}
                        fill={col}
                        stroke={C.bg}
                        strokeWidth={isCurrent ? 2 : 1}
                        opacity={isCurrent ? 1 : 0.7}
                        style={{ filter: isCurrent ? `drop-shadow(0 0 6px ${col})` : "none" }}
                      />
                    );
                  }}
                  activeDot={{ r: 6, fill: equityPos ? C.win : C.loss, stroke: C.bg, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Trade dots timeline strip */}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 8 }}>Trade History</div>
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              {sorted.map((t, i) => {
                const col = OC[t.outcome] || C.textMid;
                const isActive = i === cursor;
                const isPast = i < cursor;
                return (
                  <button
                    key={t.id}
                    onClick={() => { setCursor(i); setPlaying(false); }}
                    className="replay-trade-node"
                    title={`${fmtDate(t.datetime)} · ${t.instrument || ""} · ${t.outcome}`}
                    style={{
                      width: isActive ? 20 : 10,
                      height: 10,
                      borderRadius: isActive ? 5 : "50%",
                      background: isActive ? col : isPast ? `${col}88` : C.border,
                      border: isActive ? `2px solid ${col}` : "none",
                      boxShadow: isActive ? `0 0 8px ${col}` : "none",
                      cursor: "pointer",
                      padding: 0,
                      flexShrink: 0,
                      transition: "all .25s cubic-bezier(.34,1.2,.64,1)",
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT: Current trade details */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Stats snapshot */}
          {stats && (
            <div className="glass-panel" style={{ padding: "16px 18px" }}>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 12 }}>At This Point</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                {[
                  { label: "Trades", value: cursor + 1, color: C.text },
                  { label: "Win Rate", value: `${stats.winRate.toFixed(0)}%`, color: stats.winRate >= 50 ? C.win : C.loss },
                  { label: "Equity", value: `${currentEquity >= 0 ? "+" : ""}${currentEquity}R`, color: equityPos ? C.win : C.loss },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: C.bg, borderRadius: 8, padding: "10px 12px", textAlign: "center", border: `1px solid ${C.border}` }}>
                    <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, marginBottom: 4 }}>{label}</div>
                    <div key={value} className="stat-num" style={{ fontSize: 16, color, animation: "numberCount .2s ease forwards" }}>{value}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div style={{ background: C.bg, borderRadius: 7, padding: "8px 10px", textAlign: "center", border: `1px solid ${C.border}` }}>
                  <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 8, color: C.win, marginBottom: 3 }}>WINS</div>
                  <div className="stat-num" style={{ fontSize: 18, color: C.win }}>{stats.wins}</div>
                </div>
                <div style={{ background: C.bg, borderRadius: 7, padding: "8px 10px", textAlign: "center", border: `1px solid ${C.border}` }}>
                  <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 8, color: C.loss, marginBottom: 3 }}>LOSSES</div>
                  <div className="stat-num" style={{ fontSize: 18, color: C.loss }}>{stats.losses}</div>
                </div>
                <div style={{ background: C.bg, borderRadius: 7, padding: "8px 10px", textAlign: "center", border: `1px solid ${C.border}` }}>
                  <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 8, color: stats.streakType === "Win" ? C.win : C.loss, marginBottom: 3 }}>STREAK</div>
                  <div className="stat-num" style={{ fontSize: 18, color: stats.streakType === "Win" ? C.win : C.loss }}>{stats.streak}{stats.streakType ? (stats.streakType === "Win" ? "W" : "L") : ""}</div>
                </div>
              </div>
            </div>
          )}

          {/* Current trade card */}
          {currentTrade && (
            <div
              key={currentTrade.id}
              className="glass-panel"
              style={{
                padding: "16px 18px",
                borderColor: `${OC[currentTrade.outcome] || C.border}44`,
                boxShadow: `0 0 20px ${OC[currentTrade.outcome] || C.border}18`,
                animation: "tradeReveal .3s cubic-bezier(.34,1.2,.64,1) forwards",
                cursor: "pointer",
              }}
              onClick={() => onViewTrade(currentTrade)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: OC[currentTrade.outcome], boxShadow: `0 0 8px ${OC[currentTrade.outcome]}` }} />
                    <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>{currentTrade.instrument || "—"}</div>
                    <span className={`badge ${currentTrade.direction === "Long" ? "blong" : "bshort"}`}>{currentTrade.direction}</span>
                  </div>
                  <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.textLow }}>
                    {fmtDate(currentTrade.datetime)} {fmtTime(currentTrade.datetime) && `· ${fmtTime(currentTrade.datetime)}`}
                    {currentTrade.session && ` · ${SESSION_ICONS[currentTrade.session] || ""} ${currentTrade.session}`}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="stat-num" style={{ fontSize: 22, color: OC[currentTrade.outcome] }}>
                    {(() => { const rr = getTradeRR(currentTrade); return rr != null ? `${rr >= 0 ? "+" : ""}${rr}R` : "—"; })()}
                  </div>
                  {currentTrade.setupGrade && (
                    <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: gradeColor(currentTrade.setupGrade) }}>{currentTrade.setupGrade}</div>
                  )}
                </div>
              </div>

              {/* ICT flags */}
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: currentTrade.notes ? 10 : 0 }}>
                {currentTrade.trueManipulation && <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.accent, background: "rgba(59,130,246,.1)", padding: "2px 7px", borderRadius: 4, border: "1px solid rgba(59,130,246,.2)" }}>TRUE M</span>}
                {currentTrade.smtPresent && <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.long, background: "rgba(56,189,248,.1)", padding: "2px 7px", borderRadius: 4, border: "1px solid rgba(56,189,248,.2)" }}>SMT</span>}
                {currentTrade.po3 && <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.be, background: "rgba(234,179,8,.1)", padding: "2px 7px", borderRadius: 4, border: "1px solid rgba(234,179,8,.2)" }}>PO3</span>}
                {currentTrade.displacingClose && <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.win, background: "rgba(34,197,94,.1)", padding: "2px 7px", borderRadius: 4, border: "1px solid rgba(34,197,94,.2)" }}>DISP</span>}
                {currentTrade.mmxm && <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.cyan, background: `${C.cyan}0E`, padding: "2px 7px", borderRadius: 4, border: `1px solid ${C.cyan}22` }}>{currentTrade.mmxm.split(" ")[0]}</span>}
              </div>

              {currentTrade.notes && (
                <div style={{ marginTop: 10, background: C.bg, borderRadius: 7, padding: "8px 10px", fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.textMid, lineHeight: 1.7, borderLeft: `2px solid ${C.accent}44` }}>
                  {currentTrade.notes.slice(0, 160)}{currentTrade.notes.length > 160 ? "…" : ""}
                </div>
              )}

              {/* Preview image */}
              {(() => {
                const img = currentTrade.images?.LTF?.[0] || currentTrade.images?.MTF?.[0] || currentTrade.images?.HTF?.[0];
                return img ? (
                  <div style={{ marginTop: 10 }}>
                    <img src={img.src} alt="chart" style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.border}` }} />
                  </div>
                ) : null;
              })()}

              <div style={{ marginTop: 10, fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textAlign: "center" }}>Click to view full details</div>
            </div>
          )}

          {/* Journal entry for this day */}
          {journalEntry && (
            <div key={journalEntry.id} className="glass-panel" style={{ padding: "14px 16px", borderColor: `${ratingColor[journalEntry.rating] || C.border}33`, animation: "tradeReveal .4s cubic-bezier(.34,1.2,.64,1) .1s forwards", opacity: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".1em" }}>📔 Journal · {fmtDate(journalEntry.date)}</div>
                <div style={{ display: "flex", gap: 2 }}>
                  {[1,2,3,4,5].map(s => <span key={s} style={{ fontSize: 10, color: s <= journalEntry.rating ? C.be : C.border }}>★</span>)}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[["Mindset", journalEntry.mindset, C.long], ["Did Well", journalEntry.good, C.win], ["Improve", journalEntry.improve, C.be]].map(([l, v, c]) => v ? (
                  <div key={l}>
                    <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 8, color: c, textTransform: "uppercase", letterSpacing: ".1em", marginRight: 6 }}>{l}</span>
                    <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.textMid }}>{v}</span>
                  </div>
                ) : null)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Scrubber / Playback Controls ────────────────────────────────────── */}
      <div className="glass-panel" style={{ padding: "16px 20px" }}>
        {/* Scrubber */}
        <div style={{ marginBottom: 14, position: "relative" }}>
          <input
            type="range"
            min={0}
            max={sorted.length - 1}
            value={cursor}
            onChange={e => { setCursor(parseInt(e.target.value)); setPlaying(false); }}
            className="replay-scrubber"
            style={{ "--pct": `${pct}%` }}
          />
          {/* Date labels */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow }}>{fmtDate(sorted[0]?.datetime)}</div>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow }}>{fmtDate(sorted[sorted.length - 1]?.datetime)}</div>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10 }}>
          {/* To start */}
          <button
            onClick={() => { setCursor(0); setPlaying(false); }}
            style={{ background: "none", border: `1px solid ${C.border}`, color: C.textLow, borderRadius: 8, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, transition: "all .15s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.borderMid; e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textLow; }}
            title="Go to start"
          >⏮</button>

          {/* Step back */}
          <button
            onClick={() => { setCursor(p => Math.max(0, p - 1)); setPlaying(false); }}
            style={{ background: "none", border: `1px solid ${C.border}`, color: C.textLow, borderRadius: 8, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 16, transition: "all .15s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.borderMid; e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textLow; }}
            title="Previous trade"
          >◀</button>

          {/* Play / Pause */}
          <button
            onClick={() => setPlaying(p => !p)}
            style={{
              background: playing ? "rgba(59,130,246,.15)" : C.accent,
              border: `1px solid ${playing ? C.accent : "transparent"}`,
              color: playing ? C.accent : "white",
              borderRadius: 10, width: 52, height: 52,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", fontSize: 20,
              boxShadow: playing ? "none" : "0 0 20px rgba(59,130,246,.4)",
              transition: "all .2s cubic-bezier(.34,1.56,.64,1)",
              transform: "scale(1)",
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.08)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
            title={playing ? "Pause" : "Play"}
          >
            {playing ? "⏸" : "▶"}
          </button>

          {/* Step forward */}
          <button
            onClick={() => { setCursor(p => Math.min(sorted.length - 1, p + 1)); setPlaying(false); }}
            style={{ background: "none", border: `1px solid ${C.border}`, color: C.textLow, borderRadius: 8, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 16, transition: "all .15s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.borderMid; e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textLow; }}
            title="Next trade"
          >▶</button>

          {/* To end */}
          <button
            onClick={() => { setCursor(sorted.length - 1); setPlaying(false); }}
            style={{ background: "none", border: `1px solid ${C.border}`, color: C.textLow, borderRadius: 8, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, transition: "all .15s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.borderMid; e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textLow; }}
            title="Go to end"
          >⏭</button>
        </div>

        {/* Progress bar below controls */}
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, flexShrink: 0 }}>
            Trade {cursor + 1} of {sorted.length}
          </div>
          <div style={{ flex: 1, height: 3, background: C.border, borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${C.accent}, #6366F1)`, borderRadius: 2, transition: "width .25s ease" }} />
          </div>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, flexShrink: 0 }}>
            {pct.toFixed(0)}%
          </div>
        </div>
      </div>
    </div>
  );
}

function AutoTag({ label }) {
  return (
    <span style={{
      fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: "#06B6D4",
      background: "rgba(6,182,212,.1)", border: "1px solid rgba(6,182,212,.25)",
      padding: "1px 6px", borderRadius: 4, marginLeft: 6, letterSpacing: ".05em",
      verticalAlign: "middle",
    }}>⚡ auto</span>
  );
}

function TradeFormModal({ form, setForm, onSave }) {
  const [f, setF] = useState({ ...EMPTY_TRADE, ...form });
  const [step, setStep] = useState(0);
  const [autoFilled, setAutoFilled] = useState({});
  const u = (k, v) => {
    // Clear auto-fill badge if user manually changes the field
    setAutoFilled(p => { const n = { ...p }; delete n[k]; return n; });
    setF(p => ({ ...p, [k]: v }));
  };
  const toggleArr = (k, v) => setF(p => ({ ...p, [k]: p[k].includes(v) ? p[k].filter(x => x !== v) : [...p[k], v] }));
  const toggleBool = k => setF(p => ({ ...p, [k]: !p[k] }));
  const projRR = calcRR(f.direction, f.entry, f.sl, f.tp);
  const realRR = calcRealRR(f.direction, f.entry, f.sl, f.exit);

  // ── Auto-detect session when datetime changes ────────────────────────────
  useEffect(() => {
    if (!f.session || autoFilled.session) {
      const detected = autoDetectSession(f.datetime);
      if (detected && detected !== f.session) {
        setF(p => ({ ...p, session: detected }));
        setAutoFilled(p => ({ ...p, session: true }));
      }
    }
  }, [f.datetime]); // eslint-disable-line

  // ── Auto-detect HTF bias when MMXM changes ───────────────────────────────
  useEffect(() => {
    if (!f.htfBias || autoFilled.htfBias) {
      const detected = autoDetectHTFBias(f.mmxm);
      if (detected && detected !== f.htfBias) {
        setF(p => ({ ...p, htfBias: detected }));
        setAutoFilled(p => ({ ...p, htfBias: true }));
      }
    }
  }, [f.mmxm]); // eslint-disable-line

  // ── Auto-suggest setup grade when quality fields change ──────────────────
  useEffect(() => {
    if (!f.setupGrade || autoFilled.setupGrade) {
      const suggested = autoSuggestSetupGrade(f);
      if (suggested && suggested !== f.setupGrade) {
        setF(p => ({ ...p, setupGrade: suggested }));
        setAutoFilled(p => ({ ...p, setupGrade: true }));
      }
    }
  }, [f.trueManipulation, f.stophunt, f.smtPresent, f.po3, f.displacingClose, f.manipulation, f.candlesForIFVG, f.closeQuality, f.openLiquidity, f.irlErl]); // eslint-disable-line

  const addImage = (tf, files) => {
    const imgs = f.images[tf] || [];
    if (imgs.length >= 3) return;
    Array.from(files).slice(0, 3 - imgs.length).forEach(file => {
      const reader = new FileReader();
      reader.onload = e => setF(p => ({ ...p, images: { ...p.images, [tf]: [...(p.images[tf] || []), { src: e.target.result, name: file.name }] } }));
      reader.readAsDataURL(file);
    });
  };
  const removeImage = (tf, idx) => setF(p => ({ ...p, images: { ...p.images, [tf]: p.images[tf].filter((_, i) => i !== idx) } }));
  const STEPS = ["Execution", "Setup", "Manipulation", "Targets", "Charts & Notes"];

  return (
    <div className="overlay">
      <div className="modal">
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "rgba(11,11,17,.92)", backdropFilter: "blur(16px)", borderRadius: "16px 16px 0 0", zIndex: 10 }}>
          <div style={{ display: "flex", gap: 3 }}>
            {STEPS.map((s, i) => (
              <button key={i} onClick={() => setStep(i)} style={{ background: step === i ? "rgba(59,130,246,0.12)" : "none", border: step === i ? "1px solid rgba(59,130,246,.3)" : "1px solid transparent", padding: "5px 12px", borderRadius: 6, fontFamily: "'Inter',sans-serif", fontWeight: step === i ? 600 : 400, fontSize: 12, color: step === i ? C.accent : C.textMid, cursor: "pointer", transition: "all .2s cubic-bezier(.4,0,.2,1)", boxShadow: step === i ? "0 0 12px rgba(59,130,246,.12)" : "none", transform: step === i ? "translateY(-1px)" : "none" }}
                onMouseEnter={e => { if (step !== i) { e.currentTarget.style.color = C.text; e.currentTarget.style.background = "rgba(255,255,255,.03)"; } }}
                onMouseLeave={e => { if (step !== i) { e.currentTarget.style.color = C.textMid; e.currentTarget.style.background = "none"; } }}>
                <span style={{ marginRight: 4, opacity: step === i ? .7 : .3, fontSize: 10, fontFamily: "'Inter Tight',sans-serif", transition: "opacity .2s" }}>{i + 1}</span>{s}
              </button>
            ))}
          </div>
          <button onClick={() => setForm(null)} style={{ background: "none", border: `1px solid ${C.border}`, color: C.textLow, padding: "5px 7px", borderRadius: 7, display: "flex", alignItems: "center", transition: "all .18s,transform .18s cubic-bezier(.34,1.56,.64,1)" }}
            onMouseEnter={e => { e.currentTarget.style.color = C.text; e.currentTarget.style.borderColor = C.borderMid; e.currentTarget.style.transform = "rotate(90deg) scale(1.1)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = C.textLow; e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = "rotate(0deg) scale(1)"; }}>
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: 22 }}>
          {step === 0 && (
            <div className="fade-in">
              <div className="section-title">Trade Details</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div><div className="lbl">Date &amp; Time</div><input type="datetime-local" value={f.datetime} onChange={e => u("datetime", e.target.value)} /></div>
                <div>
                  <div className="lbl">Instrument</div>
                  <div style={{ display: "flex", gap: 6, height: "38px" }}>
                    {["NQ", "ES"].map(inst => (
                      <button key={inst} onClick={() => u("instrument", inst)} style={{
                        flex: 1, borderRadius: 7, fontFamily: "'Inter Tight',sans-serif", fontWeight: 700, fontSize: 13,
                        border: `1px solid ${f.instrument === inst ? C.accent : C.border}`,
                        background: f.instrument === inst ? "rgba(59,130,246,.12)" : C.bg,
                        color: f.instrument === inst ? C.accent : C.textLow,
                        transition: "all .2s cubic-bezier(.34,1.2,.64,1)",
                        boxShadow: f.instrument === inst ? "0 0 12px rgba(59,130,246,.18)" : "none",
                        transform: f.instrument === inst ? "scale(1.03)" : "scale(1)"
                      }}>{inst}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="lbl">Direction</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {DIRECTIONS.map(d => (
                      <button key={d} onClick={() => u("direction", d)} style={{ flex: 1, borderRadius: 7, padding: "9px 0", fontFamily: "'Inter',sans-serif", fontWeight: 600, fontSize: 12, border: `1px solid ${f.direction === d ? (d === "Long" ? C.long : C.short) : C.border}`, background: f.direction === d ? (d === "Long" ? "rgba(56,189,248,.1)" : "rgba(244,63,94,.1)") : C.bg, color: f.direction === d ? (d === "Long" ? C.long : C.short) : C.textLow, transition: "all .2s cubic-bezier(.34,1.2,.64,1)", boxShadow: f.direction === d ? `0 0 12px ${d === "Long" ? "rgba(56,189,248,.15)" : "rgba(244,63,94,.15)"}` : "none", transform: f.direction === d ? "scale(1.02)" : "scale(1)" }}>{d}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
                {[["Entry", "entry"], ["Stop Loss", "sl"], ["Take Profit", "tp"], ["Exit", "exit"]].map(([l, k]) => (
                  <div key={k}><div className="lbl">{l}</div><input type="number" placeholder="0.00" value={f[k]} onChange={e => u(k, e.target.value)} /></div>
                ))}
              </div>
              {(projRR || realRR != null) && (
                <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                  {projRR && <RRTag label="Projected" val={`${projRR}R`} color={C.be} />}
                  {realRR != null && <RRTag label="Realized" val={`${realRR >= 0 ? "+" : ""}${realRR}R`} color={realRR >= 0 ? C.win : C.loss} />}
                  {f.pnl_dollars !== "" && !isNaN(parseFloat(f.pnl_dollars)) && (
                    <RRTag label="P&L" val={`${parseFloat(f.pnl_dollars) >= 0 ? "+" : ""}$${Math.abs(parseFloat(f.pnl_dollars)).toLocaleString()}`} color={parseFloat(f.pnl_dollars) >= 0 ? C.win : C.loss} />
                  )}
                </div>
              )}
              {/* ── Auto-calc summary banner ── */}
              {(autoFilled.session || autoFilled.htfBias || autoFilled.setupGrade) && (
                <div style={{ background: "rgba(6,182,212,.06)", border: "1px solid rgba(6,182,212,.18)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: "#06B6D4", textTransform: "uppercase", letterSpacing: ".1em", flexShrink: 0 }}>⚡ Auto-detected</span>
                  {autoFilled.session && f.session && (
                    <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.text, background: C.bg, padding: "2px 9px", borderRadius: 5, border: `1px solid ${C.border}` }}>Session → {f.session}</span>
                  )}
                  {autoFilled.htfBias && f.htfBias && (
                    <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.text, background: C.bg, padding: "2px 9px", borderRadius: 5, border: `1px solid ${C.border}` }}>HTF Bias → {f.htfBias}</span>
                  )}
                  {autoFilled.setupGrade && f.setupGrade && (
                    <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: gradeColor(f.setupGrade), background: C.bg, padding: "2px 9px", borderRadius: 5, border: `1px solid ${C.border}` }}>Grade → {f.setupGrade}</span>
                  )}
                  <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, marginLeft: "auto" }}>tap any field to override</span>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                <div><div className="lbl">Manual RR Override</div><input type="number" placeholder="Override realized RR…" value={f.rr_realized} onChange={e => u("rr_realized", e.target.value)} /></div>
                <div>
                  <div className="lbl">P&amp;L ($)</div>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontFamily: "'Inter Tight',sans-serif", fontSize: 12, color: f.pnl_dollars ? (parseFloat(f.pnl_dollars) >= 0 ? C.win : C.loss) : C.textLow, pointerEvents: "none", zIndex: 1 }}>$</span>
                    <input type="number" placeholder="0" value={f.pnl_dollars} onChange={e => u("pnl_dollars", e.target.value)}
                      style={{ paddingLeft: "24px !important" }} />
                  </div>
                </div>
              </div>
              <div className="divider" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <div className="lbl">Session {autoFilled.session && <AutoTag />}</div>
                  <select value={f.session} onChange={e => u("session", e.target.value)}
                    style={{ borderColor: autoFilled.session ? "rgba(6,182,212,.4)" : undefined }}>
                    <option value="">Select…</option>
                    {SESSION_OPTS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <div className="lbl">Outcome</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {OUTCOMES.map(o => (
                      <button key={o} onClick={() => u("outcome", o)} style={{ flex: 1, background: f.outcome === o ? `${OC[o]}12` : C.bg, border: `1px solid ${f.outcome === o ? OC[o] : C.border}`, color: f.outcome === o ? OC[o] : C.textLow, borderRadius: 7, padding: "9px 0", fontFamily: "'Inter',sans-serif", fontWeight: 600, fontSize: 12, transition: "all .2s cubic-bezier(.34,1.2,.64,1)", boxShadow: f.outcome === o ? `0 0 12px ${OC[o]}22` : "none", transform: f.outcome === o ? "scale(1.02)" : "scale(1)" }}>{o}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <div className="lbl">HTF Bias / MMXM</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <select value={f.htfBias} onChange={e => u("htfBias", e.target.value)}
                    style={{ borderColor: autoFilled.htfBias ? "rgba(6,182,212,.4)" : undefined }}>
                    <option value="">HTF Bias {autoFilled.htfBias ? "(auto)" : ""}…</option>
                    {BIAS_OPTS.map(o => <option key={o}>{o}</option>)}
                  </select>
                  <select value={f.mmxm} onChange={e => u("mmxm", e.target.value)}>
                    <option value="">MMXM Model…</option>
                    {MMXM_OPTS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="fade-in">
              <div className="section-title">IFVG Setup Quality</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
                <div>
                  <div className="lbl">Setup Grade {autoFilled.setupGrade && <AutoTag />}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginTop: 4 }}>
                    {SETUP_GRADE.map(g => (
                      <button key={g} onClick={() => u("setupGrade", g)} style={{ background: f.setupGrade === g ? `${gradeColor(g)}12` : C.bg, border: `1px solid ${f.setupGrade === g ? gradeColor(g) : C.border}`, color: f.setupGrade === g ? gradeColor(g) : C.textLow, borderRadius: 7, padding: "10px 6px", fontFamily: "'Inter Tight',sans-serif", fontWeight: 600, fontSize: 12, transition: "all .15s" }}>{g}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="lbl">Candles to Invert</div>
                  <div style={{ background: C.bg, borderRadius: 8, padding: 12, border: `1px solid ${C.border}` }}>
                    <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
                      {CANDLE_COUNT.map(c => {
                        const n = parseInt(c);
                        const col = n <= 3 ? C.win : n === 4 ? C.be : C.loss;
                        return (
                          <button key={c} onClick={() => u("candlesForIFVG", c)} style={{ flex: 1, background: f.candlesForIFVG === c ? `${col}12` : C.surface, border: `1px solid ${f.candlesForIFVG === c ? col : C.border}`, color: f.candlesForIFVG === c ? col : C.textLow, borderRadius: 6, padding: "8px 2px", fontFamily: "'Inter Tight',sans-serif", fontWeight: 600, fontSize: 13, transition: "all .15s" }}>{c}</button>
                        );
                      })}
                    </div>
                    <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow }}>3 best · 4 iffy · 5+ weak</div>
                  </div>
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div className="lbl">Close Quality</div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {CLOSE_QUALITY_OPTS.map(o => (
                    <button key={o} onClick={() => u("closeQuality", o)} className={`pill ${f.closeQuality === o ? "active" : ""}`}>{o}</button>
                  ))}
                </div>
              </div>
              <div className="divider" />
              <div className="section-title">Key Checklist</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {[
                  ["trueManipulation", "True Manipulation", "Both pairs sweep HTF liq + hit HTF FVG", C.accent],
                  ["smtPresent", "SMT Divergence", "Correlated pair divergence present", C.long],
                  ["po3", "PO3 — After HTF Candle Open", "Manipulation after 9:30 / 10:00 / 10:30", C.be],
                  ["displacingClose", "Displacing Close", "Body-dominant, strong displacement", C.win],
                  ["openLiquidity", "Open Liq in SL Zone (warning)", "Unswept liq or unmitigated FVG at SL", C.loss],
                ].map(([key, label, desc, col]) => (
                  <div key={key} className="check-row" onClick={() => toggleBool(key)} style={{ background: f[key] ? `${col}07` : "none", borderColor: f[key] ? `${col}18` : "transparent" }}>
                    <div style={{ width: 17, height: 17, borderRadius: 5, border: `1.5px solid ${f[key] ? col : C.textLow}`, background: f[key] ? col : "none", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .13s", flexShrink: 0, marginTop: 1 }}>
                      {f[key] && <Check size={9} color="#000" strokeWidth={3} />}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12, color: f[key] ? col : C.textMid }}>{label}</div>
                      <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow }}>{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="fade-in">
              <div className="section-title">Manipulation Analysis</div>
              <div style={{ marginBottom: 16 }}>
                <div className="lbl">Manipulation Type</div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 6 }}>
                  {MANIPULATION_OPTS.map(o => (
                    <button key={o} onClick={() => toggleArr("manipulation", o)} className={`pill ${f.manipulation.includes(o) ? "active" : ""}`}>{o}</button>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div className="lbl">Stop Hunt Quality</div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 6 }}>
                  {STOPHUNT_OPTS.map(o => {
                    const isGood = o.includes("Turtle") || o.includes("swept") || o.includes("ERL") || o.includes("IRL");
                    const isBad = o === "No Stop Hunt";
                    return (
                      <button key={o} onClick={() => toggleArr("stophunt", o)} className={`pill ${isGood ? "pill-green" : isBad ? "pill-red" : ""} ${f.stophunt.includes(o) ? "active" : ""}`}>{o}</button>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="lbl">IRL / ERL Phase</div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 6 }}>
                  {IRL_ERL_OPTS.map(o => (
                    <button key={o} onClick={() => u("irlErl", o === f.irlErl ? "" : o)} className={`pill ${f.irlErl === o ? "active" : ""}`}>{o}</button>
                  ))}
                </div>
              </div>
              <div className="divider" />
              <div style={{ background: C.bg, borderRadius: 9, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.textMid, lineHeight: 1.9 }}>
                  <span style={{ color: C.accent }}>True Manipulation</span> — Both correlated pairs sweep HTF significant liquidity AND hit HTF FVG. SMT does not void this criteria.<br />
                  <span style={{ color: C.long }}>Turtle Soup</span> — Wick sweep at H/L with no body closure above/below. Fastest reaction to distribution = highest quality.<br />
                  <span style={{ color: C.be }}>PO3</span> — Manipulation AFTER HTF candle opens. Entering 1-5min before HTF open lowers win rate significantly.
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="fade-in">
              <div className="section-title">Target and Distribution</div>
              <div style={{ marginBottom: 16 }}>
                <div className="lbl">Target Type</div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 6 }}>
                  {LIQUIDITY_TYPE_OPTS.map(o => (
                    <button key={o} onClick={() => toggleArr("targetType", o)} className={`pill ${f.targetType.includes(o) ? "active" : ""}`}>{o}</button>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div className="lbl">HTF Draw on Liquidity (DOL)</div>
                <input placeholder="e.g. ITH at 19,400 · Previous Day High · Session High…" value={f.htfDol} onChange={e => u("htfDol", e.target.value)} />
              </div>
              <div className="divider" />
              <div style={{ background: C.bg, borderRadius: 9, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.textMid, lineHeight: 1.9 }}>
                  <span style={{ color: C.win }}>LR (Low Resistance)</span> — Unswept liq, unmitigated FVGs. Price moves toward these with least friction.<br />
                  <span style={{ color: C.loss }}>HR (High Resistance)</span> — Previously manipulated liq, already mitigated FVGs. Price tends to avoid.<br />
                  <span style={{ color: C.accent }}>IRL to ERL</span> — Internal range liq to external range liq. Ideal phase for high-conviction targets.<br />
                  <span style={{ color: C.textLow }}>No real HTF reason for price to reach your TP = you will not be on the winning side.</span>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="fade-in">
              <div className="section-title">Chart Screenshots</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
                {TF_LABELS.map(tf => (
                  <ImageUploadZone key={tf} tf={tf} images={f.images[tf] || []} onAdd={files => addImage(tf, files)} onRemove={idx => removeImage(tf, idx)} />
                ))}
              </div>
              <div className="section-title">Analysis</div>
              <div style={{ marginBottom: 12 }}>
                <div className="lbl">Pre-Trade Analysis</div>
                <textarea rows={3} placeholder="Why did you take this trade? Confluence, narrative, reasoning…" value={f.notes} onChange={e => u("notes", e.target.value)} style={{ resize: "vertical" }} />
              </div>
              <div>
                <div className="lbl">Post-Trade Review</div>
                <textarea rows={3} placeholder="What happened? Execution quality? Lessons learned?" value={f.review} onChange={e => u("review", e.target.value)} style={{ resize: "vertical" }} />
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: "13px 22px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: C.bg, borderRadius: "0 0 14px 14px" }}>
          <div>{step > 0 && <button className="btn-ghost" onClick={() => setStep(s => s - 1)}>Back</button>}</div>
          <div style={{ display: "flex", gap: 7 }}>
            <button className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
            {step < 4
              ? <button className="btn-primary" onClick={() => setStep(s => s + 1)}>Next</button>
              : <button className="btn-primary" onClick={() => onSave(f)}><Save size={13} />Save Trade</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function RRTag({ label, val, color }) {
  return (
    <div style={{ background: C.bg, borderRadius: 7, padding: "8px 14px", border: `1px solid ${color}22` }}>
      <div className="lbl" style={{ marginBottom: 3 }}>{label}</div>
      <div className="stat-num" style={{ fontSize: 17, color }}>{val}</div>
    </div>
  );
}

function ImageUploadZone({ tf, images, onAdd, onRemove }) {
  const ref = useRef();
  const tfColors = { HTF: C.accent, MTF: C.win, LTF: C.be };
  const col = tfColors[tf];
  return (
    <div style={{ background: C.bg, borderRadius: 9, padding: 11, border: `1px solid ${C.border}` }}>
      <div style={{ fontFamily: "'Inter Tight',sans-serif", fontWeight: 500, fontSize: 10, color: col, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 9 }}>{tf}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: images.length < 3 ? 7 : 0 }}>
        {images.map((img, i) => (
          <div key={i} style={{ position: "relative" }}>
            <img src={img.src} className="img-th" alt={img.name} />
            <button onClick={() => onRemove(i)} style={{ position: "absolute", top: -5, right: -5, background: C.loss, border: "none", borderRadius: "50%", width: 15, height: 15, display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}><X size={7} /></button>
          </div>
        ))}
      </div>
      {images.length < 3 && (
        <>
          <input ref={ref} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => onAdd(e.target.files)} />
          <button onClick={() => ref.current.click()} style={{ background: "none", border: `1px dashed ${col}30`, color: C.textLow, borderRadius: 6, padding: "8px 0", width: "100%", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontFamily: "'Inter Tight',sans-serif", transition: "all .2s cubic-bezier(.4,0,.2,1)" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = col; e.currentTarget.style.color = col; e.currentTarget.style.background = `${col}08`; e.currentTarget.style.transform = "scale(1.01)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = `${col}30`; e.currentTarget.style.color = C.textLow; e.currentTarget.style.background = "none"; e.currentTarget.style.transform = "scale(1)"; }}>
            <Upload size={10} /> {images.length}/3
          </button>
        </>
      )}
    </div>
  );
}

function TradeDetailModal({ trade: t, onClose, onEdit, onDelete, onImgClick }) {
  const rr = t.rr_realized !== "" ? parseFloat(t.rr_realized) : calcRealRR(t.direction, t.entry, t.sl, t.exit);
  return (
    <div className="overlay">
      <div className="modal" style={{ maxWidth: 720 }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "rgba(11,11,17,.92)", backdropFilter: "blur(16px)", borderRadius: "16px 16px 0 0", zIndex: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: OC[t.outcome] || C.textLow, boxShadow: `0 0 8px ${OC[t.outcome] || C.textLow}88` }} />
            <div style={{ fontWeight: 700, fontSize: 17, color: C.text }}>{t.instrument || "Trade"}</div>
            <span className={`badge ${t.direction === "Long" ? "blong" : "bshort"}`}>{t.direction}</span>
            <span className={`badge ${t.outcome === "Win" ? "bw" : t.outcome === "Loss" ? "bl" : "bb"}`}>{t.outcome}</span>
            {t.setupGrade && <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: gradeColor(t.setupGrade), background: `${gradeColor(t.setupGrade)}10`, padding: "2px 8px", borderRadius: 4, border: `1px solid ${gradeColor(t.setupGrade)}22` }}>{t.setupGrade}</span>}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn-ghost" style={{ padding: "4px 10px", fontSize: 11 }} onClick={onEdit}><Edit3 size={11} />Edit</button>
            <button onClick={onDelete} style={{ background: "none", border: "1px solid transparent", color: `${C.loss}44`, borderRadius: 7, padding: "4px 7px", display: "flex", alignItems: "center", transition: "all .18s,transform .18s cubic-bezier(.34,1.56,.64,1)" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = `${C.loss}55`; e.currentTarget.style.color = C.loss; e.currentTarget.style.background = `${C.loss}08`; e.currentTarget.style.transform = "scale(1.05)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.color = `${C.loss}44`; e.currentTarget.style.background = "none"; e.currentTarget.style.transform = "scale(1)"; }}><Trash2 size={11} /></button>
            <button onClick={onClose} style={{ background: "none", border: `1px solid ${C.border}`, color: C.textLow, padding: "4px 7px", borderRadius: 7, display: "flex", alignItems: "center", transition: "all .18s,transform .18s cubic-bezier(.34,1.56,.64,1)" }}
              onMouseEnter={e => { e.currentTarget.style.color = C.text; e.currentTarget.style.borderColor = C.borderMid; e.currentTarget.style.transform = "rotate(90deg) scale(1.1)"; }}
              onMouseLeave={e => { e.currentTarget.style.color = C.textLow; e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = "rotate(0deg) scale(1)"; }}>
              <X size={14} />
            </button>
          </div>
        </div>

        <div style={{ padding: 20 }}>
          <div style={{ display: "flex", gap: 9, marginBottom: 18 }}>
            <div style={{ flex: 1, background: rr != null && rr >= 0 ? "rgba(34,197,94,.08)" : "rgba(239,68,68,.08)", borderRadius: 9, padding: "13px 16px", border: `1px solid ${rr != null && rr >= 0 ? "rgba(34,197,94,.15)" : "rgba(239,68,68,.15)"}`, textAlign: "center", boxShadow: rr != null ? `inset 0 0 20px ${rr >= 0 ? "rgba(34,197,94,.04)" : "rgba(239,68,68,.04)"}` : "none", transition: "box-shadow .3s" }}>
              <div className="lbl" style={{ marginBottom: 3 }}>Realized RR</div>
              <div className="stat-num" style={{ fontSize: 30, color: rr != null ? (rr >= 0 ? C.win : C.loss) : C.textLow }}>{rr != null ? `${rr >= 0 ? "+" : ""}${rr}R` : "—"}</div>
              {t.pnl_dollars !== "" && t.pnl_dollars != null && !isNaN(parseFloat(t.pnl_dollars)) && (
                <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 13, color: parseFloat(t.pnl_dollars) >= 0 ? C.win : C.loss, marginTop: 5, opacity: .85 }}>
                  {parseFloat(t.pnl_dollars) >= 0 ? "+" : ""}${Math.abs(parseFloat(t.pnl_dollars)).toLocaleString()}
                </div>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, flex: 2 }}>
              {[["Date", fmtDate(t.datetime)], ["Session", t.session || "—"], ["MMXM", t.mmxm || "—"], ["HTF Bias", t.htfBias || "—"]].map(([l, v]) => (
                <div key={l} style={{ background: C.bg, borderRadius: 7, padding: "9px 11px", transition: "border-color .15s", border: "1px solid transparent" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = C.border}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "transparent"}>
                  <div className="lbl" style={{ marginBottom: 2 }}>{l}</div>
                  <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 12, color: C.textMid }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="section-title">Execution</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 7, marginBottom: 14 }}>
            {[["Entry", t.entry], ["Stop Loss", t.sl], ["Take Profit", t.tp], ["Exit", t.exit]].map(([l, v]) => (
              <div key={l} style={{ background: C.bg, borderRadius: 7, padding: "9px 11px" }}>
                <div className="lbl" style={{ marginBottom: 2 }}>{l}</div>
                <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 12, color: C.textMid }}>{v || "—"}</div>
              </div>
            ))}
          </div>

          <div className="section-title">IFVG Replicability</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 7, marginBottom: 13 }}>
            {[["Candles to Invert", t.candlesForIFVG ? `${t.candlesForIFVG} candles` : "—"], ["Close Quality", t.closeQuality || "—"], ["IRL/ERL Phase", t.irlErl || "—"]].map(([l, v]) => (
              <div key={l} style={{ background: C.bg, borderRadius: 7, padding: "9px 11px" }}>
                <div className="lbl" style={{ marginBottom: 2 }}>{l}</div>
                <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 12, color: C.textMid }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 13 }}>
            {[["trueManipulation", "True Manipulation", C.accent], ["smtPresent", "SMT", C.long], ["po3", "PO3", C.be], ["displacingClose", "Displacing Close", C.win], ["openLiquidity", "Open Liq in SL", C.loss]].map(([key, label, col]) => (
              t[key] && <span key={key} style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: col, background: `${col}10`, padding: "3px 9px", borderRadius: 4, border: `1px solid ${col}22` }}>{label}</span>
            ))}
          </div>

          {(t.manipulation?.length > 0 || t.stophunt?.length > 0) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 13 }}>
              {t.manipulation?.length > 0 && (
                <div style={{ background: C.bg, borderRadius: 8, padding: "9px 11px" }}>
                  <div className="lbl">Manipulation</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                    {t.manipulation.map(m => <span key={m} style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.accent, background: "rgba(59,130,246,.1)", padding: "2px 7px", borderRadius: 3 }}>{m}</span>)}
                  </div>
                </div>
              )}
              {t.stophunt?.length > 0 && (
                <div style={{ background: C.bg, borderRadius: 8, padding: "9px 11px" }}>
                  <div className="lbl">Stop Hunt</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                    {t.stophunt.map(s => <span key={s} style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.win, background: "rgba(34,197,94,.1)", padding: "2px 7px", borderRadius: 3 }}>{s}</span>)}
                  </div>
                </div>
              )}
            </div>
          )}

          {(t.targetType?.length > 0 || t.htfDol) && (
            <div style={{ background: C.bg, borderRadius: 8, padding: "9px 11px", marginBottom: 13 }}>
              <div className="lbl">Targets</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                {t.targetType?.map(tt => <span key={tt} style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.be, background: "rgba(234,179,8,.1)", padding: "2px 7px", borderRadius: 3 }}>{tt}</span>)}
              </div>
              {t.htfDol && <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: C.textLow, marginTop: 7 }}>DOL: {t.htfDol}</div>}
            </div>
          )}

          {TF_LABELS.map(tf => {
            const imgs = t.images?.[tf] || [];
            if (!imgs.length) return null;
            return (
              <div key={tf} style={{ marginBottom: 11 }}>
                <div className="lbl">{tf}</div>
                <div style={{ display: "flex", gap: 7, marginTop: 4 }}>
                  {imgs.map((img, i) => <img key={i} src={img.src} className="img-th" style={{ width: 96, height: 68 }} onClick={() => onImgClick(img.src, `${tf} — ${img.name}`)} alt={img.name} />)}
                </div>
              </div>
            );
          })}

          {t.notes && (
            <div style={{ marginBottom: 9 }}>
              <div className="lbl">Pre-Trade Analysis</div>
              <div style={{ background: C.bg, borderRadius: 8, padding: "10px 13px", fontFamily: "'Inter Tight',sans-serif", fontSize: 12, color: C.textMid, lineHeight: 1.7, marginTop: 4, whiteSpace: "pre-wrap" }}>{t.notes}</div>
            </div>
          )}
          {t.review && (
            <div>
              <div className="lbl">Post-Trade Review</div>
              <div style={{ background: C.bg, borderRadius: 8, padding: "10px 13px", fontFamily: "'Inter Tight',sans-serif", fontSize: 12, color: C.textMid, lineHeight: 1.7, marginTop: 4, whiteSpace: "pre-wrap" }}>{t.review}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function JournalFormModal({ form, setForm, onSave }) {
  const [f, setF] = useState(form);
  const u = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <div className="overlay">
      <div className="modal" style={{ maxWidth: 560 }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(11,11,17,.92)", backdropFilter: "blur(16px)", borderRadius: "16px 16px 0 0" }}>
          <div style={{ fontWeight: 600, fontSize: 15, color: C.text }}>Daily Journal Entry</div>
          <button onClick={() => setForm(null)} style={{ background: "none", border: `1px solid ${C.border}`, color: C.textLow, borderRadius: 7, padding: "4px 7px", display: "flex", transition: "all .18s,transform .18s cubic-bezier(.34,1.56,.64,1)" }}
            onMouseEnter={e => { e.currentTarget.style.color = C.text; e.currentTarget.style.borderColor = C.borderMid; e.currentTarget.style.transform = "rotate(90deg) scale(1.1)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = C.textLow; e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = "rotate(0deg) scale(1)"; }}>
            <X size={14} />
          </button>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 14, marginBottom: 14, alignItems: "end" }}>
            <div><div className="lbl">Date</div><input type="date" value={f.date} onChange={e => u("date", e.target.value)} /></div>
            <div>
              <div className="lbl">Rating</div>
              <div style={{ display: "flex", gap: 3 }}>
                {[1,2,3,4,5].map(s => (
                  <button key={s} onClick={() => u("rating", s)} style={{ background: "none", border: "none", fontSize: 22, color: s <= f.rating ? C.be : C.border, padding: "2px", transition: "transform .1s, color .12s", cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.transform = "scale(1.2)"}
                    onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>&#9733;</button>
                ))}
              </div>
            </div>
          </div>
          {[["mindset", "Mindset of the Day", "Mental state, focus level, energy…", C.long], ["good", "What I Did Well", "Good executions, discipline, patience…", C.win], ["improve", "What to Improve", "Mistakes, fomo entries, early exits…", C.be]].map(([k, l, ph, col]) => (
            <div key={k} style={{ marginBottom: 11 }}>
              <div className="lbl" style={{ color: col }}>{l}</div>
              <textarea rows={2} placeholder={ph} value={f[k]} onChange={e => u(k, e.target.value)} style={{ resize: "vertical" }} />
            </div>
          ))}
          <div style={{ marginBottom: 16 }}>
            <div className="lbl">Additional Notes</div>
            <textarea rows={3} placeholder="Market observations, algo behavior, session notes…" value={f.notes} onChange={e => u("notes", e.target.value)} style={{ resize: "vertical" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 7 }}>
            <button className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn-primary" onClick={() => onSave(f)}><Save size={13} />Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ANALYTICS TAB — Advanced Visualizations (Phase 7)
// ═══════════════════════════════════════════════════════════════════════════

// ── Helpers ─────────────────────────────────────────────────────────────────
const getISOWeek = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
};
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_NAMES   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// ── AnalyticsTab ────────────────────────────────────────────────────────────
export function AnalyticsTab({ trades }) {
  const [section, setSection] = useState("heatmap");

  const SECTIONS = [
    { id: "heatmap",   label: "Daily Heatmap" },
    { id: "calendar",  label: "PnL Calendar" },
    { id: "streaks",   label: "Win/Loss Streaks" },
    { id: "weekly",    label: "Weekly Recap" },
    { id: "monthly",   label: "Monthly Recap" },
    { id: "sessions",  label: "Session Distribution" },
  ];

  if (!trades.length) return (
    <div style={{ textAlign: "center", padding: "120px 0" }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>📊</div>
      <div style={{ fontWeight: 600, fontSize: 18, color: C.textMid }}>No trades to analyze</div>
      <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 12, color: C.textLow, marginTop: 8 }}>Log trades first to unlock advanced analytics</div>
    </div>
  );

  return (
    <div className="fade-in">
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 22 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 20, color: C.text }}>Analytics</div>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: C.textLow, marginTop: 2 }}>
            Advanced visualizations · {trades.length} trades
          </div>
        </div>
      </div>

      {/* ── Section Tabs ── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 22, flexWrap: "wrap", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4 }}>
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setSection(s.id)} style={{
            background: section === s.id ? C.surfaceHigh : "none",
            border: `1px solid ${section === s.id ? C.borderMid : "transparent"}`,
            color: section === s.id ? C.text : C.textMid,
            borderRadius: 7, padding: "6px 14px",
            fontFamily: "'Inter Tight',sans-serif", fontSize: 11, fontWeight: section === s.id ? 600 : 400,
            cursor: "pointer", transition: "all .18s cubic-bezier(.4,0,.2,1)",
            boxShadow: section === s.id ? "0 1px 8px rgba(0,0,0,.3)" : "none",
          }}>{s.label}</button>
        ))}
      </div>

      {/* ── Panels ── */}
      <div className="fade-in" key={section}>
        {section === "heatmap"  && <DailyHeatmap trades={trades} />}
        {section === "calendar" && <PnLCalendar trades={trades} />}
        {section === "streaks"  && <StreakGraph trades={trades} />}
        {section === "weekly"   && <WeeklyRecap trades={trades} />}
        {section === "monthly"  && <MonthlyRecap trades={trades} />}
        {section === "sessions" && <SessionDistribution trades={trades} />}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 1. DAILY HEATMAP — performance by weekday × hour (NY time)
// ══════════════════════════════════════════════════════════════════
function DailyHeatmap({ trades }) {
  const HOURS = Array.from({ length: 13 }, (_, i) => i + 7); // 07–19 (display)
  const DAYS  = ["Mon","Tue","Wed","Thu","Fri"];

  const cells = useMemo(() => {
    const map = {};
    DAYS.forEach(d => HOURS.forEach(h => { map[`${d}_${h}`] = { wins: 0, losses: 0, bes: 0, rr: 0 }; }));

    trades.forEach(t => {
      if (!t.datetime) return;
      const dt = new Date(t.datetime);
      const nyStr = dt.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", hour12: false });
      const parts = nyStr.split(", ");
      if (parts.length < 2) return;
      const day = parts[0]; // "Mon" etc.
      const h = parseInt(parts[1]);
      const key = `${day}_${h}`;
      if (!map[key]) return;
      if (t.outcome === "Win") map[key].wins++;
      else if (t.outcome === "Loss") map[key].losses++;
      else map[key].bes++;
      map[key].rr += getTradeRR(t) || 0;
    });
    return map;
  }, [trades]);

  const maxTrades = Math.max(1, ...Object.values(cells).map(c => c.wins + c.losses + c.bes));

  const cellColor = (c) => {
    const total = c.wins + c.losses + c.bes;
    if (!total) return "transparent";
    const wr = c.wins / total;
    if (wr >= 0.65) return C.win;
    if (wr >= 0.45) return C.be;
    return C.loss;
  };
  const cellOpacity = (c) => {
    const total = c.wins + c.losses + c.bes;
    if (!total) return 0;
    return 0.12 + 0.55 * (total / maxTrades);
  };

  const killzones = [
    { h: 9, label: "NY Open", color: C.accent },
    { h: 10, label: "NY AM", color: C.cyan },
    { h: 14, label: "NY PM", color: "#A78BFA" },
  ];

  return (
    <div className="glass-panel" style={{ padding: "24px 28px" }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 4 }}>Daily Performance Heatmap</div>
        <div style={{ fontSize: 13, color: C.textMid }}>Win rate intensity by weekday and NY session hour</div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        {[["High WR (65%+)", C.win], ["Mid WR (45–65%)", C.be], ["Low WR (<45%)", C.loss]].map(([l, c]) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: c, opacity: 0.7 }} />
            <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.textMid }}>{l}</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, border: `1px dashed ${C.borderMid}` }} />
          <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.textLow }}>No data</span>
        </div>
      </div>

      {/* Grid */}
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 680 }}>
          {/* Hour headers */}
          <div style={{ display: "grid", gridTemplateColumns: `64px repeat(${HOURS.length}, 1fr)`, gap: 3, marginBottom: 4 }}>
            <div />
            {HOURS.map(h => {
              const kz = killzones.find(k => k.h === h);
              return (
                <div key={h} style={{ textAlign: "center", position: "relative" }}>
                  <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: kz ? kz.color : C.textLow }}>{h}:00</div>
                  {kz && <div style={{ position: "absolute", bottom: -2, left: "10%", right: "10%", height: 2, background: kz.color, borderRadius: 1, opacity: 0.6 }} />}
                </div>
              );
            })}
          </div>

          {/* Rows */}
          {DAYS.map(day => (
            <div key={day} style={{ display: "grid", gridTemplateColumns: `64px repeat(${HOURS.length}, 1fr)`, gap: 3, marginBottom: 3 }}>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: C.textMid, display: "flex", alignItems: "center", fontWeight: 600 }}>{day}</div>
              {HOURS.map(h => {
                const c = cells[`${day}_${h}`] || { wins: 0, losses: 0, bes: 0, rr: 0 };
                const total = c.wins + c.losses + c.bes;
                const col = cellColor(c);
                const opc = cellOpacity(c);
                const wr = total ? Math.round(c.wins / total * 100) : null;
                const avgRR = total ? (c.rr / total).toFixed(1) : null;
                return (
                  <div
                    key={h}
                    title={total ? `${day} ${h}:00 — ${total} trades · ${wr}% WR · ${avgRR}R avg` : "No trades"}
                    style={{
                      height: 38,
                      borderRadius: 6,
                      background: total ? `${col}` : C.bg,
                      opacity: total ? opc + 0.1 : 1,
                      border: `1px solid ${total ? `${col}40` : C.border}`,
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      cursor: total ? "pointer" : "default",
                      transition: "transform .15s, opacity .15s",
                      position: "relative", overflow: "hidden",
                    }}
                    onMouseEnter={e => { if (total) { e.currentTarget.style.transform = "scale(1.06)"; e.currentTarget.style.opacity = "1"; e.currentTarget.style.zIndex = "10"; }}}
                    onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.opacity = total ? String(opc + 0.1) : "1"; e.currentTarget.style.zIndex = "1"; }}
                  >
                    {total > 0 && (
                      <>
                        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, fontWeight: 700, color: col, lineHeight: 1 }}>{wr}%</div>
                        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 8, color: `${col}99`, marginTop: 1 }}>{total}T</div>
                      </>
                    )}
                    {!total && <div style={{ width: 4, height: 4, borderRadius: "50%", background: C.border }} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Killzone labels */}
      <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
        {killzones.map(kz => (
          <div key={kz.h} style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: kz.color }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: kz.color, opacity: 0.7 }} />
            {kz.label} ({kz.h}:00 NY)
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 2. PnL CALENDAR — monthly grid with daily PnL / RR
// ══════════════════════════════════════════════════════════════════
function PnLCalendar({ trades }) {
  const allMonths = useMemo(() => {
    const months = new Set();
    trades.forEach(t => {
      if (t.datetime) months.add(t.datetime.slice(0, 7));
    });
    return [...months].sort().reverse();
  }, [trades]);

  const [selMonth, setSelMonth] = useState(allMonths[0] || "");

  const dailyData = useMemo(() => {
    const map = {};
    trades.filter(t => t.datetime?.startsWith(selMonth)).forEach(t => {
      const day = t.datetime.slice(0, 10);
      if (!map[day]) map[day] = { wins: 0, losses: 0, bes: 0, rr: 0, pnl: 0, trades: [] };
      map[day].trades.push(t);
      if (t.outcome === "Win") map[day].wins++;
      else if (t.outcome === "Loss") map[day].losses++;
      else map[day].bes++;
      map[day].rr += getTradeRR(t) || 0;
      const pnl = parseFloat(t.pnl_dollars);
      if (!isNaN(pnl)) map[day].pnl += pnl;
    });
    return map;
  }, [trades, selMonth]);

  // Build calendar grid
  const [year, month] = selMonth ? selMonth.split("-").map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1];
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();
  const blanks = (firstDay + 6) % 7; // adjust to Mon start

  const maxRR = Math.max(0.01, ...Object.values(dailyData).map(d => Math.abs(d.rr)));

  const monthSummary = useMemo(() => {
    const vals = Object.values(dailyData);
    const tradingDays = vals.filter(d => d.trades.length > 0).length;
    const wins = vals.reduce((a, d) => a + d.wins, 0);
    const losses = vals.reduce((a, d) => a + d.losses, 0);
    const bes = vals.reduce((a, d) => a + d.bes, 0);
    const totalRR = vals.reduce((a, d) => a + d.rr, 0);
    const totalPnl = vals.reduce((a, d) => a + d.pnl, 0);
    return { tradingDays, wins, losses, bes, totalRR: totalRR.toFixed(2), totalPnl };
  }, [dailyData]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Month selector + summary */}
      <div className="glass-panel" style={{ padding: "18px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em" }}>Month</div>
          <select value={selMonth} onChange={e => setSelMonth(e.target.value)} style={{ width: "auto", padding: "6px 10px" }}>
            {allMonths.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          {[
            ["Days", monthSummary.tradingDays, C.textMid],
            ["W/L/BE", `${monthSummary.wins}/${monthSummary.losses}/${monthSummary.bes}`, C.text],
            ["Total RR", `${parseFloat(monthSummary.totalRR) >= 0 ? "+" : ""}${monthSummary.totalRR}R`, parseFloat(monthSummary.totalRR) >= 0 ? C.win : C.loss],
            ...(monthSummary.totalPnl !== 0 ? [["P&L", `${monthSummary.totalPnl >= 0 ? "+" : ""}$${Math.abs(monthSummary.totalPnl).toLocaleString()}`, monthSummary.totalPnl >= 0 ? C.win : C.loss]] : []),
          ].map(([l, v, col]) => (
            <div key={l} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, marginBottom: 3 }}>{l}</div>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 14, fontWeight: 600, color: col }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Calendar grid */}
      <div className="glass-panel" style={{ padding: "20px 22px" }}>
        {/* Day headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 8 }}>
          {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
            <div key={d} style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textAlign: "center", padding: "4px 0" }}>{d}</div>
          ))}
        </div>

        {/* Calendar cells */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {/* Blank cells */}
          {Array.from({ length: blanks }).map((_, i) => <div key={`b${i}`} />)}

          {/* Day cells */}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const dayNum = i + 1;
            const dateStr = `${selMonth}-${String(dayNum).padStart(2, "0")}`;
            const d = dailyData[dateStr];
            const hasData = d && d.trades.length > 0;
            const isGreen = hasData && d.rr > 0;
            const isRed = hasData && d.rr < 0;
            const intensity = hasData ? Math.min(1, Math.abs(d.rr) / maxRR) : 0;
            const col = isGreen ? C.win : isRed ? C.loss : C.be;

            return (
              <div
                key={dayNum}
                title={hasData ? `${dateStr}: ${d.wins}W ${d.losses}L · ${d.rr.toFixed(2)}R` : dateStr}
                style={{
                  minHeight: 64,
                  borderRadius: 8,
                  background: hasData ? `${col}${Math.round(intensity * 18 + 6).toString(16).padStart(2, "0")}` : C.bg,
                  border: `1px solid ${hasData ? `${col}33` : C.border}`,
                  padding: "6px 7px",
                  transition: "transform .15s, box-shadow .15s",
                  cursor: hasData ? "pointer" : "default",
                }}
                onMouseEnter={e => { if (hasData) { e.currentTarget.style.transform = "scale(1.04)"; e.currentTarget.style.boxShadow = `0 4px 16px ${col}22`; }}}
                onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}
              >
                <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: hasData ? C.text : C.textLow, marginBottom: 4 }}>{dayNum}</div>
                {hasData && (
                  <>
                    <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 12, fontWeight: 700, color: col, lineHeight: 1 }}>
                      {d.rr >= 0 ? "+" : ""}{d.rr.toFixed(1)}R
                    </div>
                    <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, marginTop: 2 }}>
                      {d.trades.length}T · {d.wins}W
                    </div>
                    {d.pnl !== 0 && (
                      <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: d.pnl >= 0 ? C.win : C.loss, marginTop: 1 }}>
                        {d.pnl >= 0 ? "+" : ""}${Math.abs(d.pnl).toLocaleString()}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 3. WIN/LOSS STREAK GRAPH
// ══════════════════════════════════════════════════════════════════
function StreakGraph({ trades }) {
  const sorted = useMemo(() =>
    [...trades].sort((a, b) => new Date(a.datetime) - new Date(b.datetime)),
  [trades]);

  // Build streak series: running streak value (+ for wins, - for losses)
  const streakData = useMemo(() => {
    let curStreak = 0;
    let curType = null;
    return sorted.map((t, i) => {
      if (t.outcome === "BE") {
        curStreak = 0; curType = null;
        return { n: i + 1, streak: 0, outcome: "BE", instrument: t.instrument, date: t.datetime, rr: getTradeRR(t) };
      }
      if (t.outcome === curType) {
        curStreak = curType === "Win" ? curStreak + 1 : curStreak - 1;
      } else {
        curType = t.outcome;
        curStreak = curType === "Win" ? 1 : -1;
      }
      return { n: i + 1, streak: curStreak, outcome: t.outcome, instrument: t.instrument, date: t.datetime, rr: getTradeRR(t) };
    });
  }, [sorted]);

  // Build consecutive streak blocks for the streak timeline
  const streakBlocks = useMemo(() => {
    const blocks = [];
    let cur = null;
    sorted.forEach((t, i) => {
      if (t.outcome === "BE") { cur = null; return; }
      if (!cur || cur.type !== t.outcome) {
        if (cur) blocks.push(cur);
        cur = { type: t.outcome, count: 1, start: i };
      } else {
        cur.count++;
      }
    });
    if (cur) blocks.push(cur);
    return blocks.sort((a, b) => b.count - a.count).slice(0, 10);
  }, [sorted]);

  const maxStreak = Math.max(1, ...streakData.map(d => Math.abs(d.streak)));
  const winStreaks = streakBlocks.filter(b => b.type === "Win");
  const lossStreaks = streakBlocks.filter(b => b.type === "Loss");

  const CustomDot = (props) => {
    const { cx, cy, payload } = props;
    if (!payload) return null;
    const col = payload.outcome === "Win" ? C.win : payload.outcome === "Loss" ? C.loss : C.be;
    const r = Math.abs(payload.streak) >= 3 ? 5 : 3;
    return <circle cx={cx} cy={cy} r={r} fill={col} stroke={C.bg} strokeWidth={1.5} />;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Streak bar chart */}
      <div className="glass-panel" style={{ padding: "22px 24px" }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 4 }}>Running Streak · Per Trade</div>
          <div style={{ fontSize: 13, color: C.textMid }}>Positive = current win streak depth · Negative = loss streak depth</div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={streakData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }} barCategoryGap="25%">
            <CartesianGrid strokeDasharray="2 6" stroke={C.border} vertical={false} />
            <XAxis dataKey="n" tick={{ fill: C.textLow, fontSize: 9, fontFamily: "Inter Tight" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: C.textLow, fontSize: 9, fontFamily: "Inter Tight" }} axisLine={false} tickLine={false} domain={[-maxStreak - 1, maxStreak + 1]} />
            <ReferenceLine y={0} stroke={C.borderMid} strokeWidth={1.5} />
            <Tooltip
              contentStyle={{ background: "#0F0F17", border: `1px solid ${C.borderMid}`, borderRadius: 8, color: C.text, fontSize: 11, fontFamily: "Inter Tight" }}
              formatter={(v, _, props) => {
                const p = props.payload;
                return [`${v > 0 ? "+" : ""}${v} (${p.outcome})`, "Streak"];
              }}
              labelFormatter={v => `Trade #${v}`}
            />
            <Bar dataKey="streak" radius={[2, 2, 0, 0]}>
              {streakData.map((d, i) => (
                <Cell key={i} fill={d.outcome === "Win" ? C.win : d.outcome === "Loss" ? C.loss : C.be}
                  fillOpacity={0.75} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Best / Worst streaks */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="glass-panel" style={{ padding: "18px 20px" }}>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.win, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 12 }}>🏆 Best Win Streaks</div>
          {winStreaks.length === 0 && <div style={{ color: C.textLow, fontSize: 11, fontFamily: "'Inter Tight',sans-serif" }}>No win streaks yet</div>}
          {winStreaks.slice(0, 5).map((b, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: C.textLow, width: 16 }}>#{i + 1}</div>
              <div style={{ flex: 1, height: 6, background: C.border, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(b.count / (winStreaks[0]?.count || 1)) * 100}%`, background: C.win, borderRadius: 3, transition: "width .5s" }} />
              </div>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 14, fontWeight: 700, color: C.win, width: 32, textAlign: "right" }}>{b.count}W</div>
            </div>
          ))}
        </div>
        <div className="glass-panel" style={{ padding: "18px 20px" }}>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.loss, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 12 }}>📉 Worst Loss Streaks</div>
          {lossStreaks.length === 0 && <div style={{ color: C.textLow, fontSize: 11, fontFamily: "'Inter Tight',sans-serif" }}>No loss streaks yet</div>}
          {lossStreaks.slice(0, 5).map((b, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: C.textLow, width: 16 }}>#{i + 1}</div>
              <div style={{ flex: 1, height: 6, background: C.border, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(b.count / (lossStreaks[0]?.count || 1)) * 100}%`, background: C.loss, borderRadius: 3, transition: "width .5s" }} />
              </div>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 14, fontWeight: 700, color: C.loss, width: 32, textAlign: "right" }}>{b.count}L</div>
            </div>
          ))}
        </div>
      </div>

      {/* Equity colored by streak momentum */}
      <div className="glass-panel" style={{ padding: "20px 24px" }}>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 12 }}>Cumulative RR · colored by outcome</div>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={streakData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 6" stroke={C.border} vertical={false} />
            <XAxis dataKey="n" tick={{ fill: C.textLow, fontSize: 9, fontFamily: "Inter Tight" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: C.textLow, fontSize: 9, fontFamily: "Inter Tight" }} axisLine={false} tickLine={false} />
            <ReferenceLine y={0} stroke={C.borderMid} strokeDasharray="3 3" />
            <Tooltip contentStyle={{ background: "#0F0F17", border: `1px solid ${C.borderMid}`, borderRadius: 8, color: C.text, fontSize: 11, fontFamily: "Inter Tight" }}
              formatter={(v, _, p) => [`${v >= 0 ? "+" : ""}${v}R`, p.payload.outcome]} />
            <Line type="monotone" dataKey="rr" stroke={C.accent} strokeWidth={1.5} dot={<CustomDot />} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 4. WEEKLY RECAP
// ══════════════════════════════════════════════════════════════════
function WeeklyRecap({ trades }) {
  const weeklyData = useMemo(() => {
    const map = {};
    trades.forEach(t => {
      if (!t.datetime) return;
      const d = new Date(t.datetime);
      const year = d.getFullYear();
      const week = getISOWeek(d);
      const key = `${year}-W${String(week).padStart(2, "0")}`;
      if (!map[key]) {
        // Get Monday of that week
        const mon = new Date(d);
        mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        map[key] = { key, label: `W${week} (${mon.toLocaleDateString("en-US",{month:"short",day:"numeric"})})`, wins: 0, losses: 0, bes: 0, rr: 0, pnl: 0, trades: [], gradeA: 0 };
      }
      map[key].trades.push(t);
      if (t.outcome === "Win") map[key].wins++;
      else if (t.outcome === "Loss") map[key].losses++;
      else map[key].bes++;
      map[key].rr += getTradeRR(t) || 0;
      const pnl = parseFloat(t.pnl_dollars);
      if (!isNaN(pnl)) map[key].pnl += pnl;
      if (t.setupGrade === "A+" || t.setupGrade === "A") map[key].gradeA++;
    });
    return Object.values(map)
      .sort((a, b) => b.key.localeCompare(a.key))
      .map(w => ({
        ...w,
        total: w.wins + w.losses + w.bes,
        wr: w.wins + w.losses > 0 ? Math.round(w.wins / (w.wins + w.losses) * 100) : null,
        rr: parseFloat(w.rr.toFixed(2)),
      }));
  }, [trades]);

  const chartData = [...weeklyData].reverse().slice(-16);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Bar chart */}
      <div className="glass-panel" style={{ padding: "22px 24px" }}>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 16 }}>Weekly RR Performance · Last 16 Weeks</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 6" stroke={C.border} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: C.textLow, fontSize: 8, fontFamily: "Inter Tight" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: C.textLow, fontSize: 9, fontFamily: "Inter Tight" }} axisLine={false} tickLine={false} />
            <ReferenceLine y={0} stroke={C.borderMid} strokeWidth={1.5} />
            <Tooltip contentStyle={{ background: "#0F0F17", border: `1px solid ${C.borderMid}`, borderRadius: 8, color: C.text, fontSize: 11, fontFamily: "Inter Tight" }}
              formatter={(v) => [`${v >= 0 ? "+" : ""}${v}R`, "Weekly RR"]} />
            <Bar dataKey="rr" radius={[3, 3, 0, 0]}>
              {chartData.map((d, i) => <Cell key={i} fill={d.rr >= 0 ? C.win : C.loss} fillOpacity={0.75} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Weekly table */}
      <div className="glass-panel" style={{ padding: "20px 22px" }}>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 14 }}>Weekly Breakdown</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 80px 80px 70px 60px 70px", gap: 0 }}>
          {/* Header */}
          {["Week","Trades","W/L/BE","WR","Avg RR","A/A+","Total RR"].map(h => (
            <div key={h} style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, padding: "4px 8px", borderBottom: `1px solid ${C.border}`, textAlign: h !== "Week" ? "right" : "left" }}>{h}</div>
          ))}
          {/* Rows */}
          {weeklyData.slice(0, 20).map((w, i) => {
            const avgRR = w.total ? (w.rr / w.total).toFixed(1) : "—";
            return (
              <React.Fragment key={w.key}>
                {[
                  <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: C.textMid, padding: "8px 8px", borderBottom: `1px solid ${C.border}` }}>{w.label}</div>,
                  <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: C.textMid, padding: "8px 8px", borderBottom: `1px solid ${C.border}`, textAlign: "right" }}>{w.total}</div>,
                  <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, padding: "8px 8px", borderBottom: `1px solid ${C.border}`, textAlign: "right" }}>
                    <span style={{ color: C.win }}>{w.wins}</span><span style={{ color: C.textLow }}>/</span>
                    <span style={{ color: C.loss }}>{w.losses}</span><span style={{ color: C.textLow }}>/</span>
                    <span style={{ color: C.be }}>{w.bes}</span>
                  </div>,
                  <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: w.wr != null ? (w.wr >= 50 ? C.win : C.loss) : C.textLow, padding: "8px 8px", borderBottom: `1px solid ${C.border}`, textAlign: "right" }}>{w.wr != null ? `${w.wr}%` : "—"}</div>,
                  <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: parseFloat(avgRR) > 0 ? C.win : parseFloat(avgRR) < 0 ? C.loss : C.textLow, padding: "8px 8px", borderBottom: `1px solid ${C.border}`, textAlign: "right" }}>{avgRR !== "—" ? `${parseFloat(avgRR) > 0 ? "+" : ""}${avgRR}R` : "—"}</div>,
                  <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: C.textMid, padding: "8px 8px", borderBottom: `1px solid ${C.border}`, textAlign: "right" }}>{w.gradeA}</div>,
                  <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 12, fontWeight: 700, color: w.rr >= 0 ? C.win : C.loss, padding: "8px 8px", borderBottom: `1px solid ${C.border}`, textAlign: "right" }}>{w.rr >= 0 ? "+" : ""}{w.rr}R</div>,
                ].map((cell, ci) => <React.Fragment key={ci}>{cell}</React.Fragment>)}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 5. MONTHLY RECAP
// ══════════════════════════════════════════════════════════════════
function MonthlyRecap({ trades }) {
  const monthlyData = useMemo(() => {
    const map = {};
    trades.forEach(t => {
      if (!t.datetime) return;
      const key = t.datetime.slice(0, 7);
      if (!map[key]) map[key] = { key, wins: 0, losses: 0, bes: 0, rr: 0, pnl: 0, trades: [], gradeAplus: 0, tm: 0 };
      map[key].trades.push(t);
      if (t.outcome === "Win") map[key].wins++;
      else if (t.outcome === "Loss") map[key].losses++;
      else map[key].bes++;
      map[key].rr += getTradeRR(t) || 0;
      const pnl = parseFloat(t.pnl_dollars);
      if (!isNaN(pnl)) map[key].pnl += pnl;
      if (t.setupGrade === "A+") map[key].gradeAplus++;
      if (t.trueManipulation) map[key].tm++;
    });
    return Object.values(map)
      .sort((a, b) => b.key.localeCompare(a.key))
      .map(m => {
        const [y, mo] = m.key.split("-");
        const label = `${MONTH_NAMES[parseInt(mo) - 1]} ${y}`;
        const total = m.wins + m.losses + m.bes;
        const wr = m.wins + m.losses > 0 ? Math.round(m.wins / (m.wins + m.losses) * 100) : null;
        const avgRR = total ? parseFloat((m.rr / total).toFixed(2)) : null;
        return { ...m, label, total, wr, avgRR, rr: parseFloat(m.rr.toFixed(2)) };
      });
  }, [trades]);

  const chartData = [...monthlyData].reverse();

  const best  = monthlyData.reduce((a, m) => m.rr > (a?.rr ?? -Infinity) ? m : a, null);
  const worst = monthlyData.reduce((a, m) => m.rr < (a?.rr ?? Infinity) ? m : a, null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Summary KPIs */}
      {monthlyData.length >= 2 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {[
            ["Months Tracked", monthlyData.length, C.textMid],
            ["Best Month", best ? `${best.rr >= 0 ? "+" : ""}${best.rr}R` : "—", C.win],
            ["Worst Month", worst ? `${worst.rr >= 0 ? "+" : ""}${worst.rr}R` : "—", C.loss],
            ["Avg Monthly RR", `${(monthlyData.reduce((a,m)=>a+m.rr,0)/monthlyData.length).toFixed(1)}R`, C.accent],
          ].map(([l, v, col]) => (
            <div key={l} className="glass-panel" style={{ padding: "14px 16px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, ${col}66, transparent)` }} />
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".1em" }}>{l}</div>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 20, fontWeight: 700, color: col }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Monthly bar chart */}
      <div className="glass-panel" style={{ padding: "22px 24px" }}>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 16 }}>Monthly RR Performance</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -8, bottom: 20 }}>
            <CartesianGrid strokeDasharray="2 6" stroke={C.border} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: C.textLow, fontSize: 9, fontFamily: "Inter Tight" }} axisLine={false} tickLine={false} angle={-35} textAnchor="end" interval={0} />
            <YAxis tick={{ fill: C.textLow, fontSize: 9, fontFamily: "Inter Tight" }} axisLine={false} tickLine={false} />
            <ReferenceLine y={0} stroke={C.borderMid} strokeWidth={1.5} />
            <Tooltip contentStyle={{ background: "#0F0F17", border: `1px solid ${C.borderMid}`, borderRadius: 8, color: C.text, fontSize: 11, fontFamily: "Inter Tight" }}
              formatter={(v, _, props) => {
                const d = props.payload;
                return [`${v >= 0 ? "+" : ""}${v}R  (${d.wr != null ? d.wr + "% WR · " : ""}${d.total}T)`, "Monthly"];
              }} />
            <Bar dataKey="rr" radius={[4, 4, 0, 0]}>
              {chartData.map((d, i) => <Cell key={i} fill={d.rr >= 0 ? C.win : C.loss} fillOpacity={0.75} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Monthly win rate trend */}
      <div className="glass-panel" style={{ padding: "20px 24px" }}>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 14 }}>Win Rate Trend · Month by Month</div>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={chartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 6" stroke={C.border} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: C.textLow, fontSize: 8, fontFamily: "Inter Tight" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: C.textLow, fontSize: 9, fontFamily: "Inter Tight" }} domain={[0, 100]} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
            <ReferenceLine y={50} stroke={C.be} strokeDasharray="4 4" opacity={0.5} />
            <Tooltip contentStyle={{ background: "#0F0F17", border: `1px solid ${C.borderMid}`, borderRadius: 8, color: C.text, fontSize: 11, fontFamily: "Inter Tight" }}
              formatter={(v) => [`${v}%`, "Win Rate"]} />
            <Line type="monotone" dataKey="wr" stroke={C.accent} strokeWidth={2} dot={{ r: 4, fill: C.accent, stroke: C.bg, strokeWidth: 2 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Monthly detail table */}
      <div className="glass-panel" style={{ padding: "20px 22px" }}>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 14 }}>Monthly Detail</div>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 700, display: "grid", gridTemplateColumns: "110px 60px 90px 65px 70px 55px 50px 80px 70px" }}>
            {["Month","Trades","W/L/BE","WR","Avg RR","A+","TM","Total RR","P&L"].map(h => (
              <div key={h} style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, padding: "4px 8px", borderBottom: `1px solid ${C.border}`, textAlign: h !== "Month" ? "right" : "left" }}>{h}</div>
            ))}
            {monthlyData.map((m) => {
              return (
                <React.Fragment key={m.key}>
                  {[
                    <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, fontWeight: 600, color: C.text, padding: "9px 8px", borderBottom: `1px solid ${C.border}` }}>{m.label}</div>,
                    <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: C.textMid, padding: "9px 8px", borderBottom: `1px solid ${C.border}`, textAlign: "right" }}>{m.total}</div>,
                    <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, padding: "9px 8px", borderBottom: `1px solid ${C.border}`, textAlign: "right" }}>
                      <span style={{ color: C.win }}>{m.wins}</span><span style={{ color: C.textLow }}>/</span>
                      <span style={{ color: C.loss }}>{m.losses}</span><span style={{ color: C.textLow }}>/</span>
                      <span style={{ color: C.be }}>{m.bes}</span>
                    </div>,
                    <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, fontWeight: 600, color: m.wr != null ? (m.wr >= 50 ? C.win : C.loss) : C.textLow, padding: "9px 8px", borderBottom: `1px solid ${C.border}`, textAlign: "right" }}>{m.wr != null ? `${m.wr}%` : "—"}</div>,
                    <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: m.avgRR != null ? (m.avgRR > 0 ? C.win : C.loss) : C.textLow, padding: "9px 8px", borderBottom: `1px solid ${C.border}`, textAlign: "right" }}>{m.avgRR != null ? `${m.avgRR > 0 ? "+" : ""}${m.avgRR}R` : "—"}</div>,
                    <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: C.textMid, padding: "9px 8px", borderBottom: `1px solid ${C.border}`, textAlign: "right" }}>{m.gradeAplus}</div>,
                    <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: C.textMid, padding: "9px 8px", borderBottom: `1px solid ${C.border}`, textAlign: "right" }}>{m.tm}</div>,
                    <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 13, fontWeight: 700, color: m.rr >= 0 ? C.win : C.loss, padding: "9px 8px", borderBottom: `1px solid ${C.border}`, textAlign: "right" }}>{m.rr >= 0 ? "+" : ""}{m.rr}R</div>,
                    <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 11, color: m.pnl >= 0 ? C.win : m.pnl < 0 ? C.loss : C.textLow, padding: "9px 8px", borderBottom: `1px solid ${C.border}`, textAlign: "right" }}>{m.pnl !== 0 ? `${m.pnl >= 0 ? "+" : ""}$${Math.abs(m.pnl).toLocaleString()}` : "—"}</div>,
                  ].map((cell, ci) => <React.Fragment key={ci}>{cell}</React.Fragment>)}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 6. SESSION DISTRIBUTION CHARTS
// ══════════════════════════════════════════════════════════════════
function SessionDistribution({ trades }) {
  const SESSIONS = ["London Open", "NY Open", "NY AM", "NY PM", "Asian", "Other"];
  const SESSION_COLORS = {
    "London Open": "#60A5FA",
    "NY Open":     "#34D399",
    "NY AM":       "#FBBF24",
    "NY PM":       "#A78BFA",
    "Asian":       "#F87171",
    "Other":       "#94A3B8",
  };

  const sessionStats = useMemo(() => {
    return SESSIONS.map(sess => {
      const st = trades.filter(t => t.session === sess);
      const wins   = st.filter(t => t.outcome === "Win").length;
      const losses = st.filter(t => t.outcome === "Loss").length;
      const bes    = st.filter(t => t.outcome === "BE").length;
      const rrList = st.map(t => getTradeRR(t)).filter(r => r !== null && !isNaN(r));
      const avgRR  = rrList.length ? parseFloat((rrList.reduce((a, b) => a + b, 0) / rrList.length).toFixed(2)) : null;
      const totalRR = parseFloat(rrList.reduce((a, b) => a + b, 0).toFixed(2));
      const wr = st.length ? Math.round(wins / st.length * 100) : null;
      return { sess, total: st.length, wins, losses, bes, wr, avgRR, totalRR, color: SESSION_COLORS[sess] };
    }).filter(s => s.total > 0);
  }, [trades]);

  const totalTrades = sessionStats.reduce((a, s) => a + s.total, 0);

  // Pie data
  const pieData = sessionStats.map(s => ({ name: s.sess, value: s.total, color: s.color }));

  // Radar data for multi-metric comparison
  const radarData = sessionStats.map(s => ({
    session: s.sess.replace(" ", "\n"),
    "Win Rate": s.wr ?? 0,
    "Avg RR x10": s.avgRR != null ? Math.max(0, s.avgRR * 10) : 0,
    "Volume": s.total,
  }));

  // Outcome stacked bar data
  const stackedData = sessionStats.map(s => ({
    name: s.sess,
    Wins: s.wins,
    Losses: s.losses,
    BE: s.bes,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Top KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
        {sessionStats.map(s => (
          <div key={s.sess} className="glass-panel" style={{ padding: "14px 16px", borderTop: `2px solid ${s.color}`, position: "relative" }}>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: s.color, textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 6 }}>
              {s.sess}
            </div>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 22, fontWeight: 700, color: s.wr != null ? (s.wr >= 50 ? C.win : C.loss) : C.textLow, lineHeight: 1, marginBottom: 4 }}>
              {s.wr != null ? `${s.wr}%` : "—"}
            </div>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: C.textLow }}>
              {s.total}T · {s.avgRR != null ? `${s.avgRR > 0 ? "+" : ""}${s.avgRR}R avg` : "—"}
            </div>
            {/* Win bar */}
            <div style={{ marginTop: 8, height: 3, background: C.border, borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${s.wr ?? 0}%`, background: s.color, opacity: 0.8, borderRadius: 2, transition: "width .5s" }} />
            </div>
          </div>
        ))}
      </div>

      {/* Pie + stacked bar side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14 }}>
        {/* Volume Pie */}
        <div className="glass-panel" style={{ padding: "20px 22px" }}>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 14 }}>Trade Volume by Session</div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                {pieData.map((d, i) => <Cell key={i} fill={d.color} opacity={0.85} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "#0F0F17", border: `1px solid ${C.borderMid}`, borderRadius: 8, fontSize: 11, fontFamily: "Inter Tight", color: C.text }}
                formatter={(v, n) => [`${v} trades (${Math.round(v/totalTrades*100)}%)`, n]} />
            </PieChart>
          </ResponsiveContainer>
          {/* Legend */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
            {sessionStats.map(s => (
              <div key={s.sess} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                  <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textMid }}>{s.sess}</span>
                </div>
                <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow }}>{Math.round(s.total / totalTrades * 100)}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stacked outcome bars */}
        <div className="glass-panel" style={{ padding: "20px 22px" }}>
          <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 14 }}>Win / Loss / BE by Session</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stackedData} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 6" stroke={C.border} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: C.textLow, fontSize: 9, fontFamily: "Inter Tight" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.textLow, fontSize: 9, fontFamily: "Inter Tight" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "#0F0F17", border: `1px solid ${C.borderMid}`, borderRadius: 8, color: C.text, fontSize: 11, fontFamily: "Inter Tight" }} />
              <Bar dataKey="Wins"   stackId="a" fill={C.win}  fillOpacity={0.8} radius={[0,0,0,0]} />
              <Bar dataKey="BE"     stackId="a" fill={C.be}   fillOpacity={0.75} />
              <Bar dataKey="Losses" stackId="a" fill={C.loss} fillOpacity={0.8} radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          {/* Legend */}
          <div style={{ display: "flex", gap: 16, marginTop: 8, justifyContent: "center" }}>
            {[["Wins", C.win], ["BE", C.be], ["Losses", C.loss]].map(([l, c]) => (
              <div key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: c, opacity: 0.8 }} />
                <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textMid }}>{l}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Session RR comparison */}
      <div className="glass-panel" style={{ padding: "20px 24px" }}>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 14 }}>Total RR by Session</div>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={sessionStats} layout="vertical" margin={{ top: 0, right: 20, left: 80, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 6" stroke={C.border} horizontal={false} />
            <XAxis type="number" tick={{ fill: C.textLow, fontSize: 9, fontFamily: "Inter Tight" }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="sess" tick={{ fill: C.textMid, fontSize: 10, fontFamily: "Inter Tight" }} axisLine={false} tickLine={false} width={78} />
            <ReferenceLine x={0} stroke={C.borderMid} strokeWidth={1.5} />
            <Tooltip contentStyle={{ background: "#0F0F17", border: `1px solid ${C.borderMid}`, borderRadius: 8, color: C.text, fontSize: 11, fontFamily: "Inter Tight" }}
              formatter={(v) => [`${v >= 0 ? "+" : ""}${v}R`, "Total RR"]} />
            <Bar dataKey="totalRR" radius={[0, 3, 3, 0]}>
              {sessionStats.map((s, i) => <Cell key={i} fill={s.totalRR >= 0 ? s.color : C.loss} fillOpacity={0.8} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Avg RR comparison */}
      <div className="glass-panel" style={{ padding: "20px 24px" }}>
        <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 14 }}>Average RR per Trade by Session</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sessionStats.sort((a,b) => (b.avgRR ?? -99) - (a.avgRR ?? -99)).map(s => {
            const maxAvg = Math.max(...sessionStats.map(x => Math.abs(x.avgRR ?? 0)), 0.1);
            return (
              <div key={s.sess} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: s.color, width: 90, flexShrink: 0 }}>{s.sess}</div>
                <div style={{ flex: 1, height: 22, background: C.bg, borderRadius: 4, overflow: "hidden", position: "relative", border: `1px solid ${C.border}` }}>
                  {s.avgRR != null && (
                    <div style={{
                      position: "absolute",
                      top: 0, bottom: 0,
                      left: s.avgRR >= 0 ? "50%" : `${50 - Math.abs(s.avgRR) / maxAvg * 45}%`,
                      width: `${Math.abs(s.avgRR) / maxAvg * 45}%`,
                      background: `${s.avgRR >= 0 ? s.color : C.loss}99`,
                      borderRadius: 3,
                      transition: "width .6s ease",
                    }} />
                  )}
                  <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: C.borderMid, opacity: 0.5 }} />
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", paddingLeft: 8 }}>
                    <span style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 10, color: s.avgRR != null ? (s.avgRR >= 0 ? s.color : C.loss) : C.textLow, fontWeight: 600 }}>
                      {s.avgRR != null ? `${s.avgRR > 0 ? "+" : ""}${s.avgRR}R` : "—"}
                    </span>
                  </div>
                </div>
                <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 9, color: C.textLow, width: 24, textAlign: "right" }}>{s.total}T</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
