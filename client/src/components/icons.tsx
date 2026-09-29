import type { ReactNode } from "react";

export type IconProps = {
  className?: string;
  size?: number;
  strokeWidth?: number;
  /**
   * Para iconos decorativos que acompanan a texto que ya dice lo mismo. Saca el
   * icono del arbol de accesibilidad: sin esto, un lector de pantalla anuncia
   * "Check circle" antes de cada item de una lista.
   */
  "aria-hidden"?: boolean | "true" | "false";
};

function iconBase(label: string, paths: ReactNode, fill = "none") {
  return ({
    className,
    size = 24,
    strokeWidth = 2,
    "aria-hidden": ariaHidden,
  }: IconProps) => {
    // aria-hidden gana sobre el par label/role: si el icono esta decorativo no
    // debe quedar expuesto como imagen.
    const a11y =
      ariaHidden !== undefined
        ? { "aria-hidden": ariaHidden }
        : { "aria-label": label, role: "img" };
    return (
      <svg
        {...a11y}
        className={className}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={fill}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {paths}
      </svg>
    );
  };
}

// mismo trazo del camión que usa el Logo (Logo.tsx) y el favicon
// (public/favicon.svg), para que el glifo de marca sea el mismo en todos lados
export const Truck = iconBase(
  "Truck",
  <path d="M3 17V7a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v10M3 17h11M3 17a2 2 0 1 0 4 0m7-0a2 2 0 1 0 4 0m0 0h2a1 1 0 0 0 1-1v-3.6a1 1 0 0 0-.29-.7L19 8.3a1 1 0 0 0-.7-.3H14v9" />
);

export const Search = iconBase(
  "Search",
  <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M20 20l-4.7-4.7" />
  </>
);

export const CheckCircle = iconBase(
  "Check circle",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 12.5l2.5 2.5 5-5" />
  </>
);

export const Star = iconBase(
  "Star",
  <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5z" />
);

export const StarFilled = iconBase(
  "Star",
  <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5z" />,
  "currentColor"
);

export const XCircle = iconBase(
  "X circle",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 9l6 6M15 9l-6 6" />
  </>
);

export const Clock = iconBase(
  "Clock",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </>
);

export const DollarSign = iconBase(
  "Dollar sign",
  <>
    <path d="M12 3v18" />
    <path d="M16.5 7.5c0-1.7-1.6-3-4-3s-4 1.2-4 2.8c0 3.6 8 1.9 8 5.7 0 1.6-1.8 3-4 3s-4-1.3-4-3" />
  </>
);

export const LayoutDashboard = iconBase(
  "Dashboard",
  <>
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="3" width="8" height="5" rx="1.5" />
    <rect x="13" y="10" width="8" height="11" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" />
  </>
);

export const Calendar = iconBase(
  "Calendar",
  <>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </>
);

export const TrendingUp = iconBase(
  "Trending up",
  <>
    <path d="M3 17l6-6 4 4 8-8" />
    <path d="M15 7h6v6" />
  </>
);

export const Handshake = iconBase(
  "Handshake",
  <>
    <path d="M2 13l5-5 3.5 3.5-1.8 1.8" />
    <path d="M22 13l-5-5-3.5 3.5 1.8 1.8" />
    <path d="M9.5 13.3l2 2a1.4 1.4 0 0 0 2-2l-2-2" />
  </>
);

export const User = iconBase(
  "User",
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" />
  </>
);

export const FileText = iconBase(
  "File",
  <>
    <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M14 3v4h4M9 13h6M9 17h6" />
  </>
);

export const ArrowRight = iconBase("Arrow right", <path d="M4 12h16M14 6l6 6-6 6" />);

export const ShieldCheck = iconBase(
  "Shield",
  <>
    <path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z" />
    <path d="M9 12l2 2 4-4" />
  </>
);

export const MapPin = iconBase(
  "Map pin",
  <>
    <path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z" />
    <circle cx="12" cy="9" r="2.5" />
  </>
);

export const Leaf = iconBase(
  "Leaf",
  <>
    <path d="M6 20C5 12 9 5 20 4c1 10-6 17-14 16z" />
    <path d="M6 20c3-5 7-9 11-13" />
  </>
);

export const Instagram = iconBase(
  "Instagram",
  <>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.3" cy="6.7" r="0.8" />
  </>
);

export const Facebook = iconBase(
  "Facebook",
  <path d="M15 8h2V4h-2a4 4 0 0 0-4 4v2H9v4h2v8h4v-8h2.5l.5-4H15V8a1 1 0 0 1 1-1z" />
);

export const Twitter = iconBase(
  "Twitter",
  <path d="M22 5.8c-.7.3-1.5.6-2.3.7.8-.5 1.4-1.3 1.7-2.2-.8.5-1.6.8-2.5 1a4 4 0 0 0-6.8 3.6A11.3 11.3 0 0 1 3.8 4.6a4 4 0 0 0 1.2 5.3c-.6 0-1.3-.2-1.8-.5v.1c0 2 1.4 3.6 3.2 4a4 4 0 0 1-1.8.1 4 4 0 0 0 3.7 2.7A8 8 0 0 1 2 18.4a11.3 11.3 0 0 0 6.1 1.8c7.3 0 11.3-6 11.3-11.3v-.5c.8-.6 1.4-1.3 1.9-2.1z" />
);

export const Linkedin = iconBase(
  "LinkedIn",
  <>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M7.5 10.5v6M7.5 7.8v.01M11.5 16.5v-3.4c0-1.2.9-2 2-2s2 .8 2 2v3.4" />
  </>
);

export const Building2 = iconBase(
  "Building",
  <>
    <rect x="4" y="3" width="10" height="18" rx="1" />
    <rect x="14" y="9" width="6" height="12" rx="1" />
    <path d="M7 7h1M11 7h1M7 11h1M11 11h1M7 15h1M11 15h1M16.5 12.5h1M16.5 16h1" />
  </>
);

export const Menu = iconBase("Menu", <path d="M3 6h18M3 12h18M3 18h18" />);

export const Bell = iconBase(
  "Bell",
  <>
    <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 01-3.46 0" />
  </>
);

export const Check = iconBase("Check", <path d="M20 6L9 17l-5-5" />);

export const X = iconBase("Close", <path d="M6 6l12 12M18 6L6 18" />);

export const ChevronDown = iconBase("Chevron down", <path d="M6 9l6 6 6-6" />);

export const ChevronLeft = iconBase("Chevron left", <path d="M15 6l-6 6 6 6" />);

export const Quote = iconBase(
  "Quote",
  <path d="M9.5 6C6.5 7.4 5 9.9 5 13.2V18h6v-6H8.2c.1-1.6.9-2.9 2.4-3.7L9.5 6Zm9 0c-3 1.4-4.5 3.9-4.5 7.2V18h6v-6h-2.8c.1-1.6.9-2.9 2.4-3.7L18.5 6Z" />
);

export const ClipboardList = iconBase(
  "Clipboard list",
  <>
    <rect x="9" y="3" width="6" height="16" rx="1" />
    <path d="M6 9h12M6 13h8M6 17h6" />
  </>
);

export const LogOut = iconBase(
  "Log out",
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </>
);
