using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace SpinFleet
{
    public class Ctx
    {
        public User User;
        public Session Session;
        public string Ip;
        public string BaseUrl;       // scheme://host:port the browser used
        public string SetCookie;     // filled by login/logout
    }

    public partial class App
    {
        public readonly object Lock = new object();
        public readonly Config Cfg;
        public readonly Store S;
        public readonly string PublicDir;
        public Mailer Mail;

        readonly Dictionary<string, List<DateTime>> failures = new Dictionary<string, List<DateTime>>();

        public App(Config cfg, string root)
        {
            Cfg = cfg;
            try { U.Zone = TimeZoneInfo.FindSystemTimeZoneById(cfg.timeZone); } catch { U.Zone = TimeZoneInfo.Local; }
            PublicDir = Path.Combine(root, "public");
            S = new Store(Path.Combine(root, "data"));
            S.Load();
        }

        public bool SmtpConfigured { get { return Cfg.smtp != null && !string.IsNullOrEmpty(Cfg.smtp.host) && !string.IsNullOrEmpty(Cfg.smtp.from); } }

        Db D { get { return S.Db; } }

        // ------------------------------------------------------------------ lookups

        User UserById(string id) { return id == null ? null : D.users.FirstOrDefault(u => u.id == id); }
        Driver DriverById(string id) { return id == null ? null : D.drivers.FirstOrDefault(d => d.id == id); }
        Vehicle VehicleById(string id) { return id == null ? null : D.vehicles.FirstOrDefault(v => v.id == id); }
        Staff StaffById(string id) { return id == null ? null : D.staff.FirstOrDefault(s => s.id == id); }
        TaskItem TaskById(string id) { return id == null ? null : D.tasks.FirstOrDefault(t => t.id == id); }
        Trip TripById(string id) { return id == null ? null : D.trips.FirstOrDefault(t => t.id == id); }
        TripRequest RequestById(string id) { return id == null ? null : D.requests.FirstOrDefault(r => r.id == id); }
        Driver DriverForUser(User u) { return u == null ? null : D.drivers.FirstOrDefault(d => d.userId == u.id); }

        static T Must<T>(T obj, string what) where T : class
        {
            if (obj == null) throw new ApiError(what + " was not found. It may have been removed; refresh and try again.", "not_found", 404);
            return obj;
        }

        string ActorName(Ctx c) { return c.User == null ? "System" : c.User.name; }

        void Log(Ctx c, string action, string detail)
        {
            D.logs.Insert(0, new LogEntry
            {
                id = S.NewId("l"), ts = U.Now(),
                userId = c == null || c.User == null ? "u-system" : c.User.id,
                userName = c == null || c.User == null ? "System" : c.User.name,
                action = action, detail = detail ?? ""
            });
        }

        // ------------------------------------------------------------------ derived fields

        public double? LatestOdo(string vehicleId)
        {
            double? best = null;
            Action<double?> take = x => { if (x.HasValue && (!best.HasValue || x.Value > best.Value)) best = x; };
            var v = VehicleById(vehicleId);
            if (v != null) { take(v.initialOdo); take(v.lastServiceOdo); }
            foreach (var f in D.fuel) if (f.vehicleId == vehicleId) take(f.odometer);
            foreach (var t in D.trips) if (t.vehicleId == vehicleId) { take(t.startOdo); take(t.endOdo); }
            foreach (var m in D.maintenance) if (m.vehicleId == vehicleId) take(m.odometer);
            return best;
        }

        void Derive()
        {
            foreach (var d in D.drivers)
            {
                var u = UserById(d.userId);
                d.email = u == null ? null : u.email;
                d.account = u == null ? "inactive" : u.status;
            }
            var moving = new HashSet<string>(D.trips.Where(t => t.status == "inTransit").Select(t => t.vehicleId));
            foreach (var v in D.vehicles)
            {
                var drv = D.drivers.FirstOrDefault(d => d.vehicleId == v.id);
                v.driverId = drv == null ? null : drv.id;
                v.odometer = LatestOdo(v.id);
                double interval = v.serviceIntervalKm.HasValue && v.serviceIntervalKm.Value > 0 ? v.serviceIntervalKm.Value : D.settings.serviceIntervalKm;
                v.kmSinceService = v.odometer.HasValue && v.lastServiceOdo.HasValue ? Math.Max(0, v.odometer.Value - v.lastServiceOdo.Value) : (double?)null;
                v.serviceState = !v.kmSinceService.HasValue ? "ok" : v.kmSinceService.Value >= interval ? "due" : v.kmSinceService.Value >= interval * 0.9 ? "soon" : "ok";
                if (v.condition == "maintenance") v.status = "maintenance";
                else if (v.condition == "outOfService") v.status = "outOfService";
                else if (moving.Contains(v.id)) v.status = "inTransit";
                else if (v.driverId != null) v.status = "assigned";
                else v.status = "available";
            }
        }

        // ------------------------------------------------------------------ auth

        void RecordFailure(string key)
        {
            List<DateTime> l;
            if (!failures.TryGetValue(key, out l)) { l = new List<DateTime>(); failures[key] = l; }
            l.Add(DateTime.UtcNow);
        }

        void CheckThrottle(string key, int max)
        {
            List<DateTime> l;
            if (!failures.TryGetValue(key, out l)) return;
            var cutoff = DateTime.UtcNow.AddMinutes(-15);
            l.RemoveAll(x => x < cutoff);
            if (l.Count >= max) throw new ApiError("Too many failed attempts. Please wait 15 minutes and try again.", "throttled", 429);
        }

        public object Login(Ctx c, P p)
        {
            string email = (p.S("email", 200) ?? "").ToLowerInvariant();
            string pw = p.S("password", 200) ?? "";
            CheckThrottle("ip:" + c.Ip, 20);
            CheckThrottle("em:" + email, 5);
            var user = D.users.FirstOrDefault(u => (u.email ?? "").ToLowerInvariant() == email);
            var cred = user == null ? null : D.credentials.FirstOrDefault(x => x.userId == user.id);
            if (user == null || !U.VerifyPassword(cred, pw))
            {
                RecordFailure("ip:" + c.Ip); RecordFailure("em:" + email);
                throw new ApiError("Those details don't match an account. Check and try again.", "bad_login", 401);
            }
            if (user.status != "active") throw new ApiError("This account is inactive. Contact the fleet office.", "inactive", 403);
            failures.Remove("em:" + email);

            string token = U.RandomToken(32);
            var expires = user.role == "driver" ? DateTime.UtcNow.AddDays(Cfg.driverSessionDays) : DateTime.UtcNow.AddHours(Cfg.adminSessionHours);
            var sess = new Session { tokenHash = U.Sha256(token), userId = user.id, createdTs = U.Now(), expiresTs = U.Iso(expires) };
            D.sessions.Add(sess);
            user.lastLoginTs = U.Now();
            c.User = user; c.Session = sess;
            c.SetCookie = "sid=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + (int)(expires - DateTime.UtcNow).TotalSeconds;
            Log(c, "Signed in", user.email);
            S.Save();
            return State(c);
        }

        public object Logout(Ctx c)
        {
            if (c.Session != null) { D.sessions.Remove(c.Session); S.Save(); }
            c.SetCookie = "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
            return new Dictionary<string, object> { { "ok", true } };
        }

        public void Authenticate(Ctx c, string cookieToken)
        {
            if (string.IsNullOrEmpty(cookieToken)) return;
            string h = U.Sha256(cookieToken);
            var sess = D.sessions.FirstOrDefault(s => s.tokenHash == h);
            if (sess == null) return;
            var exp = U.ParseTs(sess.expiresTs);
            var user = UserById(sess.userId);
            if (exp == null || exp.Value < DateTime.UtcNow || user == null || user.status != "active") return;
            c.User = user; c.Session = sess;
        }

        void RequireRole(Ctx c, params string[] roles)
        {
            if (c.User == null) throw new ApiError("Please sign in again.", "unauthenticated", 401);
            if (!roles.Contains(c.User.role)) throw new ApiError("Your account is not allowed to do that.", "forbidden", 403);
        }

        // ------------------------------------------------------------------ state

        public object State(Ctx c)
        {
            if (c.User == null) throw new ApiError("Please sign in again.", "unauthenticated", 401);
            Derive();
            var u = c.User;
            var st = new Dictionary<string, object>();
            st["me"] = new Dictionary<string, object> { { "id", u.id }, { "name", u.name }, { "email", u.email }, { "role", u.role }, { "mustChangePassword", u.mustChangePassword } };
            st["settings"] = D.settings;
            st["serverTime"] = U.Now();
            st["smtpConfigured"] = SmtpConfigured;
            if (u.role == "admin" || u.role == "spc")
            {
                bool admin = u.role == "admin";
                st["users"] = D.users;
                st["staff"] = D.staff.Select(s => StaffView(s, admin)).ToList();
                st["drivers"] = D.drivers;
                st["vehicles"] = D.vehicles;
                st["tasks"] = D.tasks;
                st["trips"] = D.trips;
                st["fuel"] = D.fuel;
                st["maintenance"] = D.maintenance;
                st["requests"] = D.requests;
                st["notifications"] = D.notifications.Take(400).ToList();
                st["logs"] = D.logs.Take(600).ToList();
                st["hasDemo"] = D.drivers.Any(x => x.demo) || D.vehicles.Any(x => x.demo) || D.requests.Any(x => x.demo) || D.trips.Any(x => x.demo);
            }
            else
            {
                var me = DriverForUser(u);
                st["driver"] = me;
                if (me != null)
                {
                    var myTasks = D.tasks.Where(t => t.driverId == me.id && (t.status == "scheduled" || t.status == "inProgress" || RecentIso(t.scheduledTs, 14))).ToList();
                    var vids = new HashSet<string>(myTasks.Where(t => t.vehicleId != null).Select(t => t.vehicleId));
                    if (me.vehicleId != null) vids.Add(me.vehicleId);
                    var myTrips = D.trips.Where(t => t.driverId == me.id).OrderByDescending(t => t.startTs).Take(40).ToList();
                    foreach (var t in myTrips) vids.Add(t.vehicleId);
                    st["tasks"] = myTasks;
                    st["trips"] = myTrips;
                    st["fuel"] = D.fuel.Where(f => f.driverId == me.id).OrderByDescending(f => f.ts).Take(40).ToList();
                    st["vehicles"] = D.vehicles.Where(v => vids.Contains(v.id)).ToList();
                    // Requesters are shown on tasks that came from a trip request.
                    var reqIds = new HashSet<string>(myTasks.Where(t => t.requestId != null).Select(t => t.requestId));
                    st["requests"] = D.requests.Where(r => reqIds.Contains(r.id)).Select(r =>
                    {
                        var sf = StaffById(r.staffId);
                        return new Dictionary<string, object> {
                            { "id", r.id }, { "ref", r.@ref }, { "passengers", r.passengers }, { "returnTs", r.returnTs },
                            { "staffName", sf == null ? "" : sf.fullName }, { "staffPhone", sf == null ? "" : sf.phone } };
                    }).ToList();
                }
            }
            return st;
        }

        static bool RecentIso(string iso, int days)
        {
            var d = U.ParseTs(iso);
            return d != null && d.Value > DateTime.UtcNow.AddDays(-days);
        }

        static Staff StaffView(Staff s, bool withToken)
        {
            return new Staff
            {
                id = s.id, staffNo = s.staffNo, employeeNo = s.employeeNo, fullName = s.fullName, unitCode = s.unitCode, unit = s.unit,
                designation = s.designation, email = s.email, phone = s.phone, qrStatus = s.qrStatus, status = s.status, demo = s.demo,
                qrToken = withToken ? s.qrToken : null
            };
        }

        // ------------------------------------------------------------------ uploads

        static readonly Dictionary<string, string> AllowedMime = new Dictionary<string, string> {
            { "image/jpeg", ".jpg" }, { "image/png", ".png" }, { "image/webp", ".webp" }, { "application/pdf", ".pdf" } };

        // Accepts {name, data:"data:<mime>;base64,..."} and stores it; returns the upload id.
        string SaveInline(P file, string by)
        {
            if (file == null) return null;
            string data = file.S("data", 12000000);
            if (data == null) return null;
            var m = Regex.Match(data, @"^data:([a-z/+.-]+);base64,(.+)$", RegexOptions.Singleline);
            if (!m.Success) throw new ApiError("The attached file could not be read.", "bad_file", 400);
            string mime = m.Groups[1].Value.ToLowerInvariant();
            if (!AllowedMime.ContainsKey(mime)) throw new ApiError("Only JPG, PNG, WEBP images or PDF documents can be attached.", "bad_file", 400);
            byte[] bytes;
            try { bytes = Convert.FromBase64String(m.Groups[2].Value); } catch { throw new ApiError("The attached file could not be read.", "bad_file", 400); }
            if (bytes.Length > 5 * 1024 * 1024) throw new ApiError("Attachments must be 5 MB or smaller.", "too_large", 400);
            if (!MagicMatches(mime, bytes)) throw new ApiError("The attached file does not match its type.", "bad_file", 400);
            string id = "up-" + U.RandomToken(12).Replace("-", "x").Replace("_", "y");
            File.WriteAllBytes(Path.Combine(S.UploadDir, id + AllowedMime[mime]), bytes);
            string name = Regex.Replace(file.S("name", 300) ?? ("file" + AllowedMime[mime]), @"[^\w.\- ()]", "_");
            D.uploads.Add(new Upload { id = id, name = name, mime = mime, size = bytes.Length, ts = U.Now(), by = by });
            return id;
        }

        static bool MagicMatches(string mime, byte[] b)
        {
            if (b.Length < 12) return false;
            switch (mime)
            {
                case "image/jpeg": return b[0] == 0xFF && b[1] == 0xD8;
                case "image/png": return b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47;
                case "image/webp": return b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P';
                case "application/pdf": return b[0] == '%' && b[1] == 'P' && b[2] == 'D' && b[3] == 'F';
            }
            return false;
        }

        // Returns (meta, path) for an upload the caller may see, or throws.
        public Tuple<Upload, string> GetUpload(Ctx c, string id)
        {
            RequireRole(c, "admin", "spc", "driver");
            var up = Must(D.uploads.FirstOrDefault(x => x.id == id), "File");
            if (c.User.role == "driver" && up.by != c.User.id) throw new ApiError("Your account is not allowed to do that.", "forbidden", 403);
            string path = Path.Combine(S.UploadDir, up.id + AllowedMime[up.mime]);
            if (!File.Exists(path)) throw new ApiError("File was not found.", "not_found", 404);
            return Tuple.Create(up, path);
        }

        // ------------------------------------------------------------------ notifications

        string BaseUrl(Ctx c)
        {
            string b = D.settings.publicBaseUrl;
            if (string.IsNullOrEmpty(b)) b = c == null ? "" : c.BaseUrl;
            return (b ?? "").TrimEnd('/');
        }

        Notification Queue(string to, string toName, TripRequest r, string type, string subject, string body)
        {
            var n = new Notification
            {
                id = S.NewId("ntf"), requestId = r == null ? null : r.id, @ref = r == null ? null : r.@ref, to = to, toName = toName,
                type = type, subject = subject, body = body, ts = U.Now(), attempts = 0,
                status = SmtpConfigured ? "queued" : "not_configured",
                error = SmtpConfigured ? null : "SMTP is not configured in server/config.json"
            };
            if (!U.LooksLikeEmail(to)) { n.status = "failed"; n.error = "No valid email address on record"; }
            D.notifications.Insert(0, n);
            if (D.notifications.Count > 3000) D.notifications.RemoveRange(3000, D.notifications.Count - 3000);
            if (Mail != null) Mail.Wake();
            return n;
        }

        string RequestSummary(TripRequest r)
        {
            var sb = new StringBuilder();
            sb.AppendLine("Reference:   " + r.@ref);
            sb.AppendLine("Purpose:     " + r.purpose);
            sb.AppendLine("Destination: " + r.destination);
            sb.AppendLine("Departure:   " + U.FmtLocal(r.departTs));
            sb.AppendLine("Return:      " + U.FmtLocal(r.returnTs));
            sb.AppendLine("Passengers:  " + r.passengers);
            return sb.ToString();
        }

        // Email to the requesting staff member. Wording matches the staff status page:
        // decisions are presented as coming from the Logistics & Transport office.
        void NotifyStaff(Ctx c, TripRequest r, string type, string reason)
        {
            var sf = StaffById(r.staffId);
            if (sf == null) return;
            string subject, lead;
            switch (type)
            {
                case "submitted": subject = "Trip request " + r.@ref + " received"; lead = "Your trip request has been received by the Logistics & Transport Office. You will receive an email as it progresses."; break;
                case "acknowledged": subject = "Trip request " + r.@ref + " acknowledged"; lead = "Your trip request has been received and acknowledged by the Logistics & Transport Office."; break;
                case "review": subject = "Trip request " + r.@ref + " under review"; lead = "Your trip request is under review."; break;
                case "returned": subject = "Trip request " + r.@ref + " returned for correction"; lead = "Your trip request has been returned for correction. Please open your request page (scan your staff QR card) to update and resubmit it."; break;
                case "approved": subject = "Trip request " + r.@ref + " approved"; lead = "Your trip request has been approved. You will be told the driver and vehicle once assigned."; break;
                case "rejected": subject = "Trip request " + r.@ref + " declined"; lead = "Unfortunately your trip request has been declined."; break;
                case "rescheduled": subject = "Trip request " + r.@ref + " rescheduled"; lead = "Your trip request has been rescheduled. Please note the new dates below."; break;
                case "dispatch":
                    {
                        var d = DriverById(r.dispatchDriverId); var v = VehicleById(r.dispatchVehicleId);
                        subject = "Trip request " + r.@ref + " - vehicle & driver assigned";
                        lead = "A vehicle and driver have been assigned to your trip.\n\nDriver:  " + (d == null ? "-" : d.name + (string.IsNullOrEmpty(d.phone) ? "" : " (" + d.phone + ")")) +
                               "\nVehicle: " + (v == null ? "-" : v.reg + " - " + v.model + (string.IsNullOrEmpty(v.colour) ? "" : ", " + v.colour));
                        break;
                    }
                case "cancelled": subject = "Trip request " + r.@ref + " cancelled"; lead = "Your trip request has been cancelled."; break;
                default: return;
            }
            var body = new StringBuilder();
            body.AppendLine("Dear " + sf.fullName + ",");
            body.AppendLine();
            body.AppendLine(lead);
            if (!string.IsNullOrEmpty(reason)) { body.AppendLine(); body.AppendLine("Reason / comment: " + reason); }
            body.AppendLine();
            body.Append(RequestSummary(r));
            string baseUrl = BaseUrl(c);
            if (baseUrl.Length > 0) { body.AppendLine(); body.AppendLine("Track your request: " + baseUrl + "/#r=" + r.statusToken); }
            body.AppendLine();
            body.AppendLine(D.settings.orgName);
            Queue(sf.email, sf.fullName, r, type, subject, body.ToString());
        }

        void NotifyRole(Ctx c, string role, TripRequest r, string subject, string lead)
        {
            var sf = StaffById(r.staffId);
            string baseUrl = BaseUrl(c);
            foreach (var u in D.users.Where(x => x.role == role && x.status == "active"))
            {
                var body = new StringBuilder();
                body.AppendLine("Dear " + u.name + ",");
                body.AppendLine();
                body.AppendLine(lead);
                body.AppendLine();
                body.AppendLine("Requested by: " + (sf == null ? "-" : sf.fullName + " (" + sf.designation + ", " + sf.unit + ")"));
                body.AppendLine("Priority:     " + (r.priority == "urgent" ? "URGENT - " + r.urgentReason : "Normal"));
                body.Append(RequestSummary(r));
                if (baseUrl.Length > 0) { body.AppendLine(); body.AppendLine("Open in SPIN-KN Fleet: " + baseUrl + "/#/requests/" + r.id); }
                Queue(u.email, u.name, r, "internal", subject, body.ToString());
            }
        }
    }
}
