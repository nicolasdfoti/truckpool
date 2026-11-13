import { useEffect } from "react";

/**
 * QW8: el título de la pestaña con un dato de la página (ej. origen → destino).
 * DocumentTitle pone el genérico de la ruta en cada navegación; este lo pisa
 * cuando el dato llega. null deja el genérico.
 */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}
