// Video Intelligence launcher: the file you open. A small window (never a console) that finds Node.js or installs a
// private copy (checksum-verified, no admin), restarts a server whose code changed since it started, starts server.mjs
// hidden, and opens the app window. --background (used by video-intel://) starts the server without opening the app.
// The window only appears when there is something to do; an up-to-date running server just opens the app.
// Windows ships this compiler (C# 5, so no newer syntax). Rebuild after editing:
//   %WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /win32icon:icon.ico /r:System.IO.Compression.FileSystem.dll "/out:Video Intelligence.exe" launcher.cs
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

class Launcher : Form {
  const string Url = "http://localhost:8000/", Health = "http://127.0.0.1:8000/api/health";
  const int MinNode = 18, W = 480, H = 204;
  static readonly string Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\'), Rt = Path.Combine(Root, ".runtime");
  static Color C(string hex) { return ColorTranslator.FromHtml(hex); }
  static readonly Color Bg = C("#121211"), Line = C("#2a2926"), Ink = C("#ebe6da"), Ink2 = C("#b3ad9f"), Muted = C("#7f7a6f"), Accent = C("#e0a84f"), Err = C("#d9715f");

  readonly bool background;
  readonly float s;                                    // DPI scale; everything is laid out in 96-dpi pixels
  readonly Font fBrand, fTitle, fBody, fMono, fLink;
  static readonly Icon icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
  volatile string title = "Starting Video Intelligence", status = "Checking the local server", detail = "";
  volatile bool failed;
  double progress = -1;                                // 0..1, or -1 while the length of a step is unknown
  float phase;
  PointF mouse;
  RectangleF closeHit = new RectangleF(W - 44, 14, 30, 30), logHit, quitHit;

  [STAThread]
  static void Main(string[] args) {
    ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
    bool bg = Array.IndexOf(args, "--background") >= 0;
    if (args.Length == 2 && args[0] == "--preview") { Preview(args[1]); return; }
    string h = Get(Health);
    if (h != null && h.Contains("\"stale\":false")) { if (!bg) OpenApp(); return; }
    SetProcessDPIAware();
    Application.Run(new Launcher(bg));
  }

  Launcher(bool bg) {
    background = bg;
    using (var g = CreateGraphics()) s = g.DpiX / 96f;
    fBrand = Pick(12.5f, FontStyle.Bold, "Segoe UI Variable Text", "Segoe UI Semibold", "Segoe UI");
    fTitle = Pick(21f, FontStyle.Bold, "Segoe UI Variable Display", "Segoe UI");
    fBody = Pick(13.5f, FontStyle.Regular, "Segoe UI Variable Text", "Segoe UI");
    fMono = Pick(11.5f, FontStyle.Regular, "Cascadia Mono", "Consolas");
    fLink = Pick(13f, FontStyle.Bold, "Segoe UI Variable Text", "Segoe UI Semibold", "Segoe UI");
    Text = "Video Intelligence"; Icon = icon;
    FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.CenterScreen;
    ClientSize = new Size((int)(W * s), (int)(H * s)); BackColor = Bg; DoubleBuffered = true;
    var t = new System.Windows.Forms.Timer { Interval = 16 };
    t.Tick += delegate { phase += 0.012f; Invalidate(); };
    t.Start();
  }

  protected override void OnHandleCreated(EventArgs e) {
    base.OnHandleCreated(e);
    int round = 2, border = Line.R | Line.G << 8 | Line.B << 16;   // Windows 11: rounded corners and a hairline border
    DwmSetWindowAttribute(Handle, 33, ref round, 4);
    DwmSetWindowAttribute(Handle, 34, ref border, 4);
  }

  protected override void OnShown(EventArgs e) {
    base.OnShown(e);
    new Thread(Work) { IsBackground = true }.Start();
  }

  // ---------- the work (background thread) ----------
  void Work() {
    try {
      if (Get(Health) != null) {
        Step("Restarting the updated server", "The code changed since it started.");
        StopListener();
      } else if (ListenerPid() != 0) throw new Exception("Port 8000 is used by another program. Close it, then open Video Intelligence again.");
      string node = FindNode() ?? InstallNode();
      RegisterProtocol();
      Step("Starting the local server", "");
      Directory.CreateDirectory(Rt);
      var psi = new ProcessStartInfo(node, "server.mjs") { WorkingDirectory = Root, UseShellExecute = false, CreateNoWindow = true };
      psi.EnvironmentVariables["PORT"] = "8000";
      psi.EnvironmentVariables["VI_IDLE_EXIT"] = "180000";
      psi.EnvironmentVariables["VI_LOG"] = Path.Combine(Rt, "server.log");
      Process.Start(psi);
      for (int i = 0; i < 75 && Get(Health) == null; i++) Thread.Sleep(200);
      if (Get(Health) == null) throw new Exception("The server did not start. The log has the details.");
      if (!background) { Step("Opening the app", ""); OpenApp(); }
      Thread.Sleep(300);
      BeginInvoke((MethodInvoker)Close);
    } catch (Exception ex) {
      title = "Couldn't start"; status = (ex.InnerException ?? ex).Message; detail = ""; failed = true;
    }
  }

  void Step(string st, string d) { status = st; detail = d; progress = -1; }

  static string FindNode() {
    var list = new System.Collections.Generic.List<string>();
    foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';')) if (dir.Trim() != "") list.Add(Path.Combine(dir.Trim(), "node.exe"));
    list.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"));
    list.Add(Path.Combine(Rt, "node", "node.exe"));
    foreach (var p in list) {
      try {
        if (!File.Exists(p)) continue;
        var m = Regex.Match(Run(p, "--version"), @"^v(\d+)");
        if (m.Success && int.Parse(m.Groups[1].Value) >= MinNode) return p;
      } catch { }
    }
    return null;
  }

  // Portable Node LTS into .runtime\node, verified against nodejs.org's SHASUMS256.txt before anything is unpacked.
  string InstallNode() {
    Step("Installing Node.js", "Looking up the current LTS release");
    var wc = new WebClient();
    var v = Regex.Match(wc.DownloadString("https://nodejs.org/dist/index.json"), "\\{\"version\":\"(v[\\d.]+)\"[^{}]*?\"lts\":\"").Groups[1].Value;
    if (v == "") throw new Exception("Could not find a Node.js LTS release.");
    string arch = Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") == "ARM64" ? "arm64" : Environment.Is64BitOperatingSystem ? "x64" : "x86";
    string name = "node-" + v + "-win-" + arch, zip = Path.Combine(Path.GetTempPath(), name + ".zip");
    status = "Downloading Node.js " + v; progress = 0;
    wc.DownloadProgressChanged += (o, e) => {
      if (e.TotalBytesToReceive > 0) progress = (double)e.BytesReceived / e.TotalBytesToReceive;
      detail = string.Format("{0:0.0} / {1:0.0} MB", e.BytesReceived / 1048576.0, e.TotalBytesToReceive / 1048576.0);
    };
    wc.DownloadFileTaskAsync(new Uri("https://nodejs.org/dist/" + v + "/" + name + ".zip"), zip).Wait();
    Step("Verifying the download", "SHA-256 against nodejs.org");
    var sums = new WebClient().DownloadString("https://nodejs.org/dist/" + v + "/SHASUMS256.txt");
    var expected = Regex.Match(sums, @"^([0-9a-f]{64})\s+" + Regex.Escape(name) + @"\.zip\s*$", RegexOptions.Multiline).Groups[1].Value;
    string actual;
    using (var sha = SHA256.Create()) using (var f = File.OpenRead(zip)) actual = BitConverter.ToString(sha.ComputeHash(f)).Replace("-", "").ToLowerInvariant();
    if (expected == "" || actual != expected) { File.Delete(zip); throw new Exception("The Node.js download failed checksum verification, so nothing was installed."); }
    Step("Unpacking Node.js", "");
    string dest = Path.Combine(Rt, "node");
    Directory.CreateDirectory(Rt);
    if (Directory.Exists(dest)) Directory.Delete(dest, true);
    if (Directory.Exists(Path.Combine(Rt, name))) Directory.Delete(Path.Combine(Rt, name), true);
    ZipFile.ExtractToDirectory(zip, Rt);
    Directory.Move(Path.Combine(Rt, name), dest);
    File.Delete(zip);
    return Path.Combine(dest, "node.exe");
  }

  // video-intel:// for this user (no admin), so the installed app's offline page can start the server.
  // The URL is never passed to the launcher, so a link cannot inject arguments.
  static void RegisterProtocol() {
    using (var k = Registry.CurrentUser.CreateSubKey(@"Software\Classes\video-intel")) {
      k.SetValue("", "URL:Video Intelligence launcher"); k.SetValue("URL Protocol", "");
      using (var c = k.CreateSubKey(@"shell\open\command")) c.SetValue("", "\"" + Application.ExecutablePath + "\" --background");
    }
  }

  static int ListenerPid() {
    foreach (var line in Run("netstat.exe", "-ano -p TCP").Split('\n')) {
      var m = Regex.Match(line, @"^\s*TCP\s+\S+:8000\s+\S+\s+LISTENING\s+(\d+)");
      if (m.Success) return int.Parse(m.Groups[1].Value);
    }
    return 0;
  }
  // Only ever stops a node process; anything else on the port is reported, not killed.
  static void StopListener() {
    int pid = ListenerPid();
    if (pid == 0) return;
    var p = Process.GetProcessById(pid);
    if (!p.ProcessName.Equals("node", StringComparison.OrdinalIgnoreCase)) throw new Exception("Port 8000 is used by " + p.ProcessName + ". Close it, then open Video Intelligence again.");
    p.Kill(); p.WaitForExit(5000);
    for (int i = 0; i < 25 && ListenerPid() != 0; i++) Thread.Sleep(200);
  }

  // Standalone app window (Edge ships with Windows; Chrome works too); else the default browser.
  static void OpenApp() {
    string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
      local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    foreach (var b in new[] { pf86 + @"\Microsoft\Edge\Application\msedge.exe", pf + @"\Microsoft\Edge\Application\msedge.exe", pf + @"\Google\Chrome\Application\chrome.exe", local + @"\Google\Chrome\Application\chrome.exe" })
      if (File.Exists(b)) { Process.Start(b, "--app=" + Url); return; }
    Process.Start(Url);
  }

  static string Get(string url) {
    try {
      var r = (HttpWebRequest)WebRequest.Create(url);
      r.Timeout = 1500;
      using (var res = r.GetResponse()) using (var rd = new StreamReader(res.GetResponseStream())) return rd.ReadToEnd();
    } catch { return null; }
  }

  static string Run(string exe, string args) {
    var p = Process.Start(new ProcessStartInfo(exe, args) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true });
    string o = p.StandardOutput.ReadToEnd(); p.WaitForExit(); return o;
  }

  // ---------- drawing ----------
  protected override void OnPaint(PaintEventArgs e) {
    var g = e.Graphics;
    g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
    g.ScaleTransform(s, s);
    using (var line = new SolidBrush(Line)) using (var ink = new SolidBrush(Ink)) using (var ink2 = new SolidBrush(failed ? Err : Ink2))
    using (var muted = new SolidBrush(Muted)) using (var accent = new SolidBrush(Accent)) {
      g.FillPolygon(accent, new[] { new PointF(33, 26), new PointF(38, 31), new PointF(33, 36), new PointF(28, 31) });   // the app's timeline marker
      g.DrawString("Video Intelligence", fBrand, muted, 44, 23);
      bool overClose = closeHit.Contains(mouse);
      using (var p = new Pen(overClose ? Ink : Muted, 1.4f)) { g.DrawLine(p, W - 34, 24, W - 24, 34); g.DrawLine(p, W - 24, 24, W - 34, 34); }
      g.DrawString(title, fTitle, ink, 26, 58);
      g.DrawString(status, fBody, ink2, new RectangleF(28, 96, W - 56, 60));
      if (failed) {
        logHit = Link(g, "Open log", 28, accent);
        quitHit = Link(g, "Close", logHit.Right + 20, muted);
        return;
      }
      float y = H - 34, w = W - 56;
      g.FillRectangle(line, 28, y, w, 3);
      if (progress >= 0) g.FillRectangle(accent, 28, y, (float)(w * Math.Min(1, progress)), 3);
      else {                                           // indeterminate: a segment sweeping across the track
        float seg = w * 0.28f, x = (phase % 1.4f - 0.3f) * w;
        g.SetClip(new RectangleF(28, y, w, 3)); g.FillRectangle(accent, 28 + x, y, seg, 3); g.ResetClip();
      }
      if (detail != "") { var sz = g.MeasureString(detail, fMono); g.DrawString(detail, fMono, muted, W - 28 - sz.Width, y - sz.Height - 6); }
    }
  }
  RectangleF Link(Graphics g, string text, float x, Brush b) {
    var sz = g.MeasureString(text, fLink); var r = new RectangleF(x, H - 46, sz.Width, sz.Height);
    g.DrawString(text, fLink, b, r.Location);
    if (r.Contains(mouse)) using (var p = new Pen(b, 1)) g.DrawLine(p, r.Left + 2, r.Bottom - 2, r.Right - 4, r.Bottom - 2);
    return r;
  }

  PointF At(MouseEventArgs e) { return new PointF(e.X / s, e.Y / s); }
  protected override void OnMouseMove(MouseEventArgs e) {
    mouse = At(e);
    Cursor = closeHit.Contains(mouse) || (failed && (logHit.Contains(mouse) || quitHit.Contains(mouse))) ? Cursors.Hand : Cursors.Default;
  }
  protected override void OnMouseDown(MouseEventArgs e) {
    var p = At(e);
    if (closeHit.Contains(p) || (failed && quitHit.Contains(p))) { Close(); return; }
    if (failed && logHit.Contains(p)) { var log = Path.Combine(Rt, "server.log"); if (File.Exists(log)) Process.Start("notepad.exe", "\"" + log + "\""); return; }
    ReleaseCapture(); SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero);   // drag the window from anywhere else
  }
  protected override bool ProcessCmdKey(ref Message m, Keys k) { if (k == Keys.Escape) { Close(); return true; } return base.ProcessCmdKey(ref m, k); }

  // --preview <dir>: renders each state to PNG without showing a window or doing any work (for checking the design).
  static void Preview(string dir) {
    SetProcessDPIAware();
    var f = new Launcher(false); f.CreateControl();
    Action<string, string, string, string, double, bool> shot = (file, t, st, d, pr, fail) => {
      f.title = t; f.status = st; f.detail = d; f.progress = pr; f.failed = fail; f.phase = 0.55f;
      using (var bmp = new Bitmap(f.ClientSize.Width, f.ClientSize.Height)) { f.DrawToBitmap(bmp, f.ClientRectangle); bmp.Save(Path.Combine(dir, file)); }
    };
    shot("launcher-start.png", "Starting Video Intelligence", "Starting the local server", "", -1, false);
    shot("launcher-node.png", "Starting Video Intelligence", "Downloading Node.js v22.21.0", "18.4 / 31.2 MB", 0.59, false);
    shot("launcher-fail.png", "Couldn't start", "Port 8000 is used by another program. Close it, then open Video Intelligence again.", "", -1, true);
  }

  static Font Pick(float px, FontStyle style, params string[] names) {
    foreach (var n in names) { var f = new Font(n, px, style, GraphicsUnit.Pixel); if (f.Name == n) return f; f.Dispose(); }
    return new Font(FontFamily.GenericSansSerif, px, style, GraphicsUnit.Pixel);
  }

  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool ReleaseCapture();
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
  [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int value, int size);
}
