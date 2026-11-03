"use strict";
// Weather service: talks to the free Open-Meteo API from the server (no API key needed),
// turns raw numbers into plain-language safety advice, and caches results for 10 minutes.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const CACHE_MS = 10 * 60 * 1000;

function codeInfo(c) {
  if (c === 0) return { icon: "☀️", text: "Clear sky", kind: "sun" };
  if (c <= 3) return { icon: "⛅", text: "Partly cloudy", kind: "cloud" };
  if (c <= 48) return { icon: "🌫️", text: "Fog", kind: "cloud" };
  if (c <= 57) return { icon: "🌦️", text: "Drizzle", kind: "rain" };
  if (c <= 67) return { icon: "🌧️", text: "Rain", kind: "rain" };
  if (c <= 77) return { icon: "❄️", text: "Snow", kind: "snow" };
  if (c <= 82) return { icon: "🌧️", text: "Rain showers", kind: "rain" };
  if (c <= 86) return { icon: "🌨️", text: "Snow showers", kind: "snow" };
  return { icon: "⛈️", text: "Thunderstorm", kind: "storm" };
}

function getAdvice({ temp, wind, rainChance = 0, code, humidity }) {
  const a = [];
  if (temp >= 38) a.push({ level: "red", text: "Extreme heat: avoid going out between 12 and 4 PM, drink water often, never leave children or pets in vehicles." });
  else if (temp >= 32) a.push({ level: "amber", text: "Hot day: carry water, wear light cotton clothes and use sunscreen." });
  if (temp <= 10) a.push({ level: "blue", text: "Cold weather: wear layers and cover your ears and hands." });
  const rainy = rainChance >= 60 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
  if (rainy) a.push({ level: "blue", text: "Rain likely: carry an umbrella, drive slowly and avoid waterlogged roads." });
  if (code >= 95) a.push({ level: "red", text: "Thunderstorm: stay indoors, unplug electronics and stay away from trees and open fields." });
  if (wind >= 40) a.push({ level: "red", text: "Strong winds: secure loose objects and avoid riding two-wheelers on open roads." });
  else if (wind >= 25) a.push({ level: "amber", text: "Windy: be careful with umbrellas and two-wheeler rides." });
  if (code === 45 || code === 48) a.push({ level: "amber", text: "Fog: low visibility, use fog lights and keep a safe distance when driving." });
  if (humidity >= 80 && temp >= 30) a.push({ level: "amber", text: "Hot and humid: heat exhaustion risk is higher, take regular shade breaks." });
  if (!a.length) a.push({ level: "green", text: "Conditions look comfortable. Enjoy your day!" });
  return a;
}

function createWeatherService({ fetchFn = globalThis.fetch, now = () => Date.now(), timeoutMs = 8000 } = {}) {
  const cache = new Map();

  async function getJson(url) {
    let res;
    try {
      res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (err.name === "TimeoutError" || err.name === "AbortError") throw new HttpError(504, "Weather provider timed out. Try again.");
      throw new HttpError(502, "Could not reach the weather provider.");
    }
    if (!res.ok) throw new HttpError(502, "Weather provider returned an error.");
    try {
      return await res.json();
    } catch (_) {
      throw new HttpError(502, "Weather provider sent an unreadable response.");
    }
  }

  async function geocode(city) {
    const data = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en`);
    if (!data.results || !data.results.length) throw new HttpError(404, "City not found. Check the spelling and try again.");
    const r = data.results[0];
    return { lat: r.latitude, lon: r.longitude, name: r.name, country: r.country || "", admin1: r.admin1 || "" };
  }

  async function forByCity(city) {
    return forecast(await geocode(city));
  }

  async function forByCoords(lat, lon) {
    return forecast({ lat, lon, name: "Your location", country: "", admin1: "" });
  }

  async function forecast(place) {
    const key = `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_MS) return { ...hit.data, location: place, cached: true };

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation,weather_code` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`;
    const d = await getJson(url);
    if (!d.current || !d.daily || !Array.isArray(d.daily.time)) throw new HttpError(502, "Weather provider sent incomplete data.");

    const c = d.current;
    const day = d.daily;
    const info = codeInfo(c.weather_code);
    const data = {
      current: {
        temp: Math.round(c.temperature_2m),
        humidity: c.relative_humidity_2m,
        wind: Math.round(c.wind_speed_10m),
        precipitation: c.precipitation,
        code: c.weather_code,
        ...info,
      },
      advice: getAdvice({
        temp: Math.max(c.temperature_2m, day.temperature_2m_max[0] ?? c.temperature_2m),
        wind: c.wind_speed_10m,
        rainChance: day.precipitation_probability_max[0] ?? 0,
        code: c.weather_code,
        humidity: c.relative_humidity_2m,
      }),
      forecast: day.time.slice(1, 6).map((date, i) => {
        const j = i + 1;
        return {
          date,
          max: Math.round(day.temperature_2m_max[j]),
          min: Math.round(day.temperature_2m_min[j]),
          rainChance: day.precipitation_probability_max[j] ?? 0,
          ...codeInfo(day.weather_code[j]),
        };
      }),
    };
    cache.set(key, { at: now(), data });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return { ...data, location: place, cached: false };
  }

  return { forByCity, forByCoords, geocode };
}

module.exports = { createWeatherService, getAdvice, codeInfo, HttpError };
