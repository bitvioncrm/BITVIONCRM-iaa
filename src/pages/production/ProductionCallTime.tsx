import { useEffect, useState } from "react";
import { listWorkspaces, type WorkspaceOption } from "@/services/production-leads";
import { endCall, startCall, callSummary } from "@/services/production-ops";

export function ProductionCallTime() {
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [summary, setSummary] = useState<{ today: number; week: number; month: number; target: number; remaining: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void listWorkspaces().then((rows) => {
      setWorkspaces(rows);
      setWorkspaceId(rows[0]?.id ?? "");
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Configuration Required"));
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    void callSummary(workspaceId).then(setSummary).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load call time"));
  }, [workspaceId, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => window.clearInterval(timer);
  }, [sessionId]);

  const live = startedAt ? Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000)) : 0;
  const workspace = workspaces.find((item) => item.id === workspaceId);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Call time</h1>
      <p className="text-sm text-muted">Only a completed Start and End is stored. An interrupted timer is not counted.</p>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <select className="rounded-md border border-line px-2 py-2" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
        {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <p className="text-4xl font-semibold tabular">{sessionId ? format(live) : format(summary?.today ?? 0)}</p>
      <p className="text-sm text-muted">Today {format(summary?.today ?? 0)} · Target {format(summary?.target ?? 0)} · Remaining {format(summary?.remaining ?? 0)}</p>
      <p className="text-sm text-muted">Week {format(summary?.week ?? 0)} · Month {format(summary?.month ?? 0)}</p>
      {sessionId ? (
        <button type="button" className="rounded-md bg-navy px-4 py-2 text-sm text-white" onClick={() => {
          void endCall(sessionId).then(() => {
            setSessionId(null);
            setStartedAt(null);
          }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "End call failed"));
        }}>End call</button>
      ) : (
        <button type="button" className="rounded-md bg-navy px-4 py-2 text-sm text-white" disabled={!workspace} onClick={() => {
          if (!workspace) return;
          void startCall(workspace.organizationId, workspace.id).then((row) => {
            setSessionId(row.id);
            setStartedAt(row.started_at);
          }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Start call failed"));
        }}>Start call</button>
      )}
    </div>
  );
}

function format(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
