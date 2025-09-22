// lib/kv.ts
import { kv as baseKv } from "@vercel/kv";

// Detect either Vercel KV-style or Upstash-style envs.
const haveKVNames =
  !!process.env.KV_REST_API_URL &&
  (!!process.env.KV_REST_API_TOKEN || !!process.env.KV_REST_API_READ_ONLY_TOKEN);

const haveUpstashNames =
  !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

// If only Upstash vars exist, map them to KV_* so @vercel/kv works.
if (!haveKVNames && haveUpstashNames) {
  process.env.KV_REST_API_URL = process.env.UPSTASH_REDIS_REST_URL!;
  process.env.KV_REST_API_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;
  process.env.KV_URL = process.env.UPSTASH_REDIS_REST_URL!;
}

export const hasKV =
  haveKVNames ||
  haveUpstashNames ||
  (process.env.KV_URL &&
    (process.env.KV_REST_API_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN));

export const kv = baseKv;
