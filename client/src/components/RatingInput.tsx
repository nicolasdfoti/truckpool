import { Star, StarFilled } from "./icons";

type RatingInputProps = {
  value: number;
  onChange: (rating: number) => void;
  max?: number;
  disabled?: boolean;
  label?: string;
};

export function RatingInput({
  value,
  onChange,
  max = 5,
  disabled = false,
  label = "calificación",
}: RatingInputProps) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1">
      {Array.from({ length: max }, (_, index) => index + 1).map((star) => {
        const active = star <= value;
        const Icon = active ? StarFilled : Star;
        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={star === value}
            aria-label={`${star} de ${max}`}
            disabled={disabled}
            onClick={() => onChange(star)}
            className={`rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong disabled:pointer-events-none ${
              active ? "text-accent-strong" : "text-ink-muted hover:text-accent-strong"
            }`}
          >
            <Icon className="h-7 w-7" size={28} />
          </button>
        );
      })}
    </div>
  );
}

type RatingStarsProps = {
  value: number;
  size?: number;
  className?: string;
};

export function RatingStars({ value, size = 16, className = "" }: RatingStarsProps) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} aria-hidden>
      {Array.from({ length: 5 }, (_, index) => index + 1).map((star) => {
        const Icon = star <= Math.round(value) ? StarFilled : Star;
        return (
          <Icon
            key={star}
            size={size}
            className={
              star <= Math.round(value) ? "text-accent-strong" : "text-ink-muted"
            }
          />
        );
      })}
    </span>
  );
}
