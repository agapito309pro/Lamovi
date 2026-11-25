/// <reference path="./kino.d.ts" />
/**
 * Javtiful — Kino plugin v1.0.1
 * Author: Hotaru Yume / hotaruyume
 * Fuente: javtiful.com
 * - Listados HTML (video-card): recientes, uncensored, reducing mosaic, school girls, popular
 * - categories: adult (solo visible con control parental desactivado)
 * - Búsqueda /search?q=
 * - Resolve: ticket de la página → POST /video/{id}/playback (cookies) → MP4 firmado
 * - Evita cards partner/script (ads)
 * - Miniaturas 640×360 (16:9); Home ligero + Ver más al máximo de la página
 * - MP4 progresivo (teléfono y TV)
 */

const BASE = "https://javtiful.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const HOME_ROW = 12;
const MAX_PAGE = 48;

const AD_RE =
  /\b(sponsored|sponsor|advert|promo code|trafficjunky|exoclick|juicyads|outbrain|taboola|click here|buy now|discount|affiliate)\b/i;

/** Home rows: path is relative to BASE */
const SECTIONS = [
  { id: "latest", title: "Recientes", path: "/videos?sort=latest" },
  { id: "uncensored", title: "Uncensored", path: "/uncensored" },
  { id: "reducing-mosaic", title: "Reducing Mosaic", path: "/reducing-mosaic" },
  { id: "school-girls", title: "School Girls", path: "/category/school-girls" },
  { id: "popular-week", title: "Popular esta semana", path: "/videos?sort=popular_week" },
  { id: "most-viewed", title: "Más vistos", path: "/videos?sort=most_viewed" },
  { id: "big-tits", title: "Big Tits", path: "/category/big-tits" },
  { id: "beautiful-girl", title: "Beautiful Girl", path: "/category/beautiful-girl" },
];

function log() {
  try {
    if (typeof kino !== "undefined" && kino.log) {
      kino.log.apply(kino, arguments);
    }
  } catch (e) {}
}

function hdr(extra) {
  var h = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
    Referer: BASE + "/",
  };
  if (extra) {
    for (var k in extra) h[k] = extra[k];
  }
  return h;
}

function strip(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(u) {
  if (!u) return "";
  u = String(u).replace(/&amp;/g, "&").trim();
  if (!u || u.indexOf("data:") === 0) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.indexOf("http") === 0) return u;
  if (u.charAt(0) === "/") return BASE + u;
  return BASE + "/" + u;
}

function isAdTitle(title) {
  return AD_RE.test(title || "");
}

/**
 * Parse listing HTML into items.
 * Skips partner/script ad cards.
 */
function parseListing(html) {
  var items = [];
  var seen = {};
  if (!html) return items;

  // Split by article.video-card blocks
  var re = /<article[^>]*class="([^"]*video-card[^"]*)"[^>]*>([\s\S]*?)<\/article>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var cls = m[1] || "";
    var block = m[2] || "";
    // Skip ad / partner embeds
    if (/video-card--partner|video-card--script|video-card--ad/i.test(cls)) continue;

    var hrefM = block.match(/href=["'](\/video\/(\d+)\/([a-z0-9\-]+))["']/i);
    if (!hrefM) continue;
    var id = hrefM[2];
    if (seen[id]) continue;
    seen[id] = true;

    var slug = hrefM[3];
    var titleM =
      block.match(/video-card__title[^>]*title=["']([^"']+)["']/i) ||
      block.match(/video-card__title[^>]*>([^<]+)/i) ||
      block.match(/alt=["']Thumbnail for ([^"']+)["']/i);
    var title = strip(titleM ? titleM[1] : slug.replace(/-/g, " "));
    if (!title || isAdTitle(title)) continue;

    var poster = "";
    var imgM =
      block.match(/data-front-lazy-src=["']([^"']+)["']/i) ||
      block.match(/data-src=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i) ||
      block.match(/src=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
    if (imgM) poster = absUrl(imgM[1]);
    if (poster && /placeholder|svg|data:image/i.test(poster)) poster = "";

    var dur = "";
    var durM = block.match(/video-card__details[^>]*>[\s\S]*?<strong>[^<]*<\/strong>\s*([0-9:]+)/i);
    if (durM) dur = durM[1].trim();

    var item = {
      id: id,
      ref: id + "|" + slug,
      title: title.slice(0, 200),
      kind: "movie",
      poster: poster || undefined,
      adult: true,
      posterAspect: "16:9",
    };
    if (dur) item.duration = dur;
    items.push(item);
    if (items.length >= MAX_PAGE) break;
  }

  // Regex fallback if article split failed
  if (!items.length) {
    var re2 = /href=["'](\/video\/(\d+)\/([a-z0-9\-]+))["'][^>]*>[\s\S]{0,400}?data-front-lazy-src=["']([^"']+)["'][\s\S]{0,600}?video-card__title[^>]*>([^<]+)/gi;
    var m2;
    while ((m2 = re2.exec(html)) !== null) {
      var id2 = m2[2];
      if (seen[id2]) continue;
      seen[id2] = true;
      var title2 = strip(m2[5]);
      if (!title2 || isAdTitle(title2)) continue;
      items.push({
        id: id2,
        ref: id2 + "|" + m2[3],
        title: title2.slice(0, 200),
        kind: "movie",
        poster: absUrl(m2[4]) || undefined,
        adult: true,
        posterAspect: "16:9",
      });
      if (items.length >= MAX_PAGE) break;
    }
  }

  return items;
}

function nextPageFromHtml(html, currentPath) {
  // /videos?page=2 or /search?page=2&q=...
  var nextRel = html.match(/rel=["']next["'][^>]*href=["']([^"']+)["']/i);
  if (nextRel) return absUrl(nextRel[1].replace(/&amp;/g, "&"));

  var pageLinks = html.match(/href=["']([^"']*page=\d+[^"']*)["']/gi) || [];
  var curPage = 1;
  var pageM = String(currentPath || "").match(/[?&]page=(\d+)/i);
  if (pageM) curPage = parseInt(pageM[1], 10) || 1;

  var best = null;
  var bestPage = curPage;
  for (var i = 0; i < pageLinks.length; i++) {
    var hm = pageLinks[i].match(/href=["']([^"']+)["']/i);
    if (!hm) continue;
    var href = hm[1].replace(/&amp;/g, "&");
    var pm = href.match(/[?&]page=(\d+)/i);
    if (!pm) continue;
    var p = parseInt(pm[1], 10);
    if (p === curPage + 1) {
      best = href;
      break;
    }
    if (p > bestPage) {
      bestPage = p;
      best = href;
    }
  }
  if (best && bestPage === curPage + 1) return absUrl(best);

  // Construct next page
  if (curPage > 0 && curPage < 500) {
    var base = String(currentPath || "/videos");
    if (/[?&]page=\d+/i.test(base)) {
      return absUrl(base.replace(/([?&]page=)\d+/i, "$1" + (curPage + 1)));
    }
    var join = base.indexOf("?") >= 0 ? "&" : "?";
    return absUrl(base + join + "page=" + (curPage + 1));
  }
  return null;
}

async function fetchHtml(pathOrUrl) {
  var url = pathOrUrl.indexOf("http") === 0 ? pathOrUrl : BASE + pathOrUrl;
  var r = await kino.fetch(url, {
    headers: hdr(),
    cookies: true,
    timeoutMs: 18000,
  });
  if (!r.ok) throw new Error("javtiful HTTP " + r.status);
  return await r.text();
}

async function listPage(path) {
  var html = await fetchHtml(path);
  var items = parseListing(html);
  var next = nextPageFromHtml(html, path);
  return { items: items, next: next || undefined };
}

export async function search(query) {
  var q = strip((query && query.q) || "");
  if (!q) return [];
  var page = 1;
  if (query && query.cursor) {
    var n = parseInt(String(query.cursor), 10);
    if (n > 0) page = n;
  }
  var path = "/search?q=" + encodeURIComponent(q);
  if (page > 1) path += "&page=" + page;
  try {
    var result = await listPage(path);
    var nextPage = null;
    if (result.next) {
      var pm = String(result.next).match(/[?&]page=(\d+)/i);
      if (pm) nextPage = pm[1];
      else if (page < 50) nextPage = String(page + 1);
    }
    if (nextPage) return { items: result.items, next: nextPage };
    return result.items;
  } catch (e) {
    log("search failed", e && e.message);
    throw e;
  }
}

export async function home() {
  var rows = [];
  for (var i = 0; i < SECTIONS.length; i++) {
    var sec = SECTIONS[i];
    try {
      var result = await listPage(sec.path);
      if (result.items && result.items.length) {
        rows.push({
          id: sec.id,
          title: sec.title,
          items: result.items.slice(0, HOME_ROW),
          ref: "list:" + sec.path,
        });
      }
    } catch (e) {
      log("home section", sec.id, e && e.message);
    }
  }
  return rows;
}

export async function browse(ref, cursor) {
  var path = "";
  var r = String(ref || "");
  if (r.indexOf("list:") === 0) {
    path = r.slice(5);
  } else if (r.charAt(0) === "/") {
    path = r;
  } else {
    path = "/videos?sort=latest";
  }

  // cursor can be full next URL or page number
  if (cursor) {
    var c = String(cursor);
    if (c.indexOf("http") === 0 || c.charAt(0) === "/") {
      path = c.indexOf("http") === 0 ? c : c;
    } else {
      var pageNum = parseInt(c, 10);
      if (pageNum > 1) {
        if (/[?&]page=\d+/i.test(path)) {
          path = path.replace(/([?&]page=)\d+/i, "$1" + pageNum);
        } else {
          path += (path.indexOf("?") >= 0 ? "&" : "?") + "page=" + pageNum;
        }
      }
    }
  }

  try {
    var result = await listPage(path);
    return {
      items: result.items || [],
      next: result.next || undefined,
    };
  } catch (e) {
    log("browse failed", e && e.message);
    return { items: [] };
  }
}

/**
 * Resolve playable MP4:
 * 1) Load video page (cookies) → ticket
 * 2) Warm session via /csrf-token
 * 3) POST /video/{id}/playback with ticket
 * 4) Pick highest size (quality), prefer non-trailer
 */
export async function resolve(ref) {
  var parts = String(ref || "").split("|");
  var id = parts[0].trim();
  var slug = (parts[1] || "video").trim();
  if (!/^\d+$/.test(id)) throw new Error("ref inválido");

  var pagePath = "/video/" + id + "/" + slug;
  var pageUrl = BASE + pagePath;

  var html = await fetchHtml(pagePath);

  // Ticket from embedded player config
  var ticketM = html.match(/"ticket"\s*:\s*"([a-zA-Z0-9.]+)"/);
  if (!ticketM) {
    // slug might be wrong — try without relying on slug from listing
    var alt = html.match(/\/video\/\d+\/([a-z0-9\-]+)/i);
    if (alt && alt[1] !== slug) {
      slug = alt[1];
      pagePath = "/video/" + id + "/" + slug;
      pageUrl = BASE + pagePath;
      html = await fetchHtml(pagePath);
      ticketM = html.match(/"ticket"\s*:\s*"([a-zA-Z0-9.]+)"/);
    }
  }
  if (!ticketM) throw new Error("no se encontró ticket de reproducción");

  var ticket = ticketM[1];

  // Warm session cookie (Laravel session)
  try {
    await kino.fetch(BASE + "/csrf-token", {
      headers: hdr({
        Accept: "application/json",
        Referer: pageUrl,
      }),
      cookies: true,
      timeoutMs: 10000,
    });
  } catch (e) {
    log("csrf warm failed", e && e.message);
  }

  var endpoint = "/video/" + id + "/playback";
  // Prefer endpoint from page if present
  var epM = html.match(/"playback"\s*:\s*\{[^}]*"endpoint"\s*:\s*"([^"]+)"/);
  if (epM) endpoint = epM[1];

  var playRes = await kino.fetch(BASE + endpoint, {
    method: "POST",
    headers: hdr({
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Origin: BASE,
      Referer: pageUrl,
    }),
    body: "ticket=" + encodeURIComponent(ticket),
    cookies: true,
    timeoutMs: 20000,
  });

  var playText = await playRes.text();
  var data;
  try {
    data = JSON.parse(playText);
  } catch (e) {
    throw new Error("respuesta de playback inválida");
  }

  // Ticket renewal
  if (playRes.status === 409 && data && data.renewTicket) {
    ticket = String(data.renewTicket);
    playRes = await kino.fetch(BASE + endpoint, {
      method: "POST",
      headers: hdr({
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Origin: BASE,
        Referer: pageUrl,
      }),
      body: "ticket=" + encodeURIComponent(ticket),
      cookies: true,
      timeoutMs: 20000,
    });
    playText = await playRes.text();
    try {
      data = JSON.parse(playText);
    } catch (e2) {
      throw new Error("respuesta de playback inválida (renew)");
    }
  }

  if (!data || !data.success || !Array.isArray(data.sources) || !data.sources.length) {
    throw new Error(
      (data && data.message) || "no se encontraron streams reproducibles"
    );
  }

  // Pick best quality (highest size), skip empty
  var best = null;
  var bestSize = -1;
  for (var i = 0; i < data.sources.length; i++) {
    var s = data.sources[i];
    if (!s || !s.src) continue;
    var srcLower = String(s.src).toLowerCase();
    if (srcLower.indexOf("trailer") >= 0 || srcLower.indexOf("_tr.") >= 0) continue;
    var size = Number(s.size || 0);
    if (size > bestSize) {
      bestSize = size;
      best = s;
    } else if (!best) {
      best = s;
    }
  }
  if (!best) throw new Error("sin fuente de vídeo válida");

  var streamUrl = absUrl(best.src);
  // Prefer fallbackSrc if type is HLS and we want progressive (Kino TV often happier with mp4)
  if (best.fallbackSrc && /\.m3u8/i.test(streamUrl)) {
    streamUrl = absUrl(best.fallbackSrc);
  }

  var mime = "video/mp4";
  if (best.type && /mpegurl|m3u8/i.test(best.type)) mime = "application/x-mpegURL";
  if (/\.m3u8/i.test(streamUrl)) mime = "application/x-mpegURL";

  return {
    url: streamUrl,
    mime: mime,
    headers: {
      Referer: pageUrl,
      "User-Agent": UA,
      Origin: BASE,
    },
  };
}
