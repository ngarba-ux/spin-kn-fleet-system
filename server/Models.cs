// Data model for SPIN-KN Fleet. Property names are camelCase on purpose:
// JavaScriptSerializer writes them verbatim, so the JSON on disk and on the
// wire matches what the browser code expects.
using System.Collections.Generic;

namespace SpinFleet
{
    public class User
    {
        public string id { get; set; }
        public string name { get; set; }
        public string email { get; set; }
        public string role { get; set; }            // admin | spc | driver
        public string status { get; set; }          // active | inactive
        public bool mustChangePassword { get; set; }
        public string createdTs { get; set; }
        public string lastLoginTs { get; set; }
        public bool demo { get; set; }
    }

    // Kept apart from User so a user list can never leak a hash.
    public class Credential
    {
        public string userId { get; set; }
        public string salt { get; set; }
        public string hash { get; set; }
        public int iterations { get; set; }
    }

    public class Session
    {
        public string tokenHash { get; set; }
        public string userId { get; set; }
        public string createdTs { get; set; }
        public string expiresTs { get; set; }
    }

    public class Staff
    {
        public string id { get; set; }
        public string staffNo { get; set; }
        public string employeeNo { get; set; }
        public string fullName { get; set; }
        public string unitCode { get; set; }
        public string unit { get; set; }
        public string designation { get; set; }
        public string email { get; set; }
        public string phone { get; set; }
        public string qrToken { get; set; }
        public string qrStatus { get; set; }        // active | revoked
        public string status { get; set; }          // active | inactive
        public bool demo { get; set; }
    }

    public class Driver
    {
        public string id { get; set; }
        public string userId { get; set; }
        public string name { get; set; }
        public string driverNo { get; set; }
        public string phone { get; set; }
        public string licenceNo { get; set; }
        public string licenceExpiry { get; set; }   // yyyy-MM-dd
        public string contract { get; set; }        // active | expired | terminated
        public string vehicleId { get; set; }
        public bool demo { get; set; }
        // Derived on output
        public string email { get; set; }
        public string account { get; set; }
    }

    public class Vehicle
    {
        public string id { get; set; }
        public string assetId { get; set; }
        public string reg { get; set; }
        public string model { get; set; }
        public string colour { get; set; }
        public string engineNo { get; set; }
        public string chassisNo { get; set; }
        public string condition { get; set; }       // ok | maintenance | outOfService
        public double? initialOdo { get; set; }
        public double? lastServiceOdo { get; set; }
        public string lastServiceDate { get; set; }
        public double? serviceIntervalKm { get; set; }
        public string insuranceExpiry { get; set; }
        public string roadworthinessExpiry { get; set; }
        public string notes { get; set; }
        public bool demo { get; set; }
        // Derived on output
        public string status { get; set; }          // available | assigned | inTransit | maintenance | outOfService
        public string driverId { get; set; }
        public double? odometer { get; set; }
        public double? kmSinceService { get; set; }
        public string serviceState { get; set; }    // ok | soon | due
    }

    public class TaskItem
    {
        public string id { get; set; }
        public string driverId { get; set; }
        public string vehicleId { get; set; }
        public string purpose { get; set; }
        public string origin { get; set; }
        public string destination { get; set; }
        public string scheduledTs { get; set; }
        public string notes { get; set; }
        public string priority { get; set; }        // high | medium | low
        public string status { get; set; }          // scheduled | inProgress | completed | cancelled
        public bool acknowledged { get; set; }
        public string acknowledgedTs { get; set; }
        public string tripId { get; set; }
        public string requestId { get; set; }
        public string createdTs { get; set; }
        public string createdBy { get; set; }
        public bool demo { get; set; }
    }

    public class Stop
    {
        public string id { get; set; }
        public string startTs { get; set; }
        public string endTs { get; set; }
        public double? lat { get; set; }
        public double? lng { get; set; }
        public string note { get; set; }
    }

    public class Trip
    {
        public Trip() { stops = new List<Stop>(); }
        public string id { get; set; }
        public string driverId { get; set; }
        public string vehicleId { get; set; }
        public string taskId { get; set; }
        public string requestId { get; set; }
        public string status { get; set; }          // inTransit | completed
        public bool paused { get; set; }
        public string startTs { get; set; }
        public double? startLat { get; set; }
        public double? startLng { get; set; }
        public double? startOdo { get; set; }
        public string startPhotoId { get; set; }
        public string endTs { get; set; }
        public double? endLat { get; set; }
        public double? endLng { get; set; }
        public double? endOdo { get; set; }
        public string endPhotoId { get; set; }
        public string notes { get; set; }
        public string endedBy { get; set; }
        public List<Stop> stops { get; set; }
        public bool demo { get; set; }
    }

    public class FuelRecord
    {
        public string id { get; set; }
        public string driverId { get; set; }
        public string vehicleId { get; set; }
        public string ts { get; set; }
        public double litres { get; set; }
        public double cost { get; set; }
        public double? odometer { get; set; }
        public string station { get; set; }
        public string receiptId { get; set; }
        public string enteredBy { get; set; }
        public bool demo { get; set; }
    }

    public class Maintenance
    {
        public string id { get; set; }
        public string vehicleId { get; set; }
        public string ts { get; set; }
        public double? odometer { get; set; }
        public double? cost { get; set; }
        public string notes { get; set; }
        public string by { get; set; }
        public bool demo { get; set; }
    }

    public class HistoryEntry
    {
        public string ts { get; set; }
        public string actor { get; set; }
        public string action { get; set; }
        public string from { get; set; }
        public string to { get; set; }
        public string comment { get; set; }
    }

    public class Passenger
    {
        public string name { get; set; }
        public string org { get; set; }
    }

    public class TripRequest
    {
        public TripRequest() { history = new List<HistoryEntry>(); passengerList = new List<Passenger>(); }
        public string id { get; set; }
        public string @ref { get; set; }
        public string statusToken { get; set; }
        public string staffId { get; set; }
        public string purpose { get; set; }
        public string component { get; set; }
        public string destination { get; set; }
        public string departTs { get; set; }
        public string returnTs { get; set; }
        public int passengers { get; set; }
        public List<Passenger> passengerList { get; set; }
        public string vehicle { get; set; }
        public string priority { get; set; }        // normal | urgent
        public string urgentReason { get; set; }
        public string assignment { get; set; }
        public string remarks { get; set; }
        public string docId { get; set; }
        public string status { get; set; }
        public string createdTs { get; set; }
        public string updatedTs { get; set; }
        public string adminRemark { get; set; }
        public string forwardedByName { get; set; }
        public string proposedDriverId { get; set; }
        public string proposedVehicleId { get; set; }
        public string spcDecision { get; set; }
        public string dispatchDriverId { get; set; }
        public string dispatchVehicleId { get; set; }
        public string dispatchedByName { get; set; }
        public string taskId { get; set; }
        public string rescheduledFromDepart { get; set; }
        public string rescheduledFromReturn { get; set; }
        public List<HistoryEntry> history { get; set; }
        public bool demo { get; set; }
    }

    public class Notification
    {
        public string id { get; set; }
        public string requestId { get; set; }
        public string @ref { get; set; }
        public string to { get; set; }
        public string toName { get; set; }
        public string type { get; set; }
        public string subject { get; set; }
        public string body { get; set; }
        public string status { get; set; }          // queued | sent | failed | not_configured
        public string error { get; set; }
        public int attempts { get; set; }
        public string nextTryTs { get; set; }
        public string ts { get; set; }
        public string sentTs { get; set; }
    }

    public class LogEntry
    {
        public string id { get; set; }
        public string ts { get; set; }
        public string userId { get; set; }
        public string userName { get; set; }
        public string action { get; set; }
        public string detail { get; set; }
    }

    public class Upload
    {
        public string id { get; set; }
        public string name { get; set; }
        public string mime { get; set; }
        public long size { get; set; }
        public string ts { get; set; }
        public string by { get; set; }
    }

    public class Settings
    {
        public Settings()
        {
            orgName = "SPIN KN Fleet Management";
            publicBaseUrl = "";
            serviceIntervalKm = 2500;
            expiryWarnDays = 30;
            defaultOrigin = "SPIN Project Office, Kano";
            currency = "NGN";
            components = new List<string>();
            vehicleTypes = new List<string>();
        }
        public string orgName { get; set; }
        public string publicBaseUrl { get; set; }
        public double serviceIntervalKm { get; set; }
        public int expiryWarnDays { get; set; }
        public string defaultOrigin { get; set; }
        public string currency { get; set; }
        public List<string> components { get; set; }
        public List<string> vehicleTypes { get; set; }
    }

    public class Db
    {
        public Db()
        {
            users = new List<User>(); credentials = new List<Credential>(); sessions = new List<Session>();
            staff = new List<Staff>(); drivers = new List<Driver>(); vehicles = new List<Vehicle>();
            tasks = new List<TaskItem>(); trips = new List<Trip>(); fuel = new List<FuelRecord>();
            maintenance = new List<Maintenance>(); requests = new List<TripRequest>();
            notifications = new List<Notification>(); logs = new List<LogEntry>(); uploads = new List<Upload>();
            processed = new List<string>(); settings = new Settings();
        }
        public int version { get; set; }
        public string createdTs { get; set; }
        public int seq { get; set; }
        public int requestSeq { get; set; }
        public Settings settings { get; set; }
        public List<User> users { get; set; }
        public List<Credential> credentials { get; set; }
        public List<Session> sessions { get; set; }
        public List<Staff> staff { get; set; }
        public List<Driver> drivers { get; set; }
        public List<Vehicle> vehicles { get; set; }
        public List<TaskItem> tasks { get; set; }
        public List<Trip> trips { get; set; }
        public List<FuelRecord> fuel { get; set; }
        public List<Maintenance> maintenance { get; set; }
        public List<TripRequest> requests { get; set; }
        public List<Notification> notifications { get; set; }
        public List<LogEntry> logs { get; set; }
        public List<Upload> uploads { get; set; }
        public List<string> processed { get; set; }  // idempotency keys (driver sync, staff submissions)
    }

    public class SmtpConfig
    {
        public string host { get; set; }
        public int port { get; set; }
        public bool enableSsl { get; set; }
        public string user { get; set; }
        public string password { get; set; }
        public string from { get; set; }
        public string fromName { get; set; }
    }

    public class Config
    {
        public Config() { port = 3000; listenOnNetwork = true; timeZone = "W. Central Africa Standard Time"; adminSessionHours = 12; driverSessionDays = 30; smtp = new SmtpConfig(); }
        public int port { get; set; }
        public bool listenOnNetwork { get; set; }
        public string timeZone { get; set; }
        public int adminSessionHours { get; set; }
        public int driverSessionDays { get; set; }
        public SmtpConfig smtp { get; set; }
    }
}
