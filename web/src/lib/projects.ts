/**
 * Projects — the pre-win container that groups all the documents
 * related to one job: plans, selections, vendor invoices, scoping
 * emails, plus eventually the operator's outbound quotes.
 *
 * Phase 2 introduces:
 *   - createProject, updateProject, getProject, listProjects helpers
 *   - findMatchingProjects(): embedding similarity used by the
 *     multi-doc upload UI to auto-group related uploads.
 *   - embedProjectSignal(): builds a text representation of a project
 *     for embedding (name + address + first chunks of attached doc
 *     text).
 *
 * The store is intentionally thin — projects are mostly a join
 * dimension. Status transitions + derivations live in API endpoints,
 * not here.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { embed, toPgVector } from './embeddings';
import type { CloudflareEnv } from './supabase';

export type ProjectStatus =
  | 'intake'
  | 'scoped'
  | 'quoted'
  | 'won'
  | 'lost'
  | 'in_progress'
  | 'done';

export interface Project {
  id: string;
  shop_id: string;
  client_id: string | null;
  name: string;
  address: string | null;
  description: string | null;
  status: ProjectStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProjectMatch {
  id: string;
  name: string;
  address: string | null;
  status: ProjectStatus;
  distance: number;
}

const MATCH_THRESHOLD = 0.42;

/**
 * Build the text Brief embeds for a project. Used both when we mint
 * a new project (to embed it for future matching) and when grouping
 * an incoming doc (we embed the doc's first chunk + any operator
 * hints and compare against existing project embeddings).
 */
export function projectSignalText(args: {
  name?: string | null;
  address?: string | null;
  description?: string | null;
  doc_sample?: string | null;
}): string {
  const parts = [
    args.name && `Project: ${args.name}`,
    args.address && `Address: ${args.address}`,
    args.description && `Description: ${args.description}`,
    args.doc_sample && args.doc_sample.slice(0, 600),
  ].filter(Boolean);
  return parts.join('\n');
}

/** Re-embed and persist a project's embedding column. Called after
 * create + on edits to name/address/description. */
export async function refreshProjectEmbedding(
  env: CloudflareEnv,
  svc: SupabaseClient,
  projectId: string,
  signal: string,
): Promise<void> {
  if (!env.AI) return;
  const vec = await embed(env, signal);
  if (!vec) return;
  await svc
    .from('projects')
    .update({ embedding: toPgVector(vec) })
    .eq('id', projectId);
}

export async function createProject(
  env: CloudflareEnv,
  svc: SupabaseClient,
  shopId: string,
  input: {
    name: string;
    address?: string | null;
    description?: string | null;
    client_id?: string | null;
  },
): Promise<Project | null> {
  const { data, error } = await svc
    .from('projects')
    .insert({
      shop_id: shopId,
      client_id: input.client_id ?? null,
      name: input.name,
      address: input.address ?? null,
      description: input.description ?? null,
      status: 'intake',
    })
    .select('*')
    .single();
  if (error || !data) {
    console.warn('[projects] create failed', error?.message);
    return null;
  }
  await refreshProjectEmbedding(
    env,
    svc,
    data.id,
    projectSignalText({
      name: data.name,
      address: data.address,
      description: data.description,
    }),
  );
  return data as Project;
}

export async function listProjects(
  svc: SupabaseClient,
  shopId: string,
  opts: { limit?: number } = {},
): Promise<Project[]> {
  const { data } = await svc
    .from('projects')
    .select('*')
    .eq('shop_id', shopId)
    .order('updated_at', { ascending: false })
    .limit(opts.limit ?? 100);
  return (data ?? []) as Project[];
}

export async function getProject(
  svc: SupabaseClient,
  shopId: string,
  id: string,
): Promise<Project | null> {
  const { data } = await svc
    .from('projects')
    .select('*')
    .eq('id', id)
    .eq('shop_id', shopId)
    .maybeSingle();
  return (data as Project | null) ?? null;
}

/**
 * Find candidate projects for an incoming document. Used by the
 * multi-upload auto-group flow:
 *
 *   1. Operator drops files.
 *   2. Each file is text-extracted + embedded.
 *   3. We call findMatchingProjects() with the doc's signal text.
 *   4. If a project comes back within MATCH_THRESHOLD, suggest
 *      attaching to it. Otherwise, ask the operator to confirm a
 *      newly-minted project (Brief proposes name/address from the
 *      classification + client_hints).
 *
 * Returns top-k matches sorted by ascending cosine distance.
 */
export async function findMatchingProjects(
  env: CloudflareEnv,
  svc: SupabaseClient,
  shopId: string,
  signal: string,
  opts: { limit?: number; threshold?: number } = {},
): Promise<ProjectMatch[]> {
  if (!env.AI) return [];
  const vec = await embed(env, signal.slice(0, 1500));
  if (!vec) return [];
  const { data, error } = await svc.rpc('search_projects', {
    p_shop_id: shopId,
    p_query: toPgVector(vec),
    p_limit: opts.limit ?? 5,
  });
  if (error || !data) {
    if (error) console.warn('[projects] search rpc failed', error.message);
    return [];
  }
  const threshold = opts.threshold ?? MATCH_THRESHOLD;
  return (data as ProjectMatch[]).filter((m) => m.distance <= threshold);
}

/** Attach an existing intake_documents row to a project. */
export async function attachDocumentToProject(
  svc: SupabaseClient,
  shopId: string,
  documentId: string,
  projectId: string,
): Promise<void> {
  await svc
    .from('intake_documents')
    .update({ project_id: projectId })
    .eq('id', documentId)
    .eq('shop_id', shopId);
}

/** Re-compute a project's status based on what's attached. Cheap;
 * called after attach/detach + when quotes change state. */
export async function recomputeProjectStatus(
  svc: SupabaseClient,
  projectId: string,
): Promise<ProjectStatus | null> {
  const { data: project } = await svc
    .from('projects')
    .select('id, shop_id, status')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return null;

  const { data: quotes } = await svc
    .from('quotes')
    .select('state')
    .eq('project_id', projectId);
  const states = (quotes ?? []).map((q) => q.state as string);

  let next: ProjectStatus = 'intake';
  if (states.includes('WON')) next = 'won';
  else if (states.length > 0 && states.every((s) => s === 'LOST')) next = 'lost';
  else if (states.some((s) => ['DRAFT', 'SENT', 'AWAITING', 'RESPONDED'].includes(s))) next = 'quoted';
  else {
    // No quotes yet — check for docs
    const { count } = await svc
      .from('intake_documents')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId);
    next = (count ?? 0) > 0 ? 'scoped' : 'intake';
  }
  if (next !== project.status) {
    await svc.from('projects').update({ status: next }).eq('id', projectId);
  }
  return next;
}
