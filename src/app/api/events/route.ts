import { receiveEvent } from "@/lib/event-ingest-receive";

// Agent event ingest (#199): POST one event with a platform's bearer token.
// See apps/docs/docs/event-ingest.md for the contract.
export const POST = (request: Request) => receiveEvent(request);
