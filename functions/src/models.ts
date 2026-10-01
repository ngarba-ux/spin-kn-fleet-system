// Firestore document shapes. Timestamps are ISO-8601 UTC strings so they sort
// as text and match the data imported from the original db.json.

export interface UserDoc {
  name: string;
  email: string;
  role: 'admin' | 'spc' | 'driver' | 'super';
  status: 'active' | 'inactive';
  mustChangePassword: boolean;
  createdTs: string;
  lastLoginTs?: string | null;
  demo?: boolean;
}

export interface StaffDoc {
  staffNo: string;
  employeeNo?: string | null;
  fullName: string;
  unitCode?: string | null;
  unit?: string | null;
  designation?: string | null;
  email?: string | null;
  phone?: string | null;
  qrStatus: 'active' | 'revoked';
  status: 'active' | 'inactive';
  demo?: boolean;
}

// staffSecrets/{staffId}
export interface StaffSecretDoc {
  qrToken: string;
}

// drivers/{uid} - the document id is the driver's Auth uid.
export interface DriverDoc {
  name: string;
  email: string;
  driverNo?: string | null;
  phone?: string | null;
  licenceNo?: string | null;
  licenceExpiry?: string | null;       // yyyy-MM-dd
  contract: 'active' | 'expired' | 'terminated';
  vehicleId?: string | null;
  demo?: boolean;
}

export interface VehicleDoc {
  assetId?: string | null;
  reg: string;
  model: string;
  colour?: string | null;
  engineNo?: string | null;
  chassisNo?: string | null;
  condition: 'ok' | 'maintenance' | 'outOfService';
  initialOdo?: number | null;
  lastServiceOdo?: number | null;
  lastServiceDate?: string | null;
  serviceIntervalKm?: number | null;
  insuranceExpiry?: string | null;
  roadworthinessExpiry?: string | null;
  notes?: string | null;
  // Maintained by functions
  lastOdo?: number | null;
  activeTripId?: string | null;
  driverId?: string | null;
  demo?: boolean;
}

export interface TaskDoc {
  driverId: string;
  vehicleId?: string | null;
  purpose: string;
  origin: string;
  destination: string;
  scheduledTs: string;
  notes?: string | null;
  priority: 'high' | 'medium' | 'low';
  status: 'scheduled' | 'inProgress' | 'completed' | 'cancelled';
  acknowledged: boolean;
  acknowledgedTs?: string | null;
  tripId?: string | null;
  requestId?: string | null;
  requester?: { name: string; phone: string; passengers: number; returnTs: string; ref: string } | null;
  createdTs: string;
  createdBy: string;
  demo?: boolean;
}

export interface Stop {
  id: string;
  startTs: string;
  endTs?: string | null;
  lat?: number | null;
  lng?: number | null;
  note?: string | null;
}

export interface TripDoc {
  driverId: string;
  vehicleId: string;
  taskId?: string | null;
  requestId?: string | null;
  status: 'inTransit' | 'completed';
  paused: boolean;
  startTs: string;
  startLat?: number | null;
  startLng?: number | null;
  startOdo?: number | null;
  startPhoto?: string | null;
  endTs?: string | null;
  endLat?: number | null;
  endLng?: number | null;
  endOdo?: number | null;
  endPhoto?: string | null;
  endedBy?: string | null;
  notes?: string | null;
  stops: Stop[];
  demo?: boolean;
}

export interface FuelDoc {
  driverId?: string | null;
  vehicleId: string;
  ts: string;
  litres: number;
  cost: number;
  odometer?: number | null;
  station?: string | null;
  receipt?: string | null;
  enteredBy: string;
  demo?: boolean;
}

export interface MaintenanceDoc {
  vehicleId: string;
  ts: string;
  odometer?: number | null;
  cost?: number | null;
  notes?: string | null;
  by: string;
  demo?: boolean;
}

export type RequestStatus =
  | 'SUBMITTED' | 'ACKNOWLEDGED' | 'UNDER_ADMIN_REVIEW' | 'RETURNED_FOR_CORRECTION' | 'FORWARDED_TO_SPC'
  | 'APPROVED' | 'REJECTED' | 'DRIVER_ASSIGNED' | 'TRIP_COMPLETED' | 'CLOSED' | 'CANCELLED';

export interface HistoryEntry {
  ts: string;
  actor: string;
  action: string;
  from: string;
  to: string;
  comment: string;
}

export interface Passenger {
  name: string;
  org: string;
}

export interface RequestDoc {
  ref: string;
  statusToken: string;
  staffId: string;
  staff: { fullName: string; designation: string; unit: string; email: string; phone: string };
  purpose: string;
  component: string;
  destination: string;
  departTs: string;
  returnTs: string;
  passengers: number;
  passengerList: Passenger[];
  vehicle: string;
  priority: 'normal' | 'urgent';
  urgentReason: string;
  assignment: string;
  remarks: string;
  doc?: string | null;
  status: RequestStatus;
  createdTs: string;
  updatedTs: string;
  history: HistoryEntry[];
  adminRemark?: string;
  proposedDriverId?: string | null;
  proposedVehicleId?: string | null;
  dispatchDriverId?: string | null;
  dispatchVehicleId?: string | null;
  taskId?: string | null;
  forwardedByName?: string | null;
  forwardedByUid?: string | null;
  dispatchedByName?: string | null;
  spcDecision?: string | null;
  rescheduledFromDepart?: string | null;
  rescheduledFromReturn?: string | null;
  demo?: boolean;
}

export interface DriverActionDoc {
  driverId: string;
  type: 'trip.start' | 'trip.stop' | 'trip.resume' | 'trip.end' | 'fuel.add' | 'task.ack';
  ts: string;
  seq: number;
  payload: Record<string, unknown>;
  state: 'pending' | 'applied' | 'rejected';
  error?: string | null;
  appliedTs?: string | null;
}
