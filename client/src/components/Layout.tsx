import { Outlet } from "react-router-dom";
import { Header } from "./Header";
import { Footer } from "./Footer";

/**
 * Estructura común de todas las páginas: Header + contenido + Footer.
 * Antes cada página importaba y renderizaba Header/Footer por su cuenta, y
 * cinco de ellas (AdminDashboard, AdminVerifications, Profile, PublishTrip y
 * TripDetail) se quedaron sin Footer; otras tenían ramas de render que no lo
 * incluían. Acá vive una sola vez y no se puede olvidar.
 *
 * Login queda fuera de este layout a propósito: es una pantalla aparte.
 */
export function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas font-sans text-ink">
      <Header />
      {/* sin <main> porque las páginas ya lo renderizan */}
      <div className="flex-1">
        <Outlet />
      </div>
      <Footer />
    </div>
  );
}
