import "server-only";

import { readServerEnv } from "./env";
import { envList } from "./github";
import { queryAll, readHive } from "./hive";
import { activeRepos, hasProjects, seedProjects } from "./project-store";
import { hiveOf, membersFrom, seedPlan } from "./projects";

// The registry's first seed (#166), from what the dashboard already knows:
// repos with stored activity, the relay's channel names and their members.
// It runs from the ingest loop until the hive has a project, then never again.

let seeded: string | undefined;

/** Seeds the hive once it has activity; how many projects it made. */
export async function seedRegistryOnce(): Promise<number> {
  const env = readServerEnv();
  const hive = hiveOf(env.buzzRelayUrl);
  if (!hive || seeded === hive) return 0;
  if (await hasProjects(hive)) {
    seeded = hive;
    return 0;
  }
  const owners = envList("GITHUB_OWNERS");
  const repos = await activeRepos();
  if (!owners.length || !repos.length) return 0;
  // The cached hive read (agents and channel names) and the member lists. A
  // relay that is down skips this pass; the next one tries again.
  const [h, memberEvents] = await Promise.all([
    readHive(),
    queryAll(env, { kinds: [39002] }),
  ]);
  if (!h) return 0;
  const plan = seedPlan({
    repos,
    owners,
    channels: h.channels,
    members: membersFrom(memberEvents),
    agentPubkeys: new Set(h.agents.flatMap((a) => a.pubkeys)),
  });
  const made = await seedProjects(hive, plan, env.buzzPrivateKey);
  if (made || (await hasProjects(hive))) seeded = hive;
  return made;
}
