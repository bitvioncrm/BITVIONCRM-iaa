import { useState } from "react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/context/AuthContext";
import { useCrm } from "@/context/CrmContext";
import { usePermissions } from "@/hooks/usePermissions";
import { downloadText } from "@/lib/csv";
import { CLINIC, INSTITUTE, META_CAMPAIGNS, ROLE_LABEL } from "@/data/catalog";
import { ProductionSettings } from "@/pages/production/ProductionOpsPages";

const SECTIONS = ["General", "Company profile", "WhatsApp", "Meta Ads", "Notifications", "Automation", "Users & permissions", "Data management"] as const;

export function SettingsPage() {
  const { productionUser } = useAuth();
  if (productionUser) return <ProductionSettings />;
  return <DemoSettings />;
}

function DemoSettings() {
  const { state, updateSettings, updateAutomation, resetDemo } = useCrm();
  const { canManageSettings } = usePermissions();
  const [section, setSection] = useState<(typeof SECTIONS)[number]>("General");
  const [settings, setSettings] = useState(state.settings);
  const [connect, setConnect] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [reset, setReset] = useState(false);

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" description="Company profile, demo WhatsApp configuration and data tools." />
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <Card className="h-fit p-2">
          {SECTIONS.map((item) => (
            <button key={item} type="button" onClick={() => setSection(item)} className={`block w-full rounded-md px-3 py-2 text-left text-sm ${section === item ? "bg-slate-100 font-medium" : "text-muted"}`}>{item}</button>
          ))}
        </Card>
        <Card className="p-5">
          {section === "General" ? (
            <div className="max-w-lg space-y-3">
              <h2 className="font-semibold">General</h2>
              <label className="block text-sm">Timezone<Input className="mt-1" value={settings.timezone} onChange={(event) => setSettings({ ...settings, timezone: event.target.value })} /></label>
              <p className="text-sm text-muted">The desk uses {settings.timezone}. Dates in the prototype follow your browser clock.</p>
              <Button type="button" disabled={!canManageSettings} onClick={() => updateSettings(settings)}>Save</Button>
            </div>
          ) : null}
          {section === "Company profile" ? (
            <div className="max-w-lg space-y-3">
              <h2 className="font-semibold">Company profile</h2>
              <Input value={settings.companyName} onChange={(event) => setSettings({ ...settings, companyName: event.target.value })} />
              <Input value={settings.companyEmail} onChange={(event) => setSettings({ ...settings, companyEmail: event.target.value })} />
              <Input value={settings.companyPhone} onChange={(event) => setSettings({ ...settings, companyPhone: event.target.value })} />
              <Input value={settings.website} onChange={(event) => setSettings({ ...settings, website: event.target.value })} />
              <Input value={settings.address} onChange={(event) => setSettings({ ...settings, address: event.target.value })} />
              <p className="text-xs text-muted">{"{{company}} in templates uses this name."}</p>
              <Button type="button" disabled={!canManageSettings} onClick={() => updateSettings(settings)}>Save profile</Button>
            </div>
          ) : null}
          {section === "WhatsApp" ? (
            <div className="max-w-lg space-y-3">
              <h2 className="font-semibold">WhatsApp settings</h2>
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Demo Mode — WhatsApp API not connected</div>
              <Field label="WhatsApp Business account" value={settings.whatsapp.accountName} />
              <Field label="Phone number" value={settings.whatsapp.phoneNumber} />
              <Field label="Business ID" value={settings.whatsapp.businessId} />
              <Field label="API status" value="Not connected" />
              <Button type="button" onClick={() => setConnect(true)}>Connect WhatsApp</Button>
            </div>
          ) : null}
          {section === "Notifications" ? (
            <div className="space-y-4">
              <h2 className="font-semibold">Notification settings</h2>
              {([
                ["followUps", "Follow-ups due"],
                ["replies", "WhatsApp replies"],
                ["campaigns", "Campaign results"],
                ["overdue", "Overdue document reminders"],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-3 text-sm">
                  {label}
                  <Switch checked={settings.notifications[key]} onCheckedChange={(checked) => setSettings({ ...settings, notifications: { ...settings.notifications, [key]: checked } })} label={label} />
                </label>
              ))}
              <Button type="button" disabled={!canManageSettings} onClick={() => updateSettings(settings)}>Save notifications</Button>
            </div>
          ) : null}
          {section === "Automation" ? (
            <div className="space-y-3">
              <h2 className="font-semibold">Automation settings</h2>
              <p className="text-sm text-muted">WhatsApp automation runs for clinic leads only. Institute enquiries at IAA Kochi stay on direct calls and WhatsApp.</p>
              <label className="flex items-center justify-between text-sm">Sequence enabled <Switch checked={state.automation.enabled} onCheckedChange={(enabled) => updateAutomation({ enabled })} label="Automation" /></label>
              <label className="flex items-center justify-between text-sm">Run when a lead is created <Switch checked={state.automation.runOnNewLeads} onCheckedChange={(runOnNewLeads) => updateAutomation({ runOnNewLeads })} label="Run on create" /></label>
            </div>
          ) : null}
          {section === "Users & permissions" ? (
            <div className="space-y-3">
              <h2 className="font-semibold">Users & permissions</h2>
              <ul className="space-y-2 text-sm">
                {state.users.map((user) => (
                  <li key={user.id} className="flex justify-between gap-3 border-b border-line py-2">
                    <span>{user.name}</span>
                    <span className="text-muted">{ROLE_LABEL[user.role]}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted">Open Team to add employees, change each person's access, and assign fresh leads.</p>
            </div>
          ) : null}
          {section === "Meta Ads" ? (
            <div className="space-y-4">
              <h2 className="font-semibold">Meta Ads</h2>
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Demo Mode — Meta Ads API not connected. Lead forms are simulated.</div>
              <p className="text-sm text-muted">A person fills a Meta lead form on Facebook or Instagram. Bitvion receives the name, phone and place, then drops the enquiry into the fresh queue. The admin assigns it to a counsellor.</p>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
                <li>Campaign runs on the clinic page or the IAA Kochi page.</li>
                <li>Lead form captures name, phone and place.</li>
                <li>The lead lands here as New and unassigned.</li>
                <li>Admin assigns a clinic or institute counsellor.</li>
                <li>Clinic leads can receive automated WhatsApp. Institute leads do not.</li>
              </ol>
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <p><span className="text-muted">Account</span><br />{settings.meta.accountName}</p>
                <p><span className="text-muted">Ad account</span><br />{settings.meta.adAccountId}</p>
                <p><span className="text-muted">Page</span><br />{settings.meta.pageName}</p>
                <p><span className="text-muted">Status</span><br />{settings.meta.connected ? "Connected in demo" : "Disconnected"}</p>
              </div>
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="w-full text-left text-[13px]">
                  <thead className="border-b border-line text-xs text-muted"><tr>{["Campaign", "Desk", "Form", "Leads"].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead>
                  <tbody>
                    {META_CAMPAIGNS.map((campaign) => (
                      <tr key={campaign.id} className="border-b border-line last:border-0">
                        <td className="px-3 py-2">{campaign.name}</td>
                        <td className="px-3 py-2 capitalize">{campaign.unit}</td>
                        <td className="px-3 py-2">{campaign.form}</td>
                        <td className="px-3 py-2 tabular">{state.leads.filter((lead) => lead.metaCampaignId === campaign.id).length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={!canManageSettings} onClick={() => setMetaOpen(true)}>{settings.meta.connected ? "Review connection" : "Connect Meta Ads"}</Button>
                <Button type="button" variant="secondary" disabled={!canManageSettings} onClick={() => { const next = { ...settings, meta: { ...settings.meta, connected: !settings.meta.connected } }; setSettings(next); updateSettings(next); }}>
                  {settings.meta.connected ? "Disconnect" : "Mark connected"}
                </Button>
              </div>
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <div className="rounded-md border border-line p-3">
                  <p className="font-medium">{CLINIC.name}</p>
                  <p className="mt-1 text-muted">{CLINIC.hours}</p>
                  {CLINIC.branches.map((branch) => <p key={branch.name} className="mt-2">{branch.name}: {branch.address} · {branch.phone}</p>)}
                </div>
                <div className="rounded-md border border-line p-3">
                  <p className="font-medium">{INSTITUTE.name}</p>
                  <p className="mt-1 text-muted">{INSTITUTE.focus}</p>
                  <p className="mt-2">{INSTITUTE.place}. Automated WhatsApp is off for these leads.</p>
                </div>
              </div>
            </div>
          ) : null}
          {section === "Data management" ? (
            <div className="space-y-3">
              <h2 className="font-semibold">Data management</h2>
              <p className="text-sm text-muted">Leads, tasks, follow-ups, templates, campaigns, messages and settings are stored in this browser.</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => downloadText("recruitflow-demo.json", JSON.stringify(state), "application/json")}>Export JSON</Button>
                <Button type="button" variant="danger" onClick={() => setReset(true)}>Reset demo data</Button>
              </div>
            </div>
          ) : null}
        </Card>
      </div>
      <Dialog open={connect} onOpenChange={setConnect}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect WhatsApp</DialogTitle>
            <DialogDescription>This prototype stays in Demo Mode. Production will connect to the Meta WhatsApp Cloud API through a Netlify Function. No API credentials are requested here.</DialogDescription>
          </DialogHeader>
          <Button type="button" onClick={() => setConnect(false)}>Continue in demo mode</Button>
        </DialogContent>
      </Dialog>
      <Dialog open={metaOpen} onOpenChange={setMetaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect Meta Ads</DialogTitle>
            <DialogDescription>Demo Mode. Production will read lead forms from the Meta Marketing API. No ad account token is requested in this prototype.</DialogDescription>
          </DialogHeader>
          <Button type="button" onClick={() => setMetaOpen(false)}>Continue in demo mode</Button>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={reset} danger title="Reset demo data?" description="Local changes will be replaced with the BITVION clinic and institute dataset." confirmLabel="Reset" onOpenChange={setReset} onConfirm={resetDemo} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="block text-sm">
      {label}
      <Input className="mt-1" value={value} readOnly />
    </label>
  );
}
