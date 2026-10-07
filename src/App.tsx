import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CrmProvider } from "@/context/CrmContext";
import { ActivityPage } from "@/pages/ActivityPage";
import { CallsPage } from "@/pages/CallsPage";
import { CampaignsPage } from "@/pages/CampaignsPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { DeskPage } from "@/pages/DeskPage";
import { FollowUpsPage } from "@/pages/FollowUpsPage";
import { LeadDetailPage } from "@/pages/LeadDetailPage";
import { LeadsPage } from "@/pages/LeadsPage";
import { LoginPage } from "@/pages/LoginPage";
import { PipelinePage } from "@/pages/PipelinePage";
import { ReportsPage } from "@/pages/ReportsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { TasksPage } from "@/pages/TasksPage";
import { TeamPage } from "@/pages/TeamPage";
import { TemplatesPage } from "@/pages/TemplatesPage";
import { WhatsAppPage } from "@/pages/WhatsAppPage";
import { ProductionModule } from "@/pages/production/ProductionModule";

function RequireAuth() {
  const { session } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  return (
    <CrmProvider>
      <AppShell />
    </CrmProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Toaster />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/desk" element={<DeskPage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/leads/:id" element={<LeadDetailPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/follow-ups" element={<FollowUpsPage />} />
          <Route path="/calls" element={<CallsPage />} />
          <Route path="/whatsapp" element={<WhatsAppPage />} />
          <Route path="/campaigns" element={<CampaignsPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/team" element={<TeamPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/clinic" element={<ProductionModule module="clinic" />} />
          <Route path="/institute" element={<ProductionModule module="institute" />} />
          <Route path="/inventory" element={<ProductionModule module="inventory" />} />
          <Route path="/billing" element={<ProductionModule module="billing" />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
