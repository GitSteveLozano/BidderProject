/* Operating Intelligence Dashboard — Zones + Agenda */

const { useState: useStateD, useMemo: useMemoD } = React;

function Dashboard({ payroll, segment, dataState, vocab, onOpenNew, onNav }) {
  if (dataState === "cold-start") return <DashEmpty vocab={vocab} onOpenNew={onOpenNew} />;
  return <DashZones payroll={payroll} segment={segment} dataState={dataState} vocab={vocab} onOpenNew={onOpenNew} onNav={onNav} />;
}

/* ============ EMPTY STATE — cold-start ============ */
function DashEmpty({ vocab, onOpenNew }) {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", paddingTop: 48 }}>
      <div className="eyebrow">Monday, May 11 · Week 19</div>
      <h1 className="h-display" style={{ fontSize: 48, lineHeight: 1.04, marginTop: 10, marginBottom: 18 }}>
        {vocab.emptyDashH1.replace(/, /, ", ").split(", ")[0]}
        <span style={{ display: "block" }}>
          <span className="italic" style={{ color: "var(--accent)" }}>
            {vocab.emptyDashH1.split(", ")[1]}
          </span>
        </span>
      </h1>
      <p style={{ fontFamily: "var(--font-serif)", fontSize: 18, lineHeight: 1.6, color: "var(--ink-2)", maxWidth: 560, marginBottom: 24 }}>
        {vocab.emptyDashBody}
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 36 }}>
        <button className="btn btn--accent btn--lg" onClick={onOpenNew}>
          <IcZap size={14} /> Make your first {vocab.workWord}
        </button>
        <span className="muted mono" style={{ fontSize: 11 }}>~10 minutes</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, borderTop: "1px solid var(--line)", paddingTop: 24 }}>
        <EmptyHint
          eyebrow="What lives here"
          title={`A ledger of what needs you`}
          body={`Open ${vocab.workWordPl}, waiting clients, jobs mid-flight — sorted by what's most overdue, not what's most recent.`}
        />
        <EmptyHint
          eyebrow="What Brief learns"
          title="Your shape of work"
          body={`After a handful of ${vocab.workWordPl}, Brief calibrates: typical ${vocab.jobWord} size, win rate by segment, when margins slip and why.`}
        />
        <EmptyHint
          eyebrow="What it won't do"
          title="Decide for you"
          body={`Brief proposes — sends drafts to review, drafts follow-ups, drafts pricing. Sign-off is always yours.`}
        />
      </div>
    </div>
  );
}

function EmptyHint({ eyebrow, title, body }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</div>
      <h3 className="h-section" style={{ fontSize: 15, marginBottom: 6 }}>{title}</h3>
      <p className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>{body}</p>
    </div>
  );
}

/* ============ KPI / data helpers — derived live ============ */
function deriveKpis() {
  const active = SAMPLE_QUOTES.filter(q => ["DRAFT","SENT","AWAITING","RESPONDED"].includes(q.state));
  const bidValue = active.reduce((s,q) => s + q.total, 0);
  const closed = SAMPLE_QUOTES.filter(q => ["WON","LOST"].includes(q.state));
  const won = SAMPLE_QUOTES.filter(q => q.state === "WON");
  const winrate = closed.length ? Math.round((won.length / closed.length) * 100) : 0;
  return { active, bidValue, closed, won, winrate };
}

function nextActions(segment, vocab) {
  return SAMPLE_QUOTES
    .filter(q => ["RESPONDED","AWAITING","DRAFT"].includes(q.state))
    .slice(0, 4)
    .map((q, i) => ({
      id: q.id,
      urgency: q.state === "RESPONDED" ? "high" : q.state === "AWAITING" ? "med" : "low",
      title: q.nextStep || `${q.client} · ${q.project}`,
      sub: `${q.id} · ${STATE_LABELS[q.state].label} · ${q.client}`,
      action: q.state === "RESPONDED" ? "Reply" : q.state === "AWAITING" ? "Nudge" : "Review",
      who: q.contact.split(" ").map(w => w[0]).slice(0,2).join(""),
      quoteId: q.id,
    }));
}

/* ============ LAYOUT 1: Zones ============ */
function DashZones({ payroll, segment, dataState, vocab, onOpenNew, onNav }) {
  const k = deriveKpis();
  const KPIS = [
    { lbl: `${vocab.workWordCap} value out`, val: moneyK(k.bidValue), delta: dataState === "seeded" ? "—" : "+18%", tone: "up", hint: `${k.active.length} active ${vocab.workWordPl}` },
    { lbl: "Win rate · 90d", val: dataState === "seeded" ? "—" : k.winrate + "%", delta: dataState === "seeded" ? "calibrating" : "+4 pts", tone: "up", hint: dataState === "seeded" ? "needs ≥6 closed" : "vs 64% trailing" },
    { lbl: `Avg ${vocab.workWord} → sign`, val: dataState === "seeded" ? "—" : "4.3d", delta: dataState === "seeded" ? "calibrating" : "−1.1d", tone: "up", hint: dataState === "seeded" ? "needs ≥10 sent" : "down from 5.4d" },
    { lbl: "Margin on closed", val: dataState === "seeded" ? "—" : "32.4%", delta: dataState === "seeded" ? "—" : "−1.2 pts", tone: "dn", hint: dataState === "seeded" ? "needs closed jobs" : "Ridgemoor went over" },
  ];

  return (
    <div>
      <DashHeader vocab={vocab} onOpenNew={onOpenNew} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 18 }}>
        {KPIS.map((kpi, i) => (
          <div key={i} className="card" style={{ padding: 18 }}>
            <div className="kpi">
              <div className="kpi__lbl">{kpi.lbl}</div>
              <div className="kpi__val">{kpi.val}</div>
              <div className="row" style={{ gap: 8, marginTop: 2 }}>
                <span className={`kpi__delta ${kpi.tone === "up" ? "kpi__delta--up" : "kpi__delta--dn"}`}>
                  {kpi.delta !== "calibrating" && kpi.delta !== "—" && (kpi.tone === "up" ? <IcTrending size={11} /> : <IcTrendingDn size={11} />)}
                  {kpi.delta}
                </span>
                <span className="muted" style={{ fontSize: 11 }}>{kpi.hint}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <PipelineWidget vocab={vocab} onNav={onNav} dataState={dataState} />
          <FunnelWidget dataState={dataState} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <NextActionsCard segment={segment} vocab={vocab} onOpenNew={onOpenNew} />
          <CapacityCard payroll={payroll} vocab={vocab} />
          {payroll && SAMPLE_JOBS.some(j => j.status === "INPROGRESS") && <ReconAlertCard />}
        </div>
      </div>
    </div>
  );
}

function DashHeader({ vocab, onOpenNew }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 24, gap: 14 }}>
      <div>
        <div className="eyebrow">Monday, May 11 · Week 19</div>
        <h1 className="h-page" style={{ marginTop: 6 }}>
          Morning, <span className="italic">{vocab.ownerFirst}.</span>
        </h1>
      </div>
      <div className="space" />
      <button className="btn"><IcRefresh size={12} /> Refresh</button>
      <button className="btn btn--accent" onClick={onOpenNew}>
        <IcPlus size={13} /> {vocab.newCta}
      </button>
    </div>
  );
}

function PipelineWidget({ vocab, onNav, dataState }) {
  const groups = ["DRAFT","SENT","AWAITING","RESPONDED"].map(k => ({
    k,
    label: STATE_LABELS[k].label,
    items: SAMPLE_QUOTES.filter(q => q.state === k),
  })).map(g => ({ ...g, v: g.items.reduce((s,q) => s + q.total, 0), n: g.items.length }));

  const total = groups.reduce((s, x) => s + x.v, 0) || 1;
  const empty = total === 0;

  return (
    <div className="card">
      <div className="card__hd">
        <h3>Pipeline value</h3>
        <button className="btn btn--ghost btn--sm" style={{ marginLeft: "auto" }} onClick={() => onNav("quotes")}>
          See all <IcArrowRight size={11} />
        </button>
      </div>
      <div className="card__body">
        <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 14, background: "var(--bg-2)" }}>
          {!empty && groups.map((s, i) => {
            const colors = ["var(--muted-2)", "var(--info)", "var(--warn)", "var(--accent)"];
            return <div key={i} style={{ width: (s.v / total) * 100 + "%", background: colors[i], opacity: 0.85 }} />;
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {groups.map((s, i) => (
            <div key={s.k}>
              <StatusPill state={s.k} />
              <div className="num" style={{ fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 500, marginTop: 8 }}>
                {s.v ? moneyK(s.v) : "—"}
              </div>
              <div className="muted mono" style={{ fontSize: 10.5, marginTop: 2 }}>{s.n} {s.n === 1 ? vocab.workWord : vocab.workWordPl}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FunnelWidget({ dataState }) {
  if (dataState === "seeded") {
    return (
      <div className="card">
        <div className="card__hd">
          <h3>Last 90 days</h3>
          <span className="muted mono" style={{ fontSize: 11, marginLeft: "auto" }}>Conversion funnel</span>
        </div>
        <div className="card__body">
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.55, fontStyle: "italic", fontFamily: "var(--font-serif)" }}>
            Brief needs a few more closed cycles before drawing a funnel — three sent doesn't say much. Check back after ten.
          </p>
        </div>
      </div>
    );
  }
  const steps = [
    { label: "Bids sent", n: 31, w: 100 },
    { label: "Opened", n: 27, w: 87 },
    { label: "Responded", n: 18, w: 58 },
    { label: "Won", n: 14, w: 45 },
  ];
  return (
    <div className="card">
      <div className="card__hd">
        <h3>Last 90 days</h3>
        <span className="muted mono" style={{ fontSize: 11, marginLeft: "auto" }}>Conversion funnel</span>
      </div>
      <div className="card__body">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 80, fontSize: 12.5 }}>{s.label}</div>
              <div style={{ flex: 1, position: "relative", height: 26, background: "var(--bg-2)", borderRadius: 4 }}>
                <div style={{
                  position: "absolute", inset: 0,
                  width: s.w + "%",
                  background: i === steps.length - 1 ? "var(--accent)" : "var(--accent-tint)",
                  borderRadius: 4,
                  transition: "width 1s ease",
                }} />
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", padding: "0 10px" }}>
                  <span className="num" style={{ fontSize: 12, fontWeight: 500, color: i === steps.length - 1 ? "var(--accent-ink)" : "var(--ink)" }}>
                    {s.n}
                  </span>
                </div>
              </div>
              <span className="muted mono" style={{ fontSize: 11, width: 40, textAlign: "right" }}>{s.w}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NextActionsCard({ segment, vocab, onOpenNew }) {
  const items = nextActions(segment, vocab);
  return (
    <div className="card">
      <div className="card__hd">
        <IcZap size={14} style={{ color: "var(--accent)" }} />
        <h3>What needs you today</h3>
      </div>
      <div className="card__body" style={{ padding: 0 }}>
        {items.length === 0 ? (
          <div style={{ padding: 22 }}>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.55, fontStyle: "italic", fontFamily: "var(--font-serif)", margin: 0 }}>
              Nothing waiting on you. Quiet days are good days. Use this window to draft your next {vocab.workWord}.
            </p>
            <button className="btn btn--sm" style={{ marginTop: 12 }} onClick={onOpenNew}>
              <IcPlus size={11} /> {vocab.newCta}
            </button>
          </div>
        ) : items.map((a, i) => (
          <div key={a.id} style={{
            padding: "12px 18px",
            borderBottom: i < items.length - 1 ? "1px solid var(--line)" : "0",
            display: "flex", alignItems: "flex-start", gap: 12,
          }}>
            <div className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>{a.who}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 2, lineHeight: 1.35 }}>{a.title}</div>
              <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.4 }}>{a.sub}</div>
            </div>
            <button className="btn btn--sm" style={a.urgency === "high" ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)" } : {}}>
              {a.action}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CapacityCard({ payroll, vocab }) {
  const booked = COMPANY.bookedHrs;
  const cap = COMPANY.monthlyCapacityHrs;
  const pct = (booked / cap) * 100;
  return (
    <div className="card">
      <div className="card__hd">
        <IcUsers size={14} className="muted" />
        <h3>{vocab.capacityNoun} · May</h3>
        {payroll && <span className="pill pill--won" style={{ marginLeft: "auto", fontSize: 10 }}>Live</span>}
      </div>
      <div className="card__body">
        {payroll ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <span className="num" style={{ fontFamily: "var(--font-serif)", fontSize: 28, fontWeight: 500 }}>
                {booked}<span style={{ fontSize: 14, color: "var(--muted)" }}> / {cap} hrs</span>
              </span>
              <span className="muted mono" style={{ fontSize: 11 }}>{pct.toFixed(0)}% booked</span>
            </div>
            <div style={{ height: 8, background: "var(--bg-2)", borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
              <div style={{ height: "100%", width: pct + "%", background: "var(--accent)" }} />
            </div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              {cap - booked} hrs unbooked. Capacity-aware pricing is <strong style={{ color: "var(--good)" }}>on</strong> — large bids will float +4% margin during peak weeks.
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 14, color: "var(--muted)" }}>
              Brief can't suggest capacity-aware pricing without payroll data. Without it, big bids may be priced too cheap during busy weeks.
            </div>
            <button className="btn" style={{ width: "100%" }}>
              <IcLink size={12} /> Connect ProService Hawaii
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ReconAlertCard() {
  const job = SAMPLE_JOBS.find(j => j.status === "INPROGRESS");
  if (!job) return null;
  return (
    <div className="card" style={{ borderColor: "var(--good)" }}>
      <div className="card__body" style={{ display: "flex", gap: 12 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: "var(--good-tint)", color: "var(--good)",
          display: "grid", placeItems: "center", flexShrink: 0,
        }}>
          <IcTrending size={18} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 4 }}>{job.name} is ahead of plan</div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>
            Labor {(job.quotedLaborHrs - job.actualLaborHrs)} hrs under. Projected margin <strong style={{ color: "var(--good)" }}>{job.projectedMargin}%</strong> vs <span>{job.margin}% quoted</span>.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ LAYOUT 2: Agenda ============ */
function DashAgenda({ payroll, segment, dataState, vocab, onOpenNew, onNav }) {
  const items = nextActions(segment, vocab).map((a, i) => ({
    time: ["8:30","10:00","11:30","14:00"][i] || "—",
    title: a.title,
    sub: a.sub,
    min: [10, 15, 5, 30][i] || 10,
    urg: a.urgency,
    who: a.who,
  }));

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <DashHeader vocab={vocab} onOpenNew={onOpenNew} />

      <div className="card" style={{ marginBottom: 14, background: "var(--surface-2)" }}>
        <div className="card__body" style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <IcCalendar size={28} className="muted" />
          <div style={{ flex: 1 }}>
            <div className="eyebrow">Monday's plan</div>
            <div className="h-section" style={{ fontSize: 18, marginTop: 2 }}>
              {items.length} item{items.length !== 1 ? "s" : ""} · ~{items.reduce((s,i)=>s+i.min,0)} minutes if you stay focused
            </div>
          </div>
          <button className="btn btn--sm"><IcCheck size={11} /> Snooze all</button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="card" style={{ padding: 24 }}>
          <p className="muted" style={{ fontFamily: "var(--font-serif)", fontSize: 14, fontStyle: "italic", lineHeight: 1.6, margin: 0 }}>
            Nothing scheduled for today. {vocab.ownerFirst}, this is rare — use it.
          </p>
        </div>
      ) : items.map((row, i) => (
        <div key={i} className="card" style={{
          marginBottom: 8, padding: 14,
          borderLeft: `3px solid ${row.urg === "high" ? "var(--accent)" : row.urg === "med" ? "var(--warn)" : "var(--line-strong)"}`,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div style={{ width: 56, textAlign: "right", flexShrink: 0 }}>
              <div className="num" style={{ fontFamily: "var(--font-serif)", fontSize: 18, fontWeight: 500 }}>{row.time}</div>
              <div className="muted mono" style={{ fontSize: 10 }}>~{row.min}m</div>
            </div>
            <div className="avatar" style={{ marginTop: 2 }}>{row.who}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: 14, lineHeight: 1.35 }}>{row.title}</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.45 }}>{row.sub}</div>
            </div>
            <button className="btn btn--sm">Open</button>
          </div>
        </div>
      ))}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 18 }}>
        <div className="card" style={{ padding: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>This week</div>
          <div className="num" style={{ fontFamily: "var(--font-serif)", fontSize: 24, fontWeight: 500 }}>
            {moneyK(deriveKpis().bidValue)}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>in pipeline · {deriveKpis().active.length} active {vocab.workWordPl}</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Win rate · 90d</div>
          <div className="num" style={{ fontFamily: "var(--font-serif)", fontSize: 24, fontWeight: 500, color: dataState === "seeded" ? "var(--muted)" : "var(--good)" }}>
            {dataState === "seeded" ? "—" : deriveKpis().winrate + "%"}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>{dataState === "seeded" ? "calibrating — needs more closed" : "up 4 points · keep it going"}</div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Dashboard });
