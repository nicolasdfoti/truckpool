import { Link } from "react-router-dom";
import { Truck } from "./icons";

type LogoProps = {
  light?: boolean;
};

export function Logo({ light = false }: LogoProps) {
  return (
    <Link to="/" className="flex items-center" aria-label="TruckPool - Inicio">
      <Truck
        aria-hidden
        className={light ? "mr-2 h-7 w-7 text-brand-light" : "mr-2 h-8 w-8 text-brand"}
      />
      <span
        className={`font-display font-semibold tracking-tight ${
          light ? "text-xl text-white" : "text-2xl text-ink"
        }`}
      >
        Truck
        <span className={light ? "text-brand-light" : "text-brand"}>Pool</span>
      </span>
    </Link>
  );
}
