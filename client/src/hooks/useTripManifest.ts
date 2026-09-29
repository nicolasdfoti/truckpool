import { useMutation } from "@tanstack/react-query";
import { getToken } from "../api/client";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

function fileNameFromDisposition(disposition: string | null, fallback: string) {
  if (!disposition) return fallback;
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return match?.[1] ?? fallback;
}

async function downloadManifest(tripId: string) {
  const token = getToken();
  const res = await fetch(`${BASE_URL}/trips/${tripId}/manifest.pdf`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "no pudimos generar el manifiesto");
  }

  const blob = await res.blob();
  const fileName = fileNameFromDisposition(
    res.headers.get("Content-Disposition"),
    `manifiesto-${tripId}.pdf`
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function useDownloadManifest() {
  return useMutation({ mutationFn: downloadManifest });
}
