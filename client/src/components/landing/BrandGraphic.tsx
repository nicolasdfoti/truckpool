/**
 * Componente gráfico simple usando la paleta de marca.
 * Reemplaza la foto de stock del Hero con un elemento visual
 * propio del sistema de diseño: formas geométricas, gradientes
 * y el glifo del camión en colores de marca.
 */
import { Truck } from "../icons";

export function BrandGraphic({ className = "" }: { className?: string }) {
  return (
    <div className={`relative aspect-[16/9] max-w-5xl mx-auto ${className}`} aria-hidden>
      {/* Capa base: gradiente de marca */}
      <div className="absolute inset-0 bg-gradient-to-br from-brand-deep via-brand-deep/70 to-brand/40" />

      {/* Formas geométricas decorativas */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-96 h-96 rounded-full bg-brand-light/15 blur-3xl" />
        <div className="absolute top-1/3 left-1/4 w-48 h-48 rounded-full bg-accent/10 blur-2xl" />
      </div>

      {/* Líneas de ruta sutiles */}
      <svg
        className="absolute inset-0 w-full h-full opacity-30 pointer-events-none"
        viewBox="0 0 800 450"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="routeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f58220" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#0b3d5c" stopOpacity="0.6" />
          </linearGradient>
        </defs>
        <path
          d="M80 300 C 200 150, 400 150, 600 300 C 700 400, 720 380, 760 360"
          stroke="url(#routeGradient)"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="80" cy="300" r="8" fill="#f58220" />
        <circle cx="760" cy="360" r="8" fill="#0b3d5c" />
      </svg>

      {/* Camión central */}
      <div className="absolute inset-0 flex items-center justify-center">
        <Truck size={72} className="text-white/90 drop-shadow-lg" strokeWidth={2.5} />
      </div>

      {/* Texto sutil de propósito */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-center">
        <p className="text-xs font-medium text-white/60 tracking-wider uppercase">
          capacidad compartida · rutas optimizadas · menos km vacíos
        </p>
      </div>
    </div>
  );
}
