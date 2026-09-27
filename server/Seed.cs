using System;
using System.Collections.Generic;

namespace SpinFleet
{
    // First-run data. Staff are the real SPIN-KN directory; drivers, vehicles,
    // tasks, trips, fuel and the sample request are flagged demo so an admin can
    // remove them in one click (Settings -> Remove demo records).
    public static class Seed
    {
        public const string CredentialsNote =
            "First-run accounts (each must set a new password at first sign-in):\n" +
            "  Admin : yasjibril@spinkano.com.ng   / admin123\n" +
            "  SPC   : ainuraddeen@spinkano.com.ng / spc123\n" +
            "  Driver: musa@spin-kn.ng (also aisha@, fatima@, ibrahim@) / driver123";

        public static List<string> Components()
        {
            return new List<string> { "Dam & Power Infrastructure", "Irrigation & Drainage", "Agricultural Services & Livelihoods", "Institutional Strengthening & Project Management" };
        }

        public static List<string> VehicleTypes()
        {
            return new List<string> { "Toyota Hilux", "Long Nose Bus (14 Seater)", "Any available vehicle" };
        }

        // Local time today+day at h:m, as UTC ISO.
        static string A(int day, int h, int m)
        {
            var local = U.LocalNow().Date.AddDays(day).AddHours(h).AddMinutes(m);
            return U.Iso(TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), U.Zone));
        }

        static string D(int day) { return U.LocalNow().Date.AddDays(day).ToString("yyyy-MM-dd"); }

        public static Db Build()
        {
            var db = new Db { version = 1, createdTs = U.Now(), seq = 1000, requestSeq = 42 };
            db.settings.components = Components();
            db.settings.vehicleTypes = VehicleTypes();

            AddUser(db, "u-admin", "Yasir Jibril Ibrahim", "yasjibril@spinkano.com.ng", "admin", "admin123", false);
            AddUser(db, "u-spc", "Isah Nuraddeen Abubakar", "ainuraddeen@spinkano.com.ng", "spc", "spc123", false);
            AddUser(db, "u-musa", "Musa Ibrahim", "musa@spin-kn.ng", "driver", "driver123", true);
            AddUser(db, "u-aisha", "Aisha Bello", "aisha@spin-kn.ng", "driver", "driver123", true);
            AddUser(db, "u-fatima", "Fatima Yusuf", "fatima@spin-kn.ng", "driver", "driver123", true);
            AddUser(db, "u-ibrahim", "Ibrahim Garba", "ibrahim@spin-kn.ng", "driver", "driver123", true);
            AddUser(db, "u-sani", "Sani Abdullahi", "sani@spin-kn.ng", "driver", "driver123", true);
            db.users.Find(u => u.id == "u-sani").status = "inactive";

            db.vehicles.Add(V("v-1", "KN-SPIN-001", "SPIN-KN-001", "2GD-1104556", "MR0HB8CD100112233", "White", "Toyota Hilux 2.4", "ok", 45500, 44000, D(200), D(90)));
            db.vehicles.Add(V("v-2", "KN-SPIN-002", "SPIN-KN-002", "1GD-2205671", "JTMHV05J904455661", "Silver", "Toyota Land Cruiser", "ok", 15000, 15000, D(20), D(150)));
            db.vehicles.Add(V("v-3", "KN-SPIN-003", "SPIN-KN-003", "4N15-8891234", "MMBJNKL40NH009812", "Blue", "Mitsubishi L200", "ok", 90000, 88000, D(300), D(-5)));
            db.vehicles.Add(V("v-4", "KN-SPIN-004", "SPIN-KN-004", "2GD-3319088", "MR0HB8CD100119987", "White", "Toyota Hilux 2.4", "maintenance", 58900, 61200, D(120), D(120)));
            db.vehicles.Add(V("v-5", "KN-SPIN-005", "SPIN-KN-005", "P4AT-5567120", "MNCUMFF50NW776543", "Grey", "Ford Ranger XLS", "ok", 30000, 29800, D(60), D(240)));

            db.drivers.Add(Dr("d-musa", "u-musa", "Musa Ibrahim", "DRV-001", "0803 111 2201", "active", "v-1", D(200)));
            db.drivers.Add(Dr("d-aisha", "u-aisha", "Aisha Bello", "DRV-002", "0803 111 2202", "active", "v-2", D(14)));
            db.drivers.Add(Dr("d-fatima", "u-fatima", "Fatima Yusuf", "DRV-003", "0803 111 2203", "active", "v-5", D(24)));
            db.drivers.Add(Dr("d-ibrahim", "u-ibrahim", "Ibrahim Garba", "DRV-004", "0803 111 2204", "active", "v-3", D(490)));
            db.drivers.Add(Dr("d-sani", "u-sani", "Sani Abdullahi", "DRV-005", "0803 111 2205", "expired", null, D(-26)));

            db.tasks.Add(Tk("tk-1", "d-musa", "v-1", "Transport solar irrigation pumps", "SPIN Central Warehouse, Kano", "Bichi irrigation scheme", A(0, 10, 30), "high", "scheduled", false, null));
            db.tasks.Add(Tk("tk-2", "d-musa", "v-1", "Collect field survey team", "SPIN Project Office", "Dawakin Tofa LGA", A(0, 14, 0), "medium", "scheduled", false, null));
            db.tasks.Add(Tk("tk-3", "d-musa", "v-1", "Deliver spare pump parts", "SPIN Central Warehouse, Kano", "Rano pumping station", A(1, 8, 0), "low", "scheduled", false, null));
            db.tasks.Add(Tk("tk-4", "d-aisha", "v-2", "Site survey transport", "SPIN Project Office", "Wudil canal head", A(0, 7, 0), "high", "inProgress", true, "t-501"));
            db.tasks.Add(Tk("tk-5", "d-ibrahim", "v-3", "Transport maintenance technicians", "SPIN Project Office", "Gwarzo solar site", A(1, 9, 0), "medium", "scheduled", false, null));
            db.tasks.Add(Tk("tk-6", "d-fatima", "v-5", "Deliver irrigation piping", "SPIN Central Warehouse, Kano", "Tudun Wada distribution point", A(2, 8, 0), "low", "scheduled", false, null));

            var t501 = Tr("t-501", "d-aisha", "v-2", "tk-4", "inTransit", A(0, 7, 15), 12.0022, 8.5919, 15498, null, null, null, null);
            t501.stops.Add(new Stop { id = "s-1", startTs = A(0, 8, 10), endTs = A(0, 8, 35), lat = 12.0201, lng = 8.6033, note = "Checkpoint stop" });
            db.trips.Add(t501);
            db.trips.Add(Tr("t-490", "d-musa", "v-1", null, "completed", A(-1, 8, 0), 11.9962, 8.5921, 48090, A(-1, 13, 0), 12.0512, 8.6402, 48210));
            db.trips.Add(Tr("t-486", "d-aisha", "v-2", null, "completed", A(-1, 9, 0), 12.0022, 8.5919, 15320, A(-1, 15, 0), 11.7401, 8.515, 15498));
            db.trips.Add(Tr("t-472", "d-ibrahim", "v-3", null, "completed", A(-2, 7, 0), 12.0022, 8.5919, 90210, A(-2, 12, 0), 12.4522, 8.5199, 90475));
            db.trips.Add(Tr("t-455", "d-fatima", "v-5", null, "completed", A(-3, 8, 0), 12.0022, 8.5919, 30110, A(-3, 16, 0), 11.5533, 8.92, 30388));

            db.fuel.Add(F("f-201", "d-musa", "v-1", A(-1, 12, 0), 40, 46000, null));
            db.fuel.Add(F("f-202", "d-aisha", "v-2", A(-1, 14, 0), 55, 63250, null));
            db.fuel.Add(F("f-203", "d-ibrahim", "v-3", A(-2, 11, 0), 38, 43700, null));
            db.fuel.Add(F("f-204", "d-fatima", "v-5", A(-3, 15, 0), 45, 51750, null));
            db.fuel.Add(F("f-205", "d-musa", "v-1", A(0, 8, 0), 42, 48300, 48260));

            AddStaff(db);

            var req = new TripRequest
            {
                id = "req-1", @ref = "TR-2026-000042", statusToken = "st_" + U.RandomToken(12), staffId = "stf-16",
                purpose = "Quarterly financial review meeting", component = "Institutional Strengthening & Project Management",
                destination = "SPIN Federal Liaison Office, Abuja", departTs = A(1, 8, 0), returnTs = A(3, 17, 0), passengers = 2,
                vehicle = "Toyota Hilux", priority = "normal", urgentReason = "", assignment = "Q3 budget reconciliation", remarks = "",
                status = "SUBMITTED", createdTs = A(0, 7, 30), updatedTs = A(0, 7, 30), demo = true
            };
            req.passengerList.Add(new Passenger { name = "Aisha Adnan Maje", org = "" });
            req.history.Add(new HistoryEntry { ts = A(0, 7, 30), actor = "Zaharaddeen Lawan", action = "TRIP_REQUEST_SUBMITTED", from = "DRAFT", to = "SUBMITTED", comment = "" });
            db.requests.Add(req);

            db.logs.Add(new LogEntry { id = "l-1", ts = U.Now(), userId = "u-system", userName = "System", action = "System initialised", detail = "Database created with starter data" });
            return db;
        }

        static void AddUser(Db db, string id, string name, string email, string role, string pw, bool demo)
        {
            db.users.Add(new User { id = id, name = name, email = email, role = role, status = "active", mustChangePassword = true, createdTs = U.Now(), demo = demo });
            db.credentials.Add(U.HashPassword(id, pw));
        }

        static Vehicle V(string id, string asset, string reg, string eng, string ch, string col, string model, string cond, double lastSvc, double initOdo, string ins, string rw)
        {
            return new Vehicle { id = id, assetId = asset, reg = reg, engineNo = eng, chassisNo = ch, colour = col, model = model, condition = cond, lastServiceOdo = lastSvc, initialOdo = initOdo, insuranceExpiry = ins, roadworthinessExpiry = rw, demo = true };
        }

        static Driver Dr(string id, string uid, string name, string no, string phone, string contract, string vid, string lic)
        {
            return new Driver { id = id, userId = uid, name = name, driverNo = no, phone = phone, contract = contract, vehicleId = vid, licenceExpiry = lic, demo = true };
        }

        static TaskItem Tk(string id, string d, string v, string purpose, string origin, string dest, string ts, string prio, string status, bool ack, string trip)
        {
            return new TaskItem { id = id, driverId = d, vehicleId = v, purpose = purpose, origin = origin, destination = dest, scheduledTs = ts, priority = prio, status = status, acknowledged = ack, tripId = trip, createdTs = U.Now(), createdBy = "Yasir Jibril Ibrahim", demo = true };
        }

        static Trip Tr(string id, string d, string v, string task, string status, string sTs, double sLat, double sLng, double sOdo, string eTs, double? eLat, double? eLng, double? eOdo)
        {
            return new Trip { id = id, driverId = d, vehicleId = v, taskId = task, status = status, startTs = sTs, startLat = sLat, startLng = sLng, startOdo = sOdo, endTs = eTs, endLat = eLat, endLng = eLng, endOdo = eOdo, demo = true };
        }

        static FuelRecord F(string id, string d, string v, string ts, double l, double c, double? odo)
        {
            return new FuelRecord { id = id, driverId = d, vehicleId = v, ts = ts, litres = l, cost = c, odometer = odo, enteredBy = "driver", demo = true };
        }

        static void AddStaff(Db db)
        {
            // staffNo, employeeNo, full name, unitCode, unit, designation, email, phone
            string[][] rows = {
                new[]{"STF-0001","SPINKN-PIUHR-I","Isah Nuraddeen Abubakar","PMC","Project Management & Coordination","State Project Coordinator","ainuraddeen@spinkano.com.ng","0803 201 1001"},
                new[]{"STF-0002","SPINKN-PIUHR-X","Yasir Jibril Ibrahim","PMC","Project Management & Coordination","Logistics & Transportation Officer","yasjibril@spinkano.com.ng","0803 202 1002"},
                new[]{"STF-0003","SPINKN-PIUHR-XII","Basheer Auwal","PMC","Project Management & Coordination","Water Users Officer & Scheme Manager","basheerauwal@spinkano.com.ng","0803 203 1003"},
                new[]{"STF-0004","SPINKN-PIUHR-XVII","Zainab Adnan Danbatta","PMC","Project Management & Coordination","Project Management Support","adzainab@spinkano.com.ng","0803 204 1004"},
                new[]{"STF-0005","SPINKN-PIUHR-XIX","Jamila Aliyu Baba","PMC","Project Management & Coordination","Planning, Research & Asset Mgmt.","abjamila@spinkano.com.ng","0803 205 1005"},
                new[]{"STF-0006","SPINKN-PIUHR-XVIII","Aslam Mukhtar Ismail","PMC","Project Management & Coordination","Head, Special Projects Department","imukhtar@spinkano.com.ng","0803 206 1006"},
                new[]{"STF-0007","SPINKN-PIUHR-XIV","Abubakar Ramadan","ETS","Engineering & Technical Service","Monitoring & Evaluation Specialist","aramadan@spinkano.com.ng","0803 207 1007"},
                new[]{"STF-0008","SPINKN-PIUHR-XI","Mustapha Muhammad Bello","ETS","Engineering & Technical Service","Irrigation Engineer","mmbello@spinkano.com.ng","0803 208 1008"},
                new[]{"STF-0009","SPINKN-PIUHR-V","Mukhtar Kiru Usman","ETS","Engineering & Technical Service","Project Engineer","mukhtarkiru@spinkano.com.ng","0803 209 1009"},
                new[]{"STF-0010","SPINKN-PIUHR-II","Yasmin Asiya Mukhtar","ESG","Environmental Safeguard","Environmental Specialist","aymukhtar@spinkano.com.ng","0803 210 1010"},
                new[]{"STF-0011","SPINKN-PIUHR-XV","Bashir Kabir Rabiu","ESG","Environmental Safeguard","Social Specialist","magikkalaz@gmail.com","0803 211 1011"},
                new[]{"STF-0012","SPINKN-PIUHR-XIII","Nafisat Ismail Mukhtar","ESG","Environmental Safeguard","Gender Specialist","nafmukh@spinkano.com.ng","0803 212 1012"},
                new[]{"STF-0013","SPINKN-PIUHR-VI","Nura Garba","POD","Project Operations & Development","ICT, Data & Asset Management Specialist","nuragarba@spinkano.com.ng","0803 213 1013"},
                new[]{"STF-0014","SPINKN-PIUHR-VII","Maryam Abdul Mustapha","POD","Project Operations & Development","Information & Communication Specialist","maryammustapha@spinkano.com.ng","0803 214 1014"},
                new[]{"STF-0015","SPINKN-PIUHR-VIII","Bilkisu Ibrahim Muazzam","POD","Project Operations & Development","Community Relations & Mobilization Specialist","mbilkisu@spinkano.com.ng","0803 215 1015"},
                new[]{"STF-0016","SPINKN-PIUHR-III","Zaharaddeen Lawan","PAF","Planning, Admin & Finance","Project Accountant","zlawan@spinkano.com.ng","0803 216 1016"},
                new[]{"STF-0017","SPINKN-PIUHR-IX","Muhammad Umar Ibrahim","PAF","Planning, Admin & Finance","Human Resources & Administration Officer","miumar@spinkano.com.ng","0803 217 1017"},
                new[]{"STF-0018","SPINKN-PIUHR-IV","Kakisu Ibrahim Ahmad","PAF","Planning, Admin & Finance","Procurement Specialist","ikakisu@spinkano.com.ng","0803 218 1018"},
                new[]{"STF-0019","SPINKN-PIUHR-XVI","Aisha Adnan Maje","PAF","Planning, Admin & Finance","Project Internal Auditor","adnanaisha@spinkano.com.ng","0803 219 1019"},
            };
            int i = 1;
            foreach (var r in rows)
            {
                db.staff.Add(new Staff
                {
                    id = "stf-" + i++, staffNo = r[0], employeeNo = r[1], fullName = r[2], unitCode = r[3], unit = r[4],
                    designation = r[5], email = r[6], phone = r[7], qrToken = "spk_" + U.RandomToken(15).Replace("-", "x").Replace("_", "y"), qrStatus = "active", status = "active"
                });
            }
        }
    }
}
