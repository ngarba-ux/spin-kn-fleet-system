using System;
using System.Linq;
using System.Net;
using System.Net.Mail;
using System.Text;
using System.Threading;

namespace SpinFleet
{
    // Background sender for queued notifications. Sending happens outside the
    // app lock so a slow SMTP server never blocks the web UI.
    public class Mailer
    {
        readonly App app;
        readonly AutoResetEvent signal = new AutoResetEvent(false);

        public Mailer(App app) { this.app = app; }

        public void Start()
        {
            var th = new Thread(Loop) { IsBackground = true, Name = "mailer" };
            th.Start();
        }

        public void Wake() { signal.Set(); }

        void Loop()
        {
            while (true)
            {
                signal.WaitOne(TimeSpan.FromSeconds(30));
                if (!app.SmtpConfigured) continue;
                while (true)
                {
                    Notification next;
                    lock (app.Lock)
                    {
                        var now = DateTime.UtcNow;
                        next = app.S.Db.notifications.LastOrDefault(n => n.status == "queued" && (n.nextTryTs == null || U.ParseTs(n.nextTryTs) <= now));
                        if (next == null) break;
                        next.status = "sending";
                    }
                    string error = Send(next);
                    lock (app.Lock)
                    {
                        next.attempts++;
                        if (error == null) { next.status = "sent"; next.sentTs = U.Now(); next.error = null; }
                        else if (next.attempts < 3) { next.status = "queued"; next.error = error; next.nextTryTs = U.Iso(DateTime.UtcNow.AddMinutes(2 * next.attempts)); }
                        else { next.status = "failed"; next.error = error; }
                        try { app.S.Save(); } catch (Exception e) { Console.WriteLine("Save failed after email: " + e.Message); }
                    }
                }
            }
        }

        string Send(Notification n)
        {
            var cfg = app.Cfg.smtp;
            try
            {
                using (var msg = new MailMessage())
                using (var client = new SmtpClient(cfg.host, cfg.port > 0 ? cfg.port : 587))
                {
                    msg.From = new MailAddress(cfg.from, string.IsNullOrEmpty(cfg.fromName) ? "SPIN-KN Fleet" : cfg.fromName);
                    msg.To.Add(new MailAddress(n.to, n.toName ?? ""));
                    msg.Subject = n.subject;
                    msg.Body = n.body;
                    msg.BodyEncoding = Encoding.UTF8;
                    msg.SubjectEncoding = Encoding.UTF8;
                    client.EnableSsl = cfg.enableSsl;
                    client.Timeout = 20000;
                    if (!string.IsNullOrEmpty(cfg.user)) client.Credentials = new NetworkCredential(cfg.user, cfg.password);
                    client.Send(msg);
                }
                return null;
            }
            catch (Exception e)
            {
                var inner = e.InnerException == null ? "" : " (" + e.InnerException.Message + ")";
                return e.Message + inner;
            }
        }
    }
}
