import { inflateSync } from "node:zlib";

/**
 * Texto visible de un PDF generado con pdfkit, para que los tests puedan
 * buscar qué datos trae. pdfkit comprime cada content stream con FlateDecode
 * y escribe el texto de las fuentes estándar como strings hex dentro de
 * operadores TJ (`[<486f6c61> 20 <...>] TJ`): se descomprime cada stream, se
 * decodifica cada TJ y se devuelve una línea por TJ.
 */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const lines: string[] = [];
  const streamRe = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end === -1) break;
    let content: string;
    try {
      content = inflateSync(pdf.subarray(start, end)).toString("latin1");
    } catch {
      // stream sin comprimir o binario que no es texto (no hay imágenes acá)
      content = raw.slice(start, end);
    }
    for (const tj of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      const hex = [...(tj[1] ?? "").matchAll(/<([0-9a-fA-F]*)>/g)]
        .map((h) => h[1])
        .join("");
      lines.push(Buffer.from(hex, "hex").toString("latin1"));
    }
    streamRe.lastIndex = end;
  }
  return lines.join("\n");
}
