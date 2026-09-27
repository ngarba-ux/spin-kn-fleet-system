using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

namespace SpinFleet
{
    public partial class App
    {
        static readonly string[] OpenRequest = { "SUBMITTED", "ACKNOWLEDGED", "UNDER_ADMIN_REVIEW", "RETURNED_FOR_CORRECTION", "FORWARDED_TO_SPC", "APPROVED", "DRIVER_ASSIGNED" };
        static readonly string[] Committed = { "FORWARDED_TO_SPC", "APPROVED", "DRIVER_ASSIGNED" };

        // Entry point for everything a signed-in user does. Returns the fresh state
        // plus an optional "result" so the browser never has to re-fetch.
        // Every successful change is saved immediately, so reloading the file
        // discards whatever a failed request had already modified in memory.
        // Called by the HTTP layer for any POST that does not succeed.
        public void Rollback()
        {
            try { S.Load(); } catch (Exception e) { Console.WriteLine("Rollback reload failed: " + e.Message); }
        }

        public object Action(Ctx c, string type, P p)
        {
            if (c.User == null) throw new ApiError("Please sign in again.", "unauthenticated", 401);
            if (c.User.mustChangePassword && type != "me.password")
                throw new ApiError("Please set a new password first.", "must_change_password", 403);

            object result = null;
            switch (type)
            {
                case "me.password": ChangePassword(c, p); break;

                // --- admin: people & accounts
                case "user.save": RequireRole(c, "admin"); result = SaveUser(c, p); break;
                case "user.toggle": RequireRole(c, "admin"); ToggleUser(c, p); break;
                case "user.resetPassword": RequireRole(c, "admin"); result = ResetPassword(c, p); break;
                case "driver.save": RequireRole(c, "admin"); result = SaveDriver(c, p); break;
                case "driver.toggle": RequireRole(c, "admin"); ToggleDriver(c, p); break;
                case "staff.save": RequireRole(c, "admin"); SaveStaff(c, p); break;
                case "staff.toggle": RequireRole(c, "admin"); ToggleStaff(c, p); break;
                case "staff.revokeToken": RequireRole(c, "admin"); RevokeToken(c, p); break;
                case "staff.regenerateToken": RequireRole(c, "admin"); RegenerateToken(c, p); break;

                // --- admin: fleet
                case "vehicle.save": RequireRole(c, "admin"); SaveVehicle(c, p); break;
                case "vehicle.setCondition": RequireRole(c, "admin"); SetCondition(c, p); break;
                case "vehicle.serviced": RequireRole(c, "admin"); MarkServiced(c, p); break;
                case "task.save": RequireRole(c, "admin"); SaveTask(c, p); break;
                case "task.cancel": RequireRole(c, "admin"); CancelTask(c, p); break;
                case "trip.forceEnd": RequireRole(c, "admin"); ForceEndTrip(c, p); break;
                case "fuel.adminAdd": RequireRole(c, "admin"); AdminFuel(c, p); break;

                // --- trip requests
                case "request.ack": RequireRole(c, "admin"); ReqAck(c, p); break;
                case "request.review": RequireRole(c, "admin"); ReqReview(c, p); break;
                case "request.return": RequireRole(c, "admin", "spc"); ReqReturn(c, p); break;
                case "request.forward": RequireRole(c, "admin"); ReqForward(c, p); break;
                case "request.approve": RequireRole(c, "spc"); ReqApprove(c, p); break;
                case "request.reject": RequireRole(c, "spc"); ReqReject(c, p); break;
                case "request.reschedule": RequireRole(c, "admin", "spc"); ReqReschedule(c, p); break;
                case "request.dispatch": RequireRole(c, "admin"); ReqDispatch(c, p); break;
                case "request.cancel": RequireRole(c, "admin"); ReqCancel(c, p); break;
                case "request.close": RequireRole(c, "admin"); ReqClose(c, p); break;
                case "request.checkConflicts": RequireRole(c, "admin", "spc"); result = CheckConflicts(p); break;

                // --- system
                case "notification.resend": RequireRole(c, "admin"); Resend(c, p); break;
                case "smtp.test": RequireRole(c, "admin"); SmtpTest(c, p); break;
                case "settings.save": RequireRole(c, "admin"); SaveSettings(c, p); break;
                case "demo.clear": RequireRole(c, "admin"); ClearDemo(c); break;

                // --- driver
                case "driver.sync": RequireRole(c, "driver"); result = DriverSync(c, p); break;

                default: throw new ApiError("Unknown action.", "unknown_action", 400);
            }
            S.Save();
            var st = (Dictionary<string, object>)State(c);
            if (result != null) st["result"] = result;
            return st;
        }

        // ================================================================== accounts

        void ChangePassword(Ctx c, P p)
        {
            var cred = D.credentials.FirstOrDefault(x => x.userId == c.User.id);
            if (!U.VerifyPassword(cred, p.S("current", 200) ?? ""))
                throw new ApiError("Your current password is not correct.", "bad_password", 400);
            string next = p.S("next", 200);
            U.ValidatePassword(next);
            if (next == p.S("current", 200)) throw new ApiError("Choose a password different from the current one.", "weak_password", 400);
            D.credentials.RemoveAll(x => x.userId == c.User.id);
            D.credentials.Add(U.HashPassword(c.User.id, next));
            c.User.mustChangePassword = false;
            // Sign out every other device.
            D.sessions.RemoveAll(s => s.userId == c.User.id && s != c.Session);
            Log(c, "Password changed", c.User.email);
        }

        void EnsureEmailFree(string email, string exceptUserId)
        {
            if (!U.LooksLikeEmail(email)) throw new ApiError("Enter a valid email address.", "bad_email", 400);
            if (D.users.Any(u => u.id != exceptUserId && (u.email ?? "").ToLowerInvariant() == email.ToLowerInvariant()))
                throw new ApiError("Another account already uses this email.", "duplicate", 409);
        }

        object SaveUser(Ctx c, P p)
        {
            string id = p.S("id");
            string name = p.Req("name", "Name", 120);
            string email = p.Req("email", "Email", 200).ToLowerInvariant();
            string role = U.OneOf(p.Req("role", "Role"), "Role", "admin", "spc");
            EnsureEmailFree(email, id);
            if (id == null)
            {
                string pw = U.TempPassword();
                var u = new User { id = S.NewId("u"), name = name, email = email, role = role, status = "active", mustChangePassword = true, createdTs = U.Now() };
                D.users.Add(u);
                D.credentials.Add(U.HashPassword(u.id, pw));
                Log(c, "User created", name + " (" + role + ")");
                return new Dictionary<string, object> { { "tempPassword", pw }, { "email", email } };
            }
            var existing = Must(UserById(id), "User");
            if (existing.role == "driver") throw new ApiError("Edit drivers from the Drivers page.", "bad_request", 400);
            if (existing.id == c.User.id && role != "admin") throw new ApiError("You cannot remove your own admin role.", "bad_request", 400);
            existing.name = name; existing.email = email; existing.role = role;
            Log(c, "User updated", name);
            return null;
        }

        void ToggleUser(Ctx c, P p)
        {
            var u = Must(UserById(p.S("id")), "User");
            if (u.id == c.User.id) throw new ApiError("You cannot deactivate your own account.", "bad_request", 400);
            if (u.status == "active" && u.role == "admin" && D.users.Count(x => x.role == "admin" && x.status == "active") <= 1)
                throw new ApiError("At least one active administrator is required.", "bad_request", 400);
            u.status = u.status == "active" ? "inactive" : "active";
            if (u.status == "inactive") D.sessions.RemoveAll(s => s.userId == u.id);
            Log(c, u.status == "active" ? "User activated" : "User deactivated", u.name);
        }

        object ResetPassword(Ctx c, P p)
        {
            var u = Must(UserById(p.S("id")), "User");
            string pw = U.TempPassword();
            D.credentials.RemoveAll(x => x.userId == u.id);
            D.credentials.Add(U.HashPassword(u.id, pw));
            u.mustChangePassword = true;
            D.sessions.RemoveAll(s => s.userId == u.id);
            Log(c, "Password reset", u.name);
            return new Dictionary<string, object> { { "tempPassword", pw }, { "email", u.email } };
        }

        object SaveDriver(Ctx c, P p)
        {
            string id = p.S("id");
            string name = p.Req("name", "Full name", 120);
            string email = p.Req("email", "Email / username", 200).ToLowerInvariant();
            string vehicleId = p.S("vehicleId");
            if (vehicleId != null) Must(VehicleById(vehicleId), "Vehicle");
            string contract = U.OneOf(p.S("contract") ?? "active", "Contract", "active", "expired", "terminated");
            object result = null;
            Driver d;
            if (id == null)
            {
                string uid = S.NewId("u");
                EnsureEmailFree(email, null);
                string pw = U.TempPassword();
                D.users.Add(new User { id = uid, name = name, email = email, role = "driver", status = "active", mustChangePassword = true, createdTs = U.Now() });
                D.credentials.Add(U.HashPassword(uid, pw));
                d = new Driver { id = S.NewId("d"), userId = uid };
                D.drivers.Add(d);
                result = new Dictionary<string, object> { { "tempPassword", pw }, { "email", email } };
                Log(c, "Driver created", name);
            }
            else
            {
                d = Must(DriverById(id), "Driver");
                var u = Must(UserById(d.userId), "Driver account");
                EnsureEmailFree(email, u.id);
                u.email = email; u.name = name;
                Log(c, "Driver updated", name);
            }
            var user = UserById(d.userId);
            if (user != null) { user.name = name; user.email = email; }
            d.name = name;
            d.driverNo = p.S("driverNo", 40);
            d.phone = p.S("phone", 40);
            d.licenceNo = p.S("licenceNo", 60);
            d.licenceExpiry = U.DateOnly(p.S("licenceExpiry"), "Licence expiry");
            d.contract = contract;
            if (vehicleId != d.vehicleId)
            {
                if (D.trips.Any(t => t.driverId == d.id && t.status == "inTransit"))
                    throw new ApiError("This driver has a trip in progress. End it before changing their vehicle.", "bad_state", 409);
                // One driver per vehicle: take it from whoever had it.
                foreach (var other in D.drivers.Where(x => x.id != d.id && x.vehicleId == vehicleId && vehicleId != null))
                {
                    other.vehicleId = null;
                    Log(c, "Vehicle unassigned", other.name);
                }
                d.vehicleId = vehicleId;
                var v = VehicleById(vehicleId);
                Log(c, "Vehicle assigned", (v == null ? "None" : v.reg) + " -> " + name);
            }
            return result;
        }

        void ToggleDriver(Ctx c, P p)
        {
            var d = Must(DriverById(p.S("id")), "Driver");
            var u = Must(UserById(d.userId), "Driver account");
            if (u.status == "active" && D.trips.Any(t => t.driverId == d.id && t.status == "inTransit"))
                throw new ApiError("This driver has a trip in progress. End it first.", "bad_state", 409);
            u.status = u.status == "active" ? "inactive" : "active";
            if (u.status == "inactive") D.sessions.RemoveAll(s => s.userId == u.id);
            Log(c, u.status == "active" ? "Driver activated" : "Driver deactivated", d.name);
        }

        void SaveStaff(Ctx c, P p)
        {
            string id = p.S("id");
            string email = p.S("email", 200);
            if (email != null && !U.LooksLikeEmail(email)) throw new ApiError("Enter a valid email address.", "bad_email", 400);
            Staff s;
            if (id == null)
            {
                s = new Staff { id = S.NewId("stf"), qrToken = NewStaffToken(), qrStatus = "active", status = "active" };
                int n = D.staff.Count + 1;
                while (D.staff.Any(x => x.staffNo == "STF-" + n.ToString("0000"))) n++;
                s.staffNo = "STF-" + n.ToString("0000");
                D.staff.Add(s);
            }
            else s = Must(StaffById(id), "Staff member");
            s.fullName = p.Req("fullName", "Full name", 120);
            s.employeeNo = p.S("employeeNo", 60);
            s.unitCode = p.S("unitCode", 20);
            s.unit = p.S("unit", 120);
            s.designation = p.S("designation", 120);
            s.email = email == null ? null : email.ToLowerInvariant();
            s.phone = p.S("phone", 40);
            Log(c, id == null ? "Staff added" : "Staff updated", s.fullName);
        }

        string NewStaffToken()
        {
            string t;
            do { t = "spk_" + U.RandomToken(15).Replace("-", "x").Replace("_", "y"); } while (D.staff.Any(s => s.qrToken == t));
            return t;
        }

        void ToggleStaff(Ctx c, P p)
        {
            var s = Must(StaffById(p.S("id")), "Staff member");
            s.status = s.status == "active" ? "inactive" : "active";
            Log(c, s.status == "active" ? "Staff activated" : "Staff deactivated", s.fullName);
        }

        void RevokeToken(Ctx c, P p)
        {
            var s = Must(StaffById(p.S("id")), "Staff member");
            s.qrStatus = "revoked";
            Log(c, "QR token revoked", s.fullName);
        }

        void RegenerateToken(Ctx c, P p)
        {
            var s = Must(StaffById(p.S("id")), "Staff member");
            s.qrToken = NewStaffToken();
            s.qrStatus = "active";
            Log(c, "QR token regenerated", s.fullName);
        }

        // ================================================================== fleet

        void SaveVehicle(Ctx c, P p)
        {
            string id = p.S("id");
            string reg = p.Req("reg", "Registration", 40).ToUpperInvariant();
            if (D.vehicles.Any(v => v.id != id && string.Equals(v.reg, reg, StringComparison.OrdinalIgnoreCase)))
                throw new ApiError("Another vehicle already has this registration.", "duplicate", 409);
            Vehicle x;
            if (id == null) { x = new Vehicle { id = S.NewId("v"), condition = "ok" }; D.vehicles.Add(x); }
            else x = Must(VehicleById(id), "Vehicle");
            x.reg = reg;
            x.assetId = p.S("assetId", 60);
            x.model = p.Req("model", "Model", 80);
            x.colour = p.S("colour", 40);
            x.engineNo = p.S("engineNo", 60);
            x.chassisNo = p.S("chassisNo", 60);
            x.insuranceExpiry = U.DateOnly(p.S("insuranceExpiry"), "Insurance expiry");
            x.roadworthinessExpiry = U.DateOnly(p.S("roadworthinessExpiry"), "Roadworthiness expiry");
            x.notes = p.S("notes", 1000);
            x.serviceIntervalKm = p.N("serviceIntervalKm");
            if (x.serviceIntervalKm.HasValue && x.serviceIntervalKm.Value <= 0) x.serviceIntervalKm = null;
            if (id == null)
            {
                x.initialOdo = p.N("initialOdo");
                x.lastServiceOdo = p.N("lastServiceOdo") ?? x.initialOdo;
            }
            else if (p.Has("lastServiceOdo")) x.lastServiceOdo = p.N("lastServiceOdo");

            if (p.Has("driverId") || id == null)
            {
                string driverId = p.S("driverId");
                var current = D.drivers.FirstOrDefault(d => d.vehicleId == x.id);
                if ((current == null ? null : current.id) != driverId)
                {
                    if (current != null) current.vehicleId = null;
                    if (driverId != null)
                    {
                        var nd = Must(DriverById(driverId), "Driver");
                        if (D.trips.Any(t => t.driverId == nd.id && t.status == "inTransit"))
                            throw new ApiError(nd.name + " has a trip in progress. End it before changing their vehicle.", "bad_state", 409);
                        nd.vehicleId = x.id;
                    }
                    Log(c, "Vehicle assigned", x.reg + " -> " + (driverId == null ? "None" : DriverById(driverId).name));
                }
            }
            Log(c, id == null ? "Vehicle added" : "Vehicle updated", x.reg);
        }

        void SetCondition(Ctx c, P p)
        {
            var v = Must(VehicleById(p.S("id")), "Vehicle");
            string cond = U.OneOf(p.Req("condition", "Status"), "Status", "ok", "maintenance", "outOfService");
            if (cond != "ok" && D.trips.Any(t => t.vehicleId == v.id && t.status == "inTransit"))
                throw new ApiError("This vehicle is on a trip. It can be taken off the road when the trip ends.", "bad_state", 409);
            v.condition = cond;
            Log(c, "Vehicle status changed", v.reg + " -> " + (cond == "ok" ? "In service" : cond == "maintenance" ? "Under maintenance" : "Out of service"));
        }

        void MarkServiced(Ctx c, P p)
        {
            var v = Must(VehicleById(p.S("id")), "Vehicle");
            double? odo = p.N("odometer") ?? LatestOdo(v.id);
            var last = LatestOdo(v.id);
            if (odo.HasValue && last.HasValue && odo.Value < last.Value)
                throw new ApiError("Odometer is lower than the last recorded reading (" + last.Value.ToString("N0") + " km).", "odo_low", 400);
            v.lastServiceOdo = odo;
            v.lastServiceDate = U.Now();
            D.maintenance.Insert(0, new Maintenance { id = S.NewId("m"), vehicleId = v.id, ts = U.Now(), odometer = odo, cost = p.N("cost"), notes = p.S("notes", 1000), by = c.User.name });
            Log(c, "Maintenance recorded", v.reg + (odo.HasValue ? " @ " + odo.Value.ToString("N0") + " km" : ""));
        }

        void SaveTask(Ctx c, P p)
        {
            string id = p.S("id");
            var drv = Must(DriverById(p.Req("driverId", "Driver")), "Driver");
            string vid = p.S("vehicleId") ?? drv.vehicleId;
            if (vid != null) Must(VehicleById(vid), "Vehicle");
            TaskItem t;
            if (id == null)
            {
                t = new TaskItem { id = S.NewId("tk"), status = "scheduled", createdTs = U.Now(), createdBy = c.User.name };
                D.tasks.Insert(0, t);
            }
            else
            {
                t = Must(TaskById(id), "Task");
                if (t.status != "scheduled") throw new ApiError("Only scheduled tasks can be edited.", "bad_state", 409);
                if (t.driverId != drv.id) t.acknowledged = false;
            }
            t.driverId = drv.id;
            t.vehicleId = vid;
            t.purpose = p.Req("purpose", "Purpose", 300);
            t.origin = p.S("origin", 200) ?? D.settings.defaultOrigin;
            t.destination = p.Req("destination", "Destination", 200);
            t.scheduledTs = U.Iso(U.ReqTs(p.Req("scheduledTs", "Scheduled time"), "Scheduled time"));
            t.priority = U.OneOf(p.S("priority") ?? "medium", "Priority", "high", "medium", "low");
            t.notes = p.S("notes", 1000);
            Log(c, id == null ? "Task assigned" : "Task updated", drv.name + " · " + t.purpose);
        }

        void CancelTask(Ctx c, P p)
        {
            var t = Must(TaskById(p.S("id")), "Task");
            if (t.status != "scheduled") throw new ApiError("Only tasks that have not started can be cancelled.", "bad_state", 409);
            t.status = "cancelled";
            var drv = DriverById(t.driverId);
            Log(c, "Task cancelled", (drv == null ? "" : drv.name) + " · " + t.purpose);
        }

        void ForceEndTrip(Ctx c, P p)
        {
            var t = Must(TripById(p.S("id")), "Trip");
            if (t.status != "inTransit") throw new ApiError("This trip has already ended.", "bad_state", 409);
            string reason = p.Req("reason", "Reason", 500);
            double? odo = p.N("odometer");
            if (odo.HasValue && t.startOdo.HasValue && odo.Value < t.startOdo.Value)
                throw new ApiError("End odometer cannot be lower than the start reading.", "odo_low", 400);
            FinishTrip(c, t, U.Now(), null, null, odo, "Ended by office: " + reason, null);
            t.endedBy = c.User.name;
            var v = VehicleById(t.vehicleId);
            Log(c, "Trip ended by office", (v == null ? "" : v.reg) + " · " + reason);
        }

        void AdminFuel(Ctx c, P p)
        {
            var v = Must(VehicleById(p.Req("vehicleId", "Vehicle")), "Vehicle");
            string driverId = p.S("driverId");
            if (driverId != null) Must(DriverById(driverId), "Driver");
            var rec = BuildFuel(p, v, driverId, c.User.name, p.S("ts") == null ? U.Now() : U.Iso(U.ReqTs(p.S("ts"), "Date")), c.User.id);
            D.fuel.Insert(0, rec);
            Log(c, "Fuel recorded", v.reg + " · " + rec.litres + " L");
        }

        FuelRecord BuildFuel(P p, Vehicle v, string driverId, string enteredBy, string ts, string uploader)
        {
            double litres = p.N("litres") ?? 0, cost = p.N("cost") ?? 0;
            if (litres <= 0 || litres > 1000) throw new ApiError("Enter the litres (greater than zero).", "v_positive", 400);
            if (cost < 0) throw new ApiError("Cost cannot be negative.", "v_positive", 400);
            double? odo = p.N("odometer");
            CheckOdo(v, odo);
            return new FuelRecord
            {
                id = S.NewId("f"), driverId = driverId, vehicleId = v.id, ts = ts, litres = litres, cost = cost, odometer = odo,
                station = p.S("station", 120), receiptId = SaveInline(p.Obj("receipt"), uploader), enteredBy = enteredBy
            };
        }

        void CheckOdo(Vehicle v, double? odo)
        {
            if (!odo.HasValue) return;
            if (odo.Value < 0 || odo.Value > 5000000) throw new ApiError("Enter a realistic odometer reading.", "v_positive", 400);
            var last = LatestOdo(v.id);
            if (last.HasValue && odo.Value < last.Value)
                throw new ApiError("Reading is lower than the last recorded odometer (" + last.Value.ToString("N0") + " km).", "v_odoLow", 400, last.Value);
        }

        // ================================================================== trip requests

        void Transition(TripRequest r, string actor, string action, string to, string comment)
        {
            r.history.Add(new HistoryEntry { ts = U.Now(), actor = actor, action = action, from = r.status, to = to ?? r.status, comment = comment ?? "" });
            if (to != null) r.status = to;
            r.updatedTs = U.Now();
        }

        static void RequireStatus(TripRequest r, params string[] allowed)
        {
            if (!allowed.Contains(r.status))
                throw new ApiError("This request is now '" + r.status.Replace('_', ' ').ToLowerInvariant() + "', so that step is no longer available. The list has been refreshed.", "bad_state", 409);
        }

        TripRequest Req(P p) { return Must(RequestById(p.Req("id", "Request")), "Trip request"); }

        void ReqAck(Ctx c, P p)
        {
            var r = Req(p);
            RequireStatus(r, "SUBMITTED");
            Transition(r, ActorName(c), "ADMIN_ACKNOWLEDGED", "ACKNOWLEDGED", p.S("comment", 1000));
            NotifyStaff(c, r, "acknowledged", null);
            Log(c, "Trip request acknowledged", r.@ref);
        }

        void ReqReview(Ctx c, P p)
        {
            var r = Req(p);
            RequireStatus(r, "SUBMITTED", "ACKNOWLEDGED");
            Transition(r, ActorName(c), "ADMIN_REVIEWED", "UNDER_ADMIN_REVIEW", p.S("comment", 1000));
            Log(c, "Trip request under review", r.@ref);
        }

        void ReqReturn(Ctx c, P p)
        {
            var r = Req(p);
            if (c.User.role == "spc") RequireStatus(r, "FORWARDED_TO_SPC");
            else RequireStatus(r, "SUBMITTED", "ACKNOWLEDGED", "UNDER_ADMIN_REVIEW", "FORWARDED_TO_SPC", "APPROVED");
            string reason = p.Req("comment", "Reason", 1000);
            Transition(r, ActorName(c), "RETURNED_FOR_CORRECTION", "RETURNED_FOR_CORRECTION", reason);
            r.proposedDriverId = null; r.proposedVehicleId = null; r.spcDecision = null;
            NotifyStaff(c, r, "returned", reason);
            Log(c, "Trip request returned", r.@ref + " · " + reason);
        }

        void ReqForward(Ctx c, P p)
        {
            var r = Req(p);
            RequireStatus(r, "SUBMITTED", "ACKNOWLEDGED", "UNDER_ADMIN_REVIEW");
            string driverId = p.S("driverId"), vehicleId = p.S("vehicleId");
            var drv = driverId == null ? null : Must(DriverById(driverId), "Driver");
            if (drv != null && vehicleId == null) vehicleId = drv.vehicleId;
            if (vehicleId != null) Must(VehicleById(vehicleId), "Vehicle");
            if (!p.B("force")) ThrowIfConflicts(driverId, vehicleId, r);
            string remark = p.S("remark", 1000);
            r.adminRemark = remark ?? "";
            r.proposedDriverId = driverId;
            r.proposedVehicleId = vehicleId;
            r.forwardedByName = ActorName(c);
            string comment = string.Join(" ", new[] { remark, drv == null ? null : "Proposed driver: " + drv.name }.Where(x => !string.IsNullOrEmpty(x)));
            Transition(r, ActorName(c), "FORWARDED_TO_SPC", "FORWARDED_TO_SPC", comment);
            NotifyStaff(c, r, "review", null);
            NotifyRole(c, "spc", r, "Trip request " + r.@ref + " awaiting your decision", "A trip request has been forwarded by " + ActorName(c) + " for your decision." + (string.IsNullOrEmpty(remark) ? "" : "\nRemark: " + remark));
            Log(c, "Trip request forwarded to SPC", r.@ref);
        }

        void ReqApprove(Ctx c, P p)
        {
            var r = Req(p);
            RequireStatus(r, "FORWARDED_TO_SPC");
            ApproveInternal(c, r, "SPC_APPROVED", p.S("comment", 1000));
            Log(c, "Trip request approved", r.@ref);
        }

        void ApproveInternal(Ctx c, TripRequest r, string action, string comment)
        {
            Transition(r, ActorName(c), action, "APPROVED", comment);
            r.spcDecision = action == "TRIP_RESCHEDULED" ? "RESCHEDULED" : "APPROVED";
            if (action != "TRIP_RESCHEDULED") NotifyStaff(c, r, "approved", comment);
            if (r.proposedDriverId != null)
            {
                var drv = DriverById(r.proposedDriverId);
                // Dispatch re-validates the driver and vehicle; if anything changed since
                // the proposal, leave the request APPROVED for the office to assign.
                try { Dispatch(c, r, drv == null ? null : drv.id, r.proposedVehicleId ?? (drv == null ? null : drv.vehicleId), "Auto-assigned from the approved proposal"); }
                catch (ApiError e)
                {
                    Transition(r, "System", "AUTO_DISPATCH_SKIPPED", null, e.Message);
                    NotifyRole(c, "admin", r, "Trip request " + r.@ref + " approved - assign a vehicle", "The SPC approved this request but the proposed driver could not be assigned automatically (" + e.Message + "). Please assign a vehicle and driver.");
                }
            }
            else
            {
                NotifyRole(c, "admin", r, "Trip request " + r.@ref + " approved - assign a vehicle", "The SPC has approved this trip request. Please assign a vehicle and driver.");
            }
        }

        void ReqReject(Ctx c, P p)
        {
            var r = Req(p);
            RequireStatus(r, "FORWARDED_TO_SPC");
            string reason = p.Req("comment", "Reason", 1000);
            Transition(r, ActorName(c), "SPC_REJECTED", "REJECTED", reason);
            r.spcDecision = "REJECTED";
            NotifyStaff(c, r, "rejected", reason);
            Log(c, "Trip request rejected", r.@ref + " · " + reason);
        }

        void ReqReschedule(Ctx c, P p)
        {
            var r = Req(p);
            if (c.User.role == "spc") RequireStatus(r, "FORWARDED_TO_SPC");
            else RequireStatus(r, "SUBMITTED", "ACKNOWLEDGED", "UNDER_ADMIN_REVIEW", "FORWARDED_TO_SPC", "APPROVED", "DRIVER_ASSIGNED");
            var dep = U.ReqTs(p.Req("departTs", "New departure"), "New departure");
            var ret = U.ReqTs(p.Req("returnTs", "New return"), "New return");
            if (ret < dep) throw new ApiError("Return must be on or after departure.", "v_returnBeforeDeparture", 400);
            string reason = p.Req("comment", "Reason", 1000);
            var task = TaskById(r.taskId);
            if (task != null && task.status == "inProgress") throw new ApiError("The trip has already started and cannot be rescheduled.", "bad_state", 409);

            string oldDep = r.departTs, oldRet = r.returnTs;
            r.departTs = U.Iso(dep); r.returnTs = U.Iso(ret);
            string drvId = r.dispatchDriverId ?? r.proposedDriverId, vehId = r.dispatchVehicleId ?? r.proposedVehicleId;
            if (!p.B("force") && (drvId != null || vehId != null))
            {
                var conflicts = Conflicts(drvId, vehId, dep, ret, r.id);
                if (conflicts.Count > 0) { r.departTs = oldDep; r.returnTs = oldRet; throw new ApiError("Scheduling conflict", "conflict", 409, conflicts); }
            }
            r.rescheduledFromDepart = oldDep; r.rescheduledFromReturn = oldRet;
            if (task != null && task.status == "scheduled") { task.scheduledTs = r.departTs; task.acknowledged = false; }
            string note = reason + " (was " + U.FmtLocal(oldDep) + " - " + U.FmtLocal(oldRet) + ")";
            if (c.User.role == "spc") ApproveInternal(c, r, "TRIP_RESCHEDULED", note);
            else Transition(r, ActorName(c), "TRIP_RESCHEDULED", null, note);
            NotifyStaff(c, r, "rescheduled", reason);
            Log(c, "Trip request rescheduled", r.@ref);
        }

        void ReqDispatch(Ctx c, P p)
        {
            var r = Req(p);
            RequireStatus(r, "APPROVED", "DRIVER_ASSIGNED");
            string driverId = p.Req("driverId", "Driver");
            var drv = Must(DriverById(driverId), "Driver");
            string vehicleId = p.S("vehicleId") ?? drv.vehicleId;
            if (!p.B("force")) ThrowIfConflicts(driverId, vehicleId, r);
            Dispatch(c, r, driverId, vehicleId, p.S("comment", 1000));
            Log(c, "Vehicle & driver assigned", r.@ref + " -> " + drv.name);
        }

        void Dispatch(Ctx c, TripRequest r, string driverId, string vehicleId, string comment)
        {
            var drv = Must(DriverById(driverId), "Driver");
            var du = UserById(drv.userId);
            if (du == null || du.status != "active") throw new ApiError(drv.name + "'s account is inactive.", "bad_state", 409);
            if (vehicleId == null) throw new ApiError(drv.name + " has no assigned vehicle. Choose a vehicle.", "required", 400);
            var v = Must(VehicleById(vehicleId), "Vehicle");
            if (v.condition != "ok") throw new ApiError(v.reg + " is not in service (maintenance / out of service).", "bad_state", 409);

            var old = TaskById(r.taskId);
            if (old != null)
            {
                if (old.status == "inProgress") throw new ApiError("The trip has already started; the assignment cannot be changed.", "bad_state", 409);
                if (old.status == "scheduled") old.status = "cancelled";
            }
            var sf = StaffById(r.staffId);
            var t = new TaskItem
            {
                id = S.NewId("tk"), driverId = drv.id, vehicleId = v.id, purpose = r.purpose, origin = D.settings.defaultOrigin,
                destination = r.destination, scheduledTs = r.departTs, priority = r.priority == "urgent" ? "high" : "medium",
                status = "scheduled", requestId = r.id, createdTs = U.Now(), createdBy = ActorName(c),
                notes = "Trip request " + r.@ref + (sf == null ? "" : " for " + sf.fullName + (string.IsNullOrEmpty(sf.phone) ? "" : " (" + sf.phone + ")")) +
                        ". Passengers: " + r.passengers + ". Expected return: " + U.FmtLocal(r.returnTs) + "."
            };
            D.tasks.Insert(0, t);
            r.taskId = t.id;
            r.dispatchDriverId = drv.id;
            r.dispatchVehicleId = v.id;
            r.dispatchedByName = ActorName(c);
            Transition(r, ActorName(c), "DRIVER_ASSIGNED", "DRIVER_ASSIGNED", drv.name + " · " + v.reg + (string.IsNullOrEmpty(comment) ? "" : " · " + comment));
            NotifyStaff(c, r, "dispatch", null);
        }

        void ReqCancel(Ctx c, P p)
        {
            var r = Req(p);
            RequireStatus(r, OpenRequest);
            CancelInternal(r, ActorName(c), p.Req("comment", "Reason", 1000));
            NotifyStaff(c, r, "cancelled", p.S("comment", 1000));
            Log(c, "Trip request cancelled", r.@ref);
        }

        void CancelInternal(TripRequest r, string actor, string reason)
        {
            var task = TaskById(r.taskId);
            if (task != null && task.status == "inProgress") throw new ApiError("The trip is already under way and cannot be cancelled.", "bad_state", 409);
            if (task != null && task.status == "scheduled") task.status = "cancelled";
            Transition(r, actor, "REQUEST_CANCELLED", "CANCELLED", reason);
        }

        void ReqClose(Ctx c, P p)
        {
            var r = Req(p);
            RequireStatus(r, "TRIP_COMPLETED");
            Transition(r, ActorName(c), "REQUEST_CLOSED", "CLOSED", p.S("comment", 1000));
            Log(c, "Trip request closed", r.@ref);
        }

        object CheckConflicts(P p)
        {
            var r = RequestById(p.S("id"));
            DateTime dep, ret;
            if (p.S("departTs") != null) { dep = U.ReqTs(p.S("departTs"), "Departure"); ret = U.ReqTs(p.Req("returnTs", "Return"), "Return"); }
            else { var rr = Must(r, "Trip request"); dep = U.ReqTs(rr.departTs, "Departure"); ret = U.ReqTs(rr.returnTs, "Return"); }
            return Conflicts(p.S("driverId"), p.S("vehicleId"), dep, ret, r == null ? null : r.id);
        }

        void ThrowIfConflicts(string driverId, string vehicleId, TripRequest r)
        {
            var list = Conflicts(driverId, vehicleId, U.ReqTs(r.departTs, "Departure"), U.ReqTs(r.returnTs, "Return"), r.id);
            if (list.Count > 0) throw new ApiError("Scheduling conflict", "conflict", 409, list);
        }

        // Human-readable reasons why this driver/vehicle is not free in [from, to].
        List<string> Conflicts(string driverId, string vehicleId, DateTime from, DateTime to, string excludeRequestId)
        {
            var list = new List<string>();
            if (driverId == null && vehicleId == null) return list;
            foreach (var r in D.requests)
            {
                if (r.id == excludeRequestId || !Committed.Contains(r.status)) continue;
                var a = U.ParseTs(r.departTs); var b = U.ParseTs(r.returnTs);
                if (a == null || b == null || !U.Overlaps(from, to, a.Value, b.Value)) continue;
                string rd = r.dispatchDriverId ?? r.proposedDriverId, rv = r.dispatchVehicleId ?? r.proposedVehicleId;
                string when = U.FmtLocal(r.departTs) + " - " + U.FmtLocal(r.returnTs);
                if (driverId != null && rd == driverId) list.Add("Driver is committed to " + r.@ref + " (" + r.destination + ", " + when + ").");
                else if (vehicleId != null && rv == vehicleId) list.Add("Vehicle is committed to " + r.@ref + " (" + r.destination + ", " + when + ").");
            }
            foreach (var t in D.tasks)
            {
                if (t.requestId != null || (t.status != "scheduled" && t.status != "inProgress")) continue;
                var at = U.ParseTs(t.scheduledTs);
                if (at == null) continue;
                bool inWindow = at.Value >= from.AddHours(-2) && at.Value <= to;
                if (!inWindow && t.status != "inProgress") continue;
                if (driverId != null && t.driverId == driverId) list.Add("Driver has task '" + t.purpose + "' at " + U.FmtLocal(t.scheduledTs) + (t.status == "inProgress" ? " (in progress)" : "") + ".");
                else if (vehicleId != null && t.vehicleId == vehicleId) list.Add("Vehicle has task '" + t.purpose + "' at " + U.FmtLocal(t.scheduledTs) + ".");
            }
            var d = DriverById(driverId);
            if (d != null)
            {
                var lic = U.ParseTs(d.licenceExpiry);
                if (lic != null && lic.Value < to) list.Add("Driver's licence expires " + d.licenceExpiry + ", before the trip ends.");
                if (d.contract != "active") list.Add("Driver's contract is " + d.contract + ".");
            }
            var v = VehicleById(vehicleId);
            if (v != null && v.condition != "ok") list.Add("Vehicle " + v.reg + " is " + (v.condition == "maintenance" ? "under maintenance" : "out of service") + ".");
            return list;
        }

        // ================================================================== system

        void Resend(Ctx c, P p)
        {
            var n = Must(D.notifications.FirstOrDefault(x => x.id == p.S("id")), "Notification");
            if (!SmtpConfigured) throw new ApiError("Email is not configured. Add SMTP details to server/config.json and restart the server.", "smtp_off", 400);
            n.status = "queued"; n.attempts = 0; n.error = null; n.nextTryTs = null;
            Mail.Wake();
            Log(c, "Email re-sent", n.subject);
        }

        void SmtpTest(Ctx c, P p)
        {
            string to = p.S("to", 200) ?? c.User.email;
            if (!SmtpConfigured) throw new ApiError("Email is not configured. Add SMTP details to server/config.json and restart the server.", "smtp_off", 400);
            Queue(to, c.User.name, null, "test", "SPIN-KN Fleet test email", "This is a test email from SPIN-KN Fleet. If you can read this, email is working.\n\n" + D.settings.orgName);
            Log(c, "Test email queued", to);
        }

        void SaveSettings(Ctx c, P p)
        {
            var s = D.settings;
            s.orgName = p.S("orgName", 120) ?? s.orgName;
            string url = p.S("publicBaseUrl", 200);
            if (url != null && !Regex.IsMatch(url, @"^https?://[^\s/]+(:\d+)?/?$")) throw new ApiError("Public address must look like http://192.168.1.10:3000", "bad_value", 400);
            s.publicBaseUrl = url == null ? "" : url.TrimEnd('/');
            var km = p.N("serviceIntervalKm");
            if (km.HasValue) { if (km.Value < 100) throw new ApiError("Service interval must be at least 100 km.", "bad_value", 400); s.serviceIntervalKm = km.Value; }
            var days = p.N("expiryWarnDays");
            if (days.HasValue) s.expiryWarnDays = Math.Max(1, Math.Min(365, (int)days.Value));
            s.defaultOrigin = p.S("defaultOrigin", 200) ?? s.defaultOrigin;
            var comps = ListOf(p, "components");
            if (comps != null) s.components = comps;
            var types = ListOf(p, "vehicleTypes");
            if (types != null) s.vehicleTypes = types;
            Log(c, "Settings updated", "");
        }

        static List<string> ListOf(P p, string k)
        {
            var raw = p.Raw(k) as System.Collections.IEnumerable;
            if (raw == null || raw is string) return null;
            var list = new List<string>();
            foreach (var o in raw) { var s = Convert.ToString(o, CultureInfo.InvariantCulture).Trim(); if (s.Length > 0 && s.Length <= 120) list.Add(s); }
            return list.Count == 0 ? null : list.Distinct().ToList();
        }

        void ClearDemo(Ctx c)
        {
            var demoDrivers = new HashSet<string>(D.drivers.Where(d => d.demo).Select(d => d.id));
            var demoUsers = new HashSet<string>(D.drivers.Where(d => d.demo).Select(d => d.userId));
            D.drivers.RemoveAll(d => d.demo);
            D.users.RemoveAll(u => demoUsers.Contains(u.id));
            D.credentials.RemoveAll(x => demoUsers.Contains(x.userId));
            D.sessions.RemoveAll(x => demoUsers.Contains(x.userId));
            var demoVehicles = new HashSet<string>(D.vehicles.Where(v => v.demo).Select(v => v.id));
            D.vehicles.RemoveAll(v => v.demo);
            foreach (var d in D.drivers) if (d.vehicleId != null && demoVehicles.Contains(d.vehicleId)) d.vehicleId = null;
            D.tasks.RemoveAll(t => t.demo || demoDrivers.Contains(t.driverId));
            D.trips.RemoveAll(t => t.demo || demoDrivers.Contains(t.driverId));
            D.fuel.RemoveAll(f => f.demo || demoVehicles.Contains(f.vehicleId));
            D.maintenance.RemoveAll(m => m.demo || demoVehicles.Contains(m.vehicleId));
            var demoReq = new HashSet<string>(D.requests.Where(r => r.demo).Select(r => r.id));
            D.requests.RemoveAll(r => r.demo);
            D.notifications.RemoveAll(n => n.requestId != null && demoReq.Contains(n.requestId));
            foreach (var r in D.requests)
            {
                if (r.proposedDriverId != null && demoDrivers.Contains(r.proposedDriverId)) r.proposedDriverId = null;
                if (r.proposedVehicleId != null && demoVehicles.Contains(r.proposedVehicleId)) r.proposedVehicleId = null;
            }
            Log(c, "Demo records removed", "Drivers, vehicles, trips, fuel and sample requests");
        }

        // ================================================================== driver (offline-capable)

        // Applies queued driver actions in order. Each carries a clientId so a
        // retried upload after a dropped connection is never applied twice.
        object DriverSync(Ctx c, P p)
        {
            var me = DriverForUser(c.User);
            if (me == null) throw new ApiError("Your account is not linked to a driver record.", "no_driver", 400);
            var results = new List<object>();
            foreach (var a in p.Objs("actions").Take(200))
            {
                string cid = a.S("clientId", 80);
                if (cid == null || !Regex.IsMatch(cid, @"^[A-Za-z0-9_-]{6,80}$")) { results.Add(Res(cid, false, "Invalid action id")); continue; }
                string key = "drv:" + me.id + ":" + cid;
                if (D.processed.Contains(key)) { results.Add(Res(cid, true, null)); continue; }
                try
                {
                    ApplyDriverAction(c, me, a.S("type"), a.Obj("payload") ?? new P(null), ClientTs(a.S("ts")), cid);
                    results.Add(Res(cid, true, null));
                }
                catch (ApiError e) { results.Add(Res(cid, false, e.Message)); }
                D.processed.Add(key);
            }
            return new Dictionary<string, object> { { "results", results } };
        }

        static Dictionary<string, object> Res(string id, bool ok, string err)
        {
            return new Dictionary<string, object> { { "clientId", id }, { "ok", ok }, { "error", err } };
        }

        // Offline actions keep the time they happened, within sane bounds.
        static string ClientTs(string ts)
        {
            var d = U.ParseTs(ts);
            var now = DateTime.UtcNow;
            if (d == null || d.Value > now.AddMinutes(5) || d.Value < now.AddDays(-14)) return U.Now();
            return U.Iso(d.Value);
        }

        void ApplyDriverAction(Ctx c, Driver me, string type, P p, string ts, string cid)
        {
            switch (type)
            {
                case "trip.start": StartTrip(c, me, p, ts, cid); break;
                case "trip.stop":
                    {
                        var t = MyActiveTrip(me, p.S("tripId"));
                        if (t.paused) throw new ApiError("This trip is already stopped.", "bad_state", 409);
                        t.paused = true;
                        t.stops.Add(new Stop { id = S.NewId("s"), startTs = ts, lat = p.N("lat"), lng = p.N("lng"), note = p.S("note", 300) });
                        var v = VehicleById(t.vehicleId);
                        Log(c, "Stop logged", (v == null ? "" : v.reg) + (p.S("note") == null ? "" : " · " + p.S("note", 300)));
                        break;
                    }
                case "trip.resume":
                    {
                        var t = MyActiveTrip(me, p.S("tripId"));
                        foreach (var s in t.stops.Where(s => s.endTs == null)) s.endTs = ts;
                        t.paused = false;
                        var v = VehicleById(t.vehicleId);
                        Log(c, "Trip resumed", v == null ? "" : v.reg);
                        break;
                    }
                case "trip.end":
                    {
                        var t = MyActiveTrip(me, p.S("tripId"));
                        double? odo = p.N("odo");
                        if (odo.HasValue && t.startOdo.HasValue && odo.Value < t.startOdo.Value)
                            throw new ApiError("End reading is lower than the start reading (" + t.startOdo.Value.ToString("N0") + " km).", "v_odoLow", 400);
                        if (odo.HasValue && odo.Value - (t.startOdo ?? odo.Value) > 3000)
                            throw new ApiError("That distance looks too long for one trip. Check the odometer reading.", "v_odoHigh", 400);
                        FinishTrip(c, t, ts, p.N("lat"), p.N("lng"), odo, p.S("notes", 1000), SaveInline(p.Obj("photo"), c.User.id));
                        var v = VehicleById(t.vehicleId);
                        Log(c, "Trip completed", v == null ? "" : v.reg);
                        break;
                    }
                case "fuel.add":
                    {
                        var v = Must(VehicleById(p.S("vehicleId") ?? me.vehicleId), "Vehicle");
                        if (v.id != me.vehicleId && !D.tasks.Any(t => t.driverId == me.id && t.vehicleId == v.id) && !D.trips.Any(t => t.driverId == me.id && t.vehicleId == v.id && t.status == "inTransit"))
                            throw new ApiError("You can only record fuel for a vehicle you are assigned to.", "forbidden", 403);
                        var rec = BuildFuel(p, v, me.id, "driver", ts, c.User.id);
                        D.fuel.Insert(0, rec);
                        Log(c, "Fuel recorded", v.reg + " · " + rec.litres + " L");
                        break;
                    }
                case "task.ack":
                    {
                        var t = Must(TaskById(p.S("taskId")), "Task");
                        if (t.driverId != me.id) throw new ApiError("This task is not assigned to you.", "forbidden", 403);
                        if (t.status == "cancelled") throw new ApiError("This task was cancelled by the office.", "bad_state", 409);
                        t.acknowledged = true; t.acknowledgedTs = ts;
                        Log(c, "Task acknowledged", t.purpose);
                        break;
                    }
                default: throw new ApiError("Unknown driver action.", "unknown_action", 400);
            }
        }

        Trip MyActiveTrip(Driver me, string tripId)
        {
            var t = Must(TripById(tripId), "Trip");
            if (t.driverId != me.id) throw new ApiError("This trip is not yours.", "forbidden", 403);
            if (t.status != "inTransit") throw new ApiError("This trip has already ended.", "bad_state", 409);
            return t;
        }

        void StartTrip(Ctx c, Driver me, P p, string ts, string cid)
        {
            if (D.trips.Any(t => t.driverId == me.id && t.status == "inTransit"))
                throw new ApiError("You already have a trip in progress.", "v_activeTrip", 409);
            TaskItem task = null;
            if (p.S("taskId") != null)
            {
                task = Must(TaskById(p.S("taskId")), "Task");
                if (task.driverId != me.id) throw new ApiError("This task is not assigned to you.", "forbidden", 403);
                if (task.status != "scheduled") throw new ApiError("This task is no longer open (it may have been cancelled).", "bad_state", 409);
            }
            string vid = (task == null ? null : task.vehicleId) ?? p.S("vehicleId") ?? me.vehicleId;
            if (vid == null) throw new ApiError("You need an assigned vehicle to start a trip.", "v_noVehicleTrip", 400);
            if (vid != me.vehicleId && (task == null || task.vehicleId != vid)) throw new ApiError("You can only drive a vehicle you are assigned to.", "forbidden", 403);
            var v = Must(VehicleById(vid), "Vehicle");
            if (v.condition != "ok") throw new ApiError(v.reg + " is marked as not in service. Contact the fleet office.", "bad_state", 409);
            if (D.trips.Any(t => t.vehicleId == v.id && t.status == "inTransit")) throw new ApiError(v.reg + " is already on another trip.", "bad_state", 409);
            double? odo = p.N("odo");
            CheckOdo(v, odo);

            string id = "t-" + cid;
            if (D.trips.Any(t => t.id == id)) id = S.NewId("t");
            var trip = new Trip
            {
                id = id, driverId = me.id, vehicleId = v.id, taskId = task == null ? null : task.id, requestId = task == null ? null : task.requestId,
                status = "inTransit", startTs = ts, startLat = p.N("lat"), startLng = p.N("lng"), startOdo = odo,
                startPhotoId = SaveInline(p.Obj("photo"), c.User.id), notes = p.S("notes", 1000)
            };
            D.trips.Insert(0, trip);
            if (task != null) { task.status = "inProgress"; task.tripId = trip.id; task.acknowledged = true; if (task.acknowledgedTs == null) task.acknowledgedTs = ts; }
            Log(c, task == null ? "Trip started" : "Trip initiated from task", v.reg + (task == null ? "" : " · " + task.purpose));
        }

        void FinishTrip(Ctx c, Trip t, string ts, double? lat, double? lng, double? odo, string notes, string photoId)
        {
            foreach (var s in t.stops.Where(s => s.endTs == null)) s.endTs = ts;
            t.status = "completed"; t.paused = false;
            t.endTs = ts; t.endLat = lat; t.endLng = lng; t.endOdo = odo; t.endPhotoId = photoId;
            if (!string.IsNullOrEmpty(notes)) t.notes = string.IsNullOrEmpty(t.notes) ? notes : t.notes + "\n" + notes;
            var task = TaskById(t.taskId);
            if (task != null && task.status == "inProgress") task.status = "completed";
            var r = RequestById(t.requestId ?? (task == null ? null : task.requestId));
            if (r != null && r.status == "DRIVER_ASSIGNED")
            {
                var d = DriverById(t.driverId);
                Transition(r, d == null ? ActorName(c) : d.name, "TRIP_COMPLETED", "TRIP_COMPLETED", "");
            }
        }
    }
}
