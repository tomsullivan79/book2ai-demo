#!/usr/bin/env node
// DOCX -> HTML (mammoth) -> Markdown (turndown) -> normalize -> chunk -> JSONL
// Enhancements:
// - Q&A detection works whether or not a "Questions & Answers" heading is recognized.
// - Heading match tolerant of &, &amp;, or "and", with/without colon.
// - Q/A markers: Q:, Q1:, **Q1:**, A:, A2:, **A2:**, etc.
// - Writes chunks.jsonl and qa.jsonl (if any pairs found), logs counts.

import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import Turndown from 'turndown';

if (process.argv.length < 4) {
  console.error('Usage: node scripts/op_docx_to_chunks.mjs <input.docx> <out_dir>');
  process.exit(1);
}

const input = process.argv[2];
const outDir = process.argv[3];

const MAX_CHARS = 1200; // soft cap for narrative chunks

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function normalizeMarkdown(md) {
  return md
    .replace(/\r/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function looksHeader(line) {
  // Atx headings only (what turndown emits for docx headings)
  const m = line.match(/^(#{1,6})\s+(.*)$/);
  if (!m) return null;
  return { level: m[1].length, text: m[2].trim() };
}

// Q/A markers (robust): Q, Q1, Q12 + ":" or "-" (with optional ** bold)
const qLine = (s) => /^\s*(\*\*?\s*)?q\d*\s*[:\-]/i.test(s);
const aLine = (s) => /^\s*(\*\*?\s*)?a\d*\s*[:\-]/i.test(s);

const stripQ = (s) => s.replace(/^\s*(\*\*?\s*)?q\d*\s*[:\-]\s*/i, '').trim();
const stripA = (s) => s.replace(/^\s*(\*\*?\s*)?a\d*\s*[:\-]\s*/i, '').trim();

// Detect a Q&A section heading text robustly (works for "&", "&amp;", or "and")
function isQaHeadingText(txt) {
  const t = txt.toLowerCase()
    .replace(/&amp;/g, '&') // normalize entity
    .replace(/\s+/g, ' ')
    .trim();
  return /questions\s*(?:&|and)\s*answers:?/.test(t);
}

(async () => {
  // 1) DOCX -> HTML
  const { value: html } = await mammoth.convertToHtml({ path: input });

  // 2) HTML -> Markdown
  const turndown = new Turndown({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  const md = turndown.turndown(html);

  // 3) Normalize
  const norm = normalizeMarkdown(md);
  const lines = norm.split('\n');

  // 4) Walk & build chunks
  const chunks = [];
  const qaIndex = [];

  let narrativeBuf = [];
  let cCounter = 1;
  let qaCounter = 1;

  let inQaSection = false;  // toggled whenever we see a QA heading
  let pendingQ = null;      // holds the original Q line
  let aBuf = [];            // collects A lines (can be multi-paragraph)

  function pushNarrative() {
    const text = narrativeBuf.join('\n').trim();
    if (!text) { narrativeBuf = []; return; }
    const id = `poker.c${String(cCounter).padStart(4, '0')}`;
    chunks.push({ id, page: null, type: 'text', text });
    narrativeBuf = [];
    cCounter++;
  }

  function pushQA(qLineText, aCombined) {
    const q = stripQ(qLineText);
    const a = stripA(aCombined.split('\n')[0]) + (aCombined.split('\n').slice(1).length ? '\n' + aCombined.split('\n').slice(1).join('\n') : '');
    if (!q || !a) return;
    const id = `poker.qa${String(qaCounter).padStart(4, '0')}`;
    const combined = `Q: ${q}\n\nA: ${a}`;
    chunks.push({ id, page: null, type: 'qa', q, a, text: combined });
    qaIndex.push({ id, q, a, source_chunk: id });
    qaCounter++;
  }

  const headerLevelsToBreak = new Set([1, 3, 4]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // If we’re currently collecting a Q, we look for A and capture it
    if (pendingQ) {
      if (aLine(line)) {
        aBuf = [line];
        // consume continuation lines until new header or next Q, or size cap
        i++;
        while (i < lines.length) {
          const look = lines[i];
          const hdr = looksHeader(look);
          if (hdr) { i--; break; }
          if (qLine(look)) { i--; break; } // next Q starts
          const prospective = aBuf.concat([look]).join('\n');
          if (prospective.length > MAX_CHARS * 1.8) break;
          aBuf.push(look);
          i++;
        }
        pushQA(pendingQ, aBuf.join('\n'));
        pendingQ = null;
        aBuf = [];
        continue;
      } else {
        // not an A line; if we hit a header or another Q, treat pending Q as narrative fallback
        const hdr = looksHeader(line);
        if (hdr || qLine(line)) {
          narrativeBuf.push(pendingQ);
          pendingQ = null;
          // re-process current line in outer logic
        } else {
          // random text slipped between Q and A → include in narrative
          narrativeBuf.push(line);
          continue;
        }
      }
    }

    // Heading?
    const hdr = looksHeader(line);
    if (hdr) {
      // Enter/exit QA section by heading contents (robust to &amp;/and)
      if (isQaHeadingText(hdr.text)) {
        pushNarrative();
        inQaSection = true;
      } else {
        if (headerLevelsToBreak.has(hdr.level)) pushNarrative();
        inQaSection = false;
      }
      narrativeBuf.push(line);
      continue;
    }

    // Q lines: start a QA pair — do this ALWAYS, not just in a QA section
    if (qLine(line)) {
      // close any running narrative first
      if (narrativeBuf.join('\n').trim()) pushNarrative();
      pendingQ = line;
      continue;
    }

    // narrative soft-split
    if ((narrativeBuf.join('\n').length + line.length + 1) > MAX_CHARS) {
      pushNarrative();
    }

    narrativeBuf.push(line);
  }

  // Flush any leftover pendingQ (no A found) as narrative
  if (pendingQ) {
    narrativeBuf.push(pendingQ);
    pendingQ = null;
  }
  pushNarrative();

  // 5) Write outputs
  ensureDir(outDir);
  const chunksPath = path.join(outDir, 'chunks.jsonl');
  const qaPath = path.join(outDir, 'qa.jsonl');

  const cw = fs.createWriteStream(chunksPath, { encoding: 'utf8' });
  for (const c of chunks) cw.write(JSON.stringify(c) + '\n');
  cw.end();

  if (qaIndex.length > 0) {
    const qw = fs.createWriteStream(qaPath, { encoding: 'utf8' });
    for (const q of qaIndex) qw.write(JSON.stringify(q) + '\n');
    qw.end();
  }

  const qaCount = qaIndex.length;
  const chunkCount = chunks.length;
  console.log(`Wrote ${chunkCount} chunks → ${chunksPath}`);
  console.log(qaCount > 0 ? `Wrote ${qaCount} QA pairs → ${qaPath}` : 'No QA pairs detected.');

  // Helpful debug hint if none found
  if (qaCount === 0) {
    console.log('\nTip: ensure Q/A lines look like "Q1:" / "A1:" (or **Q1:** / **A1:**).');
    console.log('Also verify the markdown actually contains headings like "### Questions & Answers:".');
  }
})();
