import type { ContributionAccent } from "./cosmetics";
import type { VerifiedSmsPayment } from "./sms-payment";
export type { SmsPaymentCandidate, VerifiedSmsPayment } from "./sms-payment";
export type Coordinate = { latitude: number; longitude: number };
export type Geometry = { type: "Polygon"; coordinates: number[][][] };
export type ParkingKind =
  | "surface"
  | "garage"
  | "underground"
  | "street"
  | "zone";
export type AvailabilityStatus = "spaces" | "full" | "unknown" | "mixed";
export type Provenance = {
  label: string;
  url: string;
  retrievedAt: string;
  license?: string;
};
export type Tariff = {
  firstHour: number;
  nextHour: number;
  maxStayMinutes: number | null;
  evidence: "official" | "community";
  source: Provenance;
};
export type Availability = {
  status: AvailabilityStatus;
  source: "community" | "operator" | "none";
  observedAt: string | null;
  expiresAt: string | null;
  reports: number;
  freeSpaces?: number;
};
export type PaymentSchedule = { chargingHours: string | null; freeWeekends: "both" | "sunday" | "neither" | null };
export type ParkingPlace = {
  smsPayment?: VerifiedSmsPayment;
  paymentSchedule?: PaymentSchedule;
  id: string;
  name: string;
  nameEn?: string;
  coordinate: Coordinate;
  geometry?: Geometry;
  boundaryEvidence?: "community";
  kind: ParkingKind;
  operator: string | null;
  zoneCode: string | null;
  access: "public" | "customers" | "restricted" | "unknown";
  tariff: Tariff | null;
  capacity: number | null;
  openingHours: string | null;
  verification: "official" | "osm" | "community";
  source: Provenance;
  availability?: Availability;
  communityPrice?: {
    firstHour: number;
    nextHour: number;
    observedAt: string;
    reports: number;
  };
  locationReports?: { yes: number; no: number };
  locationPrecision?: "area";
  zoneCodeEvidence?: "community" | "sign";
  signInfo?: SignInfo & { readingId: string; model: string; observedAt: string; confirmedAt?: string; sourcePlaceId?: string; sourcePlaceName?: string };
  signReadingCount?: number;
  contributionAccent?: Exclude<ContributionAccent, "default">;
};
export type SignInfo = {
  freeWeekends?: PaymentSchedule["freeWeekends"];
  isParkingSign: boolean;
  confidence: number;
  zoneCode: string | null;
  operator: string | null;
  currency: string | null;
  firstHour: number | null;
  nextHour: number | null;
  maxStayMinutes: number | null;
  chargingHours: string | null;
  paymentInstructions: string | null;
  restrictions: string | null;
  rawText: string;
};
/** A confirmed sign reading. Only the details are stored; the photo stays on the phone. */
export type SignReading = { id: string; placeId: string; createdAt: string };
export type PhotoUpload = {
  base64: string;
  mimeType: "image/jpeg" | "image/png";
};
export type Contribution = {
  requestId: string;
  name: string;
  coordinate: Coordinate;
  kind: ParkingKind;
  geometry?: Geometry;
  zoneCode: string | null;
  firstHour: number | null;
  nextHour: number | null;
  capacity?: number | null;
  freeSpaces?: number | null;
};
export type ZoneInventory = {
  code: string;
  name: string;
  operator: string;
  tariff: Tariff;
  geometryStatus: "awaiting-survey";
  source: Provenance;
};
export type Destination = { id: string; name: string; coordinate: Coordinate };
export type Proposal = {
  id: string;
  name: string;
  coordinate: Coordinate;
  kind: Exclude<ParkingKind, "zone">;
  zoneCode: string | null;
  note: string;
  votes: number;
  eligibleVotes: number;
  requiredVotes: number;
  status: "pending" | "published" | "rejected";
  createdAt: string;
};
export type Catalog = {
  trustInputs?: boolean;
  generatedAt: string;
  places: ParkingPlace[];
  zones: ZoneInventory[];
  destinations: Destination[];
  coverage: { complete: false; bounds: number[]; notes: string[] };
};
