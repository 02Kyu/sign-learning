using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;

public static class ItdaLocalServer
{
    public static void Run(string webDirectory, bool openBrowser)
    {
        string root = Path.GetFullPath(webDirectory) + Path.DirectorySeparatorChar;
        if (!File.Exists(Path.Combine(root, "practice", "index.html")) ||
            !File.Exists(Path.Combine(root, "practice", "words.mjs")) ||
            !File.Exists(Path.Combine(root, "practice", "model.json")))
        {
            throw new DirectoryNotFoundException("Extract the entire ITDA project before starting it.");
        }

        for (int port = 8000; port <= 8010; port++)
        {
            string origin = "http://127.0.0.1:" + port;
            using (var server = new HttpListener())
            {
                server.Prefixes.Add(origin + "/");
                server.IgnoreWriteExceptions = true;
                try
                {
                    server.Start();
                }
                catch (HttpListenerException error)
                {
                    if (error.ErrorCode == 32 || error.ErrorCode == 183)
                    {
                        continue;
                    }
                    throw;
                }

                string practiceUrl = origin + "/practice/";
                Console.WriteLine("ITDA: " + practiceUrl);
                Console.WriteLine("Keep this window open while practicing. Close it to stop ITDA.");
                if (openBrowser)
                {
                    OpenBrowser(practiceUrl);
                }

                while (server.IsListening)
                {
                    HttpListenerContext context = server.GetContext();
                    ThreadPool.QueueUserWorkItem(_ => Serve(context, root, origin));
                }
                return;
            }
        }
        throw new InvalidOperationException("Local ports 8000 to 8010 are already in use.");
    }

    private static void OpenBrowser(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch (Win32Exception)
        {
            Console.WriteLine("Open this address in your browser: " + url);
        }
        catch (InvalidOperationException)
        {
            Console.WriteLine("Open this address in your browser: " + url);
        }
    }

    private static void Serve(HttpListenerContext context, string root, string origin)
    {
        HttpListenerRequest request = context.Request;
        HttpListenerResponse response = context.Response;
        try
        {
            if (!IPAddress.IsLoopback(request.RemoteEndPoint.Address))
            {
                response.StatusCode = 403;
                return;
            }
            if (request.HttpMethod != "GET" && request.HttpMethod != "HEAD")
            {
                response.StatusCode = 405;
                response.AddHeader("Allow", "GET, HEAD");
                return;
            }

            string urlPath = Uri.UnescapeDataString(request.Url.AbsolutePath);
            string relative = urlPath.TrimStart('/');
            if (relative.IndexOfAny(new[] { '\\', ':', '\0' }) >= 0)
            {
                response.StatusCode = 404;
                return;
            }
            string file = Path.GetFullPath(Path.Combine(root, relative));
            if (!file.StartsWith(root, StringComparison.OrdinalIgnoreCase) &&
                !file.Equals(root.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
            {
                response.StatusCode = 404;
                return;
            }
            if (Directory.Exists(file))
            {
                if (!urlPath.EndsWith("/", StringComparison.Ordinal))
                {
                    response.Redirect(origin + request.Url.AbsolutePath + "/");
                    return;
                }
                file = Path.Combine(file, "index.html");
            }
            if (!File.Exists(file))
            {
                response.StatusCode = 404;
                return;
            }

            using (FileStream content = File.OpenRead(file))
            {
                response.ContentType = ContentType(file);
                response.ContentLength64 = content.Length;
                response.AddHeader("Cache-Control", "no-cache");
                response.AddHeader("X-Content-Type-Options", "nosniff");
                if (request.HttpMethod == "GET")
                {
                    content.CopyTo(response.OutputStream);
                }
            }
        }
        catch (ArgumentException)
        {
            response.StatusCode = 400;
        }
        catch (IOException)
        {
            response.Abort();
        }
        catch (UnauthorizedAccessException)
        {
            response.StatusCode = 403;
        }
        catch (HttpListenerException)
        {
            response.Abort();
        }
        finally
        {
            response.Close();
        }
    }

    private static string ContentType(string path)
    {
        switch (Path.GetExtension(path).ToLowerInvariant())
        {
            case ".htm":
            case ".html": return "text/html; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".js":
            case ".mjs": return "text/javascript; charset=utf-8";
            case ".json": return "application/json; charset=utf-8";
            case ".wasm": return "application/wasm";
            case ".svg": return "image/svg+xml";
            case ".png": return "image/png";
            case ".txt":
            case ".md": return "text/plain; charset=utf-8";
            default: return "application/octet-stream";
        }
    }
}
