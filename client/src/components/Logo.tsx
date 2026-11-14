import { Link } from "react-router-dom";
import { Truck } from "./icons";

type LogoProps = {
  light?: boolean;
};

/** la marca en un solo color: navy sobre blanco, blanco sobre navy */
export function Logo({ light = false }: LogoProps) {
  const color = light ? "text-white" : "text-brand";
  return (
    <Link
      to="/"
      className={`flex items-center gap-2 ${color}`}
      aria-label="TruckPool - Inicio"
    >
      <Truck aria-hidden className="h-7 w-7" />
      <span className="font-display text-xl font-semibold tracking-tight">TruckPool</span>
    </Link>
  );
}
