import {
  cloneElement,
  forwardRef,
  isValidElement,
  type ComponentPropsWithoutRef,
} from "react";

type Variant =
  | "primary"
  | "dark"
  | "outline"
  | "outline-light"
  | "outline-danger"
  | "ghost"
  | "danger"
  | "danger-solid";
type Size = "sm" | "md" | "icon";

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
};

// Dirección A: `primary` es el naranja y se usa para UNA acción por pantalla, la
// próxima del usuario. Lo secundario va en `dark` (navy sólido) u `outline`
// (contorno navy); lo que saca algo, en `outline-danger`.
// Cada variante define su propio estado disabled: se atenúa el fondo pero
// nunca el texto, para que "un momento…" siga siendo legible (WCAG AA).
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent font-semibold text-accent-ink hover:bg-accent-hover disabled:bg-canvas-line disabled:text-ink-soft",
  dark: "font-medium bg-brand text-white hover:bg-brand-hover disabled:bg-canvas-line disabled:text-ink-soft",
  outline:
    "font-medium border-[1.5px] border-brand bg-white text-brand hover:bg-soft disabled:border-line disabled:text-ink-muted",
  "outline-light":
    "font-medium border-[1.5px] border-white/60 text-white hover:border-white hover:bg-white/10 disabled:border-white/25 disabled:text-white/75",
  // acciones que sacan algo (retirar carga): se leen como botón, no como label
  "outline-danger":
    "font-medium border-[1.5px] border-danger bg-white text-danger hover:bg-danger-bg disabled:border-line disabled:text-ink-muted",
  ghost: "font-medium text-ink-soft hover:text-ink disabled:text-ink-muted",
  danger: "font-medium text-danger hover:text-danger/80 disabled:text-ink-muted",
  // la acción irreversible dentro de un diálogo de confirmación
  "danger-solid":
    "font-medium bg-danger text-white hover:bg-danger/90 disabled:bg-canvas-line disabled:text-ink-soft",
};

// 40 px el chico (filas densas) y 44 px el normal: el target táctil de 03§3
const SIZES: Record<Size, string> = {
  sm: "min-h-10 px-4 py-2",
  md: "min-h-11 px-6 py-2.5",
  icon: "min-h-11 min-w-11 p-2",
};

const BASE_TRANSITION = "transition-colors duration-150";

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
    const classes = `inline-flex items-center justify-center gap-2 rounded-lg text-[15px] ${BASE_TRANSITION} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong disabled:pointer-events-none ${VARIANTS[variant]} ${SIZES[size]} ${className}`;

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
