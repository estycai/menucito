import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { AdminShell } from "@/components/shell/AdminShell";
import { GuestOnly, RequireAuth, RequireNoRestaurant, RequireRestaurant } from "@/components/guards";
import { ComingSoonPage } from "@/pages/ComingSoonPage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import {
  LocalAppearanceTab,
  LocalGeneralTab,
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
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { SummaryPage } from "@/pages/SummaryPage";
import { VerifyEmailPage } from "@/pages/VerifyEmailPage";
import { DEFAULT_LOCAL_TAB_PATH, LOCAL_TABS, type LocalTab } from "@/lib/local-tabs";
import { createQueryClient } from "@/lib/query-client";
import "./index.css";

const queryClient = createQueryClient();

/** Content of each "Mi local" tab; paths and order come from `LOCAL_TABS`. */
const LOCAL_TAB_ELEMENTS: Record<LocalTab["id"], ReactNode> = {
  general: <LocalGeneralTab />,
  appearance: <LocalAppearanceTab />,
  payments: <LocalPaymentsTab />,
  zones: <LocalZonesTab />,
};

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route element={<RequireRestaurant />}>
              <Route element={<AdminShell />}>
                <Route path="/" element={<SummaryPage />} />
                <Route path="/pedidos" element={<OrdersPage />} />
                <Route path="/menu" element={<MenuPage />} />
                <Route path="/menu/products/new" element={<ProductEditorPage />} />
                <Route path="/menu/products/:id" element={<ProductEditorPage />} />
                <Route path="/local" element={<LocalPage />}>
                  <Route index element={<Navigate to={DEFAULT_LOCAL_TAB_PATH} replace />} />
                  {LOCAL_TABS.map((tab) => (
                    <Route key={tab.id} path={tab.path} element={LOCAL_TAB_ELEMENTS[tab.id]} />
                  ))}
                  <Route path="*" element={<Navigate to={DEFAULT_LOCAL_TAB_PATH} replace />} />
                </Route>
                <Route path="/qr" element={<ComingSoonPage id="qr" />} />
                <Route path="/estadisticas" element={<ComingSoonPage id="stats" />} />
                <Route path="/plan" element={<PlanPage />} />
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
