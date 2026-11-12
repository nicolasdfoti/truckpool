/** CANCELLED: el fletero lo canceló antes de salir; las cargas activas se cancelan */
export type TripStatus = "OPEN" | "FULL" | "IN_TRANSIT" | "COMPLETED" | "CANCELLED";
export type CargoItemStatus = "PENDING" | "CONFIRMED" | "CANCELLED";
/** CHARGED_BACK: contracargo en Mercado Pago; no se vuelve a pagar, lo resuelve un admin. */
export type PaymentStatus =
  "PENDING" | "APPROVED" | "REJECTED" | "REFUNDED" | "CHARGED_BACK";
/** DEPOSIT es la seña que reserva espacio; BALANCE, lo que falta al salir el viaje. */
export type PaymentType = "DEPOSIT" | "BALANCE";

export const TRIP_FEATURES = [
  "refrigeracion",
  "seguro",
  "carga_fragil",
  "expreso",
  "carga_y_descarga",
] as const;

export type TripFeature = (typeof TRIP_FEATURES)[number];

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  OPEN: "abierto",
  FULL: "completo",
  IN_TRANSIT: "en viaje",
  COMPLETED: "completado",
  CANCELLED: "cancelado",
};

export type Trip = {
  id: string;
  origin: string;
  destination: string;
  date: string;
  /** hora de salida "HH:mm"; null en los viajes publicados sin hora */
  departureTime: string | null;
  truckType: string;
  capacityTotal: number;
  capacityUsed: number;
  price: number;
  status: TripStatus;
  /**
   * Derivado por el backend (status OPEN + fecha posterior a hoy en Argentina):
   * si es false el viaje no acepta cargas nuevas. El status guardado no cambia
   * cuando vence la fecha, por eso el badge sigue mostrando el estado real.
   */
  acceptsCargo: boolean;
  carrierId: string;
  carrierName: string;
  features: TripFeature[];
  /** porcentaje de seña que pidió el transportista al publicar (10-50) */
  depositPercent: number;
  /** comisión de plataforma sobre cada priceShare confirmado (default 10%) */
  platformFeePercent: number;
};

export type TripInput = {
  origin: string;
  destination: string;
  date: string;
  /** "HH:mm" en 24h; obligatoria: la ventana de retiro se mide contra la salida */
  departureTime: string;
  /** punto exacto de salida (depósito/galpón); opcional */
  departureAddress?: string;
  truckType: string;
  capacityTotal: number;
  price: number;
  features: TripFeature[];
  depositPercent: number;
};

/** Un punto del recorrido del viaje, ya ordenado por el backend. */
export type RoutePointKind = "DEPARTURE" | "PICKUP" | "DESTINATION";

export type RoutePoint = {
  /** 1-based, correlativo sobre los puntos que sí tienen coordenadas */
  order: number;
  kind: RoutePointKind;
  /** texto corto para el tooltip del marker */
  label: string;
  address: string;
  lat: number;
  lng: number;
  cargoItemId: string | null;
};

export type TripRoute = {
  tripId: string;
  /** true si la partida es el departureAddress exacto y no el origin general */
  departureIsExact: boolean;
  points: RoutePoint[];
  /** algún punto quedó fuera por no tener coordenadas (geocode caído) */
  incomplete: boolean;
};

/**
 * Geometría de la ruta real siguiendo calles. Viene en formato GeoJSON
 * LineString: [lng, lat]. Null si OSRM no respondió: el mapa dibuja líneas
 * rectas en ese caso, sin molestar al usuario.
 */
export type TripRouteGeometry = { geometry: [number, number][] | null };

export type CargoItemPayment = {
  id: string;
  type: PaymentType;
  status: PaymentStatus;
  amount: number;
  /** cuánto se devolvió: null si el pago está intacto, menor a amount si fue parcial */
  refundedAmount: number | null;
  /** lo que se lleva la plataforma en este pago (split de Mercado Pago) */
  platformFeeAmount: number | null;
  /** lo que queda para el transportista en este pago */
  carrierAmount: number | null;
  /**
   * lo mismo después de lo devuelto (la comisión es solo sobre lo cobrado). null
   * sin reparto asentado o con contracargo.
   */
  netPlatformFeeAmount: number | null;
  netCarrierAmount: number | null;
};

export type CargoItem = {
  id: string;
  tripId: string;
  companyId: string;
  description: string;
  volume: number;
  priceShare: number;
  /** la seña que se paga para reservar el lugar */
  depositAmount: number;
  status: CargoItemStatus;
  createdAt: string;
  cancelledAt: string | null;
  /** lo que la plataforma se quedó de la seña al retirar la carga */
  cancellationFeeAmount: number | null;
  depositPayment: CargoItemPayment | null;
  balancePayment: CargoItemPayment | null;
  companyName: string;
  // pickups por carga
  pickupAddress: string;
  pickupLat: number | null;
  pickupLng: number | null;
  trackingCode: string;
  stopOrder: number | null;
};

/** sin la empresa que calificó (L2): la reseña no delata quién mandó carga */
export type Review = {
  id: string;
  tripId: string;
  toUserId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  toName: string;
};

export type CreateReviewInput = {
  rating: number;
  comment?: string;
};

/**
 * Quién mira el detalle, según el backend (U7):
 * - CARRIER_OWNER: el fletero del viaje, ve todo;
 * - PARTICIPANT: empresa con carga viva, ve las suyas completas y las ajenas
 *   solo con volumen y localidad del retiro (`otherCargo`);
 * - FORMER_PARTICIPANT: empresa que retiró todas sus cargas, ve las suyas;
 * - ANONYMOUS: el resto (también admin y otros fleteros), solo agregados.
 */
export type TripViewerAccess =
  "ANONYMOUS" | "PARTICIPANT" | "FORMER_PARTICIPANT" | "CARRIER_OWNER";

export type TripDetail = Trip & {
  /** cantidad de cargas vivas del viaje: el agregado que ven todos */
  cargoCount: number;
  viewerAccess: TripViewerAccess;
  /** las cargas que quien mira puede ver completas (vacío para terceros) */
  cargoItems: CargoItem[];
  /**
   * las cargas vivas de otras empresas, solo para la empresa participante:
   * volumen y localidad del retiro (null si el geocode no la resolvió)
   */
  otherCargo: { volume: number; pickupCity: string | null }[];
  /** punto exacto de salida: solo para el fletero y sus empresas con carga viva */
  departureAddress?: string | null;
  reviews: Review[];
  /** si quien mira ya calificó este viaje */
  viewerReviewed: boolean;
};

export type TripMessage = {
  id: string;
  tripId: string;
  fromUserId: string;
  toUserId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  fromName: string;
  toName: string;
};

export type MessageParticipant = {
  id: string;
  name: string;
};

export type TripMessages = {
  messages: TripMessage[];
  participants: {
    carrier: MessageParticipant;
    companies: MessageParticipant[];
  };
};

/** Un punto del tracking GPS que postea el transportista desde el navegador. */
export type TripLocationPoint = {
  id: string;
  lat: number;
  lng: number;
  recordedAt: string;
};

export type TripLocationResponse = {
  /** Última posición conocida, o null si el transportista todavía no compartió nada. */
  location: TripLocationPoint | null;
  /** Solo viene cuando se pide ?history=true: el recorrido completo. */
  track?: TripLocationPoint[];
};

/**
 * Parada (pickup) de una carga en el viaje, ya ordenada (U19). `FULL` es la
 * parada completa: para el fletero todas, para la empresa las suyas. `OTHER` es
 * la de otra empresa: solo el lugar en el orden, el volumen y la localidad del
 * retiro (`pickupCity`, null si el geocode no la resolvió).
 */
export type FullStopItem = {
  kind: "FULL";
  cargoItemId: string;
  pickupAddress: string;
  pickupLat: number | null;
  pickupLng: number | null;
  trackingCode: string;
  description: string;
  volume: number;
  status: CargoItemStatus;
  stopOrder: number;
};

export type StopItem =
  | FullStopItem
  | { kind: "OTHER"; stopOrder: number; volume: number; pickupCity: string | null };

/** Tracking público por código — info limitada sin exponer datos sensibles */
export type PublicTracking = {
  trackingCode: string;
  description: string;
  status: string;
  trip: {
    origin: string;
    destination: string;
    date: string;
    departureTime: string | null;
    status: string;
  };
  cargoStatus: string;
};

export type TripRequestStatus = "PENDING" | "ACCEPTED" | "DECLINED";

export type TripRequest = {
  id: string;
  origin: string;
  destination: string;
  desiredDate: string;
  estimatedVolume: number;
  note: string | null;
  status: TripRequestStatus;
  resultingTripId: string | null;
  createdAt: string;
  company: { id: string; name: string };
  carrier: { id: string; name: string };
};

export type CreateTripRequestInput = {
  carrierId: string;
  origin: string;
  destination: string;
  desiredDate: string;
  estimatedVolume: number;
  note?: string;
};

export type RespondTripRequestInput = {
  accept: boolean;
  tripDetails?: {
    truckType: string;
    capacityTotal: number;
    price: number;
    depositPercent?: number;
    features?: string[];
    departureTime: string;
  };
};
