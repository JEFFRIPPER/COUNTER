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
// AssemblyVersion генерирует build.ps1 из версии в package.json.

internal static class Program
{
    internal const string SdkVersion = "1.0.4258.31";
    internal static string DataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "COUNTER");
    internal static bool SmokeMode;
    internal static bool UpdateCheck;
    internal static int SmokeExitCode = 1;
    private static readonly Dictionary<string, Assembly> Loaded = new Dictionary<string, Assembly>();

    [STAThread]
    private static int Main(string[] args)
    {
        SmokeMode = Array.IndexOf(args, "--smoke-test") >= 0;
        UpdateCheck = !SmokeMode && Array.IndexOf(args, Updater.DisableArgument) < 0;
        if (SmokeMode) DataDirectory = Path.Combine(Path.GetTempPath(), "COUNTER-smoke-" + Guid.NewGuid().ToString("N"));
        AppDomain.CurrentDomain.AssemblyResolve += ResolveEmbedded;
        bool created;
        using (var mutex = new Mutex(true, "Local\\COUNTER-V2" + (SmokeMode ? ".smoke" : ""), out created))
        {
            // После обновления старая копия ещё закрывается: ждём, пока она освободит мьютекс.
            if (!created && Array.IndexOf(args, Updater.AfterUpdateArgument) >= 0)
            {
                try { created = mutex.WaitOne(15000); } catch (AbandonedMutexException) { created = true; }
            }
            if (!created) { if (!SmokeMode) MessageBox.Show("Счётчик уже открыт.", "COUNTER", MessageBoxButtons.OK, MessageBoxIcon.Information); return SmokeMode ? 1 : 0; }
            if (!SmokeMode) Updater.Cleanup();
            try { Run(); Updater.RelaunchIfPending(); }
            catch (Exception error) { if (!SmokeMode) MessageBox.Show("Не удалось открыть счётчик.\n\n" + error.Message, "COUNTER", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            finally { mutex.ReleaseMutex(); }
        }
        return SmokeMode ? SmokeExitCode : 0;
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
    private static readonly Color DarkSurface = Color.FromArgb(12, 9, 9);
    private static readonly Color LightSurface = Color.FromArgb(255, 248, 247);
    private readonly WebView2 view = new WebView2();
    private readonly Label loading = new Label();
    private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 6000000 };
    private CoreWebView2Environment environment;
    private readonly System.Windows.Forms.Timer smokeTimeout = new System.Windows.Forms.Timer { Interval = 25000 };
    private int smokeStage;

    internal CounterWindow()
    {
        Text = "Счётчик · COUNTER " + Updater.CurrentVersion.ToString(2);
        Rectangle screen = Screen.PrimaryScreen.WorkingArea;
        ClientSize = new Size(Math.Min(1050, screen.Width - 48), Math.Min(840, screen.Height - 96));
        MinimumSize = new Size(440, 560);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        BackColor = DarkSurface; // Тёмная тема по умолчанию: без белой вспышки при запуске.
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        loading.Text = "Открываем счётчик…";
        loading.Font = new Font("Segoe UI", 14);
        loading.TextAlign = ContentAlignment.MiddleCenter;
        loading.Dock = DockStyle.Fill;
        loading.BackColor = BackColor;
        loading.ForeColor = Color.FromArgb(243, 230, 228);
        view.Dock = DockStyle.Fill;
        view.DefaultBackgroundColor = BackColor;
        Controls.Add(view);
        Controls.Add(loading);
        Load += Initialize;
        FormClosed += delegate { smokeTimeout.Stop(); smokeTimeout.Dispose(); view.Dispose(); };
        smokeTimeout.Tick += delegate { Close(); };
        if (Program.SmokeMode) ShowInTaskbar = false;
    }

    private async void Initialize(object sender, EventArgs args)
    {
        try
        {
            if (Program.SmokeMode) smokeTimeout.Start();
            // All application files are embedded; only the browser profile and
            // the architecture-specific native loader live in LocalAppData.
            environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.DataDirectory, "WebView2"));
            await view.EnsureCoreWebView2Async(environment);
            Updater.BrowserProcessId = (int)view.CoreWebView2.BrowserProcessId;
            view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            view.CoreWebView2.Settings.AreDevToolsEnabled = false;
            view.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
            view.CoreWebView2.AddWebResourceRequestedFilter("https://counter.local/*", CoreWebView2WebResourceContext.All);
            view.CoreWebView2.WebResourceRequested += ServeResource;
            view.CoreWebView2.WebMessageReceived += ReceiveMessage;
            view.CoreWebView2.NavigationStarting += delegate(object source, CoreWebView2NavigationStartingEventArgs e) { e.Cancel = e.Uri != AppUrl; };
            view.CoreWebView2.NewWindowRequested += delegate(object source, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
            view.CoreWebView2.NavigationCompleted += delegate(object source, CoreWebView2NavigationCompletedEventArgs e)
            {
                if (e.IsSuccess)
                {
                    loading.Visible = false; view.Focus();
                    if (Program.SmokeMode) ValidateSmoke();
                    else if (Program.UpdateCheck) { Program.UpdateCheck = false; Updater.CheckInBackground(this); }
                }
                else { loading.Text = "Не удалось открыть интерфейс. Закрой и снова запусти счётчик."; }
            };
            view.CoreWebView2.Navigate(AppUrl);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            if (!Program.SmokeMode) MessageBox.Show("Для запуска нужен Microsoft Edge WebView2 Runtime.\n\nУстанови его с официальной страницы:\nhttps://developer.microsoft.com/microsoft-edge/webview2/", "COUNTER", MessageBoxButtons.OK, MessageBoxIcon.Information);
            Close();
        }
        catch (Exception error)
        {
            if (!Program.SmokeMode) MessageBox.Show("Не удалось запустить интерфейс.\n\n" + error.Message, "COUNTER", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private async void ValidateSmoke()
    {
        try
        {
            if (smokeStage == 0)
            {
                smokeStage = 1;
                string result = await view.CoreWebView2.ExecuteScriptAsync("(function(){if(document.querySelectorAll('.item-row').length!==8)return false;document.querySelector('[data-action=plus]').click();document.getElementById('commPlus').click();document.getElementById('startShiftBtn').click();document.getElementById('pauseShiftBtn').click();var note=document.getElementById('shiftNotes');note.value='smoke';note.dispatchEvent(new Event('input'));var d=JSON.parse(localStorage.getItem('commStatsData_default'));return document.getElementById('totalComm').textContent==='1'&&d.commCount===1&&d.status==='Пауза'&&!!d.pauseStart&&d.notes==='smoke';})()");
                if (result != "true") { Close(); return; }
                smokeStage = 2;
                view.CoreWebView2.Reload();
            }
            else if (smokeStage == 2)
            {
                smokeStage = 3;
                string result = await view.CoreWebView2.ExecuteScriptAsync("(function(){var d=JSON.parse(localStorage.getItem('commStatsData_default'));return document.getElementById('totalComm').textContent==='1'&&document.getElementById('commCount').textContent==='1'&&document.getElementById('shiftStatusText').textContent==='Пауза'&&d.notes==='smoke'&&!!d.pauseStart;})()");
                Program.SmokeExitCode = result == "true" ? 0 : 1;
                Close();
            }
        }
        catch { Close(); }
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
                BackColor = dark ? DarkSurface : LightSurface;
                // Windows 11: заголовок в цвет фона и алая рамка окна. Windows 10 эти атрибуты игнорирует.
                int caption = BackColor.R | BackColor.G << 8 | BackColor.B << 16, border = 0x0024FF;
                try { DwmSetWindowAttribute(Handle, 35, ref caption, 4); DwmSetWindowAttribute(Handle, 34, ref border, 4); } catch (EntryPointNotFoundException) { }
                view.DefaultBackgroundColor = BackColor;
            }
            else if (type == "clipboard" && data.ContainsKey("text"))
            {
                string text = data["text"] as string;
                // Буфер обмена бывает занят (RDP, менеджеры буфера на рабочих ПК): несколько попыток.
                if (!string.IsNullOrEmpty(text) && text.Length <= 200000) { Clipboard.SetDataObject(text, true, 5, 100); Notify("Отчёт скопирован"); }
            }
            else if (type == "update") Updater.Start(this);
            else if (type == "openReleases") Updater.OpenReleasesPage();
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

    // Состояние обновления для диалога в интерфейсе. Вызывается в потоке окна.
    internal void PostUpdate(object message)
    {
        if (!IsDisposed && !view.IsDisposed && view.CoreWebView2 != null) view.CoreWebView2.PostWebMessageAsJson(json.Serialize(message));
    }

    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr handle, int attribute, ref int value, int size);
}
