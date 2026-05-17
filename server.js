import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { TosClient } from "@volcengine/tos-sdk";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(__dirname, "public");
const arkBaseUrl = "https://ark.cn-beijing.volces.com/api/v3";
const port = Number(process.env.PORT || 5173);
const maxBodyBytes = 90 * 1024 * 1024;
const maxTosVideoBytes = 50 * 1024 * 1024;
const terminalTaskStatuses = new Set(["succeeded", "failed", "expired", "cancelled"]);
const managedTosObjects = new Map();
const taskTosObjects = new Map();
let tosClientCache = null;
let tosClientCacheKey = "";

loadLocalEnv();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/api/health") {
      return sendJson(response, 200, {
        ok: true,
        hasApiKey: Boolean(process.env.ARK_API_KEY),
        time: new Date().toISOString()
      });
    }

    if (url.pathname === "/api/models" && request.method === "GET") {
      return await handleModels(response);
    }

    if (url.pathname === "/api/balance" && request.method === "GET") {
      return await handleBalance(response);
    }

    if (url.pathname === "/api/tos/status" && request.method === "GET") {
      return sendJson(response, 200, getTosStatus());
    }

    if (url.pathname === "/api/tos/upload-video" && request.method === "POST") {
      return await handleTosUploadVideo(request, response);
    }

    if (url.pathname === "/api/tos/delete" && request.method === "POST") {
      return await handleTosDelete(request, response);
    }

    if (url.pathname === "/api/generate" && request.method === "POST") {
      return await handleGenerate(request, response);
    }

    const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch && request.method === "GET") {
      return await handleTask(taskMatch[1], response);
    }

    if (url.pathname === "/api/download" && request.method === "GET") {
      return await handleDownload(url, response);
    }

    return await serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    return sendJson(response, error.status || 500, {
      error: {
        message: error instanceof Error ? error.message : "Unexpected server error"
      }
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Ark Video Studio is running at http://127.0.0.1:${port}`);
});

function loadLocalEnv() {
  const envPath = resolve(__dirname, ".env");
  if (!existsSync(envPath)) {
    return;
  }

  if (!statSync(envPath).isFile()) {
    return;
  }

  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function handleModels(response) {
  const result = await callArk("/models", { method: "GET" });
  const models = Array.isArray(result.data) ? result.data : [];
  const filtered = models
    .filter(model => /seed|video|dance|doubao/i.test(`${model.id || ""} ${model.name || ""}`))
    .map(model => ({
      id: model.id,
      name: model.name || model.id,
      status: model.status || "unknown",
      created: model.created,
      updated: model.updated
    }))
    .sort(compareModels);

  return sendJson(response, 200, { data: filtered, rawCount: models.length });
}

async function handleBalance(response) {
  const auth = process.env.VOLC_BILLING_AUTHORIZATION || process.env.VOLC_BILLING_BASIC_TOKEN;
  if (!auth) {
    return sendJson(response, 200, {
      configured: false,
      message: "余额查询需要配置费用中心授权：VOLC_BILLING_AUTHORIZATION 或 VOLC_BILLING_BASIC_TOKEN。ARK_API_KEY 只能调用方舟模型接口，不能查账户余额。"
    });
  }

  const authorization = auth.startsWith("Basic ") ? auth : `Basic ${auth}`;
  const balanceResponse = await fetch("https://open.volcengineapi.com/?Action=QueryBalanceAcct&Version=2022-01-01", {
    method: "GET",
    headers: {
      Authorization: authorization,
      Accept: "application/json"
    }
  });
  const text = await balanceResponse.text();
  const parsed = text ? tryParseJson(text) : {};
  if (!balanceResponse.ok || parsed?.ResponseMetadata?.Error) {
    throw new HttpError(balanceResponse.status || 502, extractArkMessage(parsed, text));
  }

  return sendJson(response, 200, {
    configured: true,
    result: parsed.Result || parsed.result || null
  });
}

async function handleGenerate(request, response) {
  const body = await readJsonBody(request);
  const selectedReferences = selectReferences(
    String(body?.prompt || "").trim(),
    Array.isArray(body?.references) ? body.references : [],
    body?.sendUnmentionedReferences
  );
  const payload = buildArkGenerationPayload(body);
  const result = await callArk("/contents/generations/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const taskId = result.id || result.task_id || result.data?.id;
  registerTaskTosCleanup(taskId, selectedReferences);

  return sendJson(response, 200, {
    request: summarizeRequest(payload),
    result
  });
}

async function handleTask(taskId, response) {
  const result = await callArk(`/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
    method: "GET"
  });
  if (terminalTaskStatuses.has(result.status)) {
    cleanupTaskTosObjects(taskId, `task-${result.status}`).catch(error => console.warn(error));
  }
  return sendJson(response, 200, { result });
}

async function handleTosUploadVideo(request, response) {
  const config = getTosConfig();
  if (!config.ok) {
    throw new HttpError(400, config.message);
  }

  const body = await readJsonBody(request);
  const fileName = safeFilename(body.fileName || "reference-video.mp4");
  const contentType = String(body.contentType || "video/mp4").trim();
  if (!contentType.startsWith("video/")) {
    throw new HttpError(400, "只能上传视频文件到 TOS。");
  }

  const buffer = decodeDataUrl(body.dataUrl);
  if (!buffer.length) {
    throw new HttpError(400, "视频内容为空。");
  }
  if (buffer.length > maxTosVideoBytes) {
    throw new HttpError(413, "参考视频超过 50 MB。Seedance reference_video 单个视频要求不超过 50 MB。");
  }

  const key = buildTosObjectKey(fileName);
  const client = getTosClient(config);
  await client.putObject({
    bucket: config.bucket,
    key,
    body: buffer,
    contentType,
    contentLength: buffer.length,
    meta: {
      source: "ark-video-studio",
      original: fileName
    }
  });

  const expires = config.signedUrlExpiresSeconds;
  const signedUrl = client.getPreSignedUrl({
    method: "GET",
    bucket: config.bucket,
    key,
    expires,
    response: { contentType }
  });
  const cleanupAt = registerManagedTosObject({
    bucket: config.bucket,
    key,
    createdAt: Date.now(),
    reason: "ttl"
  });

  return sendJson(response, 200, {
    url: signedUrl,
    key,
    bucket: config.bucket,
    size: buffer.length,
    expiresAt: new Date(Date.now() + expires * 1000).toISOString(),
    cleanupAt: new Date(cleanupAt).toISOString()
  });
}

async function handleTosDelete(request, response) {
  const body = await readJsonBody(request);
  const key = String(body.key || "").trim();
  if (!key) {
    throw new HttpError(400, "Missing TOS object key");
  }

  await cleanupTosObject(key, "manual-delete");
  return sendJson(response, 200, { ok: true });
}

async function handleDownload(url, response) {
  const fileUrl = url.searchParams.get("url");
  if (!fileUrl) {
    return sendJson(response, 400, { error: { message: "Missing url" } });
  }

  const parsed = new URL(fileUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return sendJson(response, 400, { error: { message: "Only http and https downloads are supported" } });
  }

  const downloadResponse = await fetch(parsed);
  if (!downloadResponse.ok || !downloadResponse.body) {
    return sendJson(response, downloadResponse.status || 502, {
      error: { message: `Download failed with status ${downloadResponse.status}` }
    });
  }

  const filename = safeFilename(url.searchParams.get("filename") || parsed.pathname.split("/").pop() || "ark-video.mp4");
  response.writeHead(200, {
    "Content-Type": downloadResponse.headers.get("content-type") || "application/octet-stream",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store"
  });
  Readable.fromWeb(downloadResponse.body).pipe(response);
}

function buildArkGenerationPayload(body) {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  if (!body.model || typeof body.model !== "string") {
    throw new HttpError(400, "Please choose a model");
  }

  const prompt = String(body.prompt || "").trim();
  const references = Array.isArray(body.references) ? body.references : [];
  if (!prompt && references.length === 0 && !body.draftTaskId) {
    throw new HttpError(400, "Prompt or reference material is required");
  }

  const content = [];
  if (prompt) {
    content.push({ type: "text", text: prompt });
  }

  for (const reference of selectReferences(prompt, references, body.sendUnmentionedReferences)) {
    const type = reference.kind === "video" ? "video_url" : reference.kind === "audio" ? "audio_url" : "image_url";
    const url = String(reference.url || "").trim();
    if (!url) {
      continue;
    }

    if (type === "image_url") {
      content.push({
        type,
        image_url: { url },
        role: reference.role || "reference_image"
      });
      continue;
    }

    if (type === "video_url") {
      if (!/^https?:\/\//i.test(url)) {
        throw new HttpError(400, "参考视频必须是公网 http(s) URL。Ark reference_video 不接受本地文件、data URL 或 asset://。");
      }
      content.push({
        type,
        video_url: { url },
        role: "reference_video"
      });
      continue;
    }

    content.push({
      type,
      audio_url: { url },
      role: "reference_audio"
    });
  }

  if (body.draftTaskId) {
    content.push({
      type: "draft_task",
      draft_task: { id: String(body.draftTaskId).trim() }
    });
  }

  const params = body.params && typeof body.params === "object" ? body.params : {};
  const payload = {
    model: body.model,
    content
  };

  copyString(params, payload, "callback_url");
  copyString(params, payload, "service_tier");
  copyString(params, payload, "resolution");
  copyString(params, payload, "ratio");
  copyString(params, payload, "safety_identifier");
  copyBoolean(params, payload, "return_last_frame");
  copyBoolean(params, payload, "generate_audio");
  copyBoolean(params, payload, "draft");
  copyBoolean(params, payload, "camera_fixed");
  copyBoolean(params, payload, "watermark");
  copyInteger(params, payload, "execution_expires_after");
  copyInteger(params, payload, "duration");
  copyInteger(params, payload, "frames");
  copyInteger(params, payload, "seed");

  if (params.use_web_search) {
    payload.tools = [{ type: "web_search" }];
  }
  if (payload.frames != null) {
    delete payload.duration;
  }

  return payload;
}

function selectReferences(prompt, references, sendUnmentioned) {
  if (sendUnmentioned || !prompt.trim()) {
    return references;
  }

  const normalizedPrompt = prompt.toLowerCase();
  return references.filter(reference => {
    const handle = String(reference.handle || "").toLowerCase();
    return handle && normalizedPrompt.includes(`@${handle}`);
  });
}

function getTosStatus() {
  const config = getTosConfig();
  return {
    configured: config.ok,
    message: config.ok ? "TOS 已配置，本地参考视频会自动上传。" : config.message,
    bucket: config.ok ? config.bucket : "",
    region: config.ok ? config.region : "",
    endpoint: config.ok ? config.endpoint : "",
    prefix: config.ok ? config.prefix : "",
    cleanupHours: config.ok ? config.cleanupHours : null,
    signedUrlExpiresSeconds: config.ok ? config.signedUrlExpiresSeconds : null
  };
}

function getTosConfig() {
  const accessKeyId = process.env.TOS_ACCESS_KEY || process.env.VOLC_TOS_ACCESS_KEY || "";
  const accessKeySecret = process.env.TOS_SECRET_KEY || process.env.VOLC_TOS_SECRET_KEY || "";
  const bucket = process.env.TOS_BUCKET || "";
  const region = process.env.TOS_REGION || "cn-beijing";
  const endpoint = process.env.TOS_ENDPOINT || `tos-${region}.volces.com`;
  const prefix = (process.env.TOS_PREFIX || "ark-video-studio/reference-videos").replace(/^\/+|\/+$/g, "");
  const cleanupHours = clampNumber(Number(process.env.TOS_CLEANUP_HOURS || 24), 1, 168);
  const signedUrlExpiresSeconds = clampNumber(Number(process.env.TOS_SIGNED_URL_EXPIRES_SECONDS || 86400), 600, 604800);
  const missing = [];

  if (!accessKeyId) missing.push("TOS_ACCESS_KEY");
  if (!accessKeySecret) missing.push("TOS_SECRET_KEY");
  if (!bucket) missing.push("TOS_BUCKET");

  if (missing.length) {
    return {
      ok: false,
      message: `自动上传 TOS 未配置，缺少：${missing.join("、")}。本地视频仍需手动填写公网 http(s) URL。`
    };
  }

  return {
    ok: true,
    accessKeyId,
    accessKeySecret,
    bucket,
    region,
    endpoint,
    prefix,
    cleanupHours,
    signedUrlExpiresSeconds
  };
}

function getTosClient(config) {
  const cacheKey = `${config.accessKeyId}|${config.region}|${config.endpoint}`;
  if (tosClientCache && tosClientCacheKey === cacheKey) {
    return tosClientCache;
  }

  tosClientCache = new TosClient({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    region: config.region,
    endpoint: config.endpoint
  });
  tosClientCacheKey = cacheKey;
  return tosClientCache;
}

function decodeDataUrl(value) {
  const match = String(value || "").match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) {
    throw new HttpError(400, "视频上传内容不是有效的 data URL。");
  }
  return Buffer.from(match[2], "base64");
}

function buildTosObjectKey(fileName) {
  const config = getTosConfig();
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${config.prefix}/${yyyy}${mm}${dd}/${Date.now()}-${randomUUID()}-${fileName}`;
}

function registerTaskTosCleanup(taskId, references) {
  if (!taskId) {
    return;
  }

  const keys = references
    .map(reference => String(reference.tosKey || reference.tos?.key || "").trim())
    .filter(Boolean);
  if (!keys.length) {
    return;
  }

  const current = new Set(taskTosObjects.get(taskId) || []);
  for (const key of keys) {
    current.add(key);
    const record = managedTosObjects.get(key);
    if (record) {
      record.taskId = taskId;
    }
  }
  taskTosObjects.set(taskId, Array.from(current));
}

function registerManagedTosObject(record) {
  const config = getTosConfig();
  const cleanupAt = Date.now() + config.cleanupHours * 60 * 60 * 1000;
  const existing = managedTosObjects.get(record.key);
  if (existing?.timer) {
    clearTimeout(existing.timer);
  }

  const timer = setTimeout(() => {
    cleanupTosObject(record.key, "ttl").catch(error => console.warn(error));
  }, Math.max(1000, cleanupAt - Date.now()));

  managedTosObjects.set(record.key, {
    ...record,
    cleanupAt,
    timer
  });
  return cleanupAt;
}

async function cleanupTaskTosObjects(taskId, reason) {
  const keys = taskTosObjects.get(taskId) || [];
  if (!keys.length) {
    return;
  }

  taskTosObjects.delete(taskId);
  for (const key of keys) {
    await cleanupTosObject(key, reason);
  }
}

async function cleanupTosObject(key, reason) {
  const record = managedTosObjects.get(key);
  if (record?.timer) {
    clearTimeout(record.timer);
  }
  managedTosObjects.delete(key);

  const config = getTosConfig();
  if (!config.ok) {
    return;
  }

  const client = getTosClient(config);
  try {
    await client.deleteObject({
      bucket: record?.bucket || config.bucket,
      key
    });
    console.log(`Deleted TOS object ${key} (${reason})`);
  } catch (error) {
    console.warn(`Failed to delete TOS object ${key}:`, error?.message || error);
  }
}

function summarizeRequest(payload) {
  return {
    model: payload.model,
    content: payload.content.map(item => {
      if (item.type === "text") {
        return { type: "text", text: item.text };
      }
      const clone = { type: item.type, role: item.role };
      const container = item.image_url || item.video_url || item.audio_url || item.draft_task;
      const url = container?.url || container?.id || "";
      clone.source = url.startsWith("data:") ? `${url.slice(0, 32)}...` : url;
      return clone;
    }),
    resolution: payload.resolution,
    ratio: payload.ratio,
    duration: payload.duration,
    frames: payload.frames,
    seed: payload.seed
  };
}

async function callArk(pathname, options) {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) {
    throw new HttpError(500, "ARK_API_KEY is not set in .env or the environment");
  }

  const response = await fetch(`${arkBaseUrl}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const parsed = text ? tryParseJson(text) : {};
  if (!response.ok) {
    throw new HttpError(response.status, extractArkMessage(parsed, text));
  }
  return parsed;
}

function extractArkMessage(parsed, fallback) {
  return parsed?.error?.message
    || parsed?.message
    || parsed?.ResponseMetadata?.Error?.Message
    || fallback
    || "Ark API request failed";
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBodyBytes) {
      throw new HttpError(413, "Request body is too large. Use a public http(s) URL for reference videos.");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

async function serveStatic(pathname, response) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = normalize(decodeURIComponent(cleanPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(publicDir, normalizedPath));

  if (!filePath.startsWith(publicDir)) {
    return sendText(response, 403, "Forbidden");
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return sendText(response, 404, "Not found");
  }

  const content = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  response.end(content);
}

function compareModels(a, b) {
  return scoreModel(b) - scoreModel(a) || String(a.id).localeCompare(String(b.id));
}

function scoreModel(model) {
  const id = String(model.id || "").toLowerCase();
  const version = id.match(/seedance[-_](\d+)[-_](\d+)/);
  const major = version ? Number(version[1]) : 0;
  const minor = version ? Number(version[2]) : 0;
  const dateScore = Math.max(0, ...Array.from(id.matchAll(/\d{6,8}/g), match => Number(match[0])));
  const seedanceBonus = id.includes("seedance") ? 10_000_000_000 : 0;
  const videoBonus = /video|dance/.test(id) ? 1_000_000_000 : 0;
  const activeBonus = /active|available|enabled|success/i.test(String(model.status || "")) ? 10_000 : 0;
  return seedanceBonus + videoBonus + major * 100_000_000 + minor * 10_000_000 + dateScore + activeBonus;
}

function copyString(source, target, key) {
  if (source[key] != null && String(source[key]).trim() !== "") {
    target[key] = String(source[key]).trim();
  }
}

function copyBoolean(source, target, key) {
  if (typeof source[key] === "boolean") {
    target[key] = source[key];
  }
}

function copyInteger(source, target, key) {
  if (source[key] === "" || source[key] == null) {
    return;
  }
  const value = Number(source[key]);
  if (Number.isInteger(value)) {
    target[key] = value;
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value, null, 2));
}

function sendText(response, status, value) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(value);
}

function safeFilename(name) {
  return String(name).replace(/[^a-z0-9._-]/gi, "_").slice(0, 120) || "ark-video.mp4";
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
