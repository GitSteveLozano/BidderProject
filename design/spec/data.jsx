/* Sample data — two parallel personas (Cavy / Marlon), three calibration states */

/* ───────── Cavy: L·A Stucco (contractor) ───────── */

const CAVY_COMPANY = {
  name: "L·A Stucco",
  owner: "Carlos 'Cavy' Alvarado",
  ownerFirst: "Cavy",
  trade: "Stucco · EIFS · Exterior Plaster",
  region: "Los Angeles County",
  license: "C-35 #1089342",
  founded: 2014,
  crewSize: 7,
  hourlyAvg: 58,
  monthlyCapacityHrs: 1120,
  bookedHrs: 760,
  avgMaterialMarkup: 18,
  avgLaborMarkup: 32,
  avgQuoteSize: 18400,
};

const CAVY_QUOTES_FULL = [
  { id: "Q-2026-0184", client: "Halsted & Sons Contracting", contact: "Diane Halsted", project: "Spec home — 3-coat stucco re-do", address: "418 Ridgemoor Ln, Pasadena", sqft: 4200, total: 38420, state: "RESPONDED", sent: "May 6", age: 5, margin: 31, relationship: "repeat", lastJobs: 4, likelihood: 0.78, nextStep: "Diane asked about a smoother sand-float finish — call back today" },
  { id: "Q-2026-0183", client: "Vermont Modern LLC", contact: "Priya Shah", project: "Two-story addition · scratch+brown coat", address: "1822 Vermont Ave, Glendale", sqft: 1850, total: 22150, state: "AWAITING", sent: "May 4", age: 7, margin: 27, relationship: "cold", lastJobs: 0, likelihood: 0.42, nextStep: "Follow up — Priya hasn't opened the PDF since Friday" },
  { id: "Q-2026-0182", client: "GC Pacific Builders", contact: "Marco Ruiz", project: "5-unit ADU complex — full stucco", address: "229 W Olive, Burbank", sqft: 7400, total: 71800, state: "SENT", sent: "May 9", age: 2, margin: 29, relationship: "repeat", lastJobs: 11, likelihood: 0.84, nextStep: "Marco bids on Friday — no action needed yet" },
  { id: "Q-2026-0181", client: "Westside Restoration", contact: "Tom Beckett", project: "Mediterranean façade repair · 2 elevations", address: "642 Marine Ave, Santa Monica", sqft: 1100, total: 14200, state: "WON", sent: "Apr 24", won: "May 1", age: 17, margin: 34, relationship: "repeat", lastJobs: 2, likelihood: 1.0, nextStep: "Starts May 18" },
  { id: "Q-2026-0180", client: "Hilltop Custom Homes", contact: "Joel Park", project: "Custom home · acrylic finish 7000 sqft", address: "8 Mulholland Crest, LA", sqft: 7000, total: 88600, state: "LOST", sent: "Apr 18", age: 23, margin: 22, relationship: "cold", lastJobs: 0, likelihood: 0, nextStep: "Lost to Pacific Plastering — $11K under" },
  { id: "Q-2026-0179", client: "Halsted & Sons Contracting", contact: "Diane Halsted", project: "Garage conversion patch + texture match", address: "418 Ridgemoor Ln, Pasadena", sqft: 480, total: 4850, state: "WON", sent: "Apr 12", won: "Apr 15", age: 29, margin: 38, relationship: "repeat", lastJobs: 4, likelihood: 1.0 },
  { id: "Q-2026-0178", client: "Solano Property Group", contact: "Renée Solano", project: "8-unit apt building — repaint + patch", address: "311 N Fair Oaks, Pasadena", sqft: 11200, total: 42400, state: "DRAFT", sent: "—", age: 0, margin: 24, relationship: "cold", lastJobs: 0, likelihood: 0.5, nextStep: "Draft ready — review crew availability" },
];

const CAVY_JOBS_FULL = [
  { id: "J-0142", name: "Marine Ave façade", client: "Westside Restoration", quoteId: "Q-2026-0181", status: "INPROGRESS", pctComplete: 62, quotedTotal: 14200, bookedCost: 6840, quotedLaborHrs: 96, actualLaborHrs: 64, quotedMaterial: 3200, actualMaterial: 2880, startDate: "May 18", endTarget: "May 24", crew: "Iván + 2", margin: 34, projectedMargin: 36 },
  { id: "J-0141", name: "Ridgemoor garage", client: "Halsted & Sons", quoteId: "Q-2026-0179", status: "CLOSED", pctComplete: 100, quotedTotal: 4850, bookedCost: 2780, actualTotal: 5980, quotedLaborHrs: 32, actualLaborHrs: 48, quotedMaterial: 950, actualMaterial: 1240, startDate: "Apr 22", endTarget: "Apr 24", endActual: "Apr 28", crew: "Iván + 1", margin: 38, actualMargin: 21, varianceNote: "Crew hit an unmarked vent stack mid-coat; added 1.5 days to chase a clean transition." },
  { id: "J-0140", name: "Olive ADU complex", client: "GC Pacific", quoteId: null, status: "SCHEDULED", pctComplete: 0, quotedTotal: 71800, quotedLaborHrs: 420, quotedMaterial: 14200, startDate: "Jun 2", endTarget: "Jul 10", crew: "Iván + 3, Sergio + 2", margin: 29 },
];

const CAVY_CLIENTS_FULL = [
  { id: "C-001", name: "Halsted & Sons Contracting", contact: "Diane Halsted", jobs: 4, won: 4, lost: 0, lifetime: 87200, lastJob: "Apr 26", segment: "repeat" },
  { id: "C-002", name: "Vermont Modern LLC", contact: "Priya Shah", jobs: 0, won: 0, lost: 0, lifetime: 0, lastJob: "—", segment: "cold" },
  { id: "C-003", name: "GC Pacific Builders", contact: "Marco Ruiz", jobs: 11, won: 9, lost: 2, lifetime: 412300, lastJob: "Mar 14", segment: "repeat" },
  { id: "C-004", name: "Westside Restoration", contact: "Tom Beckett", jobs: 2, won: 2, lost: 0, lifetime: 22600, lastJob: "May 1", segment: "repeat" },
  { id: "C-005", name: "Hilltop Custom Homes", contact: "Joel Park", jobs: 0, won: 0, lost: 1, lifetime: 0, lastJob: "—", segment: "cold" },
  { id: "C-006", name: "Solano Property Group", contact: "Renée Solano", jobs: 0, won: 0, lost: 0, lifetime: 0, lastJob: "—", segment: "cold" },
];

/* ───────── Marlon: Kahale Studio (Honolulu branding studio) ───────── */

const MARLON_COMPANY = {
  name: "Kahale Studio",
  owner: "Marlon Kahale",
  ownerFirst: "Marlon",
  trade: "Brand Identity · Naming · Web",
  region: "Honolulu, O'ahu",
  license: "GE-2024-0834-22",
  founded: 2019,
  crewSize: 3,
  hourlyAvg: 165,
  monthlyCapacityHrs: 480,
  bookedHrs: 312,
  avgMaterialMarkup: 0,
  avgLaborMarkup: 38,
  avgQuoteSize: 32400,
};

const MARLON_QUOTES_FULL = [
  { id: "P-2026-0042", client: "Pacific Vinyasa", contact: "Noa Tanaka", project: "Studio rebrand · wordmark + signage system", address: "Kaka'ako", sqft: null, total: 28400, state: "RESPONDED", sent: "May 5", age: 6, margin: 41, relationship: "repeat", lastJobs: 2, likelihood: 0.76, nextStep: "Noa asked to see the wordmark in their signage mock — reply today" },
  { id: "P-2026-0041", client: "Kaipo Wealth", contact: "Anika Patel", project: "Series-A identity sprint · 4-week", address: "Downtown HNL", sqft: null, total: 46500, state: "AWAITING", sent: "May 3", age: 8, margin: 39, relationship: "cold", lastJobs: 0, likelihood: 0.38, nextStep: "Follow up — Anika hasn't opened the proposal since Thursday" },
  { id: "P-2026-0040", client: "Mākaha Bank", contact: "Kanoa Lee", project: "Regional bank refresh · ID system + ATM kit", address: "Kapolei HQ", sqft: null, total: 112800, state: "SENT", sent: "May 9", age: 2, margin: 36, relationship: "repeat", lastJobs: 3, likelihood: 0.81, nextStep: "Kanoa reviews with board on Thursday — no action yet" },
  { id: "P-2026-0039", client: "Lanikai Surf Co.", contact: "Iolana Reyes", project: "Capsule packaging · summer 2026", address: "Kailua", sqft: null, total: 18200, state: "WON", sent: "Apr 23", won: "May 1", age: 18, margin: 44, relationship: "repeat", lastJobs: 4, likelihood: 1.0, nextStep: "Kickoff May 20" },
  { id: "P-2026-0038", client: "Pono University", contact: "Dr. Hala Manaia", project: "Admissions campaign · 12-month system", address: "Mānoa", sqft: null, total: 168000, state: "LOST", sent: "Apr 14", age: 27, margin: 32, relationship: "cold", lastJobs: 0, likelihood: 0, nextStep: "Lost to mainland agency — $40k under, but we kept the door open" },
  { id: "P-2026-0037", client: "Pacific Vinyasa", contact: "Noa Tanaka", project: "Class-pack collateral + IG templates", address: "Kaka'ako", sqft: null, total: 6800, state: "WON", sent: "Apr 8", won: "Apr 11", age: 33, margin: 48, relationship: "repeat", lastJobs: 2, likelihood: 1.0 },
  { id: "P-2026-0036", client: "Royal Hawaiian Heritage Trust", contact: "Keoni Akana", project: "Capital campaign identity + website", address: "Iolani Palace adj.", sqft: null, total: 84000, state: "DRAFT", sent: "—", age: 0, margin: 35, relationship: "cold", lastJobs: 0, likelihood: 0.5, nextStep: "Draft ready — confirm scope on cultural sensitivity review" },
];

const MARLON_JOBS_FULL = [
  { id: "E-0028", name: "Lanikai capsule packaging", client: "Lanikai Surf Co.", quoteId: "P-2026-0039", status: "INPROGRESS", pctComplete: 58, quotedTotal: 18200, bookedCost: 7300, quotedLaborHrs: 84, actualLaborHrs: 49, quotedMaterial: 0, actualMaterial: 0, startDate: "May 20", endTarget: "Jun 12", crew: "Marlon + Jules", margin: 44, projectedMargin: 47 },
  { id: "E-0027", name: "Pacific Vinyasa class-pack", client: "Pacific Vinyasa", quoteId: "P-2026-0037", status: "CLOSED", pctComplete: 100, quotedTotal: 6800, bookedCost: 3200, actualTotal: 6800, quotedLaborHrs: 36, actualLaborHrs: 41, quotedMaterial: 0, actualMaterial: 0, startDate: "Apr 11", endTarget: "Apr 22", endActual: "Apr 25", crew: "Jules + Marlon", margin: 48, actualMargin: 42 },
  { id: "E-0026", name: "Mākaha ID system", client: "Mākaha Bank", quoteId: null, status: "SCHEDULED", pctComplete: 0, quotedTotal: 112800, quotedLaborHrs: 540, quotedMaterial: 0, startDate: "Jun 16", endTarget: "Sep 30", crew: "Whole studio", margin: 36 },
];

const MARLON_CLIENTS_FULL = [
  { id: "K-001", name: "Pacific Vinyasa", contact: "Noa Tanaka", jobs: 2, won: 2, lost: 0, lifetime: 14600, lastJob: "Apr 25", segment: "repeat" },
  { id: "K-002", name: "Kaipo Wealth", contact: "Anika Patel", jobs: 0, won: 0, lost: 0, lifetime: 0, lastJob: "—", segment: "cold" },
  { id: "K-003", name: "Mākaha Bank", contact: "Kanoa Lee", jobs: 3, won: 3, lost: 0, lifetime: 168400, lastJob: "Feb 28", segment: "repeat" },
  { id: "K-004", name: "Lanikai Surf Co.", contact: "Iolana Reyes", jobs: 4, won: 4, lost: 0, lifetime: 62400, lastJob: "May 1", segment: "repeat" },
  { id: "K-005", name: "Pono University", contact: "Dr. Hala Manaia", jobs: 0, won: 0, lost: 1, lifetime: 0, lastJob: "—", segment: "cold" },
  { id: "K-006", name: "Royal Hawaiian Heritage Trust", contact: "Keoni Akana", jobs: 0, won: 0, lost: 0, lifetime: 0, lastJob: "—", segment: "cold" },
];

/* ───────── Vocab (copy-layer labels per persona) ───────── */

const CAVY_VOCAB = {
  appShop: "L·A Stucco",
  ownerFirst: "Cavy",
  ownerFull: "Carlos 'Cavy' Alvarado",
  ownerRole: "Owner",
  trade: "Stucco · EIFS · Exterior Plaster",
  region: "Los Angeles County",
  initial: "L",
  workWord: "quote", workWordCap: "Quote", workWordPl: "quotes", workWordPlCap: "Quotes",
  workVerb: "bid",
  jobWord: "job", jobWordCap: "Job", jobWordPl: "jobs", jobWordPlCap: "Jobs",
  crewWord: "crew", crewWordCap: "Crew",
  capacityNoun: "Crew capacity",
  hourlyLabel: "Loaded labor / hr",
  hourlyUnit: "$",
  licenseLabel: "California contractor license",
  licenseAuthority: "CSLB",
  licenseHint: "Public CSLB records only. We never pull bank or tax info during setup.",
  licenseSample: "C-35 #1089342",
  pipelineHeadline: "Quotes & their lifecycles",
  newCta: "New quote",
  newCtaShort: "Quote",
  reconHeadline: "Did the job land where we bid it?",
  jobNounWhere: "job",
  clientsHeadline: "People you bid for",
  // Empty-state copy
  emptyDashH1: "Brief is calibrating, Cavy.",
  emptyDashBody: "You haven't sent a quote yet. Once you do, this page becomes a Monday ledger — what needs you today, what's waiting on the client, where the margins are quietly slipping. For now, the desk is empty.",
  emptyQuotesH1: "Nothing in flight.",
  emptyQuotesBody: "Your pipeline is the heartbeat of the practice. Open quotes live here — sent, awaiting, in conversation. Won and lost slide into history. Make a first one and watch it move.",
  emptyJobsH1: "Nothing on the schedule.",
  emptyJobsBody: "A job opens when a client signs. From there Brief tracks labor against bid, materials against bid, schedule against promise — and tells you, gently, when the variance starts to add up.",
  emptyClientsH1: "Your book is empty.",
  emptyClientsBody: "Every client you bid for shows up here, sorted by relationship. Repeat clients earn warmer follow-up; cold bids get scheduled outreach. After a few quotes Brief will start to see patterns.",
  // Sample addresses for empty-state subtle examples
  egCity: "Pasadena",
};

const MARLON_VOCAB = {
  appShop: "Kahale Studio",
  ownerFirst: "Marlon",
  ownerFull: "Marlon Kahale",
  ownerRole: "Principal",
  trade: "Brand Identity · Naming · Web",
  region: "Honolulu, O'ahu",
  initial: "K",
  workWord: "proposal", workWordCap: "Proposal", workWordPl: "proposals", workWordPlCap: "Proposals",
  workVerb: "sign-off",
  jobWord: "engagement", jobWordCap: "Engagement", jobWordPl: "engagements", jobWordPlCap: "Engagements",
  crewWord: "studio", crewWordCap: "Studio",
  capacityNoun: "Studio capacity",
  hourlyLabel: "Loaded billable / hr",
  hourlyUnit: "$",
  licenseLabel: "Hawaii GE license",
  licenseAuthority: "DCCA",
  licenseHint: "Public DCCA business records only. We never pull bank or tax info during setup.",
  licenseSample: "GE-2024-0834-22",
  pipelineHeadline: "Proposals & their lifecycles",
  newCta: "New proposal",
  newCtaShort: "Proposal",
  reconHeadline: "Did the engagement land where we proposed?",
  jobNounWhere: "engagement",
  clientsHeadline: "People you write for",
  emptyDashH1: "Brief is calibrating, Marlon.",
  emptyDashBody: "You haven't sent a proposal yet. Once you do, this page becomes a Monday ledger — which proposals are waiting on a reply, which engagements are mid-build, which clients you should write to before they write you. For now, the studio is quiet.",
  emptyQuotesH1: "Nothing in flight.",
  emptyQuotesBody: "Your pipeline is the studio's pulse. Open proposals live here — sent, awaiting, in conversation. Signed and declined slide into history. Make a first one and watch it move.",
  emptyJobsH1: "Nothing on the books.",
  emptyJobsBody: "An engagement opens the moment a client signs. From there Brief tracks hours against estimate, scope against scope, and tells you — gently — when a project starts drifting beyond what was sold.",
  emptyClientsH1: "Your roster is empty.",
  emptyClientsBody: "Every client you write for shows up here, sorted by relationship. Repeat clients get warmer follow-up; cold inbounds get scheduled outreach. After a few proposals Brief will start to see patterns.",
  egCity: "Kaka'ako",
};

/* ───────── Data-state filtering ───────── */

// Calibration: how many quotes/jobs/clients are visible
//   cold-start: nothing yet (just signed up)
//   seeded:    2 quotes, 1 job, 2 clients (calibrating)
//   calibrated: full dataset (learned)
function filterByState(full, state) {
  if (state === "cold-start") {
    return { QUOTES: [], JOBS: [], CLIENTS: [] };
  }
  if (state === "seeded") {
    return {
      QUOTES: full.QUOTES.slice(0, 3),  // first three (1 responded, 1 awaiting, 1 sent)
      JOBS: [],                          // nothing booked into a job yet
      CLIENTS: full.CLIENTS.slice(0, 3),
    };
  }
  return { QUOTES: full.QUOTES, JOBS: full.JOBS, CLIENTS: full.CLIENTS };
}

const PERSONAS = {
  cavy: {
    COMPANY: CAVY_COMPANY, VOCAB: CAVY_VOCAB,
    QUOTES: CAVY_QUOTES_FULL, JOBS: CAVY_JOBS_FULL, CLIENTS: CAVY_CLIENTS_FULL,
  },
  marlon: {
    COMPANY: MARLON_COMPANY, VOCAB: MARLON_VOCAB,
    QUOTES: MARLON_QUOTES_FULL, JOBS: MARLON_JOBS_FULL, CLIENTS: MARLON_CLIENTS_FULL,
  },
};

// Quote/Job count for each state — for sidebar pill label
const STATE_DESCRIBE = {
  "cold-start": { label: "New", sub: "0 sent so far" },
  "seeded": { label: "Calibrating", sub: "learning from your first quotes" },
  "calibrated": { label: "Calibrated", sub: "learned from 30+ quotes" },
};

/* Pipeline state labels */
const STATE_LABELS = {
  DRAFT: { label: "Draft", cls: "pill--draft" },
  SENT: { label: "Sent", cls: "pill--sent" },
  AWAITING: { label: "Awaiting", cls: "pill--awaiting" },
  RESPONDED: { label: "Responded", cls: "pill--responded" },
  WON: { label: "Won", cls: "pill--won" },
  LOST: { label: "Lost", cls: "pill--lost" },
  INPROGRESS: { label: "In progress", cls: "pill--inprogress" },
  SCHEDULED: { label: "Scheduled", cls: "pill--scheduled" },
  CLOSED: { label: "Closed", cls: "pill--closed" },
};

function StatusPill({ state }) {
  const s = STATE_LABELS[state] || { label: state, cls: "pill--draft" };
  return <span className={`pill ${s.cls}`}>{s.label}</span>;
}

const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const moneyK = (n) => n >= 1000 ? "$" + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : "$" + n;

// Initial defaults — App overwrites these on every render based on tweaks.
// Other scripts rely on these as window globals.
Object.assign(window, {
  PERSONAS, STATE_LABELS, STATE_DESCRIBE,
  filterByState,
  // Live (rebound by app.jsx):
  COMPANY: CAVY_COMPANY,
  VOCAB: CAVY_VOCAB,
  SAMPLE_QUOTES: CAVY_QUOTES_FULL,
  SAMPLE_JOBS: CAVY_JOBS_FULL,
  SAMPLE_CLIENTS: CAVY_CLIENTS_FULL,
  DATA_STATE: "calibrated",
  StatusPill, money, moneyK,
});
