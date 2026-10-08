using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Обновление по воздуху: при запуске проверяем последний GitHub Release,
// по согласию пользователя скачиваем COUNTER.exe, сверяем SHA-256,
// подменяем исполняемый файл и перезапускаемся. Данные лежат в LocalAppData и не затрагиваются.
internal static class Updater
{
    internal const string Repository = "JEFFRIPPER/COUNTER";
    internal const string AfterUpdateArgument = "--after-update";
    internal const string DisableArgument = "--no-update-check";
    internal static int BrowserProcessId;
    private static bool relaunchPending;
    private static Release available;
    private static bool downloading;
    private const string AssetName = "COUNTER.exe";
    private const long MaxDownloadSize = 200L * 1024 * 1024;
    private const string ReleasesPage = "https://github.com/" + Repository + "/releases/latest";

    private static string ExecutablePath { get { return Application.ExecutablePath; } }
    private static string OldPath { get { return ExecutablePath + ".old"; } }
    private static string NewPath { get { return ExecutablePath + ".new"; } }

    internal static Version CurrentVersion
    {
        get { return typeof(Updater).Assembly.GetName().Version; }
    }

    // Убирает файлы, оставшиеся от прошлого обновления.
    internal static void Cleanup()
    {
        TryDelete(OldPath);
        TryDelete(NewPath);
    }

    // Нашли новую версию: окно показывает её в интерфейсе (диалог MD3 и алая кнопка «Обновить»).
    internal static void CheckInBackground(CounterWindow owner)
    {
        ThreadPool.QueueUserWorkItem(delegate
        {
            Release release;
            try { release = FetchLatest(); }
            catch (Exception) { return; } // Нет сети или GitHub недоступен: работаем как обычно.
            if (release == null || release.Version <= CurrentVersion) return;
            try
            {
                owner.BeginInvoke(new Action(delegate
                {
                    if (owner.IsDisposed) return;
                    available = release;
                    owner.PostUpdate(new { type = "update", state = "available", version = Format(release.Version), current = Format(CurrentVersion) });
                }));
            }
            catch (InvalidOperationException) { } // Окно уже закрыто.
        });
    }

    // Пользователь нажал «Обновить». Вызывается в потоке окна.
    internal static void Start(CounterWindow owner)
    {
        if (available == null || downloading) return;
        downloading = true;
        Release release = available;
        ThreadPool.QueueUserWorkItem(delegate
        {
            string error = null;
            int reported = -2;
            try
            {
                Download(release, delegate(int percent)
                {
                    if (percent == reported) return;
                    reported = percent;
                    try { owner.BeginInvoke(new Action(delegate { if (!owner.IsDisposed) owner.PostUpdate(new { type = "update", state = "progress", percent = percent }); })); }
                    catch (InvalidOperationException) { }
                });
            }
            catch (Exception exception) { error = exception.Message; TryDelete(NewPath); }
            try { owner.BeginInvoke(new Action(delegate { Finish(owner, error); })); }
            catch (InvalidOperationException) { TryDelete(NewPath); }
        });
    }

    private static void Finish(CounterWindow owner, string error)
    {
        downloading = false;
        if (owner.IsDisposed) { TryDelete(NewPath); return; }
        if (error == null)
        {
            try { Replace(); }
            catch (Exception exception) { error = exception.Message; TryDelete(NewPath); }
        }
        if (error != null)
        {
            owner.PostUpdate(new { type = "update", state = "error", message = error });
            return;
        }
        relaunchPending = true; // Новая версия стартует из Main, когда WebView2 этой копии закроется.
        owner.Close();
    }

    internal static void OpenReleasesPage()
    {
        Process.Start(new ProcessStartInfo(ReleasesPage) { UseShellExecute = true });
    }

    // Ждём выхода браузерного процесса WebView2 этой копии: иначе новая копия может
    // подключиться к закрывающемуся процессу с той же папкой данных и не открыться.
    internal static void RelaunchIfPending()
    {
        if (!relaunchPending) return;
        if (BrowserProcessId > 0)
        {
            try { using (Process browser = Process.GetProcessById(BrowserProcessId)) browser.WaitForExit(5000); }
            catch (Exception) { } // Процесс уже завершился.
        }
        try { Process.Start(new ProcessStartInfo(ExecutablePath, AfterUpdateArgument) { UseShellExecute = false }); }
        catch (Exception exception)
        {
            MessageBox.Show("Счётчик обновлён, но не перезапустился сам.\n\nОткрой его снова.\n\n" + exception.Message, "Обновление COUNTER", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    private static Release FetchLatest()
    {
        var json = new JavaScriptSerializer();
        var data = json.Deserialize<Dictionary<string, object>>(DownloadText("https://api.github.com/repos/" + Repository + "/releases/latest"));
        if (data == null || !data.ContainsKey("tag_name") || !data.ContainsKey("assets")) return null;
        var release = new Release();
        string tag = (data["tag_name"] as string ?? "").TrimStart('v', 'V');
        if (!Version.TryParse(tag, out release.Version)) return null;
        release.Version = Normalize(release.Version);
        var assets = data["assets"] as IEnumerable;
        if (assets == null) return null;
        foreach (object item in assets)
        {
            var asset = item as Dictionary<string, object>;
            if (asset == null || !asset.ContainsKey("name") || !asset.ContainsKey("browser_download_url")) continue;
            string name = asset["name"] as string, url = asset["browser_download_url"] as string;
            if (name == AssetName) release.ExecutableUrl = url;
            else if (name == AssetName + ".sha256") release.ChecksumUrl = url;
        }
        return release.ExecutableUrl != null && release.ChecksumUrl != null ? release : null;
    }

    private static void Download(Release release, Action<int> progress)
    {
        string expected = DownloadText(release.ChecksumUrl).Trim().Split(' ', '\t', '\r', '\n')[0].ToLowerInvariant();
        if (expected.Length != 64) throw new InvalidDataException("Файл контрольной суммы повреждён.");
        byte[] bytes = DownloadData(release.ExecutableUrl, progress);
        string actual;
        using (var hash = SHA256.Create()) actual = BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        if (actual != expected) throw new InvalidDataException("Контрольная сумма скачанного файла не совпала.");
        if (bytes.Length < 2 || bytes[0] != 'M' || bytes[1] != 'Z') throw new InvalidDataException("Скачанный файл не является программой.");
        File.WriteAllBytes(NewPath, bytes);
    }

    // Читаем по частям, чтобы показывать процент загрузки. -1: размер неизвестен.
    private static byte[] DownloadData(string url, Action<int> progress)
    {
        using (var client = CreateClient())
        using (Stream stream = client.OpenRead(url))
        using (var buffer = new MemoryStream())
        {
            long total;
            if (!long.TryParse(client.ResponseHeaders[HttpResponseHeader.ContentLength], out total) || total <= 0) total = -1;
            if (total > MaxDownloadSize) throw new InvalidDataException("Файл обновления слишком большой.");
            progress(total > 0 ? 0 : -1);
            var chunk = new byte[81920];
            int read;
            while ((read = stream.Read(chunk, 0, chunk.Length)) > 0)
            {
                buffer.Write(chunk, 0, read);
                if (buffer.Length > MaxDownloadSize) throw new InvalidDataException("Файл обновления слишком большой.");
                if (total > 0) progress((int)Math.Min(100, buffer.Length * 100 / total));
            }
            return buffer.ToArray();
        }
    }

    // Windows позволяет переименовать запущенный EXE, но не перезаписать его.
    private static void Replace()
    {
        TryDelete(OldPath);
        File.Move(ExecutablePath, OldPath);
        try { File.Move(NewPath, ExecutablePath); }
        catch
        {
            File.Move(OldPath, ExecutablePath);
            throw;
        }
    }

    private static string DownloadText(string url)
    {
        using (var client = CreateClient()) return Encoding.UTF8.GetString(client.DownloadData(url));
    }

    private static WebClient CreateClient()
    {
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        var client = new WebClient();
        // Корпоративный прокси: системные настройки и учётная запись Windows.
        IWebProxy proxy = WebRequest.DefaultWebProxy;
        if (proxy != null) { proxy.Credentials = CredentialCache.DefaultNetworkCredentials; client.Proxy = proxy; }
        client.Headers[HttpRequestHeader.UserAgent] = "COUNTER/" + Format(CurrentVersion);
        client.Headers[HttpRequestHeader.Accept] = "application/vnd.github+json, application/octet-stream";
        return client;
    }

    private static Version Normalize(Version version)
    {
        return new Version(version.Major, version.Minor, Math.Max(version.Build, 0), Math.Max(version.Revision, 0));
    }

    private static string Format(Version version)
    {
        return version.Major + "." + version.Minor + "." + Math.Max(version.Build, 0);
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch (Exception) { }
    }

    private sealed class Release
    {
        internal Version Version;
        internal string ExecutableUrl;
        internal string ChecksumUrl;
    }
}
