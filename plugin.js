const BASE_URL = "https://lamovie.org";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Referer": BASE_URL + "/",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
};

async function fetchText(url) {
  const res = await kino.fetch(url, { headers: HEADERS });
  if (!res.ok) throw kino.error("unavailable", "Error " + res.status + " al obtener " + url);
  return await res.text();
}

function decodeBase64(str) {
  try {
    return atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  } catch (e) {
    return str;
  }
}

const CATEGORIES = [
  { id: 'peliculas', title: 'Películas', url: BASE_URL + '/peliculas/' },
  { id: 'series', title: 'Series', url: BASE_URL + '/series/' },
  { id: 'animes', title: 'Animes', url: BASE_URL + '/animes/' }
];

export async function home() {
  const rows = [];
  for (const cat of CATEGORIES) {
    try {
      const html = await fetchText(cat.url);
      const items = [];
      const itemRegex = /<a[^>]+href=["'](https:\/\/lamovie\.org\/[^"']+)["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["'][^>]*>(?:[\s\S]*?<h3[^>]*>([^<]+)<\/h3>|[\s\S]*?alt=["']([^"']+)["'])?/gi;
      let itemMatch;
      
      while ((itemMatch = itemRegex.exec(html)) !== null) {
        const url = itemMatch[1];
        const poster = itemMatch[2];
        const titleFromH3 = itemMatch[3];
        const titleFromAlt = itemMatch[4];
        const itemTitle = (titleFromH3 || titleFromAlt || url).replace(/\\|/g, '').trim();
        
        if (!items.find(i => i.ref === url)) {
          items.push({
            id: url.replace(BASE_URL, '').replace(/\//g, '-').replace(/^-|-$/g, ''),
            ref: url,
            title: itemTitle,
            kind: cat.id === 'peliculas' ? 'movie' : 'series',
            poster: poster.startsWith('http') ? poster : BASE_URL + poster,
          });
        }
        if (items.length >= 30) break; // Máximo permitido por fila en Kino
      }
      
      if (items.length > 0) {
        rows.push({
          id: cat.id,
          title: cat.title,
          ref: cat.url,
          items: items
        });
      }
    } catch (e) {
      // Ignora errores en categorías individuales para no romper el Home completo
    }
  }
  return rows;
}

export async function search(query) {
  try {
    const apiUrl = BASE_URL + '/wp-json/wp/v2/posts?search=' + encodeURIComponent(query) + '&per_page=30';
    const res = await kino.fetch(apiUrl, { headers: HEADERS });
    if (res.ok) {
      const posts = await res.json();
      return posts.map(post => ({
        id: String(post.id),
        ref: post.link,
        title: post.title.rendered.replace(/<[^>]+>/g, '').replace(/\\|/g, '').trim(),
        kind: 'movie',
        poster: post.jetpack_featured_media_url || (BASE_URL + '/wp-content/themes/lamovie/assets/images/no-image.jpg'),
        year: post.date ? post.date.substring(0, 4) : undefined
      }));
    }
  } catch (e) {
    // Fallback a búsqueda HTML si la API falla
  }
  
  const searchUrl = BASE_URL + '/?s=' + encodeURIComponent(query);
  const html = await fetchText(searchUrl);
  const items = [];
  const itemRegex = /<a[^>]+href=["'](https:\/\/lamovie\.org\/[^"']+)["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["'][^>]*>(?:[\s\S]*?<h3[^>]*>([^<]+)<\/h3>|[\s\S]*?alt=["']([^"']+)["'])?/gi;
  let itemMatch;
  
  while ((itemMatch = itemRegex.exec(html)) !== null) {
    const url = itemMatch[1];
    const poster = itemMatch[2];
    const titleFromH3 = itemMatch[3];
    const titleFromAlt = itemMatch[4];
    const itemTitle = (titleFromH3 || titleFromAlt || url).replace(/\\|/g, '').trim();
    
    if (!items.find(i => i.ref === url)) {
      items.push({
        id: url.replace(BASE_URL, '').replace(/\//g, '-').replace(/^-|-$/g, ''),
        ref: url,
        title: itemTitle,
        kind: url.includes('/series/') || url.includes('/animes/') ? 'series' : 'movie',
        poster: poster.startsWith('http') ? poster : BASE_URL + poster,
      });
    }
    if (items.length >= 30) break; // Máximo permitido en resultados de búsqueda
  }
  
  return items;
}

export async function browse(ref, cursor) {
  const page = cursor ? parseInt(cursor, 10) : 1;
  const url = ref.includes('?') ? (ref + '&page=' + page) : (ref + 'page/' + page + '/');
  
  try {
    const html = await fetchText(url);
    const items = [];
    const itemRegex = /<a[^>]+href=["'](https:\/\/lamovie\.org\/[^"']+)["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["'][^>]*>(?:[\s\S]*?<h3[^>]*>([^<]+)<\/h3>|[\s\S]*?alt=["']([^"']+)["'])?/gi;
    let itemMatch;
    
    while ((itemMatch = itemRegex.exec(html)) !== null) {
      const itemUrl = itemMatch[1];
      const poster = itemMatch[2];
      const titleFromH3 = itemMatch[3];
      const titleFromAlt = itemMatch[4];
      const itemTitle = (titleFromH3 || titleFromAlt || itemUrl).replace(/\\|/g, '').trim();
      
      if (!items.find(i => i.ref === itemUrl)) {
        items.push({
          id: itemUrl.replace(BASE_URL, '').replace(/\//g, '-').replace(/^-|-$/g, ''),
          ref: itemUrl,
          title: itemTitle,
          kind: itemUrl.includes('/series/') || itemUrl.includes('/animes/') ? 'series' : 'movie',
          poster: poster.startsWith('http') ? poster : BASE_URL + poster,
        });
      }
      if (items.length >= 30) break; // Máximo permitido por página de "Ver más"
    }
    
    return {
      items: items,
      next: items.length >= 30 ? String(page + 1) : undefined
    };
  } catch (e) {
    throw kino.error("not_found", "No se pudieron cargar más elementos");
  }
}

export async function resolve(ref) {
  const html = await fetchText(ref);
  
  const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (!iframeMatch) {
    throw kino.error("not_found", "No se encontró el reproductor de video");
  }
  
  let playerUrl = iframeMatch[1];
  if (playerUrl.startsWith('//')) playerUrl = 'https:' + playerUrl;
  if (!playerUrl.startsWith('http')) playerUrl = BASE_URL + playerUrl;
  
  try {
    const playerHtml = await fetchText(playerUrl);
    
    // Patrones priorizados para extraer el enlace directo al video (evita anuncios)
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
        
        // Validación básica para evitar enlaces a scripts o banners publicitarios
        if (videoUrl.startsWith('http') && !videoUrl.includes('ad.') && !videoUrl.includes('banner')) {
          return {
            url: videoUrl,
            mime: videoUrl.includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp4',
            headers: HEADERS // Esencial para evitar el error 403 en TV y móvil
          };
        }
      }
    }
    
    // Fallback: Si es un host conocido y confiable, Kino puede manejarlo directamente
    const supportedHosts = ['voe.sx', 'streamtape.com', 'doodstream.com', 'fembed.com', 'ok.ru', 'mega.nz', 'mediafire.com'];
    const isSupported = supportedHosts.some(host => playerUrl.includes(host));
    
    if (isSupported) {
      return {
        url: playerUrl,
        mime: 'video/html',
        headers: HEADERS
      };
    }
    
    // Último recurso: devolver la URL del player tal cual
    return {
      url: playerUrl,
      mime: 'video/html',
      headers: HEADERS
    };
    
  } catch (e) {
    // Evita que el plugin colapse si el player tiene protección anti-bot
    return {
      url: playerUrl,
      mime: 'video/html',
      headers: HEADERS
    };
  }
}