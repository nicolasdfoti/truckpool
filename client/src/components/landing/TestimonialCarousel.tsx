import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../Button";
import { ChevronLeft, Quote, Star, StarFilled } from "../icons";
import { TESTIMONIALS, TESTIMONIALS_ARE_DEMO } from "./testimonials";

/**
 * Carrusel de testimonios.
 *
 * Implementado con scroll-snap nativo en vez de con una libreria: el
 * `scroll-snap` da el ajuste por slide y el inercia de touch en el movil sin
 * JS, y nosotros solo temos que sincronizar los controles con la posicion.
 * La unica logica es leer `scrollLeft` y moverlo, que es exactamente lo que
 * haria cualquier libreria por debajo.
 *
 * Decisiones de accesibilidad que conviene no perder al tocarlo:
 * - Sin autoplay. Un carrusel que avanza solo obliga a ofrecer un control de
 *   pausa (WCAG 2.2.2) y compite con la preferencia de movimiento reducido.
 *   El usuario avanza a voluntad con flechas, botones o puntos.
 * - `tabIndex` en el track: el contenedor scrolleable tiene que ser
 *   enfocable, y con el foco ahi las flechas del teclado ya scrollean.
 * - El texto de posicion va en una region `aria-live` separada de las cards,
 *   para que el lector de pantalla anuncie el rango y no lea la tarjeta entera.
 * - `motion-safe:scroll-smooth` y `behavior: "auto"` cuando el sistema pide
 *   movimiento reducido.
 *
 * ── Por que los controles navigated por pagina y no por slide ──────────────
 * Con N slides y P visibles por pantalla, los ultimos (N mod P) slides no se
 * pueden alinear al borde inicial: no queda scroll suficiente. Con 6 slides y 3
 * por pantalla, el 5 y el 6 nunca llegan a ser "el slide activo", y un dot por
 * slide miente sobre donde estas. Por eso los controles avanzan de a una
 * pagina, que si es siempre alcanzable y hace que el indicador sea cierto. El
 * `scroll-snap` nativo se mantiene igual, para que el swipe en mobile sea el
 * del navegador.
 *
 * ── Por que la section lleva overflow-x-clip ──────────────────────────────
 * Un `display:flex` con `overflow-x:auto` filtra el ancho de su contenido al
 * documento: el scroll horizontal se escapa a la pagina aunque el track
 * declare `overflow`. Se midio (doc 2132px con ventana de 1280px) y
 * `overflow-x` en el propio track no lo arregla, hay que recortar en un
 * ancestro. `clip` y no `hidden` porque no crea un contenedor de scroll nuevo
 * ni obliga a crear uno vertical.
 * ───────────────────────────────────────────────────────────────────────────
 */

const AUDIENCE_STYLES = {
  EMPRESA: "bg-canvas text-ink-soft",
  TRANSPORTISTA: "bg-surface text-accent-text",
} as const;

function initials(author: string) {
  const words = author.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

function Stars({ rating }: { rating: number }) {
  return (
    <>
      <span className="flex gap-0.5 text-accent" aria-hidden>
        {[1, 2, 3, 4, 5].map((n) =>
          n <= rating ? <StarFilled key={n} size={16} /> : <Star key={n} size={16} />
        )}
      </span>
      <span className="sr-only">{rating} de 5 estrellas</span>
    </>
  );
}

export function TestimonialCarousel() {
  const trackRef = useRef<HTMLUListElement>(null);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [pageSize, setPageSize] = useState(1);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [firstFull, setFirstFull] = useState(0);
  const [lastFull, setLastFull] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

  const total = TESTIMONIALS.length;

  /**
   * Sincroniza el estado con la posicion real del track.
   *
   * `pageSize` (cuantos slides entran por pantalla) sale de la formula de
   * capacidad sobre la geometria, no de contar slides visibles: si se contaran,
   * al scrollear cambiaria y los dots bailarian.
   *
   * La ventana que se anuncia si se mide sobre los slides *completamente*
   * visibles, con las dos condiciones (izquierda y derecha dentro del track).
   * Con una sola, los slides ya salidos por la izquierda cuentan como visibles.
   * El peek de la tarjeta siguiente se ignora a proposito: no se anuncia "1 a 2"
   * cuando en realidad estas leyendo el testimonio 1.
   */
  const syncFromScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const slides = Array.from(el.children) as HTMLElement[];
    if (slides.length === 0) return;

    const slideWidth = slides[0].getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const capacity = Math.max(1, Math.floor((el.clientWidth + gap) / (slideWidth + gap)));
    const count = Math.ceil(slides.length / capacity);

    const track = el.getBoundingClientRect();
    const tol = 2;
    let first = 0;
    let last = 0;
    let found = false;
    slides.forEach((slide, i) => {
      const r = slide.getBoundingClientRect();
      if (r.left >= track.left - tol && r.right <= track.right + tol) {
        if (!found) {
          first = i;
          found = true;
        }
        last = i;
      }
    });

    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    setPageSize(capacity);
    setPageCount(count);
    setPage(Math.max(0, Math.min(count - 1, Math.floor(first / capacity))));
    setFirstFull(first + 1);
    setLastFull(last + 1);
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft >= max - 1);
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncFromScroll);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    syncFromScroll();
    // al cambiar de breakpoint cambia cuantos slides entran por pantalla y
    // scrollLeft queda en una posicion que ya no corresponde a ninguna pagina
    const observer = new ResizeObserver(syncFromScroll);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [syncFromScroll]);

  /**
   * Mueve el track con scrollTo horizontal explicito. No usamos scrollIntoView
   * porque tambien puede ajustar el scroll vertical de la pagina.
   */
  const goToPage = useCallback(
    (target: number) => {
      const el = trackRef.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(pageCount - 1, target));
      const slides = Array.from(el.children) as HTMLElement[];
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      const pitch = slides[0].getBoundingClientRect().width + gap;
      const max = Math.max(0, el.scrollWidth - el.clientWidth);
      el.scrollTo({
        left: Math.min(clamped * pageSize * pitch, max),
        behavior: reducedMotion ? "auto" : "smooth",
      });
    },
    [pageCount, pageSize, reducedMotion]
  );

  return (
    <section
      aria-labelledby="testimonios-titulo"
      className="overflow-x-clip border-t border-line bg-white py-16"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2
            id="testimonios-titulo"
            className="font-display text-3xl font-semibold text-ink"
          >
            TESTIMONIOS
          </h2>
          <div className="mx-auto mt-2 h-1 w-24 rounded bg-accent" />
        </div>

        <div
          role="region"
          aria-roledescription="carrusel"
          aria-label="Testimonios de empresas y transportistas"
          className="relative"
        >
          <ul
            ref={trackRef}
            id="carrusel-testimonios"
            tabIndex={0}
            aria-label="Testimonios, desplazable horizontalmente"
            className="motion-safe:scroll-smooth flex snap-x snap-mandatory gap-6 overflow-x-auto scroll-px-4 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {TESTIMONIALS.map((t) => (
              <li
                key={t.id}
                className="flex w-[85%] shrink-0 snap-start flex-col rounded-[10px] border border-line bg-white p-8 shadow-lg sm:w-[46%] lg:w-[calc(33.333%-1rem)]"
              >
                <div className="mb-4 flex items-center justify-between">
                  <Stars rating={t.rating} />
                  <Quote className="h-8 w-8 shrink-0 text-canvas-line" />
                </div>

                <p className="mb-6 flex-grow text-sm leading-relaxed text-ink">
                  “{t.quote}”
                </p>

                <p className="mb-6 border-l-2 border-accent pl-3 text-xs text-ink-muted">
                  {t.detail}
                </p>

                <div className="flex items-center gap-3 border-t border-line pt-5">
                  <span
                    aria-hidden
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white"
                  >
                    {initials(t.author)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{t.author}</p>
                    <p className="truncate text-xs text-ink-muted">
                      {t.role} · {t.company}
                    </p>
                  </div>
                  <span
                    className={`ml-auto shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${AUDIENCE_STYLES[t.audience]}`}
                  >
                    {t.audience}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4 flex items-center justify-center gap-6">
          <Button
            variant="outline"
            size="icon"
            onClick={() => goToPage(page - 1)}
            disabled={atStart}
            aria-label="Testimonios anteriores"
            aria-controls="carrusel-testimonios"
          >
            <ChevronLeft size={20} />
          </Button>

          <ul className="flex items-center gap-2">
            {Array.from({ length: pageCount }, (_, p) => {
              const from = p * pageSize + 1;
              const to = Math.min(total, (p + 1) * pageSize);
              return (
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => goToPage(p)}
                    aria-label={`Ver testimonios ${from} a ${to} de ${total}`}
                    aria-current={p === page ? "true" : undefined}
                    className={`h-2.5 w-2.5 rounded-full transition-colors ${
                      p === page ? "bg-brand" : "bg-canvas-line hover:bg-brand-light"
                    }`}
                  />
                </li>
              );
            })}
          </ul>

          <Button
            variant="outline"
            size="icon"
            onClick={() => goToPage(page + 1)}
            disabled={atEnd}
            aria-label="Testimonios siguientes"
            aria-controls="carrusel-testimonios"
          >
            <ChevronLeft size={20} className="rotate-180" />
          </Button>
        </div>

        <p aria-live="polite" className="sr-only">
          {firstFull === lastFull
            ? `Testimonio ${firstFull} de ${total}`
            : `Testimonios ${firstFull} a ${lastFull} de ${total}`}
        </p>

        {TESTIMONIALS_ARE_DEMO && (
          <p className="mt-8 text-center text-xs text-ink-muted">
            Testimonios de demostración: nombres, empresas y rutas son ficticios y solo
            muestran el formato definitivo. Serán reemplazados por reseñas verificadas.
          </p>
        )}
      </div>
    </section>
  );
}
