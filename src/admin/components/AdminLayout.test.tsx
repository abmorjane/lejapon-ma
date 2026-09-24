import { lazy } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_SIDEBAR_SCROLL_KEY, AdminLayout } from "./AdminLayout";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "staff-user", email: "staff@lejapon.test" },
    isStaff: true,
    isSupplierOnly: false,
    loading: false,
    signOut: vi.fn(),
    roles: ["super_admin"],
    can: () => true,
  }),
}));

vi.mock("./AdminQuickActionBar", () => ({ AdminQuickActionBar: () => <div data-testid="quick-actions" /> }));
vi.mock("@/admin/lib/push-notifications", () => ({ registerAdminPushSubscription: vi.fn() }));

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("AdminLayout persistent navigation", () => {
  it("keeps the sidebar mounted, its scroll position and active navigation while a lazy page loads", async () => {
    let resolveClients!: (value: { default: () => JSX.Element }) => void;
    const LazyClients = lazy(() => new Promise((resolve) => { resolveClients = resolve; }));

    render(
      <MemoryRouter initialEntries={["/admin/bookings"]} future={{ v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="bookings" element={<div>Page réservations</div>} />
            <Route path="clients" element={<LazyClients />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const sidebar = screen.getByTestId("admin-sidebar-scroll");
    sidebar.scrollTop = 284;
    fireEvent.scroll(sidebar);
    expect(window.sessionStorage.getItem(ADMIN_SIDEBAR_SCROLL_KEY)).toBe("284");

    fireEvent.click(screen.getByRole("link", { name: "Clients CRM" }));
    expect(screen.getByTestId("admin-sidebar-scroll")).toBe(sidebar);
    expect(screen.getByTestId("admin-content-fallback")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clients CRM" })).toHaveAttribute("aria-current", "page");
    expect(sidebar.scrollTop).toBe(284);

    await act(async () => resolveClients({ default: () => <div>Page clients</div> }));
    expect(await screen.findByText("Page clients")).toBeInTheDocument();
  });

  it("forces the active group open after refresh and restores the stored scrollTop", async () => {
    window.localStorage.setItem("lejapon.admin.nav.openGroups", JSON.stringify({ partners: false }));
    window.sessionStorage.setItem(ADMIN_SIDEBAR_SCROLL_KEY, "173");

    render(
      <MemoryRouter initialEntries={["/admin/organizations"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="organizations" element={<div>Organisations</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: /Partner Agencies/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Organisations" })).toHaveAttribute("aria-current", "page");
    await waitFor(() => expect(screen.getByTestId("admin-sidebar-scroll").scrollTop).toBe(173));
  });
});
