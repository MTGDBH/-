import assert from 'node:assert/strict';
import { normalizeWeather, outdoorAdvice } from './routes/weather.js';

const normalized = normalizeWeather({
  timezone: 'Asia/Shanghai',
  current: {
    time: '2026-08-23T12:00',
    temperature_2m: 26.4,
    weather_code: 1,
    is_day: 1,
    precipitation: 0,
    wind_speed_10m: 8.2,
  },
  daily: {
    temperature_2m_max: [30.2],
    temperature_2m_min: [19.4],
    precipitation_probability_max: [20],
  },
});

assert.equal(normalized.condition, '大部晴朗');
assert.equal(normalized.temperature, 26);
assert.equal(normalized.high, 30);
assert.equal(normalized.low, 19);
assert.equal(normalized.source, 'Open-Meteo');
assert.equal(normalized.advice.level, 'good');

assert.equal(outdoorAdvice({ code: 95, temperature: 20, windSpeed: 5, precipitation: 0, precipitationProbability: 0 }).level, 'avoid');
assert.equal(outdoorAdvice({ code: 61, temperature: 20, windSpeed: 5, precipitation: 1, precipitationProbability: 80 }).level, 'caution');
assert.equal(outdoorAdvice({ code: 0, temperature: 36, windSpeed: 5, precipitation: 0, precipitationProbability: 0 }).level, 'avoid');
assert.throws(() => normalizeWeather({ current: {}, daily: {} }), /WEATHER_SCHEMA_INVALID/);

console.log('weather normalization and advice: PASS');
