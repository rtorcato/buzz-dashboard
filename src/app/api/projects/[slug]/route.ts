import {
  applyProjectEdit,
  getProject,
  listRevisions,
} from "@/lib/project-store";
import { ProjectPatchSchema } from "@/lib/projects";
import { json, registryHive, signedWrite } from "@/lib/registry-route";

// One project (#166). GET returns it, archived or not, with its newest
// signed edits. POST applies a signed edit against `base_revision`; a stale
// one is a 409.

type Params = { params: Promise<{ slug: string }> };

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export async function GET(_request: Request, { params }: Params) {
  const h = registryHive();
  if ("response" in h) return h.response;
  const { slug } = await params;
  if (!SLUG.test(slug)) return json({ error: "not found" }, 404);
  const project = await getProject(h.hive, slug);
  if (!project) return json({ error: "not found" }, 404);
  const revisions = await listRevisions(h.hive, { project: slug });
  return json({ project, revisions }, 200);
}

export async function POST(request: Request, { params }: Params) {
  const { slug } = await params;
  if (!SLUG.test(slug)) return json({ error: "not found" }, 404);
  return signedWrite(
    request,
    `/api/projects/${slug}`,
    ProjectPatchSchema,
    (hive, patch, event) => applyProjectEdit(hive, slug, patch, event),
  );
}
