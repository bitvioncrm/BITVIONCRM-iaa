import { useState } from "react";
import { DashboardCharts } from "@/components/dashboard/DashboardCharts";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCrm } from "@/context/CrmContext";
import { ROLE_LABEL } from "@/data/catalog";
import { downloadCsv } from "@/lib/csv";
import { averageResponseMinutes, employeeRows, followUpSeries, formatDuration, snapshotMetrics } from "@/lib/metrics";
import { percent } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { ProductionReports } from "@/pages/production/ProductionOpsPages";
import type { DateRangeKey } from "@/types";

type Range = DateRangeKey | "all";

export function ReportsPage() {
  const { productionUser } = useAuth();
  if (productionUser) return <ProductionReports />;
  return <DemoReports />;
}

function DemoReports() {
  const { state } = useCrm();
  const [range, setRange] = useState<Range>("all");
  const metrics = snapshotMetrics(state);
  const chartRange: DateRangeKey = range === "all" ? "month" : range;
  const people = employeeRows(state, range);
  const follow = followUpSeries(state, chartRange);
  const followTotal = follow.reduce((sum, item) => sum + item.value, 0);
  const completion = followTotal ? ((follow.find((item) => item.name === "Completed")?.value ?? 0) / followTotal) * 100 : 0;
  const messages = state.messages.filter((item) => item.direction === "out");
  const failed = messages.filter((item) => item.status === "failed").length;
  const replies = state.messages.filter((item) => item.direction === "in").length;

  const exportReport = () => {
    downloadCsv("recruitflow-report.csv", [
      ["Metric", "Value"],
      ["Total leads", metrics.total],
      ["Contacted", state.leads.filter((lead) => lead.status === "contacted").length],
      ["Interested", metrics.interested],
      ["Converted", metrics.converted],
      ["Lost", state.leads.filter((lead) => lead.status === "lost").length],
      ["Conversion rate", percent(metrics.conversionRate)],
      ["Average response time", formatDuration(averageResponseMinutes(state))],
      ["Follow-up completion", percent(completion)],
      [],
      ["Employee", "Leads", "Contacted", "Interested", "Converted", "Lost", "Follow-ups", "Rate"],
      ...people.map((person) => [person.name, person.leads, person.contacted, person.interested, person.converted, person.lost, person.followUps, percent(person.rate)]),
    ]);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports"
        description="Lead performance, funnel, recruiters, sources, WhatsApp and follow-ups."
        actions={
          <>
            <div className="inline-flex rounded-lg border border-line bg-white p-1">
              {(["all", "today", "week", "month"] as Range[]).map((item) => (
                <button key={item} type="button" onClick={() => setRange(item)} className={`rounded-md px-3 py-1.5 text-[13px] ${range === item ? "bg-navy text-white" : "text-muted"}`}>
                  {item === "all" ? "All time" : item === "week" ? "This week" : item === "month" ? "This month" : "Today"}
                </button>
              ))}
            </div>
            <Button type="button" variant="secondary" onClick={exportReport}>Export CSV</Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Total leads", metrics.total.toLocaleString("en-IN")],
          ["Contacted", state.leads.filter((lead) => lead.status === "contacted").length.toLocaleString("en-IN")],
          ["Interested", metrics.interested.toLocaleString("en-IN")],
          ["Converted", metrics.converted.toLocaleString("en-IN")],
          ["Lost", state.leads.filter((lead) => lead.status === "lost").length.toLocaleString("en-IN")],
          ["Conversion rate", percent(metrics.conversionRate)],
          ["Avg. response time", formatDuration(averageResponseMinutes(state))],
          ["Follow-up completion", percent(completion)],
        ].map(([label, value]) => (
          <Card key={label} className="px-4 py-3">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular">{value}</p>
          </Card>
        ))}
      </div>
      <DashboardCharts state={state} range={chartRange} />
      <Card className="overflow-x-auto">
        <h2 className="px-4 py-3 text-sm font-semibold">Employee performance</h2>
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <thead className="border-y border-line text-xs text-muted">
            <tr>{["Name", "Role", "Leads", "Contacted", "Interested", "Converted", "Lost", "Follow-ups", "Rate"].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2 font-medium">{person.name}</td>
                <td className="px-3 py-2">{ROLE_LABEL[person.role]}</td>
                <td className="px-3 py-2 tabular">{person.leads}</td>
                <td className="px-3 py-2 tabular">{person.contacted}</td>
                <td className="px-3 py-2 tabular">{person.interested}</td>
                <td className="px-3 py-2 tabular">{person.converted}</td>
                <td className="px-3 py-2 tabular">{person.lost}</td>
                <td className="px-3 py-2 tabular">{person.followUps}</td>
                <td className="px-3 py-2 tabular">{percent(person.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-sm font-semibold">WhatsApp performance</h2>
          <p className="mt-2 text-sm text-muted">Outgoing {messages.length} · Replies {replies} · Failed {failed}</p>
          <p className="text-sm text-muted">Reply rate {messages.length ? percent((replies / messages.length) * 100) : "0%"}</p>
        </Card>
        <Card className="p-4">
          <h2 className="text-sm font-semibold">Lead source performance</h2>
          <p className="mt-2 text-sm text-muted">Source mix is charted above and updates with the date range.</p>
        </Card>
      </div>
    </div>
  );
}
