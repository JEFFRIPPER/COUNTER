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
    private const string AssetName = "COUNTER.exe";
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

    internal static void CheckInBackground(Form owner)
    {
        ThreadPool.QueueUserWorkItem(delegate
        {
            Release release;
            try { release = FetchLatest(); }
            catch (Exception) { return; } // Нет сети или GitHub недоступен: работаем как обычно.
            if (release == null || release.Version <= CurrentVersion) return;
            try { owner.BeginInvoke(new Action(delegate { Offer(owner, release); })); }
            catch (InvalidOperationException) { } // Окно уже закрыто.
        });
    }

    private static void Offer(Form owner, Release release)
    {
        if (owner.IsDisposed) return;
        string question = "Доступна новая версия COUNTER " + Format(release.Version) + " (установлена " + Format(CurrentVersion) + ").\n\n" +
            "Обновить сейчас? Счётчик перезапустится, сохранённые данные не изменятся.";
        if (MessageBox.Show(owner, question, "Обновление COUNTER", MessageBoxButtons.YesNo, MessageBoxIcon.Information) != DialogResult.Yes) return;
        owner.UseWaitCursor = true;
        ThreadPool.QueueUserWorkItem(delegate
        {
            string error = null;
            try { Download(release); }
            catch (Exception exception) { error = exception.Message; TryDelete(NewPath); }
            try { owner.BeginInvoke(new Action(delegate { Finish(owner, error); })); }
            catch (InvalidOperationException) { TryDelete(NewPath); }
        });
    }

    private static void Finish(Form owner, string error)
    {
        owner.UseWaitCursor = false;
        if (error == null)
        {
            try { Replace(); }
            catch (Exception exception) { error = exception.Message; }
        }
        if (error != null)
        {
            MessageBox.Show(owner, "Не удалось обновить счётчик.\n\n" + error + "\n\nНовую версию можно скачать вручную:\n" + ReleasesPage,
                "Обновление COUNTER", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        Process.Start(new ProcessStartInfo(ExecutablePath, AfterUpdateArgument) { UseShellExecute = false });
        owner.Close();
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

    private static void Download(Release release)
    {
        string expected = DownloadText(release.ChecksumUrl).Trim().Split(' ', '\t', '\r', '\n')[0].ToLowerInvariant();
        if (expected.Length != 64) throw new InvalidDataException("Файл контрольной суммы повреждён.");
        byte[] bytes;
        using (var client = CreateClient()) bytes = client.DownloadData(release.ExecutableUrl);
        string actual;
        using (var hash = SHA256.Create()) actual = BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        if (actual != expected) throw new InvalidDataException("Контрольная сумма скачанного файла не совпала.");
        if (bytes.Length < 2 || bytes[0] != 'M' || bytes[1] != 'Z') throw new InvalidDataException("Скачанный файл не является программой.");
        File.WriteAllBytes(NewPath, bytes);
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
