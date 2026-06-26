import { Navigate, Route, Routes } from "react-router-dom";
import ToastContainer from "./components/ToastContainer";
import { ToastProvider } from "./context/ToastContext";
import AdminMappings from "./pages/AdminMappings";
import AdminDatabase from "./pages/AdminDatabase";
import Dashboard from "./pages/Dashboard";
import DeliveryPage from "./pages/DeliveryPage";
import Login from "./pages/Login";
import Settings from "./pages/settings";
import TicketHistory from "./pages/TicketHistory";

export default function App() {
  return (
    <ToastProvider>
    <ToastContainer />
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/history" element={<TicketHistory />} />
      <Route path="/deliver/:issueKey" element={<DeliveryPage />} />
      <Route path="/admin/mappings" element={<AdminMappings />} />
      <Route path="/admin/database" element={<AdminDatabase />} />
      <Route path="/settings/*" element={<Settings />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </ToastProvider>
  );
}
