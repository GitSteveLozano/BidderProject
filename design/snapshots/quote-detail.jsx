/* Quote detail — single quote view: header, line items, activity, files */

const { useState: useStateQD } = React;

function QuoteDetail({ quoteId, vocab, onBack, initialEdit, activityFocus }) {
  const quote = SAMPLE_QUOTES.find(q => q.id === quoteId) || SAMPLE_QUOTES[0];
  const [editing, setEditing] = useStateQD(initialEdit ? "li-2" : null);
  const decided = quote.state === "WON" || quote.state === "LOST";

  // Synthesize line items from the quote total — these would be real in production
  const lineItems = synthLineItems(quote);
  const activity = synthActivity(quote, activityFocus);

  return (
    <div style={{ maxWidth: 1180 }}>
      {/* Header crumb back */}
      <button onClick={onBack} className="btn btn--ghost btn--sm" style={{ marginBottom: 14 }}>
        <IcArrowLeft size={12} /> Back to {vocab.workWordPl}
      </button>

      {/* Quote header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 18, marginBottom: 22 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span className="mono muted" style={{ fontSize: 12 }}>{quote.id}</span>
            <StatusPill state={quote.state} />
            {quote.relationship === "repeat" && (
              <span className="muted" style={{ fontSize: 11.5, fontStyle: "italic" }}>· repeat client · {quote.lastJobs} prior {quote.lastJobs === 1 ? vocab.jobWord : vocab.jobWordPl}</span>
            )}
          </div>
          <h1 className="h-page" style={{ marginBottom: 4 }}>{quote.client}</h1>
          <div style={{ fontSize: 15.5, color: "var(--ink-2)", marginBottom: 6, fontFamily: "var(--font-serif)" }}>{quote.project}</div>
          <div className="muted" style={{ fontSize: 12.5, display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span><IcMapPin size={11} style={{ marginRight: 4, verticalAlign: "-1px" }} />{quote.address}</span>
            <span><IcMail size={11} style={{ marginRight: 4, verticalAlign: "-1px" }} />{quote.contact}</span>
            <span><IcCalendar size={11} style={{ marginRight: 4, verticalAlign: "-1px" }} />Sent {quote.sent}</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="eyebrow">Total</div>
          <div className="num" style={{ fontFamily: "var(--font-serif)", fontSize: 36, fontWeight: 500, lineHeight: 1, marginTop: 4 }}>
            {money(quote.total)}
          </div>
          <div className="muted mono" style={{ fontSize: 11, marginTop: 4 }}>
            {quote.margin}% margin · {quote.likelihood ? Math.round(quote.likelihood * 100) + "% likely" : "—"}
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 6, justifyContent: "flex-end" }}>
            {!decided && <button className="btn btn--accent btn--sm"><IcSend size={11} /> Send reminder</button>}
            {decided && <button className="btn btn--sm"><IcCopy size={11} /> Clone to edit</button>}
            <button className="btn btn--ghost btn--sm"><IcMore size={12} /></button>
          </div>
        </div>
      </div>

      {/* Decision banner if WON/LOST */}
      {decided && (
        <div style={{
          padding: "12px 16px", marginBottom: 14,
          background: quote.state === "WON" ? "var(--good-tint, var(--surface-2))" : "var(--surface-2)",
          border: "1px solid var(--line)", borderRadius: 6,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <IcLock size={13} className="muted" />
          <div style={{ flex: 1, fontSize: 13 }}>
            {quote.state === "WON" ? (<><strong>Won {quote.won}</strong> — quote is locked. Clone to create a follow-on.</>) :
                                       (<><strong>Lost</strong> — {quote.nextStep || "Closed."}</>)}
          </div>
        </div>
      )}

      {/* Two-column body */}
      <div className="qd-grid" data-stack-on-mobile style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Line items */}
          <div className="card">
            <div className="card__hd">
              <h3>Line items</h3>
              {!decided && <button className="btn btn--ghost btn--sm" style={{ marginLeft: "auto" }}><IcPlus size={11} /> Add line</button>}
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Description</th>
                  <th style={{ textAlign: "right", width: 80 }}>Qty</th>
                  <th style={{ textAlign: "right", width: 110 }}>Unit</th>
                  <th style={{ textAlign: "right", width: 120 }}>Subtotal</th>
                  <th style={{ width: 90 }}>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li) => (
                  <tr key={li.id} style={editing === li.id ? { background: "var(--surface-2)" } : {}}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{li.desc}</div>
                      {li.note && <div className="muted" style={{ fontSize: 11.5, fontStyle: "italic", marginTop: 2 }}>{li.note}</div>}
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>{li.qty} {li.unit}</td>
                    <td className="num" style={{ textAlign: "right" }}>{money(li.rate)}</td>
                    <td className="num" style={{ textAlign: "right", fontWeight: 500 }}>{money(li.qty * li.rate)}</td>
                    <td><ConfChip conf={li.confidence} /></td>
                  </tr>
                ))}
                <tr style={{ borderTop: "2px solid var(--line-strong)" }}>
                  <td colSpan={3} style={{ textAlign: "right", fontWeight: 500 }}>Total</td>
                  <td className="num" style={{ textAlign: "right", fontWeight: 600, fontSize: 15 }}>{money(quote.total)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Files */}
          <div className="card">
            <div className="card__hd"><h3>Files</h3></div>
            <div className="card__body" style={{ padding: 0 }}>
              {[
                { name: `${quote.id}.pdf`, type: "Quote PDF", size: "284 KB", date: quote.sent },
                { name: "site-photos-front.jpg", type: "Site photo", size: "1.2 MB", date: "May 2" },
                { name: "site-photos-east.jpg", type: "Site photo", size: "980 KB", date: "May 2" },
                ...(quote.state === "RESPONDED" ? [{ name: "diane-walkthrough-notes.txt", type: "Walk note", size: "4 KB", date: "May 10" }] : []),
              ].map((f, i, arr) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 18px",
                  borderBottom: i < arr.length - 1 ? "1px solid var(--line)" : 0,
                }}>
                  <IcFile size={14} className="muted" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{f.name}</div>
                    <div className="muted mono" style={{ fontSize: 10.5 }}>{f.type} · {f.size} · {f.date}</div>
                  </div>
                  <button className="btn btn--ghost btn--sm"><IcDownload size={11} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Activity sidebar */}
        <div className="card" style={{ alignSelf: "flex-start", position: "sticky", top: 0 }}>
          <div className="card__hd"><h3>Activity</h3></div>
          <ol style={{ listStyle: "none", padding: "8px 0", margin: 0 }}>
            {activity.map((a, i) => (
              <li key={i} style={{
                padding: "10px 18px",
                display: "flex", gap: 10,
                borderBottom: i < activity.length - 1 ? "1px solid var(--line)" : 0,
                opacity: a.muted ? 0.55 : 1,
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: "50%",
                  background: a.bg || "var(--surface-2)",
                  display: "grid", placeItems: "center", flexShrink: 0,
                  border: "1px solid var(--line)",
                  color: a.color || "var(--ink-2)",
                }}>
                  {a.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                    <strong style={{ fontWeight: 500 }}>{a.title}</strong>
                    {a.body && <span className="muted"> · {a.body}</span>}
                  </div>
                  <time className="muted mono" style={{ fontSize: 10.5 }}>{a.when}</time>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* Edit line-item modal */}
      {editing && (
        <EditLineItemModal
          item={lineItems.find(l => l.id === editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ConfChip({ conf }) {
  const map = {
    high: { label: "high", bg: "var(--good-tint, #e8f3ec)", color: "var(--good)" },
    med: { label: "med", bg: "var(--info-tint)", color: "var(--info)" },
    low: { label: "low", bg: "var(--warn-tint, #fff3df)", color: "var(--warn)" },
    manual: { label: "manual", bg: "var(--surface-2)", color: "var(--muted)" },
  };
  const m = map[conf] || map.manual;
  return (
    <span style={{
      display: "inline-block", padding: "2px 7px", borderRadius: 3,
      fontSize: 10.5, fontFamily: "var(--font-mono)",
      background: m.bg, color: m.color,
    }} aria-label={`Confidence: ${m.label}`}>{m.label}</span>
  );
}

function EditLineItemModal({ item, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 50,
      background: "rgba(0,0,0,0.32)",
      display: "grid", placeItems: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(520px, 92vw)", background: "var(--bg)",
        border: "1px solid var(--line-strong)", borderRadius: 8,
        boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
      }}>
        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center" }}>
          <div>
            <div className="eyebrow">Edit line item</div>
            <div style={{ fontWeight: 500, fontSize: 14, marginTop: 2 }}>{item.desc}</div>
          </div>
          <div className="space" />
          <button onClick={onClose} className="btn btn--ghost btn--sm"><IcX size={14} /></button>
        </div>
        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="field__lbl">Description</div>
            <input className="input" defaultValue={item.desc} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <div className="field__lbl">Quantity</div>
              <input className="input" defaultValue={item.qty} />
            </div>
            <div>
              <div className="field__lbl">Unit</div>
              <input className="input" defaultValue={item.unit} />
            </div>
            <div>
              <div className="field__lbl">Unit rate</div>
              <input className="input" defaultValue={item.rate} />
            </div>
          </div>
          <div>
            <div className="field__lbl">Note</div>
            <input className="input" defaultValue={item.note || ""} placeholder="Internal note (won't appear on the quote)" />
          </div>
          <div style={{
            padding: 12, background: "var(--accent-tint)",
            borderRadius: 6, display: "flex", gap: 10, alignItems: "flex-start",
          }}>
            <IcSparkle size={13} style={{ color: "var(--accent)", marginTop: 2 }} />
            <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--ink-2)" }}>
              <strong style={{ color: "var(--ink)", fontWeight: 500 }}>Pulled from:</strong> "...approximately 2,400 sq ft of three-coat
              stucco on east + south elevations, sand-float finish..."
            </div>
          </div>
        </div>
        <div style={{ padding: "14px 22px", borderTop: "1px solid var(--line)", display: "flex", gap: 8, background: "var(--surface)" }}>
          <button className="btn btn--accent" onClick={onClose}><IcCheck size={11} /> Save changes</button>
          <button className="btn" onClick={onClose}>Cancel</button>
          <div className="space" />
          <button className="btn btn--ghost"><IcX size={12} /> Delete line</button>
        </div>
      </div>
    </div>
  );
}

/* Sample line items keyed off quote shape */
function synthLineItems(q) {
  // Generic three-line breakdown that totals close to q.total
  const labor = Math.round(q.total * 0.58);
  const mat = Math.round(q.total * 0.27);
  const finish = q.total - labor - mat;
  if (q.id.startsWith("P-")) {
    // Branding studio
    return [
      { id: "li-1", desc: "Discovery + strategy", qty: 1, unit: "phase", rate: Math.round(q.total * 0.18), confidence: "high", note: "2-week kickoff, stakeholder interviews" },
      { id: "li-2", desc: "Identity system design", qty: 1, unit: "phase", rate: Math.round(q.total * 0.46), confidence: "high", note: "Wordmark, palette, type system, guidelines" },
      { id: "li-3", desc: "Application kit", qty: 1, unit: "phase", rate: Math.round(q.total * 0.26), confidence: "med" },
      { id: "li-4", desc: "Production + handoff", qty: 1, unit: "phase", rate: q.total - Math.round(q.total * 0.18) - Math.round(q.total * 0.46) - Math.round(q.total * 0.26), confidence: "manual", note: "File org, vendor delivery" },
    ];
  }
  // Stucco
  const sqft = q.sqft || 2400;
  return [
    { id: "li-1", desc: "Prep + lath", qty: sqft, unit: "sqft", rate: +(mat / sqft).toFixed(2), confidence: "high" },
    { id: "li-2", desc: "Three-coat stucco · scratch + brown + finish", qty: sqft, unit: "sqft", rate: +(labor / sqft).toFixed(2), confidence: "high", note: "Sand-float texture per spec" },
    { id: "li-3", desc: "Color coat · integral pigment", qty: sqft, unit: "sqft", rate: +(finish / sqft).toFixed(2), confidence: "med" },
    { id: "li-4", desc: "Permit + dump fees", qty: 1, unit: "ls", rate: 480, confidence: "manual" },
  ];
}

/* Sample activity feed */
function synthActivity(q, focus) {
  const base = [
    { icon: <IcCircleCheck size={12} />, color: "var(--good)", bg: "var(--surface-2)", title: "Quote drafted", body: "8 line items extracted", when: `${q.age + 1}d ago` },
    { icon: <IcSend size={11} />, color: "var(--info)", title: "Sent to " + (q.contact?.split(" ")[0] || "client"), body: "via email + PDF attached", when: `${q.age}d ago` },
    { icon: <IcEye size={12} />, color: "var(--muted)", title: "Opened", body: "PDF viewed for 4 min", when: `${q.age - 1 > 0 ? q.age - 1 : 0}d ago` },
  ];
  if (q.state === "RESPONDED") {
    base.push({ icon: <IcMail size={11} />, color: "var(--accent)", title: "Replied", body: "Asked about finish texture", when: "yesterday 4:12 PM" });
    base.push({ icon: <IcSparkle size={11} />, color: "var(--accent)", title: "Brief drafted reply", body: "ready to review", when: "yesterday 4:14 PM" });
  } else if (q.state === "WON") {
    base.push({ icon: <IcCheck size={11} />, color: "var(--good)", title: "Won", body: q.won, when: `${q.age - 3}d ago` });
  } else if (q.state === "AWAITING") {
    base.push({ icon: <IcClock size={11} />, color: "var(--warn)", title: "Awaiting response", body: `${q.age - 1} days since open`, when: "ongoing", muted: true });
  }
  if (focus === "full") {
    // Extra granular events for the activity-feed screenshot
    return [
      { icon: <IcEdit size={11} />, color: "var(--ink-2)", title: "Edited", body: "Line 2 rate adjusted", when: "10 min ago" },
      { icon: <IcSparkle size={11} />, color: "var(--accent)", title: "Brief drafted reply", body: "ready to review", when: "yesterday 4:14 PM" },
      { icon: <IcMail size={11} />, color: "var(--accent)", title: "Replied", body: "Diane asked about finish texture", when: "yesterday 4:12 PM" },
      { icon: <IcEye size={12} />, color: "var(--muted)", title: "Opened (3rd time)", body: "PDF viewed for 7 min", when: "yesterday 3:48 PM" },
      { icon: <IcEye size={12} />, color: "var(--muted)", title: "Opened (2nd time)", body: "PDF viewed for 2 min", when: "2d ago" },
      { icon: <IcEye size={12} />, color: "var(--muted)", title: "Opened", body: "PDF viewed for 4 min", when: "3d ago" },
      { icon: <IcSend size={11} />, color: "var(--info)", title: "Sent to Diane", body: "via email + PDF attached", when: "5d ago" },
      { icon: <IcCircleCheck size={12} />, color: "var(--good)", title: "Quote drafted", body: "8 line items extracted from walk-around notes", when: "6d ago", muted: true },
      { icon: <IcUpload size={11} />, color: "var(--muted)", title: "Site photos uploaded", body: "12 photos · front + east elevations", when: "6d ago", muted: true },
    ];
  }
  return base;
}

Object.assign(window, { QuoteDetail });
