/**
 * GET   /api/project/[id]       — get one project + attached docs + quotes
 * PATCH /api/project/[id]       — update mutable fields
 *
 * On PATCH of name/address/description, re-embeds the project so
 * future doc auto-grouping uses the latest signal.
 */
import type { APIRoute } from 'astro';

import { getProject, projectSignalText, refreshProjectEmbedding } from '@/lib/projects';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

const EDITABLE = ['name', 'address', 'description', 'client_id', 'status', 'metadata'] as const;

export const GET: APIRoute = async ({ params, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (!params.id) return json({ error: 'id required' }, 400);

  const svc = supabaseService(env, 'service');
  const project = await getProject(svc, locals.membership.shop_id, params.id);
  if (!project) return json({ error: 'Not found' }, 404);

  // Attached intake documents.
  const { data: documents } = await svc
    .from('intake_documents')
    .select('id, classification, direction, classification_confidence, source_filename, source_kind, raw_text, extracted, created_at')
    .eq('project_id', project.id)
    .eq('shop_id', locals.membership.shop_id)
    .order('created_at', { ascending: false });

  // Attached quotes.
  const { data: quotes } = await svc
    .from('quotes')
    .select('id, ref, state, client_name, project_title, total, sent_at, created_at')
    .eq('project_id', project.id)
    .eq('shop_id', locals.membership.shop_id)
    .order('created_at', { ascending: false });

  return json({ project, documents: documents ?? [], quotes: quotes ?? [] }, 200);
};

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (!params.id) return json({ error: 'id required' }, 400);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE) {
    if (k in body) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) return json({ error: 'No editable fields' }, 400);

  const svc = supabaseService(env, 'service');
  const { data, error } = await svc
    .from('projects')
    .update(patch)
    .eq('id', params.id)
    .eq('shop_id', locals.membership.shop_id)
    .select('*')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Not found' }, 404);

  // Re-embed when name/address/description changes — keeps
  // auto-grouping accurate over time.
  if ('name' in patch || 'address' in patch || 'description' in patch) {
    void refreshProjectEmbedding(
      env,
      svc,
      params.id,
      projectSignalText({
        name: data.name,
        address: data.address,
        description: data.description,
      }),
    );
  }
  return json({ project: data }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
