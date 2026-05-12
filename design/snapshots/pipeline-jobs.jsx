/* Pipeline (quotes lifecycle), Jobs (with cost reconciliation), Clients, Settings */

const { useState: useStateP, useMemo: useMemoP } = React;

/* ============ Empty-state shared component ============ */
function EmptyState({ eyebrow, headline, body, ctaLabel, ctaIcon, onCta, secondary }) {
  return (
    <div className="card" style={{ padding: "56px 40px", maxWidth: 720 }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>{eyebrow}</div>
      <h2 className="h-display" style={{ fontSize: 32, lineHeight: 1.1, marginBottom: 14, maxWidth: 520 }}>
        {headline}
      </h2>
      <p style={{ fontFamily: "var(--font-serif)", fontSize: 16.5, lineHeight: 1.65, color: "var(--ink-2)", maxWidth: 540, marginBottom: 24 }}>
        {body}
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {ctaLabel && (
          <button className="btn btn--accent btn--lg" onClick={onCta}>
            {ctaIcon} {ctaLabel}
          </button>
        )}
        {secondary && <span className="muted mono" style={{ fontSize: 11 }}>{secondary}</span>}
      </div>
    </div>
  );
}

/* ============ Pipeline ============ */
/* Default view is now Agenda (next-action-grouped). Kanban dropped —
   stages don't reflect operator agency; clients move quotes, not you.
   Table view remains for power use. */
function Pipeline({ onOpenNew, segment, dataState, vocab, quiet }) {
  const [view, setView] = useStateP("agenda");

  if (dataState === "cold-start") {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 24, gap: 14 }}>
          <div>
            <div className="eyebrow">Pipeline</div>
            <h1 className="h-page" style={{ marginTop: 6 }}>{vocab.pipelineHeadline}</h1>
          </div>
        </div>
        <EmptyState
          eyebrow="Pipeline · empty"
          headline={vocab.emptyQuotesH1}
          body={vocab.emptyQuotesBody}
          ctaLabel={vocab.newCta}
          ctaIcon={<IcPlus size={14} />}
          onCta={onOpenNew}
          secondary="~10 minutes start to send"
        />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 20, gap: 14 }}>
        <div>
          <div className="eyebrow">Pipeline</div>
          <h1 className="h-page" style={{ marginTop: 6 }}>{vocab.pipelineHeadline}</h1>
        </div>
        <div className="space" />
        <div style={{ display: "flex", background: "var(--surface)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-2)", padding: 2 }}>
          <button onClick={() => setView("agenda")} style={{ padding: "5px 12px", borderRadius: 5, background: view === "agenda" ? "var(--bg-2)" : "transparent", fontSize: 12.5, fontWeight: view === "agenda" ? 500 : 400 }}>
            Agenda
          </button>
          <button onClick={() => setView("table")} style={{ padding: "5px 12px", borderRadius: 5, background: view === "table" ? "var(--bg-2)" : "transparent", fontSize: 12.5, fontWeight: view === "table" ? 500 : 400 }}>
            Table
          </button>
        </div>
        <button className="btn btn--accent" onClick={onOpenNew}>
          <IcPlus size={13} /> {vocab.newCta}
        </button>
      </div>

      <PipelineStrip vocab={vocab} />

      {view === "agenda" ? <PipelineAgenda vocab={vocab} segment={segment} quiet={quiet} /> : <PipelineList quotes={SAMPLE_QUOTES} />}
    </div>
  );
}

/* Thin stacked-bar strip — stage volume at a glance. */
function PipelineStrip({ vocab }) {
  const stages = [
    { key: "DRAFT", label: "Draft", color: "var(--muted-2)" },
    { key: "SENT", label: "Sent", color: "var(--info)" },
    { key: "AWAITING", label: "Awaiting", color: "var(--warn)" },
    { key: "RESPONDED", label: "In convo", color: "var(--accent)" },
  ];
  const data = stages.map((s) => {
    const items = SAMPLE_QUOTES.filter((q) => q.state === s.key);
    return { ...s, n: items.length, v: items.reduce((a, q) => a + q.total, 0) };
  });
  const total = data.reduce((a, s) => a + s.v, 0) || 1;
  const totalN = data.reduce((a, s) => a + s.n, 0);
  const won = SAMPLE_QUOTES.filter((q) => q.state === "WON").length;
  const lost = SAMPLE_QUOTES.filter((q) => q.state === "LOST").length;

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
        <span className="eyebrow">In flight</span>
        <span className="num" style={{ fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 500 }}>{moneyK(total)}</span>
        <span className="muted mono" style={{ fontSize: 11 }}>across {totalN} {totalN === 1 ? vocab.workWord : vocab.workWordPl}</span>
        <div className="space" />
        <span className="muted mono" style={{ fontSize: 11 }}>Decided · {won} won · {lost} lost</span>
      </div>
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--bg-2)" }}>
        {data.map((s) => s.v > 0 && (
          <div key={s.key} style={{ width: (s.v / total) * 100 + "%", background: s.color }} title={`${s.label}: ${s.n}`} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 8 }}>
        {data.map((s) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: "inline-block" }} />
            <span style={{ fontSize: 11.5 }}>{s.label}</span>
            <span className="mono muted" style={{ fontSize: 11 }}>{s.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Agenda — grouped by urgency, time-ordered within. */
function PipelineAgenda({ vocab, segment, quiet }) {
  const [drawer, setDrawer] = useStateP(null); // { quote, mode: 'reply'|'nudge' }
  const today = quiet ? [] : SAMPLE_QUOTES.filter((q) => q.state === "RESPONDED" || (q.state === "AWAITING" && q.age >= 5) || (q.state === "DRAFT" && q.age >= 1));
  const thisWeek = quiet ? [] : SAMPLE_QUOTES.filter((q) => (q.state === "AWAITING" && q.age < 5) || (q.state === "SENT" && q.age >= 2));
  const cooling = quiet ? [] : SAMPLE_QUOTES.filter((q) => q.state === "AWAITING" && q.age >= 14);
  const later = quiet ? [] : SAMPLE_QUOTES.filter((q) => q.state === "SENT" && q.age < 2);
  const decided = SAMPLE_QUOTES.filter((q) => ["WON", "LOST"].includes(q.state));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <AgendaGroup title="Today" subtitle="Reply or nudge — these are blocking on you" tone="high" quotes={today} vocab={vocab} onAction={setDrawer} />
      <AgendaGroup title="This week" subtitle="Check in if no movement by Friday" tone="med" quotes={thisWeek} vocab={vocab} onAction={setDrawer} />
      {cooling.length > 0 && <AgendaGroup title="Cooling off" subtitle="No movement in 2+ weeks — try a different angle or close the loop" tone="warn" quotes={cooling} vocab={vocab} onAction={setDrawer} />}
      <AgendaGroup title="Later" subtitle="Sent recently — give it a beat before chasing" tone="low" quotes={later} vocab={vocab} onAction={setDrawer} />
      <AgendaGroup title="Decided" subtitle={`${decided.filter(q=>q.state==="WON").length} won · ${decided.filter(q=>q.state==="LOST").length} lost`} tone="done" quotes={decided} vocab={vocab} onAction={setDrawer} collapsed />
      {drawer && <ReplyDrawer quote={drawer.quote} mode={drawer.mode} vocab={vocab} onClose={() => setDrawer(null)} />}
    </div>
  );
}

function AgendaGroup({ title, subtitle, tone, quotes, vocab, onAction, collapsed }) {
  const [open, setOpen] = useStateP(!collapsed);
  const empty = quotes.length === 0;
  const toneBar = { high: "var(--accent)", med: "var(--info)", warn: "var(--warn)", low: "var(--line-strong)", done: "var(--muted-2)" }[tone];

  return (
    <div>
      <button onClick={() => setOpen(!open)} style={{
        display: "flex", alignItems: "baseline", width: "100%",
        gap: 12, padding: "6px 4px", marginBottom: 8,
        background: "transparent", border: 0, cursor: "pointer", textAlign: "left",
      }}>
        <span style={{ width: 3, alignSelf: "stretch", background: toneBar, borderRadius: 2 }} />
        <span style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 18 }}>{title}</span>
        <span className="mono muted" style={{ fontSize: 12 }}>{quotes.length}</span>
        <span className="muted" style={{ fontSize: 12.5, fontStyle: "italic" }}>{subtitle}</span>
        <div className="space" />
        <IcChevronDown size={12} className="muted" style={{ transform: open ? "" : "rotate(-90deg)", transition: "transform 0.15s" }} />
      </button>

      {open && (empty ? (
        <div className="muted" style={{ fontSize: 12.5, fontFamily: "var(--font-serif)", fontStyle: "italic", padding: "4px 16px 8px" }}>
          Nothing here. Quiet is good.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {quotes.map((q, i) => <AgendaRow key={q.id} q={q} vocab={vocab} last={i === quotes.length - 1} tone={tone} onAction={onAction} />)}
        </div>
      ))}
    </div>
  );
}

/* Best send-time chip — demo logic uses simple heuristics so it can fake-evolve. */
function sendWindow(q) {
  if (q.state === "RESPONDED") return "Send now";
  if (q.state === "AWAITING" && q.age >= 7) return "Send 9 AM tomorrow";
  if (q.state === "AWAITING") return "Send Tue 9 AM";
  if (q.state === "DRAFT") return "Review & send";
  if (q.state === "SENT") return "Open";
  return "Open";
}

function AgendaRow({ q, vocab, last, tone, onAction }) {
  const decided = q.state === "WON" || q.state === "LOST";
  const actionLabel = q.state === "RESPONDED" ? "Reply"
                    : q.state === "AWAITING" ? "Nudge"
                    : q.state === "DRAFT" ? "Review & send"
                    : q.state === "SENT" ? "Open"
                    : "Open";
  const accent = tone === "high";
  const handleAction = () => {
    if (decided) return;
    const mode = q.state === "RESPONDED" ? "reply" : q.state === "AWAITING" ? "nudge" : "open";
    if (mode === "open") return;
    onAction && onAction({ quote: q, mode });
  };
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "14px 18px",
      borderBottom: last ? "0" : "1px solid var(--line)",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <StatusPill state={q.state} />
          <span style={{ fontWeight: 500, fontSize: 14 }}>{q.client}</span>
          <span className="muted mono" style={{ fontSize: 10.5 }}>{q.id}</span>
          {q.relationship === "repeat" && <span className="muted" style={{ fontSize: 10.5, fontStyle: "italic" }}>· repeat</span>}
        </div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.4, marginBottom: decided ? 0 : 4 }}>{q.project}</div>
        {!decided && q.nextStep && (
          <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--ink-2)", display: "flex", alignItems: "flex-start", gap: 6 }}>
            <span className="mono" style={{ fontSize: 10, color: "var(--muted)", paddingTop: 2 }}>NEXT</span>
            <span style={{ flex: 1, fontStyle: "italic", fontFamily: "var(--font-serif)" }}>{q.nextStep}</span>
          </div>
        )}
        {decided && (
          <div className="muted" style={{ fontSize: 12, fontStyle: "italic" }}>
            {q.state === "WON" ? `Won ${q.won} · ${q.nextStep || ""}` : (q.nextStep || "Lost")}
          </div>
        )}
      </div>
      <div style={{ textAlign: "right", flexShrink: 0, width: 90 }}>
        <div className="num" style={{ fontFamily: "var(--font-serif)", fontSize: 17, fontWeight: 500 }}>{moneyK(q.total)}</div>
        <div className="muted mono" style={{ fontSize: 10.5 }}>{q.age === 0 ? "today" : `${q.age}d`}</div>
      </div>
      {!decided && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
          <button className="btn btn--sm" onClick={handleAction} style={accent ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)" } : {}}>
            {actionLabel}
          </button>
          {q.state !== "DRAFT" && q.state !== "SENT" && (
            <span className="muted mono" style={{ fontSize: 10 }}>· {sendWindow(q)}</span>
          )}
        </div>
      )}
    </div>
  );
}

/* ============ Reply / Nudge slide-over drawer ============ */
function ReplyDrawer({ quote, mode, vocab, onClose }) {
  const isReply = mode === "reply";
  const isNudge = mode === "nudge";

  // Demo content; in production these come from Brief's draft model.
  const lastClientMsg = isReply
    ? `"Hi ${vocab.ownerFirst} — we walked the property again on Sat. Could you do the smoother sand-float finish on the front elevation? Same scope otherwise. — Diane"`
    : null;

  const draftSubject = isReply
    ? `Re: ${quote.project} — ${quote.client}`
    : `Quick check-in on the ${quote.project.split(" — ")[0]} bid`;

  const draftBody = isReply ? (
`${quote.contact?.split(" ")[0] || "Hi"} —

Yes, easy swap to a smoother sand-float on the front elevation. I did the same finish on the Ridgemoor garage last spring — you'll like how it reads in late-afternoon light. No price change; same prep, same hours.

If the rest of the scope still looks right, I can lock the start for the week of May 27. Send a one-line confirm and I'll book the ${vocab.crewWord}.

— ${vocab.ownerFirst}`
  ) : (
`${quote.contact?.split(" ")[0] || "Hi"} —

Following up on the bid I sent ${quote.sent}. No pressure — just wanted to check whether the scope still lines up with what you had in mind, or if there's anything I should sharpen before you decide. Happy to walk through it on a call if useful.

— ${vocab.ownerFirst}`
  );

  const reasoning = isReply
    ? `Diane asked specifically about the sand-float finish. I referenced the Ridgemoor garage where you'd done that exact finish for her before — keeps the answer concrete instead of abstract.`
    : `${quote.contact?.split(" ")[0]} read the PDF on the day it landed but hasn't opened it since. ${quote.age} days is long enough that a low-pressure check-in is appropriate. Tone kept soft — no hard close.`;

  const sendWhen = isReply ? "Send now" : "Tomorrow, 9:10 AM";
  const sendWhy = isReply ? "Diane just messaged — fastest response wins." : "Your Tuesday morning open-rate window is highest. You have a site visit at 10:30.";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      display: "flex", justifyContent: "flex-end",
      background: "rgba(0,0,0,0.32)",
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(560px, 92vw)", height: "100%",
        background: "var(--bg)", borderLeft: "1px solid var(--line-strong)",
        display: "flex", flexDirection: "column",
        boxShadow: "-12px 0 32px rgba(0,0,0,0.18)",
        overflow: "auto",
      }}>
        <div style={{
          padding: "18px 22px", borderBottom: "1px solid var(--line)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{ flex: 1 }}>
            <div className="eyebrow">{isReply ? "Brief drafted a reply" : "Brief drafted a nudge"}</div>
            <div style={{ fontWeight: 500, fontSize: 14, marginTop: 2 }}>{quote.client} · <span className="muted mono" style={{ fontSize: 11 }}>{quote.id}</span></div>
          </div>
          <button onClick={onClose} className="btn btn--ghost btn--sm"><IcX size={14} /></button>
        </div>

        <div style={{ padding: 22, flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
          {lastClientMsg && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Diane wrote · yesterday 4:12 PM</div>
              <div style={{
                fontFamily: "var(--font-serif)", fontSize: 14.5, lineHeight: 1.55,
                padding: "12px 14px", background: "var(--surface-2)",
                borderLeft: "3px solid var(--line-strong)",
                borderRadius: "0 6px 6px 0", color: "var(--ink-2)",
              }}>
                {lastClientMsg}
              </div>
            </div>
          )}

          <div>
            <div className="field__lbl">Subject</div>
            <input className="input" defaultValue={draftSubject} />
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
              <span className="field__lbl">Draft · yours to edit</span>
              <div className="space" />
              <span className="pill pill--draft" style={{ fontSize: 9 }}>Not sent</span>
            </div>
            <textarea className="textarea" rows={10} defaultValue={draftBody} style={{ fontFamily: "var(--font-serif)", fontSize: 14, lineHeight: 1.55 }} />
          </div>

          <div style={{
            padding: 14, background: "var(--accent-tint)",
            borderRadius: 6, display: "flex", gap: 10, alignItems: "flex-start",
          }}>
            <IcSparkle size={14} style={{ color: "var(--accent)", marginTop: 2, flexShrink: 0 }} />
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-2)" }}>
              <strong style={{ color: "var(--ink)", fontWeight: 500 }}>Why this draft.</strong> {reasoning}
            </div>
          </div>

          <div style={{
            padding: 14, background: "var(--surface-2)",
            border: "1px solid var(--line)", borderRadius: 6,
            display: "flex", gap: 10, alignItems: "flex-start",
          }}>
            <IcCalendar size={14} className="muted" style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 500, marginBottom: 2 }}>Best time to send: <span style={{ color: "var(--accent)" }}>{sendWhen}</span></div>
              <div className="muted">{sendWhy}</div>
            </div>
          </div>
        </div>

        <div style={{
          padding: "14px 22px", borderTop: "1px solid var(--line)",
          display: "flex", gap: 10, background: "var(--surface)",
        }}>
          <button className="btn btn--accent" onClick={onClose}>
            <IcSend size={12} /> {isReply ? "Send now" : `Send ${sendWhen.toLowerCase()}`}
          </button>
          <button className="btn">
            <IcCalendar size={12} /> Schedule…
          </button>
          <div className="space" />
          <button className="btn btn--ghost" onClick={onClose}>Save as draft</button>
        </div>
      </div>
    </div>
  );
}

function PipelineList({ quotes }) {
  return (
    <div className="card">
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 110 }}>Ref</th>
            <th>Client / Project</th>
            <th>Status</th>
            <th style={{ textAlign: "right" }}>Total</th>
            <th style={{ textAlign: "right" }}>Margin</th>
            <th>Sent</th>
            <th style={{ textAlign: "right" }}>Win%</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((q) => (
            <tr key={q.id}>
              <td className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>{q.id}</td>
              <td>
                <div style={{ fontWeight: 500 }}>{q.client}</div>
                <div className="muted" style={{ fontSize: 12 }}>{q.project}</div>
              </td>
              <td><StatusPill state={q.state} /></td>
              <td className="num" style={{ textAlign: "right", fontWeight: 500 }}>{money(q.total)}</td>
              <td className="num" style={{ textAlign: "right", color: q.margin >= 28 ? "var(--good)" : "var(--warn)" }}>
                {q.margin}%
              </td>
              <td className="mono muted" style={{ fontSize: 12 }}>{q.sent}</td>
              <td className="num" style={{ textAlign: "right" }}>
                {q.likelihood ? Math.round(q.likelihood * 100) + "%" : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============ Jobs (with reconciliation) ============ */
function Jobs({ payroll, dataState, vocab, onOpenNew, highVariance }) {
  if (dataState === "cold-start" || SAMPLE_JOBS.length === 0) {
    return (
      <div>
        <div style={{ marginBottom: 24 }}>
          <div className="eyebrow">{vocab.jobWordPlCap} · Reconciliation</div>
          <h1 className="h-page" style={{ marginTop: 6 }}>{vocab.reconHeadline}</h1>
        </div>
        <EmptyState
          eyebrow={`${vocab.jobWordPlCap} · empty`}
          headline={vocab.emptyJobsH1}
          body={vocab.emptyJobsBody}
          ctaLabel={dataState === "cold-start" ? vocab.newCta : "Open pipeline"}
          ctaIcon={<IcArrowRight size={14} />}
          onCta={onOpenNew}
          secondary={dataState === "seeded" ? "Nothing signed yet — waiting on three clients." : null}
        />
      </div>
    );
  }

  const initial = highVariance ? (SAMPLE_JOBS.find(j => j.status === "CLOSED") || SAMPLE_JOBS[0]).id : SAMPLE_JOBS[0].id;
  const [selected, setSelected] = useStateP(initial);
  const effectiveSelected = highVariance ? (SAMPLE_JOBS.find(j => j.status === "CLOSED") || SAMPLE_JOBS[0]).id : selected;
  const baseJob = SAMPLE_JOBS.find((j) => j.id === effectiveSelected) || SAMPLE_JOBS[0];
  const job = highVariance && baseJob.status === "CLOSED" ? {
    ...baseJob,
    actualLaborHrs: Math.round(baseJob.quotedLaborHrs * 1.34),
    actualMaterial: Math.round(baseJob.quotedMaterial * 1.28),
    actualTotal: Math.round(baseJob.quotedTotal * 1.26),
    actualMargin: Math.max(8, baseJob.margin - 22),
    varianceNote: "Hit an unmarked vent stack day 2; full re-coat on east face added 18 labor hours and a second material delivery.",
  } : baseJob;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 24 }}>
        <div>
          <div className="eyebrow">{vocab.jobWordPlCap} · Reconciliation</div>
          <h1 className="h-page" style={{ marginTop: 6 }}>{vocab.reconHeadline}</h1>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>
        <div className="card" style={{ alignSelf: "flex-start" }}>
          <div className="card__hd"><h3 style={{ fontSize: 13 }}>All {vocab.jobWordPl}</h3></div>
          <div style={{ padding: 6 }}>
            {SAMPLE_JOBS.map((j) => (
              <button key={j.id} onClick={() => setSelected(j.id)} style={{
                width: "100%", textAlign: "left", padding: 10,
                background: selected === j.id ? "var(--surface-2)" : "transparent",
                border: "1px solid " + (selected === j.id ? "var(--line)" : "transparent"),
                borderRadius: 6, marginBottom: 4,
                display: "flex", flexDirection: "column", gap: 4,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 500, fontSize: 13 }}>{j.name}</span>
                  <StatusPill state={j.status} />
                </div>
                <div className="muted" style={{ fontSize: 11.5 }}>{j.client}</div>
              </button>
            ))}
          </div>
        </div>

        <JobDetail job={job} payroll={payroll} vocab={vocab} />
      </div>
    </div>
  );
}

function JobDetail({ job, payroll, vocab }) {
  const hrsVar = job.actualLaborHrs ? (((job.actualLaborHrs - job.quotedLaborHrs) / job.quotedLaborHrs) * 100) : null;
  const matVar = job.actualMaterial ? (((job.actualMaterial - job.quotedMaterial) / job.quotedMaterial) * 100) : null;
  const isClosed = job.status === "CLOSED";
  const hasMaterials = job.quotedMaterial > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card">
        <div className="card__body" style={{ display: "flex", gap: 24, alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <h2 className="h-section" style={{ fontSize: 22, marginBottom: 4 }}>{job.name}</h2>
            <div className="muted" style={{ fontSize: 13 }}>{job.client} · {vocab.crewWord}: {job.crew}</div>
            <div className="muted mono" style={{ fontSize: 11, marginTop: 4 }}>
              {job.startDate} → {job.endTarget}{job.endActual ? ` (actual: ${job.endActual})` : ""}
            </div>
          </div>

          <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
            <ReconCircle pct={job.pctComplete} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <KpiInline label="Quoted" value={money(job.quotedTotal)} />
              {isClosed && <KpiInline label="Actual" value={money(job.actualTotal)} />}
              {job.actualMargin && <KpiInline label="Margin (actual)" value={job.actualMargin + "%"} tone={job.actualMargin >= job.margin ? "good" : "warn"} />}
              {!isClosed && job.projectedMargin && <KpiInline label="Projected margin" value={job.projectedMargin + "%"} tone="good" />}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__hd">
          <IcLayers size={16} className="muted" />
          <h3>Where we landed vs. where we bid</h3>
          {payroll && <span className="pill pill--won" style={{ marginLeft: "auto", fontSize: 10 }}>Auto-reconciled</span>}
        </div>
        <div className="card__body">
          <table className="tbl">
            <thead>
              <tr>
                <th>Line</th>
                <th style={{ textAlign: "right" }}>Quoted</th>
                <th style={{ textAlign: "right" }}>{isClosed || job.actualLaborHrs ? "Actual" : "Projected"}</th>
                <th style={{ textAlign: "right" }}>Variance</th>
                <th style={{ width: 120 }}>Why</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span style={{ fontWeight: 500 }}>Labor hours</span></td>
                <td className="num" style={{ textAlign: "right" }}>{job.quotedLaborHrs} h</td>
                <td className="num" style={{ textAlign: "right" }}>{job.actualLaborHrs ? job.actualLaborHrs + " h" : "—"}</td>
                <td className="num" style={{ textAlign: "right" }}>{hrsVar !== null && <VarianceBadge pct={hrsVar} />}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {hrsVar !== null && hrsVar > 0 ? "Beyond original scope" : ""}
                </td>
              </tr>
              {hasMaterials && (
                <tr>
                  <td><span style={{ fontWeight: 500 }}>Material</span></td>
                  <td className="num" style={{ textAlign: "right" }}>{money(job.quotedMaterial)}</td>
                  <td className="num" style={{ textAlign: "right" }}>{job.actualMaterial ? money(job.actualMaterial) : "—"}</td>
                  <td className="num" style={{ textAlign: "right" }}>{matVar !== null && <VarianceBadge pct={matVar} />}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{matVar !== null && matVar > 0 ? "Extra paper + lath section" : matVar !== null ? "Came in under" : ""}</td>
                </tr>
              )}
              <tr>
                <td><span style={{ fontWeight: 500 }}>Schedule</span></td>
                <td className="num" style={{ textAlign: "right" }}>{job.startDate} → {job.endTarget}</td>
                <td className="num" style={{ textAlign: "right" }}>{job.endActual || job.endTarget}</td>
                <td className="num" style={{ textAlign: "right" }}>{job.endActual ? <VarianceBadge pct={isClosed ? +8 : 0} format="days" /> : "—"}</td>
                <td className="muted" style={{ fontSize: 12 }}>{job.endActual ? "Slipped on rev cycles" : ""}</td>
              </tr>
            </tbody>
          </table>

          {payroll && !isClosed && (
            <div style={{
              marginTop: 16, padding: 14,
              background: "var(--info-tint)", borderRadius: 6,
              display: "flex", gap: 10, alignItems: "flex-start",
            }}>
              <IcInfo size={14} style={{ color: "var(--info)", marginTop: 2 }} />
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                <strong>Labor is tracking {Math.abs(job.quotedLaborHrs - job.actualLaborHrs)} hours under budget</strong> so far.
                If the rest of the {vocab.jobWord} holds, you'll close ahead of margin.
                Brief will refresh this each payroll period.
              </div>
            </div>
          )}

          {!payroll && (
            <div style={{
              marginTop: 16, padding: 14, background: "var(--surface-2)",
              borderRadius: 6, display: "flex", gap: 10, alignItems: "flex-start",
              border: "1px dashed var(--line-2)",
            }}>
              <IcLink size={14} className="muted" style={{ marginTop: 2 }} />
              <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
                <strong>Want this filled in automatically?</strong> Connect ProService Hawaii and Brief will reconcile hours daily.
                For now, you can enter actuals manually.
              </div>
              <button className="btn btn--sm">Enter hours</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReconCircle({ pct }) {
  const r = 28, c = 2 * Math.PI * r;
  const off = c - (pct / 100) * c;
  return (
    <div style={{ position: "relative", width: 72, height: 72 }}>
      <svg width="72" height="72" viewBox="0 0 72 72" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--line)" strokeWidth="5" />
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--accent)" strokeWidth="5"
                strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
        <div className="num" style={{ fontFamily: "var(--font-serif)", fontSize: 20, fontWeight: 500 }}>
          {pct}<span style={{ fontSize: 11, color: "var(--muted)" }}>%</span>
        </div>
      </div>
    </div>
  );
}

function KpiInline({ label, value, tone }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
      <span className="muted mono" style={{ fontSize: 10, width: 110, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      <span className="num" style={{ fontWeight: 500, color: tone === "good" ? "var(--good)" : tone === "warn" ? "var(--warn)" : "var(--ink)" }}>
        {value}
      </span>
    </div>
  );
}

function VarianceBadge({ pct, format = "pct" }) {
  const sign = pct > 0 ? "+" : "";
  const tone = Math.abs(pct) < 5 ? "var(--muted)" : pct > 0 ? "var(--danger)" : "var(--good)";
  return (
    <span style={{ color: tone, fontWeight: 500, fontFamily: "var(--font-mono)", fontSize: 12 }}>
      {sign}{pct.toFixed(format === "days" ? 0 : 1)}%
    </span>
  );
}

/* ============ Clients ============ */
function Clients({ dataState, vocab, onOpenNew, selectedClient }) {
  const [selected, setSelected] = useStateP(selectedClient || null);
  const detail = selected ? SAMPLE_CLIENTS.find(c => c.id === selected) : null;
  if (dataState === "cold-start") {
    return (
      <div>
        <div style={{ marginBottom: 24 }}>
          <div className="eyebrow">Client book</div>
          <h1 className="h-page" style={{ marginTop: 6 }}>{vocab.clientsHeadline}</h1>
        </div>
        <EmptyState
          eyebrow="Clients · empty"
          headline={vocab.emptyClientsH1}
          body={vocab.emptyClientsBody}
          ctaLabel={vocab.newCta}
          ctaIcon={<IcPlus size={14} />}
          onCta={onOpenNew}
        />
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 24 }}>
        <div>
          <div className="eyebrow">Client book</div>
          <h1 className="h-page" style={{ marginTop: 6 }}>{vocab.clientsHeadline}</h1>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: detail ? "1fr 360px" : "1fr", gap: 16 }} data-stack-on-mobile>
      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Client</th>
              <th>Segment</th>
              <th style={{ textAlign: "right" }}>{vocab.jobWordPlCap}</th>
              <th style={{ textAlign: "right" }}>Win rate</th>
              <th style={{ textAlign: "right" }}>Lifetime</th>
              <th>Last {vocab.jobWord}</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_CLIENTS.map((c) => {
              const winrate = c.jobs > 0 ? Math.round((c.won / c.jobs) * 100) : null;
              return (
                <tr key={c.id} onClick={() => setSelected(c.id)} style={{ cursor: "pointer", background: selected === c.id ? "var(--surface-2)" : "transparent" }}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div className="avatar">{c.name.split(" ").map(w => w[0]).slice(0,2).join("")}</div>
                      <div>
                        <div style={{ fontWeight: 500 }}>{c.name}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{c.contact}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`pill ${c.segment === "repeat" ? "pill--won" : "pill--draft"}`}>
                      {c.segment === "repeat" ? "Repeat" : "Cold-bid"}
                    </span>
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>{c.jobs}</td>
                  <td className="num" style={{ textAlign: "right" }}>{winrate !== null ? winrate + "%" : "—"}</td>
                  <td className="num" style={{ textAlign: "right", fontWeight: 500 }}>{c.lifetime ? money(c.lifetime) : "—"}</td>
                  <td className="muted mono" style={{ fontSize: 12 }}>{c.lastJob}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {detail && <ClientDetail client={detail} vocab={vocab} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}

function ClientDetail({ client, vocab, onClose }) {
  const winrate = client.jobs > 0 ? Math.round((client.won / client.jobs) * 100) : null;
  const clientQuotes = SAMPLE_QUOTES.filter(q => q.client === client.name);
  return (
    <div className="card" style={{ alignSelf: "flex-start", position: "sticky", top: 0 }}>
      <div className="card__hd" style={{ display: "flex", alignItems: "center" }}>
        <h3>Client</h3>
        <div className="space" />
        <button onClick={onClose} className="btn btn--ghost btn--sm"><IcX size={12} /></button>
      </div>
      <div className="card__body">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div className="avatar" style={{ width: 44, height: 44, fontSize: 14 }}>{client.name.split(" ").map(w => w[0]).slice(0,2).join("")}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: 15 }}>{client.name}</div>
            <div className="muted" style={{ fontSize: 12 }}>{client.contact}</div>
          </div>
          <span className={`pill ${client.segment === "repeat" ? "pill--won" : "pill--draft"}`}>{client.segment === "repeat" ? "Repeat" : "Cold-bid"}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "12px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", marginBottom: 14 }}>
          <div>
            <div className="muted mono" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{vocab.jobWordPlCap}</div>
            <div className="num" style={{ fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 500 }}>{client.jobs}</div>
            <div className="muted" style={{ fontSize: 11 }}>{client.won} won · {client.lost} lost</div>
          </div>
          <div>
            <div className="muted mono" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Win rate</div>
            <div className="num" style={{ fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 500 }}>{winrate !== null ? winrate + "%" : "—"}</div>
            <div className="muted" style={{ fontSize: 11 }}>{client.jobs < 3 ? "too few to compare" : "vs. 38% shop avg"}</div>
          </div>
          <div>
            <div className="muted mono" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Lifetime</div>
            <div className="num" style={{ fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 500 }}>{client.lifetime ? moneyK(client.lifetime) : "—"}</div>
          </div>
          <div>
            <div className="muted mono" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Last {vocab.jobWord}</div>
            <div className="num" style={{ fontFamily: "var(--font-serif)", fontSize: 16, fontWeight: 500 }}>{client.lastJob}</div>
          </div>
        </div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Recent {vocab.workWordPl}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {clientQuotes.length === 0 && <div className="muted" style={{ fontSize: 12, fontStyle: "italic" }}>No {vocab.workWordPl} yet</div>}
          {clientQuotes.slice(0, 5).map(q => (
            <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid var(--line)" }}>
              <StatusPill state={q.state} />
              <div style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>{q.project}</div>
              <div className="mono num" style={{ fontSize: 12 }}>{moneyK(q.total)}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 6 }}>
          <button className="btn btn--sm"><IcMail size={11} /> Email</button>
          <button className="btn btn--sm"><IcPhone size={11} /> Call</button>
          <div className="space" />
          <button className="btn btn--ghost btn--sm"><IcEdit size={11} /> Edit</button>
        </div>
      </div>
    </div>
  );
}

/* ============ Settings ============ */
function Settings({ payroll, vocab }) {
  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 24 }}>
        <div className="eyebrow">Settings</div>
        <h1 className="h-page" style={{ marginTop: 6 }}>Your shop</h1>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card__hd"><h3>Shop profile</h3></div>
        <div className="card__body">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Shop name" value={COMPANY.name} editable />
            <Field label="Owner" value={COMPANY.owner} editable />
            <Field label="Trade" value={COMPANY.trade} editable />
            <Field label={vocab.licenseLabel} value={COMPANY.license} editable />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card__hd"><h3>Default pricing</h3></div>
        <div className="card__body">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
            <Field label={vocab.hourlyLabel} value={"$" + COMPANY.hourlyAvg} editable />
            <Field label="Material markup" value={COMPANY.avgMaterialMarkup + "%"} editable />
            <Field label="Labor markup" value={COMPANY.avgLaborMarkup + "%"} editable />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card__hd"><h3>Branding</h3></div>
        <div className="card__body">
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 18, alignItems: "flex-start" }}>
            <div>
              <div className="field__lbl">Logo</div>
              <div style={{ width: 96, height: 96, border: "1px dashed var(--line-strong)", borderRadius: 8, display: "grid", placeItems: "center", background: "var(--surface-2)" }}>
                <span style={{ fontFamily: "var(--font-serif)", fontSize: 32, fontWeight: 500 }}>{vocab.initial}</span>
              </div>
              <button className="btn btn--ghost btn--sm" style={{ marginTop: 8 }}><IcUpload size={11} /> Replace</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="Accent color" value="#9C4724" editable />
              <Field label={`${vocab.workWord} footer text`} value={`${COMPANY.name} \u00b7 ${vocab.licenseLabel}: ${COMPANY.license}`} editable />
              <Field label="Email signature" value={`\u2014 ${vocab.ownerFirst}, ${COMPANY.owner.split(" ").slice(-1)[0] === vocab.ownerFirst ? COMPANY.trade : COMPANY.owner}`} editable />
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card__hd"><h3>Connected services</h3></div>
        <div className="card__body" style={{ padding: 0 }}>
          {[
            { name: "ProService Hawaii Payroll", on: payroll, sub: payroll ? "Connected · syncs hourly" : "Not connected" },
            { name: "Google Calendar", on: true, sub: `Connected · read-only · Brief calendar created` },
            { name: "QuickBooks Online", on: true, sub: "Connected · last sync 12 min ago" },
            { name: "DocuSign", on: false, sub: `Not connected — ${vocab.workWordPl} send as PDF only` },
            { name: "Google Drive", on: true, sub: `Connected · backs up all ${vocab.workWordPl}` },
          ].map((row, i, arr) => (
            <div key={i} style={{
              padding: "14px 18px",
              borderBottom: i < arr.length - 1 ? "1px solid var(--line)" : "0",
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: row.on ? "var(--good)" : "var(--line-strong)" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 13.5 }}>{row.name}</div>
                <div className="muted" style={{ fontSize: 11.5 }}>{row.sub}</div>
              </div>
              <button className="btn btn--sm">{row.on ? "Manage" : "Connect"}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Pipeline, Jobs, Clients, Settings });
