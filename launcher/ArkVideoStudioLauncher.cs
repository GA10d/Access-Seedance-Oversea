using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

namespace ArkVideoStudioLauncher
{
    internal static class Program
    {
        private const string AppUrl = "http://127.0.0.1:5173";
        private const string HealthUrl = AppUrl + "/api/health";

        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool noBrowser = Array.Exists(args, arg => string.Equals(arg, "/no-browser", StringComparison.OrdinalIgnoreCase));
            string appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            string serverPath = Path.Combine(appDir, "server.js");

            if (!File.Exists(serverPath))
            {
                MessageBox.Show(
                    "没有找到 server.js。请把 ArkVideoStudio.exe 放在项目根目录后再启动。",
                    "Ark Video Studio",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return;
            }

            if (!IsHealthy())
            {
                if (!StartServer(appDir))
                {
                    return;
                }

                if (!WaitUntilHealthy(TimeSpan.FromSeconds(15)))
                {
                    MessageBox.Show(
                        "服务启动超时。请确认 Node.js 已安装，并查看 server.err.log。",
                        "Ark Video Studio",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning);
                    return;
                }
            }

            if (!noBrowser)
            {
                OpenBrowser(AppUrl);
            }
        }

        private static bool StartServer(string appDir)
        {
            try
            {
                var startInfo = new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = "server.js",
                    WorkingDirectory = appDir,
                    UseShellExecute = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };

                Process.Start(startInfo);
                return true;
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "无法启动 Node.js。\n\n请先安装 Node.js 18 或更新版本，并确认 node 命令可用。\n\n" + ex.Message,
                    "Ark Video Studio",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return false;
            }
        }

        private static bool WaitUntilHealthy(TimeSpan timeout)
        {
            DateTime deadline = DateTime.UtcNow.Add(timeout);
            while (DateTime.UtcNow < deadline)
            {
                if (IsHealthy())
                {
                    return true;
                }
                Thread.Sleep(450);
            }

            return false;
        }

        private static bool IsHealthy()
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(HealthUrl);
                request.Method = "GET";
                request.Timeout = 900;
                request.ReadWriteTimeout = 900;

                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    return response.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private static void OpenBrowser(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "服务已启动，但无法自动打开浏览器。\n\n请手动访问：\n" + url + "\n\n" + ex.Message,
                    "Ark Video Studio",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
        }
    }
}
