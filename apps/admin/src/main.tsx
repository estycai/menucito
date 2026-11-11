import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { AdminShell } from "@/components/shell/AdminShell";
import { GuestOnly, RequireAuth, RequireCourier, RequireNoRestaurant, RequirePermission, RequireRestaurant } from "@/components/guards";
import { CashHistoryPage } from "@/pages/CashHistoryPage";
import { CashPage } from "@/pages/CashPage";
import { CashPrintPage } from "@/pages/CashPrintPage";
import { CashSessionDetailPage } from "@/pages/CashSessionDetailPage";
import { CouriersPage } from "@/pages/CouriersPage";
import { CustomersMapPage } from "@/pages/CustomersMapPage";
import { CustomersPage } from "@/pages/CustomersPage";
import { DeliveriesPage } from "@/pages/DeliveriesPage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { IntegrationsPage } from "@/pages/IntegrationsPage";
import {
  LocalAppearanceTab,
  LocalGeneralTab,
  LocalHoursTab,
  LocalPage,
  LocalPaymentsTab,
  LocalZonesTab,
} from "@/pages/LocalPage";
import { LoginPage } from "@/pages/LoginPage";
import { MenuPage } from "@/pages/MenuPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { OrdersPage } from "@/pages/OrdersPage";
import { PlanPage } from "@/pages/PlanPage";
import { ProductEditorPage } from "@/pages/ProductEditorPage";
import { ReportConfigPage } from "@/pages/ReportConfigPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { SummaryPage } from "@/pages/SummaryPage";
import { UsersPage, UsersRolesTab, UsersMembersTab } from "@/pages/UsersPage";
import { VerifyEmailPage } from "@/pages/VerifyEmailPage";
import { DEFAULT_LOCAL_TAB_PATH, LOCAL_TABS, type LocalTab } from "@/lib/local-tabs";
import { DEFAULT_USERS_TAB_PATH, USERS_TABS, type UsersTab } from "@/lib/users-tabs";
import { createQueryClient } from "@/lib/query-client";
import "./index.css";

const queryClient = createQueryClient();

/** Content of each "Mi local" tab; paths and order come from `LOCAL_TABS`. */
const LOCAL_TAB_ELEMENTS: Record<LocalTab["id"], ReactNode> = {
  general: <LocalGeneralTab />,
  appearance: <LocalAppearanceTab />,
  hours: <LocalHoursTab />,
  payments: <LocalPaymentsTab />,
  zones: <LocalZonesTab />,
};

/** Content of each "Usuarios" tab; paths and order come from `USERS_TABS`. */
const USERS_TAB_ELEMENTS: Record<UsersTab["id"], ReactNode> = {
  members: <UsersMembersTab />,
  roles: <UsersRolesTab />,
};

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route element={<RequireRestaurant />}>
              <Route element={<AdminShell />}>
                {/* Each section declares what it needs; without it the page never mounts. */}
                <Route element={<RequirePermission permission="summary.view" />}>
                  <Route path="/" element={<SummaryPage />} />
                </Route>
                <Route element={<RequirePermission permission="orders.view" />}>
                  <Route path="/pedidos" element={<OrdersPage />} />
                </Route>
                <Route element={<RequirePermission permission="customers.view" />}>
                  <Route path="/clientes" element={<CustomersPage />} />
                  <Route path="/clientes/mapa" element={<CustomersMapPage />} />
                </Route>
                <Route element={<RequirePermission permission="cash.view" />}>
                  <Route path="/cajas" element={<CashPage />} />
                </Route>
                <Route element={<RequirePermission permission="cash.history" />}>
                  <Route path="/cajas/historial" element={<CashHistoryPage />} />
                  <Route path="/cajas/:id" element={<CashSessionDetailPage />} />
                </Route>
                <Route element={<RequirePermission permission="couriers.view" />}>
                  <Route path="/repartidores" element={<CouriersPage />} />
                </Route>
                {/* "Mis repartos" follows the `is_courier` mark, not a permission (change 13, decision 10). */}
                <Route element={<RequireCourier />}>
                  <Route path="/mis-repartos" element={<DeliveriesPage />} />
                </Route>
                <Route element={<RequirePermission permission="menu.view" />}>
                  <Route path="/menu" element={<MenuPage />} />
                  <Route path="/menu/products/new" element={<ProductEditorPage />} />
                  <Route path="/menu/products/:id" element={<ProductEditorPage />} />
                </Route>
                <Route element={<RequirePermission permission="store.view" />}>
                  <Route path="/local" element={<LocalPage />}>
                    <Route index element={<Navigate to={DEFAULT_LOCAL_TAB_PATH} replace />} />
                    {LOCAL_TABS.map((tab) => (
                      <Route key={tab.id} path={tab.path} element={LOCAL_TAB_ELEMENTS[tab.id]} />
                    ))}
                    <Route path="*" element={<Navigate to={DEFAULT_LOCAL_TAB_PATH} replace />} />
                  </Route>
                </Route>
                <Route element={<RequirePermission ownerOnly />}>
                  <Route path="/usuarios" element={<UsersPage />}>
                    <Route index element={<Navigate to={DEFAULT_USERS_TAB_PATH} replace />} />
                    {USERS_TABS.map((tab) => (
                      <Route key={tab.id} path={tab.path} element={USERS_TAB_ELEMENTS[tab.id]} />
                    ))}
                    <Route path="*" element={<Navigate to={DEFAULT_USERS_TAB_PATH} replace />} />
                  </Route>
                </Route>
                <Route element={<RequirePermission permission="integrations.view" />}>
                  <Route path="/integraciones" element={<IntegrationsPage />} />
                </Route>
                <Route element={<RequirePermission permission="stats.view" />}>
                  <Route path="/reportes" element={<ReportsPage />} />
                </Route>
                <Route element={<RequirePermission ownerOnly />}>
                  <Route path="/reportes/configurar" element={<ReportConfigPage />} />
                  <Route path="/plan" element={<PlanPage />} />
                </Route>
              </Route>
              {/* The printed arqueo lives outside the panel shell: a plain A4 page. */}
              <Route element={<RequirePermission permission="cash.history" />}>
                <Route path="/cajas/:id/imprimir" element={<CashPrintPage />} />
              </Route>
            </Route>
            <Route element={<RequireNoRestaurant />}>
              <Route path="/onboarding" element={<OnboardingPage />} />
            </Route>
          </Route>
          <Route element={<GuestOnly />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
