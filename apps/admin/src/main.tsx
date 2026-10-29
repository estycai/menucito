import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GuestOnly, RequireAuth, RequireNoRestaurant, RequireRestaurant } from "@/components/guards";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { LocalPage } from "@/pages/LocalPage";
import { LoginPage } from "@/pages/LoginPage";
import { MenuPage } from "@/pages/MenuPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { ProductEditorPage } from "@/pages/ProductEditorPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { VerifyEmailPage } from "@/pages/VerifyEmailPage";
import { WelcomePage } from "@/pages/WelcomePage";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route element={<RequireRestaurant />}>
              <Route path="/" element={<WelcomePage />} />
              <Route path="/local" element={<LocalPage />} />
              <Route path="/menu" element={<MenuPage />} />
              <Route path="/menu/products/new" element={<ProductEditorPage />} />
              <Route path="/menu/products/:id" element={<ProductEditorPage />} />
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
