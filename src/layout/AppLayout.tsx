import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function AppLayout() {
  return (
    <div className="flex min-h-screen bg-surface-0">
      <Sidebar />
      <div className="flex-1 min-w-0">
        <Topbar />
        <main className="max-w-6xl px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
