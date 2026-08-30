import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { MissionStore } from "../src/mission-store.js";
import { canonicalDocument, missionListItem, MissionError } from "../src/missions.js";
import { validateTeam } from "../src/domain.js";

const HOST = "127.0.0.1";
const MAX_REQUEST_BYTES = 128 * 1024;
const MISSION_ID = /^[A-Za-z0-9_-]{16,64}$/;
const routes = new Map([
  ["/", ["../index.html", "text/html; charset=utf-8"]], ["/index.html", ["../index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["../styles.css", "text/css; charset=utf-8"]], ["/src/app.js", ["../src/app.js", "text/javascript; charset=utf-8"]],
  ["/src/domain.js", ["../src/domain.js", "text/javascript; charset=utf-8"]], ["/src/tag-rules.js", ["../src/tag-rules.js", "text/javascript; charset=utf-8"]], ["/data/team.json", ["../data/team.json", "application/json; charset=utf-8"]],
]);

function send(response, status, body, contentType = "application/json; charset=utf-8") {
  const encoded = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  response.writeHead(status, { "Cache-Control": "no-store", "Content-Type": contentType, "Content-Length": Buffer.byteLength(encoded), "X-Content-Type-Options": "nosniff" });
  response.end(encoded);
}
function errorStatus(code) {
  return ({ NOT_FOUND: 404, REVISION_CONFLICT: 409, PREVIEW_MISMATCH: 409, UNSUPPORTED_MEDIA_TYPE: 415, INVALID_TRANSITION: 422, UNKNOWN_AGENT: 422, UNSUPPORTED_VERSION: 422, INVALID_DATA: 422, LIMIT_EXCEEDED: 413, INVALID_JSON: 400, REQUEST_TOO_LARGE: 413 })[code] ?? 500;
}
async function jsonBody(request) {
  if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new MissionError("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
  }
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > MAX_REQUEST_BYTES) throw new MissionError("REQUEST_TOO_LARGE", `Request exceeds ${MAX_REQUEST_BYTES} bytes.`); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new MissionError("INVALID_JSON", "Request body is not valid JSON."); }
}

async function api(request, response, pathname, store, teamById) {
  if (request.method === "GET" && pathname === "/api/missions") { send(response, 200, { missions: store.list().map((mission) => missionListItem(mission, teamById)) }); return true; }
  if (request.method === "POST" && pathname === "/api/missions") { send(response, 201, { mission: await store.create(await jsonBody(request)) }); return true; }
  const match = pathname.match(/^\/api\/missions\/([^/]+)(?:\/(status))?$/);
  if (match) {
    const id = match[1];
    if (!MISSION_ID.test(id)) throw new MissionError("NOT_FOUND", "Mission not found.");
    if (request.method === "GET" && !match[2]) { const mission = store.get(id); if (!mission) throw new MissionError("NOT_FOUND", "Mission not found."); send(response, 200, { mission }); return true; }
    if (request.method === "PUT" && !match[2]) { const body = await jsonBody(request); send(response, 200, { mission: await store.update(id, body.mission, body.expectedRevision) }); return true; }
    if (request.method === "POST" && match[2] === "status") { const body = await jsonBody(request); send(response, 200, { mission: await store.transition(id, body.status, body.expectedRevision, body.completion ?? null) }); return true; }
  }
  if (request.method === "GET" && pathname === "/api/missions-export") { send(response, 200, canonicalDocument(store.snapshot()), "application/json; charset=utf-8"); return true; }
  if (request.method === "POST" && pathname === "/api/missions-restore/preview") {
    send(response, 200, { preview: store.preview(await jsonBody(request)) }); return true;
  }
  if (request.method === "POST" && pathname === "/api/missions-restore/apply") {
    const body = await jsonBody(request); send(response, 200, { document: await store.restore(body.previewToken, body.expectedStoreRevision) }); return true;
  }
  return false;
}

async function loadTeam() { return validateTeam(JSON.parse(await readFile(new URL("../data/team.json", import.meta.url), "utf8"))); }
export async function createAppServer({ missionsFile = process.env.MISSIONS_FILE ?? fileURLToPath(new URL("../var/missions.json", import.meta.url)) } = {}) {
  const team = await loadTeam();
  const teamById = new Map(team.map((member) => [member.id, member]));
  const store = await new MissionStore(resolve(missionsFile), new Set(team.map(({ id }) => id))).initialize();
  return createServer(async (request, response) => {
    let pathname; try { pathname = new URL(request.url, `http://${HOST}`).pathname; } catch { send(response, 400, { error: { code: "BAD_REQUEST", message: "Bad Request" } }); return; }
    try {
      if (pathname.startsWith("/api/")) { if (!(await api(request, response, pathname, store, teamById))) send(response, 404, { error: { code: "NOT_FOUND", message: "Not Found" } }); return; }
      if (request.method !== "GET" && request.method !== "HEAD") { response.setHeader("Allow", "GET, HEAD"); send(response, 405, "Method Not Allowed", "text/plain; charset=utf-8"); return; }
      const route = routes.get(pathname); if (!route) { send(response, 404, "Not Found", "text/plain; charset=utf-8"); return; }
      const [relativePath, contentType] = route; const body = await readFile(fileURLToPath(new URL(relativePath, import.meta.url)));
      response.writeHead(200, { "Cache-Control": "no-store", "Content-Length": body.byteLength, "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'", "Content-Type": contentType, "X-Content-Type-Options": "nosniff" }); response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      const code = typeof error?.code === "string" ? error.code : "INTERNAL_ERROR"; const status = errorStatus(code);
      if (status === 500) console.error("Request failed:", error instanceof Error ? error.message : "unknown error");
      send(response, status, { error: { code, message: status === 500 ? "Internal Server Error" : error.message, ...(error?.details ? { details: error.details } : {}) } });
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? "4173"); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535.");
  const server = await createAppServer(); server.listen(port, HOST, () => console.log(`Ninja Kitten Team Board: http://${HOST}:${port}`));
}
