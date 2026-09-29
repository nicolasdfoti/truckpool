import {
  cloneElement,
  forwardRef,
  isValidElement,
  type ComponentPropsWithoutRef,
} from "react";

type Variant = "primary" | "dark" | "outline" | "outline-light" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
};

// cada variante define su propio estado disabled: se atenúa el fondo pero
// nunca el texto, para que "un momento…" siga siendo legible (WCAG AA).
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-ink hover:bg-accent-hover disabled:bg-canvas-line disabled:text-ink-soft",
  dark: "bg-brand text-white hover:bg-brand-hover disabled:bg-canvas-line disabled:text-ink-soft",
  outline:
    "border border-line-strong text-ink hover:border-brand disabled:text-ink-muted",
  "outline-light":
    "border border-white/40 text-white hover:border-white disabled:border-white/25 disabled:text-white/75",
  ghost: "text-ink-soft hover:text-ink disabled:text-ink-muted",
  danger: "text-danger hover:text-danger/80 disabled:text-ink-muted",
};

const SIZES: Record<Size, string> = {
  sm: "px-4 py-2",
  md: "px-6 py-3",
  icon: "p-2",
};

// transiciones comunes: color + elevación sutil
const BASE_TRANSITION = "transition-colors transition-transform duration-200";
const HOVER_LIFT = "hover:-translate-y-0.5";

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      type = "button",
      className = "",
      asChild = false,
      children,
      ...props
    },
    ref
  ) => {
    const classes = `inline-flex items-center justify-center rounded-md text-sm font-medium ${BASE_TRANSITION} ${HOVER_LIFT} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong disabled:pointer-events-none disabled:hover:translate-y-0 ${VARIANTS[variant]} ${SIZES[size]} ${className}`;

    if (asChild) {
      const child = isValidElement<{ className?: string }>(children) ? children : null;
      if (child) {
        return cloneElement(child, {
          className: [child.props.className, classes].filter(Boolean).join(" "),
          ...props,
        });
      }
      // varios hijos (icono + label) no se pueden clonar: caemos al <button>
      // real de abajo, que los renderiza todos.
    }

    return (
      <button ref={ref} type={type} className={classes} {...props}>
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";

export { Button };
