import { Suspense, lazy } from "react";
import { Routes, Route } from "react-router-dom";
import AppLayout from "./layout/AppLayout";

const Overview = lazy(() => import("./pages/Overview"));
const InboundRequests = lazy(() => import("./pages/InboundRequests"));
const ShipmentsInProcess = lazy(() => import("./pages/ShipmentsInProcess"));
const ShipmentsCompleted = lazy(() => import("./pages/ShipmentsCompleted"));
const ShipmentDetail = lazy(() => import("./pages/ShipmentDetail"));
const SpaceContainers = lazy(() => import("./pages/SpaceContainers"));
const Documentation = lazy(() => import("./pages/Documentation"));
const LiveCalls = lazy(() => import("./pages/LiveCalls"));
const Complaints = lazy(() => import("./pages/Complaints"));
const Billing = lazy(() => import("./pages/Billing"));
const Agents = lazy(() => import("./pages/Agents"));
const KnowledgeBase = lazy(() => import("./pages/KnowledgeBase"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Compliance = lazy(() => import("./pages/Compliance"));
const Connections = lazy(() => import("./pages/Connections"));

function PageFallback() {
  return <div className="text-sm text-text-muted py-10">Loading…</div>;
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Overview />} />
          <Route path="/inbound" element={<InboundRequests />} />
          <Route path="/shipments/in-process" element={<ShipmentsInProcess />} />
          <Route path="/shipments/completed" element={<ShipmentsCompleted />} />
          <Route path="/shipments/:id" element={<ShipmentDetail />} />
          <Route path="/space-containers" element={<SpaceContainers />} />
          <Route path="/documentation" element={<Documentation />} />
          <Route path="/live-calls" element={<LiveCalls />} />
          <Route path="/complaints" element={<Complaints />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/knowledge-base" element={<KnowledgeBase />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/compliance" element={<Compliance />} />
          <Route path="/connections" element={<Connections />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
