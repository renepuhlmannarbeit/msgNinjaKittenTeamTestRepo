import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4173;
const portValue = process.env.PORT ?? String(DEFAULT_PORT);
const port = Number(portValue);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const routes = new Map([
  ["/", ["../index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["../index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["../styles.css", "text/css; charset=utf-8"]],
  ["/src/app.js", ["../src/app.js", "text/javascript; charset=utf-8"]],
  ["/src/domain.js", ["../src/domain.js", "text/javascript; charset=utf-8"]],
  ["/data/team.json", ["../data/team.json", "application/json; charset=utf-8"]],
]);

function respond(response, status, body = "") {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    respond(response, 405, "Method Not Allowed");
    return;
  }

  let pathname;
  try {
    pathname = new URL(request.url, `http://${HOST}`).pathname;
  } catch {
    respond(response, 400, "Bad Request");
    return;
  }

  const route = routes.get(pathname);
  if (!route) {
    respond(response, 404, "Not Found");
    return;
  }

  try {
    const [relativePath, contentType] = route;
    const body = await readFile(fileURLToPath(new URL(relativePath, import.meta.url)));
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": body.byteLength,
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    console.error(
      "Static asset read failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    respond(response, 500, "Internal Server Error");
  }
});

server.listen(port, HOST, () => {
  console.log(`Ninja Kitten Team Board: http://${HOST}:${port}`);
});
