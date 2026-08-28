import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./layout/AppLayout";
import RequireAuth from "./components/RequireAuth";

const Login = lazy(() => import("./pages/Login"));
const AdminControl = lazy(() => import("./pages/AdminControl"));

const Overview = lazy(() => import("./pages/Overview"));
const InboundRequests = lazy(() => import("./pages/InboundRequests"));
const InboundRequestDetail = lazy(() => import("./pages/InboundRequestDetail"));
const RecordDetail = lazy(() => import("./pages/RecordDetail"));
const ShipmentsInProcess = lazy(() => import("./pages/ShipmentsInProcess"));
const ShipmentsCompleted = lazy(() => import("./pages/ShipmentsCompleted"));
const ShipmentDetail = lazy(() => import("./pages/ShipmentDetail"));
const SpaceContainers = lazy(() => import("./pages/SpaceContainers"));
const Documentation = lazy(() => import("./pages/Documentation"));
const Mail = lazy(() => import("./pages/Mail"));
const LiveCalls = lazy(() => import("./pages/LiveCalls"));
const Complaints = lazy(() => import("./pages/Complaints"));
const Billing = lazy(() => import("./pages/Billing"));
const KnowledgeBase = lazy(() => import("./pages/KnowledgeBase"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Connections = lazy(() => import("./pages/Connections"));

function PageFallback() {
  return <div className="text-sm text-text-muted py-10">Loading…</div>;
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        {/* Sign-in — the two doors. */}
        <Route path="/login" element={<Login role="employee" />} />
        <Route path="/admin/login" element={<Login role="admin" />} />

        {/* Admin area. */}
        <Route element={<RequireAuth role="admin" />}>
          <Route path="/admin" element={<AdminControl />} />
        </Route>

        {/* The CRM. Everything inside is employee-only. */}
        <Route element={<RequireAuth role="employee" />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Overview />} />
            <Route path="/inbound" element={<InboundRequests />} />
            <Route path="/inbound/:id" element={<InboundRequestDetail />} />
            <Route path="/shipments/in-process" element={<ShipmentsInProcess />} />
            <Route path="/shipments/completed" element={<ShipmentsCompleted />} />
            <Route path="/shipments/:id" element={<ShipmentDetail />} />
            <Route path="/records/:ref" element={<RecordDetail />} />
            <Route path="/space-containers" element={<SpaceContainers />} />
            <Route path="/documentation" element={<Documentation />} />
            <Route path="/mail" element={<Mail />} />
            <Route path="/live-calls" element={<LiveCalls />} />
            <Route path="/complaints" element={<Complaints />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/knowledge-base" element={<KnowledgeBase />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/connections" element={<Connections />} />
          </Route>
        </Route>

        {/* Unknown paths land on the employee door, which redirects on if signed in. */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}
