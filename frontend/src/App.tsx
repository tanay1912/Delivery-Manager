import { Navigate, Route, Routes } from "react-router-dom";
import AdminMappings from "./pages/AdminMappings";
import Dashboard from "./pages/Dashboard";
import DeliveryPage from "./pages/DeliveryPage";
import Login from "./pages/Login";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/deliver/:issueKey" element={<DeliveryPage />} />
      <Route path="/admin/mappings" element={<AdminMappings />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
