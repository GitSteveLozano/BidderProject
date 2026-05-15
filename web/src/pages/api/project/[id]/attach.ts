/**
 * POST /api/project/[id]/attach
 *
 * Attach intake documents to a project. Called from the multi-upload
 * confirmation UI after the operator confirms groupings.
 *
 * Body: { document_ids: string[] }
 */
import type { APIRoute } from 'astro';

import { attachDocumentToProject, recomputeProjectStatus } from '@/lib/projects';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  if (!params.id) return json({ error: 'id required' }, 400);

  let body: { document_ids?: string[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!Array.isArray(body.document_ids) || body.document_ids.length === 0) {
    return json({ error: 'document_ids required' }, 400);
  }

  const shopId = locals.membership.shop_id;
  const svc = supabaseService(env, 'service');

  // Confirm project belongs to shop before attaching anything.
  const { data: project } = await svc
    .from('projects')
    .select('id')
    .eq('id', params.id)
    .eq('shop_id', shopId)
    .maybeSingle();
  if (!project) return json({ error: 'Project not found' }, 404);

  for (const docId of body.document_ids) {
    await attachDocumentToProject(svc, shopId, docId, project.id);
  }

  const status = await recomputeProjectStatus(svc, project.id);
  return json({ attached: body.document_ids.length, status }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
