/** espeja el enum NotificationType del server: un tipo nuevo es un aviso nuevo */
export type NotificationType =
  | "MESSAGE"
  | "CARGO_ADDED"
  | "CARGO_CONFIRMED"
  | "CARGO_CANCELLED"
  | "TRIP_STATUS_CHANGED"
  | "PAYMENT_APPROVED"
  | "BALANCE_DUE";

export type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  tripId: string | null;
  read: boolean;
  /** el server la manda ISO: createdAt.toISOString() */
  createdAt: string;
};
