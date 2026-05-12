/* Onboarding — 7 steps. Google sign-in → upload (load-bearing trust moment)
   → license → scan → confirm → defaults → calendar → done. Vocab-aware. */

const { useState: useStateO, useEffect: useEffectO } = React;

function Onboarding({ onComplete, vocab }) {
  const v = vocab || window.VOCAB;
  const [step, setStep] = useStateO(0);
  const [license, setLicense] = useStateO(v.licenseSample);
  const [uploaded, setUploaded] = useStateO(false);
  const [scanProgress, setScanProgress] = useStateO(0);
  const [profile, setProfile] = useStateO(null);
  const [calendar, setCalendar] = useStateO("pending"); // pending | connected | declined

  useEffectO(() => {
    if (step !== 3) return;
    setScanProgress(0);
    const id = setInterval(() => {
      setScanProgress((p) => {
        const next = p + (Math.random() * 7 + 4);
        if (next >= 100) {
          clearInterval(id);
          setTimeout(() => {
            setProfile({ ...COMPANY });
            setStep(4);
          }, 400);
          return 100;
        }
        return next;
      });
    }, 220);
    return () => clearInterval(id);
  }, [step]);

  const steps = ["Sign in", "Upload", "License", "Scan", "Confirm", "Defaults", "Calendar"];

  return (
    <div style={{ maxWidth: 740, margin: "0 auto", padding: "16px 0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 36 }}>
        <div>
          <div className="eyebrow">Setting up Brief</div>
          <h1 className="h-display" style={{ fontSize: 38, margin: "6px 0 0" }}>
            {step === 7 ? "You're ready." : (<>Welcome.</>)}
          </h1>
        </div>
        <div className="stepper">
          {steps.map((_, i) => (
            <span key={i} className={
              "stepper__dot " + (i < step ? "stepper__dot--done" : i === step ? "stepper__dot--active" : "")
            } />
          ))}
        </div>
      </div>

      {step === 0 && <OnbSignIn onNext={() => setStep(1)} v={v} />}
      {step === 1 && <OnbUpload uploaded={uploaded} setUploaded={setUploaded} onNext={() => setStep(2)} v={v} />}
      {step === 2 && <OnbLicense license={license} setLicense={setLicense} onNext={() => setStep(3)} onSkip={() => { setProfile({ ...COMPANY, license: "" }); setStep(4); }} v={v} />}
      {step === 3 && <OnbScanning progress={scanProgress} license={license} uploaded={uploaded} v={v} />}
      {step === 4 && <OnbProfile profile={profile} skipped={!license} onNext={() => setStep(5)} v={v} />}
      {step === 5 && <OnbDefaults onNext={() => setStep(6)} v={v} />}
      {step === 6 && <OnbCalendar calendar={calendar} setCalendar={setCalendar} onNext={() => setStep(7)} v={v} />}
      {step === 7 && <OnbDone onComplete={onComplete} v={v} />}
    </div>
  );
}

/* ── Step 0: Google sign-in ───────────────────────────────── */
function OnbSignIn({ onNext, v }) {
  return (
    <div className="card">
      <div className="card__body" style={{ padding: 44, textAlign: "center" }}>
        <p className="h-section" style={{ marginBottom: 8, fontSize: 22 }}>
          Sign in to start.
        </p>
        <p className="muted" style={{ marginBottom: 28, maxWidth: 460, marginLeft: "auto", marginRight: "auto", lineHeight: 1.6 }}>
          Brief uses your Google account for sign-in only. Nothing else is read until you connect things yourself.
        </p>
        <button onClick={onNext} style={{
          display: "inline-flex", alignItems: "center", gap: 10,
          padding: "11px 20px", background: "var(--surface)",
          border: "1px solid var(--line-strong)", borderRadius: 8,
          fontSize: 14, fontWeight: 500, cursor: "pointer",
        }}>
          <GoogleG /> Continue with Google
        </button>
        <div className="muted mono" style={{ fontSize: 11, marginTop: 22 }}>
          We'll never email you marketing. Sign-in token only.
        </div>
      </div>
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.79 2.72v2.26h2.9c1.7-1.56 2.69-3.87 2.69-6.62z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 009 18z"/>
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 013.66 9c0-.59.1-1.16.29-1.7V4.96H.96A9 9 0 000 9c0 1.45.35 2.83.96 4.04l2.99-2.34z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 00.96 4.96L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z"/>
    </svg>
  );
}

/* ── Step 1: Upload (load-bearing trust moment) ───────────── */
function OnbUpload({ uploaded, setUploaded, onNext, v }) {
  const examples = v.workWord === "proposal"
    ? ["A past proposal PDF", "Your studio website", "An old engagement letter"]
    : ["A past quote PDF", "Your shop website", "An old estimate or invoice"];
  return (
    <div className="card">
      <div className="card__body" style={{ padding: 36 }}>
        <p className="h-section" style={{ marginBottom: 8 }}>
          Show Brief one thing you've already written.
        </p>
        <p style={{ fontFamily: "var(--font-serif)", fontSize: 16, color: "var(--ink-2)", marginBottom: 22, maxWidth: 560, lineHeight: 1.6 }}>
          A past {v.workWord}, your website, or even a rough email you sent a client.
          Brief reads it to learn your voice — the way you scope, the way you price,
          the way you sign off. It's the difference between Brief sounding like
          <em> you</em> and Brief sounding like a chatbot.
        </p>

        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr",
          gap: 12, marginBottom: 22,
        }}>
          <UploadCard
            done={uploaded}
            title="Drop a file"
            sub="PDF, DOCX, or screenshot"
            onClick={() => setUploaded("doc")}
          />
          <UploadCard
            done={uploaded === "url"}
            title="Or paste a URL"
            sub="Your site, a past project page"
            onClick={() => setUploaded("url")}
            input
          />
        </div>

        <div className="muted" style={{ fontSize: 12.5, marginBottom: 18 }}>
          Examples: {examples.join(" · ")}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn btn--accent btn--lg" disabled={!uploaded} onClick={onNext} style={{ opacity: uploaded ? 1 : 0.5 }}>
            {uploaded ? "Use this to learn my voice" : "Pick something first"} <IcArrowRight size={14} />
          </button>
          <button className="btn btn--ghost btn--lg" onClick={onNext}>I'd rather skip</button>
        </div>
      </div>
      <div className="card__ft" style={{ background: "var(--surface-2)", borderTop: "1px solid var(--line)" }}>
        <IcLock size={12} className="muted" />
        <span className="muted" style={{ fontSize: 12 }}>
          Your file stays in your workspace. We don't use it to train shared models.
        </span>
      </div>
    </div>
  );
}

function UploadCard({ done, title, sub, onClick, input }) {
  return (
    <button onClick={onClick} style={{
      textAlign: "left", padding: 18,
      background: done ? "var(--accent-tint)" : "var(--surface)",
      border: `1px ${done ? "solid" : "dashed"} ${done ? "var(--accent)" : "var(--line-2)"}`,
      borderRadius: "var(--radius-2)", cursor: "pointer",
      display: "flex", gap: 12, alignItems: "flex-start",
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: done ? "var(--accent)" : "var(--surface-2)",
        color: done ? "var(--accent-ink)" : "var(--muted)",
        display: "grid", placeItems: "center", flexShrink: 0,
      }}>
        {done ? <IcCheck size={14} /> : input ? <IcLink size={14} /> : <IcUpload size={14} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 13.5, marginBottom: 2 }}>
          {done ? "Got it. Brief is reading…" : title}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {done ? "You can swap or remove this later." : sub}
        </div>
      </div>
    </button>
  );
}

/* ── Step 2: License / business record (OPTIONAL) ─────────
   Not every business has a public record to pull from. We offer
   the speed-up path if applicable, and a clear manual path always. */
function OnbLicense({ license, setLicense, onNext, onSkip, v }) {
  const [mode, setMode] = useStateO("choose"); // choose | lookup

  if (mode === "choose") {
    return (
      <div className="card">
        <div className="card__body" style={{ padding: 36 }}>
          <p className="h-section" style={{ marginBottom: 8 }}>
            Want to save a few minutes?
          </p>
          <p style={{ fontFamily: "var(--font-serif)", fontSize: 16, color: "var(--ink-2)", marginBottom: 24, maxWidth: 540, lineHeight: 1.6 }}>
            If your business has a <em>public</em> record — a contractor license,
            a state registry, a professional board listing — Brief can read it
            and pre-fill your profile. Most businesses don't have one, and that's
            fine. You can fill the profile out yourself in about a minute.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ChoiceCard
              onClick={() => setMode("lookup")}
              icon={<IcSparkle size={14} style={{ color: "var(--accent)" }} />}
              title="Look up a public record"
              sub={`Contractor license, state business registry, or similar. We'll show you what we found before saving anything.`}
            />
            <ChoiceCard
              onClick={onSkip}
              icon={<IcEdit size={14} className="muted" />}
              title="I'll fill it out myself"
              sub="Faster if you don't have a public listing. You'll see a short form next."
            />
          </div>
        </div>
        <div className="card__ft" style={{ background: "var(--surface-2)", borderTop: "1px solid var(--line)" }}>
          <IcLock size={12} className="muted" />
          <span className="muted" style={{ fontSize: 12 }}>
            Public records only. We never pull bank or tax info during setup.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card__body" style={{ padding: 36 }}>
        <button className="btn btn--ghost btn--sm" onClick={() => setMode("choose")} style={{ marginBottom: 18 }}>
          <IcArrowLeft size={11} /> Back
        </button>
        <p className="h-section" style={{ marginBottom: 8 }}>
          Paste a record we can read.
        </p>
        <p className="muted" style={{ marginBottom: 24, maxWidth: 520, lineHeight: 1.6 }}>
          A contractor license number, a state business registry ID, a board
          listing URL — anything public works. Don't have one? <button className="link" onClick={onSkip} style={{ background: "none", border: 0, color: "var(--accent)", padding: 0, cursor: "pointer", textDecoration: "underline" }}>Skip this step</button>.
        </p>
        <div className="field" style={{ marginBottom: 24 }}>
          <label className="field__lbl">License or registry number (optional)</label>
          <input className="input" value={license} onChange={(e) => setLicense(e.target.value)} placeholder={`e.g. ${v.licenseSample}`} />
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn btn--accent btn--lg" onClick={onNext}>
            Look it up <IcArrowRight size={14} />
          </button>
          <button className="btn btn--ghost btn--lg" onClick={onSkip}>Skip — I'll fill it in</button>
          <div className="space" />
          <div className="muted mono" style={{ fontSize: 11 }}>~30 sec</div>
        </div>
      </div>
      <div className="card__ft" style={{ background: "var(--surface-2)", borderTop: "1px solid var(--line)" }}>
        <IcLock size={12} className="muted" />
        <span className="muted" style={{ fontSize: 12 }}>{v.licenseHint}</span>
      </div>
    </div>
  );
}

function ChoiceCard({ onClick, icon, title, sub }) {
  return (
    <button onClick={onClick} style={{
      textAlign: "left", padding: 16,
      background: "var(--surface)",
      border: "1px solid var(--line-2)",
      borderRadius: "var(--radius-2)", cursor: "pointer",
      display: "flex", gap: 12, alignItems: "flex-start",
    }}>
      <div style={{ marginTop: 2 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 3 }}>{title}</div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{sub}</div>
      </div>
      <IcArrowRight size={14} className="muted" style={{ marginTop: 4 }} />
    </button>
  );
}

/* ── Step 3: Scan ─────────────────────────────────────────── */
function OnbScanning({ progress, license, uploaded, v }) {
  const isCavy = v.workWord === "quote";
  const tasks = isCavy ? [
    { at: 12, label: `Found license — ${COMPANY.trade.split(" · ")[0]} · Active since ${COMPANY.founded}` },
    { at: 30, label: `Pulling ${new Date().getFullYear() - COMPANY.founded} years of permit history` },
    { at: 48, label: "Identifying typical project size & geography" },
    { at: 66, label: "Reading the document you uploaded for tone" },
    { at: 82, label: "Composing your shop profile" },
  ] : [
    { at: 12, label: `Found GE record — Active since ${COMPANY.founded}` },
    { at: 30, label: "Reading your studio website for past clients" },
    { at: 48, label: "Identifying typical engagement shape" },
    { at: 66, label: "Reading the document you uploaded for voice" },
    { at: 82, label: "Composing your studio profile" },
  ];
  return (
    <div className="card">
      <div className="card__body" style={{ padding: 36, minHeight: 360 }}>
        <p className="h-section" style={{ marginBottom: 8 }}>
          Working on <span className="mono" style={{ fontSize: 14 }}>{license}</span>
        </p>
        <p className="muted" style={{ marginBottom: 28 }}>
          Reading {uploaded ? "5" : "4"} sources in parallel. Don't refresh.
        </p>

        <div style={{ height: 6, background: "var(--bg-2)", borderRadius: 999, overflow: "hidden", marginBottom: 32 }}>
          <div style={{
            height: "100%",
            width: progress + "%",
            background: "var(--accent)",
            transition: "width 0.3s ease",
          }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {tasks.map((t, i) => {
            const done = progress >= t.at + 5;
            const active = progress >= t.at && !done;
            return (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 12,
                opacity: progress >= t.at ? 1 : 0.3,
                transition: "opacity 0.4s ease",
              }}>
                {done ? <IcCheck size={16} style={{ color: "var(--good)" }} />
                  : active ? <div className="spinner" />
                  : <div style={{ width: 16, height: 16, borderRadius: 50, border: "1.5px dashed var(--line-strong)" }} />}
                <span style={{ fontSize: 13.5 }}>{t.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Step 4: Profile confirm (or manual entry if skipped) ─ */
function OnbProfile({ profile, onNext, skipped, v }) {
  if (!profile) return null;
  const isCavy = v.workWord === "quote";
  if (skipped) {
    return (
      <div>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__hd">
            <IcEdit size={16} className="muted" />
            <h3>Tell us about your {isCavy ? "shop" : "studio"}.</h3>
            <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>Takes about a minute</span>
          </div>
          <div className="card__body">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label={isCavy ? "Shop name" : "Studio name"} value={profile.name} editable />
              <Field label={v.ownerRole} value={profile.owner} editable />
              <Field label="What you do" value={profile.trade} editable />
              <Field label="Region" value={profile.region} editable />
              <Field label="Founded" value={String(profile.founded)} editable />
              <Field label="Crew / team size" value={String(profile.crewSize)} editable />
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn--accent btn--lg" onClick={onNext}>
            Save & keep going <IcArrowRight size={14} />
          </button>
        </div>
      </div>
    );
  }
  const recents = isCavy ? [
    ["2025", "1822 Marine Ave · Santa Monica", "Stucco façade", "$12.4k"],
    ["2024", "8 Mulholland Crest · LA", "Full stucco · custom home", "$84k"],
    ["2024", "229 Olive · Burbank", "Multi-unit ADU", "$71k"],
    ["2023", "418 Ridgemoor · Pasadena", "Re-stucco + repair", "$38k"],
  ] : [
    ["2025", "Pacific Vinyasa", "Class-pack collateral", "$6.8k"],
    ["2024", "Lanikai Surf Co.", "Capsule packaging system", "$18.2k"],
    ["2024", "Mākaha Bank", "Mobile banking refresh", "$56k"],
    ["2023", "Pacific Vinyasa", "Initial brand identity", "$24k"],
  ];

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__hd">
          <IcCircleCheck size={18} style={{ color: "var(--good)" }} />
          <h3>We found you. Confirm what's right.</h3>
        </div>
        <div className="card__body">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Shop name" value={profile.name} editable />
            <Field label={v.ownerRole} value={profile.owner} editable />
            <Field label="Trade" value={profile.trade} editable />
            <Field label={v.licenseLabel} value={profile.license} editable />
            <Field label="Region" value={profile.region} editable />
            <Field label="Founded" value={String(profile.founded)} editable />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__hd">
          <IcLayers size={16} className="muted" />
          <h3>Recent {isCavy ? "projects" : "engagements"} we found</h3>
          <span className="muted mono" style={{ fontSize: 11, marginLeft: "auto" }}>
            {isCavy ? "34 permits · 8 years · 92% completion rate" : "11 engagements visible · 5 years"}
          </span>
        </div>
        <div className="card__body" style={{ padding: 0 }}>
          <table className="tbl">
            <tbody>
              {recents.map((r, i) => (
                <tr key={i}>
                  <td className="mono muted" style={{ width: 60 }}>{r[0]}</td>
                  <td style={{ fontWeight: 500 }}>{r[1]}</td>
                  <td className="muted">{r[2]}</td>
                  <td className="num" style={{ textAlign: "right", width: 80 }}>{r[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn--accent btn--lg" onClick={onNext}>
          Looks right — keep going <IcArrowRight size={14} />
        </button>
        <button className="btn btn--lg">Edit something</button>
      </div>
    </div>
  );
}

function Field({ label, value, editable }) {
  return (
    <div className="field">
      <div className="field__lbl">{label}</div>
      <div style={{
        padding: "10px 12px",
        background: "var(--surface-2)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-2)",
        fontSize: 14,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ flex: 1 }}>{value}</span>
        {editable && <IcEdit size={12} className="muted" />}
      </div>
    </div>
  );
}

/* ── Step 5: Defaults ─────────────────────────────────────── */
function OnbDefaults({ onNext, v }) {
  const isCavy = v.workWord === "quote";
  const [labor, setLabor] = useStateO(isCavy ? 58 : 165);
  const [matMarkup, setMatMarkup] = useStateO(isCavy ? 18 : 0);
  const [labMarkup, setLabMarkup] = useStateO(isCavy ? 32 : 38);

  const hrsPerJob = isCavy ? 96 : 120;
  const matPerJob = isCavy ? 3200 : 0;
  const estTotal = labor * hrsPerJob * (1 + labMarkup / 100) + matPerJob * (1 + matMarkup / 100);
  const estMarginPct = isCavy
    ? (((labor * hrsPerJob * labMarkup / 100 + matPerJob * matMarkup / 100) / estTotal) * 100)
    : (labMarkup / (100 + labMarkup) * 100);

  return (
    <div className="card">
      <div className="card__hd">
        <IcDollar size={16} className="muted" />
        <h3>Just {isCavy ? "three" : "two"} numbers we need from you.</h3>
        <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
          You can change these any time
        </span>
      </div>
      <div className="card__body" style={{ padding: 28 }}>
        <p className="muted" style={{ marginBottom: 24, maxWidth: 480 }}>
          These set defaults for new {v.workWordPl}. Brief learns from each {v.jobWord} and tightens them automatically.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: isCavy ? "1fr 1fr 1fr" : "1fr 1fr", gap: 16 }}>
          <Slider label={v.hourlyLabel} value={labor} setValue={setLabor} min={isCavy ? 30 : 80} max={isCavy ? 120 : 280} prefix="$" />
          {isCavy && <Slider label="Material markup" value={matMarkup} setValue={setMatMarkup} min={0} max={50} suffix="%" />}
          <Slider label={isCavy ? "Labor markup" : "Margin target"} value={labMarkup} setValue={setLabMarkup} min={0} max={60} suffix="%" />
        </div>

        <div style={{
          marginTop: 32, padding: 18,
          background: "var(--surface-2)",
          border: "1px dashed var(--line-2)",
          borderRadius: "var(--radius-2)",
          display: "flex", alignItems: "flex-start", gap: 12,
        }}>
          <IcSparkle size={16} style={{ color: "var(--accent)", marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>Your typical {v.jobWord}</div>
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
              Based on your history, an average {v.jobWord} at this rate would land around{" "}
              <span className="num" style={{ color: "var(--ink)", fontWeight: 500 }}>${Math.round(estTotal).toLocaleString()}</span>
              {" "}with about a {estMarginPct.toFixed(0)}% gross margin.
            </div>
          </div>
        </div>
      </div>
      <div className="card__ft">
        <button className="btn btn--accent" onClick={onNext}>
          Save & continue <IcArrowRight size={14} />
        </button>
        <button className="btn btn--ghost">Use Brief's defaults</button>
      </div>
    </div>
  );
}

function Slider({ label, value, setValue, min, max, prefix = "", suffix = "" }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span className="field__lbl">{label}</span>
        <span className="num" style={{ fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 500 }}>
          {prefix}{value}{suffix}
        </span>
      </div>
      <input type="range" min={min} max={max} value={value}
             onChange={(e) => setValue(Number(e.target.value))}
             style={{ width: "100%", accentColor: "var(--accent)" }} />
      <div className="muted mono" style={{ fontSize: 10, display: "flex", justifyContent: "space-between", marginTop: 2 }}>
        <span>{prefix}{min}{suffix}</span>
        <span>{prefix}{max}{suffix}</span>
      </div>
    </div>
  );
}

/* ── Step 6: Calendar ─────────────────────────────────────── */
function OnbCalendar({ calendar, setCalendar, onNext, v }) {
  return (
    <div className="card">
      <div className="card__hd">
        <IcCalendar size={16} className="muted" />
        <h3>One last thing — your week.</h3>
      </div>
      <div className="card__body" style={{ padding: 28 }}>
        <p style={{ fontFamily: "var(--font-serif)", fontSize: 16, lineHeight: 1.6, marginBottom: 22, maxWidth: 540 }}>
          Brief can read your Google Calendar to see when you're booked — site visits,
          deep-work blocks, days off. Nothing is changed. Brief uses it only to draft
          smarter follow-up timing and avoid scheduling a {v.jobWord} kickoff during
          your busy days.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <CalendarOption
            selected={calendar === "connected"}
            onClick={() => setCalendar("connected")}
            title="Read my Google Calendar"
            sub="Read-only. Brief creates a separate 'Brief' calendar for any items it suggests."
            icon={<GoogleG />}
          />
          <CalendarOption
            selected={calendar === "declined"}
            onClick={() => setCalendar("declined")}
            title="Not now"
            sub={`Brief will still work — Agenda just won't know when you're booked.`}
            icon={<IcLock size={14} className="muted" />}
          />
        </div>

        {calendar === "connected" && (
          <div style={{
            marginTop: 18, padding: 14, background: "var(--good-tint)",
            borderRadius: 6, fontSize: 13, lineHeight: 1.5,
            display: "flex", gap: 10,
          }}>
            <IcCheck size={14} style={{ color: "var(--good)", marginTop: 2, flexShrink: 0 }} />
            <span>
              Connected. You'll find this under Settings → Integrations any time you want to disconnect.
            </span>
          </div>
        )}
      </div>
      <div className="card__ft">
        <button className="btn btn--accent" disabled={calendar === "pending"} onClick={onNext} style={{ opacity: calendar === "pending" ? 0.5 : 1 }}>
          {calendar === "declined" ? "Skip for now" : "Finish setup"} <IcArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

function CalendarOption({ selected, onClick, title, sub, icon }) {
  return (
    <button onClick={onClick} style={{
      textAlign: "left", padding: 16,
      background: selected ? "var(--accent-tint)" : "var(--surface)",
      border: `1px solid ${selected ? "var(--accent)" : "var(--line-2)"}`,
      borderRadius: "var(--radius-2)", cursor: "pointer",
      display: "flex", gap: 12, alignItems: "flex-start",
    }}>
      <div style={{ marginTop: 2 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 3 }}>{title}</div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{sub}</div>
      </div>
      {selected && <IcCheck size={14} style={{ color: "var(--accent)" }} />}
    </button>
  );
}

/* ── Step 7: Done ─────────────────────────────────────────── */
function OnbDone({ onComplete, v }) {
  return (
    <div className="card" style={{ textAlign: "center" }}>
      <div className="card__body" style={{ padding: "56px 40px" }}>
        <div style={{
          width: 64, height: 64, margin: "0 auto 20px",
          borderRadius: "50%",
          background: "var(--accent-tint)",
          display: "grid", placeItems: "center",
          color: "var(--accent)",
        }}>
          <IcCheck size={28} />
        </div>
        <h2 className="h-display" style={{ fontSize: 32, marginBottom: 8 }}>
          You're ready, {v.ownerFirst}.
        </h2>
        <p style={{ fontFamily: "var(--font-serif)", maxWidth: 420, margin: "0 auto 28px", lineHeight: 1.6, fontSize: 15.5, color: "var(--ink-2)" }}>
          Your {v.crewWord === "studio" ? "studio" : "shop"} is set up. Try the part of Brief that pays for itself —
          a {v.workWord} in ten minutes.
        </p>
        <button className="btn btn--accent btn--lg" onClick={onComplete}>
          <IcZap size={14} /> Make my first {v.workWord}
        </button>
      </div>
    </div>
  );
}

Object.assign(window, { Onboarding });
