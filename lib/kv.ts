// lib/kv.ts
import { kv as baseKv } from "@vercel/kv";

// Detect either Vercel KV-style or Upstash-style envs.
// @vercel/kv reads KV_* automatically; if only UPSTASH_* exist, map them.
const haveKVNames =
  !!process.env.KV_REST_API_URL &&
  (!!process.env.KV_REST_API_TOKEN || !!process.env.KV_REST_API_READ_ONLY_TOKEN);

const haveUpstashNames =
  !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

// If only Upstash vars exist, map them to KV_* so @vercel/kv works out of the box.
if (!haveKVNames && haveUpstashNames) {
  process.env.KV_REST_API_URL = process.env.UPSTASH_REDIS_REST_URL!;
  process.env.KV_REST_API_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;
  // Optional: some older helpers look for KV_URL — set it too
  process.env.KV_URL = process.env.UPSTASH_REDIS_REST_URL!;
}

export const hasKV =
  haveKVNames ||
  haveUpstashNames ||
  (process.env.KV_URL &&
    (process.env.KV_REST_API_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN));

export const kv = baseKv;
