/**
 * Deterministic Pricing math, ported from agents/pricing.py.
 *
 * Behavior contract (matches the Python spec §5.4):
 *   - Labor cost is the sum of (avg_loaded_rate × hours) per trade,
 *     pulled from the burden_components view.
 *   - Material cost comes from a per-service-line catalog.
 *   - target_price = (labor + materials + overhead) / (1 - target_margin).
 *   - capacity_modifier uses the same thresholds as Python:
 *       >= 0.85 → hold_firm
 *       >= 0.70 → hold
 *       >= 0.50 → consider_small_discount (-2.5%)
 *       else   → consider_discount (-5%)
 *
 * Numbers come from tool calls (Supabase queries here), never from the LLM.
 */
import type { CloudflareEnv } from './supabase';
import { client as supabaseClient } from './supabase';

// Material rate catalog — keep in sync with tools/material_cost_lookup.py
const MATERIAL_RATES: Record<string, { unit: string; cost_per_unit: number; waste: number }> = {
  'STUCCO-CONVENTIONAL': { unit: 'sqft', cost_per_unit: 7.20, waste: 0.10 },
  'STUCCO-textured acrylic': { unit: 'sqft', cost_per_unit: 8.40, waste: 0.10 },
  'EIFS': { unit: 'sqft', cost_per_unit: 11.50, waste: 0.08 },
  'Siding': { unit: 'sqft', cost_per_unit: 9.80, waste: 0.12 },
  'METAL WORK': { unit: 'lf', cost_per_unit: 14.00, waste: 0.08 },
  'RESTUCCO': { unit: 'sqft', cost_per_unit: 5.40, waste: 0.10 },
  'REPAIR': { unit: 'lump_sum', cost_per_unit: 1.0, waste: 0.0 },
  'DEMOLITION': { unit: 'sqft', cost_per_unit: 2.80, waste: 0.0 },
};

const TRADE_MATCH: Record<string, string[]> = {
  stucco_lead: ['lead_stucco_mech'],
  stucco_journeyman: ['stucco_journeyman', 'lead_stucco_mech'],
  stucco: ['stucco_journeyman', 'lead_stucco_mech', 'finisher'],
  eifs: ['eifs_installer', 'stucco_journeyman'],
  siding_lead: ['siding_lead'],
  siding: ['siding_installer', 'siding_lead'],
  finisher: ['finisher'],
  laborer: ['general_laborer'],
  helper: ['general_laborer'],
};

export interface LaborItem {
  trade: string;
  hours: number;
}

export interface LoadedLaborLookup {
  trade: string;
  hours: number;
  avg_loaded_rate: number | null;
  labor_subtotal: number | null;
  n_employees: number;
  citation: string;
}

export async function getLoadedLaborCost(
  companyId: string,
  trade: string,
  hours: number,
  env?: CloudflareEnv,
): Promise<LoadedLaborLookup> {
  const candidates = TRADE_MATCH[trade.toLowerCase()] ?? [trade];
  const sb = supabaseClient(env, 'anon');
  const { data, error } = await sb
    .from('employees')
    .select(`
      id, name, trade_classification, base_hourly_rate,
      burden_components!inner ( loaded_hourly_rate )
    `)
    .eq('company_id', companyId)
    .eq('status', 'active')
    .in('trade_classification', candidates);

  if (error || !data || data.length === 0) {
    return {
      trade, hours, avg_loaded_rate: null, labor_subtotal: null,
      n_employees: 0,
      citation: error?.message ?? `no employees in ${candidates} for company`,
    };
  }
  const rates = data
    .map((r: any) => Number(r.burden_components?.[0]?.loaded_hourly_rate))
    .filter((r) => !isNaN(r));
  if (rates.length === 0) {
    return {
      trade, hours, avg_loaded_rate: null, labor_subtotal: null,
      n_employees: 0,
      citation: 'no loaded_hourly_rate rows found',
    };
  }
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  return {
    trade,
    hours,
    avg_loaded_rate: round(avg, 2),
    labor_subtotal: round(avg * hours, 2),
    n_employees: data.length,
    citation: `avg of ${data.length} active ${trade} workers' loaded rate`,
  };
}

export function lookupMaterialCost(serviceLine: string, quantity: number) {
  const rate = MATERIAL_RATES[serviceLine];
  if (!rate) {
    return {
      service_line: serviceLine, quantity, subtotal: null,
      citation: 'no material rate for this service line',
    };
  }
  const effective = quantity * (1 + rate.waste);
  return {
    service_line: serviceLine,
    quantity,
    unit: rate.unit,
    cost_per_unit: rate.cost_per_unit,
    waste_factor: rate.waste,
    subtotal: round(effective * rate.cost_per_unit, 2),
    citation: `${quantity}${rate.unit} × ${(1 + rate.waste).toFixed(2)} × $${rate.cost_per_unit.toFixed(2)}`,
  };
}

export interface CapacityResult {
  avg_utilization: number;
  weeks: Array<{ week_start: string; allocated_hours: number; utilization: number }>;
  citation: string;
  recommended_modifier: { action: string; modifier_pct: number; rationale: string };
}

export async function getCapacityUtilization(
  companyId: string,
  startDate: Date,
  weeks: number,
  env?: CloudflareEnv,
): Promise<CapacityResult> {
  const sb = supabaseClient(env, 'anon');
  // Active headcount × 40h/wk = weekly capacity
  const { count: headcount } = await sb
    .from('employees')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('status', 'active');

  const capPerWeek = (headcount ?? 0) * 40;
  const monday = mondayOf(startDate);
  const lastMonday = addDays(monday, (weeks - 1) * 7);
  const { data: allocs } = await sb
    .from('schedule_allocations')
    .select('week_start_date, allocated_hours')
    .eq('company_id', companyId)
    .gte('week_start_date', toISODate(monday))
    .lte('week_start_date', toISODate(lastMonday));

  const byWeek = new Map<string, number>();
  for (const a of allocs ?? []) {
    const key = a.week_start_date;
    byWeek.set(key, (byWeek.get(key) ?? 0) + (a.allocated_hours ?? 0));
  }

  const out: CapacityResult['weeks'] = [];
  for (let i = 0; i < weeks; i++) {
    const wk = addDays(monday, i * 7);
    const key = toISODate(wk);
    const alloc = byWeek.get(key) ?? 0;
    out.push({
      week_start: key,
      allocated_hours: alloc,
      utilization: capPerWeek > 0 ? round(alloc / capPerWeek, 3) : 0,
    });
  }
  const avg =
    out.length > 0
      ? round(out.reduce((s, w) => s + w.utilization, 0) / out.length, 3)
      : 0;
  const firstUtil = out[0]?.utilization ?? 0;

  return {
    avg_utilization: avg,
    weeks: out,
    recommended_modifier: capacityModifier(firstUtil),
    citation: `sum of allocated hours / (${headcount ?? 0} workers × 40h/wk)`,
  };
}

function capacityModifier(utilization: number) {
  if (utilization >= 0.85) {
    return {
      action: 'hold_firm', modifier_pct: 0.0,
      rationale: 'schedule is full; hold target price',
    };
  }
  if (utilization >= 0.70) {
    return {
      action: 'hold', modifier_pct: 0.0,
      rationale: 'healthy utilization; price at target',
    };
  }
  if (utilization >= 0.50) {
    return {
      action: 'consider_small_discount', modifier_pct: -2.5,
      rationale: 'moderate utilization; minor discount to win work may be worth it',
    };
  }
  return {
    action: 'consider_discount', modifier_pct: -5.0,
    rationale: 'low utilization; discount to fill schedule is consistent with company behavior',
  };
}

// ─── Composer ─────────────────────────────────────────────────────

export interface PricingBreakdown {
  labor: {
    by_trade: LoadedLaborLookup[];
    subtotal: number;
    total_hours: number;
    citations: string[];
  };
  materials: ReturnType<typeof lookupMaterialCost>;
  overhead: { pct: number; subtotal: number };
  profit: { subtotal: number; target_margin_pct: number };
  target_price: number;
  range_low: number;
  range_high: number;
  capacity_utilization_at_start: number;
  capacity_modifier: ReturnType<typeof capacityModifier>;
  citations: (string | null)[];
}

export async function computePricing(args: {
  companyId: string;
  serviceLine: string;
  laborPlan: LaborItem[];
  materialQuantity: number;
  estimatedStartDate: Date;
  targetMarginPct?: number;
  overheadPct?: number;
  marginRangeLowPct?: number;
  marginRangeHighPct?: number;
  env?: CloudflareEnv;
}): Promise<PricingBreakdown> {
  const {
    companyId, serviceLine, laborPlan, materialQuantity, estimatedStartDate,
    targetMarginPct = 32.0, overheadPct = 18.0,
    marginRangeLowPct = 25.0, marginRangeHighPct = 40.0,
    env,
  } = args;

  const byTrade: LoadedLaborLookup[] = [];
  let laborSubtotal = 0;
  let totalHours = 0;
  const citations: (string | null)[] = [];
  for (const item of laborPlan) {
    const lookup = await getLoadedLaborCost(companyId, item.trade, item.hours, env);
    byTrade.push(lookup);
    if (lookup.labor_subtotal) {
      laborSubtotal += lookup.labor_subtotal;
      totalHours += item.hours;
    }
    citations.push(lookup.citation);
  }
  const materials = lookupMaterialCost(serviceLine, materialQuantity);
  citations.push(materials.citation);

  const matSub = materials.subtotal ?? 0;
  const baseCost = laborSubtotal + matSub;
  const overhead = round(baseCost * (overheadPct / 100), 2);
  const costWithOverhead = baseCost + overhead;
  const targetPrice = round(costWithOverhead / (1 - targetMarginPct / 100), 2);
  const profit = round(targetPrice - costWithOverhead, 2);
  const rangeLow = round(costWithOverhead / (1 - marginRangeLowPct / 100), 2);
  const rangeHigh = round(costWithOverhead / (1 - marginRangeHighPct / 100), 2);

  const cap = await getCapacityUtilization(companyId, estimatedStartDate, 4, env);
  citations.push(cap.citation);

  return {
    labor: {
      by_trade: byTrade,
      subtotal: round(laborSubtotal, 2),
      total_hours: totalHours,
      citations: byTrade.map((t) => t.citation),
    },
    materials,
    overhead: { pct: overheadPct, subtotal: overhead },
    profit: { subtotal: profit, target_margin_pct: targetMarginPct },
    target_price: targetPrice,
    range_low: rangeLow,
    range_high: rangeHigh,
    capacity_utilization_at_start: cap.weeks[0]?.utilization ?? 0,
    capacity_modifier: cap.recommended_modifier,
    citations,
  };
}

// ─── helpers ──────────────────────────────────────────────────────

function round(n: number, decimals: number): number {
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}

function mondayOf(d: Date): Date {
  const x = new Date(d);
  const day = x.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day);
  x.setUTCDate(x.getUTCDate() + diff);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
