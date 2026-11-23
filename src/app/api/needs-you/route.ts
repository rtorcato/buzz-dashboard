import { getOwner, needsYouBearer, readsNeedSignIn } from "../../../lib/auth";
import { getNeedsYou } from "../../../lib/needs-you";

// The Needs you card as JSON, for the Buzz Desktop plugin's reader (#193).
// Read only. Open on the normal read rules; with REQUIRE_SIGN_IN_FOR_READS the
// owner or NEEDS_YOU_READ_TOKEN (this route only) gets in. A bearer that is
// not the token is refused either way, so a mistyped one fails loudly.
// The token is never echoed, and nothing here sets a cookie.

const HEADERS = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const bearer = needsYouBearer(request.headers.get("authorization"));
  if (bearer === "invalid") {
    return Response.json(
      { error: "invalid token" },
      { status: 401, headers: HEADERS },
    );
  }
  // The proxy gates this already; check again so the route is safe alone.
  if (bearer !== "valid" && readsNeedSignIn() && !(await getOwner())) {
    return Response.json(
      { error: "sign-in required" },
      { status: 401, headers: HEADERS },
    );
  }
  return Response.json(await getNeedsYou(), { headers: HEADERS });
}
