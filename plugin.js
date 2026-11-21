const BASE_URL = "https://lamovie.org";

// Cabeceras ultra-realistas de Chrome en Android para evitar detección de bot
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": BASE_URL + "/",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  "Sec-Ch-Ua-Mobile": "?1",
  "Sec-Ch-Ua-Platform": '"Android"',
  "Cache-Control": "max-age=0"
};

function log(...args) {
  try { kino.log("[LaMovie]", ...args); } catch (e) {}
}

async function getHtml(url) {
  log("Solicitando:", url);
  
  // Intentar usar cookies guardadas de sesiones anteriores (ej. cf_clearance)
  const savedCookies = kino.cookies.get("lamovie_session") || "";
  const headers = { ...HEADERS };
  if (savedCookies) headers["Cookie"] = savedCookies;

  const res = await kino.fetch(url, { headers });
  
  // Si el servidor devuelve nuevas cookies (como cf_clearance tras un desafío), guardarlas
  const setCookie = res.headers.get("set-cookie");
  if (setCookie && setCookie.includes("cf_clearance")) {
    const cfMatch = setCookie.match(/cf_clearance=([^;]+)/);
    if (cfMatch) {
      kino.cookies.set("lamovie_session", `cf_clearance=${cfMatch[1]}`, { ttlMs: 24 * 60 * 60 * 1000 });
      log("Cookie de Cloudflare guardada para futuras peticiones");
    }
  }

  if (!res.ok) {
    log("Error HTTP:", res.status, url);
    throw kino.error("unavailable", `Error del servidor (${res.status})`);
  }
  
  const text = await res.text();
  
  // Detección robusta de bloqueo
  if (text.includes("cloudflare") || text.includes("challenge") || text.includes("jschl") || text.includes("Checking your browser") || text.length < 5000) {
    log("Bloqueo Cloudflare detectado en:", url);
    throw kino.error("geo_blocked", "Cloudflare está bloqueando la petición. Consejo: Abre lamovie.org en el navegador de este dispositivo una vez para verificar que no eres un robot, y luego vuelve a intentar en el plugin.");
  }
  
  return text;
}

function decodeBase64(str) {
  try { return atob(str.replace(/-/g, '+').replace(/_/g, '/')); } 
  catch (e) { return str; }
}

function extractItemsFromHtml(html, kind) {
  const items = [];
  const seen = new Set();
  
  // Patrón principal
  const regex1 = /<a[^>]+href=["'](https:\/\/lamovie\.org\/(?:pelicula|serie|anime)\/[^"']+)["\'][^>]*>[\s\S]*?<img[^>]+(?:data-src|src)=["']([^"']+)["\'][^>]*>(?:[\s\S]*?<h[234][^>]*>([^<]+)<\/h[234]>|[\s\S]*?title=["']([^"']+)["'])?/gi;
  let match;
  while ((match = regex1.exec(html)) !== null) {
    const url = match[1];
    if (seen.has(url)) continue;
    seen.add(url);
    
    const poster = match[2].startsWith('http') ? match[2] : BASE_URL + match[2];
    const title = (match[3] || match[4] || url.split('/').pop()).replace(/\\|/g, '').replace(/\(\d{4}\)/, '').trim();
    
    items.push({
      id: url.replace(BASE_URL, '').replace(/\//g, '-').replace(/^-|-$/g, ''),
      ref: url,
      title: title,
      kind: kind || (url.includes('/serie/') || url.includes('/anime/') ? 'series' : 'movie'),
      poster: poster
    });
    
    if (items.length >= 30) break;
  }
  
  // Patrón de fallback más permisivo
  if (items.length === 0) {
    const regex2 = /href=["'](https:\/\/lamovie\.org\/(?:pelicula|serie|anime)\/[^"']+)["\'][\s\S]{0,300}?(?:data-src|src)=["']([^"']+)["\'][\s\S]{0,300}?>([^<]{3,50})</gi;
    while ((match = regex2.exec(html)) !== null) {
      const url = match[1];
      if (seen.has(url)) continue;
      seen.add(url);
      items.push({
        id: url.replace(BASE_URL, '').replace(/\//g, '-').replace(/^-|-$/g, ''),
        ref: url,
        title: match[3].trim(),
        kind: kind || (url.includes('/serie/') ? 'series' : 'movie'),
        poster: match[2].startsWith('http') ? match[2] : BASE_URL + match[2]
      });
      if (items.length >= 30) break;
    }
  }
  
  return items;
}

export async function home() {
  const rows = [];
  const categories = [
    { id: 'peliculas', title: 'Películas Recientes', url: BASE_URL + '/peliculas/', kind: 'movie' },
    { id: 'series', title: 'Series Recientes', url: BASE_URL + '/series/', kind: 'series' },
    { id: 'animes', title: 'Animes Recientes', url: BASE_URL + '/animes/', kind: 'series' }
  ];

  for (const cat of categories) {
    try {
      const html = await getHtml(cat.url);
      const items = extractItemsFromHtml(html, cat.kind);
      
      if (items.length > 0) {
        rows.push({ id: cat.id, title: cat.title, ref: cat.url, items: items });
      }
    } catch (e) {
      log("Error en", cat.title, ":", e.message);
      // Continuamos con las demás categorías en lugar de fallar todo el Home
    }
  }
  
  if (rows.length === 0) {
    throw kino.error("unavailable", "No se pudo cargar el contenido. El sitio está bloqueando peticiones. Abre lamovie.org en tu navegador primero para verificar que no eres un robot.");
  }
  
  return rows;
}

export async function search(query) {
  // Intento 1: API de WordPress (a veces no tiene protección Cloudflare)
  try {
    const apiUrl = BASE_URL + '/wp-json/wp/v2/posts?search=' + encodeURIComponent(query) + '&per_page=30';
    const res = await kino.fetch(apiUrl, { headers: HEADERS });
    if (res.ok) {
      const posts = await res.json();
      if (posts.length > 0) {
        return posts.map(post => ({
          id: String(post.id),
          ref: post.link,
          title: post.title.rendered.replace(/<[^>]+>/g, '').replace(/\\|/g, '').trim(),
          kind: 'movie',
          poster: post.jetpack_featured_media_url || (BASE_URL + '/wp-content/themes/lamovie/assets/images/no-image.jpg'),
          year: post.date ? post.date.substring(0, 4) : undefined
        }));
      }
    }
  } catch (e) {
    log("API de búsqueda falló, intentando HTML:", e.message);
  }

  // Intento 2: Búsqueda por HTML
  try {
    const searchUrl = BASE_URL + '/?s=' + encodeURIComponent(query);
    const html = await getHtml(searchUrl);
    const items = extractItemsFromHtml(html, null);
    if (items.length > 0) return items;
  } catch (e) {
    log("Búsqueda HTML falló:", e.message);
  }

  throw kino.error("not_found", `No se encontraron resultados o el sitio bloqueó la búsqueda.`);
}

export async function browse(ref, cursor) {
  const page = cursor ? parseInt(cursor, 10) : 1;
  const url = ref.includes('?') ? (ref + '&page=' + page) : (ref + (ref.endsWith('/') ? '' : '/') + 'page/' + page + '/');
  
  try {
    const html = await getHtml(url);
    const items = extractItemsFromHtml(html, null);
    
    if (items.length === 0 && page === 1) {
      throw kino.error("not_found", "No se encontraron elementos en esta sección.");
    }
    
    return {
      items: items,
      next: items.length >= 30 ? String(page + 1) : undefined
    };
  } catch (e) {
    if (e.code) throw e;
    throw kino.error("not_found", "No se pudieron cargar más elementos.");
  }
}

export async function resolve(ref) {
  log("Resolviendo:", ref);
  let html;
  let usedBrowserFallback = false;
  
  try {
    html = await getHtml(ref);
  } catch (e) {
    // Fallback: Si kino.fetch es bloqueado, intentar con el navegador oculto (permitido en resolve)
    log("kino.fetch falló, intentando kino.browser.capture...");
    try {
      const browserResult = await kino.browser.capture(ref, { timeoutMs: 15000 });
      html = browserResult.html;
      usedBrowserFallback = true;
      log("Navegador oculto usado con éxito");
    } catch (browserErr) {
      log("Fallo también con navegador oculto:", browserErr.message);
      throw kino.error("unavailable", "No se pudo acceder a la página del video.");
    }
  }
  
  const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (!iframeMatch) {
    throw kino.error("not_found", "No se encontró el reproductor de video en esta página.");
  }
  
  let playerUrl = iframeMatch[1];
  if (playerUrl.startsWith('//')) playerUrl = 'https:' + playerUrl;
  if (!playerUrl.startsWith('http')) playerUrl = BASE_URL + playerUrl;
  
  log("Player URL:", playerUrl);
  
  try {
    const playerHtml = await getHtml(playerUrl);
    
    const patterns = [
      /file:\s*["']([^"']+)["']/i,
      /sources:\s*\[\s*\{\s*file:\s*["']([^"']+)["']/i,
      /<source[^>]+src=["']([^"']+)["']/i,
      /url:\s*["']([^"']+)["']/i,
      /atob\(["']([^"']+)["']\)/i
    ];
    
    for (const pattern of patterns) {
      const match = playerHtml.match(pattern);
      if (match && match[1]) {
        let videoUrl = match[1];
        if (pattern.source.includes('atob')) videoUrl = decodeBase64(videoUrl);
        if (videoUrl.startsWith('//')) videoUrl = 'https:' + videoUrl;
        
        if (videoUrl.startsWith('http') && !videoUrl.includes('ad.') && !videoUrl.includes('banner') && !videoUrl.includes('tracking')) {
          log("Video directo encontrado:", videoUrl);
          return {
            url: videoUrl,
            mime: videoUrl.includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp4',
            headers: HEADERS
          };
        }
      }
    }
    
    const supportedHosts = ['voe.sx', 'streamtape.com', 'doodstream.com', 'fembed.com', 'ok.ru', 'mega.nz', 'mediafire.com'];
    if (supportedHosts.some(host => playerUrl.includes(host))) {
      return { url: playerUrl, mime: 'video/html', headers: HEADERS };
    }
    
    return { url: playerUrl, mime: 'video/html', headers: HEADERS };
    
  } catch (e) {
    log("Error al resolver el player, devolviendo URL original:", e.message);
    return { url: playerUrl, mime: 'video/html', headers: HEADERS };
  }
}
