#!/usr/bin/env node
/**
 * 모바일 청첩장 로컬/자체 호스팅 서버
 *
 *  - 정적 파일(index.html, assets/…) 서빙
 *  - 축하 메시지(방명록) API — DB 없이 JSON "파일"에 저장한다.
 *
 * 한글·이모지가 깨지지 않도록 지키는 규칙 (수정 시 유지할 것):
 *  1) 요청 본문은 Buffer로 모두 모은 뒤 한 번에 utf8 디코딩한다.
 *     (청크마다 toString 하면 3바이트짜리 한글이 경계에서 잘려 깨진다)
 *  2) 파일 읽기/쓰기는 항상 "utf8" 인코딩을 명시한다.
 *  3) 모든 응답에 charset=utf-8 을 붙인다.
 *  4) 저장 전 NFC 정규화 — macOS/iOS에서 넘어오는 자모 분리(NFD) 한글을 합친다.
 *  5) 길이 제한은 바이트가 아니라 "코드포인트" 기준으로 자른다.
 *     (이모지는 서로게이트 쌍이라 slice로 자르면 깨진 문자가 남는다)
 *
 * 실행: node server.mjs          (기본 http://localhost:8765)
 *       PORT=3000 node server.mjs
 */

import { createServer } from "node:http";
import { readFile, writeFile, rename, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8765;

/* 공개 목록: 정적 배포(GitHub Pages)에서도 그대로 읽을 수 있게 assets 아래에 둔다. */
const LIST_FILE = join(ROOT, "assets", "data", "guestbook.json");
/* 비밀번호 해시: 공개되면 안 되므로 별도 파일 + .gitignore. */
const AUTH_FILE = join(ROOT, "data", "guestbook-auth.json");

const MAX_NAME = 20;      // 코드포인트
const MAX_MESSAGE = 300;  // 코드포인트
const MAX_BODY_BYTES = 64 * 1024;
const POST_COOLDOWN_MS = 10 * 1000;
const ADMIN_KEY = process.env.GUESTBOOK_ADMIN_KEY || "";

/* ---------------------------------------------------------------- 문자열 */

/** 코드포인트 배열 (이모지 서로게이트 쌍을 한 글자로 센다) */
const chars = (s) => Array.from(String(s));

/** 코드포인트 기준으로 자르기 — 이모지 중간이 잘리지 않는다 */
const clamp = (s, n) => chars(s).slice(0, n).join("");

/** 제어문자(줄바꿈 제외) */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * 저장용 정리: NFC 정규화 + 제어문자 제거(줄바꿈만 허용) + 과한 빈 줄 축소.
 * 이모지는 그대로 통과시킨다.
 */
function clean(input, opts) {
  const multiline = Boolean(opts && opts.multiline);
  let s = String(input == null ? "" : input).normalize("NFC");
  s = s.replace(/\r\n?/g, "\n");
  s = s.replace(CONTROL_CHARS, "");
  if (!multiline) s = s.replace(/\n/g, " ");
  else s = s.replace(/\n{4,}/g, "\n\n\n");
  return s.replace(/[ \t]+$/gm, "").trim();
}

/* ---------------------------------------------------------------- 저장소 */

/** 파일 쓰기 직렬화용 큐 — 동시 요청이 서로의 저장을 덮어쓰지 않게 한다. */
let writeChain = Promise.resolve();

async function readJson(file, fallback) {
  try {
    const raw = await readFile(file, "utf8"); // ← 인코딩 명시(한글 보존)
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (err) {
    if (err.code !== "ENOENT") console.error("[guestbook] " + file + " 읽기 실패:", err.message);
    return fallback;
  }
}

/** 임시 파일에 쓴 뒤 rename — 저장 중 프로세스가 죽어도 파일이 반쯤 쓰이지 않는다. */
async function writeJsonAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = file + "." + process.pid + ".tmp";
  // 한글/이모지를 \uXXXX 로 escape 하지 않고 그대로 저장한다.
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await rename(tmp, file);
}

const loadList = () => readJson(LIST_FILE, { messages: [] })
  .then((d) => (Array.isArray(d.messages) ? d : { messages: [] }));
const loadAuth = () => readJson(AUTH_FILE, {});

/** 읽기 → 수정 → 쓰기를 한 덩어리로 실행 (큐에 태워 직렬화) */
function mutate(fn) {
  const next = writeChain.then(async () => {
    const list = await loadList();
    const auth = await loadAuth();
    const result = await fn(list, auth);
    if (result && result.dirty) {
      await writeJsonAtomic(LIST_FILE, list);
      await writeJsonAtomic(AUTH_FILE, auth);
    }
    return result;
  });
  // 실패해도 체인이 끊기지 않게
  writeChain = next.then(() => undefined, () => undefined);
  return next;
}

/* -------------------------------------------------------------- 비밀번호 */

function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(pw).normalize("NFC"), salt, 32);
  return "scrypt$" + salt.toString("hex") + "$" + hash.toString("hex");
}

function verifyPassword(pw, stored) {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const expected = Buffer.from(parts[2], "hex");
    if (!expected.length) return false;
    const actual = scryptSync(String(pw).normalize("NFC"), Buffer.from(parts[1], "hex"), expected.length);
    return timingSafeEqual(expected, actual);
  } catch (e) {
    return false;
  }
}

/* -------------------------------------------------------------- HTTP 유틸 */

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((done, reject) => {
    const parts = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("본문이 너무 큽니다."), { status: 413 }));
        req.destroy();
        return;
      }
      parts.push(chunk);
    });
    req.on("end", () => {
      // 청크를 모두 합친 뒤 한 번에 디코딩해야 멀티바이트 문자가 안 깨진다.
      const text = Buffer.concat(parts).toString("utf8");
      if (!text.trim()) return done({});
      try {
        done(JSON.parse(text));
      } catch (e) {
        reject(Object.assign(new Error("JSON 형식이 아닙니다."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

const publicView = (m) => ({ id: m.id, name: m.name, message: m.message, createdAt: m.createdAt });

/* ------------------------------------------------------------- 방명록 API */

const lastPostAt = new Map(); // ip → timestamp

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function nextId(messages) {
  const max = messages.reduce((acc, m) => Math.max(acc, Number(m.id) || 0), 0);
  return String(max + 1);
}

async function handleList(req, res, url) {
  const data = await loadList();
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Math.min(100, rawLimit > 0 ? rawLimit : 10);
  const ordered = data.messages.slice().reverse(); // 최신순
  sendJson(res, 200, {
    total: ordered.length,
    offset: offset,
    limit: limit,
    items: ordered.slice(offset, offset + limit).map(publicView),
  });
}

async function handleCreate(req, res) {
  const body = await readBody(req);
  const name = clamp(clean(body.name), MAX_NAME);
  const message = clamp(clean(body.message, { multiline: true }), MAX_MESSAGE);
  const password = String(body.password == null ? "" : body.password);

  if (!name) return sendJson(res, 400, { error: "이름을 입력해 주세요." });
  if (!message) return sendJson(res, 400, { error: "축하 메시지를 입력해 주세요." });
  if (!/^\d{4}$/.test(password)) return sendJson(res, 400, { error: "비밀번호는 숫자 4자리로 입력해 주세요." });

  const ip = clientIp(req);
  const now = Date.now();
  const prev = lastPostAt.get(ip);
  if (prev && now - prev < POST_COOLDOWN_MS) {
    return sendJson(res, 429, { error: "잠시 후 다시 시도해 주세요." });
  }

  const created = await mutate((list, auth) => {
    // 전송 버튼 중복 클릭으로 같은 글이 두 번 올라가는 것 방지
    const dup = list.messages.some((m) => m.name === name && m.message === message);
    if (dup) return { dirty: false, duplicate: true };
    const item = {
      id: nextId(list.messages),
      name: name,
      message: message,
      createdAt: new Date().toISOString(),
    };
    list.messages.push(item);
    auth[item.id] = hashPassword(password);
    return { dirty: true, item: item };
  });

  if (created.duplicate) return sendJson(res, 409, { error: "이미 등록된 메시지입니다." });
  lastPostAt.set(ip, now);
  sendJson(res, 201, { item: publicView(created.item) });
}

async function handleDelete(req, res, id) {
  const body = await readBody(req);
  const password = String(body.password == null ? "" : body.password);
  const isAdmin = Boolean(ADMIN_KEY) && password === ADMIN_KEY;

  const result = await mutate((list, auth) => {
    const idx = list.messages.findIndex((m) => String(m.id) === id);
    if (idx === -1) return { dirty: false, notFound: true };
    if (!isAdmin && !verifyPassword(password, auth[id])) return { dirty: false, denied: true };
    list.messages.splice(idx, 1);
    delete auth[id];
    return { dirty: true };
  });

  if (result.notFound) return sendJson(res, 404, { error: "메시지를 찾을 수 없습니다." });
  if (result.denied) return sendJson(res, 403, { error: "비밀번호가 일치하지 않습니다." });
  sendJson(res, 200, { ok: true });
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
    return res.end();
  }

  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/api/guestbook") {
    if (req.method === "GET") return handleList(req, res, url);
    if (req.method === "POST") return handleCreate(req, res);
    return sendJson(res, 405, { error: "허용되지 않는 요청입니다." });
  }
  const m = path.match(/^\/api\/guestbook\/([^/]+)$/);
  if (m) {
    if (req.method === "DELETE") return handleDelete(req, res, decodeURIComponent(m[1]));
    return sendJson(res, 405, { error: "허용되지 않는 요청입니다." });
  }
  return sendJson(res, 404, { error: "없는 API 입니다." });
}

/* ------------------------------------------------------------- 정적 파일 */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

async function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (e) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("잘못된 주소입니다.");
  }
  if (pathname.endsWith("/")) pathname += "index.html";

  const target = resolve(ROOT, "." + pathname);
  // 루트 밖 접근 차단 + 서버 전용 파일(비밀번호 해시) 노출 차단
  if (target !== ROOT && target.indexOf(ROOT + "/") !== 0) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("접근할 수 없습니다.");
  }
  if (target.indexOf(join(ROOT, "data") + "/") === 0 || /(^|\/)\.[^/]/.test(pathname)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("찾을 수 없습니다.");
  }

  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      res.writeHead(302, { Location: pathname.replace(/\/*$/, "/") });
      return res.end();
    }
    res.writeHead(200, {
      "Content-Type": MIME[extname(target).toLowerCase()] || "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": "no-cache",
    });
    createReadStream(target).pipe(res);
  } catch (e) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("찾을 수 없습니다.");
  }
}

/* ------------------------------------------------------------------ 서버 */

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const done = url.pathname.indexOf("/api/") === 0
    ? handleApi(req, res, url)
    : serveStatic(req, res, url);

  Promise.resolve(done).catch((err) => {
    console.error("[server]", err);
    if (res.headersSent) return res.end();
    sendJson(res, (err && err.status) || 500, { error: (err && err.message) || "서버 오류가 발생했습니다." });
  });
});

server.listen(PORT, () => {
  console.log("청첩장 서버: http://localhost:" + PORT);
  console.log("축하 메시지 저장 파일: " + LIST_FILE);
});
