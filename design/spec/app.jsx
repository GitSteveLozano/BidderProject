/* Main app shell — nav, routing, tweaks wiring, persona switcher */

const { useState: useStateA, useEffect: useEffectA } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "paper",
  "density": "cozy",
  "persona": "cavy",
  "dataState": "calibrated",
  "payroll": true,
  "segment": "repeat",
  "onboarded": true,
  "viewport": "desktop",
  "agendaQuiet": false,
  "highVariance": false,
  "selectedQuote": "Q-2026-0184",
  "qdActivityFocus": "normal",
  "qdEditOpen": false
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  // Expose for screenshot harness
  window.briefSetTweak = setTweak;

  // ── Bind persona + dataState to window globals BEFORE child render
  const p = PERSONAS[t.persona] || PERSONAS.cavy;
  const filtered = filterByState(p, t.dataState);
  window.COMPANY = p.COMPANY;
  window.VOCAB = p.VOCAB;
  window.SAMPLE_QUOTES = filtered.QUOTES;
  window.SAMPLE_JOBS = filtered.JOBS;
  window.SAMPLE_CLIENTS = filtered.CLIENTS;
  window.DATA_STATE = t.dataState;

  const [route, setRoute] = useStateA(t.onboarded ? "dashboard" : "onboarding");
  window.briefSetRoute = setRoute;

  // Theme + density on root
  useEffectA(() => {
    document.documentElement.setAttribute("data-theme", t.theme);
    document.documentElement.setAttribute("data-density", t.density);
    document.documentElement.setAttribute("data-viewport", t.viewport);
    document.title = `Brief · ${p.VOCAB.appShop}`;
  }, [t.theme, t.density, t.persona, t.viewport]);

  useEffectA(() => { if (!t.onboarded) setRoute("onboarding"); }, [t.onboarded]);

  // Re-key full subtree when persona or dataState changes so screens reset cleanly
  const dataKey = `${t.persona}:${t.dataState}`;

  const goNew = () => setRoute("newquote");
  const finishOnboarding = () => { setTweak("onboarded", true); setRoute("dashboard"); };

  return (
    <div className="app">
      <Sidebar route={route} setRoute={setRoute} onNew={goNew} vocab={p.VOCAB} dataState={t.dataState} />
      <div className="main">
        <Topbar route={route} setRoute={setRoute} vocab={p.VOCAB} />
        <div className="page" style={route === "newquote" ? { padding: "var(--pad-3) var(--pad-4)" } : {}} key={dataKey}>
          {route === "onboarding" && <Onboarding onComplete={finishOnboarding} vocab={p.VOCAB} />}
          {route === "dashboard" && <Dashboard payroll={t.payroll} segment={t.segment} dataState={t.dataState} vocab={p.VOCAB} onOpenNew={goNew} onNav={setRoute} />}
          {route === "quotes" && <Pipeline onOpenNew={goNew} segment={t.segment} dataState={t.dataState} vocab={p.VOCAB} quiet={t.agendaQuiet} />}
          {route === "jobs" && <Jobs payroll={t.payroll} dataState={t.dataState} vocab={p.VOCAB} onOpenNew={goNew} highVariance={t.highVariance} />}
          {route === "clients" && <Clients dataState={t.dataState} vocab={p.VOCAB} onOpenNew={goNew} />}
          {route === "settings" && <Settings payroll={t.payroll} vocab={p.VOCAB} />}
          {route === "newquote" && <QuoteProduction payroll={t.payroll} segment={t.segment} vocab={p.VOCAB} onSent={() => {}} onBack={() => setRoute("quotes")} />}
          {route === "quotedetail" && <QuoteDetail quoteId={t.selectedQuote} vocab={p.VOCAB} initialEdit={t.qdEditOpen} activityFocus={t.qdActivityFocus} onBack={() => setRoute("quotes")} />}
        </div>
      </div>

      <TweaksPanel title="Tweaks">
        <TweakSection title="Persona">
          <TweakRadio label="Whose Brief?" value={t.persona} onChange={(v) => setTweak("persona", v)} options={[
            { value: "cavy", label: "Cavy" },
            { value: "marlon", label: "Marlon" },
          ]} hint="Cavy: stucco contractor in LA. Marlon: branding studio in Honolulu." />
          <TweakRadio label="Calibration" value={t.dataState} onChange={(v) => setTweak("dataState", v)} options={[
            { value: "cold-start", label: "Cold" },
            { value: "seeded", label: "Seeded" },
            { value: "calibrated", label: "Calib." },
          ]} hint="How much Brief has learned about you." />
        </TweakSection>
        <TweakSection title="Aesthetic">
          <TweakRadio label="Colorway" value={t.theme} onChange={(v) => setTweak("theme", v)} options={[
            { value: "paper", label: "Paper" },
            { value: "graph", label: "Graph" },
            { value: "site", label: "Site" },
          ]} />
          <TweakRadio label="UI density" value={t.density} onChange={(v) => setTweak("density", v)} options={[
            { value: "compact", label: "Compact" },
            { value: "cozy", label: "Cozy" },
            { value: "comfortable", label: "Comfort" },
          ]} />
        </TweakSection>
        <TweakSection title="Behavior">
          <TweakToggle label="Payroll connected" value={t.payroll} onChange={(v) => setTweak("payroll", v)} hint="ProService Hawaii integration — capacity-aware pricing + reconciliation" />
          <TweakRadio label="Client segment focus" value={t.segment} onChange={(v) => setTweak("segment", v)} options={[
            { value: "repeat", label: "Repeat" },
            { value: "cold", label: "Cold-bid" },
          ]} hint="Changes follow-up cadence + tone" />
        </TweakSection>
        <TweakSection title="Demo">
          <TweakToggle label="Skip onboarding" value={t.onboarded} onChange={(v) => setTweak("onboarded", v)} hint="Turn off to replay the onboarding flow" />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

/* === Sidebar =============================================== */
function Sidebar({ route, setRoute, onNew, vocab, dataState }) {
  const calib = STATE_DESCRIBE[dataState] || STATE_DESCRIBE.calibrated;
  const activeQuotes = SAMPLE_QUOTES.filter(q => ["DRAFT","SENT","AWAITING","RESPONDED"].includes(q.state)).length;
  const liveJobs = SAMPLE_JOBS.filter(j => j.status === "INPROGRESS" || j.status === "SCHEDULED").length;
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="brand-mark">B</div>
        <div className="brand-word">Brief</div>
      </div>

      <div className="sidebar__shop">
        <div className="shop-avatar">{vocab.initial}</div>
        <div className="shop-meta">
          <div className="name">{vocab.appShop}</div>
          <div className="sub">{vocab.ownerFirst} · {vocab.ownerRole}</div>
        </div>
        <IcChevronDown size={12} className="muted" />
      </div>

      <button className="btn btn--accent btn--wide" onClick={onNew}>
        <IcPlus size={14} /> {vocab.newCta}
      </button>

      <nav className="nav">
        <NavItem icon={<IcDashboard />} label="Dashboard" route="dashboard" active={route} setRoute={setRoute} />
        <NavItem icon={<IcQuote />} label={vocab.workWordPlCap} route="quotes" active={route} setRoute={setRoute} badge={activeQuotes || undefined} />
        <NavItem icon={<IcJob />} label={vocab.jobWordPlCap} route="jobs" active={route} setRoute={setRoute} badge={liveJobs || undefined} />
        <NavItem icon={<IcClient />} label="Clients" active={route} route="clients" setRoute={setRoute} />
      </nav>

      <div className="nav__group-label">Account</div>
      <nav className="nav">
        <NavItem icon={<IcSettings />} label="Settings" route="settings" active={route} setRoute={setRoute} />
      </nav>

      <div style={{ marginTop: "auto", borderTop: "1px solid var(--line)", paddingTop: 14 }}>
        <div className="calib-pill" data-state={dataState}>
          <span className="calib-pill__dot" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="calib-pill__label">{calib.label}</div>
            <div className="calib-pill__sub">{calib.sub}</div>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 11, fontFamily: "var(--font-mono)", lineHeight: 1.5, marginTop: 10 }}>
          Brief proposes; you decide.<br/>
          <span style={{ opacity: 0.7 }}>v1.0 · Monday May 11</span>
        </div>
      </div>
    </aside>
  );
}

function NavItem({ icon, label, route, active, setRoute, badge }) {
  return (
    <button className={`nav__item ${active === route ? "is-active" : ""}`} onClick={() => setRoute(route)}>
      {icon}
      <span>{label}</span>
      {badge !== undefined && <span className="nav__badge">{badge}</span>}
    </button>
  );
}

/* === Topbar ================================================ */
function Topbar({ route, setRoute, vocab }) {
  const labels = {
    onboarding: "Set up your shop",
    dashboard: "Dashboard",
    quotes: vocab.workWordPlCap,
    quotedetail: vocab.workWord + " detail",
    jobs: vocab.jobWordPlCap,
    clients: "Clients",
    settings: "Settings",
    newquote: vocab.newCta,
  };
  return (
    <div className="topbar">
      <div className="crumbs">
        <span>{vocab.appShop}</span>
        <span className="sep">/</span>
        <span className="now">{labels[route] || route}</span>
      </div>
      <div className="topbar__spacer" />
      <div className="search">
        <IcSearch size={14} />
        <input placeholder={`Search ${vocab.workWordPl}, clients, ${vocab.jobWordPl}…`} />
        <span className="kbd">⌘K</span>
      </div>
    </div>
  );
}

/* mount */
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
