using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace SpinFleet
{
    // Endpoints for staff who arrive by scanning their QR card. The card token is
    // the credential: it identifies the staff member and can be revoked.
    public partial class App
    {
        public object Public(Ctx c, string type, P p)
        {
            switch (type)
            {
                case "lookup": return StaffHome(StaffByToken(c, p));
                case "status": return StatusView(p);
                case "submit": { var s = StaffByToken(c, p); var r = Submit(c, s, p, null); S.Save(); return new Dictionary<string, object> { { "ref", r.@ref }, { "statusToken", r.statusToken }, { "home", StaffHome(s) } }; }
                case "resubmit":
                    {
                        var s = StaffByToken(c, p);
                        var r = Must(D.requests.FirstOrDefault(x => x.id == p.S("id") && x.staffId == s.id), "Trip request");
                        RequireStatus(r, "RETURNED_FOR_CORRECTION");
                        Submit(c, s, p, r);
                        S.Save();
                        return new Dictionary<string, object> { { "ref", r.@ref }, { "statusToken", r.statusToken }, { "home", StaffHome(s) } };
                    }
                case "cancel":
                    {
                        var s = StaffByToken(c, p);
                        var r = Must(D.requests.FirstOrDefault(x => x.id == p.S("id") && x.staffId == s.id), "Trip request");
                        RequireStatus(r, OpenRequest);
                        string reason = p.S("reason", 500) ?? "Cancelled by requester";
                        CancelInternal(r, s.fullName, reason);
                        NotifyStaff(c, r, "cancelled", reason);
                        Log(c, "Trip request cancelled by staff", r.@ref + " · " + s.fullName);
                        S.Save();
                        return StaffHome(s);
                    }
            }
            throw new ApiError("Unknown request.", "unknown_action", 400);
        }

        Staff StaffByToken(Ctx c, P p)
        {
            string raw = p.S("token", 400);
            if (raw == null) throw new ApiError("This QR / token was not recognised.", "invalidToken", 404);
            // Accept a pasted link as well as the bare token.
            var m = Regex.Match(raw, @"(?:[?#&]s=|token[=:])\s*([\w-]+)", RegexOptions.IgnoreCase);
            string token = m.Success ? m.Groups[1].Value : raw;
            CheckThrottle("tok:" + c.Ip, 30);
            var s = D.staff.FirstOrDefault(x => x.qrToken == token);
            if (s == null) { RecordFailure("tok:" + c.Ip); throw new ApiError("This QR / token was not recognised.", "invalidToken", 404); }
            if (s.qrStatus != "active") throw new ApiError("This QR code has been revoked. Contact the fleet office.", "revokedToken", 403);
            if (s.status != "active") throw new ApiError("This staff account is not active.", "inactiveStaff", 403);
            return s;
        }

        object StaffHome(Staff s)
        {
            var mine = D.requests.Where(r => r.staffId == s.id).OrderByDescending(r => r.createdTs).Take(25).Select(r => new Dictionary<string, object> {
                { "id", r.id }, { "ref", r.@ref }, { "status", r.status }, { "purpose", r.purpose }, { "destination", r.destination },
                { "departTs", r.departTs }, { "returnTs", r.returnTs }, { "createdTs", r.createdTs }, { "statusToken", r.statusToken },
                { "canCancel", OpenRequest.Contains(r.status) && !(TaskById(r.taskId) != null && TaskById(r.taskId).status == "inProgress") },
                { "canEdit", r.status == "RETURNED_FOR_CORRECTION" },
                { "returnReason", r.status == "RETURNED_FOR_CORRECTION" ? LastComment(r, "RETURNED_FOR_CORRECTION") : null },
                // Full form values so a returned request can be corrected.
                { "form", r.status == "RETURNED_FOR_CORRECTION" ? (object)new Dictionary<string, object> {
                    { "purpose", r.purpose }, { "component", r.component }, { "destination", r.destination }, { "departTs", r.departTs },
                    { "returnTs", r.returnTs }, { "passengers", r.passengers }, { "passengerList", r.passengerList }, { "vehicle", r.vehicle },
                    { "priority", r.priority }, { "urgentReason", r.urgentReason }, { "assignment", r.assignment }, { "remarks", r.remarks } } : null }
            }).ToList();
            return new Dictionary<string, object> {
                { "staff", new Dictionary<string, object> {
                    { "fullName", s.fullName }, { "designation", s.designation }, { "unit", s.unit }, { "unitCode", s.unitCode },
                    { "email", s.email }, { "employeeNo", s.employeeNo }, { "staffNo", s.staffNo } } },
                { "requests", mine },
                { "options", new Dictionary<string, object> { { "components", D.settings.components }, { "vehicleTypes", D.settings.vehicleTypes } } },
                { "orgName", D.settings.orgName }
            };
        }

        static string LastComment(TripRequest r, string action)
        {
            var h = r.history.LastOrDefault(x => x.action == action);
            return h == null ? null : h.comment;
        }

        TripRequest Submit(Ctx c, Staff s, P p, TripRequest existing)
        {
            // The key is only recorded once validation passes, so fixing a rejected
            // form and sending it again is not mistaken for a double submit.
            string sub = p.S("submissionId", 80);
            string subKey = existing == null && sub != null ? "sub:" + sub : null;
            if (subKey != null && D.processed.Contains(subKey)) throw new ApiError("This request was already submitted.", "dupGuard", 409);

            string purpose = p.Req("purpose", "Trip purpose", 500);
            string destination = p.Req("destination", "Destination", 300);
            string component = p.Req("component", "Project component", 150);
            var dep = U.ReqTs(p.Req("departTs", "Departure"), "Departure");
            var ret = U.ReqTs(p.Req("returnTs", "Expected return"), "Expected return");
            if (ret < dep) throw new ApiError("Return must be on or after departure.", "v_returnBeforeDeparture", 400);
            if (dep < DateTime.UtcNow.AddHours(-2)) throw new ApiError("Departure cannot be in the past.", "v_date", 400);
            if (dep > DateTime.UtcNow.AddYears(1)) throw new ApiError("Departure is too far in the future.", "v_date", 400);
            var pax = p.N("passengers");
            if (!pax.HasValue || pax.Value < 1 || pax.Value > 60 || pax.Value != Math.Floor(pax.Value)) throw new ApiError("Enter a valid number of passengers.", "v_passengers", 400);
            string priority = U.OneOf(p.S("priority") ?? "normal", "Priority", "normal", "urgent");
            string urgentReason = p.S("urgentReason", 500);
            if (priority == "urgent" && urgentReason == null) throw new ApiError("A justification is required for urgent requests.", "v_urgentReason", 400);
            var list = p.Objs("passengerList").Take(60).Select(x => new Passenger { name = x.S("name", 120), org = x.S("org", 120) ?? "" }).Where(x => x.name != null).ToList();

            var r = existing ?? new TripRequest();
            r.purpose = purpose; r.destination = destination; r.component = component;
            r.departTs = U.Iso(dep); r.returnTs = U.Iso(ret);
            r.passengers = (int)pax.Value; r.passengerList = list;
            r.vehicle = p.S("vehicle", 120) ?? "Any available vehicle";
            r.priority = priority; r.urgentReason = priority == "urgent" ? urgentReason : "";
            r.assignment = p.S("assignment", 500) ?? ""; r.remarks = p.S("remarks", 1000) ?? "";
            string doc = SaveInline(p.Obj("doc"), "staff:" + s.id);
            if (doc != null) r.docId = doc;
            if (subKey != null) D.processed.Add(subKey);

            if (existing == null)
            {
                D.requestSeq++;
                r.id = S.NewId("req");
                r.@ref = "TR-" + U.LocalNow().Year + "-" + D.requestSeq.ToString("000000");
                r.statusToken = "st_" + U.RandomToken(18).Replace("-", "x").Replace("_", "y");
                r.staffId = s.id;
                r.status = "DRAFT";
                r.createdTs = U.Now();
                Transition(r, s.fullName, "TRIP_REQUEST_SUBMITTED", "SUBMITTED", "");
                D.requests.Insert(0, r);
                NotifyStaff(c, r, "submitted", null);
                NotifyRole(c, "admin", r, "New trip request " + r.@ref + (priority == "urgent" ? " (URGENT)" : ""), "A new trip request has been submitted.");
                Log(c, "Trip request submitted", r.@ref + " · " + s.fullName);
            }
            else
            {
                Transition(r, s.fullName, "TRIP_REQUEST_RESUBMITTED", "SUBMITTED", "Corrected and resubmitted");
                NotifyStaff(c, r, "submitted", null);
                NotifyRole(c, "admin", r, "Trip request " + r.@ref + " resubmitted", "A returned trip request has been corrected and resubmitted.");
                Log(c, "Trip request resubmitted", r.@ref + " · " + s.fullName);
            }
            return r;
        }

        object StatusView(P p)
        {
            string tok = p.S("statusToken", 100);
            var r = tok == null ? null : D.requests.FirstOrDefault(x => x.statusToken == tok);
            if (r == null) throw new ApiError("We could not find that request. Check the link and try again.", "not_found", 404);
            var s = StaffById(r.staffId);
            var d = DriverById(r.dispatchDriverId);
            var v = VehicleById(r.dispatchVehicleId);
            // Admin remarks and internal steps stay internal; only staff-relevant events are shown.
            var visible = new HashSet<string> { "TRIP_REQUEST_SUBMITTED", "TRIP_REQUEST_RESUBMITTED", "ADMIN_ACKNOWLEDGED", "ADMIN_REVIEWED", "FORWARDED_TO_SPC", "RETURNED_FOR_CORRECTION", "SPC_APPROVED", "SPC_REJECTED", "TRIP_RESCHEDULED", "DRIVER_ASSIGNED", "REQUEST_CANCELLED", "TRIP_COMPLETED", "REQUEST_CLOSED" };
            var withNote = new HashSet<string> { "RETURNED_FOR_CORRECTION", "SPC_REJECTED", "TRIP_RESCHEDULED", "REQUEST_CANCELLED" };
            var active = D.trips.FirstOrDefault(t => t.id == (TaskById(r.taskId) == null ? null : TaskById(r.taskId).tripId));
            return new Dictionary<string, object> {
                { "ref", r.@ref }, { "status", r.status }, { "purpose", r.purpose }, { "destination", r.destination }, { "component", r.component },
                { "departTs", r.departTs }, { "returnTs", r.returnTs }, { "passengers", r.passengers }, { "priority", r.priority }, { "createdTs", r.createdTs },
                { "staffName", s == null ? "" : s.fullName },
                { "timeline", r.history.Where(h => visible.Contains(h.action)).Select(h => new Dictionary<string, object> {
                    { "action", h.action }, { "ts", h.ts }, { "note", withNote.Contains(h.action) ? h.comment : "" } }).ToList() },
                { "driver", d == null || (r.status != "DRIVER_ASSIGNED" && r.status != "TRIP_COMPLETED") ? null : new Dictionary<string, object> { { "name", d.name }, { "phone", d.phone } } },
                { "vehicle", v == null || (r.status != "DRIVER_ASSIGNED" && r.status != "TRIP_COMPLETED") ? null : new Dictionary<string, object> { { "reg", v.reg }, { "model", v.model }, { "colour", v.colour } } },
                { "tripStatus", active == null ? null : active.status },
                { "orgName", D.settings.orgName }
            };
        }
    }
}
