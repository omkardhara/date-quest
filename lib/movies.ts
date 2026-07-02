import { readFileSync } from "fs";
import { join } from "path";
import { MovieInfo } from "./types";

let _cache: MovieInfo[] | null = null;

function loadMovies(): MovieInfo[] {
  if (_cache) return _cache;
  try {
    const raw = readFileSync(join(process.cwd(), "data", "movies-cache.json"), "utf-8");
    const data = JSON.parse(raw) as { movies?: MovieInfo[] };
    _cache = Array.isArray(data.movies) ? data.movies : [];
  } catch {
    _cache = [];
  }
  return _cache;
}

// Pick a random movie from the running list.
// On a romantic/date plan, prefer Romance/Drama genres if available.
export function pickMovie(preferGenres?: string[]): MovieInfo | undefined {
  const movies = loadMovies();
  if (!movies.length) return undefined;

  if (preferGenres?.length) {
    const matching = movies.filter((m) =>
      preferGenres.some((g) => (m.genre ?? "").toLowerCase().includes(g.toLowerCase()))
    );
    if (matching.length > 0) {
      return matching[Math.floor(Math.random() * matching.length)];
    }
  }

  return movies[Math.floor(Math.random() * movies.length)];
}
