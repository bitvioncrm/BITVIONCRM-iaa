import { handleMetaRetry } from "../lib/meta-ingest.ts";

export default async (request: Request) => handleMetaRetry(request);
