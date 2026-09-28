/**
 * ATMOS — Estación Meteorológica, Marina y Astronómica Hiperlocal
 * Open-Meteo (Forecast, Marine, Air Quality, Geocoding) + RainViewer Doppler Radar + CARTO Basemaps
 */

(() => {
  'use strict';

  // ==================== CONFIGURACIÓN Y CONSTANTES ====================
  const STORAGE_KEY_COORDS = 'hwrg_coordinates_v1';
  const DEFAULT_LOCATION = { name: 'Badalona', lat: 41.45, lon: 2.21 };
  const AUTO_REFRESH_SECONDS = 300; // 5 minutos
  const CARTO_API_KEY = 'cb1_3zax_1_5da460399d0145631e90d0d1';

  const state = {
    coords: { ...DEFAULT_LOCATION },
    forecastData: null,
    marineData: null,
    airData: null,
    currentHourIndex: 0,
    hourlySlice24: [],
    dailySlice7: [],
    radar: {
      map: null,
      baseLayer: null,
      labelsLayer: null,
      homeMarker: null,
      rangeCircles: [],
      host: 'https://tilecache.rainviewer.com',
      frames: [],
      currentFrameIdx: 0,
      tileLayers: {},
      activeLayerPath: null,
      isPlaying: false,
      playTimer: null,
      opacity: 0.75,
      closestEchoKm: null,
      scanStatus: 'scanning'
    },
    refreshCountdown: AUTO_REFRESH_SECONDS,
    countdownInterval: null,
    isFetching: false
  };

  // ==================== GESTIÓN DE UBICACIÓN (localStorage) ====================
  function loadCoordinates() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_COORDS);
      if (raw) {
        const parsed = JSON.parse(raw);
        const lat = parseFloat(parsed.lat);
        const lon = parseFloat(parsed.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
          state.coords = {
            name: parsed.name || formatCoordsText(lat, lon),
            lat: Number(lat.toFixed(4)),
            lon: Number(lon.toFixed(4))
          };
          return state.coords;
        }
      }
    } catch (err) {
      console.warn('No se pudieron leer las coordenadas de localStorage:', err);
    }
    saveCoordinates(DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lon, DEFAULT_LOCATION.name);
    return state.coords;
  }

  function saveCoordinates(lat, lon, name = null) {
    const cleanLat = Number(parseFloat(lat).toFixed(4));
    const cleanLon = Number(parseFloat(lon).toFixed(4));
    const resolvedName =
      name ||
      (Math.abs(cleanLat - DEFAULT_LOCATION.lat) < 0.01 && Math.abs(cleanLon - DEFAULT_LOCATION.lon) < 0.01
        ? DEFAULT_LOCATION.name
        : 'Ubicación personalizada');

    state.coords = {
      name: resolvedName,
      lat: cleanLat,
      lon: cleanLon
    };

    try {
      localStorage.setItem(STORAGE_KEY_COORDS, JSON.stringify(state.coords));
    } catch (err) {
      console.warn('No se pudieron guardar las coordenadas:', err);
    }
    updateHeaderCoordsDisplay();
  }

  function formatCoordsText(lat, lon) {
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lon >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(4)}°${ns}, ${Math.abs(lon).toFixed(4)}°${ew}`;
  }

  function updateHeaderCoordsDisplay() {
    const nameEl = document.getElementById('headerLocationName');
    const coordsEl = document.getElementById('headerCoordsText');
    if (nameEl) nameEl.textContent = state.coords.name || 'Ubicación';
    if (coordsEl) coordsEl.textContent = formatCoordsText(state.coords.lat, state.coords.lon);
  }

  // ==================== CÓDIGOS WMO E ICONOS METEOROLÓGICOS ====================
  function getWmoInfo(code, isDay = 1) {
    const c = Number(code ?? 0);
    if (c === 0) return { label: isDay ? 'Despejado' : 'Noche despejada', type: isDay ? 'clear-day' : 'clear-night' };
    if (c === 1) return { label: 'Mayormente despejado', type: isDay ? 'partly-day' : 'partly-night' };
    if (c === 2) return { label: 'Parcialmente nuboso', type: isDay ? 'partly-day' : 'partly-night' };
    if (c === 3) return { label: 'Cubierto', type: 'cloudy' };
    if (c === 45 || c === 48) return { label: 'Niebla o bruma', type: 'fog' };
    if (c >= 51 && c <= 57) return { label: 'Llovizna débil', type: 'drizzle' };
    if (c === 61 || c === 80) return { label: 'Lluvia débil', type: 'rain' };
    if (c === 63 || c === 81) return { label: 'Lluvia moderada', type: 'rain' };
    if (c === 65 || c === 82) return { label: 'Lluvia intensa', type: 'heavy-rain' };
    if (c >= 71 && c <= 77) return { label: 'Nieve', type: 'snow' };
    if (c >= 95) return { label: 'Tormenta eléctrica', type: 'storm' };
    return { label: 'Variable', type: 'partly-day' };
  }

  function renderWeatherSvgIcon(type) {
    switch (type) {
      case 'clear-day':
        return `<svg viewBox="0 0 32 32" fill="none" stroke="#fdba74" stroke-width="1.8">
          <circle cx="16" cy="16" r="6.5" fill="rgba(253,186,116,0.15)"/>
          <path stroke-linecap="round" d="M16 4v3M16 25v3M4 16h3M25 16h3M7.5 7.5l2.1 2.1M22.4 22.4l2.1 2.1M24.5 7.5l-2.1 2.1M9.6 22.4l-2.1 2.1"/>
        </svg>`;
      case 'clear-night':
        return `<svg viewBox="0 0 32 32" fill="none" stroke="#93c5fd" stroke-width="1.8">
          <path stroke-linecap="round" stroke-linejoin="round" fill="rgba(147,197,253,0.14)" d="M21.5 19.8A8.5 8.5 0 0112.2 8.5a8.5 8.5 0 109.3 11.3z"/>
        </svg>`;
      case 'partly-day':
        return `<svg viewBox="0 0 32 32" fill="none">
          <circle cx="12" cy="12" r="4.8" stroke="#fdba74" stroke-width="1.6" fill="rgba(253,186,116,0.15)"/>
          <path d="M12 4.5v2M4.5 12h2M6.7 6.7l1.4 1.4M17.3 6.7l-1.4 1.4" stroke="#fdba74" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M11 23h11.5a4.5 4.5 0 00.6-8.96A6 6 0 0011.3 13a4.5 4.5 0 00-.3 10z" fill="rgba(24,24,27,0.85)" stroke="#e4e4e7" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>`;
      case 'partly-night':
        return `<svg viewBox="0 0 32 32" fill="none">
          <path d="M15 8a5 5 0 004 7.5" stroke="#93c5fd" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M10 23h12a4.5 4.5 0 00.5-8.96A6 6 0 0010.5 13a4.5 4.5 0 00-.5 10z" fill="rgba(24,24,27,0.85)" stroke="#a1a1aa" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>`;
      case 'cloudy':
      case 'fog':
        return `<svg viewBox="0 0 32 32" fill="none">
          <path d="M9.5 23h13a4.8 4.8 0 00.6-9.55A6.5 6.5 0 0010.2 12a4.8 4.8 0 00-.7 11z" fill="rgba(161,161,170,0.12)" stroke="#a1a1aa" stroke-width="1.7" stroke-linejoin="round"/>
        </svg>`;
      case 'drizzle':
      case 'rain':
        return `<svg viewBox="0 0 32 32" fill="none">
          <path d="M9.5 20.5h13a4.5 4.5 0 00.5-8.96A6 6 0 0010.2 10.5a4.5 4.5 0 00-.7 10z" fill="rgba(96,165,250,0.12)" stroke="#cbd5e1" stroke-width="1.6"/>
          <path d="M12 24l-1.2 3.2M16.5 24l-1.2 3.2M21 24l-1.2 3.2" stroke="#60a5fa" stroke-width="1.7" stroke-linecap="round"/>
        </svg>`;
      case 'heavy-rain':
      case 'storm':
        return `<svg viewBox="0 0 32 32" fill="none">
          <path d="M9.5 19.5h13a4.5 4.5 0 00.5-8.96A6 6 0 0010.2 9.5a4.5 4.5 0 00-.7 10z" fill="rgba(96,165,250,0.15)" stroke="#cbd5e1" stroke-width="1.6"/>
          <path d="M16 20l-2.5 4.2h3l-1.5 4" stroke="#fbbf24" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M11 23l-1 3M21.5 23l-1 3" stroke="#60a5fa" stroke-width="1.6" stroke-linecap="round"/>
        </svg>`;
      default:
        return `<svg viewBox="0 0 32 32" fill="none" stroke="#e4e4e7" stroke-width="1.6">
          <circle cx="16" cy="16" r="6"/>
        </svg>`;
    }
  }

  function degreesToCardinal(deg) {
    if (!Number.isFinite(deg)) return '--';
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
    const idx = Math.round(((deg % 360) / 22.5)) % 16;
    return `${dirs[idx]} ${Math.round(deg)}°`;
  }

  // ==================== CÁLCULOS ASTRONÓMICOS (FASE LUNAR Y ARCO SOLAR) ====================
  /**
   * Calcula con precisión astronómica la fase lunar actual, porcentaje de iluminación,
   * edad en días, fechas de próxima Luna Llena y Luna Nueva, y genera el SVG geométrico.
   */
  function computeMoonPhaseData(date = new Date()) {
    const SYNODIC_MONTH = 29.530588853;
    // Luna nueva de referencia: 6 de enero de 2000 18:14 UTC
    const refNewMoonMs = Date.UTC(2000, 0, 6, 18, 14, 0);
    const diffDays = (date.getTime() - refNewMoonMs) / 86400000;
    const phase = ((diffDays % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH / SYNODIC_MONTH; // [0..1)
    const ageDays = phase * SYNODIC_MONTH;
    const illumination = 0.5 * (1 - Math.cos(2 * Math.PI * phase)) * 100;

    let phaseName = 'Luna nueva';
    if (phase < 0.03 || phase > 0.97) phaseName = 'Luna nueva';
    else if (phase < 0.22) phaseName = 'Luna creciente';
    else if (phase < 0.28) phaseName = 'Cuarto creciente';
    else if (phase < 0.47) phaseName = 'Gibosa creciente';
    else if (phase < 0.53) phaseName = 'Luna llena';
    else if (phase < 0.72) phaseName = 'Gibosa menguante';
    else if (phase < 0.78) phaseName = 'Cuarto menguante';
    else phaseName = 'Luna menguante';

    // Días hasta la próxima Luna Llena (phase = 0.5) y Luna Nueva (phase = 1.0)
    const daysToFull = ((0.5 - phase + 1) % 1) * SYNODIC_MONTH;
    const daysToNew = ((1.0 - phase) % 1) * SYNODIC_MONTH;

    const nextFullDate = new Date(date.getTime() + daysToFull * 86400000);
    const nextNewDate = new Date(date.getTime() + daysToNew * 86400000);

    const fmtDate = (d, days) => {
      if (days < 0.8) return 'Hoy';
      if (days < 1.8) return 'Mañana';
      return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    };

    return {
      phase,
      ageDays,
      illumination,
      phaseName,
      nextFullStr: fmtDate(nextFullDate, daysToFull),
      nextNewStr: fmtDate(nextNewDate, daysToNew),
      isWaxing: phase <= 0.5,
      svg: buildMoonPhaseSvg(phase)
    };
  }

  /**
   * Genera un SVG de la esfera lunar con el terminador esférico exacto para `phase` en [0, 1)
   */
  function buildMoonPhaseSvg(phase) {
    const r = 28;
    const cx = 35;
    const cy = 35;

    // phase = 0 (nueva), 0.25 (cuarto creciente), 0.5 (llena), 0.75 (cuarto menguante)
    const isWaxing = phase <= 0.5;
    // Proyección del terminador: cos(2*pi*phase) varía entre 1 y -1
    const termRx = Math.abs(Math.cos(2 * Math.PI * phase)) * r;

    let litPath = '';
    if (phase < 0.015 || phase > 0.985) {
      litPath = ''; // Luna nueva
    } else if (Math.abs(phase - 0.5) < 0.015) {
      litPath = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f4f4f5" />`;
    } else {
      // Semicírculo exterior iluminado (derecha en creciente, izquierda en menguante)
      const outerSweep = isWaxing ? 1 : 0;
      // Curva del terminador interior
      const isGibbous = phase > 0.25 && phase < 0.75;
      const innerSweep = isWaxing ? (isGibbous ? 1 : 0) : (isGibbous ? 0 : 1);

      litPath = `<path d="M ${cx} ${cy - r} A ${r} ${r} 0 0 ${outerSweep} ${cx} ${cy + r} A ${termRx.toFixed(
        2
      )} ${r} 0 0 ${innerSweep} ${cx} ${cy - r} Z" fill="#e4e4e7" />`;
    }

    return `
      <svg viewBox="0 0 70 70" aria-hidden="true">
        <!-- Disco oscuro base -->
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="#18181b" stroke="rgba(255,255,255,0.14)" stroke-width="1.2" />
        <!-- Superficie iluminada -->
        ${litPath}
        <!-- Cráteres sutiles decorativos -->
        <circle cx="27" cy="26" r="4.2" fill="rgba(0,0,0,0.09)" />
        <circle cx="42" cy="30" r="6" fill="rgba(0,0,0,0.08)" />
        <circle cx="33" cy="44" r="3.5" fill="rgba(0,0,0,0.08)" />
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1" />
      </svg>
    `;
  }

  // ==================== PETICIONES A LAS APIS (OPEN-METEO) ====================
  async function fetchForecastData() {
    const { lat, lon } = state.coords;
    const params = new URLSearchParams({
      latitude: lat.toString(),
      longitude: lon.toString(),
      current: [
        'temperature_2m',
        'relative_humidity_2m',
        'apparent_temperature',
        'is_day',
        'precipitation',
        'weather_code',
        'cloud_cover',
        'pressure_msl',
        'wind_speed_10m',
        'wind_direction_10m',
        'wind_gusts_10m'
      ].join(','),
      hourly: [
        'temperature_2m',
        'apparent_temperature',
        'relative_humidity_2m',
        'dew_point_2m',
        'precipitation_probability',
        'precipitation',
        'weather_code',
        'pressure_msl',
        'cloud_cover',
        'visibility',
        'wind_speed_10m',
        'wind_direction_10m',
        'wind_gusts_10m',
        'uv_index',
        'direct_radiation',
        'is_day'
      ].join(','),
      daily: [
        'weather_code',
        'temperature_2m_max',
        'temperature_2m_min',
        'sunrise',
        'sunset',
        'daylight_duration',
        'uv_index_max',
        'precipitation_sum',
        'precipitation_probability_max',
        'wind_speed_10m_max',
        'wind_gusts_10m_max'
      ].join(','),
      wind_speed_unit: 'kmh',
      temperature_unit: 'celsius',
      precipitation_unit: 'mm',
      timezone: 'auto',
      forecast_days: '7'
    });

    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!res.ok) throw new Error(`Forecast HTTP ${res.status}`);
    const data = await res.json();
    processForecastData(data);
    return data;
  }

  function processForecastData(data) {
    state.forecastData = data;
    const h = data.hourly;
    const d = data.daily;
    if (!h || !Array.isArray(h.time)) return;

    const now = new Date();
    let startIdx = 0;
    let minDiff = Infinity;

    for (let i = 0; i < h.time.length; i++) {
      const t = new Date(h.time[i]);
      const diff = now.getTime() - t.getTime();
      if (diff >= 0 && diff < 3600 * 1000) {
        startIdx = i;
        break;
      }
      const absDiff = Math.abs(diff);
      if (absDiff < minDiff) {
        minDiff = absDiff;
        startIdx = i;
      }
    }

    startIdx = Math.min(startIdx, Math.max(0, h.time.length - 24));
    state.currentHourIndex = startIdx;

    const slice24 = [];
    for (let i = startIdx; i < Math.min(startIdx + 24, h.time.length); i++) {
      slice24.push({
        timeISO: h.time[i],
        dateObj: new Date(h.time[i]),
        temperature_2m: h.temperature_2m?.[i] ?? 0,
        apparent_temperature: h.apparent_temperature?.[i] ?? 0,
        relative_humidity_2m: h.relative_humidity_2m?.[i] ?? 0,
        dew_point_2m: h.dew_point_2m?.[i] ?? 0,
        precipitation_probability: h.precipitation_probability?.[i] ?? 0,
        precipitation: h.precipitation?.[i] ?? 0,
        weather_code: h.weather_code?.[i] ?? 0,
        pressure_msl: h.pressure_msl?.[i] ?? 1013,
        cloud_cover: h.cloud_cover?.[i] ?? 0,
        visibility: h.visibility?.[i] ?? 24000,
        wind_speed_10m: h.wind_speed_10m?.[i] ?? 0,
        wind_direction_10m: h.wind_direction_10m?.[i] ?? 0,
        wind_gusts_10m: h.wind_gusts_10m?.[i] ?? 0,
        uv_index: h.uv_index?.[i] ?? 0,
        direct_radiation: h.direct_radiation?.[i] ?? 0,
        is_day: h.is_day?.[i] ?? 1
      });
    }
    state.hourlySlice24 = slice24;

    if (d && Array.isArray(d.time)) {
      state.dailySlice7 = d.time.slice(0, 7).map((tStr, i) => ({
        dateStr: tStr,
        dateObj: new Date(`${tStr}T12:00:00`),
        weather_code: d.weather_code?.[i] ?? 0,
        tempMax: d.temperature_2m_max?.[i] ?? 20,
        tempMin: d.temperature_2m_min?.[i] ?? 10,
        sunrise: d.sunrise?.[i] ?? null,
        sunset: d.sunset?.[i] ?? null,
        daylightSeconds: d.daylight_duration?.[i] ?? 43200,
        uvMax: d.uv_index_max?.[i] ?? 0,
        precipSum: d.precipitation_sum?.[i] ?? 0,
        precipProbMax: d.precipitation_probability_max?.[i] ?? 0,
        windMax: d.wind_speed_10m_max?.[i] ?? 0,
        gustMax: d.wind_gusts_10m_max?.[i] ?? 0
      }));
    }
  }

  async function fetchMarineData() {
    const { lat, lon } = state.coords;
    const params = new URLSearchParams({
      latitude: lat.toString(),
      longitude: lon.toString(),
      current: 'sea_surface_temperature,wave_height,wave_direction,wave_period',
      hourly: 'sea_surface_temperature,wave_height',
      timezone: 'auto'
    });
    const res = await fetch(`https://marine-api.open-meteo.com/v1/marine?${params.toString()}`);
    if (!res.ok) throw new Error(`Marine HTTP ${res.status}`);
    state.marineData = await res.json();
    return state.marineData;
  }

  async function fetchAirQualityData() {
    const { lat, lon } = state.coords;
    const params = new URLSearchParams({
      latitude: lat.toString(),
      longitude: lon.toString(),
      current: 'european_aqi,pm10,pm2_5,ozone,nitrogen_dioxide',
      timezone: 'auto'
    });
    const res = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params.toString()}`);
    if (!res.ok) throw new Error(`AirQuality HTTP ${res.status}`);
    state.airData = await res.json();
    return state.airData;
  }

  // ==================== RENDERIZADO DE LA INTERFAZ ====================
  function renderDashboard() {
    if (!state.forecastData || state.hourlySlice24.length === 0) return;

    renderHeroSection();
    renderTelemetryCards();
    render7DayForecast();
    render24HourTimeline();
  }

  /**
   * 1. Renderiza Hero: Tiempo Actual + Arco Solar (Salida/Puesta) + Fase Lunar
   */
  function renderHeroSection() {
    const cur = state.forecastData.current || {};
    const h0 = state.hourlySlice24[0] || {};
    const today = state.dailySlice7[0] || {};

    const temp = Number(cur.temperature_2m ?? h0.temperature_2m ?? 20);
    const apparent = Number(cur.apparent_temperature ?? h0.apparent_temperature ?? temp);
    const isDay = Number(cur.is_day ?? h0.is_day ?? 1);
    const wmoCode = cur.weather_code ?? h0.weather_code ?? 0;
    const wmoInfo = getWmoInfo(wmoCode, isDay);

    const dateLabel = document.getElementById('currentDateLabel');
    const dayNightBadge = document.getElementById('dayNightBadge');
    const heroTemp = document.getElementById('heroTempNow');
    const heroIcon = document.getElementById('heroWeatherIconBox');
    const heroCond = document.getElementById('heroConditionText');
    const heroHighLow = document.getElementById('heroHighLowText');
    const heroFeels = document.getElementById('heroFeelsLikeText');
    const heroWaterQuick = document.getElementById('heroWaterQuickText');
    const heroNarrative = document.getElementById('heroNarrativeText');

    const now = new Date();
    if (dateLabel) {
      dateLabel.textContent = now.toLocaleDateString('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      });
    }
    if (dayNightBadge) {
      dayNightBadge.textContent = isDay ? 'Día' : 'Noche';
    }
    if (heroTemp) heroTemp.textContent = `${temp.toFixed(1)}°`;
    if (heroIcon) heroIcon.innerHTML = renderWeatherSvgIcon(wmoInfo.type);
    if (heroCond) heroCond.textContent = wmoInfo.label;

    if (heroHighLow && today.tempMax !== undefined) {
      heroHighLow.textContent = `Máx ${Math.round(today.tempMax)}° · Mín ${Math.round(today.tempMin)}°`;
    }
    if (heroFeels) {
      heroFeels.textContent = `Sensación ${apparent.toFixed(1)}°`;
    }

    const sst = state.marineData?.current?.sea_surface_temperature;
    if (heroWaterQuick) {
      heroWaterQuick.textContent =
        sst !== null && sst !== undefined ? `Agua ${Number(sst).toFixed(1)}°C` : 'Interior';
    }

    // Resumen inteligente de las próximas horas
    if (heroNarrative) {
      const next12 = state.hourlySlice24.slice(0, 12);
      const maxProb12 = Math.max(...next12.map((h) => h.precipitation_probability || 0));
      const maxWind12 = Math.max(...next12.map((h) => h.wind_speed_10m || 0));
      const radarDist = state.radar.closestEchoKm;

      const notes = [];
      if (radarDist !== null && radarDist < 25) {
        notes.push(`Precipitación detectada en el radar a ${radarDist.toFixed(1)} km.`);
      } else if (maxProb12 > 35) {
        notes.push(`Probabilidad de lluvia del ${Math.round(maxProb12)}% en las próximas 12 horas.`);
      } else {
        notes.push('Sin precipitaciones significativas previstas en las próximas horas.');
      }

      if (sst !== null && sst !== undefined) {
        const waveH = state.marineData?.current?.wave_height ?? 0;
        notes.push(`Temperatura superficial del mar a ${Number(sst).toFixed(1)}°C con olas de ${Number(waveH).toFixed(2)} m.`);
      } else {
        notes.push(`Viento máximo previsto hoy de ${Math.round(maxWind12)} km/h.`);
      }

      heroNarrative.textContent = notes.join(' ');
    }

    // --- COLUMNA 2: CICLO SOLAR (SALIDA Y PUESTA DE SOL) ---
    renderSolarCycle(today, now);

    // --- COLUMNA 3: FASE LUNAR ---
    renderLunarCycle(now);
  }

  function renderSolarCycle(today, now) {
    const sunriseEl = document.getElementById('sunriseTimeVal');
    const sunsetEl = document.getElementById('sunsetTimeVal');
    const noonEl = document.getElementById('solarNoonTimeVal');
    const durationBadge = document.getElementById('daylightDurationBadge');
    const titleEl = document.getElementById('solarStatusTitle');
    const sunDot = document.getElementById('solarSunDot');
    const sunHalo = document.getElementById('solarSunHalo');
    const activePath = document.getElementById('solarActivePath');

    if (!today || !today.sunrise || !today.sunset) return;

    const srDate = new Date(today.sunrise);
    const ssDate = new Date(today.sunset);
    const noonDate = new Date((srDate.getTime() + ssDate.getTime()) / 2);

    const fmtHM = (d) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    if (sunriseEl) sunriseEl.textContent = fmtHM(srDate);
    if (sunsetEl) sunsetEl.textContent = fmtHM(ssDate);
    if (noonEl) noonEl.textContent = fmtHM(noonDate);

    const totalSec = today.daylightSeconds || (ssDate.getTime() - srDate.getTime()) / 1000;
    const dHours = Math.floor(totalSec / 3600);
    const dMins = Math.round((totalSec % 3600) / 60);
    if (durationBadge) {
      durationBadge.textContent = `${dHours}h ${dMins}m de sol`;
    }

    // Progreso solar t en [0, 1] entre el amanecer y el atardecer
    const totalDayMs = ssDate.getTime() - srDate.getTime();
    const elapsedMs = now.getTime() - srDate.getTime();
    let t = totalDayMs > 0 ? elapsedMs / totalDayMs : 0.5;

    if (now < srDate) {
      t = 0;
      const minsToSunrise = Math.max(1, Math.round((srDate.getTime() - now.getTime()) / 60000));
      const h = Math.floor(minsToSunrise / 60);
      const m = minsToSunrise % 60;
      if (titleEl) titleEl.textContent = `Amanece en ${h > 0 ? h + 'h ' : ''}${m}m`;
    } else if (now > ssDate) {
      t = 1;
      if (titleEl) titleEl.textContent = `Sol bajo el horizonte`;
    } else {
      const minsLeft = Math.max(1, Math.round((ssDate.getTime() - now.getTime()) / 60000));
      const h = Math.floor(minsLeft / 60);
      const m = minsLeft % 60;
      if (titleEl) titleEl.textContent = `Puesta en ${h > 0 ? h + 'h ' : ''}${m}m`;
    }

    // Coordenadas exactas sobre la curva cuadrática Bézier: M 24 84 Q 130 -12 236 84
    const p0 = { x: 24, y: 84 };
    const p1 = { x: 130, y: -12 };
    const p2 = { x: 236, y: 84 };

    const bx = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
    const by = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;

    if (sunDot) {
      sunDot.setAttribute('cx', bx.toFixed(1));
      sunDot.setAttribute('cy', by.toFixed(1));
      sunDot.style.opacity = now >= srDate && now <= ssDate ? '1' : '0.35';
    }
    if (sunHalo) {
      sunHalo.setAttribute('cx', bx.toFixed(1));
      sunHalo.setAttribute('cy', by.toFixed(1));
      sunHalo.style.opacity = now >= srDate && now <= ssDate ? '1' : '0';
    }
    if (activePath) {
      const pathLen = 300;
      activePath.style.strokeDashoffset = String(Math.round(pathLen * (1 - t)));
    }
  }

  function renderLunarCycle(now) {
    const moon = computeMoonPhaseData(now);

    const nameEl = document.getElementById('moonPhaseName');
    const ilumEl = document.getElementById('moonIlluminationBadge');
    const svgBox = document.getElementById('moonSvgContainer');
    const ageEl = document.getElementById('moonAgeVal');
    const fullEl = document.getElementById('nextFullMoonVal');
    const newEl = document.getElementById('nextNewMoonVal');
    const noteEl = document.getElementById('moonInfluenceNote');

    if (nameEl) nameEl.textContent = moon.phaseName;
    if (ilumEl) ilumEl.textContent = `${Math.round(moon.illumination)}% ilum.`;
    if (svgBox) svgBox.innerHTML = moon.svg;
    if (ageEl) ageEl.textContent = `${moon.ageDays.toFixed(1)} días`;
    if (fullEl) fullEl.textContent = moon.nextFullStr;
    if (newEl) newEl.textContent = moon.nextNewStr;

    if (noteEl) {
      if (moon.illumination > 92) {
        noteEl.textContent = 'Plenilunio: coeficientes de marea más pronunciados y alta luminosidad nocturna.';
      } else if (moon.illumination < 8) {
        noteEl.textContent = 'Novilunio: cielo nocturno oscuro óptimo para observación astronómica.';
      } else {
        noteEl.textContent = `Fase ${moon.isWaxing ? 'creciente' : 'menguante'} (${Math.round(
          moon.illumination
        )}% del disco visible).`;
      }
    }
  }

  /**
   * 2. Renderiza las 8 Tarjetas de Telemetría (incluyendo Temperatura del Agua y Calidad del Aire)
   */
  function renderTelemetryCards() {
    const cur = state.forecastData.current || {};
    const h0 = state.hourlySlice24[0] || {};
    const today = state.dailySlice7[0] || {};

    // --- 1. TEMPERATURA DEL AGUA Y ESTADO DEL MAR ---
    const sst = state.marineData?.current?.sea_surface_temperature;
    const waveH = state.marineData?.current?.wave_height;
    const waveP = state.marineData?.current?.wave_period;
    const waveDir = state.marineData?.current?.wave_direction;

    const waterVal = document.getElementById('metricWaterTempVal');
    const waveHVal = document.getElementById('metricWaveHeightVal');
    const wavePVal = document.getElementById('metricWavePeriodVal');
    const marineChip = document.getElementById('marineStatusChip');
    const waterBar = document.getElementById('waterTempBarFill');
    const marineFoot = document.getElementById('marineFootnote');

    if (sst !== null && sst !== undefined) {
      const sstNum = Number(sst);
      const wHeight = Number(waveH ?? 0);
      const wPeriod = Number(waveP ?? 0);

      if (waterVal) waterVal.innerHTML = `${sstNum.toFixed(1)}<span class="unit">°C</span>`;
      if (waveHVal) waveHVal.textContent = `${wHeight.toFixed(2)} m`;
      if (wavePVal) wavePVal.textContent = `${wPeriod.toFixed(0)} s`;

      // Escala de 10°C a 28°C
      const sstPct = Math.min(100, Math.max(4, ((sstNum - 10) / 18) * 100));
      if (waterBar) {
        waterBar.style.width = `${sstPct}%`;
        waterBar.style.background =
          sstNum >= 23 ? '#34d399' : sstNum >= 18 ? '#38bdf8' : '#60a5fa';
      }

      // Escala Douglas de estado de la mar
      let seaState = 'Mar llana';
      let chipClass = 'chip-green';
      if (wHeight < 0.1) {
        seaState = 'Mar llana';
      } else if (wHeight < 0.5) {
        seaState = 'Mar rizada';
      } else if (wHeight < 1.25) {
        seaState = 'Marejadilla';
        chipClass = 'chip-sky';
      } else if (wHeight < 2.5) {
        seaState = 'Marejada';
        chipClass = 'chip-yellow';
      } else {
        seaState = 'Fuerte marejada';
        chipClass = 'chip-red';
      }

      if (marineChip) {
        marineChip.textContent = seaState;
        marineChip.className = `metric-status-chip ${chipClass}`;
      }
      if (marineFoot) {
        marineFoot.textContent = `Oleaje de dirección ${degreesToCardinal(waveDir)} · Agua a ${sstNum.toFixed(1)}°C.`;
      }
    } else {
      if (waterVal) waterVal.innerHTML = `--<span class="unit">°C</span>`;
      if (waveHVal) waveHVal.textContent = `-- m`;
      if (wavePVal) wavePVal.textContent = `-- s`;
      if (waterBar) waterBar.style.width = '0%';
      if (marineChip) {
        marineChip.textContent = 'Interior';
        marineChip.className = 'metric-status-chip';
      }
      if (marineFoot) {
        marineFoot.textContent = 'Ubicación interior sin celda marina costera directa.';
      }
    }

    // --- 2. VIENTO Y RACHAS ---
    const wind = Number(cur.wind_speed_10m ?? h0.wind_speed_10m ?? 0);
    const gusts = Number(cur.wind_gusts_10m ?? h0.wind_gusts_10m ?? wind);
    const windDir = Number(cur.wind_direction_10m ?? h0.wind_direction_10m ?? 0);

    const windVal = document.getElementById('metricWindSpeedVal');
    const gustVal = document.getElementById('metricWindGustVal');
    const dirVal = document.getElementById('metricWindDirVal');
    const windChip = document.getElementById('windStatusChip');
    const windBar = document.getElementById('windSpeedBarFill');
    const gustMarker = document.getElementById('windGustMarker');
    const windFoot = document.getElementById('windFootnote');

    if (windVal) windVal.innerHTML = `${Math.round(wind)}<span class="unit">km/h</span>`;
    if (gustVal) gustVal.textContent = `${Math.round(gusts)} km/h`;
    if (dirVal) dirVal.textContent = degreesToCardinal(windDir);

    const windPct = Math.min(100, Math.max(3, (wind / 50) * 100));
    const gustPct = Math.min(100, Math.max(3, (gusts / 50) * 100));
    if (windBar) {
      windBar.style.width = `${windPct}%`;
      windBar.style.background = gusts > 40 ? '#fb7185' : wind > 25 ? '#fbbf24' : '#34d399';
    }
    if (gustMarker) gustMarker.style.left = `${gustPct}%`;

    if (windChip) {
      if (gusts > 45 || wind > 35) {
        windChip.textContent = 'Fuerte';
        windChip.className = 'metric-status-chip chip-red';
      } else if (wind > 20 || gusts > 30) {
        windChip.textContent = 'Moderado';
        windChip.className = 'metric-status-chip chip-yellow';
      } else if (wind >= 6) {
        windChip.textContent = 'Brisa suave';
        windChip.className = 'metric-status-chip chip-green';
      } else {
        windChip.textContent = 'En calma';
        windChip.className = 'metric-status-chip';
      }
    }
    if (windFoot) {
      windFoot.textContent = `Flujo de componente ${degreesToCardinal(windDir)} con rachas de ${Math.round(gusts)} km/h.`;
    }

    // --- 3. HUMEDAD Y PUNTO DE ROCÍO ---
    const hum = Number(cur.relative_humidity_2m ?? h0.relative_humidity_2m ?? 50);
    const dew = Number(h0.dew_point_2m ?? 12);
    const temp = Number(cur.temperature_2m ?? h0.temperature_2m ?? 20);
    const spread = Number((temp - dew).toFixed(1));

    const humVal = document.getElementById('metricHumidityVal');
    const dewVal = document.getElementById('metricDewPointVal');
    const spreadVal = document.getElementById('metricDewSpreadVal');
    const humChip = document.getElementById('humidityStatusChip');
    const humBar = document.getElementById('humidityBarFill');
    const humFoot = document.getElementById('humidityFootnote');

    if (humVal) humVal.innerHTML = `${Math.round(hum)}<span class="unit">%</span>`;
    if (dewVal) dewVal.textContent = `${dew.toFixed(1)}°C`;
    if (spreadVal) spreadVal.textContent = `${spread.toFixed(1)}°C`;
    if (humBar) {
      humBar.style.width = `${Math.min(100, Math.max(0, hum))}%`;
      humBar.style.background = hum > 80 ? '#60a5fa' : hum < 35 ? '#fbbf24' : '#34d399';
    }
    if (humChip) {
      if (hum >= 40 && hum <= 65) {
        humChip.textContent = 'Confortable';
        humChip.className = 'metric-status-chip chip-green';
      } else if (hum > 65) {
        humChip.textContent = hum > 80 ? 'Húmedo' : 'Moderada';
        humChip.className = 'metric-status-chip chip-sky';
      } else {
        humChip.textContent = 'Ambiente seco';
        humChip.className = 'metric-status-chip chip-yellow';
      }
    }
    if (humFoot) {
      humFoot.textContent =
        dew >= 20
          ? `Punto de rocío alto (${dew.toFixed(1)}°C): sensación de bochorno.`
          : `Punto de rocío en ${dew.toFixed(1)}°C (margen térmico de ${spread.toFixed(1)}°C).`;
    }

    // --- 4. ÍNDICE UV Y RADIACIÓN SOLAR ---
    const uv = Number(h0.uv_index ?? 0);
    const uvMax = Number(today.uvMax ?? uv);
    const rad = Number(h0.direct_radiation ?? 0);

    const uvVal = document.getElementById('metricUvIndexVal');
    const uvMaxEl = document.getElementById('metricUvMaxVal');
    const radEl = document.getElementById('metricDirectRadVal');
    const uvChip = document.getElementById('uvStatusChip');
    const uvBar = document.getElementById('uvBarFill');
    const uvFoot = document.getElementById('uvFootnote');

    if (uvVal) uvVal.textContent = uv.toFixed(1);
    if (uvMaxEl) uvMaxEl.textContent = uvMax.toFixed(1);
    if (radEl) radEl.textContent = `${Math.round(rad)} W/m²`;

    const uvPct = Math.min(100, Math.max(2, (uv / 11) * 100));
    if (uvBar) {
      uvBar.style.width = `${uvPct}%`;
      uvBar.style.background = uv >= 8 ? '#fb7185' : uv >= 3 ? '#fbbf24' : '#34d399';
    }
    if (uvChip) {
      if (uv < 3) {
        uvChip.textContent = 'Bajo';
        uvChip.className = 'metric-status-chip chip-green';
      } else if (uv < 6) {
        uvChip.textContent = 'Moderado';
        uvChip.className = 'metric-status-chip chip-yellow';
      } else if (uv < 8) {
        uvChip.textContent = 'Alto';
        uvChip.className = 'metric-status-chip chip-yellow';
      } else {
        uvChip.textContent = 'Muy alto';
        uvChip.className = 'metric-status-chip chip-red';
      }
    }
    if (uvFoot) {
      uvFoot.textContent = `Máximo diario previsto de UV ${uvMax.toFixed(1)} · Radiación ${Math.round(rad)} W/m².`;
    }

    // --- 5. PRESIÓN ATMOSFÉRICA ---
    const press = Number(cur.pressure_msl ?? h0.pressure_msl ?? 1013);
    const press6h = Number(state.hourlySlice24[Math.min(6, state.hourlySlice24.length - 1)]?.pressure_msl ?? press);
    const pressDiff = press6h - press;

    const pressVal = document.getElementById('metricPressureVal');
    const pressTrend = document.getElementById('metricPressureTrendVal');
    const pressChip = document.getElementById('pressureStatusChip');
    const pressBar = document.getElementById('pressureBarFill');
    const pressFoot = document.getElementById('pressureFootnote');

    if (pressVal) pressVal.innerHTML = `${Math.round(press)}<span class="unit">hPa</span>`;
    if (pressTrend) {
      const sign = pressDiff > 0 ? '+' : '';
      pressTrend.textContent =
        Math.abs(pressDiff) < 0.7 ? 'Estable' : `${sign}${pressDiff.toFixed(1)} hPa`;
    }

    // Escala de 985 a 1040 hPa (1013 es ~51%)
    const pressPct = Math.min(100, Math.max(4, ((press - 985) / 55) * 100));
    if (pressBar) {
      pressBar.style.width = `${pressPct}%`;
      pressBar.style.background = press >= 1018 ? '#34d399' : press <= 1005 ? '#fbbf24' : '#fafafa';
    }
    if (pressChip) {
      if (press >= 1020) {
        pressChip.textContent = 'Anticiclón';
        pressChip.className = 'metric-status-chip chip-green';
      } else if (press <= 1006) {
        pressChip.textContent = 'Baja presión';
        pressChip.className = 'metric-status-chip chip-yellow';
      } else {
        pressChip.textContent = 'Normal';
        pressChip.className = 'metric-status-chip';
      }
    }
    if (pressFoot) {
      pressFoot.textContent =
        pressDiff < -1.5
          ? 'Descenso barométrico en las próximas 6h (posible aumento de inestabilidad).'
          : pressDiff > 1.5
          ? 'Ascenso barométrico en las próximas 6h (tendencia a la estabilidad).'
          : 'Presión atmosférica estable a nivel del mar.';
    }

    // --- 6. PRECIPITACIÓN Y RADAR ---
    const precipProb = Number(h0.precipitation_probability ?? 0);
    const precipNow = Number(cur.precipitation ?? h0.precipitation ?? 0);
    const precip24h = state.hourlySlice24.reduce((acc, h) => acc + (h.precipitation || 0), 0);

    const precipProbEl = document.getElementById('metricPrecipProbVal');
    const precipNowEl = document.getElementById('metricPrecipNowVal');
    const precip24hEl = document.getElementById('metricPrecip24hVal');
    const precipChip = document.getElementById('precipStatusChip');
    const precipBar = document.getElementById('precipBarFill');
    const precipFoot = document.getElementById('precipFootnote');

    if (precipProbEl) precipProbEl.innerHTML = `${Math.round(precipProb)}<span class="unit">%</span>`;
    if (precipNowEl) precipNowEl.textContent = `${precipNow.toFixed(1)} mm`;
    if (precip24hEl) precip24hEl.textContent = `${precip24h.toFixed(1)} mm`;

    if (precipBar) {
      precipBar.style.width = `${Math.min(100, Math.max(0, precipProb))}%`;
      precipBar.style.background = '#60a5fa';
    }
    if (precipChip) {
      if (precipNow > 0 || precipProb >= 60) {
        precipChip.textContent = 'Lluvia probable';
        precipChip.className = 'metric-status-chip chip-red';
      } else if (precipProb >= 25) {
        precipChip.textContent = 'Riesgo moderado';
        precipChip.className = 'metric-status-chip chip-yellow';
      } else {
        precipChip.textContent = 'Sin lluvia';
        precipChip.className = 'metric-status-chip chip-green';
      }
    }
    if (precipFoot) {
      precipFoot.textContent =
        state.radar.closestEchoKm !== null
          ? `Eco de radar más cercano detectado a ${state.radar.closestEchoKm.toFixed(1)} km.`
          : 'Sin ecos de precipitación en un radio de 30 km.';
    }

    // --- 7. VISIBILIDAD Y NUBOSIDAD ---
    const visMeters = Number(h0.visibility ?? 24000);
    const visKm = visMeters / 1000;
    const clouds = Number(cur.cloud_cover ?? h0.cloud_cover ?? 0);

    const visEl = document.getElementById('metricVisibilityVal');
    const cloudEl = document.getElementById('metricCloudCoverVal');
    const skyEl = document.getElementById('metricSkyStateVal');
    const visChip = document.getElementById('visibilityStatusChip');
    const cloudBar = document.getElementById('cloudBarFill');
    const visFoot = document.getElementById('visibilityFootnote');

    if (visEl) visEl.innerHTML = `${visKm.toFixed(1)}<span class="unit">km</span>`;
    if (cloudEl) cloudEl.textContent = `${Math.round(clouds)}%`;
    if (skyEl) {
      skyEl.textContent = clouds < 20 ? 'Limpio' : clouds < 65 ? 'Parcial' : 'Cubierto';
    }
    if (cloudBar) {
      cloudBar.style.width = `${Math.min(100, Math.max(0, clouds))}%`;
      cloudBar.style.background = '#a1a1aa';
    }
    if (visChip) {
      if (visKm >= 10) {
        visChip.textContent = 'Excelente';
        visChip.className = 'metric-status-chip chip-green';
      } else if (visKm >= 4) {
        visChip.textContent = 'Moderada';
        visChip.className = 'metric-status-chip chip-yellow';
      } else {
        visChip.textContent = 'Reducida';
        visChip.className = 'metric-status-chip chip-red';
      }
    }
    if (visFoot) {
      visFoot.textContent = `Cobertura nubosa del ${Math.round(clouds)}% y visibilidad de ${visKm.toFixed(1)} km.`;
    }

    // --- 8. CALIDAD DEL AIRE (EAQI) ---
    const aqi = state.airData?.current?.european_aqi;
    const pm25 = state.airData?.current?.pm2_5;
    const pm10 = state.airData?.current?.pm10;

    const aqiEl = document.getElementById('metricAqiVal');
    const pm25El = document.getElementById('metricPm25Val');
    const pm10El = document.getElementById('metricPm10Val');
    const aqiChip = document.getElementById('aqiStatusChip');
    const aqiBar = document.getElementById('aqiBarFill');
    const aqiFoot = document.getElementById('aqiFootnote');

    if (aqi !== null && aqi !== undefined) {
      const aqiNum = Number(aqi);
      if (aqiEl) aqiEl.innerHTML = `${Math.round(aqiNum)}<span class="unit">EAQI</span>`;
      if (pm25El) pm25El.textContent = `${Number(pm25 ?? 0).toFixed(1)} µg/m³`;
      if (pm10El) pm10El.textContent = `${Number(pm10 ?? 0).toFixed(1)} µg/m³`;

      const aqiPct = Math.min(100, Math.max(4, aqiNum));
      if (aqiBar) {
        aqiBar.style.width = `${aqiPct}%`;
        aqiBar.style.background = aqiNum <= 40 ? '#34d399' : aqiNum <= 60 ? '#fbbf24' : '#fb7185';
      }

      if (aqiChip) {
        if (aqiNum <= 20) {
          aqiChip.textContent = 'Muy buena';
          aqiChip.className = 'metric-status-chip chip-green';
        } else if (aqiNum <= 40) {
          aqiChip.textContent = 'Buena';
          aqiChip.className = 'metric-status-chip chip-green';
        } else if (aqiNum <= 60) {
          aqiChip.textContent = 'Razonable';
          aqiChip.className = 'metric-status-chip chip-yellow';
        } else {
          aqiChip.textContent = 'Desfavorable';
          aqiChip.className = 'metric-status-chip chip-red';
        }
      }
      if (aqiFoot) {
        aqiFoot.textContent = `Partículas en suspensión PM2.5: ${Number(pm25 ?? 0).toFixed(1)} µg/m³.`;
      }
    }
  }

  /**
   * 3B. Renderiza el Pronóstico de 7 Días con barras proporcionales de temperatura
   */
  function render7DayForecast() {
    const container = document.getElementById('dailyForecastList');
    const days = state.dailySlice7;
    if (!container || !days || days.length === 0) return;

    const weekMin = Math.min(...days.map((d) => d.tempMin));
    const weekMax = Math.max(...days.map((d) => d.tempMax));
    const weekSpan = Math.max(5, weekMax - weekMin);

    container.innerHTML = days
      .map((d, idx) => {
        const dayName =
          idx === 0
            ? 'Hoy'
            : idx === 1
            ? 'Mañana'
            : d.dateObj.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' });

        const wmo = getWmoInfo(d.weather_code, 1);
        const leftPct = ((d.tempMin - weekMin) / weekSpan) * 100;
        const widthPct = Math.max(8, ((d.tempMax - d.tempMin) / weekSpan) * 100);
        const prob = Math.round(d.precipProbMax || 0);

        return `
          <div class="daily-row ${idx === 0 ? 'is-today' : ''}">
            <span class="daily-day-name">${dayName}</span>
            <div class="daily-icon-rain" title="${wmo.label}">
              ${renderWeatherSvgIcon(wmo.type)}
              ${prob >= 15 ? `<span class="daily-rain-prob mono">${prob}%</span>` : ''}
            </div>
            <span class="daily-min-temp mono">${Math.round(d.tempMin)}°</span>
            <div class="daily-range-track">
              <div class="daily-range-bar" style="left:${leftPct.toFixed(1)}%; width:${widthPct.toFixed(1)}%"></div>
            </div>
            <span class="daily-max-temp mono">${Math.round(d.tempMax)}°</span>
            <span class="daily-wind-meta mono" title="Viento máximo">${Math.round(d.windMax)} km/h</span>
          </div>
        `;
      })
      .join('');
  }

  /**
   * 4. Renderiza la Evolución Horaria de las Próximas 24 Horas
   */
  function render24HourTimeline() {
    const wrapper = document.getElementById('matrixColumnsWrapper');
    const hours = state.hourlySlice24;
    if (!wrapper || !hours || hours.length === 0) return;

    const colWidth = 72;
    const totalWidth = hours.length * colWidth;
    const svgHeight = 132;

    const temps = hours.map((h) => h.temperature_2m);
    const minTemp = Math.min(...temps) - 1;
    const maxTemp = Math.max(...temps) + 1;
    const tempSpan = Math.max(4, maxTemp - minTemp);

    const columnsHTML = hours
      .map((h, idx) => {
        const timeStr = h.dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const prob = Math.round(h.precipitation_probability);
        const mm = h.precipitation;
        const hum = Math.round(h.relative_humidity_2m);
        const temp = h.temperature_2m.toFixed(1);
        const wind = Math.round(h.wind_speed_10m);
        const gust = Math.round(h.wind_gusts_10m);
        const press = Math.round(h.pressure_msl);
        const wmo = getWmoInfo(h.weather_code, h.is_day);

        const barHeightPct = Math.min(100, Math.max(prob, mm > 0 ? Math.min(100, 25 + mm * 25) : 5));
        const probColor = prob > 25 || mm > 0 ? '#60a5fa' : '#71717a';

        const windFillPct = Math.min(100, Math.max(8, (wind / 45) * 100));
        const windColor = gust > 40 ? '#fb7185' : wind > 25 ? '#fbbf24' : '#34d399';

        return `
          <div class="hour-col ${idx === 0 ? 'is-now' : ''}">
            <div class="h-cell-time">
              <span>${timeStr}</span>
              ${idx === 0 ? '<span class="now-tag">Ahora</span>' : ''}
            </div>

            <div class="h-cell-rain" title="${timeStr} · ${wmo.label} · Lluvia ${prob}% (${mm.toFixed(1)} mm)">
              <div class="h-mini-wx-icon">${renderWeatherSvgIcon(wmo.type)}</div>
              <span class="rain-prob-val" style="color:${probColor}">${prob}%</span>
              <div class="rain-bar-well">
                <div class="rain-bar-fill" style="height:${barHeightPct}%; opacity:${prob > 0 || mm > 0 ? 1 : 0.16}"></div>
              </div>
              <span class="rain-mm-val">${mm.toFixed(1)}</span>
            </div>

            <div class="h-cell-humtemp" title="${timeStr}: Temp ${temp}°C, Humedad ${hum}%, Rocío ${h.dew_point_2m.toFixed(1)}°C">
              <span class="ht-top-hum">${hum}%</span>
              <span class="ht-bottom-temp">${temp}°</span>
            </div>

            <div class="h-cell-wind" title="${timeStr}: Viento ${wind} km/h (${degreesToCardinal(h.wind_direction_10m)}), Racha ${gust} km/h · Presión ${press} hPa">
              <div class="wind-speed-box">
                <span class="wind-kmh">${wind} <small>km/h</small></span>
                <span class="wind-gust-sub">racha ${gust}</span>
              </div>
              <div class="wind-mini-bar">
                <div class="wind-mini-fill" style="width:${windFillPct}%; background:${windColor}"></div>
              </div>
              <span class="hour-pressure-tag">${press} hPa</span>
            </div>
          </div>
        `;
      })
      .join('');

    const humPoints = [];
    const tempPoints = [];

    hours.forEach((h, idx) => {
      const cx = idx * colWidth + colWidth / 2;
      const humY = 96 - (Math.min(100, Math.max(0, h.relative_humidity_2m)) / 100) * 62;
      const tempY = 98 - ((h.temperature_2m - minTemp) / tempSpan) * 60;

      humPoints.push({ x: cx, y: Number(humY.toFixed(1)) });
      tempPoints.push({ x: cx, y: Number(tempY.toFixed(1)) });
    });

    const humPathD = buildSmoothSvgPath(humPoints);
    const tempPathD = buildSmoothSvgPath(tempPoints);
    const humAreaD = `${humPathD} L ${humPoints[humPoints.length - 1].x},${svgHeight} L ${humPoints[0].x},${svgHeight} Z`;

    const svgOverlayHTML = `
      <svg class="row2-svg-overlay" viewBox="0 0 ${totalWidth} ${svgHeight}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="humAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#7dd3fc" stop-opacity="0.12"/>
            <stop offset="100%" stop-color="#7dd3fc" stop-opacity="0.0"/>
          </linearGradient>
        </defs>
        <path d="${humAreaD}" fill="url(#humAreaGrad)" />
        <path d="${humPathD}" fill="none" stroke="#7dd3fc" stroke-width="1.6" stroke-linecap="round" />
        <path d="${tempPathD}" fill="none" stroke="#fdba74" stroke-width="1.8" stroke-linecap="round" />

        ${humPoints
          .map(
            (pt) =>
              `<circle cx="${pt.x}" cy="${pt.y}" r="2.3" fill="#131316" stroke="#7dd3fc" stroke-width="1.4" />`
          )
          .join('')}
        ${tempPoints
          .map(
            (pt) =>
              `<circle cx="${pt.x}" cy="${pt.y}" r="2.5" fill="#131316" stroke="#fdba74" stroke-width="1.5" />`
          )
          .join('')}
      </svg>
    `;

    wrapper.innerHTML = columnsHTML + svgOverlayHTML;
  }

  function buildSmoothSvgPath(points) {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x},${points[0].y}`;

    let d = `M ${points[0].x},${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const midX = ((p0.x + p1.x) / 2).toFixed(1);
      d += ` C ${midX},${p0.y} ${midX},${p1.y} ${p1.x},${p1.y}`;
    }
    return d;
  }

  // ==================== MAPA LEAFLET + RAINVIEWER DOPPLER ====================
  function initLeafletMap() {
    const mapContainer = document.getElementById('radarMap');
    if (!mapContainer || state.radar.map || typeof L === 'undefined') return;

    const { lat, lon } = state.coords;

    const map = L.map('radarMap', {
      center: [lat, lon],
      zoom: 10,
      zoomControl: true,
      attributionControl: true
    });

    state.radar.map = map;
    setMapBaseLayer('dark_matter');

    map.on('click', (e) => {
      if (e.originalEvent && e.originalEvent.shiftKey) {
        saveCoordinates(e.latlng.lat, e.latlng.lng, 'Punto en mapa');
        updateMapHomeGeometry();
        refreshAllData();
      }
    });

    updateMapHomeGeometry();
    setTimeout(() => map.invalidateSize(), 150);
  }

  function setMapBaseLayer(mode) {
    const map = state.radar.map;
    if (!map) return;

    if (state.radar.baseLayer) {
      map.removeLayer(state.radar.baseLayer);
      state.radar.baseLayer = null;
    }
    if (state.radar.labelsLayer) {
      map.removeLayer(state.radar.labelsLayer);
      state.radar.labelsLayer = null;
    }

    const cartoAttr =
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a> | Radar: <a href="https://www.rainviewer.com">RainViewer</a>';

    if (mode === 'dark_ventusky') {
      state.radar.baseLayer = L.tileLayer(
        `https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png?key=${CARTO_API_KEY}`,
        {
          attribution: cartoAttr,
          subdomains: 'abcd',
          maxZoom: 19,
          zIndex: 1,
          className: 'ventusky-tactical-tiles'
        }
      ).addTo(map);

      state.radar.labelsLayer = L.tileLayer(
        `https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png?key=${CARTO_API_KEY}`,
        {
          subdomains: 'abcd',
          maxZoom: 19,
          zIndex: 350,
          opacity: 0.9
        }
      ).addTo(map);
    } else if (mode === 'dark_matter') {
      state.radar.baseLayer = L.tileLayer(
        `https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png?key=${CARTO_API_KEY}`,
        {
          attribution: cartoAttr,
          subdomains: 'abcd',
          maxZoom: 19,
          zIndex: 1,
          className: 'dark-matter-boosted-tiles'
        }
      ).addTo(map);

      state.radar.labelsLayer = L.tileLayer(
        `https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png?key=${CARTO_API_KEY}`,
        {
          subdomains: 'abcd',
          maxZoom: 19,
          zIndex: 350,
          opacity: 0.88
        }
      ).addTo(map);
    } else if (mode === 'political') {
      state.radar.baseLayer = L.tileLayer(
        `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${CARTO_API_KEY}`,
        {
          attribution: cartoAttr,
          subdomains: 'abcd',
          maxZoom: 19,
          zIndex: 1
        }
      ).addTo(map);
    } else if (mode === 'terrain') {
      state.radar.baseLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: 'Map data: &copy; OpenStreetMap, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)',
        maxZoom: 17,
        zIndex: 1
      }).addTo(map);
    } else if (mode === 'satellite') {
      state.radar.baseLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
          maxZoom: 19,
          zIndex: 1
        }
      ).addTo(map);

      state.radar.labelsLayer = L.tileLayer(
        `https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png?key=${CARTO_API_KEY}`,
        {
          subdomains: 'abcd',
          maxZoom: 19,
          zIndex: 350,
          opacity: 0.9
        }
      ).addTo(map);
    }
  }

  function updateMapHomeGeometry() {
    const map = state.radar.map;
    if (!map) return;

    const { lat, lon, name } = state.coords;

    if (state.radar.homeMarker) {
      map.removeLayer(state.radar.homeMarker);
    }
    state.radar.rangeCircles.forEach((layer) => map.removeLayer(layer));
    state.radar.rangeCircles = [];

    const homeIcon = L.divIcon({
      className: 'custom-home-icon',
      html: `
        <div class="home-radar-pin" title="${name} (${lat}, ${lon})">
          <span class="home-pin-pulse"></span>
          <span class="home-pin-core"></span>
        </div>
      `,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });

    state.radar.homeMarker = L.marker([lat, lon], { icon: homeIcon })
      .bindPopup(
        `<div class="mono" style="color:#09090b;font-size:12px;">
          <strong>${name}</strong><br/>
          ${lat.toFixed(4)}°, ${lon.toFixed(4)}°
        </div>`
      )
      .addTo(map);

    const rings = [
      { radiusKm: 5, color: 'rgba(125, 211, 252, 0.42)', weight: 1, dashArray: null, fillOpacity: 0.01, label: '5 km' },
      { radiusKm: 15, color: 'rgba(255, 255, 255, 0.22)', weight: 1, dashArray: '4, 6', fillOpacity: 0.0, label: '15 km' },
      { radiusKm: 30, color: 'rgba(255, 255, 255, 0.14)', weight: 1, dashArray: '5, 7', fillOpacity: 0.0, label: '30 km' }
    ];

    rings.forEach((ring) => {
      const circle = L.circle([lat, lon], {
        radius: ring.radiusKm * 1000,
        color: ring.color,
        weight: ring.weight,
        dashArray: ring.dashArray,
        fillColor: ring.color,
        fillOpacity: ring.fillOpacity,
        interactive: false
      }).addTo(map);

      state.radar.rangeCircles.push(circle);

      const labelLat = lat + ring.radiusKm / 111.32;
      const labelIcon = L.divIcon({
        className: '',
        html: `<span class="ring-distance-label">${ring.label}</span>`,
        iconSize: [60, 18],
        iconAnchor: [30, 9]
      });
      const labelMarker = L.marker([labelLat, lon], { icon: labelIcon, interactive: false }).addTo(map);
      state.radar.rangeCircles.push(labelMarker);
    });
  }

  async function fetchRainViewerData() {
    const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    if (!response.ok) throw new Error(`RainViewer HTTP ${response.status}`);
    const data = await response.json();

    state.radar.host = data.host || 'https://tilecache.rainviewer.com';
    const pastFrames = data?.radar?.past || [];

    const twoHoursAgoUnix = Math.floor(Date.now() / 1000) - 2 * 3600 - 600;
    const recentPast = pastFrames
      .filter((f) => f.time >= twoHoursAgoUnix)
      .map((f) => ({ ...f, isNowcast: false }));

    state.radar.frames = recentPast.length > 0 ? recentPast : pastFrames.map((f) => ({ ...f, isNowcast: false }));

    const validPaths = new Set(state.radar.frames.map((f) => f.path));
    Object.keys(state.radar.tileLayers).forEach((path) => {
      if (!validPaths.has(path)) {
        if (state.radar.map && state.radar.map.hasLayer(state.radar.tileLayers[path])) {
          state.radar.map.removeLayer(state.radar.tileLayers[path]);
        }
        delete state.radar.tileLayers[path];
      }
    });

    if (state.radar.frames.length > 0) {
      state.radar.currentFrameIdx = state.radar.frames.length - 1;
      setupRadarTimelineUI();
      showRadarFrame(state.radar.currentFrameIdx);

      const latestFrame = state.radar.frames[state.radar.frames.length - 1];
      await scanRadarProximityPixels(latestFrame);
    }
  }

  function setupRadarTimelineUI() {
    const slider = document.getElementById('radarTimelineSlider');
    const ticksContainer = document.getElementById('radarFrameTicks');
    const startLabel = document.getElementById('radarTimelineStartLabel');
    const endLabel = document.getElementById('radarTimelineEndLabel');

    const frames = state.radar.frames;
    if (!slider || frames.length === 0) return;

    slider.min = '0';
    slider.max = String(frames.length - 1);
    slider.value = String(state.radar.currentFrameIdx);

    const firstTime = new Date(frames[0].time * 1000);
    const lastTime = new Date(frames[frames.length - 1].time * 1000);

    if (startLabel) {
      startLabel.textContent = firstTime.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    }
    if (endLabel) {
      endLabel.textContent = `Ahora (${lastTime.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })})`;
    }

    if (ticksContainer) {
      ticksContainer.innerHTML = frames
        .map(
          (f) =>
            `<span class="radar-tick" title="${new Date(f.time * 1000).toLocaleTimeString('es-ES', {
              hour: '2-digit',
              minute: '2-digit'
            })}"></span>`
        )
        .join('');
    }
  }

  function showRadarFrame(index) {
    const frames = state.radar.frames;
    const map = state.radar.map;
    if (!map || frames.length === 0) return;

    const clampedIdx = Math.max(0, Math.min(frames.length - 1, index));
    state.radar.currentFrameIdx = clampedIdx;
    const frame = frames[clampedIdx];

    if (!state.radar.tileLayers[frame.path]) {
      const tileUrl = `${state.radar.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
      state.radar.tileLayers[frame.path] = L.tileLayer(tileUrl, {
        tileSize: 256,
        opacity: 0,
        zIndex: 200,
        maxNativeZoom: 7,
        maxZoom: 19
      });
    }

    const nextLayer = state.radar.tileLayers[frame.path];
    if (!map.hasLayer(nextLayer)) {
      nextLayer.addTo(map);
    }
    nextLayer.setOpacity(state.radar.opacity);

    if (state.radar.activeLayerPath && state.radar.activeLayerPath !== frame.path) {
      const prevLayer = state.radar.tileLayers[state.radar.activeLayerPath];
      if (prevLayer) prevLayer.setOpacity(0);
    }
    state.radar.activeLayerPath = frame.path;

    const slider = document.getElementById('radarTimelineSlider');
    if (slider && Number(slider.value) !== clampedIdx) {
      slider.value = String(clampedIdx);
    }

    const frameDate = new Date(frame.time * 1000);
    const timeStr = frameDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const diffMins = Math.round((Date.now() - frameDate.getTime()) / 60000);
    const relStr = diffMins <= 2 ? 'Tiempo real' : `Hace ${diffMins} min`;

    const frameTimeLabel = document.getElementById('radarFrameTimeLabel');
    const frameTypeTag = document.getElementById('radarFrameTypeTag');
    const scrubberCurrent = document.getElementById('radarScrubberCurrentLabel');

    if (frameTimeLabel) frameTimeLabel.textContent = timeStr;
    if (frameTypeTag) frameTypeTag.textContent = diffMins <= 12 ? 'Actual' : `-${diffMins}m`;
    if (scrubberCurrent) scrubberCurrent.textContent = `${timeStr} · ${relStr}`;
  }

  function toggleRadarPlayback() {
    if (state.radar.isPlaying) {
      stopRadarPlayback();
    } else {
      startRadarPlayback();
    }
  }

  function startRadarPlayback() {
    if (state.radar.frames.length === 0) return;
    state.radar.isPlaying = true;
    updatePlayButtonUI();

    state.radar.playTimer = setInterval(() => {
      const nextIdx = (state.radar.currentFrameIdx + 1) % state.radar.frames.length;
      showRadarFrame(nextIdx);
    }, 650);
  }

  function stopRadarPlayback() {
    state.radar.isPlaying = false;
    if (state.radar.playTimer) {
      clearInterval(state.radar.playTimer);
      state.radar.playTimer = null;
    }
    updatePlayButtonUI();
  }

  function updatePlayButtonUI() {
    const btnText = document.getElementById('radarPlayBtnText');
    const icon = document.getElementById('iconPlayRadar');
    if (!btnText || !icon) return;

    if (state.radar.isPlaying) {
      btnText.textContent = 'Pausar';
      icon.innerHTML = `<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>`;
    } else {
      btnText.textContent = 'Play 2h';
      icon.innerHTML = `<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/>`;
    }
  }

  async function scanRadarProximityPixels(frame) {
    if (!frame || !frame.path) return;

    const { lat, lon } = state.coords;
    const zoom = 7;
    const n = Math.pow(2, zoom);
    const latRad = (lat * Math.PI) / 180;

    const exactTileX = ((lon + 180) / 360) * n;
    const exactTileY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

    const centerTileX = Math.floor(exactTileX);
    const centerTileY = Math.floor(exactTileY);
    const homePixelX = Math.floor((exactTileX - centerTileX) * 256);
    const homePixelY = Math.floor((exactTileY - centerTileY) * 256);

    const kmPerPixel = (40075.016686 * Math.cos(latRad)) / (n * 256);
    const maxRadiusPixels = Math.ceil(30 / kmPerPixel);

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const loadSingleTile = (tx, ty) =>
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const timer = setTimeout(() => resolve(false), 2500);
        img.onload = () => {
          clearTimeout(timer);
          ctx.drawImage(img, 0, 0);
          resolve(true);
        };
        img.onerror = () => {
          clearTimeout(timer);
          resolve(false);
        };
        img.src = `${state.radar.host}${frame.path}/256/${zoom}/${tx}/${ty}/2/1_1.png`;
      });

    try {
      const ok = await loadSingleTile(centerTileX, centerTileY);
      if (ok) {
        const startX = Math.max(0, homePixelX - maxRadiusPixels);
        const startY = Math.max(0, homePixelY - maxRadiusPixels);
        const endX = Math.min(255, homePixelX + maxRadiusPixels);
        const endY = Math.min(255, homePixelY + maxRadiusPixels);
        const w = endX - startX + 1;
        const h = endY - startY + 1;
        const imgData = ctx.getImageData(startX, startY, w, h).data;

        let minDistanceKm = Infinity;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            if (imgData[idx + 3] > 28) {
              const px = startX + x - homePixelX;
              const py = startY + y - homePixelY;
              const distKm = Math.hypot(px, py) * kmPerPixel;
              if (distKm <= 30 && distKm < minDistanceKm) {
                minDistanceKm = distKm;
              }
            }
          }
        }

        state.radar.closestEchoKm = minDistanceKm <= 30 ? Number(minDistanceKm.toFixed(1)) : null;
      }
    } catch (err) {
      state.radar.closestEchoKm = null;
    }

    updateRadarProximityHUD();
    if (state.hourlySlice24.length > 0) {
      renderDashboard();
    }
  }

  function updateRadarProximityHUD() {
    const proxDot = document.getElementById('radarProximityDot');
    const proxText = document.getElementById('radarProximityText');
    const statusEl = document.getElementById('radar25kmStatusText');

    const dist = state.radar.closestEchoKm;
    if (dist !== null && dist < 25) {
      if (proxDot) proxDot.style.background = '#fb7185';
      if (proxText) {
        proxText.textContent = `Lluvia a ${dist.toFixed(1)} km`;
        proxText.style.color = '#fb7185';
      }
      if (statusEl) {
        statusEl.textContent = `Eco a ${dist.toFixed(1)} km`;
        statusEl.style.color = '#fb7185';
      }
    } else if (dist !== null && dist <= 30) {
      if (proxDot) proxDot.style.background = '#fbbf24';
      if (proxText) {
        proxText.textContent = `Eco a ${dist.toFixed(1)} km`;
        proxText.style.color = '#fbbf24';
      }
      if (statusEl) {
        statusEl.textContent = `Eco a ${dist.toFixed(1)} km`;
        statusEl.style.color = '#fbbf24';
      }
    } else {
      if (proxDot) proxDot.style.background = '#34d399';
      if (proxText) {
        proxText.textContent = 'Despejado (30 km)';
        proxText.style.color = '#a1a1aa';
      }
      if (statusEl) {
        statusEl.textContent = 'Sin ecos cercanos';
        statusEl.style.color = '#34d399';
      }
    }
  }

  // ==================== BUSCADOR DE CIUDADES (OPEN-METEO GEOCODING) ====================
  async function searchCityByName(query) {
    const resultsBox = document.getElementById('citySearchResults');
    if (!resultsBox || !query || query.trim().length < 2) return;

    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        query.trim()
      )}&count=6&language=es&format=json`;
      const res = await fetch(url);
      const data = await res.json();

      if (!data.results || data.results.length === 0) {
        resultsBox.innerHTML = `<div class="search-result-item"><span>Sin resultados</span></div>`;
        resultsBox.classList.remove('hidden');
        return;
      }

      resultsBox.innerHTML = data.results
        .map(
          (item) => `
          <button type="button" class="search-result-item" data-name="${item.name}" data-lat="${item.latitude}" data-lon="${item.longitude}">
            <span>${item.name}${item.admin1 ? `, ${item.admin1}` : ''}</span>
            <small class="mono">${item.country_code || ''} · ${item.latitude.toFixed(2)}, ${item.longitude.toFixed(2)}</small>
          </button>
        `
        )
        .join('');
      resultsBox.classList.remove('hidden');

      resultsBox.querySelectorAll('.search-result-item[data-lat]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const name = btn.getAttribute('data-name');
          const lat = parseFloat(btn.getAttribute('data-lat'));
          const lon = parseFloat(btn.getAttribute('data-lon'));

          const inputLat = document.getElementById('inputLatitude');
          const inputLon = document.getElementById('inputLongitude');
          if (inputLat) inputLat.value = lat.toFixed(4);
          if (inputLon) inputLon.value = lon.toFixed(4);
          inputLat?.setAttribute('data-pending-name', name);
          resultsBox.classList.add('hidden');
        });
      });
    } catch (err) {
      console.warn('Error buscando ciudad:', err);
    }
  }

  // ==================== SINCRONIZACIÓN GENERAL ====================
  async function refreshAllData() {
    if (state.isFetching) return;
    state.isFetching = true;

    const spinner = document.getElementById('refreshSpinnerIcon');
    const updatedText = document.getElementById('lastUpdatedText');
    spinner?.classList.add('spinning');
    if (updatedText) updatedText.textContent = 'Actualizando...';

    hideStatusBanner();

    try {
      const forecastPromise = fetchForecastData().then(() => renderDashboard());
      const marinePromise = fetchMarineData()
        .then(() => renderDashboard())
        .catch((e) => console.warn('Marine:', e));
      const airPromise = fetchAirQualityData()
        .then(() => renderDashboard())
        .catch((e) => console.warn('AirQuality:', e));
      const radarPromise = fetchRainViewerData().catch((e) => console.warn('Radar:', e));

      await Promise.all([forecastPromise, marinePromise, airPromise, radarPromise]);
      renderDashboard();

      const nowStr = new Date().toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit'
      });
      if (updatedText) updatedText.textContent = `Actualizado ${nowStr}`;
      state.refreshCountdown = AUTO_REFRESH_SECONDS;
    } catch (err) {
      console.error('Error al sincronizar:', err);
      showStatusBanner(`Error de conexión (${err.message}). Reintentando automáticamente.`);
    } finally {
      state.isFetching = false;
      spinner?.classList.remove('spinning');
    }
  }

  function startAutoRefreshTimer() {
    if (state.countdownInterval) clearInterval(state.countdownInterval);
    state.countdownInterval = setInterval(() => {
      state.refreshCountdown--;
      if (state.refreshCountdown <= 0) {
        state.refreshCountdown = AUTO_REFRESH_SECONDS;
        refreshAllData();
      }
      const mins = String(Math.floor(state.refreshCountdown / 60)).padStart(2, '0');
      const secs = String(state.refreshCountdown % 60).padStart(2, '0');
      const el = document.getElementById('refreshCountdownText');
      if (el) el.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  function showStatusBanner(msg) {
    const banner = document.getElementById('statusBanner');
    const text = document.getElementById('statusBannerText');
    if (banner && text) {
      text.textContent = msg;
      banner.classList.remove('hidden');
    }
  }

  function hideStatusBanner() {
    document.getElementById('statusBanner')?.classList.add('hidden');
  }

  // ==================== EVENTOS ====================
  function bindUIEvents() {
    document.getElementById('btnManualRefresh')?.addEventListener('click', refreshAllData);
    document.getElementById('btnDismissBanner')?.addEventListener('click', hideStatusBanner);
    document.getElementById('btnRadarPlayPause')?.addEventListener('click', toggleRadarPlayback);

    document.getElementById('btnRadarPrev')?.addEventListener('click', () => {
      stopRadarPlayback();
      const len = state.radar.frames.length;
      if (len > 0) showRadarFrame((state.radar.currentFrameIdx - 1 + len) % len);
    });

    document.getElementById('btnRadarNext')?.addEventListener('click', () => {
      stopRadarPlayback();
      const len = state.radar.frames.length;
      if (len > 0) showRadarFrame((state.radar.currentFrameIdx + 1) % len);
    });

    document.getElementById('radarTimelineSlider')?.addEventListener('input', (e) => {
      stopRadarPlayback();
      showRadarFrame(parseInt(e.target.value, 10));
    });

    document.getElementById('radarOpacitySlider')?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10) / 100;
      state.radar.opacity = val;
      if (state.radar.activeLayerPath && state.radar.tileLayers[state.radar.activeLayerPath]) {
        state.radar.tileLayers[state.radar.activeLayerPath].setOpacity(val);
      }
    });

    document.getElementById('mapBaseSelect')?.addEventListener('change', (e) => {
      setMapBaseLayer(e.target.value);
    });

    document.getElementById('btnRecenterMap')?.addEventListener('click', () => {
      if (state.radar.map) {
        state.radar.map.setView([state.coords.lat, state.coords.lon], 10, { animate: true });
      }
    });

    const modal = document.getElementById('locationModalBackdrop');
    const inputLat = document.getElementById('inputLatitude');
    const inputLon = document.getElementById('inputLongitude');
    const inputSearch = document.getElementById('inputCitySearch');

    const openModal = () => {
      if (inputLat) {
        inputLat.value = state.coords.lat;
        inputLat.setAttribute('data-pending-name', state.coords.name || '');
      }
      if (inputLon) inputLon.value = state.coords.lon;
      modal?.classList.remove('hidden');
    };

    const closeModal = () => {
      modal?.classList.add('hidden');
      document.getElementById('citySearchResults')?.classList.add('hidden');
    };

    document.getElementById('btnOpenLocationModal')?.addEventListener('click', openModal);
    document.getElementById('btnCloseLocationModal')?.addEventListener('click', closeModal);
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    document.getElementById('btnSearchCity')?.addEventListener('click', () => {
      if (inputSearch) searchCityByName(inputSearch.value);
    });

    inputSearch?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchCityByName(inputSearch.value);
      }
    });

    document.querySelectorAll('.btn-preset[data-lat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (inputLat) {
          inputLat.value = btn.getAttribute('data-lat');
          inputLat.setAttribute('data-pending-name', btn.getAttribute('data-name') || '');
        }
        if (inputLon) inputLon.value = btn.getAttribute('data-lon');
      });
    });

    document.getElementById('btnUseGeolocation')?.addEventListener('click', () => {
      if (!navigator.geolocation) {
        showStatusBanner('Tu navegador no soporta geolocalización.');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (inputLat) {
            inputLat.value = pos.coords.latitude.toFixed(4);
            inputLat.setAttribute('data-pending-name', 'Ubicación GPS');
          }
          if (inputLon) inputLon.value = pos.coords.longitude.toFixed(4);
        },
        (err) => showStatusBanner(`Error GPS: ${err.message}`),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });

    document.getElementById('btnResetDefaultCoords')?.addEventListener('click', () => {
      if (inputLat) {
        inputLat.value = DEFAULT_LOCATION.lat;
        inputLat.setAttribute('data-pending-name', DEFAULT_LOCATION.name);
      }
      if (inputLon) inputLon.value = DEFAULT_LOCATION.lon;
    });

    document.getElementById('locationForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const newLat = parseFloat(inputLat.value);
      const newLon = parseFloat(inputLon.value);
      const pendingName = inputLat?.getAttribute('data-pending-name') || null;
      if (Number.isFinite(newLat) && Number.isFinite(newLon)) {
        saveCoordinates(newLat, newLon, pendingName);
        if (state.radar.map) {
          state.radar.map.setView([state.coords.lat, state.coords.lon], 10);
          updateMapHomeGeometry();
        }
        closeModal();
        refreshAllData();
      }
    });
  }

  // ==================== INICIALIZACIÓN ====================
  document.addEventListener('DOMContentLoaded', () => {
    loadCoordinates();
    updateHeaderCoordsDisplay();
    initLeafletMap();
    bindUIEvents();
    refreshAllData();
    startAutoRefreshTimer();
  });
})();
