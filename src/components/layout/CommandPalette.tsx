import { Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { useCrm } from "@/context/CrmContext";
import { searchDirectory, type DirectoryHit } from "@/services/production-leads";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { productionUser } = useAuth();
  if (productionUser) return <ProductionSearch open={open} onOpenChange={onOpenChange} />;
  return <DemoSearch open={open} onOpenChange={onOpenChange} />;
}

function ProductionSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [hits, setHits] = useState<DirectoryHit[]>([]);
  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
      setActive(0);
    }
  }, [open]);
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setHits([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void searchDirectory(query).then((result) => {
        setHits([...result.leads, ...result.patients, ...result.students, ...result.courses]);
        setActive(0);
      }).catch(() => setHits([]));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [open, query]);
  const go = (path: string) => {
    navigate(path);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0">
        <DialogTitle className="sr-only">Search BITVION</DialogTitle>
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search className="size-4 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((current) => Math.min(current + 1, Math.max(hits.length - 1, 0)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter" && hits[active]) {
                event.preventDefault();
                go(hits[active].href);
              }
            }}
            placeholder="Search leads, patients, students, courses"
            className="h-12 w-full bg-transparent text-sm outline-none"
          />
        </div>
        <div className="max-h-[420px] overflow-y-auto p-2">
          {query.trim().length < 2 ? <p className="px-2 py-8 text-center text-sm text-muted">Type at least two characters.</p> : null}
          {hits.map((hit, index) => (
            <button key={`${hit.href}-${hit.id}`} type="button" className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm ${index === active ? "bg-slate-100" : "hover:bg-slate-50"}`} onMouseEnter={() => setActive(index)} onClick={() => go(hit.href)}>
              <span className="truncate font-medium">{hit.title}</span>
              <span className="shrink-0 text-xs text-muted">{hit.meta}</span>
            </button>
          ))}
          {query.trim().length >= 2 && hits.length === 0 ? <p className="px-2 py-8 text-center text-sm text-muted">No authorized records match.</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DemoSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { state } = useCrm();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (q.length < 1) return { leads: state.leads.slice(0, 6), tasks: state.tasks.slice(0, 4), jobs: state.jobs.slice(0, 4), messages: [] as typeof state.messages };
    const leads = state.leads
      .filter((lead) => [lead.fullName, lead.phone, lead.email, lead.position, lead.location].join(" ").toLowerCase().includes(q))
      .slice(0, 8);
    const tasks = state.tasks.filter((task) => task.title.toLowerCase().includes(q)).slice(0, 5);
    const jobs = state.jobs.filter((job) => `${job.title} ${job.location}`.toLowerCase().includes(q)).slice(0, 5);
    const messages = state.messages.filter((message) => message.body.toLowerCase().includes(q)).slice(0, 5);
    return { leads, tasks, jobs, messages };
  }, [q, state.jobs, state.leads, state.messages, state.tasks]);

  const go = (path: string) => {
    navigate(path);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0">
        <DialogTitle className="sr-only">Search BITVION</DialogTitle>
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search className="size-4 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search candidates, phones, emails, jobs, tasks, messages"
            className="h-12 w-full bg-transparent text-sm outline-none"
          />
        </div>
        <div className="max-h-[420px] overflow-y-auto p-2">
          <Section title="Candidates">
            {results.leads.map((lead) => (
              <Row key={lead.id} title={lead.fullName} meta={`${lead.position} · ${lead.phone}`} onClick={() => go(`/leads/${lead.id}`)} />
            ))}
          </Section>
          <Section title="Tasks">
            {results.tasks.map((task) => (
              <Row key={task.id} title={task.title} meta={task.taskType} onClick={() => go("/tasks")} />
            ))}
          </Section>
          <Section title="Jobs">
            {results.jobs.map((job) => (
              <Row key={job.id} title={job.title} meta={job.location} onClick={() => go("/leads")} />
            ))}
          </Section>
          <Section title="Messages">
            {results.messages.map((message) => (
              <Row key={message.id} title={message.body} meta="WhatsApp" onClick={() => go(`/whatsapp?lead=${message.leadId}`)} />
            ))}
          </Section>
          {!results.leads.length && !results.tasks.length && !results.jobs.length && !results.messages.length ? (
            <p className="px-2 py-8 text-center text-sm text-muted">No matching records.</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const list = Array.isArray(children) ? children : [children];
  if (!list.some(Boolean)) return null;
  return (
    <div className="mb-2">
      <p className="px-2 py-1 text-[11px] font-medium tracking-wide text-muted uppercase">{title}</p>
      {children}
    </div>
  );
}

function Row({ title, meta, onClick }: { title: string; meta: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-slate-50">
      <span className="truncate text-sm">{title}</span>
      <span className="shrink-0 text-xs text-muted">{meta}</span>
    </button>
  );
}
