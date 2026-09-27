using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace SpinFleet
{
    public class ApiError : Exception
    {
        public int Status;
        public string Code;
        public object Details;
        public ApiError(string message, string code, int status) : base(message) { Code = code; Status = status; }
        public ApiError(string message, string code, int status, object details) : this(message, code, status) { Details = details; }
    }

    // Read-only accessor over a JSON object sent by the browser.
    public class P
    {
        readonly IDictionary<string, object> d;
        public P(IDictionary<string, object> dict) { d = dict ?? new Dictionary<string, object>(); }

        public bool Has(string k) { return d.ContainsKey(k) && d[k] != null; }

        public object Raw(string k) { object v; return d.TryGetValue(k, out v) ? v : null; }

        public string S(string k) { return S(k, 2000); }

        public string S(string k, int maxLen)
        {
            object v = Raw(k);
            if (v == null) return null;
            string s = Convert.ToString(v, CultureInfo.InvariantCulture).Trim();
            if (s.Length == 0) return null;
            if (s.Length > maxLen) throw new ApiError("A field is too long (" + k + ").", "too_long", 400);
            return s;
        }

        public string Req(string k, string label) { return Req(k, label, 2000); }

        public string Req(string k, string label, int maxLen)
        {
            string s = S(k, maxLen);
            if (s == null) throw new ApiError(label + " is required.", "required", 400, k);
            return s;
        }

        public double? N(string k)
        {
            object v = Raw(k);
            if (v == null) return null;
            if (v is string)
            {
                string s = ((string)v).Trim().Replace(",", "");
                if (s.Length == 0) return null;
                double r;
                if (!double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out r)) throw new ApiError("'" + k + "' must be a number.", "not_number", 400, k);
                return r;
            }
            try { return Convert.ToDouble(v, CultureInfo.InvariantCulture); }
            catch { throw new ApiError("'" + k + "' must be a number.", "not_number", 400, k); }
        }

        public bool B(string k)
        {
            object v = Raw(k);
            if (v == null) return false;
            if (v is bool) return (bool)v;
            string s = Convert.ToString(v, CultureInfo.InvariantCulture).ToLowerInvariant();
            return s == "true" || s == "1" || s == "yes";
        }

        public P Obj(string k)
        {
            var v = Raw(k) as IDictionary<string, object>;
            return v == null ? null : new P(v);
        }

        public List<P> Objs(string k)
        {
            var list = new List<P>();
            var arr = Raw(k) as IEnumerable;
            if (arr == null || Raw(k) is string) return list;
            foreach (var o in arr)
            {
                var dict = o as IDictionary<string, object>;
                if (dict != null) list.Add(new P(dict));
            }
            return list;
        }
    }

    public static class U
    {
        public static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 256 };
        static readonly RandomNumberGenerator Rng = RandomNumberGenerator.Create();
        public static TimeZoneInfo Zone = TimeZoneInfo.Utc;

        public static string Now() { return Iso(DateTime.UtcNow); }

        public static string Iso(DateTime utc) { return utc.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture); }

        public static DateTime? ParseTs(string s)
        {
            if (string.IsNullOrEmpty(s)) return null;
            DateTime d;
            if (DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out d)) return d;
            return null;
        }

        public static DateTime ReqTs(string s, string label)
        {
            var d = ParseTs(s);
            if (d == null) throw new ApiError(label + " is not a valid date/time.", "bad_date", 400);
            return d.Value;
        }

        // Accepts yyyy-MM-dd only (licence/insurance expiry dates).
        public static string DateOnly(string s, string label)
        {
            if (string.IsNullOrEmpty(s)) return null;
            DateTime d;
            if (!DateTime.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d))
                throw new ApiError(label + " must be a date (YYYY-MM-DD).", "bad_date", 400);
            return s;
        }

        public static DateTime LocalNow() { return TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Zone); }

        public static string FmtLocal(string iso)
        {
            var d = ParseTs(iso);
            if (d == null) return "-";
            return TimeZoneInfo.ConvertTimeFromUtc(d.Value, Zone).ToString("ddd d MMM yyyy, HH:mm", CultureInfo.InvariantCulture);
        }

        public static byte[] RandomBytes(int n) { var b = new byte[n]; Rng.GetBytes(b); return b; }

        public static string RandomToken(int bytes)
        {
            return Convert.ToBase64String(RandomBytes(bytes)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        // Unambiguous alphanumerics for passwords people have to type.
        public static string TempPassword()
        {
            const string chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
            var b = RandomBytes(10);
            var sb = new StringBuilder();
            foreach (var x in b) sb.Append(chars[x % chars.Length]);
            return sb.ToString();
        }

        public static string Sha256(string s)
        {
            using (var h = SHA256.Create())
            {
                var bytes = h.ComputeHash(Encoding.UTF8.GetBytes(s));
                var sb = new StringBuilder();
                foreach (var x in bytes) sb.Append(x.ToString("x2"));
                return sb.ToString();
            }
        }

        public static Credential HashPassword(string userId, string password)
        {
            var salt = RandomBytes(16);
            const int iter = 120000;
            using (var kdf = new Rfc2898DeriveBytes(password, salt, iter, HashAlgorithmName.SHA256))
            {
                return new Credential { userId = userId, salt = Convert.ToBase64String(salt), hash = Convert.ToBase64String(kdf.GetBytes(32)), iterations = iter };
            }
        }

        public static bool VerifyPassword(Credential c, string password)
        {
            if (c == null || password == null) return false;
            using (var kdf = new Rfc2898DeriveBytes(password, Convert.FromBase64String(c.salt), c.iterations, HashAlgorithmName.SHA256))
            {
                var got = kdf.GetBytes(32);
                var want = Convert.FromBase64String(c.hash);
                if (got.Length != want.Length) return false;
                int diff = 0;
                for (int i = 0; i < got.Length; i++) diff |= got[i] ^ want[i];
                return diff == 0;
            }
        }

        public static void ValidatePassword(string pw)
        {
            if (pw == null || pw.Length < 8) throw new ApiError("Password must be at least 8 characters.", "weak_password", 400);
            if (pw.Length > 200) throw new ApiError("Password is too long.", "weak_password", 400);
        }

        public static bool LooksLikeEmail(string s)
        {
            if (string.IsNullOrEmpty(s)) return false;
            int at = s.IndexOf('@');
            return at > 0 && at == s.LastIndexOf('@') && s.IndexOf('.', at) > at + 1 && s.IndexOf(' ') < 0 && !s.EndsWith(".");
        }

        public static bool Overlaps(DateTime aStart, DateTime aEnd, DateTime bStart, DateTime bEnd)
        {
            return aStart <= bEnd && bStart <= aEnd;
        }

        public static string OneOf(string v, string label, params string[] allowed)
        {
            if (v == null) return null;
            foreach (var a in allowed) if (a == v) return v;
            throw new ApiError(label + " has an invalid value.", "bad_value", 400);
        }
    }
}
