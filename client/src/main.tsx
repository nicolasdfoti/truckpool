import { StrictMode } from "react";
import "./index.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Login from "./pages/Login";
import TripDetail from "./pages/TripDetail";
import TrackTrip from "./pages/TrackTrip";
import TrackPackage from "./pages/TrackPackage";
import Trips from "./pages/Trips";
import PublishTrip from "./pages/PublishTrip";
import Profile from "./pages/Profile";
import Carriers from "./pages/Carriers";
import PaymentReturn from "./pages/PaymentReturn";
import CarrierProfile from "./pages/CarrierProfile";
import AdminVerifications from "./pages/AdminVerifications";
import AdminDashboard from "./pages/AdminDashboard";
import TripRequests from "./pages/TripRequests";
import About from "./pages/About";
import NotFound from "./pages/NotFound";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { DocumentTitle } from "./components/DocumentTitle";
import { Layout } from "./components/Layout";
import { queryClient } from "./lib/queryClient";
import { createRoot } from "react-dom/client";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <DocumentTitle />
          <Routes>
            {/* Login es pantalla completa: fuera del layout común */}
            <Route path="/ingresar" element={<Login />} />
            <Route element={<Layout />}>
              <Route path="/" element={<Home />} />
              <Route path="/viajes" element={<Trips />} />
              <Route path="/viajes/nuevo" element={<PublishTrip />} />
              <Route path="/viajes/:id" element={<TripDetail />} />
              <Route path="/viajes/:id/trackear" element={<TrackTrip />} />
              <Route path="/rastrear" element={<TrackPackage />} />
              <Route path="/solicitudes" element={<TripRequests />} />
              <Route path="/nosotros" element={<About />} />
              <Route path="/perfil" element={<Profile />} />
              <Route path="/fleteros" element={<Carriers />} />
              <Route path="/fleteros/:id" element={<CarrierProfile />} />
              <Route path="/pagos/retorno" element={<PaymentReturn />} />
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/verificaciones" element={<AdminVerifications />} />
              {/* catch-all: tiene que ser la última ruta, matchea cualquier path */}
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>
);
