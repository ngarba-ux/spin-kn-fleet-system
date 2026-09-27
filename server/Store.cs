using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

namespace SpinFleet
{
    // Owns the in-memory database and its JSON file. Every access happens under
    // App.Lock, so this class does no locking of its own.
    public class Store
    {
        public Db Db;
        readonly string dataDir;
        readonly string dbPath;
        readonly string backupDir;
        public readonly string UploadDir;
        public string FirstRunNote;

        public Store(string dataDir)
        {
            this.dataDir = dataDir;
            dbPath = Path.Combine(dataDir, "db.json");
            backupDir = Path.Combine(dataDir, "backups");
            UploadDir = Path.Combine(dataDir, "uploads");
            Directory.CreateDirectory(dataDir);
            Directory.CreateDirectory(backupDir);
            Directory.CreateDirectory(UploadDir);
        }

        public void Load()
        {
            if (File.Exists(dbPath))
            {
                Db = U.Json.Deserialize<Db>(File.ReadAllText(dbPath, Encoding.UTF8));
                Normalize();
            }
            else
            {
                Db = Seed.Build();
                FirstRunNote = Seed.CredentialsNote;
                Save();
            }
        }

        // Older or hand-edited files may miss lists; never let a null list crash a request.
        void Normalize()
        {
            var d = Db;
            if (d.settings == null) d.settings = new Settings();
            if (d.settings.components == null || d.settings.components.Count == 0) d.settings.components = Seed.Components();
            if (d.settings.vehicleTypes == null || d.settings.vehicleTypes.Count == 0) d.settings.vehicleTypes = Seed.VehicleTypes();
            if (d.users == null) d.users = new List<User>();
            if (d.credentials == null) d.credentials = new List<Credential>();
            if (d.sessions == null) d.sessions = new List<Session>();
            if (d.staff == null) d.staff = new List<Staff>();
            if (d.drivers == null) d.drivers = new List<Driver>();
            if (d.vehicles == null) d.vehicles = new List<Vehicle>();
            if (d.tasks == null) d.tasks = new List<TaskItem>();
            if (d.trips == null) d.trips = new List<Trip>();
            if (d.fuel == null) d.fuel = new List<FuelRecord>();
            if (d.maintenance == null) d.maintenance = new List<Maintenance>();
            if (d.requests == null) d.requests = new List<TripRequest>();
            if (d.notifications == null) d.notifications = new List<Notification>();
            if (d.logs == null) d.logs = new List<LogEntry>();
            if (d.uploads == null) d.uploads = new List<Upload>();
            if (d.processed == null) d.processed = new List<string>();
            foreach (var t in d.trips) if (t.stops == null) t.stops = new List<Stop>();
            // An email mid-send when the server stopped goes back in the queue.
            foreach (var n in d.notifications) if (n.status == "sending") n.status = "queued";
            foreach (var r in d.requests)
            {
                if (r.history == null) r.history = new List<HistoryEntry>();
                if (r.passengerList == null) r.passengerList = new List<Passenger>();
            }
        }

        public void Save()
        {
            // Bound the lists that only ever grow.
            if (Db.logs.Count > 5000) Db.logs.RemoveRange(5000, Db.logs.Count - 5000);
            if (Db.processed.Count > 5000) Db.processed.RemoveRange(0, Db.processed.Count - 5000);
            var now = DateTime.UtcNow;
            Db.sessions.RemoveAll(s => { var e = U.ParseTs(s.expiresTs); return e == null || e.Value < now; });

            string json = U.Json.Serialize(Db);
            string tmp = dbPath + ".tmp";
            File.WriteAllText(tmp, json, new UTF8Encoding(false));
            SwapIn(tmp);
            try { DailyBackup(json); } catch (IOException e) { Console.WriteLine("Daily backup skipped: " + e.Message); }
        }

        // Antivirus and indexers briefly lock freshly written files on Windows,
        // so the atomic swap is retried before falling back to an overwrite.
        void SwapIn(string tmp)
        {
            for (int attempt = 0; attempt < 12; attempt++)
            {
                try
                {
                    if (File.Exists(dbPath)) File.Replace(tmp, dbPath, null);
                    else File.Move(tmp, dbPath);
                    return;
                }
                catch (IOException) { System.Threading.Thread.Sleep(15 * (attempt + 1)); }
                catch (UnauthorizedAccessException) { System.Threading.Thread.Sleep(15 * (attempt + 1)); }
            }
            File.Copy(tmp, dbPath, true);
            File.Delete(tmp);
        }

        void DailyBackup(string json)
        {
            string name = "db-" + U.LocalNow().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + ".json";
            string path = Path.Combine(backupDir, name);
            if (File.Exists(path)) return;
            File.WriteAllText(path, json, new UTF8Encoding(false));
            var old = new DirectoryInfo(backupDir).GetFiles("db-*.json").OrderByDescending(f => f.Name).Skip(30);
            foreach (var f in old) { try { f.Delete(); } catch { } }
        }

        public string NewId(string prefix)
        {
            Db.seq++;
            return prefix + "-" + Db.seq.ToString(CultureInfo.InvariantCulture) + U.RandomToken(3).ToLowerInvariant().Replace("-", "x").Replace("_", "y");
        }
    }
}
