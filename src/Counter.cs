using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("COUNTER")]
[assembly: AssemblyDescription("Счётчик коммуникаций — Material Design 3")]
[assembly: AssemblyProduct("COUNTER")]
[assembly: AssemblyVersion("2.0.0.0")]
[assembly: AssemblyFileVersion("2.0.0.0")]

internal static class Program
{
    internal const string SdkVersion = "1.0.4258.31";
    internal static string DataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "COUNTER");
    internal static bool SmokeMode;
    internal static int ExitCode = 1;
    private static readonly Dictionary<string, Assembly> Loaded = new Dictionary<string, Assembly>();

    [STAThread]
    private static int Main(string[] args)
    {
        SmokeMode = Array.IndexOf(args, "--smoke-test") >= 0;
        if (SmokeMode) DataDirectory = Path.Combine(Path.GetTempPath(), "COUNTER-smoke-" + Guid.NewGuid().ToString("N"));
        AppDomain.CurrentDomain.AssemblyResolve += ResolveEmbedded;
        bool created;
        using (var mutex = new Mutex(true, "Local\\COUNTER-V2" + (SmokeMode ? ".smoke" : ""), out created))
        {
            if (!created) { if (!SmokeMode) MessageBox.Show("Счётчик уже открыт.", "COUNTER", MessageBoxButtons.OK, MessageBoxIcon.Information); return 0; }
            try { Run(); }
            catch (Exception error) { if (!SmokeMode) MessageBox.Show("Не удалось открыть счётчик.\n\n" + error.Message, "COUNTER", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            finally { mutex.ReleaseMutex(); }
        }
        return SmokeMode ? ExitCode : 0;
    }

    private static Assembly ResolveEmbedded(object sender, ResolveEventArgs args)
    {
        string name = new AssemblyName(args.Name).Name;
        if (name != "Microsoft.Web.WebView2.Core" && name != "Microsoft.Web.WebView2.WinForms") return null;
        lock (Loaded)
        {
            Assembly assembly;
            if (!Loaded.TryGetValue(name, out assembly)) { assembly = Assembly.Load(Resource(name + ".dll")); Loaded[name] = assembly; }
            return assembly;
        }
    }

    internal static byte[] Resource(string name)
    {
        using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream("Counter." + name + ".gz"))
        {
            if (input == null) throw new FileNotFoundException("Не найден встроенный ресурс: " + name);
            using (var gzip = new GZipStream(input, CompressionMode.Decompress))
            using (var output = new MemoryStream()) { gzip.CopyTo(output); return output.ToArray(); }
        }
    }

    internal static string ExtractLoader()
    {
        string platform = Environment.Is64BitProcess ? "x64" : "x86";
        string directory = Path.Combine(DataDirectory, "Runtime", SdkVersion, platform);
        string path = Path.Combine(directory, "WebView2Loader.dll");
        byte[] bytes = Resource(platform + ".WebView2Loader.dll");
        Directory.CreateDirectory(directory);
        bool matches = false;
        if (File.Exists(path))
        {
            using (var hash = SHA256.Create()) matches = Convert.ToBase64String(hash.ComputeHash(File.ReadAllBytes(path))) == Convert.ToBase64String(hash.ComputeHash(bytes));
        }
        if (!matches)
        {
            string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllBytes(temporary, bytes);
                if (File.Exists(path)) File.Delete(path);
                File.Move(temporary, path);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
        return directory;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void Run()
    {
        try { SetProcessDpiAwareness(2); } catch (EntryPointNotFoundException) { } catch (DllNotFoundException) { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        CoreWebView2Environment.SetLoaderDllFolderPath(ExtractLoader());
        Application.Run(new CounterWindow());
    }

    [DllImport("shcore.dll")] private static extern int SetProcessDpiAwareness(int awareness);
}

internal sealed class CounterWindow : Form
{
    private const string AppUrl = "https://counter.local/index.html";
    private readonly WebView2 view = new WebView2();
    private readonly Label loading = new Label();
    private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 6000000 };
    private CoreWebView2Environment environment;
    private readonly System.Windows.Forms.Timer smokeTimeout = new System.Windows.Forms.Timer { Interval = 25000 };

    internal CounterWindow()
    {
        Text = "Счётчик · COUNTER 2.0";
        Rectangle screen = Screen.PrimaryScreen.WorkingArea;
        ClientSize = new Size(Math.Min(1050, screen.Width - 48), Math.Min(840, screen.Height - 96));
        MinimumSize = new Size(440, 560);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        BackColor = Color.FromArgb(255, 248, 247);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        loading.Text = "Открываем счётчик…";
        loading.Font = new Font("Segoe UI", 14);
        loading.TextAlign = ContentAlignment.MiddleCenter;
        loading.Dock = DockStyle.Fill;
        loading.BackColor = BackColor;
        view.Dock = DockStyle.Fill;
        view.DefaultBackgroundColor = BackColor;
        Controls.Add(view);
        Controls.Add(loading);
        if (Program.SmokeMode)
        {
            ShowInTaskbar = false;
            smokeTimeout.Tick += delegate { smokeTimeout.Stop(); Program.ExitCode = 2; Close(); };
            smokeTimeout.Start();
        }
        Load += Initialize;
        FormClosed += delegate { smokeTimeout.Dispose(); view.Dispose(); };
    }

    private async void Initialize(object sender, EventArgs args)
    {
        try
        {
            // All application files are embedded; only the browser profile and
            // the architecture-specific native loader live in LocalAppData.
            environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.DataDirectory, "WebView2"));
            await view.EnsureCoreWebView2Async(environment);
            view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            view.CoreWebView2.Settings.AreDevToolsEnabled = false;
            view.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
            view.CoreWebView2.AddWebResourceRequestedFilter("https://counter.local/*", CoreWebView2WebResourceContext.All);
            view.CoreWebView2.WebResourceRequested += ServeResource;
            view.CoreWebView2.WebMessageReceived += ReceiveMessage;
            view.CoreWebView2.NavigationStarting += delegate(object source, CoreWebView2NavigationStartingEventArgs e) { e.Cancel = e.Uri != AppUrl; };
            view.CoreWebView2.NewWindowRequested += delegate(object source, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
            view.CoreWebView2.NavigationCompleted += async delegate(object source, CoreWebView2NavigationCompletedEventArgs e)
            {
                if (e.IsSuccess) { loading.Visible = false; view.Focus(); }
                else { loading.Text = "Не удалось открыть интерфейс. Закрой и снова запусти счётчик."; }
                if (Program.SmokeMode)
                {
                    try
                    {
                        string result = await view.CoreWebView2.ExecuteScriptAsync("(() => { const rows = document.querySelectorAll('.item-row'); if (rows.length !== 8) return false; rows[0].querySelector('[data-action=plus]').click(); return document.getElementById('totalComm').textContent === '1' && localStorage.getItem('commStatsData_default') !== null; })()");
                        Program.ExitCode = result == "true" ? 0 : 3;
                    }
                    catch { Program.ExitCode = 4; }
                    smokeTimeout.Stop(); Close();
                }
            };
            view.CoreWebView2.Navigate(AppUrl);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            if (Program.SmokeMode) { Program.ExitCode = 5; Close(); return; }
            MessageBox.Show("Для запуска нужен Microsoft Edge WebView2 Runtime.\n\nУстанови его с официальной страницы:\nhttps://developer.microsoft.com/microsoft-edge/webview2/", "COUNTER", MessageBoxButtons.OK, MessageBoxIcon.Information);
            Close();
        }
        catch (Exception error)
        {
            if (Program.SmokeMode) { Program.ExitCode = 6; Close(); return; }
            MessageBox.Show("Не удалось запустить интерфейс.\n\n" + error.Message, "COUNTER", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private void ServeResource(object sender, CoreWebView2WebResourceRequestedEventArgs args)
    {
        bool page = args.Request.Uri == AppUrl;
        args.Response = environment.CreateWebResourceResponse(new MemoryStream(page ? Program.Resource("index.html") : new byte[0]), page ? 200 : 404, page ? "OK" : "Not Found", "Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff");
    }

    private void ReceiveMessage(object sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (args.Source != AppUrl) return;
        try
        {
            var data = json.Deserialize<Dictionary<string, object>>(args.WebMessageAsJson);
            if (data == null || !data.ContainsKey("type")) return;
            // Leave the WebView2 event callback before opening native dialogs;
            // a modal message loop inside a WebView2 callback is unsupported.
            BeginInvoke(new Action(delegate { HandleMessage(data); }));
        }
        catch (Exception) { Notify("Не удалось выполнить действие. Попробуй ещё раз."); }
    }

    private void HandleMessage(Dictionary<string, object> data)
    {
        if (IsDisposed || view.IsDisposed) return;
        try
        {
            string type = data["type"] as string;
            if (type == "theme")
            {
                bool dark = data.ContainsKey("dark") && data["dark"] is bool && (bool)data["dark"];
                int value = dark ? 1 : 0;
                try { DwmSetWindowAttribute(Handle, 20, ref value, 4); } catch (EntryPointNotFoundException) { }
                BackColor = dark ? Color.FromArgb(25, 17, 18) : Color.FromArgb(255, 248, 247);
                view.DefaultBackgroundColor = BackColor;
            }
            else if (type == "clipboard" && data.ContainsKey("text"))
            {
                string text = data["text"] as string;
                if (text != null && text.Length <= 200000) { Clipboard.SetText(text); Notify("Отчёт скопирован"); }
            }
            else if (type == "saveFile" && data.ContainsKey("content") && data.ContainsKey("name"))
            {
                string name = Path.GetFileName(data["name"] as string);
                string content = data["content"] as string;
                if (string.IsNullOrEmpty(name) || content == null || content.Length > 5000000) return;
                string extension = Path.GetExtension(name).ToLowerInvariant();
                if (extension != ".csv" && extension != ".json") return;
                using (var dialog = new SaveFileDialog())
                {
                    dialog.FileName = name;
                    dialog.DefaultExt = extension.Substring(1);
                    dialog.AddExtension = true;
                    dialog.Filter = extension == ".csv" ? "Таблица CSV (*.csv)|*.csv" : "Резервная копия JSON (*.json)|*.json";
                    dialog.OverwritePrompt = true;
                    if (dialog.ShowDialog(this) == DialogResult.OK)
                    {
                        // CSV contains its own BOM; avoid adding a second one.
                        File.WriteAllText(dialog.FileName, content, new UTF8Encoding(false));
                        Notify(extension == ".csv" ? "CSV сохранён" : "Резервная копия сохранена");
                    }
                }
            }
        }
        catch (Exception) { Notify("Не удалось выполнить действие. Попробуй ещё раз."); }
    }

    private void Notify(string message)
    {
        if (view.CoreWebView2 != null) view.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { type = "toast", message = message }));
    }

    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr handle, int attribute, ref int value, int size);
}
