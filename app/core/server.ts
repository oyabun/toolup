// Turns one raw server entry, as a harness wrote it, into something comparable and safe to show.
import type { Transport } from "./types.ts";

export interface Server {
  transport: Transport;
  /** Identity across harnesses. */
  key: string;
  /** Safe to display: no query string, no credentials, secret-looking arguments masked. */
  target: string;
  /** The bare URL for remote servers (used to match the catalog), else null. */
  url: string | null;
  /** Local servers: the program that is run, without its folder or arguments. */
  bin: string | null;
  hasSecrets: boolean;
}

const MASK = "•••";
const SECRET_NAME = /(token|secret|password|passwd|api[-_]?key|apikey|auth|bearer|credential)/i;
const SECRET_VALUE = /^(sk-|ghp_|gho_|github_pat_|xox[abprs]-|eyJ|AKIA|glpat-)/;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** A URL without what may identify or authorise the user, and whether anything was removed. */
export function bareUrl(raw: string): { url: string; stripped: boolean } | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const stripped = !!(u.search || u.username || u.password);
  const path = u.pathname.replace(/\/+$/, "");
  return { url: `${u.protocol}//${u.host.toLowerCase()}${path}`, stripped };
}

function maskArgs(args: string[]): { args: string[]; masked: boolean } {
  let masked = false;
  const out = args.map((a, i) => {
    const prev = args[i - 1] || "";
    if (prev.startsWith("-") && !prev.includes("=") && SECRET_NAME.test(prev) && !a.startsWith("-")) { masked = true; return MASK; }
    const b = bareUrl(a);
    if (b) { if (b.stripped) masked = true; return b.url; }
    const eq = a.indexOf("=");
    if (eq > 0 && SECRET_NAME.test(a.slice(0, eq))) { masked = true; return `${a.slice(0, eq)}=${MASK}`; }
    if (SECRET_VALUE.test(a)) { masked = true; return MASK; }
    return a;
  });
  return { args: out, masked };
}

export function normalize(name: string, raw: unknown): Server {
  if (!isRecord(raw)) return { transport: "unknown", key: `name:${name}`, target: "", url: null, bin: null, hasSecrets: false };
  const carries = (v: unknown) => isRecord(v) && Object.keys(v).length > 0;
  let hasSecrets = carries(raw.env) || carries(raw.headers) || carries(raw.http_headers) || !!str(raw.bearer_token_env_var) || !!str(raw.bearer_token);

  const rawUrl = str(raw.url) || str(raw.httpUrl) || str(raw.serverUrl);
  if (rawUrl) {
    const b = bareUrl(rawUrl);
    const type = (str(raw.type) || str(raw.transport) || "").toLowerCase();
    const transport: Transport = type === "sse" || (!type && /\/sse$/.test(b?.url || "")) ? "sse" : "http";
    if (!b) return { transport, key: `name:${name}`, target: MASK, url: null, bin: null, hasSecrets: true };
    return { transport, key: `url:${b.url}`, target: b.url, url: b.url, bin: null, hasSecrets: hasSecrets || b.stripped };
  }

  const command = str(raw.command);
  if (command) {
    const rawArgs = Array.isArray(raw.args) ? raw.args.filter((a): a is string => typeof a === "string") : [];
    const { args, masked } = maskArgs(rawArgs);
    hasSecrets ||= masked;
    const target = [command, ...args].join(" ");
    // `npx mcp-remote <url>` is a remote server in a local wrapper: it is the same server as the URL itself
    const wrapped = /(^|[/@])mcp-remote(@|$)/.test(rawArgs.find((a) => !a.startsWith("-")) || "") ? args.find((a) => /^https?:\/\//.test(a)) : null;
    if (wrapped) return { transport: "http", key: `url:${wrapped}`, target, url: wrapped, bin: null, hasSecrets };
    const bin = command.split(/[\\/]/).pop() || command;
    const key = `cmd:${[bin, ...args.filter((a) => a !== "-y" && a !== "--yes")].join(" ")}`;
    return { transport: "stdio", key, target, url: null, bin, hasSecrets };
  }
  return { transport: "unknown", key: `name:${name}`, target: "", url: null, bin: null, hasSecrets };
}

/** JSON as harnesses and editors write it: comments and trailing commas allowed. */
export function parseJsonc(text: string): unknown {
  let out = "", i = 0;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1); i = j + 1;
    } else if (c === "/" && n === "/") { while (i < text.length && text[i] !== "\n") i++; }
    else if (c === "/" && n === "*") { const e = text.indexOf("*/", i + 2); i = e < 0 ? text.length : e + 2; }
    else { out += c; i++; }
  }
  // a comma followed only by whitespace and a closing bracket is a trailing comma
  out = out.replace(/"(?:[^"\\]|\\.)*"|,(\s*[}\]])/g, (m, close) => (close !== undefined ? close : m));
  return JSON.parse(out.replace(/^﻿/, ""));
}
