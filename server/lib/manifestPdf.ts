import PDFDocument from "pdfkit";

/**
 * Remito / manifiesto del viaje en PDF.
 *
 * Estética de manifiesto: header azul con el tramo y el código del viaje,
 * línea punteada y lista de cargas. Tipografía Helvetica (estándar del
 * sistema): legible antes que pixel-perfect con el sitio.
 */

const BRAND_BLUE = "#0C447C";
const INK = "#1a2733";
const INK_SOFT = "#4b5563";
const INK_MUTED = "#8a94a0";
/** Helvetica usa WinAnsi: la flecha "→" no existe en ese charset. */
const ARROW = "->";
const LINE = "#d9dee3";
const CANVAS = "#eaf1f7";

const MARGIN = 48;
const PAGE_WIDTH = 595.28; // A4
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export type ManifestTrip = {
  id: string;
  origin: string;
  destination: string;
  date: Date;
  // hora de salida "HH:mm"; null si el fletero no la prometió
  departureTime: string | null;
  truckType: string;
  capacityTotal: number;
  price: number;
  status: "OPEN" | "FULL" | "IN_TRANSIT" | "COMPLETED";
  carrierName: string;
  cargoItems: {
    description: string;
    volume: number;
    priceShare: number;
    companyName: string;
  }[];
};

const STATUS_LABELS: Record<ManifestTrip["status"], string> = {
  OPEN: "abierto",
  FULL: "completo",
  IN_TRANSIT: "en viaje",
  COMPLETED: "completado",
};

/** código corto y estable derivado del id del viaje: TP-A1B2C3 */
export function tripCode(tripId: string): string {
  const clean = tripId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `TP-${clean.slice(0, 6).padStart(4, "X")}`;
}

export function manifestFileName(trip: ManifestTrip): string {
  return `${tripCode(trip.id)}-${trip.origin}-${trip.destination}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .toLowerCase();
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatVolume(value: number): string {
  return `${value.toLocaleString("es-AR", { maximumFractionDigits: 2 })} m³`;
}

function formatMoney(value: number): string {
  return value
    .toLocaleString("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    })
    .replace(/\s/g, "");
}

function dashedLine(doc: PDFKit.PDFDocument, y: number) {
  doc
    .save()
    .lineWidth(1)
    .strokeColor(LINE)
    .dash(2, { space: 2 })
    .moveTo(MARGIN, y)
    .lineTo(PAGE_WIDTH - MARGIN, y)
    .stroke()
    .undash()
    .restore();
}

function label(doc: PDFKit.PDFDocument, text: string, x: number, y: number) {
  doc.font("Helvetica").fontSize(8).fillColor(INK_MUTED).text(text.toUpperCase(), x, y);
}

function value(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number
) {
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(INK)
    .text(text, x, y, { width, ellipsis: true });
}

export function renderManifestPdf(trip: ManifestTrip): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: MARGIN,
      info: {
        Title: `Remito ${tripCode(trip.id)}`,
        Author: "truckpool",
        Subject: `Manifiesto ${trip.origin} ${ARROW} ${trip.destination}`,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const used = trip.cargoItems.reduce((sum, item) => sum + item.volume, 0);

    // --- header azul -------------------------------------------------------
    const headerHeight = 96;
    doc.rect(0, 0, PAGE_WIDTH, headerHeight).fill(BRAND_BLUE);
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#ffffff")
      .text("truckpool", MARGIN, 26, { characterSpacing: 1 });
    doc
      .font("Helvetica-Bold")
      .fontSize(20)
      .text(`${trip.origin} ${ARROW} ${trip.destination}`, MARGIN, 44, {
        width: CONTENT_WIDTH - 130,
      });
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#dbe7f5")
      .text(`remito · ${STATUS_LABELS[trip.status]}`, MARGIN, 70);
    doc
      .font("Helvetica-Bold")
      .fontSize(18)
      .fillColor("#ffffff")
      .text(tripCode(trip.id), PAGE_WIDTH - MARGIN - 130, 44, {
        width: 130,
        align: "right",
      });

    // --- datos del viaje ---------------------------------------------------
    let y = headerHeight + 28;
    const colWidth = (CONTENT_WIDTH - 24) / 3;
    const colX = [MARGIN, MARGIN + colWidth + 12, MARGIN + (colWidth + 12) * 2] as const;

    label(doc, "fecha", colX[0], y);
    // la hora de salida va con la fecha: es lo que el transportista promete
    value(
      doc,
      trip.departureTime
        ? `${formatDate(trip.date)} · ${trip.departureTime}`
        : formatDate(trip.date),
      colX[0],
      y + 12,
      colWidth
    );
    label(doc, "tipo de camión", colX[1], y);
    value(doc, trip.truckType, colX[1], y + 12, colWidth);
    label(doc, "transportista", colX[2], y);
    value(doc, trip.carrierName, colX[2], y + 12, colWidth);

    y += 44;
    dashedLine(doc, y);
    y += 20;

    // --- capacidades -------------------------------------------------------
    label(doc, "capacidad", MARGIN, y);
    doc
      .font("Helvetica-Bold")
      .fontSize(13)
      .fillColor(INK)
      .text(
        `${formatVolume(used)} de ${formatVolume(trip.capacityTotal)} ocupados`,
        MARGIN,
        y + 12
      );
    const percent =
      trip.capacityTotal > 0 ? Math.round((used / trip.capacityTotal) * 100) : 0;
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(INK_SOFT)
      .text(
        `${percent}% del espacio · precio de referencia ${formatMoney(trip.price)}`,
        MARGIN,
        y + 30
      );

    // barra de ocupación
    const barY = y + 48;
    const barHeight = 8;
    doc.roundedRect(MARGIN, barY, CONTENT_WIDTH, barHeight, 4).fill(CANVAS);
    if (used > 0 && trip.capacityTotal > 0) {
      const filled = Math.max(
        4,
        (Math.min(used, trip.capacityTotal) / trip.capacityTotal) * CONTENT_WIDTH
      );
      doc.roundedRect(MARGIN, barY, filled, barHeight, 4).fill(BRAND_BLUE);
    }
    y = barY + 26;

    // --- tabla de cargas ---------------------------------------------------
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("cargas", MARGIN, y);
    y += 20;

    const columns = [
      { title: "descripción", width: 190, align: "left" as const },
      { title: "volumen", width: 80, align: "right" as const },
      { title: "empresa", width: 140, align: "left" as const },
      { title: "parte", width: 82, align: "right" as const },
    ];
    let x = MARGIN;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(INK_MUTED);
    for (const column of columns) {
      doc.text(column.title.toUpperCase(), x, y, {
        width: column.width,
        align: column.align,
      });
      x += column.width;
    }
    y += 14;
    dashedLine(doc, y);
    y += 12;

    if (trip.cargoItems.length === 0) {
      doc
        .font("Helvetica-Oblique")
        .fontSize(9)
        .fillColor(INK_MUTED)
        .text("este viaje no tiene cargas cargadas.", MARGIN, y);
      y += 20;
    }

    for (const item of trip.cargoItems) {
      const cells = [
        item.description,
        formatVolume(item.volume),
        item.companyName || "—",
        formatMoney(item.priceShare),
      ];
      x = MARGIN;
      doc.font("Helvetica").fontSize(9.5).fillColor(INK);
      cells.forEach((cell, index) => {
        const column = columns[index];
        if (!column) return;
        doc.text(cell, x, y, {
          width: column.width,
          align: column.align,
          ellipsis: true,
          lineBreak: false,
        });
        x += column.width;
      });
      y += 8;
      dashedLine(doc, y);
      y += 12;
    }

    // --- totales -----------------------------------------------------------
    const totalShare = trip.cargoItems.reduce((sum, item) => sum + item.priceShare, 0);
    y += 4;
    dashedLine(doc, y);
    y += 14;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK);
    doc.text("total", MARGIN, y, { width: CONTENT_WIDTH - 120, align: "right" });
    doc.text(formatMoney(totalShare), MARGIN, y, {
      width: CONTENT_WIDTH,
      align: "right",
    });
    y += 18;
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(INK_SOFT)
      .text(`${formatVolume(used)} de ${formatVolume(trip.capacityTotal)}`, MARGIN, y, {
        width: CONTENT_WIDTH - 120,
        align: "right",
      });
    doc.text(
      `${trip.cargoItems.length} ${trip.cargoItems.length === 1 ? "carga" : "cargas"}`,
      MARGIN,
      y,
      { width: CONTENT_WIDTH, align: "right" }
    );

    // --- pie ---------------------------------------------------------------
    const generatedAt = new Date().toLocaleString("es-AR");
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(INK_MUTED)
      .text(
        `generado por truckpool el ${generatedAt} · documento de manifiesto, no válido como comprobante fiscal`,
        MARGIN,
        doc.page.height - 62,
        { width: CONTENT_WIDTH, align: "center" }
      );

    doc.end();
  });
}
