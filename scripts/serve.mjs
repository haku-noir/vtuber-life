import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

export function createStaticServer(root = ROOT) {
  return createServer(async (request, response) => {
    const send = (status, body, type = "text/plain; charset=utf-8") => {
      response.writeHead(status, { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : body);
    };
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD"); send(405, "Method not allowed"); return;
    }
    try {
      const raw = (request.url ?? "/").split("?")[0];
      let pathname;
      try { pathname = decodeURIComponent(raw); } catch { send(400, "Invalid URL"); return; }
      const segments = pathname.split("/");
      if (!pathname.startsWith("/") || /[\\\x00-\x1f:]/.test(pathname) || segments.some(segment => segment.startsWith("."))) {
        send(403, "Forbidden"); return;
      }
      let relative;
      if (pathname === "/" || pathname === "/web/") relative = "web/index.html";
      else if (pathname.startsWith("/src/") || pathname.startsWith("/web/")) relative = pathname.slice(1);
      else if (["/docs/spec/params.json", "/docs/spec/stats-sample.json"].includes(pathname)) relative = pathname.slice(1);
      else relative = `web${pathname}`;
      const absoluteRoot = await realpath(root);
      const target = path.resolve(absoluteRoot, relative);
      const allowedRoot = path.resolve(absoluteRoot, relative.startsWith("src/") ? "src" : relative.startsWith("web/") ? "web" : "docs/spec");
      if (!inside(allowedRoot, target)) { send(403, "Forbidden"); return; }
      let actual;
      try { actual = await realpath(target); }
      catch (error) {
        if (error.code === "ENOENT" && relative === "web/index.html") {
          send(200, '<!doctype html><html lang="ja"><meta charset="utf-8"><title>VTuberの一生</title><h1>VTuberの一生</h1><p>M1の基盤を準備しました。ゲーム画面は後続のマイルストーンで実装します。</p></html>', TYPES[".html"]);
          return;
        }
        throw error;
      }
      // Do not serve symlink/junction escapes or the repository's private files.
      if (!inside(absoluteRoot, actual) || !inside(allowedRoot, actual)) { send(403, "Forbidden"); return; }
      if (!(await stat(actual)).isFile()) { send(404, "Not found"); return; }
      const type = TYPES[path.extname(actual)];
      if (!type) { send(403, "Forbidden"); return; }
      send(200, await readFile(actual), type);
    } catch (error) {
      send(["ENOENT", "ENOTDIR"].includes(error.code) ? 404 : 500, error.code === "ENOENT" ? "Not found" : "Unable to serve file");
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError("Invalid PORT");
  const server = createStaticServer();
  server.on("error", error => { console.error(`Server failed: ${error.message}`); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => console.log(`VTuberの一生: http://127.0.0.1:${server.address().port}/`));
}
