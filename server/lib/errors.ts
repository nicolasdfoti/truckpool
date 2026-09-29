export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class TripNotFoundError extends AppError {
  constructor() {
    super("viaje no encontrado", 404, "TRIP_NOT_FOUND");
  }
}

export class NotEnoughCapacityError extends AppError {
  constructor() {
    super("no queda espacio suficiente en este viaje", 409, "NOT_ENOUGH_CAPACITY");
  }
}

export class TripNotOpenError extends AppError {
  constructor() {
    super("este viaje ya no está abierto para sumar carga", 409, "TRIP_NOT_OPEN");
  }
}

export class InvalidTransitionError extends AppError {
  constructor() {
    super(
      "no se puede cambiar a ese estado desde el estado actual",
      409,
      "INVALID_STATUS_TRANSITION"
    );
  }
}

export class CargoItemNotFoundError extends AppError {
  constructor() {
    super("carga no encontrada en este viaje", 404, "CARGO_ITEM_NOT_FOUND");
  }
}

export class CargoItemNotCancellableError extends AppError {
  constructor(status: "CONFIRMED" | "CANCELLED") {
    super(
      status === "CONFIRMED"
        ? "esta carga ya está confirmada, no se puede retirar"
        : "esta carga ya la habías retirado",
      409,
      status === "CONFIRMED" ? "CARGO_ITEM_CONFIRMED" : "CARGO_ITEM_CANCELLED"
    );
  }
}

export class TripAlreadyStartedError extends AppError {
  constructor() {
    super(
      "no se puede retirar carga de un viaje que ya arrancó o terminó",
      409,
      "TRIP_ALREADY_STARTED"
    );
  }
}

export class TripNotCompletedError extends AppError {
  constructor() {
    super("solo se puede calificar un viaje completado", 409, "TRIP_NOT_COMPLETED");
  }
}

export class AlreadyReviewedError extends AppError {
  constructor() {
    super("ya calificaste a esta persona en este viaje", 409, "ALREADY_REVIEWED");
  }
}

export class ReviewTargetRequiredError extends AppError {
  constructor() {
    super(
      "indicá a quién querés calificar: el viaje tiene varias empresas con carga",
      400,
      "REVIEW_TARGET_REQUIRED"
    );
  }
}

export class AlreadyVerifiedError extends AppError {
  constructor() {
    super(
      "tu identidad ya está verificada, no hace falta solicitarla de nuevo",
      409,
      "ALREADY_VERIFIED"
    );
  }
}

export class CarrierNotVerifiedError extends AppError {
  constructor() {
    super(
      "necesitás tener tu identidad verificada para publicar viajes",
      403,
      "CARRIER_NOT_VERIFIED"
    );
  }
}

export class VerificationNotPendingError extends AppError {
  constructor() {
    super(
      "esta verificación no está pendiente de revisión",
      409,
      "VERIFICATION_NOT_PENDING"
    );
  }
}

export class VerificationNoteRequiredError extends AppError {
  constructor() {
    super(
      "si rechazás la verificación, contale al transportista por qué",
      400,
      "VERIFICATION_NOTE_REQUIRED"
    );
  }
}

export class CarrierNotFoundError extends AppError {
  constructor() {
    super("transportista no encontrado", 404, "CARRIER_NOT_FOUND");
  }
}

export class TripNotInTransitError extends AppError {
  constructor() {
    super(
      "solo se puede compartir la ubicación mientras el viaje está en tránsito",
      403,
      "TRIP_NOT_IN_TRANSIT"
    );
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
  }
}

export class PaymentRequiredError extends AppError {
  constructor() {
    // se dice "seña" y no "pago" porque es lo que la empresa ve en pantalla: la
    // seña es lo único que bloquea confirmar (el saldo se cobra al salir).
    super(
      "no podés confirmar la carga hasta que la seña esté pagada",
      409,
      "PAYMENT_REQUIRED"
    );
  }
}

export class PaymentNotFoundError extends AppError {
  constructor() {
    super("pago no encontrado", 404, "PAYMENT_NOT_FOUND");
  }
}

export class BalancePendingError extends AppError {
  constructor(pending: number) {
    super(
      pending === 1
        ? "falta pagar el saldo de 1 carga antes de completar el viaje"
        : `faltan pagar los saldos de ${pending} cargas antes de completar el viaje`,
      409,
      "BALANCE_PENDING"
    );
  }
}

export class NothingToPayError extends AppError {
  constructor() {
    super("ese pago ya está abonado", 409, "PAYMENT_ALREADY_SETTLED");
  }
}

export class BalanceNotDueError extends AppError {
  constructor() {
    super(
      "el saldo se cobra cuando el viaje está en camino y la carga confirmada",
      409,
      "BALANCE_NOT_DUE"
    );
  }
}
