// Document shapes as the browser sees them (see functions/src/models.ts).

export interface HistoryEntry { ts: string; actor: string; action: string; from: string; to: string; comment: string }

export interface TripRequest {
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
  passengerList: { name: string; org: string }[];
  vehicle: string;
  priority: 'normal' | 'urgent';
  urgentReason: string;
  assignment: string;
  remarks: string;
  doc?: string | null;
  status: string;
  createdTs: string;
  updatedTs: string;
  history: HistoryEntry[];
  adminRemark?: string;
  proposedDriverId?: string | null;
  forwardedByUid?: string | null;
  forwardedByName?: string | null;
  dispatchDriverId?: string | null;
  dispatchVehicleId?: string | null;
}

export interface Driver {
  name: string;
  email: string;
  driverNo?: string | null;
  phone?: string | null;
  licenceNo?: string | null;
  licenceExpiry?: string | null;
  contract: 'active' | 'expired' | 'terminated';
  vehicleId?: string | null;
}

export interface Vehicle {
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
  lastOdo?: number | null;
  activeTripId?: string | null;
  driverId?: string | null;
  insuranceExpiry?: string | null;
  roadworthinessExpiry?: string | null;
  notes?: string | null;
}

export interface UserAccount {
  name: string;
  email: string;
  role: 'admin' | 'spc' | 'driver' | 'super';
  status: 'active' | 'inactive';
  mustChangePassword: boolean;
  createdTs: string;
  lastLoginTs?: string | null;
}

export interface Staff {
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
}

export interface Settings {
  orgName: string;
  publicBaseUrl: string;
  serviceIntervalKm: number;
  expiryWarnDays: number;
  defaultOrigin: string;
  components: string[];
  vehicleTypes: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  orgName: 'SPIN Kano - Logistics & Transport Office',
  publicBaseUrl: '',
  serviceIntervalKm: 5000,
  expiryWarnDays: 30,
  defaultOrigin: 'SPIN Project Office, Kano',
  components: ['Dam & Power Infrastructure', 'Irrigation & Drainage', 'Agricultural Services & Livelihoods', 'Institutional Strengthening & Project Management'],
  vehicleTypes: ['Toyota Hilux', 'Long Nose Bus (14 Seater)', 'Any available vehicle'],
};

export interface Task {
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
  tripId?: string | null;
  requestId?: string | null;
  requester?: { name: string; phone: string; passengers: number; returnTs: string; ref: string } | null;
}

export interface Stop { id: string; startTs: string; endTs?: string | null; note?: string | null; lat?: number | null; lng?: number | null }

export interface Trip {
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
}

export interface Fuel {
  driverId?: string | null;
  vehicleId: string;
  ts: string;
  litres: number;
  cost: number;
  odometer?: number | null;
  station?: string | null;
  receipt?: string | null;
  enteredBy: string;
}

export interface Maintenance {
  vehicleId: string;
  ts: string;
  odometer?: number | null;
  cost?: number | null;
  notes?: string | null;
  by: string;
}
