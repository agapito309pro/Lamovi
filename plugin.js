const BASE_URL = "https://lamovie.org";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Referer": BASE_URL + "/",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache"
};

function log(...args) {
  try { kino.log("[LaMovie]", ...args); } catch (e) {}
}

async function fetchText(url) {
  log("Fetching:", url);
  const res = await kino.fetch(url, { headers: HEADERS });
  if (!res.ok) {
    log("HTTP Error:", res.status, url);
    throw kino.error("unavailable", `Error ${res.status} al conectar con el servidor`);
  }
  const text = await res.text();
  
  // Detección de bloqueo Cloudflare o similar
  if (text.includes("cloudflare") || text.includes("challenge") || text.includes("jschl") || text.length < 5000) {
    log("Posible bloqueo Cloudflare detectado en:", url);
    throw kino.error("geo_blocked", "El sitio está bloqueando peticiones automáticas. Intenta de nuevo más tarde o verifica tu conexión.");
  }
  
  return text;
}

function decodeBase64(str) {
  try { return atob(str.replace(/-/g, '+').replace(/_/g, '/')); } 
  catch (e) { return str; }
}

// Extrae items del HTML con múltiples patrones de fallback
function extractItemsFromHtml(html, kind) {
  const items = [];
  const seen = new Set();
  
  // Patrón 1: Enlaces directos con imágenes y títulos
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
  
  // Patrón 2: Fallback para estructuras tipo "item" o "poster"
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
      log("Cargando categoría:", cat.title);
      const html = await fetchText(cat.url);
      const items = extractItemsFromHtml(html, cat.kind);
      
      if (items.length > 0) {
        rows.push({
          id: cat.id,
          title: cat.title,
          ref: cat.url,
          items: items
        });
      } else {
        log("No se encontraron items en:", cat.title);
      }
    } catch (e) {
      log("Error en categoría", cat.title, e.message);
      // No lanzamos el error para no romper todo el Home, pero se registra
    }
  }
  
  if (rows.length === 0) {
    throw kino.error("unavailable", "No se pudo cargar el contenido. El sitio podría estar bloqueando peticiones temporalmente.");
  }
  
  return rows;
}

export async function search(query) {
  try {
    // Intento 1: API de WordPress (a veces está habilitada aunque el HTML esté protegido)
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
    const html = await fetchText(searchUrl);
    const items = extractItemsFromHtml(html, null);
    if (items.length > 0) return items;
  } catch (e) {
    log("Búsqueda HTML falló:", e.message);
  }

  throw kino.error("not_found", `No se encontraron resultados para "${query}" o el sitio bloqueó la búsqueda.`);
}

export async function browse(ref, cursor) {
  const page = cursor ? parseInt(cursor, 10) : 1;
  const url = ref.includes('?') ? (ref + '&page=' + page) : (ref + (ref.endsWith('/') ? '' : '/') + 'page/' + page + '/');
  
  try {
    const html = await fetchText(url);
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
    throw kino.error("not_found", "No se pudieron cargar más elementos. Posible bloqueo del sitio.");
  }
}

export async function resolve(ref) {
  log("Resolviendo:", ref);
  const html = await fetchText(ref);
  
  const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (!iframeMatch) {
    throw kino.error("not_found", "No se encontró el reproductor de video en esta página.");
  }
  
  let playerUrl = iframeMatch[1];
  if (playerUrl.startsWith('//')) playerUrl = 'https:' + playerUrl;
  if (!playerUrl.startsWith('http')) playerUrl = BASE_URL + playerUrl;
  
  log("Player URL encontrado:", playerUrl);
  
  try {
    const playerHtml = await fetchText(playerUrl);
    
    // Patrones priorizados para extraer el enlace directo (evita anuncios)
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
        if (pattern.source.includes('atob')) {
          videoUrl = decodeBase64(videoUrl);
        }
        if (videoUrl.startsWith('//')) videoUrl = 'https:' + videoUrl;
        
        // Validación para evitar enlaces a scripts o banners publicitarios
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
    
    // Fallback: Si es un host conocido, dejar que Kino lo maneje
    const supportedHosts = ['voe.sx', 'streamtape.com', 'doodstream.com', 'fembed.com', 'ok.ru', 'mega.nz', 'mediafire.com'];
    const isSupported = supportedHosts.some(host => playerUrl.includes(host));
    
    if (isSupported) {
      log("Usando host soportado:", playerUrl);
      return { url: playerUrl, mime: 'video/html', headers: HEADERS };
    }
    
    log("Devolviendo URL del player como fallback:", playerUrl);
    return { url: playerUrl, mime: 'video/html', headers: HEADERS };
    
  } catch (e) {
    log("Error al resolver el player, devolviendo URL original:", e.message);
    return { url: playerUrl, mime: 'video/html', headers: HEADERS };
  }
}
