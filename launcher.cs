// Windowless launcher (compiled by start.ps1 with the csc.exe that ships with Windows, /target:winexe).
// Used by the installed app (video-intel://) and Start.cmd: starts server.mjs with no console window,
// waits until it answers, and exits. The server stops itself after a few idle minutes.
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;

class Launcher {
  const string Health = "http://127.0.0.1:8000/api/health";

  static int Main() {
    string runtime = AppDomain.CurrentDomain.BaseDirectory;            // <app>\.runtime\
    string root = Path.GetFullPath(Path.Combine(runtime, ".."));
    if (Up()) return 0;
    string node = File.ReadAllText(Path.Combine(runtime, "node-path.txt")).Trim();
    var psi = new ProcessStartInfo(node, "server.mjs") { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true };
    psi.EnvironmentVariables["PORT"] = "8000";
    psi.EnvironmentVariables["VI_IDLE_EXIT"] = "180000";
    psi.EnvironmentVariables["VI_LOG"] = Path.Combine(runtime, "server.log");
    Process.Start(psi);
    for (int i = 0; i < 75 && !Up(); i++) Thread.Sleep(200);
    return Up() ? 0 : 1;
  }

  static bool Up() {
    try {
      var r = (HttpWebRequest)WebRequest.Create(Health);
      r.Timeout = 800;
      using (r.GetResponse()) return true;
    } catch { return false; }
  }
}
