import { syncMetaLeads } from "../lib/meta-sync.ts";

export default async () => {
  const result = await syncMetaLeads();
  return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
};

export const config = {
  schedule: "*/5 * * * *",
};
