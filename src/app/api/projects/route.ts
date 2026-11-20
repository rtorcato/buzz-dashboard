import {
  createProject,
  listChannelAssignments,
  listProjects,
} from "@/lib/project-store";
import { NewProjectSchema } from "@/lib/projects";
import { json, registryHive, signedWrite } from "@/lib/registry-route";

// The project registry (#166). GET lists the hive's projects with their
// repos, channels and agents, plus every channel assignment; ?archived=1
// includes archived projects. POST creates a project from a signed edit.

export async function GET(request: Request) {
  const h = registryHive();
  if ("response" in h) return h.response;
  const archived = new URL(request.url).searchParams.get("archived") === "1";
  const [projects, channels] = await Promise.all([
    listProjects(h.hive, { archived }),
    listChannelAssignments(h.hive),
  ]);
  return json({ projects, channels }, 200);
}

export function POST(request: Request) {
  return signedWrite(
    request,
    "/api/projects",
    NewProjectSchema,
    (hive, input, event) => createProject(hive, input, event),
  );
}
