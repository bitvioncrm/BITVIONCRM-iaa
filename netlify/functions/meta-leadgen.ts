import { handleMetaRequest } from "../lib/meta-ingest.ts";

export default async (request: Request) => handleMetaRequest(request);
