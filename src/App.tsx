import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./layout/AppLayout";
import RequireAuth from "./components/RequireAuth";

const Login = lazy(() => import("./pages/Login"));
const AdminControl = lazy(() => import("./pages/AdminControl"));

const Overview = lazy(() => import("./pages/Overview"));
const ShipmentsInProcess = lazy(() => import("./pages/ShipmentsInProcess"));
const ShipmentsCompleted = lazy(() => import("./pages/ShipmentsCompleted"));
const ShipmentDetail = lazy(() => import("./pages/ShipmentDetail"));
const ShipmentOverview = lazy(() => import("./pages/shipment/ShipmentOverview"));
const ShipmentInvoices = lazy(() => import("./pages/shipment/ShipmentInvoices"));
const ShipmentContainers = lazy(() => import("./pages/shipment/ShipmentContainers"));
const ShipmentParties = lazy(() => import("./pages/shipment/ShipmentParties"));
const ShipmentCosts = lazy(() => import("./pages/shipment/ShipmentCosts"));
const SpaceContainers = lazy(() => import("./pages/SpaceContainers"));
const Containers = lazy(() => import("./pages/Containers"));
const Consoles = lazy(() => import("./pages/Consoles"));
const Documentation = lazy(() => import("./pages/Documentation"));
const Mail = lazy(() => import("./pages/Mail"));
const Intake = lazy(() => import("./pages/Intake"));
const Enquiries = lazy(() => import("./pages/Enquiries"));
const MyEnquiries = lazy(() => import("./pages/MyEnquiries"));
const Oversight = lazy(() => import("./pages/Oversight"));
const CaseFile = lazy(() => import("./pages/CaseFile"));
const Complaints = lazy(() => import("./pages/Complaints"));
const Billing = lazy(() => import("./pages/Billing"));
const Receipts = lazy(() => import("./pages/Receipts"));
const Payables = lazy(() => import("./pages/Payables"));
const Partners = lazy(() => import("./pages/Partners"));
const Analytics = lazy(() => import("./pages/Analytics"));

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
            <Route path="/shipments/in-process" element={<ShipmentsInProcess />} />
            <Route path="/shipments/completed" element={<ShipmentsCompleted />} />
            {/*
              The shipment is one page with sections, not several pages.
              Keeping the section in the path means a refresh lands where you
              were and a colleague can be sent straight to a job's invoices.
            */}
            <Route path="/shipments/:id" element={<ShipmentDetail />}>
              <Route index element={<ShipmentOverview />} />
              <Route path="parties" element={<ShipmentParties />} />
              <Route path="containers" element={<ShipmentContainers />} />
              <Route path="invoices" element={<ShipmentInvoices />} />
              <Route path="costs" element={<ShipmentCosts />} />
            </Route>
            <Route path="/consoles" element={<Consoles />} />
            <Route path="/containers" element={<Containers />} />
            <Route path="/space-containers" element={<SpaceContainers />} />
            <Route path="/documentation" element={<Documentation />} />
            <Route path="/mail" element={<Mail />} />
            <Route path="/intake" element={<Intake />} />
            <Route path="/enquiries" element={<Enquiries />} />
            <Route path="/my-enquiries" element={<MyEnquiries />} />
            <Route path="/oversight" element={<Oversight />} />
            <Route path="/enquiries/:ref" element={<CaseFile />} />
            <Route path="/complaints" element={<Complaints />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/receipts" element={<Receipts />} />
            <Route path="/payables" element={<Payables />} />
            <Route path="/partners" element={<Partners />} />
            <Route path="/analytics" element={<Analytics />} />
          </Route>
        </Route>

        {/* Unknown paths land on the employee door, which redirects on if signed in. */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}
