import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

import { Sidebar } from "@/components/Sidebar";

export const Route = createRootRouteWithContext()({
  component: () => (
    <div className="flex h-screen">
      <Sidebar />
      <main className="h-full flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  ),
});
