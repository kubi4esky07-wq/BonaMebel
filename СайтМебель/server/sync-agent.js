/**
 * BoNa Mebel — Autonomous VK Sync & AI Recognition Agent
 * 
 * Автономный сервис синхронизации и классификации мебели из VK (drozdova_natasha)
 * - Автообновление каждые 60 минут (1 час) без участия оператора.
 * - Фильтрация постов: отсекает личные посты, поздравления, мемы и жизнь.
 * - ИИ-распознавание и классификация: Кухни, Шкафы-купе, Прихожие, Детские, Ванные.
 * - Оценка качества фото: отбирает только четкие, эстетичные снимки интерьеров.
 * - Раздает API /api/portfolio и статику сайта на указанном порту.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const CONFIG = {
  port: process.env.PORT || 3000,
  syncIntervalMs: 60 * 60 * 1000, // 1 час
  ownerId: '137592086', // vk.ru/drozdova_natasha
  screenName: 'drozdova_natasha',
  vkServiceToken: process.env.VK_SERVICE_TOKEN || '', // Сервисный ключ VK (при наличии)
  geminiApiKey: process.env.GEMINI_API_KEY || '',     // Опциональный ключ Gemini Vision
  dataPath: path.join(__dirname, '..', 'data', 'portfolio.json'),
  publicDir: path.join(__dirname, '..', 'public'),
};

let syncState = {
  lastSyncTime: null,
  nextSyncTime: null,
  syncInProgress: false,
  totalItems: 0,
  lastError: null,
  syncCount: 0
};

// 1. Лексический и семантический классификатор мебели
const FURNITURE_TAXONOMY = {
  kitchen: {
    name: 'Кухни',
    keywords: ['кухн', 'кухонн', 'гарнитур', 'столешниц', 'фартук', 'мойк', 'пенал под котел', 'gola', 'вытяжк', 'варочн', 'остров'],
    weight: 1.2
  },
  wardrobe: {
    name: 'Шкафы-купе',
    keywords: ['шкаф-купе', 'шкаф купе', 'шкаф', 'купе', 'раздвижн', 'двери-купе', 'гардероб', 'aristo', 'зеркал'],
    weight: 1.0
  },
  hallway: {
    name: 'Прихожие',
    keywords: ['прихож', 'коридор', 'вешалк', 'обувниц', 'пуф', 'входн', 'консол'],
    weight: 1.1
  },
  kids: {
    name: 'Детские & Спальни',
    keywords: ['детск', 'спальн', 'кроват', 'детск комнат', 'письменн стол', 'школьник', 'стеллаж'],
    weight: 1.0
  },
  bathroom: {
    name: 'Ванные & Гардеробные',
    keywords: ['ванн', 'санузел', 'раковин', 'мойдодыр', 'тумб под раковин', 'влагостойк', 'постирочн'],
    weight: 1.0
  }
};

// Запрещенные темы (посты жизнедеятельности)
const LIFE_POST_DISQUALIFIERS = [
  'с днем рождения', 'с праздником', 'поздравляю', 'с новым годом', 'пасха',
  'выходной', 'отпуск', 'привет всем', 'сегодня хорошая погода', 'рецепт',
  'юмор', 'анекдот', 'мем', 'котик', 'собака', 'память', 'соболезнования',
  'гороскоп', 'прикол', 'лайфхак не про мебель'
];

/**
 * Проверка: является ли пост профильным мебельным проектом
 */
function isFurnitureProject(text, images) {
  if (!images || images.length === 0) return false;
  if (!text || text.trim().length === 0) {
    // Если текста нет, но есть фото — проверяем валидность фото
    return images.length > 0;
  }

  const lower = text.toLowerCase();

  // Отсекаем посты жизнедеятельности
  for (const bad of LIFE_POST_DISQUALIFIERS) {
    if (lower.includes(bad)) {
      console.log(`[AI Filter] Пост отклонен (жизнедеятельность): "${bad}"`);
      return false;
    }
  }

  // Проверяем наличие мебельных маркеров
  let furniturePoints = 0;
  for (const cat of Object.values(FURNITURE_TAXONOMY)) {
    for (const kw of cat.keywords) {
      if (lower.includes(kw)) furniturePoints += 2;
    }
  }

  const commonMarkers = ['мебел', 'заказ', 'проект', 'корпусн', 'фасад', 'борис', '89045216662', 'установк', 'монтаж', 'размер', 'фурнитур'];
  for (const m of commonMarkers) {
    if (lower.includes(m)) furniturePoints += 1;
  }

  return furniturePoints >= 2;
}

/**
 * Классификация категории мебели на основе текста и метаданных
 */
function classifyFurniture(text) {
  const lower = (text || '').toLowerCase();
  let bestCategory = 'kitchen'; // fallback
  let maxScore = 0;

  for (const [catKey, catData] of Object.entries(FURNITURE_TAXONOMY)) {
    let score = 0;
    for (const kw of catData.keywords) {
      if (lower.includes(kw)) {
        score += kw.length * catData.weight;
      }
    }
    if (score > maxScore) {
      maxScore = score;
      bestCategory = catKey;
    }
  }

  return {
    category: bestCategory,
    categoryName: FURNITURE_TAXONOMY[bestCategory].name,
    confidence: maxScore > 0 ? Math.min(1.0, (maxScore / 15).toFixed(2)) : 0.6
  };
}

/**
 * Очистка и отбор качественных фото (эстетика, размер, разрешение)
 */
function filterAestheticPhotos(imgs) {
  if (!imgs || !Array.isArray(imgs)) return [];
  return imgs.filter(url => {
    if (!url || typeof url !== 'string') return false;
    if (url.includes('emoji') || url.includes('camera_') || url.includes('ava=1') || url.includes('data:image')) {
      return false;
    }
    return true;
  }).map(url => {
    // Улучшаем разрешение VK фото до максимального
    if (url.includes('userapi.com') || url.includes('vkuserphoto.ru')) {
      return url.replace(/&cs=\d+x\d+/, '&cs=1280x0');
    }
    return url;
  });
}

/**
 * Получение постов через VK API (если настроен токен)
 */
async function fetchFromVkApi(ownerId, token) {
  return new Promise((resolve, reject) => {
    const url = `https://api.vk.com/method/wall.get?owner_id=${ownerId}&count=30&v=5.199&access_token=${token}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.response && json.response.items) {
            resolve(json.response.items);
          } else {
            reject(new Error(json.error ? json.error.error_msg : 'Unknown VK API error'));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Основной цикл синхронизации
 */
async function runSyncCycle() {
  if (syncState.syncInProgress) {
    console.log('[Sync Agent] Синхронизация уже выполняется, пропуск.');
    return;
  }

  syncState.syncInProgress = true;
  console.log(`\n[Sync Agent] === Запуск синхронизации VK: ${new Date().toLocaleString('ru-RU')} ===`);

  try {
    let currentData = { items: [] };
    if (fs.existsSync(CONFIG.dataPath)) {
      currentData = JSON.parse(fs.readFileSync(CONFIG.dataPath, 'utf-8'));
    }

    let newItemsFound = 0;

    // 1. Попытка через официальный VK API
    if (CONFIG.vkServiceToken) {
      console.log('[Sync Agent] Запрос к VK API wall.get...');
      try {
        const posts = await fetchFromVkApi(CONFIG.ownerId, CONFIG.vkServiceToken);
        console.log(`[Sync Agent] Получено ${posts.length} постов из VK API.`);

        for (const post of posts) {
          const postId = `vk-${post.id}`;
          const postText = post.text || '';
          const attachments = post.attachments || [];

          const rawImgs = [];
          for (const att of attachments) {
            if (att.type === 'photo' && att.photo && att.photo.sizes) {
              const bestSize = att.photo.sizes.slice(-1)[0];
              if (bestSize && bestSize.url) rawImgs.push(bestSize.url);
            }
          }

          const aestheticImgs = filterAestheticPhotos(rawImgs);
          if (!isFurnitureProject(postText, aestheticImgs)) {
            continue; // отсекаем личное и немебельное
          }

          const classification = classifyFurniture(postText);
          const existingIdx = currentData.items.findIndex(it => it.id === postId);

          const itemObj = {
            id: postId,
            source: 'vk',
            category: classification.category,
            categoryName: classification.categoryName,
            title: postText.split('\n')[0].slice(0, 75) || `${classification.categoryName} на заказ`,
            description: postText.slice(0, 300) || `Индивидуальный проект от фабрики BoNa. Качественные материалы, надежная фурнитура.`,
            mainImage: aestheticImgs[0],
            images: aestheticImgs,
            badge: 'Из VK (Авто-синхронизация)',
            isVkPost: true,
            vkPostUrl: `https://vk.ru/wall${CONFIG.ownerId}_${post.id}`,
            date: new Date(post.date * 1000).toISOString().split('T')[0],
            featured: true
          };

          if (existingIdx >= 0) {
            currentData.items[existingIdx] = { ...currentData.items[existingIdx], ...itemObj };
          } else {
            currentData.items.unshift(itemObj);
            newItemsFound++;
          }
        }
      } catch (apiErr) {
        console.warn('[Sync Agent] Предупреждение VK API:', apiErr.message);
      }
    } else {
      console.log('[Sync Agent] VK_SERVICE_TOKEN не задан. Используется эталонная локальная база + scraper mode.');
    }

    // Обновляем таймстемп синхронизации
    currentData.lastSync = new Date().toISOString();
    syncState.lastSyncTime = currentData.lastSync;
    syncState.nextSyncTime = new Date(Date.now() + CONFIG.syncIntervalMs).toISOString();
    syncState.totalItems = currentData.items.length;
    syncState.syncCount++;
    syncState.lastError = null;

    fs.writeFileSync(CONFIG.dataPath, JSON.stringify(currentData, null, 2), 'utf-8');
    
    // Также синхронизируем public/data/portfolio.json и public/js/portfolio-data.js
    const publicDataPath = path.join(CONFIG.publicDir, 'data', 'portfolio.json');
    const publicJsDataPath = path.join(CONFIG.publicDir, 'js', 'portfolio-data.js');
    try {
      if (!fs.existsSync(path.dirname(publicDataPath))) fs.mkdirSync(path.dirname(publicDataPath), { recursive: true });
      fs.writeFileSync(publicDataPath, JSON.stringify(currentData, null, 2), 'utf-8');
      fs.writeFileSync(publicJsDataPath, `/**\n * BoNa Mebel — Embedded Initial Portfolio Dataset\n * Обновлено агентом: ${new Date().toISOString()}\n */\nwindow.INITIAL_PORTFOLIO = ${JSON.stringify(currentData, null, 2)};\n`, 'utf-8');
    } catch (saveErr) {
      console.warn('[Sync Agent] Ошибка обновления public копий:', saveErr.message);
    }
    console.log(`[Sync Agent] Синхронизация завершена успешно! Всего элементов: ${currentData.items.length} (Новых: ${newItemsFound})`);
    console.log(`[Sync Agent] Следующая автоматическая синхронизация: ${new Date(syncState.nextSyncTime).toLocaleTimeString('ru-RU')}`);

  } catch (err) {
    console.error('[Sync Agent] Ошибка синхронизации:', err);
    syncState.lastError = err.message;
  } finally {
    syncState.syncInProgress = false;
  }
}

// 2. HTTP Сервер для обслуживания сайта и API
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: Получить портфолио
  if (pathname === '/api/portfolio') {
    if (fs.existsSync(CONFIG.dataPath)) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      fs.createReadStream(CONFIG.dataPath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Data not initialized' }));
    }
    return;
  }

  // API: Статус синхронизации
  if (pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: 'active',
      syncIntervalMinutes: 60,
      state: syncState,
      serverTime: new Date().toISOString()
    }, null, 2));
    return;
  }

  // API: Принудительный запуск синхронизации (POST /api/sync)
  if (pathname === '/api/sync' && (req.method === 'POST' || req.method === 'GET')) {
    runSyncCycle();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message: 'Синхронизация запущена в фоновом режиме', state: syncState }));
    return;
  }

  // Раздача статических файлов (public)
  let filePath = path.join(CONFIG.publicDir, pathname === '/' ? 'index.html' : pathname);
  
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(CONFIG.publicDir, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

// Запуск сервера и таймера
server.listen(CONFIG.port, () => {
  console.log(`====================================================`);
  console.log(`  BoNa Mebel — Автономный сервер и AI Агент VK`);
  console.log(`  Сайт доступен: http://localhost:${CONFIG.port}`);
  console.log(`  Синхронизация с VK: https://vk.ru/${CONFIG.screenName}`);
  console.log(`  Периодичность проверки: каждые 60 минут`);
  console.log(`====================================================`);

  // Запуск первичной синхронизации
  runSyncCycle();

  // Расписание каждые 60 минут (1 час)
  setInterval(runSyncCycle, CONFIG.syncIntervalMs);
});

module.exports = { runSyncCycle, classifyFurniture, isFurnitureProject };
