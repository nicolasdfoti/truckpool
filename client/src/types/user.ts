import type { Trip } from "./trip";
import type { CargoItemPayment, CargoItemStatus } from "./trip";

export type UserRole = "COMPANY" | "CARRIER" | "ADMIN";

export type VerificationStatus = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";

export type ProfileUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  bio: string | null;
  phone: string | null;
  taxId: string | null;
  verificationStatus: VerificationStatus;
  verificationNote: string | null;
  emailNotifications: boolean;
  isAvailableNow: boolean;
  // el backend solo expone si hay cuenta conectada: ni el id ni el token
  mpConnected: boolean;
};

export type ProfileInput = {
  name?: string;
  bio?: string;
  phone?: string;
  emailNotifications?: boolean;
  isAvailableNow?: boolean;
};

export type CarrierReview = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  fromName: string;
  trip: { id: string; origin: string; destination: string };
};

export type CarrierSummary = {
  id: string;
  name: string;
  bio: string | null;
  openTrips: number;
  ratingAvg: number | null;
  ratingCount: number;
  isAvailableNow: boolean;
};

export type CarrierProfile = {
  id: string;
  name: string;
  bio: string | null;
  phone: string | null;
  trips: Trip[];
  ratingAvg: number | null;
  ratingCount: number;
  reviews: CarrierReview[];
  isAvailableNow: boolean;
};

export type MyCargoItem = {
  id: string;
  tripId: string;
  companyId: string;
  description: string;
  volume: number;
  priceShare: number;
  depositAmount: number;
  status: CargoItemStatus;
  createdAt: string;
  cancelledAt: string | null;
  cancellationFeeAmount: number | null;
  depositPayment: CargoItemPayment | null;
  balancePayment: CargoItemPayment | null;
  trip: {
    id: string;
    origin: string;
    destination: string;
    date: string;
    status: string;
  };
};

export type VerificationRequest = {
  id: string;
  name: string;
  email: string;
  taxId: string | null;
  requestedAt: string;
};

export type VerificationDecision = {
  approve: boolean;
  note?: string;
};
