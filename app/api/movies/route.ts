import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { MovieInfo } from "@/lib/types";

let _cache: MovieInfo[] | null = null;
let _cacheTime = 0;
const TTL = 4 * 60 * 60 * 1000; // 4 hours

function loadMovies(): MovieInfo[] {
  const now = Date.now();
  if (_cache && now - _cacheTime < TTL) return _cache;
  try {
    const raw = readFileSync(join(process.cwd(), "data", "movies-cache.json"), "utf-8");
    const data = JSON.parse(raw) as { movies?: MovieInfo[] };
    _cache = Array.isArray(data.movies) ? data.movies : [];
  } catch {
    _cache = [];
  }
  _cacheTime = now;
  return _cache;
}

export async function GET() {
  const movies = loadMovies();
  return NextResponse.json(movies, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" },
  });
}
