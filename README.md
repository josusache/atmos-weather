# Atmos — Pronóstico Meteorológico, Marino y Astronómico

Aplicación web (SPA) minimalista en tema oscuro de alta precisión para el seguimiento meteorológico hiperlocal, estado del mar y efemérides astronómicas en tiempo real.

## Características principales

- **Estado Actual y Resumen Inteligente**: Temperatura actual, sensación térmica, iconos vectoriales dinámicos según código WMO (día/noche) y resumen interpretativo automático.
- **Ciclo Solar Interactivo**: Arco solar en SVG con la posición del sol en tiempo real, horas exactas de amanecer, mediodía solar y puesta de sol, duración total del día y cuenta atrás de luz solar.
- **Fase Lunar Astronómica**: Renderizado geométrico en SVG del disco lunar con terminador esférico exacto, porcentaje de iluminación, edad sinódica en días y fechas de próxima Luna Llena y Luna Nueva.
- **Temperatura del Agua y Estado del Mar**: Temperatura superficial del mar (`°C`), altura de ola (`m`), periodo (`s`) y dirección del oleaje mediante **Open-Meteo Marine API**.
- **8 Paneles de Telemetría**:
  1. Temperatura del agua y oleaje
  2. Viento a 10 m, rachas, dirección y escala Beaufort
  3. Humedad relativa y punto de rocío
  4. Índice UV y radiación solar directa (`W/m²`)
  5. Presión atmosférica (`hPa`) y tendencia barométrica a 6h
  6. Precipitación acumulada y proximidad de lluvia por radar Doppler
  7. Visibilidad horizontal y cobertura nubosa
  8. Calidad del Aire Europea (**EAQI**, **PM2.5** y **PM10**)
- **Radar Doppler en Vivo**: Mapa interactivo con **Leaflet**, capas **CARTO** y animación de radar de lluvia **RainViewer** (últimas 2 horas) con anillos de distancia (5, 15 y 30 km).
- **Pronóstico de 7 Días y Evolución 24 Horas**: Barras proporcionales de amplitud térmica semanal y matriz horaria de 24h con curva SVG de temperatura.
- **Buscador Global de Ciudades y GPS**: Geocodificación integrada para buscar cualquier ciudad o playa del mundo, o geolocalización por GPS.

## Uso local

Al ser una SPA estática en Vanilla JS (`index.html`, `styles.css`, `app.js`), puedes servirla con cualquier servidor HTTP estático:

```bash
npx serve .
# o con Python:
python -m http.server 8080
```

## Despliegue en GitHub Pages

1. Sube este repositorio a GitHub.
2. Ve a **Settings → Pages**.
3. En **Build and deployment**, selecciona **Deploy from a branch** → rama `main` y carpeta `/ (root)`.
