const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const PORT = Number(process.env.PORT || 10000);
const TMDB_TOKEN = process.env.TMDB_TOKEN || "";

const manifest = {
  id: "pl.polstream.metadata",
  version: "0.3.0",
  name: "PolStream",
  description: "Filmy i seriale z polskimi metadanymi z TMDB.",
  resources: [
    "catalog",
    { name: "meta", types: ["movie", "series"], idPrefixes: ["tmdb:"] }
  ],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "polstream-movies",
      name: "PolStream – Filmy",
      extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false }
      ]
    },
    {
      type: "series",
      id: "polstream-series",
      name: "PolStream – Seriale",
      extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false }
      ]
    }
  ]
};

const builder = new addonBuilder(manifest);

async function tmdb(path, params = {}) {
  if (!TMDB_TOKEN) throw new Error("Brak TMDB_TOKEN");
  const url = new URL("https://api.themoviedb.org/3" + path);
  for (const [k, v] of Object.entries({ language: "pl-PL", ...params })) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TMDB_TOKEN}`,
      accept: "application/json"
    }
  });
  if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
  return res.json();
}

function image(path, size = "w500") {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;
}

function preview(item, type) {
  return {
    id: `tmdb:${type}:${item.id}`,
    type,
    name: type === "movie"
      ? (item.title || item.original_title)
      : (item.name || item.original_name),
    poster: image(item.poster_path),
    background: image(item.backdrop_path, "w1280"),
    description: item.overview || "",
    releaseInfo: (item.release_date || item.first_air_date || "").slice(0, 4)
  };
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if ((type === "movie" && id !== "polstream-movies") ||
      (type === "series" && id !== "polstream-series")) {
    return { metas: [] };
  }

  try {
    const kind = type === "movie" ? "movie" : "tv";
    const page = Math.floor(Number(extra?.skip || 0) / 20) + 1;
    let results = [];

    if (extra?.search) {
      const pl = await tmdb(`/search/${kind}`, {
        query: extra.search, page, language: "pl-PL"
      });
      const en = await tmdb(`/search/${kind}`, {
        query: extra.search, page, language: "en-US"
      });
      const seen = new Set();
      for (const item of [...(pl.results || []), ...(en.results || [])]) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          results.push(item);
        }
      }
    } else {
      const data = await tmdb(`/${kind}/popular`, { page });
      results = data.results || [];
    }

    return { metas: results.map(x => preview(x, type)) };
  } catch (e) {
    console.error(e);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ type, id }) => {
  const parts = id.split(":");
  if (parts[0] !== "tmdb") return { meta: null };

  try {
    if (type === "movie" && parts.length === 3) {
      const data = await tmdb(`/movie/${parts[2]}`, {
        append_to_response: "credits"
      });
      const meta = preview(data, "movie");
      meta.id = id;
      meta.genres = (data.genres || []).map(g => g.name);
      if (data.runtime) meta.runtime = data.runtime;
      if (data.credits?.cast) {
        meta.cast = data.credits.cast.slice(0, 20).map(x => x.name);
      }
      return { meta };
    }

    if (type === "series" && parts.length === 3) {
      const data = await tmdb(`/tv/${parts[2]}`);
      const meta = preview(data, "series");
      meta.id = id;
      meta.genres = (data.genres || []).map(g => g.name);

      const videos = [];
      for (const season of (data.seasons || [])) {
        if (season.season_number === 0 || !season.episode_count) continue;
        const seasonData = await tmdb(
          `/tv/${parts[2]}/season/${season.season_number}`
        );
        for (const ep of (seasonData.episodes || [])) {
          videos.push({
            id: `tmdb:series:${parts[2]}:s${season.season_number}e${ep.episode_number}`,
            title: ep.name || `Odcinek ${ep.episode_number}`,
            season: ep.season_number,
            episode: ep.episode_number,
            overview: ep.overview || "",
            released: ep.air_date
              ? `${ep.air_date}T00:00:00.000Z`
              : undefined,
            thumbnail: image(ep.still_path, "w780")
          });
        }
      }

      meta.videos = videos;
      return { meta };
    }

    return { meta: null };
  } catch (e) {
    console.error(e);
    return { meta: null };
  }
});

serveHTTP(builder.getInterface(), {
  port: PORT,
  host: "0.0.0.0"
});

console.log(`PolStream listening on 0.0.0.0:${PORT}`);
