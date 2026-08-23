import express from 'express';

const router = express.Router();
const CACHE_TTL_MS = 10 * 60 * 1000;
const weatherCache = new Map();

const WEATHER_CODES = {
  0: ['晴', 'sunny'],
  1: ['大部晴朗', 'partly-cloudy'],
  2: ['多云', 'partly-cloudy'],
  3: ['阴', 'cloudy'],
  45: ['有雾', 'fog'],
  48: ['雾凇', 'fog'],
  51: ['小毛毛雨', 'rain'],
  53: ['毛毛雨', 'rain'],
  55: ['较强毛毛雨', 'rain'],
  56: ['冻毛毛雨', 'rain'],
  57: ['较强冻毛毛雨', 'rain'],
  61: ['小雨', 'rain'],
  63: ['中雨', 'rain'],
  65: ['大雨', 'rain'],
  66: ['冻雨', 'rain'],
  67: ['较强冻雨', 'rain'],
  71: ['小雪', 'snow'],
  73: ['中雪', 'snow'],
  75: ['大雪', 'snow'],
  77: ['米雪', 'snow'],
  80: ['小阵雨', 'rain'],
  81: ['阵雨', 'rain'],
  82: ['强阵雨', 'rain'],
  85: ['小阵雪', 'snow'],
  86: ['强阵雪', 'snow'],
  95: ['雷暴', 'storm'],
  96: ['雷暴伴小冰雹', 'storm'],
  99: ['雷暴伴强冰雹', 'storm'],
};

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function outdoorAdvice({ code, temperature, windSpeed, precipitation, precipitationProbability }) {
  if (code >= 95) return { level: 'avoid', text: '雷暴天气，不建议外出' };
  if (precipitation > 0 || precipitationProbability >= 70 || (code >= 51 && code <= 86)) {
    return { level: 'caution', text: '可能有降水，外出请防滑' };
  }
  if (temperature >= 35) return { level: 'avoid', text: '天气炎热，减少户外活动' };
  if (temperature >= 30) return { level: 'caution', text: '注意防暑，避开高温时段' };
  if (temperature <= 0) return { level: 'caution', text: '天气寒冷，注意保暖防滑' };
  if (windSpeed >= 30) return { level: 'caution', text: '风力较大，外出注意安全' };
  return { level: 'good', text: '天气适宜短时散步' };
}

export function normalizeWeather(payload) {
  const current = payload?.current || {};
  const daily = payload?.daily || {};
  const code = finiteNumber(current.weather_code);
  const temperature = finiteNumber(current.temperature_2m);
  const windSpeed = finiteNumber(current.wind_speed_10m);
  const precipitation = finiteNumber(current.precipitation) ?? 0;
  const high = finiteNumber(daily.temperature_2m_max?.[0]);
  const low = finiteNumber(daily.temperature_2m_min?.[0]);
  const precipitationProbability = finiteNumber(daily.precipitation_probability_max?.[0]) ?? 0;

  if (code === null || temperature === null || high === null || low === null || windSpeed === null) {
    throw new Error('WEATHER_SCHEMA_INVALID');
  }

  const [condition, icon] = WEATHER_CODES[code] || ['天气状况未知', 'unknown'];
  return {
    condition,
    icon,
    temperature: Math.round(temperature),
    high: Math.round(high),
    low: Math.round(low),
    wind_speed: Math.round(windSpeed),
    precipitation_probability: Math.round(precipitationProbability),
    is_day: current.is_day === 1,
    observed_at: current.time || null,
    timezone: payload.timezone || null,
    advice: outdoorAdvice({ code, temperature, windSpeed, precipitation, precipitationProbability }),
    source: 'Open-Meteo',
    fetched_at: new Date().toISOString(),
  };
}

router.get('/', async (req, res) => {
  const latitude = finiteNumber(req.query.latitude);
  const longitude = finiteNumber(req.query.longitude);
  if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: '定位坐标无效，请重新定位', code: 'INVALID_COORDINATES' });
  }

  // 约 1 公里的粒度足以查询天气；只做短时内存缓存，不写入数据库。
  const cacheKey = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return res.json({ ...cached.data, cache: 'hit' });
  }

  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current: 'temperature_2m,weather_code,is_day,precipitation,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    forecast_days: '1',
    timezone: 'auto',
  });

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error(`UPSTREAM_${response.status}`);
    const data = normalizeWeather(await response.json());
    weatherCache.set(cacheKey, { savedAt: Date.now(), data });
    res.set('Cache-Control', 'private, max-age=300');
    return res.json({ ...data, cache: 'miss' });
  } catch (error) {
    console.warn('[weather] provider unavailable:', error?.message || error);
    return res.status(503).json({ error: '天气服务暂时不可用，请稍后重试', code: 'WEATHER_UNAVAILABLE' });
  }
});

export default router;
