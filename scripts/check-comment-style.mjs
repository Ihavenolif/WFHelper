#!/usr/bin/env node
// Comment gate for added diff lines, with --all for the tracked codebase.
// Modes: --staged, --range <a>..<b>, --ci, and --all.

import { execFileSync } from "node:child_process";

import { resolveRange } from "./commit-range.mjs";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
// Enough room to explain a real "why" - a hardware quirk, a vendor bug, the
// reason an obvious approach was rejected. Past this it wants to be a doc.
// Advisory only: this runs from `pnpm run check:comments`, never a hook or CI,
// so it never blocks a contributor who has more to say.
const MAX_RUN_LINES = 4;
const CODE_FILE_RE = /\.(ts|js|mjs|cjs|svelte|css)$/;
const EXCLUDED_FILES = new Set(["backend/worker/worker-configuration.d.ts"]);
const DIRECTIVE_RE = /^\/[/*]\s*(eslint|@ts-|prettier-ignore|global\b|c8 |v8 |istanbul|knip)/;
const BANNER_RE = /[=\-*#_~]{4,}/;
const STEP_RE = /^\/\/\s*step\s*\d/i;
const EM_DASH_RE = /\u2014/;
const NON_ASCII_RE = /[^\p{ASCII}]/u;
// Mask strings before looking for comment markers such as URLs.
const LITERAL_RE = /(["'`])(?:\\.|(?!\1)[^\\])*\1/g;
const REGEXP_LITERAL_RE = /(^|[=(,:![{;]\s*)(\/(?![/*])(?:\\.|[^/\\\r\n])+\/[dgimsuvy]*)/g;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function diffSelection() {
  const mode = process.argv[2] || "--staged";
  if (mode === "--staged") {
    return { primary: ["diff", "--cached", "-U3", "--diff-filter=ACMR"] };
  }
  if (mode === "--range") {
    const range = process.argv[3];
    if (!range) throw new Error("--range needs <base>..<head>");
    return { primary: ["diff", "-U3", "--diff-filter=ACMR", range] };
  }
  if (mode === "--all") {
    return { primary: ["diff", "-U0", "--diff-filter=ACMR", EMPTY_TREE] };
  }
  if (mode !== "--ci") throw new Error(`unknown mode ${mode}`);

  const range = resolveRange();
  const sep = range.symmetric ? "..." : "..";
  return {
    primary: range.base
      ? ["diff", "-U3", "--diff-filter=ACMR", `${range.base}${sep}${range.head}`]
      : null,
    fallbackToHead: range.fallbackToHead,
    head: range.head,
  };
}

function maskLiterals(text) {
  return text
    .replace(LITERAL_RE, (literal) => " ".repeat(literal.length))
    .replace(REGEXP_LITERAL_RE, (_match, prefix, literal) => {
      return `${prefix}${" ".repeat(literal.length)}`;
    });
}

function firstComment(text) {
  const bare = maskLiterals(text);
  const matches = [
    { kind: "line", at: bare.indexOf("//") },
    { kind: "block", at: bare.indexOf("/*") },
    { kind: "html", at: bare.indexOf("<!--") },
  ].filter((candidate) => candidate.at >= 0);
  matches.sort((a, b) => a.at - b.at);
  return matches[0] ?? null;
}

function closeMarker(kind) {
  return kind === "block" ? "*/" : "-->";
}

function collectRuns(diff) {
  const runs = [];
  const inline = [];
  let file = null;
  let lineNumber = 0;
  let current = null;
  let blockKind = null;

  const flush = () => {
    if (current) runs.push(current);
    current = null;
  };

  const append = (text, kind) => {
    if (current && current.kind !== kind) flush();
    if (!current) current = { file, line: lineNumber, kind, lines: [] };
    current.lines.push(text.trim());
  };

  const observeContext = (text) => {
    flush();
    if (blockKind) {
      if (maskLiterals(text).includes(closeMarker(blockKind))) blockKind = null;
      return;
    }
    const comment = firstComment(text);
    if (!comment || comment.kind === "line") return;
    const fragment = text.slice(comment.at);
    if (!maskLiterals(fragment).includes(closeMarker(comment.kind))) blockKind = comment.kind;
  };

  const collectAdded = (text) => {
    const masked = maskLiterals(text);
    const trimmed = text.trim();
    if (blockKind) {
      append(text, blockKind);
      if (masked.includes(closeMarker(blockKind))) {
        blockKind = null;
        flush();
      }
      return;
    }

    const fullLine = firstComment(trimmed);
    if (fullLine?.at === 0) {
      if (fullLine.kind === "line") {
        append(text, "line");
        return;
      }
      append(text, fullLine.kind);
      if (maskLiterals(trimmed).includes(closeMarker(fullLine.kind))) {
        flush();
      } else {
        blockKind = fullLine.kind;
      }
      return;
    }

    const jsdocContinuation = /^\*(\s|$)/.test(trimmed) && !trimmed.includes("{");
    if (trimmed.startsWith("*/") || jsdocContinuation) {
      append(text, "block");
      if (trimmed.includes("*/")) flush();
      return;
    }
    if (trimmed.startsWith("-->")) {
      append(text, "html");
      flush();
      return;
    }

    flush();
    const trailing = firstComment(text);
    if (!trailing) return;
    const fragment = text.slice(trailing.at);
    if (trailing.kind === "line" || maskLiterals(fragment).includes(closeMarker(trailing.kind))) {
      inline.push({ file, line: lineNumber, text: fragment });
      return;
    }
    append(fragment, trailing.kind);
    blockKind = trailing.kind;
  };

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      flush();
      blockKind = null;
      const target = raw.slice(4).trim();
      file = target === "/dev/null" ? null : target.replace(/^b\//, "");
      if (file && (!CODE_FILE_RE.test(file) || EXCLUDED_FILES.has(file))) file = null;
      continue;
    }
    if (raw.startsWith("@@")) {
      flush();
      blockKind = null;
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
      lineNumber = match ? Number(match[1]) : 0;
      continue;
    }
    if (!file || raw.startsWith("---")) continue;
    if (raw.startsWith("+")) {
      collectAdded(raw.slice(1));
      lineNumber += 1;
      continue;
    }
    if (raw.startsWith(" ")) {
      observeContext(raw.slice(1));
      lineNumber += 1;
      continue;
    }
    if (raw.startsWith("-")) flush();
  }

  flush();
  return { runs, inline };
}

function auditGlyphs(line, at, problems) {
  if (EM_DASH_RE.test(line)) {
    problems.push(`${at}: em dash in a comment - use plain punctuation`);
  } else if (NON_ASCII_RE.test(line)) {
    problems.push(`${at}: non-ASCII character in a comment`);
  }
  if (BANNER_RE.test(line)) problems.push(`${at}: banner comment - drop the rule line`);
  if (STEP_RE.test(line)) problems.push(`${at}: numbered "Step N" comment - let the code say it`);
}

function auditRun(run, problems) {
  const at = `${run.file}:${run.line}`;
  if (run.lines.length > MAX_RUN_LINES && !run.lines.every((line) => DIRECTIVE_RE.test(line))) {
    problems.push(`${at}: comment is ${run.lines.length} lines, max ${MAX_RUN_LINES}`);
  }
  for (const line of run.lines) auditGlyphs(line, at, problems);
}

const selection = diffSelection();
let diff = selection.primary ? git(selection.primary) : "";
if (!diff.trim() && selection.fallbackToHead) {
  diff = git(["show", "--format=", "--root", "-U3", "--diff-filter=ACMR", selection.head]);
}

const problems = [];
const { runs, inline } = collectRuns(diff);
for (const run of runs) auditRun(run, problems);
for (const comment of inline) {
  auditGlyphs(comment.text, `${comment.file}:${comment.line}`, problems);
}

if (problems.length > 0) {
  console.error("\ncomment style problems:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("\nrules: max 2 lines per comment; ASCII only; no banners or step numbering\n");
  process.exit(1);
}

console.log("check-comment-style: OK");
