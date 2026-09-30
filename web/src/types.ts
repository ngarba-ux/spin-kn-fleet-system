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
  dispatchDriverId?: string | null;
  dispatchVehicleId?: string | null;
}

export interface Driver {
  name: string;
  email: string;
  driverNo?: string | null;
  phone?: string | null;
  licenceExpiry?: string | null;
  contract: string;
  vehicleId?: string | null;
}

export interface Vehicle {
  reg: string;
  model: string;
  colour?: string | null;
  condition: 'ok' | 'maintenance' | 'outOfService';
  lastOdo?: number | null;
  activeTripId?: string | null;
  driverId?: string | null;
  insuranceExpiry?: string | null;
  roadworthinessExpiry?: string | null;
}

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

export interface Stop { id: string; startTs: string; endTs?: string | null; note?: string | null }

export interface Trip {
  driverId: string;
  vehicleId: string;
  taskId?: string | null;
  status: 'inTransit' | 'completed';
  paused: boolean;
  startTs: string;
  startOdo?: number | null;
  endTs?: string | null;
  endOdo?: number | null;
  stops: Stop[];
}
