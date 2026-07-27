import "./styles/globals.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { Component, ErrorInfo, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { AppI18nProvider } from "@/i18n/provider";
import { routeTree } from "@/routeTree.gen";

const queryClient = new QueryClient();

const router = createRouter({
  routeTree,
  context: undefined,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("应用渲染错误:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: "monospace", color: "#b91c1c" }}>
          <h2 style={{ marginBottom: 12 }}>应用加载失败</h2>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  return <RouterProvider router={router} />;
}

function AppRoot() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AppI18nProvider>
          <App />
        </AppI18nProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

const rootElement = document.getElementById("root")!;

createRoot(rootElement).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
