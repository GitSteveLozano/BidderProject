/* Quote production — the 10-min-not-3-hour hero flow */

const { useState: useStateQ, useEffect: useEffectQ, useMemo: useMemoQ, useRef: useRefQ } = React;

const QP_STEPS = ["Intake", "Scope", "Pricing", "Review", "Send"];

function QuoteProduction({ payroll, segment, onSent, onBack }) {
  const [step, setStep] = useStateQ(0);
  const [intake, setIntake] = useStateQ({
    method: null, // 'pdf' | 'text' | 'voice'
    text: "",
    file: null,
    client: "",
    address: "",
  });
  const [scope, setScope] = useStateQ(null);
  const [pricing, setPricing] = useStateQ(null);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <QPHeader step={step} setStep={setStep} onBack={onBack} />

      {step === 0 && (
        <QPIntake
          intake={intake}
          setIntake={setIntake}
          onAnalyzed={(s) => { setScope(s); setStep(1); }}
        />
      )}
      {step === 1 && (
        <QPScope
          intake={intake}
          scope={scope}
          setScope={setScope}
          onContinue={(p) => { setPricing(p); setStep(2); }}
        />
      )}
      {step === 2 && (
        <QPPricing
          payroll={payroll}
          scope={scope}
          pricing={pricing}
          setPricing={setPricing}
          onContinue={() => setStep(3)}
        />
      )}
      {step === 3 && (
        <QPReview
          intake={intake} scope={scope} pricing={pricing} segment={segment}
          onSend={() => setStep(4)}
          onEdit={(s) => setStep(s)}
        />
      )}
      {step === 4 && (
        <QPSent onDone={onSent} segment={segment} pricing={pricing} />
      )}
    </div>
  );
}

function QPHeader({ step, setStep, onBack }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
      <button className="btn btn--ghost btn--sm" onClick={onBack}>
        <IcArrowLeft size={12} /> All quotes
      </button>
      <div className="space" />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {QP_STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <button
              onClick={() => i < step && setStep(i)}
              disabled={i >= step}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                color: i === step ? "var(--ink)" : i < step ? "var(--muted)" : "var(--muted-2)",
                fontWeight: i === step ? 600 : 400,
                cursor: i < step ? "pointer" : "default",
              }}>
              <span style={{
                width: 18, height: 18, borderRadius: 9,
                display: "grid", placeItems: "center",
                background: i === step ? "var(--accent)" : i < step ? "var(--accent-tint)" : "var(--bg-2)",
                color: i === step ? "var(--accent-ink)" : i < step ? "var(--accent)" : "var(--muted)",
                fontSize: 10, fontWeight: 600,
              }}>
                {i < step ? <IcCheck size={11} stroke={2.5} /> : i + 1}
              </span>
              {s}
            </button>
            {i < QP_STEPS.length - 1 && <span className="muted-2">/</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/* ============ Step 1: Intake ============ */
function QPIntake({ intake, setIntake, onAnalyzed }) {
  const [analyzing, setAnalyzing] = useStateQ(false);
  const [progress, setProgress] = useStateQ(0);

  const start = (method) => {
    setIntake({ ...intake, method });
    setAnalyzing(true);
    setProgress(0);
  };

  useEffectQ(() => {
    if (!analyzing) return;
    const id = setInterval(() => {
      setProgress((p) => {
        const next = p + (Math.random() * 9 + 3);
        if (next >= 100) {
          clearInterval(id);
          setTimeout(() => {
            onAnalyzed(BUILT_SCOPE);
          }, 500);
          return 100;
        }
        return next;
      });
    }, 200);
    return () => clearInterval(id);
  }, [analyzing]);

  if (analyzing) {
    return <QPAnalyzing progress={progress} method={intake.method} />;
  }

  return (
    <div>
      <h2 className="h-display" style={{ fontSize: 36, marginBottom: 8, maxWidth: 560 }}>
        How did the scope come in?
      </h2>
      <p className="muted" style={{ marginBottom: 32, maxWidth: 540, fontSize: 15, lineHeight: 1.55 }}>
        Drop a PDF, paste the client's email, or just describe the job out loud.
        Brief reads it and builds the line items.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* PDF / Doc upload */}
        <IntakeCard
          icon={<IcUpload size={22} />}
          title="Drop a PDF or doc"
          sub="Client RFP, blueprints, contractor email"
          accent
          onClick={() => start("pdf")}
        >
          <div style={{
            border: "1.5px dashed var(--line-strong)",
            borderRadius: "var(--radius-2)",
            padding: "28px 20px",
            textAlign: "center",
            background: "var(--surface-2)",
            marginTop: 12,
          }}>
            <IcFile size={28} style={{ color: "var(--muted)", marginBottom: 10 }} />
            <div style={{ fontWeight: 500, marginBottom: 4 }}>Halsted-RFP-Ridgemoor.pdf</div>
            <div className="muted" style={{ fontSize: 12 }}>4 pages · 2.1 MB · Just dragged in</div>
          </div>
        </IntakeCard>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <IntakeCard
            icon={<IcKeyboard size={20} />}
            title="Paste or type the scope"
            sub="Best for emails & text messages"
            onClick={() => start("text")}
            compact
          />
          <IntakeCard
            icon={<IcMic size={20} />}
            title="Talk through the walk-through"
            sub="Record from your truck on the way back"
            onClick={() => start("voice")}
            compact
          />
        </div>
      </div>

      <div className="card card--flat" style={{ background: "var(--surface-2)", borderStyle: "dashed" }}>
        <div className="card__body" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <IcInfo size={18} className="muted" />
          <div style={{ flex: 1, fontSize: 13.5, lineHeight: 1.5 }}>
            <span style={{ fontWeight: 500 }}>Brief learned your last 34 jobs.</span>{" "}
            <span className="muted">It already knows your typical assemblies, prep procedures, and finish options — you won't be retyping them.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function IntakeCard({ icon, title, sub, accent, compact, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="card"
      style={{
        textAlign: "left",
        padding: compact ? "16px 18px" : "22px 22px",
        cursor: "pointer",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
        background: accent ? "var(--surface)" : "var(--surface)",
        borderColor: accent ? "var(--line-2)" : "var(--line)",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "var(--shadow-md)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{
          width: 38, height: 38, borderRadius: "var(--radius-2)",
          background: accent ? "var(--accent-tint)" : "var(--bg-2)",
          color: accent ? "var(--accent)" : "var(--muted)",
          display: "grid", placeItems: "center",
          flexShrink: 0,
        }}>{icon}</div>
        <div style={{ flex: 1 }}>
          <div className="h-section" style={{ fontSize: compact ? 16 : 18, marginBottom: 2 }}>{title}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>{sub}</div>
        </div>
        <IcArrowRight size={14} className="muted" />
      </div>
      {children}
    </button>
  );
}

function QPAnalyzing({ progress, method }) {
  const tasks = [
    { at: 0, label: method === "pdf" ? "Reading 4 pages of RFP" : "Parsing scope text" },
    { at: 22, label: "Found project type — exterior stucco re-do, residential" },
    { at: 42, label: "Pulling matching past jobs (3 found)" },
    { at: 60, label: "Estimating square footage from blueprint dimensions" },
    { at: 78, label: "Composing line items + crew estimate" },
    { at: 92, label: "Cross-checking against your typical margins" },
  ];

  return (
    <div className="card" style={{ minHeight: 480 }}>
      <div className="card__body" style={{ padding: "40px 36px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <IcSparkle size={20} style={{ color: "var(--accent)" }} />
          <div>
            <div className="eyebrow">Brief is reading the scope</div>
            <div className="h-section" style={{ fontSize: 22, marginTop: 4 }}>
              Halsted & Sons — Ridgemoor Ln re-stucco
            </div>
          </div>
          <div className="space" />
          <div className="num" style={{ fontFamily: "var(--font-serif)", fontSize: 28, fontWeight: 500 }}>
            {Math.min(Math.round(progress), 100)}<span style={{ fontSize: 16, color: "var(--muted)" }}>%</span>
          </div>
        </div>

        <div style={{ height: 4, background: "var(--bg-2)", borderRadius: 999, overflow: "hidden", marginBottom: 32 }}>
          <div style={{
            height: "100%", width: progress + "%",
            background: "var(--accent)", transition: "width 0.3s",
          }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {tasks.map((t, i) => {
            const done = progress >= t.at + 8;
            const active = progress >= t.at && !done;
            const idle = progress < t.at;
            return (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "10px 14px",
                background: active ? "var(--surface-2)" : "transparent",
                border: active ? "1px solid var(--line)" : "1px solid transparent",
                borderRadius: "var(--radius-2)",
                opacity: idle ? 0.35 : 1,
                transition: "all 0.3s",
              }}>
                {done ? <IcCheck size={16} style={{ color: "var(--good)" }} />
                  : active ? <div className="spinner" />
                  : <div style={{ width: 16, height: 16 }} />}
                <span style={{ fontSize: 14 }}>{t.label}</span>
                {active && (
                  <span className="muted mono" style={{ fontSize: 11, marginLeft: "auto" }}>
                    reading…
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div style={{
          marginTop: 32, padding: "14px 18px",
          background: "var(--accent-tint)",
          borderRadius: "var(--radius-2)",
          display: "flex", gap: 12, alignItems: "center",
        }}>
          <IcZap size={14} style={{ color: "var(--accent)" }} />
          <span style={{ fontSize: 13, fontStyle: "italic", fontFamily: "var(--font-serif)" }}>
            Three weeks ago this job would've cost you a Saturday morning.
          </span>
        </div>
      </div>
    </div>
  );
}

/* ============ Step 2: Scope confirmation ============ */
const BUILT_SCOPE = {
  client: "Halsted & Sons Contracting",
  contact: "Diane Halsted",
  email: "diane@halstedcontracting.com",
  phone: "(626) 555-0188",
  address: "418 Ridgemoor Ln, Pasadena CA 91105",
  projectType: "Exterior re-stucco — 2-story residential",
  startTarget: "Week of May 27",
  sqft: 4200,
  stories: 2,
  finish: "Sand-float, integral color (verify w/ Diane)",
  preparation: "Strip existing paper-thin coat, repair lath + paper, prime",
  exclusions: [
    "Window/door replacement",
    "Painting after stucco cure",
    "Permit fees (client to pull)",
  ],
  flags: [
    { kind: "warn", text: "Diane's RFP mentioned 'matching texture #6' — we don't know what that is. Confirm before sending." },
    { kind: "info", text: "Drone scan suggests west elevation may need full lath replacement — pad +12 labor hrs?" },
  ],
};

function QPScope({ intake, scope, setScope, onContinue }) {
  const [exclusions, setExclusions] = useStateQ(scope.exclusions);
  const [newExcl, setNewExcl] = useStateQ("");

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 20 }}>
        <div>
          <div className="eyebrow">Step 2 of 5</div>
          <h2 className="h-display" style={{ fontSize: 32, marginTop: 6 }}>
            Confirm the scope.
          </h2>
        </div>
        <div className="space" />
        <span className="muted mono" style={{ fontSize: 11 }}>
          <IcClock size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
          1 min 47 sec elapsed
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card__hd">
            <h3>The project</h3>
            <span className="muted mono" style={{ fontSize: 11, marginLeft: "auto" }}>From RFP page 1–2</span>
          </div>
          <div className="card__body">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Client" value={scope.client} editable />
              <Field label="Contact" value={scope.contact} editable />
              <Field label="Project address" value={scope.address} editable />
              <Field label="Target start" value={scope.startTarget} editable />
            </div>
            <div style={{ marginTop: 16 }}>
              <div className="field__lbl" style={{ marginBottom: 6 }}>Scope summary</div>
              <div style={{
                padding: 14,
                background: "var(--surface-2)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-2)",
                lineHeight: 1.55,
                fontFamily: "var(--font-serif)",
                fontSize: 15,
              }}>
                <p style={{ margin: "0 0 8px" }}>
                  <em>{scope.projectType}</em> at {scope.address.split(",")[0]}.
                </p>
                <p style={{ margin: "0 0 8px" }}>
                  Approximately <strong className="num">{scope.sqft.toLocaleString()} sqft</strong> across {scope.stories} elevations.
                  Finish: <strong>{scope.finish}</strong>.
                </p>
                <p style={{ margin: 0 }}>
                  Preparation includes: {scope.preparation}.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__hd">
            <IcAlert size={16} style={{ color: "var(--warn)" }} />
            <h3>Brief flagged 2 things</h3>
          </div>
          <div className="card__body" style={{ padding: 0 }}>
            {scope.flags.map((f, i) => (
              <div key={i} style={{
                padding: "14px 18px",
                borderBottom: i < scope.flags.length - 1 ? "1px solid var(--line)" : "0",
                display: "flex", gap: 10,
              }}>
                <div style={{
                  width: 6, alignSelf: "stretch", borderRadius: 3,
                  background: f.kind === "warn" ? "var(--warn)" : "var(--info)",
                  flexShrink: 0,
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 8 }}>{f.text}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn--sm">
                      <IcPhone size={11} /> Text Diane
                    </button>
                    <button className="btn btn--sm btn--ghost">Skip</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__hd">
          <h3>Exclusions</h3>
          <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
            Brief pre-filled your standards; add anything specific.
          </span>
        </div>
        <div className="card__body">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {exclusions.map((ex, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px",
                background: "var(--surface-2)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-2)",
              }}>
                <IcX size={11} className="muted" />
                <span style={{ flex: 1, fontSize: 13.5 }}>{ex}</span>
                <button className="btn btn--ghost btn--sm" onClick={() => setExclusions(exclusions.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" placeholder="Add an exclusion (e.g. 'Asbestos abatement if discovered')"
                     value={newExcl} onChange={(e) => setNewExcl(e.target.value)}
                     onKeyDown={(e) => { if (e.key === "Enter" && newExcl.trim()) { setExclusions([...exclusions, newExcl]); setNewExcl(""); } }} />
              <button className="btn" disabled={!newExcl.trim()}
                      onClick={() => { setExclusions([...exclusions, newExcl]); setNewExcl(""); }}>
                <IcPlus size={12} /> Add
              </button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
        <button className="btn">Back</button>
        <button className="btn btn--accent btn--lg" onClick={() => onContinue(DEFAULT_PRICING)}>
          Continue to pricing <IcArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

/* ============ Step 3: Pricing ============ */
const DEFAULT_PRICING = {
  lines: [
    { id: "l1", code: "DEMO", desc: "Strip existing finish, dispose at site", hrs: 32, hrlyOverride: null, materialCost: 280, qty: 4200, unit: "sqft", note: "" },
    { id: "l2", code: "LATH", desc: "Repair lath + 60-min paper, replace damaged sections", hrs: 44, hrlyOverride: null, materialCost: 1840, qty: 4200, unit: "sqft", note: "+12 hrs if west elevation needs full replacement" },
    { id: "l3", code: "SCRATCH", desc: "Scratch coat, 7/8\" application", hrs: 56, hrlyOverride: null, materialCost: 2240, qty: 4200, unit: "sqft" },
    { id: "l4", code: "BROWN", desc: "Brown coat, hand-troweled", hrs: 52, hrlyOverride: null, materialCost: 2100, qty: 4200, unit: "sqft" },
    { id: "l5", code: "FINISH", desc: "Sand-float finish with integral color", hrs: 64, hrlyOverride: null, materialCost: 3680, qty: 4200, unit: "sqft" },
    { id: "l6", code: "TRIM", desc: "Detail work — windows, corners, weep screeds", hrs: 28, hrlyOverride: null, materialCost: 620, qty: 1, unit: "lot" },
  ],
  laborMarkup: 32,
  matMarkup: 18,
  contingency: 5,
  laborRate: 58,
};

function QPPricing({ payroll, scope, pricing, setPricing, onContinue }) {
  const p = pricing || DEFAULT_PRICING;

  const update = (patch) => setPricing({ ...p, ...patch });
  const updateLine = (id, patch) => {
    setPricing({
      ...p,
      lines: p.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });
  };

  const calc = useMemoQ(() => {
    const laborHrs = p.lines.reduce((s, l) => s + l.hrs, 0);
    const laborCost = p.lines.reduce((s, l) => s + l.hrs * (l.hrlyOverride || p.laborRate), 0);
    const matCost = p.lines.reduce((s, l) => s + l.materialCost, 0);
    const labor = laborCost * (1 + p.laborMarkup / 100);
    const material = matCost * (1 + p.matMarkup / 100);
    const subtotal = labor + material;
    const contingency = subtotal * (p.contingency / 100);
    const total = subtotal + contingency;
    const margin = ((total - laborCost - matCost) / total) * 100;
    return { laborHrs, laborCost, matCost, labor, material, subtotal, contingency, total, margin };
  }, [p]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 20 }}>
        <div>
          <div className="eyebrow">Step 3 of 5</div>
          <h2 className="h-display" style={{ fontSize: 32, marginTop: 6 }}>
            Adjust the math.
          </h2>
        </div>
        <div className="space" />
        <span className="muted mono" style={{ fontSize: 11 }}>
          <IcClock size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
          4 min 12 sec elapsed
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
        <div className="card">
          <div className="card__hd">
            <h3>Line items</h3>
            <span className="muted mono" style={{ fontSize: 11, marginLeft: "auto" }}>
              {p.lines.length} items · {calc.laborHrs} hrs
            </span>
          </div>
          <div className="card__body" style={{ padding: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Code</th>
                  <th>Description</th>
                  <th style={{ width: 70, textAlign: "right" }}>Hrs</th>
                  <th style={{ width: 90, textAlign: "right" }}>Material</th>
                  <th style={{ width: 100, textAlign: "right" }}>Subtotal</th>
                  <th style={{ width: 30 }}></th>
                </tr>
              </thead>
              <tbody>
                {p.lines.map((l) => {
                  const lab = l.hrs * (l.hrlyOverride || p.laborRate);
                  const sub = lab * (1 + p.laborMarkup / 100) + l.materialCost * (1 + p.matMarkup / 100);
                  return (
                    <tr key={l.id} style={{ cursor: "default" }}>
                      <td className="mono muted" style={{ fontSize: 11 }}>{l.code}</td>
                      <td>
                        <div style={{ fontWeight: 500, marginBottom: 2 }}>{l.desc}</div>
                        {l.note && <div className="muted" style={{ fontSize: 11.5, fontStyle: "italic" }}>↳ {l.note}</div>}
                      </td>
                      <td className="num" style={{ textAlign: "right" }}>
                        <input className="num" value={l.hrs} onChange={(e) => updateLine(l.id, { hrs: Number(e.target.value) || 0 })} style={{
                          width: 50, textAlign: "right", border: "1px solid transparent", background: "transparent",
                          padding: "3px 6px", borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 13,
                        }} onFocus={(e) => e.target.style.background = "var(--surface-2)"} onBlur={(e) => e.target.style.background = "transparent"} />
                      </td>
                      <td className="num" style={{ textAlign: "right" }}>{moneyK(l.materialCost)}</td>
                      <td className="num" style={{ textAlign: "right", fontWeight: 500 }}>{money(sub)}</td>
                      <td><button className="btn btn--ghost btn--sm"><IcMore size={12} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="card__ft" style={{ background: "var(--surface-2)" }}>
            <button className="btn btn--ghost btn--sm"><IcPlus size={12} /> Add line item</button>
            <div className="space" />
            <span className="muted" style={{ fontSize: 12 }}>
              Brief inferred 6 items from your last 3 stucco jobs of this size
            </span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Totals card */}
          <div className="card">
            <div className="card__hd"><h3>Totals</h3></div>
            <div className="card__body" style={{ padding: "16px 18px" }}>
              <TotalRow label="Labor" value={money(calc.labor)} sub={`${calc.laborHrs} hrs × $${p.laborRate}/hr + ${p.laborMarkup}%`} />
              <TotalRow label="Material" value={money(calc.material)} sub={`+${p.matMarkup}% markup`} />
              <TotalRow label="Contingency" value={money(calc.contingency)} sub={`${p.contingency}% buffer`} />
              <div style={{ height: 1, background: "var(--line)", margin: "10px 0" }} />
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontFamily: "var(--font-serif)", fontSize: 18 }}>Total bid</span>
                <span className="num" style={{ fontFamily: "var(--font-serif)", fontSize: 30, fontWeight: 500 }}>{money(calc.total)}</span>
              </div>
              <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between" }}>
                <span className="muted" style={{ fontSize: 12 }}>Gross margin</span>
                <span className="num" style={{ fontSize: 13, color: "var(--good)", fontWeight: 500 }}>
                  {calc.margin.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* Capacity card — depends on payroll connection */}
          <div className="card" style={{ background: payroll ? "var(--surface)" : "var(--surface-2)" }}>
            <div className="card__hd">
              <IcUsers size={15} className="muted" />
              <h3 style={{ fontSize: 14 }}>Crew capacity</h3>
              {payroll && <span className="pill pill--won" style={{ marginLeft: "auto", fontSize: 10 }}>Live</span>}
            </div>
            <div className="card__body" style={{ padding: "14px 18px" }}>
              {payroll ? (
                <>
                  <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>
                    This job needs <strong className="num">{calc.laborHrs} hrs</strong>. You have <strong className="num">{COMPANY.monthlyCapacityHrs - COMPANY.bookedHrs}</strong> hrs unbooked in May.
                  </div>
                  <div style={{ height: 8, background: "var(--bg-2)", borderRadius: 4, overflow: "hidden", display: "flex" }}>
                    <div style={{ width: (COMPANY.bookedHrs / COMPANY.monthlyCapacityHrs) * 100 + "%", background: "var(--line-strong)" }} />
                    <div style={{ width: (calc.laborHrs / COMPANY.monthlyCapacityHrs) * 100 + "%", background: "var(--accent)" }} />
                  </div>
                  <div className="muted mono" style={{ fontSize: 10.5, marginTop: 6, display: "flex", justifyContent: "space-between" }}>
                    <span>Booked {COMPANY.bookedHrs}h</span>
                    <span>+ This job</span>
                    <span>Cap {COMPANY.monthlyCapacityHrs}h</span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 12, color: "var(--muted)" }}>
                    Connect your payroll to see whether your crew has bandwidth for {calc.laborHrs} more hours this month.
                  </div>
                  <button className="btn btn--sm" style={{ width: "100%" }}>
                    <IcLink size={11} /> Connect payroll
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Knobs */}
          <div className="card">
            <div className="card__hd"><h3 style={{ fontSize: 14 }}>Pricing knobs</h3></div>
            <div className="card__body" style={{ padding: "12px 18px 16px" }}>
              <KnobRow label="Labor rate" suffix="/hr" prefix="$" value={p.laborRate} min={30} max={120} onChange={(v) => update({ laborRate: v })} />
              <KnobRow label="Labor markup" suffix="%" value={p.laborMarkup} min={0} max={60} onChange={(v) => update({ laborMarkup: v })} />
              <KnobRow label="Material markup" suffix="%" value={p.matMarkup} min={0} max={50} onChange={(v) => update({ matMarkup: v })} />
              <KnobRow label="Contingency" suffix="%" value={p.contingency} min={0} max={20} onChange={(v) => update({ contingency: v })} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
        <button className="btn">Back</button>
        <button className="btn btn--accent btn--lg" onClick={() => { setPricing(p); onContinue(); }}>
          Review & send <IcArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

function TotalRow({ label, value, sub }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0" }}>
      <div>
        <div style={{ fontSize: 13 }}>{label}</div>
        <div className="muted" style={{ fontSize: 11 }}>{sub}</div>
      </div>
      <div className="num" style={{ fontSize: 14, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function KnobRow({ label, value, min, max, prefix = "", suffix, onChange }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>
        <span className="num" style={{ fontSize: 13, fontWeight: 500 }}>{prefix}{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))}
             style={{ width: "100%", accentColor: "var(--accent)" }} />
    </div>
  );
}

/* ============ Step 4: Review ============ */
function QPReview({ intake, scope, pricing, segment, onSend, onEdit }) {
  const calc = useMemoQ(() => {
    const lr = pricing.laborRate;
    const laborCost = pricing.lines.reduce((s, l) => s + l.hrs * lr, 0);
    const matCost = pricing.lines.reduce((s, l) => s + l.materialCost, 0);
    const labor = laborCost * (1 + pricing.laborMarkup / 100);
    const material = matCost * (1 + pricing.matMarkup / 100);
    const sub = labor + material;
    const c = sub * (pricing.contingency / 100);
    return { total: sub + c, labor, material, contingency: c };
  }, [pricing]);

  const followCadence = segment === "repeat"
    ? "I'll check back Friday if I don't hear from you — totally good either way."
    : "Following up by phone Monday morning to walk through any questions.";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 20 }}>
        <div>
          <div className="eyebrow">Step 4 of 5</div>
          <h2 className="h-display" style={{ fontSize: 32, marginTop: 6 }}>One last look.</h2>
        </div>
        <div className="space" />
        <span className="muted mono" style={{ fontSize: 11 }}>
          <IcClock size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
          7 min 58 sec elapsed
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        {/* Preview */}
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="card__hd" style={{ background: "var(--surface-2)" }}>
            <IcEye size={14} className="muted" />
            <h3 style={{ fontSize: 14 }}>Client preview</h3>
            <span className="muted mono" style={{ fontSize: 11, marginLeft: "auto" }}>PDF · 3 pages</span>
          </div>
          <div className="card__body ledger-bg" style={{ padding: "30px 36px", background: "var(--surface)", minHeight: 500 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
              <div>
                <div className="brand-mark" style={{ marginBottom: 8 }}>L</div>
                <div className="h-section" style={{ fontSize: 18 }}>L·A Stucco</div>
                <div className="muted mono" style={{ fontSize: 11 }}>{COMPANY.license}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="eyebrow" style={{ marginBottom: 4 }}>Proposal</div>
                <div className="mono" style={{ fontSize: 12 }}>Q-2026-0184</div>
                <div className="muted mono" style={{ fontSize: 11 }}>Issued May 11, 2026</div>
              </div>
            </div>

            <div style={{ marginBottom: 22 }}>
              <h2 className="h-display" style={{ fontSize: 26, marginBottom: 4 }}>
                Re-stucco at <span className="italic">Ridgemoor Ln</span>
              </h2>
              <div className="muted" style={{ fontSize: 13 }}>
                Prepared for {scope.contact} at {scope.client}
              </div>
            </div>

            <div style={{ fontFamily: "var(--font-serif)", fontSize: 14, lineHeight: 1.6, marginBottom: 22 }}>
              <p style={{ margin: "0 0 10px" }}>Diane,</p>
              <p style={{ margin: "0 0 10px" }}>
                Thanks for the chance to bid on the Ridgemoor re-stucco. I walked the
                property Monday — west elevation has more lath damage than the RFP
                indicated, so I've padded the prep line accordingly. Everything else
                is straightforward 3-coat work with a sand-float finish.
              </p>
              <p style={{ margin: "0 0 10px" }}>
                We can start the week of May 27 and be off the property in 14 working
                days, weather permitting.
              </p>
              <p style={{ margin: "0" }}>{followCadence}</p>
              <p style={{ margin: "12px 0 0", fontStyle: "italic" }}>— Cavy</p>
            </div>

            <table className="tbl" style={{ marginTop: 8 }}>
              <thead>
                <tr><th>Item</th><th style={{ textAlign: "right" }}>Total</th></tr>
              </thead>
              <tbody>
                {pricing.lines.slice(0, 4).map((l) => {
                  const sub = l.hrs * pricing.laborRate * (1 + pricing.laborMarkup / 100) + l.materialCost * (1 + pricing.matMarkup / 100);
                  return (
                    <tr key={l.id}>
                      <td>{l.desc}</td>
                      <td className="num" style={{ textAlign: "right" }}>{money(sub)}</td>
                    </tr>
                  );
                })}
                <tr><td className="muted" style={{ fontStyle: "italic" }}>… plus 2 more line items</td><td></td></tr>
              </tbody>
            </table>

            <div style={{ marginTop: 24, padding: 18, background: "var(--surface-2)", borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: "var(--font-serif)", fontSize: 18 }}>Total proposal</span>
              <span className="num" style={{ fontFamily: "var(--font-serif)", fontSize: 32, fontWeight: 500 }}>{money(calc.total)}</span>
            </div>
          </div>
        </div>

        {/* Send panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="card">
            <div className="card__hd"><h3 style={{ fontSize: 14 }}>Send to</h3></div>
            <div className="card__body" style={{ padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div className="avatar"><span>DH</span></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 13.5 }}>{scope.contact}</div>
                  <div className="muted mono" style={{ fontSize: 11 }}>{scope.email}</div>
                </div>
              </div>
              <button className="btn btn--ghost btn--sm" style={{ padding: 0 }}>
                <IcPlus size={11} /> Add recipient
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card__hd"><h3 style={{ fontSize: 14 }}>Subject & cover note</h3></div>
            <div className="card__body" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <input className="input" defaultValue="Bid for Ridgemoor re-stucco — start late May" />
              <textarea className="textarea" rows={4} defaultValue={`Diane — bid attached as we discussed. ${followCadence}\n\nThanks,\nCavy`} />
              <div className="muted" style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 6 }}>
                <IcSparkle size={12} />
                Tone tuned for <strong style={{ color: "var(--ink)" }}>{segment === "repeat" ? "a repeat client" : "a cold bid"}</strong> — change in Tweaks
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__hd"><h3 style={{ fontSize: 14 }}>Follow-up cadence</h3></div>
            <div className="card__body" style={{ padding: "12px 18px" }}>
              {(segment === "repeat" ? [
                ["+3 days", "Soft check-in if no open"],
                ["+7 days", "Last nudge — keep it warm"],
              ] : [
                ["+1 day", "Phone call — leave voicemail"],
                ["+3 days", "Email — 'still interested?'"],
                ["+7 days", "Final follow-up before closing"],
              ]).map(([when, what]) => (
                <div key={when} style={{ display: "flex", gap: 10, padding: "5px 0", alignItems: "center" }}>
                  <span className="mono muted" style={{ fontSize: 11, width: 56 }}>{when}</span>
                  <span style={{ fontSize: 12.5 }}>{what}</span>
                </div>
              ))}
            </div>
          </div>

          <button className="btn btn--accent btn--lg" onClick={onSend} style={{ marginTop: 4 }}>
            <IcSend size={14} /> Send bid to {scope.contact.split(" ")[0]}
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => onEdit(2)}>
            <IcArrowLeft size={11} /> Back to pricing
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============ Step 5: Sent ============ */
function QPSent({ onDone, segment, pricing }) {
  const [elapsed, setElapsed] = useStateQ(0);
  useEffectQ(() => {
    const start = Date.now() - 9 * 60 * 1000 - 22 * 1000; // start at 9m22s
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const mm = Math.floor(elapsed / 60), ss = elapsed % 60;

  return (
    <div style={{ maxWidth: 720, margin: "20px auto" }}>
      <div className="card" style={{ textAlign: "center" }}>
        <div className="card__body" style={{ padding: "60px 40px" }}>
          <div style={{
            width: 72, height: 72, margin: "0 auto 24px",
            borderRadius: "50%",
            background: "var(--accent-tint)",
            display: "grid", placeItems: "center",
            color: "var(--accent)",
          }}>
            <IcSend size={28} />
          </div>
          <h2 className="h-display" style={{ fontSize: 32, marginBottom: 8 }}>
            Sent to Diane.
          </h2>
          <p className="muted" style={{ maxWidth: 380, margin: "0 auto 20px", lineHeight: 1.5 }}>
            That took you{" "}
            <span className="num" style={{ color: "var(--accent)", fontWeight: 500 }}>{mm}:{ss.toString().padStart(2, "0")}</span>.
            Your old way of doing this took most of an evening.
          </p>

          <div style={{ display: "flex", gap: 14, justifyContent: "center", margin: "28px 0 32px" }}>
            <Stat label="Time saved" value="~2h 51m" />
            <div style={{ width: 1, background: "var(--line)" }} />
            <Stat label="Bid value" value={money(38420)} />
            <div style={{ width: 1, background: "var(--line)" }} />
            <Stat label="Win likelihood" value="78%" hint={segment === "repeat" ? "based on repeat history" : "cold-bid baseline"} />
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button className="btn btn--accent" onClick={onDone}>
              Back to quotes <IcArrowRight size={14} />
            </button>
            <button className="btn">
              <IcPlus size={12} /> Start another
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div style={{ textAlign: "center", padding: "0 16px" }}>
      <div className="num" style={{ fontFamily: "var(--font-serif)", fontSize: 26, fontWeight: 500 }}>{value}</div>
      <div className="muted mono" style={{ fontSize: 10.5, marginTop: 2 }}>{label}</div>
      {hint && <div className="muted" style={{ fontSize: 10.5, fontStyle: "italic", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

Object.assign(window, { QuoteProduction });
