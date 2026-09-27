using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

namespace SpinFleet
{
    public class HttpServer
    {
        readonly App app;
        HttpListener listener = new HttpListener();
        public string ListeningOn;
        public bool NetworkMode;

        static readonly Dictionary<string, string> Mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
            { ".html", "text/html; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" }, { ".css", "text/css; charset=utf-8" },
            { ".json", "application/json; charset=utf-8" }, { ".webmanifest", "application/manifest+json" }, { ".png", "image/png" },
            { ".jpg", "image/jpeg" }, { ".svg", "image/svg+xml" }, { ".ico", "image/x-icon" }, { ".woff2", "font/woff2" } };

        public HttpServer(App app) { this.app = app; }

        // Binding to all interfaces (so phones on the office Wi-Fi can connect)
        // needs a one-time URL reservation; fall back to localhost without it.
        public void Start()
        {
            int port = app.Cfg.port;
            if (app.Cfg.listenOnNetwork)
            {
                try
                {
                    listener.Prefixes.Add("http://+:" + port + "/");
                    listener.Start();
                    ListeningOn = "http://+:" + port + "/";
                    NetworkMode = true;
                }
                catch (HttpListenerException)
                {
                    // A failed Start() disposes the listener.
                    listener = new HttpListener();
                }
            }
            if (!NetworkMode)
            {
                listener.Prefixes.Add("http://localhost:" + port + "/");
                listener.Start();
                ListeningOn = "http://localhost:" + port + "/";
            }
            var th = new Thread(AcceptLoop) { IsBackground = true, Name = "http-accept" };
            th.Start();
        }

        void AcceptLoop()
        {
            while (listener.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = listener.GetContext(); }
                catch { if (!listener.IsListening) return; continue; }
                ThreadPool.QueueUserWorkItem(_ => Handle(ctx));
            }
        }

        void Handle(HttpListenerContext hc)
        {
            var req = hc.Request;
            var res = hc.Response;
            int status = 200;
            try
            {
                res.Headers["X-Content-Type-Options"] = "nosniff";
                res.Headers["X-Frame-Options"] = "DENY";
                res.Headers["Referrer-Policy"] = "no-referrer";
                string path = req.Url.AbsolutePath;
                if (path.StartsWith("/api/", StringComparison.Ordinal)) status = HandleApi(hc, path);
                else status = ServeStatic(hc, path);
            }
            catch (Exception e)
            {
                status = 500;
                Console.WriteLine("[" + DateTime.Now.ToString("HH:mm:ss") + "] ERROR " + req.HttpMethod + " " + req.Url.AbsolutePath + ": " + e);
                try { WriteJson(res, 500, new Dictionary<string, object> { { "error", "Something went wrong on the server." }, { "code", "server_error" } }); } catch { }
            }
            finally
            {
                try { res.Close(); } catch { }
            }
            if (status >= 400 && status != 401) Console.WriteLine("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + req.HttpMethod + " " + req.Url.AbsolutePath + " -> " + status);
        }

        int HandleApi(HttpListenerContext hc, string path)
        {
            var req = hc.Request;
            var res = hc.Response;
            res.Headers["Cache-Control"] = "no-store";
            var c = new Ctx { Ip = req.RemoteEndPoint == null ? "?" : req.RemoteEndPoint.Address.ToString(), BaseUrl = req.Url.GetLeftPart(UriPartial.Authority) };
            try
            {
                if (req.HttpMethod == "POST")
                {
                    // Cross-site forms cannot set custom headers, so this blocks CSRF.
                    if (req.Headers["X-Requested-With"] != "spin-fleet") throw new ApiError("Bad request.", "csrf", 400);
                    if (req.ContentLength64 > 12 * 1024 * 1024) throw new ApiError("Upload is too large.", "too_large", 413);
                }
                P body = null;
                if (req.HttpMethod == "POST")
                {
                    string text;
                    using (var rd = new StreamReader(req.InputStream, Encoding.UTF8)) text = rd.ReadToEnd();
                    body = new P(text.Length == 0 ? null : U.Json.Deserialize<Dictionary<string, object>>(text));
                }

                object result;
                string token = req.Cookies["sid"] == null ? null : req.Cookies["sid"].Value;
                lock (app.Lock)
                {
                    app.Authenticate(c, token);
                    try { result = Route(hc, c, path, body); }
                    catch
                    {
                        if (req.HttpMethod == "POST") app.Rollback();
                        throw;
                    }
                    if (result == null) return 200;   // Route already wrote a file response
                }
                if (c.SetCookie != null) res.Headers.Add("Set-Cookie", c.SetCookie);
                WriteJson(res, 200, result);
                return 200;
            }
            catch (ApiError e)
            {
                if (c.SetCookie != null) res.Headers.Add("Set-Cookie", c.SetCookie);
                var err = new Dictionary<string, object> { { "error", e.Message }, { "code", e.Code } };
                if (e.Details != null) err["details"] = e.Details;
                WriteJson(res, e.Status, err);
                return e.Status;
            }
            catch (ArgumentException)
            {
                WriteJson(res, 400, new Dictionary<string, object> { { "error", "The request could not be read." }, { "code", "bad_json" } });
                return 400;
            }
            catch (InvalidOperationException)
            {
                WriteJson(res, 400, new Dictionary<string, object> { { "error", "The request could not be read." }, { "code", "bad_json" } });
                return 400;
            }
        }

        // Runs under the app lock. Returns the JSON result, or null when it has
        // already streamed a file to the response.
        // Runs under the app lock. Returns the JSON result, or null when it has
        // already streamed a file to the response.
        object Route(HttpListenerContext hc, Ctx c, string path, P body)
        {
            var req = hc.Request;
            var res = hc.Response;
            switch (req.HttpMethod + " " + path)
            {
                case "GET /api/health": return new Dictionary<string, object> { { "ok", true }, { "time", U.Now() } };
                case "POST /api/login": return app.Login(c, body);
                case "POST /api/logout": return app.Logout(c);
                case "GET /api/state": return app.State(c);
                case "POST /api/action": return app.Action(c, body.Req("type", "Action"), body.Obj("data") ?? new P(null));
                case "POST /api/public": return app.Public(c, body.Req("type", "Action"), body.Obj("data") ?? new P(null));
            }
            if (req.HttpMethod == "GET" && path.StartsWith("/api/files/", StringComparison.Ordinal))
            {
                var f = app.GetUpload(c, path.Substring("/api/files/".Length));
                res.ContentType = f.Item1.mime;
                res.Headers["Content-Disposition"] = "inline; filename=\"" + f.Item1.name.Replace("\"", "") + "\"";
                res.Headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; plugin-types application/pdf";
                WriteBytes(res, File.ReadAllBytes(f.Item2));
                return null;
            }
            if (req.HttpMethod == "GET" && path == "/api/backup")
            {
                if (c.User == null || c.User.role != "admin") throw new ApiError("Your account is not allowed to do that.", "forbidden", 403);
                res.ContentType = "application/json";
                res.Headers["Content-Disposition"] = "attachment; filename=\"spin-kn-fleet-backup-" + U.LocalNow().ToString("yyyy-MM-dd-HHmm") + ".json\"";
                WriteBytes(res, Encoding.UTF8.GetBytes(U.Json.Serialize(app.S.Db)));
                return null;
            }
            throw new ApiError("Not found.", "not_found", 404);
        }

        static void WriteBytes(HttpListenerResponse res, byte[] bytes)
        {
            res.ContentLength64 = bytes.Length;
            res.OutputStream.Write(bytes, 0, bytes.Length);
        }

        static void WriteJson(HttpListenerResponse res, int status, object obj)
        {
            var bytes = Encoding.UTF8.GetBytes(U.Json.Serialize(obj));
            res.StatusCode = status;
            res.ContentType = "application/json; charset=utf-8";
            res.ContentLength64 = bytes.Length;
            res.OutputStream.Write(bytes, 0, bytes.Length);
        }

        int ServeStatic(HttpListenerContext hc, string path)
        {
            var req = hc.Request;
            var res = hc.Response;
            if (req.HttpMethod != "GET" && req.HttpMethod != "HEAD") { res.StatusCode = 405; return 405; }
            if (path == "/" || path == "") path = "/index.html";
            string root = Path.GetFullPath(app.PublicDir);
            string full;
            try { full = Path.GetFullPath(Path.Combine(root, Uri.UnescapeDataString(path).TrimStart('/').Replace('/', Path.DirectorySeparatorChar))); }
            catch { res.StatusCode = 400; return 400; }
            if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
            {
                // Unknown paths get the app shell so deep links still load.
                if (Path.GetExtension(path).Length > 0) { res.StatusCode = 404; return 404; }
                full = Path.Combine(root, "index.html");
            }
            var info = new FileInfo(full);
            string etag = "\"" + info.LastWriteTimeUtc.Ticks.ToString("x", CultureInfo.InvariantCulture) + "-" + info.Length.ToString("x", CultureInfo.InvariantCulture) + "\"";
            string ext = Path.GetExtension(full);
            string mime;
            res.ContentType = Mime.TryGetValue(ext, out mime) ? mime : "application/octet-stream";
            res.Headers["ETag"] = etag;
            res.Headers["Cache-Control"] = "no-cache";
            if (ext == ".html")
                res.Headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
            if (req.Headers["If-None-Match"] == etag) { res.StatusCode = 304; return 304; }
            var bytes = File.ReadAllBytes(full);
            res.ContentLength64 = bytes.Length;
            if (req.HttpMethod == "GET") res.OutputStream.Write(bytes, 0, bytes.Length);
            return 200;
        }
    }

    public static class Program
    {
        public static void Run(string root)
        {
            Console.OutputEncoding = Encoding.UTF8;
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            string cfgPath = Path.Combine(root, "server", "config.json");
            var cfg = File.Exists(cfgPath) ? U.Json.Deserialize<Config>(File.ReadAllText(cfgPath, Encoding.UTF8)) : new Config();
            if (cfg.smtp == null) cfg.smtp = new SmtpConfig();

            var app = new App(cfg, root);
            app.Mail = new Mailer(app);
            app.Mail.Start();
            var server = new HttpServer(app);
            server.Start();

            Console.WriteLine();
            Console.WriteLine("  SPIN-KN Fleet is running.");
            Console.WriteLine("  On this computer:  http://localhost:" + cfg.port + "/");
            if (server.NetworkMode)
            {
                foreach (var ip in LocalAddresses()) Console.WriteLine("  On the network:    http://" + ip + ":" + cfg.port + "/");
            }
            else if (cfg.listenOnNetwork)
            {
                Console.WriteLine("  Network access is OFF (phones cannot connect yet).");
                Console.WriteLine("  To enable it, run enable-network-access.bat once as Administrator.");
            }
            Console.WriteLine("  Email: " + (app.SmtpConfigured ? "SMTP " + cfg.smtp.host : "not configured (emails are logged only) - see server/config.json"));
            if (app.S.FirstRunNote != null) { Console.WriteLine(); Console.WriteLine("  " + app.S.FirstRunNote.Replace("\n", "\n  ")); }
            Console.WriteLine();
            Console.WriteLine("  Keep this window open. Press Ctrl+C to stop.");
            Console.WriteLine();
        }

        static IEnumerable<string> LocalAddresses()
        {
            var list = new List<string>();
            try
            {
                foreach (var a in Dns.GetHostAddresses(Dns.GetHostName()))
                    if (a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork && !IPAddress.IsLoopback(a)) list.Add(a.ToString());
            }
            catch { }
            return list;
        }
    }
}
