// Turns whatever the owner pastes into a relay URL (#188). The relay address is
// the address they open Buzz at, with wss:// in front, so we accept the web
// address (https://host or a bare host) and rewrite it. Client-safe: no server
// imports, so the wizard and the route share it.

const LOCAL = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

function hostOf(rest: string): string {
  return rest.split(/[/?#]/)[0].replace(/:\d+$/, "");
}

export function normaliseRelayUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
  const rest = scheme ? raw.slice(scheme[0].length) : raw;
  const proto = scheme?.[1].toLowerCase();
  // ws:// and wss:// are already relay URLs; keep them as typed.
  if (proto === "ws" || proto === "wss") {
    return `${proto}://${rest}`.replace(/\/+$/, "");
  }
  // Anything else (https, http, or no scheme) is a web address: use its origin.
  if (proto && proto !== "https" && proto !== "http") return raw;
  const authority = rest.split(/[/?#]/)[0];
  if (!authority) return raw;
  const local = LOCAL.test(hostOf(rest));
  const wsScheme = local && proto !== "https" ? "ws" : "wss";
  return `${wsScheme}://${authority}`;
}
