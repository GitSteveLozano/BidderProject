/**
 * GET  /api/project       — list this shop's projects
 * POST /api/project       — create a new project
 *
 * Phase 2. The bigger surface — multi-doc upload + auto-group —
 * lives in /api/project/intake; this file is the plain CRUD.
 */
import type { APIRoute } from 'astro';

import { createProject, listProjects } from '@/lib/projects';
import { client as supabaseService } from '@/lib/supabase';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);
  const svc = supabaseService(env, 'service');
  const projects = await listProjects(svc, locals.membership.shop_id, { limit: 200 });
  return json({ projects }, 200);
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env) return json({ error: 'Cloudflare runtime not available' }, 500);
  if (!locals.user || !locals.membership) return json({ error: 'Not authenticated' }, 401);

  let body: {
    name?: string;
    address?: string | null;
    description?: string | null;
    client_id?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.name?.trim()) return json({ error: 'name required' }, 400);

  const svc = supabaseService(env, 'service');
  const project = await createProject(env, svc, locals.membership.shop_id, {
    name: body.name.trim(),
    address: body.address ?? null,
    description: body.description ?? null,
    client_id: body.client_id ?? null,
  });
  if (!project) return json({ error: 'project create failed' }, 500);
  return json({ project }, 201);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
