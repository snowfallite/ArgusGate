import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppShell } from "@/components/AppShell";
import { Dashboard } from "@/pages/Dashboard";
import { Layer1Normalization } from "@/pages/Layer1Normalization";
import { Layer2Signatures } from "@/pages/Layer2Signatures";
import { Layer3VectorSimilarity } from "@/pages/Layer3VectorSimilarity";
import { Layer4MLClassifier } from "@/pages/Layer4MLClassifier";
import { Layer5SessionAnalysis } from "@/pages/Layer5SessionAnalysis";
import { Layer6OutputStream } from "@/pages/Layer6OutputStream";
import { Layer7JudgeModel } from "@/pages/Layer7JudgeModel";
import { AuditLog } from "@/pages/AuditLog";
import { DatasetsTraining } from "@/pages/DatasetsTraining";
import { ActiveSessions } from "@/pages/ActiveSessions";
import { Settings } from "@/pages/Settings";
import { Notifications } from "@/pages/Notifications";
import { ClientApplications } from "@/pages/ClientApplications";
import { PipelineTest } from "@/pages/PipelineTest";
import { Login } from "@/pages/Login";

function AppRoutes() {
  const { token, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-base flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!token) {
    return <Login />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="layer/1" element={<Layer1Normalization />} />
          <Route path="layer/2" element={<Layer2Signatures />} />
          <Route path="layer/3" element={<Layer3VectorSimilarity />} />
          <Route path="layer/4" element={<Layer4MLClassifier />} />
          <Route path="layer/5" element={<Layer5SessionAnalysis />} />
          <Route path="layer/6" element={<Layer6OutputStream />} />
          <Route path="layer/7" element={<Layer7JudgeModel />} />
          <Route path="audit-log" element={<AuditLog />} />
          <Route path="active-sessions" element={<ActiveSessions />} />
          <Route path="datasets-training" element={<DatasetsTraining />} />
          <Route path="settings" element={<Settings />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="client-applications" element={<ClientApplications />} />
          <Route path="pipeline-test" element={<PipelineTest />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
