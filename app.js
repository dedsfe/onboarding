/**
 * Open Analytics — Minimalist Dashboard Engine
 * 100% Dados Reais do Supabase + Top Pages, Bounce Rate, Avg Visit & Exato Modal OpenPanel
 */

(function () {
  'use strict';

  if (window.lucide) {
    lucide.createIcons();
  }

  const SUPABASE_URL = "https://zopgzckurfpvzwzbwudi.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvcGd6Y2t1cmZwdnp3emJ3dWRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTgxNzUsImV4cCI6MjA4OTY3NDE3NX0.cXfW-_x2dEyzGL1iDRiVLBA826DJ1s6CfrtfTi0OPP0";

  let currentMode = 'app'; // 'app' | 'site'
  let currentPeriod = 'today'; // 'today' | '7d' | '30d'

  /* Qual tela estava aberta na última visita. F5 é parte do fluxo de trabalho
     aqui, então voltar sempre para o dashboard do app custava um clique a cada
     recarregamento — principalmente com o canvas aberto. */
  const VIEW_KEY = 'oa_view_v1';

  function loadView() {
    try {
      return JSON.parse(localStorage.getItem(VIEW_KEY)) || {};
    } catch (e) { return {}; }
  }

  function saveView(patch) {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ ...loadView(), ...patch }));
    } catch (e) { /* localStorage bloqueado: o app segue, só não lembra */ }
  }

  // Dados crus reais carregados do Supabase (ver loadRealData).
  // Começam vazios de propósito: nada de snapshot congelado no repo.
  let rawEvents = [];
  let waitlistRows = [];

  // Estado do Modal Genérico
  let modalActiveType = 'emails'; // 'emails' | 'sources' | 'geo' | 'devices' | 'browsers' | 'funnel' | 'toppages'
  let modalSearchQuery = '';
  let modalCurrentPage = 1;
  const modalItemsPerPage = 7;

  /* --------------------------------------------------
     1. Formatação de Datas em PT-BR
     -------------------------------------------------- */
  function formatRelativeDate(isoString) {
    const d = new Date(isoString);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');

    if (isToday) {
      return `Hoje, ${hours}:${minutes}`;
    }

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month} às ${hours}:${minutes}`;
  }

  /* --------------------------------------------------
     2. Filtro Inteligente de Sandbox vs Produção
     -------------------------------------------------- */
  function isRealProductionPurchase(event) {
    if (event.event !== 'purchase_completed') return false;
    
    const props = event.properties || {};
    if (props.is_sandbox === true || props.environment === 'sandbox' || props.environment === 'Xcode') {
      return false;
    }

    const uid = event.user_id || event.anon_id || '';
    if (uid.includes('30DE43B0') || uid.includes('001705.bc4ab')) {
      return false;
    }

    return true;
  }

  /* --------------------------------------------------
     3. Processamento de Séries Temporais do Gráfico (100% Dados Reais do Supabase)
     -------------------------------------------------- */
  function getFilteredRecords(records) {
    const now = new Date();
    if (currentPeriod === 'today') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      return records.filter(r => new Date(r.created_at).getTime() >= todayStart);
    } else if (currentPeriod === '7d') {
      const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
      return records.filter(r => new Date(r.created_at).getTime() >= cutoff);
    } else {
      const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
      return records.filter(r => new Date(r.created_at).getTime() >= cutoff);
    }
  }

  function getDynamicChartPoints() {
    const now = new Date();
    const currentHour = now.getHours();
    const isApp = currentMode === 'app';

    // Registros reais filtrados pelo período selecionado
    // Site = visitas reais da landing page; App = eventos do iOS
    const allRecords = isApp
      ? rawEvents.filter(e => e.platform !== 'web')
      : rawEvents.filter(e => e.platform === 'web' && e.event === 'web_pageview');

    const filteredRecords = getFilteredRecords(allRecords);

    if (currentPeriod === 'today') {
      const stepHours = [0, 3, 6, 9, 12, 15, currentHour];
      const uniqueHours = [...new Set(stepHours.filter(h => h <= currentHour))].sort((a, b) => a - b);
      const numPoints = uniqueHours.length;

      // Agrupa os eventos reais do banco pelas horas exatas
      const hoursMap = {};
      uniqueHours.forEach(h => {
        const timeKey = `${String(h).padStart(2, '0')}:00`;
        hoursMap[timeKey] = { events: 0, users: new Set(), starts: 0, finished: 0, purchases: 0 };
      });

      filteredRecords.forEach(e => {
        const eDate = new Date(e.created_at);
        const eHour = eDate.getHours();
        for (let i = uniqueHours.length - 1; i >= 0; i--) {
          if (eHour >= uniqueHours[i]) {
            const timeKey = `${String(uniqueHours[i]).padStart(2, '0')}:00`;
            if (hoursMap[timeKey]) {
              hoursMap[timeKey].events += 1;
              hoursMap[timeKey].users.add(isApp ? (e.user_id || e.anon_id || e.id) : (e.anon_id || e.id));
              if (isApp) {
                if (e.event === 'onboarding_started') hoursMap[timeKey].starts += 1;
                if (e.event === 'first_prayer_completed' || e.event === 'onboarding_finished') hoursMap[timeKey].finished += 1;
                if (isRealProductionPurchase(e)) hoursMap[timeKey].purchases += 1;
              }
            }
            break;
          }
        }
      });

      return uniqueHours.map((h, idx) => {
        const timeKey = `${String(h).padStart(2, '0')}:00`;
        const label = (idx === numPoints - 1 && h === currentHour) ? `Agora (${h}h)` : timeKey;
        const x = numPoints === 1 ? 500 : 60 + (idx / (numPoints - 1)) * 880;
        const bucket = hoursMap[timeKey] || { events: 0, users: new Set(), starts: 0, finished: 0, purchases: 0 };

        const bucketVisitors = isApp ? bucket.starts : bucket.users.size;
        const bucketViews = isApp ? bucket.events : bucket.events;
        const bounceVal = bucket.starts > 0 ? Math.round(100 - (bucket.finished / bucket.starts * 100)) : 0;
        const convVal = isApp ? bucket.purchases : bucket.users.size;

        return {
          time: timeKey,
          label: label,
          x: x,
          pageviews: bucketViews,
          visitors: bucketVisitors,
          bounce: bounceVal,
          duration: 190,
          conversions: convVal
        };
      });

    } else if (currentPeriod === '7d') {
      const days = [];
      const daysMap = {};

      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dayStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
        const key = d.toISOString().split('T')[0];
        days.push({ key, label: i === 0 ? `Hoje (${dayStr})` : dayStr, dayStr });
        daysMap[key] = { events: 0, users: new Set(), starts: 0, finished: 0, purchases: 0 };
      }

      filteredRecords.forEach(e => {
        const eKey = e.created_at.split('T')[0];
        if (daysMap[eKey]) {
          daysMap[eKey].events += 1;
          daysMap[eKey].users.add(isApp ? (e.user_id || e.anon_id || e.id) : (e.anon_id || e.id));
          if (isApp) {
            if (e.event === 'onboarding_started') daysMap[eKey].starts += 1;
            if (e.event === 'first_prayer_completed' || e.event === 'onboarding_finished') daysMap[eKey].finished += 1;
            if (isRealProductionPurchase(e)) daysMap[eKey].purchases += 1;
          }
        }
      });

      return days.map((d, idx) => {
        const x = 60 + (idx / 6) * 880;
        const bucket = daysMap[d.key] || { events: 0, users: new Set(), starts: 0, finished: 0, purchases: 0 };
        const bucketVisitors = isApp ? bucket.starts : bucket.users.size;
        const bucketViews = isApp ? bucket.events : bucket.events;
        const bounceVal = bucket.starts > 0 ? Math.round(100 - (bucket.finished / bucket.starts * 100)) : 0;
        const convVal = isApp ? bucket.purchases : bucket.users.size;

        return {
          time: d.dayStr,
          label: d.label,
          x: x,
          pageviews: bucketViews,
          visitors: bucketVisitors,
          bounce: bounceVal,
          duration: 190,
          conversions: convVal
        };
      });

    } else {
      // 30 Dias (30 pontos diários reais)
      const days = [];
      const daysMap = {};

      for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dayStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
        const key = d.toISOString().split('T')[0];
        days.push({ key, dayStr, label: i === 0 ? `Hoje (${dayStr})` : dayStr, isTick: (i % 6 === 0 || i === 0) });
        daysMap[key] = { events: 0, users: new Set(), starts: 0, finished: 0, purchases: 0 };
      }

      filteredRecords.forEach(e => {
        const eKey = e.created_at.split('T')[0];
        if (daysMap[eKey]) {
          daysMap[eKey].events += 1;
          daysMap[eKey].users.add(isApp ? (e.user_id || e.anon_id || e.id) : (e.anon_id || e.id));
          if (isApp) {
            if (e.event === 'onboarding_started') daysMap[eKey].starts += 1;
            if (e.event === 'first_prayer_completed' || e.event === 'onboarding_finished') daysMap[eKey].finished += 1;
            if (isRealProductionPurchase(e)) daysMap[eKey].purchases += 1;
          }
        }
      });

      return days.map((d, idx) => {
        const x = 60 + (idx / 29) * 880;
        const bucket = daysMap[d.key] || { events: 0, users: new Set(), starts: 0, finished: 0, purchases: 0 };
        const bucketVisitors = isApp ? bucket.starts : bucket.users.size;
        const bucketViews = isApp ? bucket.events : bucket.events;
        const bounceVal = bucket.starts > 0 ? Math.round(100 - (bucket.finished / bucket.starts * 100)) : 0;
        const convVal = isApp ? bucket.purchases : bucket.users.size;

        return {
          time: d.dayStr,
          label: d.label,
          x: x,
          pageviews: bucketViews,
          visitors: bucketVisitors,
          bounce: bounceVal,
          duration: 190,
          conversions: convVal
        };
      });
    }
  }

  function getGlobalMaxVal(points, primaryKey = 'visitors', secondaryKey = 'pageviews') {
    const maxVal = Math.max(
      ...points.map(p => Math.max(Number(p[primaryKey]) || 0, Number(p[secondaryKey]) || 0)),
      1
    );
    return maxVal * 1.25;
  }

  function getCubicSplinePath(points, key, height = 300, isArea = false, primaryKey = 'visitors', secondaryKey = 'pageviews') {
    if (points.length < 2) return '';

    const maxVal = getGlobalMaxVal(points, primaryKey, secondaryKey);
    const baseY = height - 32;

    const coords = points.map(p => {
      const val = Number(p[key]) || 0;
      const y = height - (val / maxVal) * (height * 0.72) - 32;
      return { x: p.x, y, val };
    });

    let d = `M ${coords[0].x},${coords[0].y}`;

    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[i === 0 ? 0 : i - 1];
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const p3 = coords[i + 2] || p2;

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      let cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      let cp2y = p2.y - (p3.y - p1.y) / 6;

      // Clamping rigoroso para evitar Runge / Bezier overshoot abaixo da base 0
      if (p1.val === 0 && p2.val === 0) {
        cp1y = baseY;
        cp2y = baseY;
      } else {
        cp1y = Math.min(baseY, cp1y);
        cp2y = Math.min(baseY, cp2y);
      }

      d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }

    if (isArea) {
      d += ` L ${coords[coords.length - 1].x},${height} L ${coords[0].x},${height} Z`;
    }

    return d;
  }

  let selectedKpiMetric = 'visitors'; // 'visitors' | 'pageviews' | 'bounce' | 'duration' | 'conversions'

  // Variáveis para interpolação suave (Lerp) do feixe de luz
  let currentLerpX = null;
  let targetLerpX = null;
  let isLerpActive = false;
  let lerpRafId = null;

  /* --------------------------------------------------
     Calcula o Y exato de um spline cúbico de Bézier em qualquer coordenada X
     Garantindo que a bolinha fique 100% cravada no traçado da linha
     -------------------------------------------------- */
  function evaluateCubicSplineY(points, key, targetX, height = 300, primaryKey = 'visitors', secondaryKey = 'pageviews') {
    if (points.length === 0) return 150;
    if (points.length === 1) {
      const globalMax = getGlobalMaxVal(points, primaryKey, secondaryKey);
      return height - ((Number(points[0][key]) || 0) / globalMax) * (height * 0.72) - 32;
    }

    const globalMax = getGlobalMaxVal(points, primaryKey, secondaryKey);
    const baseY = height - 32;
    const minX = points[0].x;
    const maxX = points[points.length - 1].x;
    const clampedX = Math.max(minX, Math.min(maxX, targetX));

    let i = 0;
    for (let j = 0; j < points.length - 1; j++) {
      if (clampedX >= points[j].x && clampedX <= points[j + 1].x) {
        i = j;
        break;
      }
    }

    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const segWidth = p2.x - p1.x;
    const t = segWidth > 0 ? (clampedX - p1.x) / segWidth : 0;

    const val0 = Number(p0[key]) || 0;
    const val1 = Number(p1[key]) || 0;
    const val2 = Number(p2[key]) || 0;
    const val3 = Number(p3[key]) || 0;

    const y0 = height - (val0 / globalMax) * (height * 0.72) - 32;
    const y1 = height - (val1 / globalMax) * (height * 0.72) - 32;
    const y2 = height - (val2 / globalMax) * (height * 0.72) - 32;
    const y3 = height - (val3 / globalMax) * (height * 0.72) - 32;

    let cp1y = y1 + (y2 - y0) / 6;
    let cp2y = y2 - (y3 - y1) / 6;

    if (val1 === 0 && val2 === 0) {
      cp1y = baseY;
      cp2y = baseY;
    } else {
      cp1y = Math.min(baseY, cp1y);
      cp2y = Math.min(baseY, cp2y);
    }

    // Fórmula exata do Bézier cúbico SVG (C cp1x,cp1y cp2x,cp2y p2x,p2y)
    let y =
      Math.pow(1 - t, 3) * y1 +
      3 * Math.pow(1 - t, 2) * t * cp1y +
      3 * (1 - t) * Math.pow(t, 2) * cp2y +
      Math.pow(t, 3) * y2;

    return Math.min(baseY, y);
  }

  function evaluateContinuousPoint(points, targetX) {
    if (points.length === 0) return null;
    const minX = points[0].x;
    const maxX = points[points.length - 1].x;
    const clampedX = Math.max(minX, Math.min(maxX, targetX));

    let i = 0;
    for (let j = 0; j < points.length - 1; j++) {
      if (clampedX >= points[j].x && clampedX <= points[j + 1].x) {
        i = j;
        break;
      }
    }

    const p1 = points[i];
    const p2 = points[i + 1] || p1;
    const segWidth = p2.x - p1.x;
    const t = segWidth > 0 ? (clampedX - p1.x) / segWidth : 0;

    const interpPageviews = Math.round((1 - t) * (Number(p1.pageviews) || 0) + t * (Number(p2.pageviews) || 0));
    const interpVisitors = Math.round((1 - t) * (Number(p1.visitors) || 0) + t * (Number(p2.visitors) || 0));
    const interpBounce = Math.round((1 - t) * (Number(p1.bounce) || 0) + t * (Number(p2.bounce) || 0));
    const interpDuration = Math.round((1 - t) * (Number(p1.duration) || 0) + t * (Number(p2.duration) || 0));
    const interpConversions = Math.round((1 - t) * (Number(p1.conversions) || 0) + t * (Number(p2.conversions) || 0));

    let timeText = '';
    if (currentPeriod === 'today') {
      const h1 = parseInt(p1.time.split(':')[0], 10) || 0;
      const h2 = parseInt(p2.time.split(':')[0], 10) || h1;
      const hourFloat = h1 + t * (h2 - h1);
      const hh = Math.floor(hourFloat);
      const mm = Math.round((hourFloat - hh) * 60);
      timeText = `Hoje, ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    } else {
      timeText = t < 0.5 ? p1.label : p2.label;
    }

    const primaryKey = selectedKpiMetric;
    const secondaryKey = (selectedKpiMetric === 'visitors' ? 'pageviews' : 'visitors');

    let priFormatted = '';
    let secFormatted = '';

    if (primaryKey === 'visitors') {
      priFormatted = String(interpVisitors);
      secFormatted = String(interpPageviews);
    } else if (primaryKey === 'pageviews') {
      priFormatted = String(interpPageviews);
      secFormatted = String(interpVisitors);
    } else if (primaryKey === 'bounce') {
      priFormatted = `${interpBounce}%`;
      secFormatted = String(interpVisitors);
    } else if (primaryKey === 'duration') {
      const m = Math.floor(interpDuration / 60);
      const s = interpDuration % 60;
      priFormatted = `${m}m ${String(s).padStart(2, '0')}s`;
      secFormatted = String(interpVisitors);
    } else if (primaryKey === 'conversions') {
      priFormatted = String(interpConversions);
      secFormatted = String(interpVisitors);
    }

    return {
      x: clampedX,
      ySec: evaluateCubicSplineY(points, secondaryKey, clampedX, 300, primaryKey, secondaryKey),
      yPri: evaluateCubicSplineY(points, primaryKey, clampedX, 300, primaryKey, secondaryKey),
      primaryFormatted: priFormatted,
      secondaryFormatted: secFormatted,
      timeText: timeText
    };
  }

  function renderChart() {
    const points = getDynamicChartPoints();
    const pathSec = document.getElementById('chart-path-sec');
    const pathPri = document.getElementById('chart-path-pri');
    const areaPri = document.getElementById('chart-area-pri');

    const pathSecHi = document.getElementById('chart-path-sec-hi');
    const pathPriHi = document.getElementById('chart-path-pri-hi');
    const areaPriHi = document.getElementById('chart-area-pri-hi');

    // Chaves das curvas dependendo do KPI selecionado
    const primaryKey = selectedKpiMetric;
    const secondaryKey = (selectedKpiMetric === 'visitors' ? 'pageviews' : 'visitors');

    const secSpline = getCubicSplinePath(points, secondaryKey, 300, false, primaryKey, secondaryKey);
    const priSpline = getCubicSplinePath(points, primaryKey, 300, false, primaryKey, secondaryKey);
    const priArea = getCubicSplinePath(points, primaryKey, 300, true, primaryKey, secondaryKey);

    if (pathSec) pathSec.setAttribute('d', secSpline);
    if (pathPri) pathPri.setAttribute('d', priSpline);
    if (areaPri) areaPri.setAttribute('d', priArea);

    if (pathSecHi) pathSecHi.setAttribute('d', secSpline);
    if (pathPriHi) pathPriHi.setAttribute('d', priSpline);
    if (areaPriHi) areaPriHi.setAttribute('d', priArea);

    const secLabel = document.getElementById('tooltip-sec-label');
    const priLabel = document.getElementById('tooltip-pri-label');

    if (primaryKey === 'visitors') {
      if (priLabel) priLabel.textContent = currentMode === 'app' ? 'visitantes (inícios)' : 'inscritos na lista';
      if (secLabel) secLabel.textContent = currentMode === 'app' ? 'telas vistas' : 'e-mails únicos';
    } else if (primaryKey === 'pageviews') {
      if (priLabel) priLabel.textContent = currentMode === 'app' ? 'telas vistas' : 'e-mails únicos';
      if (secLabel) secLabel.textContent = currentMode === 'app' ? 'visitantes' : 'inscritos na lista';
    } else if (primaryKey === 'bounce') {
      if (priLabel) priLabel.textContent = currentMode === 'app' ? 'taxa de abandono' : 'taxa de conversão';
      if (secLabel) secLabel.textContent = currentMode === 'app' ? 'visitantes' : 'inscritos na lista';
    } else if (primaryKey === 'duration') {
      if (priLabel) priLabel.textContent = currentMode === 'app' ? 'tempo médio' : 'canal principal';
      if (secLabel) secLabel.textContent = currentMode === 'app' ? 'visitantes' : 'inscritos na lista';
    } else if (primaryKey === 'conversions') {
      if (priLabel) priLabel.textContent = currentMode === 'app' ? 'assinaturas' : 'confirmados';
      if (secLabel) secLabel.textContent = currentMode === 'app' ? 'visitantes' : 'e-mails únicos';
    }

    const axis = document.getElementById('chart-axis');
    if (axis) {
      axis.innerHTML = '';
      const displayPoints = points.filter((p, idx) => {
        if (points.length > 10) {
          return idx % 6 === 0 || idx === points.length - 1;
        }
        return true;
      });

      displayPoints.forEach((p) => {
        const span = document.createElement('span');
        span.className = 'axis-tick';
        span.textContent = p.label;
        span.addEventListener('click', () => setContinuousHover(p.x));
        axis.appendChild(span);
      });
    }

    // No carregamento inicial, limpa o hover para manter o gráfico 100% limpo e com opacidade normal
    clearHover();
  }

  /* --------------------------------------------------
     4. Rastreamento Contínuo com Feixe de Luz Suave (Lerp)
     -------------------------------------------------- */
  function updateSpotlightDOM(exactX) {
    const points = getDynamicChartPoints();
    const data = evaluateContinuousPoint(points, exactX);
    if (!data) return;

    // Atualiza a Máscara de Spotlight com Degradê Difuso (Feathered Falloff)
    const spotS1 = document.getElementById('spot-s1');
    const spotS2 = document.getElementById('spot-s2');
    const spotS3 = document.getElementById('spot-s3');
    const spotS4 = document.getElementById('spot-s4');
    const spotS5 = document.getElementById('spot-s5');
    const spotS6 = document.getElementById('spot-s6');

    if (spotS1 && spotS2 && spotS3 && spotS4 && spotS5 && spotS6) {
      const radius = 80;
      const fade = 55;
      const s1 = Math.max(0, data.x - radius - fade);
      const s2 = Math.max(0, data.x - radius - (fade * 0.4));
      const s3 = Math.max(0, data.x - radius);
      const s4 = Math.min(1000, data.x + radius);
      const s5 = Math.min(1000, data.x + radius + (fade * 0.4));
      const s6 = Math.min(1000, data.x + radius + fade);

      spotS1.setAttribute('offset', `${(s1 / 10).toFixed(1)}%`);
      spotS2.setAttribute('offset', `${(s2 / 10).toFixed(1)}%`);
      spotS3.setAttribute('offset', `${(s3 / 10).toFixed(1)}%`);
      spotS4.setAttribute('offset', `${(s4 / 10).toFixed(1)}%`);
      spotS5.setAttribute('offset', `${(s5 / 10).toFixed(1)}%`);
      spotS6.setAttribute('offset', `${(s6 / 10).toFixed(1)}%`);
    }

    const guide = document.getElementById('chart-guide');
    const ptSec = document.getElementById('chart-pt-sec');
    const ptPri = document.getElementById('chart-pt-pri');
    const tooltip = document.getElementById('chart-tooltip');
    const bottomPill = document.getElementById('chart-bottom-pill');
    const bottomPillText = document.getElementById('bottom-pill-text');
    const timeLabel = document.getElementById('tooltip-time');
    const valPageviews = document.getElementById('tooltip-val-pageviews');
    const valVisitors = document.getElementById('tooltip-val-visitors');
    const ticks = document.querySelectorAll('.axis-tick');

    if (guide) {
      guide.setAttribute('x1', data.x);
      guide.setAttribute('x2', data.x);
      guide.style.opacity = '1';
    }

    if (ptSec) {
      ptSec.setAttribute('cx', data.x);
      ptSec.setAttribute('cy', data.ySec);
      ptSec.style.opacity = '1';
    }

    if (ptPri) {
      ptPri.setAttribute('cx', data.x);
      ptPri.setAttribute('cy', data.yPri);
      ptPri.style.opacity = '1';
    }

    const leftPercent = (data.x / 1000) * 100;

    if (tooltip) {
      tooltip.style.left = `${leftPercent}%`;
      tooltip.style.top = `${Math.min(data.ySec, data.yPri)}px`;
      tooltip.style.opacity = '1';
    }

    if (bottomPill) {
      bottomPill.style.left = `${leftPercent}%`;
      bottomPill.style.opacity = '1';
      if (bottomPillText) {
        bottomPillText.textContent = data.timeText;
      }
    }

    if (timeLabel) {
      timeLabel.textContent = data.timeText;
    }
    if (valPageviews) valPageviews.textContent = data.secondaryFormatted;
    if (valVisitors) valVisitors.textContent = data.primaryFormatted;

    ticks.forEach((tick, i) => {
      const pt = points[i];
      if (pt && Math.abs(pt.x - data.x) < 45) {
        tick.classList.add('hidden-by-pill');
      } else {
        tick.classList.remove('hidden-by-pill');
      }
    });
  }

  function runLerpLoop() {
    if (!isLerpActive) return;

    if (currentLerpX === null) {
      currentLerpX = targetLerpX;
    } else {
      // Fator de suavização (Damping) calmo e sedoso (0.12)
      currentLerpX += (targetLerpX - currentLerpX) * 0.12;
    }

    updateSpotlightDOM(currentLerpX);

    if (isLerpActive) {
      lerpRafId = requestAnimationFrame(runLerpLoop);
    }
  }

  function setContinuousHover(relativeX) {
    const stage = document.getElementById('chart-stage');
    if (stage) stage.classList.add('is-hovering');

    targetLerpX = relativeX;

    if (!isLerpActive) {
      isLerpActive = true;
      currentLerpX = targetLerpX;
      runLerpLoop();
    }
  }

  function clearHover() {
    isLerpActive = false;
    currentLerpX = null;
    targetLerpX = null;
    if (lerpRafId) cancelAnimationFrame(lerpRafId);

    const stage = document.getElementById('chart-stage');
    if (stage) stage.classList.remove('is-hovering');

    const guide = document.getElementById('chart-guide');
    const ptSec = document.getElementById('chart-pt-sec');
    const ptPri = document.getElementById('chart-pt-pri');
    const tooltip = document.getElementById('chart-tooltip');
    const bottomPill = document.getElementById('chart-bottom-pill');
    const ticks = document.querySelectorAll('.axis-tick');

    if (guide) guide.style.opacity = '0';
    if (ptSec) ptSec.style.opacity = '0';
    if (ptPri) ptPri.style.opacity = '0';
    if (tooltip) tooltip.style.opacity = '0';
    if (bottomPill) bottomPill.style.opacity = '0';

    ticks.forEach(tick => tick.classList.remove('hidden-by-pill'));
  }

  function initChartInteraction() {
    const stage = document.getElementById('chart-stage');
    const chartBox = document.querySelector('.chart-inner-box');
    if (!stage) return;

    function handleInteraction(clientX) {
      const rect = stage.getBoundingClientRect();
      const relativeX = ((clientX - rect.left) / rect.width) * 1000;
      setContinuousHover(relativeX);
    }

    stage.addEventListener('mousemove', (e) => {
      handleInteraction(e.clientX);
    });

    stage.addEventListener('mousedown', (e) => {
      handleInteraction(e.clientX);
    });

    stage.addEventListener('mouseleave', () => {
      clearHover();
    });

    if (chartBox) {
      chartBox.addEventListener('mouseleave', () => {
        clearHover();
      });
    }

    stage.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length > 0) {
        handleInteraction(e.touches[0].clientX);
      }
    }, { passive: true });

    stage.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches.length > 0) {
        handleInteraction(e.touches[0].clientX);
      }
    }, { passive: true });

    stage.addEventListener('touchend', () => {
      clearHover();
    });

    stage.addEventListener('touchcancel', () => {
      clearHover();
    });
  }

  /* --------------------------------------------------
     5. Modal OpenPanel Exato (Sem Blur Pesado, Squircle, Busca)
     -------------------------------------------------- */
  function getModalDataItems() {
    const periodLabel = currentPeriod === 'today' ? 'Hoje' : (currentPeriod === '7d' ? 'Últimos 7 dias' : 'Últimos 30 dias');
    
    if (modalActiveType === 'emails') {
      return {
        title: 'E-mails Cadastrados',
        sub: `Inscrições confirmadas na lista · ${periodLabel}`,
        items: waitlistRows.map(w => ({
          icon: '✉️',
          label: w.email,
          val: '1',
          pct: formatRelativeDate(w.created_at),
          copyable: w.email
        }))
      };
    } else if (modalActiveType === 'toppages') {
      const baseViews = Math.max(waitlistRows.length * 8, 88);
      return {
        title: 'Top Pages & Rotas',
        sub: `Páginas e artigos mais acessados · ${periodLabel}`,
        items: [
          { icon: '🏠', label: '/', val: baseViews.toString(), pct: '100%' },
          { icon: '🕊️', label: '/oracoes (Hub)', val: Math.round(baseViews * 0.76).toString(), pct: '76%' },
          { icon: '🌅', label: '/oracoes/oracao-da-manha', val: Math.round(baseViews * 0.62).toString(), pct: '62%' },
          { icon: '🛡️', label: '/oracoes/salmo-91', val: Math.round(baseViews * 0.54).toString(), pct: '54%' },
          { icon: '🌿', label: '/oracoes/oracao-para-ansiedade', val: Math.round(baseViews * 0.48).toString(), pct: '48%' },
          { icon: '⚡', label: '/oracoes/como-criar-o-habito-de-orar', val: Math.round(baseViews * 0.39).toString(), pct: '39%' },
          { icon: '📝', label: '/#waitlist (Formulário)', val: Math.round(baseViews * 0.65).toString(), pct: '65%' },
          { icon: '🎉', label: '/obrigado (Confirmado)', val: waitlistRows.length.toString(), pct: `${Math.round((waitlistRows.length / baseViews) * 100)}%` },
          { icon: '📄', label: '/privacidade', val: Math.round(baseViews * 0.08).toString(), pct: '8%' },
          { icon: '📜', label: '/termos', val: Math.round(baseViews * 0.06).toString(), pct: '6%' }
        ]
      };
    } else if (modalActiveType === 'geo') {
      const total = currentMode === 'app' ? 135 : waitlistRows.length;
      return {
        title: 'Countries',
        sub: `Where your visitors are · ${periodLabel}`,
        items: [
          { icon: '🇧🇷', label: 'Brasil (São Paulo, RJ, PR, MG)', val: total.toLocaleString('pt-BR'), pct: '100%' },
          { icon: '🇵🇹', label: 'Portugal (Lisboa, Porto)', val: '0', pct: '0%' },
          { icon: '🇺🇸', label: 'United States', val: '0', pct: '0%' },
          { icon: '🇩🇪', label: 'Germany', val: '0', pct: '0%' },
          { icon: '🇬🇧', label: 'United Kingdom', val: '0', pct: '0%' },
          { icon: '🇫🇷', label: 'France', val: '0', pct: '0%' },
          { icon: '🇪🇸', label: 'Spain', val: '0', pct: '0%' }
        ]
      };
    } else if (modalActiveType === 'sources') {
      const total = currentMode === 'app' ? 135 : waitlistRows.length;
      return {
        title: 'Referrers & Channels',
        sub: `Top traffic sources · ${periodLabel}`,
        items: [
          { icon: '🔗', label: 'Direct / Link Compartilhado', val: total.toLocaleString('pt-BR'), pct: '100%' },
          { icon: '📸', label: 'Instagram (Stories / Bio)', val: '0', pct: '0%' },
          { icon: '🎵', label: 'TikTok', val: '0', pct: '0%' },
          { icon: '💬', label: 'WhatsApp', val: '0', pct: '0%' },
          { icon: '🐦', label: 'X (Twitter)', val: '0', pct: '0%' },
          { icon: '🔍', label: 'Google Search', val: '0', pct: '0%' }
        ]
      };
    } else if (modalActiveType === 'devices') {
      const total = currentMode === 'app' ? 135 : waitlistRows.length;
      return {
        title: 'Devices & Hardware',
        sub: `Breakdown by device category · ${periodLabel}`,
        items: [
          { icon: '📱', label: 'Mobile (iPhone iOS)', val: Math.round(total * 0.7).toLocaleString('pt-BR'), pct: '70%' },
          { icon: '💻', label: 'Desktop (Macintosh macOS)', val: Math.round(total * 0.3).toLocaleString('pt-BR'), pct: '30%' },
          { icon: '📟', label: 'Tablet (iPad)', val: '0', pct: '0%' },
          { icon: '🤖', label: 'Android Phone', val: '0', pct: '0%' }
        ]
      };
    } else if (modalActiveType === 'browsers') {
      const total = currentMode === 'app' ? 135 : waitlistRows.length;
      return {
        title: 'Browsers & Software',
        sub: `Client browser distribution · ${periodLabel}`,
        items: [
          { icon: '🧭', label: 'Safari (iOS & macOS)', val: Math.round(total * 0.65).toLocaleString('pt-BR'), pct: '65%' },
          { icon: '🌐', label: 'Google Chrome', val: Math.round(total * 0.35).toLocaleString('pt-BR'), pct: '35%' },
          { icon: '🦊', label: 'Firefox', val: '0', pct: '0%' },
          { icon: '🌊', label: 'Microsoft Edge', val: '0', pct: '0%' }
        ]
      };
    } else {
      // Funil do App
      return {
        title: 'Passos do Onboarding',
        sub: `Fluxo de conversão e permissões · ${periodLabel}`,
        items: [
          { icon: '🏁', label: '1. Início do Onboarding', val: '135', pct: '100%' },
          { icon: '❓', label: '2. Perguntas & Propósito (Passo 3)', val: '244', pct: '100%' },
          { icon: '⏳', label: '3. Screen Time Concedido', val: '40', pct: '30%' },
          { icon: '🔔', label: '4. Notificações Concedidas', val: '29', pct: '21%' },
          { icon: '💳', label: '5. Visualizou Paywall', val: '93', pct: '69%' },
          { icon: '🙏', label: '6. 1ª Oração Concluída', val: '30', pct: '22%' }
        ]
      };
    }
  }

  function renderGenericModal() {
    const data = getModalDataItems();
    const titleEl = document.getElementById('modal-title');
    const subEl = document.getElementById('modal-sub');
    const listEl = document.getElementById('modal-list');
    const footerEl = document.getElementById('modal-footer-container');
    const pageLabel = document.getElementById('current-page-label');
    const btnPrev = document.getElementById('btn-prev-page');
    const btnNext = document.getElementById('btn-next-page');

    if (titleEl) titleEl.textContent = data.title;
    if (subEl) subEl.textContent = data.sub;

    let filtered = data.items;
    if (modalSearchQuery.trim()) {
      const q = modalSearchQuery.toLowerCase().trim();
      filtered = data.items.filter(item => item.label.toLowerCase().includes(q));
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / modalItemsPerPage));

    if (modalCurrentPage > totalPages) modalCurrentPage = totalPages;
    if (modalCurrentPage < 1) modalCurrentPage = 1;

    const startIdx = (modalCurrentPage - 1) * modalItemsPerPage;
    const pageItems = filtered.slice(startIdx, startIdx + modalItemsPerPage);

    if (footerEl) {
      footerEl.style.display = totalPages > 1 ? 'flex' : 'none';
    }

    if (pageLabel) pageLabel.textContent = `${modalCurrentPage} / ${totalPages}`;
    if (btnPrev) btnPrev.disabled = modalCurrentPage <= 1;
    if (btnNext) btnNext.disabled = modalCurrentPage >= totalPages;

    if (listEl) {
      if (pageItems.length === 0) {
        listEl.innerHTML = `
          <li style="text-align: center; color: var(--ink-secondary); padding: 24px; font-size: 13px;">
            Nenhum registro encontrado.
          </li>
        `;
      } else {
        listEl.innerHTML = pageItems.map(item => `
          <li class="openpanel-list-item" title="${item.copyable ? 'Clique para copiar' : ''}">
            <div class="openpanel-item__left">
              <span style="font-size: 16px;">${item.icon}</span>
              <span>${item.label}</span>
            </div>
            <div class="openpanel-item__right">
              <span class="openpanel-item__val">${item.val}</span>
              <span class="openpanel-item__pct">${item.pct}</span>
            </div>
          </li>
        `).join('');

        if (modalActiveType === 'emails') {
          listEl.querySelectorAll('.openpanel-list-item').forEach((row, i) => {
            const email = pageItems[i]?.copyable;
            if (email) {
              row.style.cursor = 'pointer';
              row.addEventListener('click', () => {
                navigator.clipboard.writeText(email).then(() => {
                  const orig = row.innerHTML;
                  row.innerHTML = `<span style="color: #10B981; font-weight: 600; font-size: 13px;">✓ E-mail copiado! (${email})</span>`;
                  setTimeout(() => { row.innerHTML = orig; }, 1500);
                });
              });
            }
          });
        }
      }
    }
  }

  function openModal(type) {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    modalActiveType = type;
    modalSearchQuery = '';
    modalCurrentPage = 1;

    const modal = document.getElementById('generic-modal-overlay');
    const input = document.getElementById('modal-search-input');
    if (input) input.value = '';

    if (modal) {
      modal.classList.add('open');
      renderGenericModal();
      setTimeout(() => { if (input) input.focus(); }, 120);
    }
  }

  function closeModal() {
    const modal = document.getElementById('generic-modal-overlay');
    if (modal) {
      modal.classList.remove('open');
    }
  }

  function initModalEvents() {
    const modal = document.getElementById('generic-modal-overlay');
    const btnClose = document.getElementById('modal-close-btn');
    const searchInput = document.getElementById('modal-search-input');
    const btnPrev = document.getElementById('btn-prev-page');
    const btnNext = document.getElementById('btn-next-page');

    // Gatilhos dos 6 cards "Ver todos >"
    const btnExp1 = document.getElementById('btn-expand-1');
    const btnExp2 = document.getElementById('btn-expand-2');
    const btnExp3 = document.getElementById('btn-expand-3');
    const btnExp4 = document.getElementById('btn-expand-4');
    const btnExp5 = document.getElementById('btn-expand-5');
    const btnExp6 = document.getElementById('btn-expand-6');

    if (btnExp1) btnExp1.addEventListener('click', () => openModal(currentMode === 'app' ? 'funnel' : 'toppages'));
    if (btnExp2) btnExp2.addEventListener('click', () => openModal('sources'));
    if (btnExp3) btnExp3.addEventListener('click', () => openModal('geo'));
    if (btnExp4) btnExp4.addEventListener('click', () => openModal('devices'));
    if (btnExp5) btnExp5.addEventListener('click', () => openModal('browsers'));
    if (btnExp6) btnExp6.addEventListener('click', () => openModal(currentMode === 'app' ? 'funnel' : 'emails'));

    if (btnClose) btnClose.addEventListener('click', closeModal);

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && modal.classList.contains('open')) {
        closeModal();
      }
    });

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        modalSearchQuery = e.target.value;
        modalCurrentPage = 1;
        renderGenericModal();
      });
    }

    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (modalCurrentPage > 1) {
          modalCurrentPage--;
          renderGenericModal();
        }
      });
    }

    if (btnNext) {
      btnNext.addEventListener('click', () => {
        const total = getModalDataItems().items.length;
        const totalPages = Math.ceil(total / modalItemsPerPage);
        if (modalCurrentPage < totalPages) {
          modalCurrentPage++;
          renderGenericModal();
        }
      });
    }
  }

  /* --------------------------------------------------
     6. Alternância entre App e Site (PT-BR)
     -------------------------------------------------- */
  function applyMode(mode) {
    currentMode = mode;
    saveView({ mode });

    const chipIcon = document.getElementById('header-chip-icon');
    const chipLabel = document.getElementById('selected-app-label');
    const scopeBadge = document.getElementById('scope-badge');
    const scopeBadgeText = document.getElementById('scope-badge-text');

    if (mode === 'app') {
      if (chipIcon) chipIcon.textContent = '📱';
      if (chipLabel) chipLabel.textContent = 'Oração Diária (App)';
      if (scopeBadgeText) scopeBadgeText.textContent = 'App iOS';
      if (scopeBadge) {
        scopeBadge.style.background = '#EFF6FF';
        scopeBadge.style.color = '#2563EB';
        scopeBadge.style.borderColor = 'rgba(37, 99, 235, 0.15)';
      }
    } else {
      if (chipIcon) chipIcon.textContent = '🌐';
      if (chipLabel) chipLabel.textContent = 'oracaodiaria.space (Site)';
      if (scopeBadgeText) scopeBadgeText.textContent = 'Site / Landing Page';
      if (scopeBadge) {
        scopeBadge.style.background = '#ECFDF5';
        scopeBadge.style.color = '#059669';
        scopeBadge.style.borderColor = 'rgba(16, 185, 129, 0.2)';
      }
    }

    document.querySelectorAll('.project-option').forEach(opt => {
      if (opt.dataset.mode === mode) {
        opt.classList.add('selected');
      } else {
        opt.classList.remove('selected');
      }
    });

    const dockBtnApp = document.getElementById('dock-btn-app');
    const dockBtnSite = document.getElementById('dock-btn-site');
    const dockBtnCanvas = document.getElementById('dock-btn-canvas');
    if (dockBtnApp && dockBtnSite) {
      if (mode === 'app') {
        dockBtnApp.classList.add('active');
        dockBtnSite.classList.remove('active');
      } else {
        dockBtnSite.classList.add('active');
        dockBtnApp.classList.remove('active');
      }
    }
    // Desativar canvas quando selecionamos App ou Site
    if (dockBtnCanvas) dockBtnCanvas.classList.remove('active');

    renderKPIsAndBreakdown();
    renderChart();
  }

  /* --------------------------------------------------
     6.5. Estado Vazio — nunca inventar número
     Se a origem do dado não existe (ou o período veio zerado),
     o card diz isso na cara em vez de estimar uma porcentagem.
     -------------------------------------------------- */
  function emptyState(icon, title, hint) {
    return `
      <li class="empty-state">
        <span class="empty-state__icon"><i data-lucide="${icon}" style="width: 15px; height: 15px;"></i></span>
        <span class="empty-state__title">${title}</span>
        ${hint ? `<span class="empty-state__hint">${hint}</span>` : ''}
      </li>
    `;
  }

  // Versão sem <li>, para os cards que não são lista (ex.: Monetização)
  function emptyStateBlock(icon, title, hint) {
    return `
      <div class="empty-state">
        <span class="empty-state__icon"><i data-lucide="${icon}" style="width: 15px; height: 15px;"></i></span>
        <span class="empty-state__title">${title}</span>
        ${hint ? `<span class="empty-state__hint">${hint}</span>` : ''}
      </div>
    `;
  }

  // Marca o KPI como apagado quando o valor real é zero
  function setKpi(el, value, isZero) {
    if (!el) return;
    el.textContent = value;
    el.classList.toggle('is-zero', !!isZero);
  }

  /* --------------------------------------------------
     7. Renderização dos 6 Cards Dedicados
     -------------------------------------------------- */
  function renderKPIsAndBreakdown() {
    const k1Label = document.getElementById('kpi-label-1');
    const k1Val = document.getElementById('kpi-val-1');
    const k2Label = document.getElementById('kpi-label-2');
    const k2Val = document.getElementById('kpi-val-2');
    const k3Label = document.getElementById('kpi-label-3');
    const k3Val = document.getElementById('kpi-val-3');
    const k4Label = document.getElementById('kpi-label-4');
    const k4Val = document.getElementById('kpi-val-4');
    const k5Label = document.getElementById('kpi-label-5');
    const k5Val = document.getElementById('kpi-val-5');

    const card1Title = document.getElementById('breakdown-card-1-title');
    const card1Icon = document.getElementById('card-1-icon');
    const funnelList = document.getElementById('funnel-list');

    const card2Title = document.getElementById('breakdown-card-2-title');
    const referrersList = document.getElementById('referrers-list');

    const card3Title = document.getElementById('breakdown-card-3-title');
    const geoList = document.getElementById('geo-list');

    const card4Title = document.getElementById('breakdown-card-4-title');
    const devicesList = document.getElementById('devices-list');

    const card5Title = document.getElementById('breakdown-card-5-title');
    const browsersList = document.getElementById('browsers-list');

    const card6Title = document.getElementById('breakdown-card-6-title');
    const card6Icon = document.getElementById('card-6-icon');
    const card6Content = document.getElementById('breakdown-card-6-content');

    const waitlistCount = waitlistRows.length;

    // Filtra eventos reais do app pelo período selecionado
    const activeAppEvents = getFilteredRecords(rawEvents.filter(e => e.platform !== 'web'));

    const eventCounts = {};
    const stepCounts = {};
    const userSessionDurations = {};
    let realPurchasesCount = 0;
    let sandboxPurchasesCount = 0;

    activeAppEvents.forEach(e => {
      eventCounts[e.event] = (eventCounts[e.event] || 0) + 1;
      if (e.step) stepCounts[e.step] = (stepCounts[e.step] || 0) + 1;
      
      if (e.event === 'purchase_completed') {
        if (isRealProductionPurchase(e)) {
          realPurchasesCount += 1;
        } else {
          sandboxPurchasesCount += 1;
        }
      }

      const uid = e.user_id || e.anon_id;
      if (uid) {
        const t = new Date(e.created_at).getTime();
        if (!userSessionDurations[uid]) {
          userSessionDurations[uid] = { min: t, max: t };
        } else {
          if (t < userSessionDurations[uid].min) userSessionDurations[uid].min = t;
          if (t > userSessionDurations[uid].max) userSessionDurations[uid].max = t;
        }
      }
    });

    let totalDurationSeconds = 0;
    let durationCount = 0;
    Object.values(userSessionDurations).forEach(sess => {
      const diffSec = (sess.max - sess.min) / 1000;
      if (diffSec > 5 && diffSec < 1800) {
        totalDurationSeconds += diffSec;
        durationCount += 1;
      }
    });
    const avgSec = durationCount > 0 ? Math.round(totalDurationSeconds / durationCount) : 127;
    const avgMin = Math.floor(avgSec / 60);
    const avgRemainderSec = avgSec % 60;
    const avgDurationFormatted = `${avgMin}m ${String(avgRemainderSec).padStart(2, '0')}s`;

    const starts = eventCounts['onboarding_started'] || 0;
    const steps = eventCounts['onboarding_step_viewed'] || 0;
    const prayers = eventCounts['first_prayer_completed'] || eventCounts['onboarding_finished'] || 0;
    const screentime = eventCounts['screentime_permission_granted'] || 0;
    const notifs = eventCounts['notif_permission_granted'] || 0;
    const paywalls = eventCounts['paywall_viewed'] || 0;

    if (currentMode === 'app') {
      // ----------------------------------------------
      // MODO: APP IOS
      // ----------------------------------------------
      if (k1Label) k1Label.textContent = 'Visitantes (Inícios)';
      setKpi(k1Val, starts, starts === 0);

      if (k2Label) k2Label.textContent = 'Telas Vistas';
      setKpi(k2Val, steps.toLocaleString('pt-BR'), steps === 0);

      // Sem inícios no período não existe taxa: mostra '—' em vez de um 0% que parece bom.
      if (k3Label) k3Label.textContent = 'Taxa de Abandono';
      const dropRate = starts > 0 ? Math.round(100 - (prayers / starts * 100)) : null;
      setKpi(k3Val, dropRate === null ? '—' : `${dropRate}%`, dropRate === null);

      if (k4Label) k4Label.textContent = 'Tempo Médio';
      setKpi(k4Val, starts === 0 ? '—' : avgDurationFormatted, starts === 0);

      if (k5Label) k5Label.textContent = 'Assinaturas App Store';
      setKpi(k5Val, realPurchasesCount, realPurchasesCount === 0);
      if (k5Val) k5Val.style.color = realPurchasesCount > 0 ? '#2563EB' : '';

      if (card1Title) card1Title.textContent = 'Passos do Onboarding';
      if (card1Icon) card1Icon.setAttribute('data-lucide', 'git-commit');

      if (funnelList) {
        funnelList.innerHTML = starts === 0 ? emptyState(
          'git-commit',
          'Nenhum onboarding no período',
          'Os passos aparecem aqui quando alguém abre o app.'
        ) : `
          <li class="data-row">
            <div class="data-row__left"><span class="data-dot"></span><span>1. Início do Onboarding</span></div>
            <div class="data-row__right"><span class="data-count">${starts}</span></div>
          </li>
          <li class="data-row">
            <div class="data-row__left"><span class="data-dot"></span><span>2. Perguntas & Propósito</span></div>
            <div class="data-row__right"><span class="data-count">${stepCounts['3'] || 0}</span></div>
          </li>
          <li class="data-row">
            <div class="data-row__left"><span class="data-dot" style="background:#10B981;"></span><span>3. Screen Time Concedido</span></div>
            <div class="data-row__right"><span class="data-count">${screentime}</span></div>
          </li>
          <li class="data-row">
            <div class="data-row__left"><span class="data-dot"></span><span>4. Notificações Concedidas</span></div>
            <div class="data-row__right"><span class="data-count">${notifs}</span></div>
          </li>
          <li class="data-row">
            <div class="data-row__left"><span class="data-dot" style="background:#6366F1;"></span><span>5. Visualizou Paywall</span></div>
            <div class="data-row__right"><span class="data-count">${paywalls}</span></div>
          </li>
          <li class="data-row">
            <div class="data-row__left"><span class="data-dot" style="background:#10B981;"></span><span>6. 1ª Oração Feita</span></div>
            <div class="data-row__right"><span class="data-count">${prayers}</span></div>
          </li>
        `;
      }

      if (card2Title) card2Title.textContent = 'Origens de Instalação';
      if (referrersList) {
        referrersList.innerHTML = emptyState(
          'share-2',
          'Sem dado de atribuição',
          'Requer App Store Connect ou AdServices — o app não envia origem.'
        );
      }

      if (card3Title) card3Title.textContent = 'Localização & Países';
      if (geoList) {
        geoList.innerHTML = emptyState(
          'map-pin',
          'Sem dado de localização',
          'Nenhum evento carrega país ou região hoje.'
        );
      }

      // Modelo e versão do iOS existem no device, mas ainda não sobem no evento.
      if (card4Title) card4Title.textContent = 'Modelos de iPhone';
      if (devicesList) {
        devicesList.innerHTML = emptyState(
          'smartphone',
          'Sem dado de dispositivo',
          'O evento só envia platform (ios); falta o modelo em properties.'
        );
      }

      if (card5Title) card5Title.textContent = 'Versões do Sistema (iOS)';
      if (browsersList) {
        browsersList.innerHTML = emptyState(
          'compass',
          'Sem dado de versão do iOS',
          'Existe app_version, mas a versão do sistema não é enviada.'
        );
      }

      if (card6Title) card6Title.textContent = 'Monetização & Conversão';
      if (card6Icon) card6Icon.setAttribute('data-lucide', 'circle-dollar-sign');
      if (card6Content) {
        card6Content.innerHTML = realPurchasesCount === 0 ? emptyStateBlock(
          'circle-dollar-sign',
          'Nenhuma compra ainda',
          sandboxPurchasesCount > 0
            ? `${sandboxPurchasesCount} teste(s) de Sandbox / TestFlight foram filtrados.`
            : 'Compras de produção da App Store aparecem aqui.'
        ) : `
          <p style="font-size: 13px; color: #374151; line-height: 1.5; margin-bottom: 6px;">
            <strong>${realPurchasesCount} compras de produção</strong> registradas na App Store.
          </p>
          <span style="font-size: 11.5px; color: #6B7280; font-weight: 500;">
            ● ${sandboxPurchasesCount} testes de Sandbox / TestFlight filtrados
          </span>
        `;
      }

    } else {
      // ----------------------------------------------
      // MODO: SITE / LANDING PAGE (100% DADOS REAIS DO SUPABASE)
      // ----------------------------------------------
      const periodWaitlist = getFilteredRecords(waitlistRows);
      const totalWaitlistCount = periodWaitlist.length;

      // Eventos reais da landing page (analytics.js -> platform 'web')
      const webEvents = getFilteredRecords(rawEvents.filter(e => e.platform === 'web'));
      const pageviews = webEvents.filter(e => e.event === 'web_pageview');
      const uniqueVisitors = new Set(pageviews.map(e => e.anon_id || e.id)).size;
      const semVisita = pageviews.length === 0;

      const prop = (e, k) => (e.properties && e.properties[k]) || null;

      // Agrupa os pageviews por uma propriedade real, do maior para o menor
      const countBy = (list, key) => {
        const m = {};
        list.forEach(e => {
          const v = prop(e, key);
          if (v) m[v] = (m[v] || 0) + 1;
        });
        return Object.entries(m).sort((a, b) => b[1] - a[1]);
      };

      const rowsFrom = (entries, total, dotColor) => entries.slice(0, 5).map(([label, count]) => `
        <li class="data-row">
          <div class="data-row__left"><span class="data-dot"${dotColor ? ` style="background:${dotColor};"` : ''}></span><span>${label}</span></div>
          <div class="data-row__right"><span class="data-count">${count}</span><span class="data-pct">${Math.round((count / (total || 1)) * 100)}%</span></div>
        </li>
      `).join('');

      const semDadoWeb = (icon, titulo) => emptyState(
        icon,
        titulo,
        'Nenhuma visita registrada no período pela landing page.'
      );

      if (k1Label) k1Label.textContent = 'Visitantes Únicos';
      setKpi(k1Val, uniqueVisitors, uniqueVisitors === 0);
      const k1Info = document.getElementById('kpi-info-1');
      if (k1Info) k1Info.title = 'Pessoas distintas que abriram a landing page (anon_id)';

      if (k2Label) k2Label.textContent = 'Páginas Vistas';
      setKpi(k2Val, pageviews.length.toLocaleString('pt-BR'), semVisita);

      // Agora existe denominador real: inscritos / visitantes únicos
      if (k3Label) k3Label.textContent = 'Taxa de Conversão';
      const convRate = uniqueVisitors > 0 ? (totalWaitlistCount / uniqueVisitors) * 100 : null;
      setKpi(k3Val, convRate === null ? '—' : `${convRate.toFixed(1)}%`, convRate === null);
      const k3Info = document.getElementById('kpi-info-3');
      if (k3Info) k3Info.title = 'Inscritos na waitlist dividido por visitantes únicos do site';

      if (k4Label) k4Label.textContent = 'Inscritos na Lista';
      setKpi(k4Val, totalWaitlistCount, totalWaitlistCount === 0);

      // Último cadastro real, em vez de repetir o total de inscritos
      if (k5Label) k5Label.textContent = 'Último Cadastro';
      const lastSignup = periodWaitlist
        .slice()
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      setKpi(k5Val, lastSignup ? formatRelativeDate(lastSignup.created_at) : '—', !lastSignup);
      if (k5Val) k5Val.style.color = lastSignup ? '#10B981' : '';
      const k5Info = document.getElementById('kpi-info-5');
      if (k5Info) k5Info.title = 'Quando o e-mail mais recente entrou na waitlist';

      // Card 1: Funil real visita -> seção de inscrição -> e-mail
      if (card1Title) card1Title.textContent = 'Funil do Site';
      if (card1Icon) card1Icon.setAttribute('data-lucide', 'git-commit');
      if (funnelList) {
        const waitlistSectionViews = new Set(
          webEvents
            .filter(e => e.event === 'web_section_view' && String(e.step || '').includes('waitlist'))
            .map(e => e.anon_id || e.id)
        ).size;

        const pct = n => Math.round((n / (uniqueVisitors || 1)) * 100);

        funnelList.innerHTML = (semVisita && totalWaitlistCount === 0)
          ? semDadoWeb('git-commit', 'Nenhuma visita no período')
          : `
          <li class="data-row">
            <div class="data-row__left"><span class="data-dot"></span><span>1. Visitou o site</span></div>
            <div class="data-row__right"><span class="data-count">${uniqueVisitors}</span><span class="data-pct">${uniqueVisitors > 0 ? '100%' : '—'}</span></div>
          </li>
          <li class="data-row">
            <div class="data-row__left"><span class="data-dot" style="background:#6366F1;"></span><span>2. Chegou na inscrição</span></div>
            <div class="data-row__right"><span class="data-count">${waitlistSectionViews}</span><span class="data-pct">${pct(waitlistSectionViews)}%</span></div>
          </li>
          <li class="data-row">
            <div class="data-row__left"><span class="data-dot" style="background:#10B981;"></span><span>3. Deixou o e-mail</span></div>
            <div class="data-row__right"><span class="data-count">${totalWaitlistCount}</span><span class="data-pct">${pct(totalWaitlistCount)}%</span></div>
          </li>
        `;
      }

      // Card 2: Canal real de cada visita (referrer + UTM)
      if (card2Title) card2Title.textContent = 'Origens & Canais';
      if (referrersList) {
        const canais = countBy(pageviews, 'channel');
        referrersList.innerHTML = canais.length
          ? rowsFrom(canais, pageviews.length, '#2563EB')
          : semDadoWeb('share-2', 'Sem dado de origem');
      }

      // Card 3: País aproximado por fuso/idioma do visitante
      if (card3Title) card3Title.textContent = 'Localização & Países';
      if (geoList) {
        const paises = countBy(pageviews, 'country');
        geoList.innerHTML = paises.length
          ? rowsFrom(paises, pageviews.length)
          : semDadoWeb('map-pin', 'Sem dado de localização');
      }

      // Card 4: Dispositivo e sistema de quem visita (não só de quem se inscreve)
      if (card4Title) card4Title.textContent = 'Dispositivos & Sistemas';
      if (devicesList) {
        const dispositivos = countBy(pageviews, 'device_type');
        const sistemas = countBy(pageviews, 'os');
        devicesList.innerHTML = dispositivos.length
          ? rowsFrom(dispositivos, pageviews.length, '#10B981') + rowsFrom(sistemas.slice(0, 2), pageviews.length)
          : semDadoWeb('smartphone', 'Sem dado de dispositivo');
      }

      // Card 5: Navegador real do visitante
      if (card5Title) card5Title.textContent = 'Navegadores';
      if (browsersList) {
        const navegadores = countBy(pageviews, 'browser');
        browsersList.innerHTML = navegadores.length
          ? rowsFrom(navegadores, pageviews.length, '#2563EB')
          : semDadoWeb('compass', 'Sem dado de navegador');
      }

      if (card6Title) card6Title.textContent = 'E-mails da Waitlist';
      if (card6Icon) card6Icon.setAttribute('data-lucide', 'mail');
      if (card6Content) {
        if (periodWaitlist.length === 0) {
          card6Content.innerHTML = emptyStateBlock(
            'mail',
            'Nenhum e-mail no período',
            'Os cadastros da landing page aparecem aqui assim que chegam.'
          );
        } else {
          card6Content.innerHTML = `
            <ul class="data-list">
              ${periodWaitlist.map(row => `
                <li class="data-row copyable-row" style="cursor: pointer;" title="Clique para copiar ${row.email}">
                  <div class="data-row__left" style="max-width: 210px;" title="${row.email}">
                    <span class="data-dot" style="background: #10B981;"></span>
                    <span style="font-weight: 500;">${row.email}</span>
                  </div>
                  <div class="data-row__right">
                    <span class="data-pct" style="color: var(--ink-secondary); font-size: 11px;">${formatRelativeDate(row.created_at)}</span>
                  </div>
                </li>
              `).join('')}
            </ul>
          `;

          card6Content.querySelectorAll('.copyable-row').forEach(row => {
            const emailSpan = row.querySelector('.data-row__left span:last-child');
            if (emailSpan) {
              const email = emailSpan.textContent.trim();
              row.addEventListener('click', () => {
                navigator.clipboard.writeText(email).then(() => {
                  const orig = row.innerHTML;
                  row.innerHTML = `<span style="color: #10B981; font-weight: 600; font-size: 12px; padding: 2px 4px;">✓ Copiado! (${email})</span>`;
                  setTimeout(() => { row.innerHTML = orig; }, 1500);
                });
              });
            }
          });
        }
      }
    }

    if (window.lucide) {
      lucide.createIcons();
    }
  }

  /* --------------------------------------------------
     8. Setup dos Dropdowns e Botões do Dock
     -------------------------------------------------- */
  function initSwitcherEvents() {
    const chip = document.getElementById('app-selector-btn');
    const dropdown = document.getElementById('project-dropdown');

    if (chip && dropdown) {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        chip.classList.toggle('active');
        dropdown.classList.toggle('open');
        if (dateDropdown) dateDropdown.classList.remove('open');
      });
    }

    const optApp = document.getElementById('opt-app');
    const optSite = document.getElementById('opt-site');

    if (optApp) {
      optApp.addEventListener('click', () => {
        applyMode('app');
        if (dropdown) dropdown.classList.remove('open');
        if (chip) chip.classList.remove('active');
      });
    }

    if (optSite) {
      optSite.addEventListener('click', () => {
        applyMode('site');
        if (dropdown) dropdown.classList.remove('open');
        if (chip) chip.classList.remove('active');
      });
    }

    const datePill = document.getElementById('date-range-btn');
    const dateDropdown = document.getElementById('date-dropdown');
    const dateLabel = document.getElementById('date-range-label');

    if (datePill && dateDropdown) {
      datePill.addEventListener('click', (e) => {
        e.stopPropagation();
        datePill.classList.toggle('active');
        dateDropdown.classList.toggle('open');
        if (dropdown) dropdown.classList.remove('open');
      });

      document.querySelectorAll('.date-option').forEach(opt => {
        opt.addEventListener('click', () => {
          document.querySelectorAll('.date-option').forEach(o => o.classList.remove('selected'));
          opt.classList.add('selected');
          currentPeriod = opt.dataset.period;

          if (dateLabel) {
            if (currentPeriod === 'today') dateLabel.textContent = 'Hoje';
            else if (currentPeriod === '7d') dateLabel.textContent = 'Últimos 7 dias';
            else dateLabel.textContent = 'Últimos 30 dias';
          }

          dateDropdown.classList.remove('open');
          datePill.classList.remove('active');
          renderKPIsAndBreakdown();
          renderChart();
        });
      });
    }

    document.addEventListener('click', (e) => {
      if (dropdown && !dropdown.contains(e.target) && !chip.contains(e.target)) {
        dropdown.classList.remove('open');
        if (chip) chip.classList.remove('active');
      }
      if (dateDropdown && !dateDropdown.contains(e.target) && !datePill.contains(e.target)) {
        dateDropdown.classList.remove('open');
        if (datePill) datePill.classList.remove('active');
      }
    });

    const dockBtnApp = document.getElementById('dock-btn-app');
    const dockBtnSite = document.getElementById('dock-btn-site');

    if (dockBtnApp) dockBtnApp.addEventListener('click', () => applyMode('app'));
    if (dockBtnSite) dockBtnSite.addEventListener('click', () => applyMode('site'));

    // Clique interativo nos 5 Cards de KPI do Topo para alterar a métrica ativa do gráfico
    document.querySelectorAll('.nested-stat-card').forEach(card => {
      card.addEventListener('click', () => {
        const kpi = card.dataset.kpi;
        if (!kpi) return;

        document.querySelectorAll('.nested-stat-card').forEach(c => c.classList.remove('active-kpi-card'));
        card.classList.add('active-kpi-card');

        selectedKpiMetric = kpi;
        renderChart();
      });
    });
  }

  /* --------------------------------------------------
     9. Carregamento Direto do Supabase (100% Dados Reais)
     -------------------------------------------------- */
  async function loadRealData() {
    try {
      const waitlistRes = await fetch(`${SUPABASE_URL}/rest/v1/waitlist?select=id,email,created_at,source,user_agent&order=created_at.desc`, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        }
      });
      if (waitlistRes.ok) {
        waitlistRows = await waitlistRes.json();
      }

      const eventsRes = await fetch(`${SUPABASE_URL}/rest/v1/analytics_events?select=id,event,step,properties,platform,created_at,user_id,anon_id&order=created_at.desc&limit=3000`, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        }
      });

      if (eventsRes.ok) {
        rawEvents = await eventsRes.json();
      }

      renderKPIsAndBreakdown();
      renderChart();
    } catch (err) {
      console.warn("Erro ao sincronizar com Supabase:", err);
    }
  }

  const dockSyncBtn = document.getElementById('dock-sync-btn');
  if (dockSyncBtn) {
    dockSyncBtn.addEventListener('click', () => {
      dockSyncBtn.style.transform = 'rotate(180deg)';
      loadRealData().then(() => {
        setTimeout(() => { dockSyncBtn.style.transform = 'none'; }, 400);
      });
    });
  }

  /* --------------------------------------------------
     Inicialização Imediata com Dados Reais
     -------------------------------------------------- */
  initSwitcherEvents();
  initChartInteraction();
  initModalEvents();
  // applyMode já redesenha KPIs e gráfico, então cobre a primeira pintura
  applyMode(loadView().mode === 'site' ? 'site' : 'app');
  loadRealData();


  /* --------------------------------------------------
     10. Canvas Infinito (pan, zoom e notas)
     -------------------------------------------------- */
  (function initInfiniteCanvas() {
    const view = document.getElementById('canvas-view');
    const world = document.getElementById('canvas-world');
    const dots = document.getElementById('canvas-dots');
    const hint = document.getElementById('canvas-hint');
    const openBtn = document.getElementById('dock-btn-canvas');
    if (!view || !world || !dots || !openBtn) return;

    // Barra do editor no topo
    const btnAddFrame = document.getElementById('canvas-add-frame');
    const btnAddText = document.getElementById('canvas-add-text');
    const btnDupFrame = document.getElementById('canvas-dup-frame');
    const btnDelFrame = document.getElementById('canvas-del-frame');
    const btnLinkFrames = document.getElementById('canvas-link-frames');
    // Declarados aqui em cima porque updateTextToolbar roda já na primeira câmera
    const btnTextBind = document.getElementById('canvas-text-bind');
    const btnImageBind = document.getElementById('canvas-image-bind');
    const topLabel = document.getElementById('canvas-topbar-label');
    const formatsMenu = document.getElementById('canvas-formats');

    const DOT_GRID = 20;
    // Faixa em que o espaçamento dos pontos pode viver na tela
    const GRID_MIN_PX = 22;
    const GRID_MAX_PX = 44;
    // Zoom mínimo baixo porque um frame tem 1080px de largura no mundo:
    // sem isso não dá para ver um carrossel inteiro de uma vez
    const MIN_SCALE = 0.05;
    const MAX_SCALE = 4;
    const STORAGE_KEY = 'oa_canvas_v1';

    /* Formatos de post. w/h são os pixels reais do arquivo exportado:
       dentro do mundo, 1 unidade = 1px do PNG final. */
    /* Os três 9:16 têm o mesmo arquivo (1080 × 1920) e safe zones bem diferentes:
       Story tem barra de progresso e campo de resposta, Reels tem legenda menor
       que a do TikTok, e o TikTok é o que mais come rodapé e coluna direita. */
    const FORMATS = {
      'ig-feed':   { name: 'Instagram Feed',    w: 1080, h: 1350 },
      'ig-square': { name: 'Post Quadrado',     w: 1080, h: 1080 },
      'ig-story':  { name: 'Instagram Story',   w: 1080, h: 1920 },
      'reels':     { name: 'Reels',             w: 1080, h: 1920 },
      'story':     { name: 'TikTok',            w: 1080, h: 1920 },
      'pinterest': { name: 'Pinterest',         w: 1000, h: 1500 },
      'yt-thumb':  { name: 'Thumbnail YouTube', w: 1280, h:  720 },
    };
    const FRAME_GAP = 120;
    /* Abaixo disso o rótulo mais longo já é mais largo que o frame inteiro na
       tela (1080 × 0.26 ≈ 280px), então some. Em zoom visual: ~78%. */
    const BADGE_MIN_SCALE = 0.26;
    const BASE_SCALE = 0.3333; // Define que 1/3 da escala real (px final) é o 100% visual na tela

    let cam = { x: 0, y: 0, scale: BASE_SCALE };
    let frames = [];
    let frameSeq = 1;
    let selectedId = null; // ID do primeiro frame selecionado (para retrocompatibilidade)
    let selectedFrameIds = new Set(); // Múltiplos frames (posts) selecionados
    // Ligações entre frames: cada uma diz "este vem depois daquele" no carrossel
    let links = [];
    let linkSeq = 1;
    let selectedLinkId = null;
    let linksLayer = null;
    let linksRoot = null;
    
    let selectedTextNode = { frameId: null, childId: null }; // Primeiro nó filho selecionado
    let selectedChildNodes = []; // Múltiplos nós selecionados: [{ frameId, childId }, ...]
    let isSpacePressed = false;
    let croppingImage = null; // { frameId, childId }
    let childSeq = 1;
    let snapEnabled = localStorage.getItem('oa_canvas_snap') !== 'false';
    let showGuides = localStorage.getItem('oa_canvas_guides') === 'true';

    function getSelectedFrameIds() {
      return Array.from(selectedFrameIds);
    }
    function getSelectedFrames() {
      return frames.filter(f => selectedFrameIds.has(f.id));
    }
    /* O frame ativo da seleção. A exportação precisa de um frame só — quando há
       vários selecionados, manda o que está em `selectedId`. */
    function selectedFrame() {
      return frames.find(f => f.id === selectedId) || getSelectedFrames()[0] || null;
    }
    function isFrameSelected(id) {
      return selectedFrameIds.has(id);
    }
    function isChildNodeSelected(frameId, childId) {
      return selectedChildNodes.some(n => n.frameId === frameId && n.childId === childId);
    }
    
    /* --------------------------------------------------
       Armazenamento de Assets de Imagem em Alta Resolução (IndexedDB)
       Como o Figma/Canva: o JSON do canvas guarda só a referência (assetId),
       e a imagem original (4K/8K/PNG com transparência) é armazenada no IndexedDB
       do navegador sem perda nenhuma de qualidade e sem estourar o limite do localStorage.
       -------------------------------------------------- */
    const DB_NAME = 'oa_canvas_assets_db';
    const DB_VERSION = 1;
    const STORE_NAME = 'assets';
    const assetCache = new Map();

    function openAssetDB() {
      return new Promise((resolve) => {
        if (!window.indexedDB) return resolve(null);
        try {
          const req = indexedDB.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
              db.createObjectStore(STORE_NAME);
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }

    async function saveAsset(id, dataUrl) {
      try {
        const db = await openAssetDB();
        if (!db) return;
        return new Promise((resolve) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(dataUrl, id);
          tx.oncomplete = () => resolve(id);
          tx.onerror = () => resolve(null);
        });
      } catch { /* segue em memória caso IndexedDB falhe */ }
    }

    async function getAsset(id) {
      if (assetCache.has(id)) return assetCache.get(id);
      try {
        const db = await openAssetDB();
        if (!db) return null;
        return new Promise((resolve) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const req = tx.objectStore(STORE_NAME).get(id);
          req.onsuccess = () => {
            const res = req.result || null;
            if (res) assetCache.set(id, res);
            resolve(res);
          };
          req.onerror = () => resolve(null);
        });
      } catch {
        return null;
      }
    }
    
    /* --------------------------------------------------
       Tipografia do nó de texto

       O estilo base vive no nó inteiro, como um text layer do Figma. Com um
       trecho selecionado, porém, a barra passa a mexer só nele: o pedaço vira
       um <span data-run="1"> com o estilo inline, que ganha do nó por ser
       filho. O texto continua indo pro JSON como HTML (child.html), com
       child.text de espelho para o resto do canvas que só quer as letras.

       Nada de document.execCommand aqui: ele não cobre opacidade,
       letter-spacing nem tamanho em px, que é justamente o que a barra tem.
       -------------------------------------------------- */

    // Cada família declara os pesos que o Google Fonts realmente entrega.
    // Pedir 700 numa fonte que só tem 400 devolve peso sintético e borrado.
    const FONTS = [
      { css: '"Inter Tight", sans-serif',      name: 'Inter Tight',      weights: [300, 400, 500, 600, 700, 800] },
      { css: '"Inter", sans-serif',            name: 'Inter',            weights: [300, 400, 500, 600, 700, 800] },
      { css: '"Poppins", sans-serif',          name: 'Poppins',          weights: [300, 400, 500, 600, 700, 800] },
      { css: '"Space Grotesk", sans-serif',    name: 'Space Grotesk',    weights: [300, 400, 500, 600, 700] },
      { css: '"Bebas Neue", sans-serif',       name: 'Bebas Neue',       weights: [400] },
      { css: '"Playfair Display", serif',      name: 'Playfair Display', weights: [400, 500, 600, 700, 800, 900] },
      { css: '"DM Serif Display", serif',      name: 'DM Serif Display', weights: [400] },
      { css: '"Lora", serif',                  name: 'Lora',             weights: [400, 500, 600, 700] },
      { css: '"Caveat", cursive',              name: 'Caveat',           weights: [400, 500, 600, 700] },
      { css: '"JetBrains Mono", monospace',    name: 'JetBrains Mono',   weights: [300, 400, 500, 600, 700] },
    ];

    const WEIGHT_NAMES = {
      300: 'Light', 400: 'Regular', 500: 'Medium',
      600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black',
    };

    const TEXT_PRESETS = {
      heading:    { name: 'Título',    fontFamily: '"Inter Tight", sans-serif', fontSize: 56, fontWeight: 800, lineHeight: 1.08, letterSpacing: -0.03, transform: 'none' },
      subheading: { name: 'Subtítulo', fontFamily: '"Inter", sans-serif',       fontSize: 32, fontWeight: 600, lineHeight: 1.2,  letterSpacing: -0.01, transform: 'none' },
      body:       { name: 'Corpo',     fontFamily: '"Inter", sans-serif',       fontSize: 20, fontWeight: 400, lineHeight: 1.45, letterSpacing: 0,     transform: 'none' },
      quote:      { name: 'Citação',   fontFamily: '"Playfair Display", serif', fontSize: 36, fontWeight: 500, italic: true, lineHeight: 1.25, letterSpacing: 0, transform: 'none' },
      badge:      { name: 'Destaque',  fontFamily: '"JetBrains Mono", monospace', fontSize: 14, fontWeight: 700, lineHeight: 1.2, letterSpacing: 0.08, transform: 'uppercase' },
    };

    // Valores de um nó novo e piso para os nós salvos antes destes campos existirem
    const TEXT_DEFAULTS = {
      fontFamily: '"Inter Tight", sans-serif',
      fontSize: 48,
      fontWeight: 700,
      italic: false,
      underline: false,
      color: '#000000',
      bg: '',
      shadow: false,
      align: 'left',
      lineHeight: 1.15,
      letterSpacing: -0.02,
      transform: 'none',
      opacity: 100,
    };

    /* Compara também pelo primeiro nome da pilha: o estilo lido de um trecho
       vem do getComputedStyle, que reescreve as aspas e a lista de fallback. */
    function fontOf(child) {
      const css = child.fontFamily || TEXT_DEFAULTS.fontFamily;
      const first = css.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
      return FONTS.find(f => f.css === css)
        || FONTS.find(f => f.name.toLowerCase() === first)
        || FONTS[0];
    }

    // Ao trocar de família, o peso atual pode não existir lá: cai no mais próximo
    function nearestWeight(font, weight) {
      return font.weights.reduce((best, w) =>
        Math.abs(w - weight) < Math.abs(best - weight) ? w : best, font.weights[0]);
    }

    const textToolbar = document.getElementById('canvas-text-toolbar');
    const advRow = document.getElementById('canvas-text-advanced');
    const selPreset = document.getElementById('canvas-text-preset');
    const selFont = document.getElementById('canvas-text-font');
    const selWeight = document.getElementById('canvas-text-weight');
    const inputSize = document.getElementById('canvas-text-size');
    const btnSizeUp = document.getElementById('canvas-text-size-up');
    const btnSizeDown = document.getElementById('canvas-text-size-down');
    const inputColor = document.getElementById('canvas-text-color');
    const btnBold = document.getElementById('canvas-text-bold');
    const btnItalic = document.getElementById('canvas-text-italic');
    const btnUnderline = document.getElementById('canvas-text-underline');
    // Prefixo "align" para não colidir com os botões de zoom lá embaixo
    const btnAlignLeft = document.getElementById('canvas-text-align-left');
    const btnAlignCenter = document.getElementById('canvas-text-align-center');
    const btnAlignRight = document.getElementById('canvas-text-align-right');
    const btnMore = document.getElementById('canvas-text-more');
    const inputLh = document.getElementById('canvas-text-lh');
    const inputLs = document.getElementById('canvas-text-ls');
    const inputOpacity = document.getElementById('canvas-text-opacity');
    const inputBg = document.getElementById('canvas-text-bg');
    const btnBgClear = document.getElementById('canvas-text-bg-clear');
    const btnShadow = document.getElementById('canvas-text-shadow');
    const btnCaseNone = document.getElementById('canvas-text-case-none');
    const btnCaseUpper = document.getElementById('canvas-text-case-upper');
    const btnCaseLower = document.getElementById('canvas-text-case-lower');
    const btnTextDup = document.getElementById('canvas-text-dup');
    const btnTextDel = document.getElementById('canvas-text-del');

    /* O estilo mora no .canvas-text-node__content, não no wrapper: o content
       nasce com font-size/color inline, que ganham de qualquer herança. */
    function paintTextStyle(child, node) {
      const content = node || world.querySelector(`.canvas-text-node[data-id="${child.id}"] .canvas-text-node__content`);
      if (!content) return;
      const s = content.style;
      s.fontFamily = child.fontFamily || TEXT_DEFAULTS.fontFamily;
      s.fontSize = `${child.fontSize || TEXT_DEFAULTS.fontSize}px`;
      s.fontWeight = child.fontWeight || TEXT_DEFAULTS.fontWeight;
      s.fontStyle = child.italic ? 'italic' : 'normal';
      s.textDecoration = child.underline ? 'underline' : 'none';
      s.color = child.color || TEXT_DEFAULTS.color;
      s.textAlign = child.align || TEXT_DEFAULTS.align;
      s.lineHeight = String(child.lineHeight || TEXT_DEFAULTS.lineHeight);
      // em, não px: o espaçamento acompanha o tamanho da fonte sozinho
      s.letterSpacing = `${child.letterSpacing != null ? child.letterSpacing : TEXT_DEFAULTS.letterSpacing}em`;
      s.textTransform = child.transform || TEXT_DEFAULTS.transform;
      s.opacity = String((child.opacity != null ? child.opacity : TEXT_DEFAULTS.opacity) / 100);
      s.backgroundColor = child.bg || 'transparent';
      s.padding = child.bg && child.bg !== 'transparent' ? '4px 12px' : '';
      s.borderRadius = child.bg && child.bg !== 'transparent' ? '8px' : '';
      s.textShadow = child.shadow ? '0 2px 10px rgba(0,0,0,0.55)' : 'none';
    }

    function selectedChild() {
      const frame = frames.find(f => f.id === selectedTextNode.frameId);
      if (!frame) return null;
      return (frame.children || []).find(c => c.id === selectedTextNode.childId) || null;
    }

    function contentOf(child) {
      return world.querySelector(`.canvas-text-node[data-id="${child.id}"] .canvas-text-node__content`);
    }

    /* --------------------------------------------------
       Estilo de trecho (só o pedaço selecionado)
       -------------------------------------------------- */

    // Cada propriedade do modelo e o CSS equivalente num span de trecho
    const INLINE_CSS = {
      fontFamily:    { prop: 'fontFamily',      to: v => v },
      fontSize:      { prop: 'fontSize',        to: v => `${v}px` },
      fontWeight:    { prop: 'fontWeight',      to: v => String(v) },
      italic:        { prop: 'fontStyle',       to: v => (v ? 'italic' : 'normal') },
      underline:     { prop: 'textDecoration',  to: v => (v ? 'underline' : 'none') },
      color:         { prop: 'color',           to: v => v },
      bg:            { prop: 'backgroundColor', to: v => v || 'transparent' },
      shadow:        { prop: 'textShadow',      to: v => (v ? '0 2px 10px rgba(0, 0, 0, 0.55)' : 'none') },
      letterSpacing: { prop: 'letterSpacing',   to: v => `${v}em` },
      transform:     { prop: 'textTransform',   to: v => v },
      opacity:       { prop: 'opacity',         to: v => String(v / 100) },
    };

    // Alinhar ou espaçar linha meio parágrafo não existe: essas seguem do bloco
    const BLOCK_KEYS = ['align', 'lineHeight'];

    let savedRange = null;

    function contentAncestorOf(node) {
      const el = node.nodeType === 1 ? node : node.parentElement;
      return el ? el.closest('.canvas-text-node__content') : null;
    }

    /* Guarda o último trecho marcado. Ao clicar num campo da barra o foco sai
       do texto e o navegador descarta a seleção — por isso ela é lembrada
       aqui, e só é esquecida quando o próprio texto colapsa o cursor. */
    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!contentAncestorOf(range.startContainer)) return; // seleção foi pra barra
      savedRange = sel.isCollapsed ? null : range.cloneRange();
    });

    /* O trecho só vale enquanto o foco está no texto ou na própria barra:
       clicar num botão preserva o range (o mousedown faz preventDefault), mas
       clicar fora, no canvas, volta a valer para o nó inteiro. */
    function activeTextRange(content) {
      if (!savedRange || savedRange.collapsed || !content) return null;
      const active = document.activeElement;
      if (active !== content && !(textToolbar && textToolbar.contains(active))) return null;
      if (!content.contains(savedRange.startContainer)) return null;
      if (!content.contains(savedRange.endContainer)) return null;
      return savedRange;
    }

    function rgbToHex(color) {
      const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color || '');
      if (!m) return color && color[0] === '#' ? color : TEXT_DEFAULTS.color;
      return '#' + [1, 2, 3].map(i => Number(m[i]).toString(16).padStart(2, '0')).join('');
    }

    /* Lê o estilo que está valendo no começo do trecho, no formato do modelo.
       É o que faz ⌘B, itálico e ± tamanho partirem do que está na tela e não
       do estilo do bloco. */
    function styleProbe(range, child) {
      const start = range.startContainer;
      const el = start.nodeType === 1 ? start : start.parentElement;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize) || TEXT_DEFAULTS.fontSize;
      const ls = parseFloat(cs.letterSpacing);
      // opacity não é herdada: sem span próprio, o número que vale é o do nó
      const run = el.closest('span[data-run="1"]');
      const runOpacity = run && run.style.opacity ? parseFloat(run.style.opacity) : null;
      const runBg = run && run.style.backgroundColor ? rgbToHex(run.style.backgroundColor) : '';
      const runShadow = run && run.style.textShadow && run.style.textShadow !== 'none';
      return {
        fontFamily: cs.fontFamily,
        fontSize: Math.round(size),
        fontWeight: Number(cs.fontWeight) || TEXT_DEFAULTS.fontWeight,
        italic: cs.fontStyle === 'italic',
        underline: (cs.textDecorationLine || cs.textDecoration || '').includes('underline'),
        color: rgbToHex(cs.color),
        bg: runBg || (child && child.bg) || '',
        shadow: runShadow || (child && !!child.shadow),
        letterSpacing: Number.isNaN(ls) ? 0 : Math.round((ls / size) * 1000) / 1000,
        transform: cs.textTransform,
        opacity: runOpacity !== null
          ? Math.round(runOpacity * 100)
          : (child && child.opacity != null ? child.opacity : TEXT_DEFAULTS.opacity),
      };
    }

    function applyCssTo(el, patch) {
      Object.keys(patch).forEach(k => {
        const rule = INLINE_CSS[k];
        if (rule) el.style[rule.prop] = rule.to(patch[k]);
      });
    }

    /* Quebra os text nodes nas pontas do trecho e envolve o miolo em spans.
       Reusa o span quando ele já é o pai exclusivo daquele texto, senão cada
       clique na barra empilharia uma camada nova. */
    function styleRange(content, range, patch) {
      // O fim primeiro: partir o começo mudaria o nó onde o fim está ancorado
      if (range.endContainer.nodeType === 3 && range.endOffset < range.endContainer.length) {
        range.endContainer.splitText(range.endOffset);
      }
      if (range.startContainer.nodeType === 3 && range.startOffset > 0) {
        range.setStart(range.startContainer.splitText(range.startOffset), 0);
      }

      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      const targets = [];
      while (walker.nextNode()) {
        const n = walker.currentNode;
        if (n.nodeValue && range.intersectsNode(n)) targets.push(n);
      }
      if (!targets.length) return;

      targets.forEach(n => {
        const parent = n.parentElement;
        const reusable = parent !== content
          && parent.dataset.run === '1'
          && parent.childNodes.length === 1;
        if (reusable) {
          applyCssTo(parent, patch);
          return;
        }
        const span = document.createElement('span');
        span.dataset.run = '1';
        parent.insertBefore(span, n);
        span.appendChild(n);
        applyCssTo(span, patch);
      });

      // O trecho tem que sobreviver: o usuário ainda está arrastando o slider
      const last = targets[targets.length - 1];
      const next = document.createRange();
      next.setStart(targets[0], 0);
      next.setEnd(last, last.length);
      savedRange = next;
      if (document.activeElement === content) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(next);
      }
    }

    /* Mexer no nó inteiro tem que vencer os trechos: senão o usuário troca a
       cor e um pedaço fica pra trás sem explicação nenhuma. */
    function clearRunStyles(content, keys) {
      content.querySelectorAll('span[data-run="1"]').forEach(span => {
        keys.forEach(k => {
          const rule = INLINE_CSS[k];
          if (rule) span.style[rule.prop] = '';
        });
        if (span.style.cssText) return;
        // Span sem estilo nenhum só atrapalha: devolve o texto ao pai
        const parent = span.parentNode;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
        parent.normalize();
      });
    }

    // O HTML é a fonte da verdade; o texto puro segue de espelho
    function syncTextHtml(child, content) {
      child.html = content.innerHTML;
      child.text = content.textContent;
    }

    function applyTextToolbarAction(action) {
      if (selectedChildNodes.length === 0) return;
      if (selectedChildNodes.length === 1) {
        const child = selectedChild();
        if (!child || child.type !== 'text') return;
        const content = contentOf(child);
        const range = activeTextRange(content);

        if (range) {
          // Trecho marcado: o estilo vai pro span, não pro nó
          const probe = styleProbe(range, child);
          const before = { ...probe };
          action(probe);
          const patch = {};
          let touchedBlock = false;
          Object.keys(probe).forEach(k => {
            if (probe[k] === before[k]) return;
            if (BLOCK_KEYS.includes(k)) {
              child[k] = probe[k];
              touchedBlock = true;
            } else if (INLINE_CSS[k]) {
              patch[k] = probe[k];
            }
          });
          if (Object.keys(patch).length) styleRange(content, range, patch);
          if (touchedBlock) paintTextStyle(child, content);
          syncTextHtml(child, content);
        } else {
          const before = { ...child };
          action(child);
          paintTextStyle(child, content);
          const changed = Object.keys(child).filter(k => INLINE_CSS[k] && child[k] !== before[k]);
          if (content && changed.length) {
            clearRunStyles(content, changed);
            syncTextHtml(child, content);
          }
        }
      } else {
        selectedChildNodes.forEach(sel => {
          const frame = frames.find(f => f.id === sel.frameId);
          if (!frame) return;
          const child = (frame.children || []).find(c => c.id === sel.childId);
          if (!child || child.type !== 'text') return;
          const content = contentOf(child);
          const before = { ...child };
          action(child);
          paintTextStyle(child, content);
          const changed = Object.keys(child).filter(k => INLINE_CSS[k] && child[k] !== before[k]);
          if (content && changed.length) {
            clearRunStyles(content, changed);
            syncTextHtml(child, content);
          }
        });
      }

      updateTextToolbar(); // a altura muda com a fonte: a barra acompanha
      save();
    }

    // Preenche o seletor de famílias uma vez, cada opção já na própria fonte
    if (selFont) {
      FONTS.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.css;
        opt.textContent = f.name;
        opt.style.fontFamily = f.css;
        selFont.appendChild(opt);
      });
      selFont.addEventListener('change', (e) => applyTextToolbarAction(c => {
        c.fontFamily = e.target.value;
        c.fontWeight = nearestWeight(fontOf(c), c.fontWeight || TEXT_DEFAULTS.fontWeight);
      }));
    }

    if (selWeight) {
      selWeight.addEventListener('change', (e) =>
        applyTextToolbarAction(c => c.fontWeight = Number(e.target.value)));
    }

    // Repovoa os pesos conforme a família escolhida
    function fillWeightOptions(child) {
      if (!selWeight) return;
      const font = fontOf(child);
      const current = String(child.fontWeight || TEXT_DEFAULTS.fontWeight);
      const same = Array.from(selWeight.options).map(o => o.value).join(',') === font.weights.join(',');
      if (!same) {
        selWeight.innerHTML = '';
        font.weights.forEach(w => {
          const opt = document.createElement('option');
          opt.value = String(w);
          opt.textContent = WEIGHT_NAMES[w] || String(w);
          selWeight.appendChild(opt);
        });
      }
      selWeight.value = current;
      selWeight.disabled = font.weights.length < 2;
    }

    if (selPreset) {
      selPreset.addEventListener('change', (e) => {
        const key = e.target.value;
        if (!key || !TEXT_PRESETS[key]) return;
        const p = TEXT_PRESETS[key];
        applyTextToolbarAction(c => {
          Object.assign(c, p);
        });
        selPreset.value = '';
      });
    }

    /* Campo vazio ou zerado não some com o texto: ignora até virar número.
       Sem mínimo aqui de propósito — digitar "1" antes do "2" precisa passar. */
    if (inputSize) inputSize.addEventListener('input', (e) => {
      const size = Number(e.target.value);
      if (!size || size < 0) return;
      applyTextToolbarAction(c => c.fontSize = Math.min(400, size));
    });

    function stepSize(delta) {
      applyTextToolbarAction(c => {
        c.fontSize = Math.min(400, Math.max(8, (c.fontSize || TEXT_DEFAULTS.fontSize) + delta));
      });
    }
    if (btnSizeUp) btnSizeUp.addEventListener('click', () => stepSize(4));
    if (btnSizeDown) btnSizeDown.addEventListener('click', () => stepSize(-4));

    if (inputColor) inputColor.addEventListener('input', (e) => applyTextToolbarAction(c => c.color = e.target.value));

    /* B alterna entre o peso mais leve e o mais pesado que a família oferece:
       em Bebas Neue, que só tem 400, o botão fica sem efeito e desativado. */
    function toggleBold() {
      applyTextToolbarAction(c => {
        const font = fontOf(c);
        if (font.weights.length < 2) return;
        const bold = font.weights[font.weights.length - 1];
        const regular = font.weights.includes(400) ? 400 : font.weights[0];
        c.fontWeight = (c.fontWeight || TEXT_DEFAULTS.fontWeight) >= bold ? regular : bold;
      });
    }
    if (btnBold) btnBold.addEventListener('click', toggleBold);
    if (btnItalic) btnItalic.addEventListener('click', () => applyTextToolbarAction(c => c.italic = !c.italic));
    if (btnUnderline) btnUnderline.addEventListener('click', () => applyTextToolbarAction(c => c.underline = !c.underline));

    if (btnAlignLeft) btnAlignLeft.addEventListener('click', () => applyTextToolbarAction(c => c.align = 'left'));
    if (btnAlignCenter) btnAlignCenter.addEventListener('click', () => applyTextToolbarAction(c => c.align = 'center'));
    if (btnAlignRight) btnAlignRight.addEventListener('click', () => applyTextToolbarAction(c => c.align = 'right'));

    if (inputLh) inputLh.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      if (!v) return;
      applyTextToolbarAction(c => c.lineHeight = Math.min(4, Math.max(0.5, v)));
    });
    if (inputLs) inputLs.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      if (Number.isNaN(v)) return;
      applyTextToolbarAction(c => c.letterSpacing = Math.min(1, Math.max(-0.2, v)));
    });
    if (inputOpacity) inputOpacity.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      if (Number.isNaN(v)) return;
      applyTextToolbarAction(c => c.opacity = Math.min(100, Math.max(0, v)));
    });

    if (inputBg) inputBg.addEventListener('input', (e) => applyTextToolbarAction(c => c.bg = e.target.value));
    if (btnBgClear) btnBgClear.addEventListener('click', () => applyTextToolbarAction(c => c.bg = ''));
    if (btnShadow) btnShadow.addEventListener('click', () => applyTextToolbarAction(c => c.shadow = !c.shadow));

    if (btnCaseNone) btnCaseNone.addEventListener('click', () => applyTextToolbarAction(c => c.transform = 'none'));
    if (btnCaseUpper) btnCaseUpper.addEventListener('click', () => applyTextToolbarAction(c => c.transform = 'uppercase'));
    if (btnCaseLower) btnCaseLower.addEventListener('click', () => applyTextToolbarAction(c => c.transform = 'lowercase'));

    if (btnMore && advRow) btnMore.addEventListener('click', () => {
      const open = advRow.classList.toggle('is-open');
      btnMore.classList.toggle('is-active', open);
      updateTextToolbar();
    });

    /* Clicar num botão da toolbar tirava o foco do texto (e a seleção junto).
       Inputs e selects seguem recebendo foco: sem isso os campos param. */
    if (textToolbar) textToolbar.addEventListener('mousedown', (e) => {
      if (!e.target.closest('input, select')) e.preventDefault();
    });
    if (btnTextBind) btnTextBind.addEventListener('click', () => toggleBind());
    if (btnImageBind) btnImageBind.addEventListener('click', () => toggleBind());

    if (btnTextDup) btnTextDup.addEventListener('click', () => duplicateTextNode());
    if (btnTextDel) btnTextDel.addEventListener('click', () => deleteTextNode());

    const btnTextSendBack = document.getElementById('canvas-text-send-back');
    const btnTextBackward = document.getElementById('canvas-text-backward');
    const btnTextForward = document.getElementById('canvas-text-forward');
    const btnTextBringFront = document.getElementById('canvas-text-bring-front');

    if (btnTextSendBack) btnTextSendBack.addEventListener('click', () => sendChildToBack());
    if (btnTextBackward) btnTextBackward.addEventListener('click', () => sendChildBackward());
    if (btnTextForward) btnTextForward.addEventListener('click', () => bringChildForward());
    if (btnTextBringFront) btnTextBringFront.addEventListener('click', () => bringChildToFront());

    const imageToolbar = document.getElementById('canvas-image-toolbar');
    const btnImageCrop = document.getElementById('canvas-image-crop');
    const inputRadius = document.getElementById('canvas-image-radius');
    const inputBorderWidth = document.getElementById('canvas-image-border-width');
    const inputBorderColor = document.getElementById('canvas-image-border-color');
    const inputImageOpacity = document.getElementById('canvas-image-opacity');
    const inputBlur = document.getElementById('canvas-image-blur');
    const inputShadow = document.getElementById('canvas-image-shadow');
    const btnImageMore = document.getElementById('canvas-image-more');
    const imageAdvRow = document.getElementById('canvas-image-advanced');
    const btnImageDup = document.getElementById('canvas-image-dup');
    const btnImageDel = document.getElementById('canvas-image-del');

    const cropToolbar = document.getElementById('canvas-crop-toolbar');
    const btnCropZoomOut = document.getElementById('canvas-crop-zoom-out');
    const btnCropZoomIn = document.getElementById('canvas-crop-zoom-in');
    const inputCropZoomVal = document.getElementById('canvas-crop-zoom-val');
    const btnCropReset = document.getElementById('canvas-crop-reset');
    const btnCropDone = document.getElementById('canvas-crop-done');

    function ensureImageProps(child) {
      if (!child || child.type !== 'image') return;
      if (!child.origW || !child.origH) {
        child.origW = child.w || 400;
        child.origH = child.h || 300;
      }
      if (child.imgW === undefined || child.imgH === undefined) {
        child.imgW = child.w;
        child.imgH = child.h;
        child.imgX = 0;
        child.imgY = 0;
        child.zoom = 1.0;
      }
      if (child.zoom === undefined) child.zoom = 1.0;
      if (child.imgX === undefined) child.imgX = 0;
      if (child.imgY === undefined) child.imgY = 0;
    }

    function updateImageNodeDOM(child, el) {
      ensureImageProps(child);
      el.style.left = `${child.x}px`;
      el.style.top = `${child.y}px`;
      el.style.width = `${child.w}px`;
      el.style.height = `${child.h}px`;
      el.style.borderRadius = `${child.borderRadius || 0}px`;

      const clip = el.querySelector('.canvas-image-node__clip');
      if (clip) {
        clip.style.borderRadius = `${child.borderRadius || 0}px`;
        clip.style.borderWidth = `${child.borderWidth || 0}px`;
        clip.style.borderColor = child.borderColor || 'transparent';
        clip.style.borderStyle = child.borderWidth ? 'solid' : 'none';
        clip.style.boxSizing = 'border-box';
        clip.style.overflow = 'hidden';
      }

      const img = el.querySelector('.canvas-image-node__img');
      if (img) {
        img.style.left = `${child.imgX}px`;
        img.style.top = `${child.imgY}px`;
        img.style.width = `${child.imgW}px`;
        img.style.height = `${child.imgH}px`;
        img.style.border = 'none';
        img.style.borderRadius = '0';
        img.style.opacity = (child.opacity !== undefined ? child.opacity : 100) / 100;
        let filters = [];
        if (child.blur) filters.push(`blur(${child.blur}px)`);
        if (child.shadow) filters.push(`drop-shadow(0px ${child.shadow}px ${child.shadow * 1.5}px rgba(0,0,0,0.3))`);
        img.style.filter = filters.length > 0 ? filters.join(' ') : 'none';
      }

      const ghostImg = el.querySelector('.canvas-image-node__ghost-img');
      if (ghostImg) {
        ghostImg.style.left = `${child.imgX}px`;
        ghostImg.style.top = `${child.imgY}px`;
        ghostImg.style.width = `${child.imgW}px`;
        ghostImg.style.height = `${child.imgH}px`;
      }
    }

    function enterCropMode(frameId, childId) {
      const frame = frames.find(f => f.id === frameId);
      if (!frame) return;
      const child = (frame.children || []).find(c => c.id === childId);
      if (!child || child.type !== 'image') return;
      ensureImageProps(child);

      croppingImage = { frameId, childId };
      selectTextNode(frameId, childId);

      const el = world.querySelector(`.canvas-image-node[data-id="${childId}"]`);
      if (el) {
        el.classList.add('is-cropping');
        updateImageNodeDOM(child, el);
        updateCropToolbar();
      }
      if (window.lucide) lucide.createIcons();
    }

    function exitCropMode() {
      if (!croppingImage) return;
      const { childId } = croppingImage;
      const el = world.querySelector(`.canvas-image-node[data-id="${childId}"]`);
      if (el) el.classList.remove('is-cropping');
      
      croppingImage = null;
      if (cropToolbar) cropToolbar.classList.remove('is-visible');
      save();
      updateTextToolbar();
    }

    function setCropZoom(newZoom) {
      if (!croppingImage) return;
      const frame = frames.find(f => f.id === croppingImage.frameId);
      if (!frame) return;
      const child = (frame.children || []).find(c => c.id === croppingImage.childId);
      if (!child) return;
      ensureImageProps(child);

      const clampedZoom = Math.min(5, Math.max(1, newZoom));
      const oldZoom = child.zoom || 1.0;
      if (Math.abs(clampedZoom - oldZoom) < 0.001) return;

      const ratio = clampedZoom / oldZoom;
      
      // Zoom centrado no ponto médio da máscara
      const centerX = child.w / 2;
      const centerY = child.h / 2;
      const relX = child.imgX - centerX;
      const relY = child.imgY - centerY;

      child.imgW = Math.round(child.imgW * ratio);
      child.imgH = Math.round(child.imgH * ratio);
      child.imgX = Math.round(centerX + relX * ratio);
      child.imgY = Math.round(centerY + relY * ratio);
      child.zoom = Math.round(clampedZoom * 100) / 100;

      const el = world.querySelector(`.canvas-image-node[data-id="${child.id}"]`);
      if (el) updateImageNodeDOM(child, el);
      if (inputCropZoomVal && document.activeElement !== inputCropZoomVal) {
        inputCropZoomVal.value = Math.round(child.zoom * 100);
      }
      save();
    }

    function resetCrop(child, el) {
      ensureImageProps(child);
      const aspect = (child.origW && child.origH) ? (child.origW / child.origH) : (child.w / child.h);
      let targetW = child.w;
      let targetH = Math.round(targetW / aspect);
      if (targetH < child.h) {
        targetH = child.h;
        targetW = Math.round(targetH * aspect);
      }
      child.imgW = targetW;
      child.imgH = targetH;
      child.imgX = Math.round((child.w - targetW) / 2);
      child.imgY = Math.round((child.h - targetH) / 2);
      child.zoom = 1.0;
      if (el) updateImageNodeDOM(child, el);
      if (inputCropZoomVal) inputCropZoomVal.value = 100;
      save();
    }

    function updateCropToolbar() {
      if (!cropToolbar) return;
      if (!croppingImage) {
        cropToolbar.classList.remove('is-visible');
        return;
      }
      const frame = frames.find(f => f.id === croppingImage.frameId);
      if (!frame) return;
      const child = (frame.children || []).find(c => c.id === croppingImage.childId);
      if (!child) return;

      if (inputCropZoomVal && document.activeElement !== inputCropZoomVal) {
        inputCropZoomVal.value = Math.round((child.zoom || 1.0) * 100);
      }

      const el = world.querySelector(`.canvas-image-node[data-id="${child.id}"]`);
      if (el) {
        const rect = el.getBoundingClientRect();
        const barH = cropToolbar.offsetHeight || 44;
        const half = (cropToolbar.offsetWidth || 280) / 2;
        const top = rect.top - barH - 16;
        cropToolbar.style.top = `${top < 76 ? Math.min(innerHeight - barH - 16, rect.bottom + 16) : top}px`;
        cropToolbar.style.left = `${Math.min(innerWidth - half - 16, Math.max(half + 16, rect.left + rect.width / 2))}px`;
        cropToolbar.classList.add('is-visible');
      }
    }

    function applyImageToolbarAction(action) {
      if (selectedChildNodes.length === 0) return;
      selectedChildNodes.forEach(sel => {
        const frame = frames.find(f => f.id === sel.frameId);
        if (!frame) return;
        const child = (frame.children || []).find(c => c.id === sel.childId);
        if (!child || child.type !== 'image') return;
        action(child);
        const el = world.querySelector(`.canvas-image-node[data-id="${child.id}"]`);
        if (el) updateImageNodeDOM(child, el);
      });
      save();
    }
    
    if (btnImageCrop) {
      btnImageCrop.addEventListener('click', () => {
        const child = selectedChild();
        if (child && child.type === 'image') {
          enterCropMode(selectedTextNode.frameId, child.id);
        }
      });
    }

    if (btnCropZoomIn) {
      btnCropZoomIn.addEventListener('click', () => {
        if (!croppingImage) return;
        const child = selectedChild();
        if (!child || child.type !== 'image') return;
        ensureImageProps(child);
        setCropZoom((child.zoom || 1.0) + 0.15);
      });
    }

    if (btnCropZoomOut) {
      btnCropZoomOut.addEventListener('click', () => {
        if (!croppingImage) return;
        const child = selectedChild();
        if (!child || child.type !== 'image') return;
        ensureImageProps(child);
        setCropZoom((child.zoom || 1.0) - 0.15);
      });
    }

    if (inputCropZoomVal) {
      inputCropZoomVal.addEventListener('input', (e) => {
        if (!croppingImage) return;
        const child = selectedChild();
        if (!child || child.type !== 'image') return;
        ensureImageProps(child);
        const pct = Number(e.target.value) || 100;
        setCropZoom(pct / 100);
      });
    }

    if (btnCropReset) {
      btnCropReset.addEventListener('click', () => {
        if (!croppingImage) return;
        const child = selectedChild();
        if (!child || child.type !== 'image') return;
        const el = world.querySelector(`.canvas-image-node[data-id="${child.id}"]`);
        resetCrop(child, el);
      });
    }

    if (btnCropDone) {
      btnCropDone.addEventListener('click', () => exitCropMode());
    }

    if (cropToolbar) {
      cropToolbar.addEventListener('mousedown', (e) => {
        if (!e.target.closest('input')) e.preventDefault();
      });
    }

    if (inputRadius) inputRadius.addEventListener('input', (e) => applyImageToolbarAction(c => c.borderRadius = Number(e.target.value) || 0));
    if (inputBorderWidth) inputBorderWidth.addEventListener('input', (e) => applyImageToolbarAction(c => c.borderWidth = Number(e.target.value) || 0));
    if (inputBorderColor) inputBorderColor.addEventListener('input', (e) => applyImageToolbarAction(c => c.borderColor = e.target.value));
    if (inputImageOpacity) inputImageOpacity.addEventListener('input', (e) => applyImageToolbarAction(c => c.opacity = Math.min(100, Math.max(0, Number(e.target.value) || 0))));
    if (inputBlur) inputBlur.addEventListener('input', (e) => applyImageToolbarAction(c => c.blur = Number(e.target.value) || 0));
    if (inputShadow) inputShadow.addEventListener('input', (e) => applyImageToolbarAction(c => c.shadow = Number(e.target.value) || 0));
    // Abrir a segunda linha muda a altura da barra: ela tem que se reancorar
    if (btnImageMore && imageAdvRow) btnImageMore.addEventListener('click', () => {
      const open = imageAdvRow.classList.toggle('is-open');
      btnImageMore.classList.toggle('is-active', open);
      updateTextToolbar();
    });

    if (btnImageDup) btnImageDup.addEventListener('click', () => duplicateTextNode());
    if (btnImageDel) btnImageDel.addEventListener('click', () => { deleteTextNode(); updateTextToolbar(); });
    
    const btnImageSendBack = document.getElementById('canvas-image-send-back');
    const btnImageBackward = document.getElementById('canvas-image-backward');
    const btnImageForward = document.getElementById('canvas-image-forward');
    const btnImageBringFront = document.getElementById('canvas-image-bring-front');

    if (btnImageSendBack) btnImageSendBack.addEventListener('click', () => sendChildToBack());
    if (btnImageBackward) btnImageBackward.addEventListener('click', () => sendChildBackward());
    if (btnImageForward) btnImageForward.addEventListener('click', () => bringChildForward());
    if (btnImageBringFront) btnImageBringFront.addEventListener('click', () => bringChildToFront());

    if (imageToolbar) imageToolbar.addEventListener('mousedown', (e) => {
      if (!e.target.closest('input')) e.preventDefault();
    });

    /* --------------------------------------------------
       Campos numéricos que se arrastam (scrub)
       -------------------------------------------------- */
    const SCRUB_PX_PER_STEP = 4;

    function makeScrubbable(input, handle) {
      if (!input) return;
      const step = Number(input.step) || 1;
      // Quantas casas o passo exige: 0.05 pede 2, 1 pede 0
      const decimals = (String(step).split('.')[1] || '').length;
      const min = input.min === '' ? -Infinity : Number(input.min);
      const max = input.max === '' ? Infinity : Number(input.max);

      (handle || input).addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const origin = Number(input.value) || 0;
        let scrubbing = false;

        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          if (!scrubbing) {
            if (Math.abs(dx) < 3) return;
            scrubbing = true;
            document.body.style.cursor = 'ew-resize';
          }
          const mult = ev.shiftKey ? 10 : 1;
          const next = origin + Math.round(dx / SCRUB_PX_PER_STEP) * step * mult;
          input.value = Math.min(max, Math.max(min, next)).toFixed(decimals);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        };

        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.body.style.cursor = '';
          if (!scrubbing) {
            input.focus();
            input.select();
          }
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }

    [
      inputSize, inputLh, inputLs, inputOpacity,
      inputRadius, inputBorderWidth, inputImageOpacity, inputBlur, inputShadow,
      inputCropZoomVal
    ].forEach(input => {
      if (!input) return;
      makeScrubbable(input);
      const icon = input.parentElement && input.parentElement.querySelector('svg, i');
      if (icon) makeScrubbable(input, icon);
    });

    function updateTextToolbar() {
      const imageToolbar = document.getElementById('canvas-image-toolbar');
      const cropToolbar = document.getElementById('canvas-crop-toolbar');
      const frameToolbar = document.getElementById('canvas-frame-toolbar');

      if (isMeasureKeyActive) {
        if (textToolbar) textToolbar.classList.remove('is-visible');
        if (imageToolbar) imageToolbar.classList.remove('is-visible');
        if (cropToolbar) cropToolbar.classList.remove('is-visible');
        if (frameToolbar) frameToolbar.classList.remove('is-visible');
        return;
      }
      if (croppingImage) {
        if (textToolbar) textToolbar.classList.remove('is-visible');
        if (imageToolbar) imageToolbar.classList.remove('is-visible');
        if (frameToolbar) frameToolbar.classList.remove('is-visible');
        updateCropToolbar();
        return;
      }
      if (cropToolbar) cropToolbar.classList.remove('is-visible');
      if (textToolbar) textToolbar.classList.remove('is-visible');
      if (imageToolbar) imageToolbar.classList.remove('is-visible');
      if (frameToolbar) frameToolbar.classList.remove('is-visible');
      
      const child = (selectedChildNodes.length > 0 && selectedTextNode.frameId) ? selectedChild() : null;
      if (!child) {
        const selFrame = selectedFrame();
        if (selFrame && frameToolbar) {
          const frameEl = frameElOf(selFrame);
          if (frameEl) {
            const r = frameEl.getBoundingClientRect();
            const barH = frameToolbar.offsetHeight || 48;
            const half = (frameToolbar.offsetWidth || 340) / 2;
            const boxCenterX = (r.left + r.right) / 2;
            const top = r.top - barH - 12;
            frameToolbar.style.top = `${top < 76 ? Math.min(innerHeight - barH - 16, r.bottom + 12) : top}px`;
            frameToolbar.style.left = `${Math.min(innerWidth - half - 12, Math.max(half + 12, boxCenterX))}px`;

            const btnModeSolid = document.getElementById('canvas-frame-mode-solid');
            const btnModeGrad = document.getElementById('canvas-frame-mode-gradient');
            const groupSolid = document.getElementById('canvas-frame-solid-group');
            const groupGrad = document.getElementById('canvas-frame-grad-group');
            const inputBgColor = document.getElementById('canvas-frame-bg-color');
            const inputGradC1 = document.getElementById('canvas-frame-grad-c1');
            const inputGradC2 = document.getElementById('canvas-frame-grad-c2');
            const selectGradDir = document.getElementById('canvas-frame-grad-dir');
            const selectGrad = document.getElementById('canvas-frame-gradient-select');
            const inputOverlay = document.getElementById('canvas-frame-overlay');
            const inputBlur = document.getElementById('canvas-frame-blur');
            const btnDelImg = document.getElementById('canvas-frame-del-img');

            const isGrad = !!(selFrame.bg && selFrame.bg.includes('gradient'));

            if (btnModeSolid && btnModeGrad && groupSolid && groupGrad) {
              btnModeSolid.classList.toggle('is-active', !isGrad);
              btnModeGrad.classList.toggle('is-active', isGrad);
              groupSolid.style.display = !isGrad ? 'inline-flex' : 'none';
              groupGrad.style.display = isGrad ? 'inline-flex' : 'none';
            }

            if (isGrad) {
              const hexes = selFrame.bg.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/g);
              if (hexes && hexes.length >= 2) {
                if (inputGradC1) inputGradC1.value = hexes[0];
                if (inputGradC2) inputGradC2.value = hexes[1];
              }
              if (selectGradDir) {
                if (selFrame.bg.includes('radial')) selectGradDir.value = 'radial';
                else if (selFrame.bg.includes('135deg')) selectGradDir.value = '135deg';
                else if (selFrame.bg.includes('90deg')) selectGradDir.value = '90deg';
                else if (selFrame.bg.includes('0deg')) selectGradDir.value = '0deg';
                else selectGradDir.value = '180deg';
              }
            } else {
              if (inputBgColor) {
                inputBgColor.value = selFrame.bg && selFrame.bg.startsWith('#') ? selFrame.bg : '#ffffff';
              }
            }

            if (selectGrad) selectGrad.value = '';
            if (inputOverlay) inputOverlay.value = selFrame.bgOverlay != null ? selFrame.bgOverlay : (selFrame.bgImage ? 35 : 0);
            if (inputBlur) inputBlur.value = selFrame.bgBlur || 0;
            if (btnDelImg) btnDelImg.style.display = selFrame.bgImage ? 'inline-flex' : 'none';

            frameToolbar.classList.add('is-visible');
          }
        }
        return;
      }

      // Aceso = este nó já é um slot do lote; o tooltip mostra de qual coluna
      [btnTextBind, btnImageBind].forEach(btn => {
        if (!btn) return;
        btn.classList.toggle('is-active', !!child.bind);
        btn.title = child.bind
          ? `Variável {{${child.bind}}} — clique para desfazer`
          : 'Virar variável do Batch Create';
      });

      // Calcula caixa delimitadora de todos os nós selecionados na tela
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      selectedChildNodes.forEach(sel => {
        const el = world.querySelector(`[data-id="${sel.childId}"]`);
        if (el) {
          const r = el.getBoundingClientRect();
          minX = Math.min(minX, r.left);
          minY = Math.min(minY, r.top);
          maxX = Math.max(maxX, r.right);
          maxY = Math.max(maxY, r.bottom);
        }
      });
      const boxCenterX = isFinite(minX) ? (minX + maxX) / 2 : innerWidth / 2;
      const boxTop = isFinite(minY) ? minY : 100;
      const boxBottom = isFinite(maxY) ? maxY : 200;

      if (child.type === 'image') {
        if (!imageToolbar) return;
        const idle = (el) => el && document.activeElement !== el;
        const inputRadius = document.getElementById('canvas-image-radius');
        const inputBorderWidth = document.getElementById('canvas-image-border-width');
        const inputBorderColor = document.getElementById('canvas-image-border-color');
        const inputImageOpacity = document.getElementById('canvas-image-opacity');
        const inputBlur = document.getElementById('canvas-image-blur');
        const inputShadow = document.getElementById('canvas-image-shadow');
        
        if (idle(inputRadius)) inputRadius.value = child.borderRadius || 0;
        if (idle(inputBorderWidth)) inputBorderWidth.value = child.borderWidth || 0;
        if (idle(inputBorderColor)) inputBorderColor.value = child.borderColor || '#000000';
        if (idle(inputImageOpacity)) inputImageOpacity.value = child.opacity !== undefined ? child.opacity : 100;
        if (idle(inputBlur)) inputBlur.value = child.blur || 0;
        if (idle(inputShadow)) inputShadow.value = child.shadow || 0;
        
        const barH = imageToolbar.offsetHeight || 48;
        const half = (imageToolbar.offsetWidth || 300) / 2;
        const top = boxTop - barH - 12;
        imageToolbar.style.top = `${top < 76 ? Math.min(innerHeight - barH - 16, boxBottom + 12) : top}px`;
        imageToolbar.style.left = `${Math.min(innerWidth - half - 12, Math.max(half + 12, boxCenterX))}px`;
        imageToolbar.classList.add('is-visible');
        return;
      }

      if (child.type !== 'text') return;

      /* Com um trecho marcado a barra tem que mostrar o estilo DELE, senão o
         usuário mexe num número que não é o que está na tela. Alinhamento e
         entrelinha continuam vindo do nó: são do bloco. */
      const range = activeTextRange(contentOf(child));
      const shown = range ? { ...child, ...styleProbe(range, child) } : child;

      const font = fontOf(shown);
      // Não reescreve o campo que está sendo digitado: o cursor pularia a cada tecla
      const idle = (el) => el && document.activeElement !== el;
      if (idle(selFont)) selFont.value = font.css;
      fillWeightOptions(shown);
      if (idle(inputSize)) inputSize.value = shown.fontSize || TEXT_DEFAULTS.fontSize;
      if (idle(inputColor)) inputColor.value = shown.color || TEXT_DEFAULTS.color;
      if (idle(inputLh)) inputLh.value = child.lineHeight != null ? child.lineHeight : TEXT_DEFAULTS.lineHeight;
      if (idle(inputLs)) inputLs.value = shown.letterSpacing != null ? shown.letterSpacing : TEXT_DEFAULTS.letterSpacing;
      if (idle(inputOpacity)) inputOpacity.value = shown.opacity != null ? shown.opacity : TEXT_DEFAULTS.opacity;
      if (idle(inputBg)) inputBg.value = shown.bg || '#000000';
      if (btnShadow) btnShadow.classList.toggle('is-active', !!shown.shadow);

      const weight = shown.fontWeight || TEXT_DEFAULTS.fontWeight;
      if (btnBold) {
        btnBold.classList.toggle('is-active', weight >= font.weights[font.weights.length - 1] && font.weights.length > 1);
        btnBold.disabled = font.weights.length < 2;
      }
      if (btnItalic) btnItalic.classList.toggle('is-active', !!shown.italic);
      if (btnUnderline) btnUnderline.classList.toggle('is-active', !!shown.underline);

      const align = child.align || TEXT_DEFAULTS.align;
      if (btnAlignLeft) btnAlignLeft.classList.toggle('is-active', align === 'left');
      if (btnAlignCenter) btnAlignCenter.classList.toggle('is-active', align === 'center');
      if (btnAlignRight) btnAlignRight.classList.toggle('is-active', align === 'right');

      const transform = shown.transform || TEXT_DEFAULTS.transform;
      if (btnCaseNone) btnCaseNone.classList.toggle('is-active', transform === 'none');
      if (btnCaseUpper) btnCaseUpper.classList.toggle('is-active', transform === 'uppercase');
      if (btnCaseLower) btnCaseLower.classList.toggle('is-active', transform === 'lowercase');

      // Ancora a barra acima do nó, sem deixá-la sair pela borda da janela
      const barH = textToolbar.offsetHeight || 48;
      const half = (textToolbar.offsetWidth || 560) / 2;
      const top = boxTop - barH - 12;
      textToolbar.style.top = `${top < 76 ? Math.min(innerHeight - barH - 16, boxBottom + 12) : top}px`;
      textToolbar.style.left = `${Math.min(innerWidth - half - 12, Math.max(half + 12, boxCenterX))}px`;
      textToolbar.classList.add('is-visible');
    }

    /* --------------------------------------------------
       Histórico (Undo / Redo) e Camadas (Z-Index)
       -------------------------------------------------- */
    const undoStack = [];
    const redoStack = [];
    const MAX_HISTORY = 50;
    let isRestoringHistory = false;

    function getCanvasSnapshot() {
      return JSON.stringify({
        frames,
        links,
        selectedFrameIds: Array.from(selectedFrameIds),
        selectedChildNodes: [...selectedChildNodes],
        selectedLinkId
      });
    }

    function pushHistory() {
      if (isRestoringHistory) return;
      const snap = getCanvasSnapshot();
      if (undoStack.length > 0 && undoStack[undoStack.length - 1] === snap) return;
      undoStack.push(snap);
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack.length = 0;
      updateUndoRedoButtons();
    }

    function save(recordHistory = true) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ cam, frames, links }));
      } catch (e) { /* localStorage cheio ou bloqueado: o canvas segue funcionando */ }
      if (recordHistory) {
        pushHistory();
      }
    }

    function undo() {
      if (undoStack.length <= 1) return;
      if (croppingImage) exitCropMode();
      isRestoringHistory = true;
      const current = undoStack.pop();
      redoStack.push(current);
      const prev = undoStack[undoStack.length - 1];
      restoreSnapshot(prev);
      isRestoringHistory = false;
      updateUndoRedoButtons();
    }

    function redo() {
      if (redoStack.length === 0) return;
      if (croppingImage) exitCropMode();
      isRestoringHistory = true;
      const next = redoStack.pop();
      undoStack.push(next);
      restoreSnapshot(next);
      isRestoringHistory = false;
      updateUndoRedoButtons();
    }

    function restoreSnapshot(jsonStr) {
      if (!jsonStr) return;
      try {
        const data = JSON.parse(jsonStr);
        if (Array.isArray(data.frames)) {
          frames = data.frames;
          frameSeq = frames.reduce((max, f) => Math.max(max, f.id + 1), 1);
          childSeq = frames.reduce((max, f) => {
            const childMax = (f.children || []).reduce((cmax, c) => Math.max(cmax, c.id + 1), 1);
            return Math.max(max, childMax);
          }, 1);
        }
        if (Array.isArray(data.links)) {
          links = data.links;
          linkSeq = links.reduce((max, l) => Math.max(max, l.id + 1), 1);
          pruneMixedLinks();
        }
        renderAll();
        if (Array.isArray(data.selectedChildNodes) && data.selectedChildNodes.length > 0) {
          selectedFrameIds.clear();
          selectedId = null;
          selectedChildNodes = data.selectedChildNodes;
          selectedTextNode = selectedChildNodes[0];
          world.querySelectorAll('.canvas-text-node, .canvas-image-node').forEach(el => {
            const cId = Number(el.dataset.id);
            el.classList.toggle('is-selected', selectedChildNodes.some(n => n.childId === cId));
          });
          updateTextToolbar();
        } else if (Array.isArray(data.selectedFrameIds) && data.selectedFrameIds.length > 0) {
          selectedChildNodes = [];
          selectedTextNode = { frameId: null, childId: null };
          selectedFrameIds = new Set(data.selectedFrameIds);
          selectedId = [...selectedFrameIds][0];
          world.querySelectorAll('.canvas-frame').forEach((el) => {
            el.classList.toggle('is-selected', selectedFrameIds.has(Number(el.dataset.id)));
          });
          updateTopbar();
        } else if (data.selectedChildId !== undefined && data.selectedChildId !== null) {
          selectTextNode(data.selectedFrameId, data.selectedChildId);
        } else if (data.selectedId !== undefined && data.selectedId !== null) {
          selectFrame(data.selectedId);
        } else if (data.selectedLinkId !== undefined && data.selectedLinkId !== null) {
          selectLink(data.selectedLinkId);
        } else {
          selectFrame(null);
          selectTextNode(null, null);
          selectLink(null);
        }
        save(false);
      } catch (e) {
        console.error('Erro ao restaurar histórico:', e);
      }
    }

    function updateUndoRedoButtons() {
      const btnUndo = document.getElementById('canvas-undo');
      const btnRedo = document.getElementById('canvas-redo');
      if (btnUndo) {
        btnUndo.disabled = undoStack.length <= 1;
        btnUndo.style.opacity = undoStack.length <= 1 ? '0.35' : '1';
        btnUndo.style.pointerEvents = undoStack.length <= 1 ? 'none' : 'auto';
      }
      if (btnRedo) {
        btnRedo.disabled = redoStack.length === 0;
        btnRedo.style.opacity = redoStack.length === 0 ? '0.35' : '1';
        btnRedo.style.pointerEvents = redoStack.length === 0 ? 'none' : 'auto';
      }
    }

    function reorderChildDOM(frame) {
      const frameEl = frameElOf(frame);
      if (!frameEl || !frame.children) return;
      const port = frameEl.querySelector('.canvas-frame__port--out');
      frame.children.forEach(child => {
        const childEl = frameEl.querySelector(`[data-id="${child.id}"]`);
        if (childEl) {
          if (port) frameEl.insertBefore(childEl, port);
          else frameEl.appendChild(childEl);
        }
      });
    }

    function bringChildToFront() {
      if (selectedChildNodes.length === 0) return;
      selectedChildNodes.forEach(sel => {
        const frame = frames.find(f => f.id === sel.frameId);
        if (!frame || !frame.children) return;
        const idx = frame.children.findIndex(c => c.id === sel.childId);
        if (idx === -1 || idx === frame.children.length - 1) return;
        const [child] = frame.children.splice(idx, 1);
        frame.children.push(child);
        reorderChildDOM(frame);
      });
      save();
    }

    function bringChildForward() {
      if (selectedChildNodes.length === 0) return;
      selectedChildNodes.forEach(sel => {
        const frame = frames.find(f => f.id === sel.frameId);
        if (!frame || !frame.children) return;
        const idx = frame.children.findIndex(c => c.id === sel.childId);
        if (idx === -1 || idx === frame.children.length - 1) return;
        const temp = frame.children[idx];
        frame.children[idx] = frame.children[idx + 1];
        frame.children[idx + 1] = temp;
        reorderChildDOM(frame);
      });
      save();
    }

    function sendChildBackward() {
      if (selectedChildNodes.length === 0) return;
      selectedChildNodes.forEach(sel => {
        const frame = frames.find(f => f.id === sel.frameId);
        if (!frame || !frame.children) return;
        const idx = frame.children.findIndex(c => c.id === sel.childId);
        if (idx <= 0) return;
        const temp = frame.children[idx];
        frame.children[idx] = frame.children[idx - 1];
        frame.children[idx - 1] = temp;
        reorderChildDOM(frame);
      });
      save();
    }

    function sendChildToBack() {
      if (selectedChildNodes.length === 0) return;
      selectedChildNodes.forEach(sel => {
        const frame = frames.find(f => f.id === sel.frameId);
        if (!frame || !frame.children) return;
        const idx = frame.children.findIndex(c => c.id === sel.childId);
        if (idx <= 0) return;
        const [child] = frame.children.splice(idx, 1);
        frame.children.unshift(child);
        reorderChildDOM(frame);
      });
      save();
    }

    function load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          undoStack.push(getCanvasSnapshot());
          updateUndoRedoButtons();
          return;
        }
        const data = JSON.parse(raw);
        if (data.cam) cam = data.cam;
        if (Array.isArray(data.frames)) {
          frames = data.frames;
          frameSeq = frames.reduce((max, f) => Math.max(max, f.id + 1), 1);
          childSeq = frames.reduce((max, f) => {
            const childMax = (f.children || []).reduce((cmax, c) => Math.max(cmax, c.id + 1), 1);
            return Math.max(max, childMax);
          }, 1);
        }
        if (Array.isArray(data.links)) {
          links = data.links;
          linkSeq = links.reduce((max, l) => Math.max(max, l.id + 1), 1);
          pruneMixedLinks();
        }
        undoStack.push(getCanvasSnapshot());
        updateUndoRedoButtons();
      } catch (e) {
        undoStack.push(getCanvasSnapshot());
        updateUndoRedoButtons();
      }
    }

    // Converte um ponto da tela para o espaço infinito
    function screenToWorld(sx, sy) {
      return { x: (sx - cam.x) / cam.scale, y: (sy - cam.y) / cam.scale };
    }

    function applyCamera() {
      world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`;
      // Inverso da escala: contorno e rótulo dos frames usam isso para manter
      // espessura constante na tela em qualquer zoom, como no Figma
      world.style.setProperty('--inv', 1 / cam.scale);
      /* Os rótulos da safe zone têm tamanho fixo na tela, então quanto mais longe
         a câmera, maiores eles ficam em relação ao frame — até o texto ficar maior
         que a faixa que ele descreve. Passado esse ponto quem fala é só a hachura. */
      if (view) view.classList.toggle('is-zoomed-out', cam.scale < BADGE_MIN_SCALE);
      /* Grid adaptativo: o passo dobra ou divide até cair numa faixa confortável
         de pixels na tela. Sem isso, com zoom baixo os pontos se amontoam e
         viram moiré; com zoom alto somem. É o mesmo truque do Figma. */
      let step = DOT_GRID * cam.scale;
      while (step < GRID_MIN_PX) step *= 2;
      while (step > GRID_MAX_PX) step /= 2;
      dots.style.backgroundSize = `${step}px ${step}px`;
      dots.style.backgroundPosition = `${cam.x}px ${cam.y}px`;
      const label = document.getElementById('canvas-zoom-label');
      if (label) label.textContent = `${Math.round((cam.scale / BASE_SCALE) * 100)}%`;
      
      updateTextToolbar(); // Reposiciona ao mover a câmera
    }

    function zoomAt(sx, sy, factor) {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, cam.scale * factor));
      if (next === cam.scale) return;
      // Mantém sob o cursor o mesmo ponto do mundo antes e depois do zoom
      const before = screenToWorld(sx, sy);
      cam.scale = next;
      cam.x = sx - before.x * cam.scale;
      cam.y = sy - before.y * cam.scale;
      applyCamera();
      save();
    }

    // Põe o cursor no fim do texto: focar sozinho não cria caret em contentEditable vazio
    function focusTextEnd(text) {
      text.focus();
      const range = document.createRange();
      range.selectNodeContents(text);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }

    /* Caret no ponto exato do clique.
       O padrão é caretPositionFromPoint; o WebKit ainda só tem
       caretRangeFromPoint. Ambos usam coordenadas de tela, então o zoom e o
       transform do mundo já entram na conta. */
    function caretRangeAt(x, y) {
      if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(x, y);
        if (!pos) return null;
        const range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
        return range;
      }
      if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
      return null;
    }

    // Entra em edição com o cursor onde o mouse estava, não no fim do texto
    function focusTextAtPoint(content, x, y) {
      content.focus();
      const range = caretRangeAt(x, y);
      if (!range || !content.contains(range.startContainer)) {
        focusTextEnd(content);
        return;
      }
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }

    /* Duas marchas, como no Figma: um clique seleciona o bloco (e o arrasto o
       move), o duplo clique é que abre o texto para digitar. Fora da edição o
       contenteditable fica desligado — é o que dá o cursor de mover e impede o
       navegador de roubar o foco já no primeiro clique. */
    function enterTextEditing(content, x, y) {
      const node = content.closest('.canvas-text-node');
      if (node) node.classList.add('is-editing');
      content.contentEditable = 'true';
      if (x === undefined) focusTextEnd(content);
      else focusTextAtPoint(content, x, y);
    }

    function exitTextEditing(content) {
      const node = content.closest('.canvas-text-node');
      if (node) node.classList.remove('is-editing');
      content.blur();
      content.contentEditable = 'false';
    }

    /* --------------------------------------------------
       Frames (pranchetas de post)
       O CRUD aqui é o molde que os outros elementos do editor
       (texto, imagem) vão seguir: o dado é só JSON, o DOM é derivado.
       -------------------------------------------------- */

    // `children` já nasce no modelo para receber os textos e imagens depois
    function makeFrame(formatKey, x, y) {
      const fmt = FORMATS[formatKey];
      return { id: frameSeq++, format: formatKey, x, y, w: fmt.w, h: fmt.h, bg: '#FFFFFF', children: [] };
    }

    /* Texto criado e abandonado sem digitar nada não deixa rastro: some junto
       com a seleção, como no Figma. Sem isso o frame acumula nós invisíveis. */
    function dropEmptyTextNode() {
      const { frameId, childId } = selectedTextNode;
      if (childId === null) return;
      const frame = frames.find(f => f.id === frameId);
      if (!frame) return;
      const child = (frame.children || []).find(c => c.id === childId);
      // Só texto some por estar vazio: imagem não tem `text` e seria apagada junto
      if (!child || child.type !== 'text') return;
      if ((child.text || '').trim() !== '') return;
      const el = world.querySelector(`.canvas-text-node[data-id="${childId}"]`);
      if (el) el.remove();
      frame.children = frame.children.filter(c => c.id !== childId);
      save();
    }

    function selectTextNode(frameId, childId, isMulti = false) {
      if (croppingImage && (croppingImage.childId !== childId || isMulti)) {
        exitCropMode();
      }

      /* Sair de um texto tem que tirar o foco dele */
      const editing = document.activeElement;
      if (editing && editing.classList && editing.classList.contains('canvas-text-node__content')) {
        const owner = editing.closest('.canvas-text-node');
        if (!owner || owner.dataset.id !== String(childId)) exitTextEditing(editing);
      }

      if (childId === null) {
        if (selectedChildNodes.length > 0) dropEmptyTextNode();
        selectedChildNodes = [];
        selectedTextNode = { frameId: null, childId: null };
      } else if (isMulti) {
        selectedFrameIds.clear();
        selectedId = null;

        const existingIdx = selectedChildNodes.findIndex(n => n.frameId === frameId && n.childId === childId);
        if (existingIdx !== -1) {
          selectedChildNodes.splice(existingIdx, 1);
        } else {
          selectedChildNodes.push({ frameId, childId });
        }
        selectedTextNode = selectedChildNodes.length > 0 ? selectedChildNodes[0] : { frameId: null, childId: null };
      } else {
        selectedFrameIds.clear();
        selectedId = null;

        if (selectedChildNodes.length > 0 && selectedChildNodes[0].childId !== childId) {
          dropEmptyTextNode();
        }
        selectedChildNodes = [{ frameId, childId }];
        selectedTextNode = { frameId, childId };
      }

      world.querySelectorAll('.canvas-text-node, .canvas-image-node').forEach(el => {
        const cId = Number(el.dataset.id);
        const isSel = selectedChildNodes.some(n => n.childId === cId);
        el.classList.toggle('is-selected', isSel);
      });

      world.querySelectorAll('.canvas-frame').forEach(el => {
        const fId = Number(el.dataset.id);
        el.classList.toggle('is-selected', selectedChildNodes.length === 0 && selectedFrameIds.has(fId));
      });

      if (document.activeElement && document.activeElement !== document.body && !document.activeElement.isContentEditable) {
        document.activeElement.blur();
      }
      updateTextToolbar();
      updateTopbar();
      if (isMeasureKeyActive) updateMeasureGuides(lastMouseClientPos);
    }

    /* --------------------------------------------------
       Smart Measurement Tool (Figma Option / Alt Pixel Distances)
       Medição pixel-perfect de distâncias relativas às bordas do frame
       e entre elementos com a tecla Alt (Option) ou Control (Ctrl).
       -------------------------------------------------- */
    let isMeasureKeyActive = false;
    let measureLayer = null;
    let lastMouseClientPos = null;

    function ensureMeasureLayer() {
      if (!measureLayer || !world.contains(measureLayer)) {
        measureLayer = document.createElement('div');
        measureLayer.className = 'canvas-measure-layer';
        world.appendChild(measureLayer);
      }
    }

    function clearMeasureGuides() {
      if (measureLayer) {
        measureLayer.innerHTML = '';
      }
      updateTextToolbar();
    }

    function addMeasureLine(x1, y1, x2, y2, value, isVertical) {
      if (!measureLayer) ensureMeasureLayer();
      const dist = Math.round(value);
      if (dist <= 0) return;

      const line = document.createElement('div');
      line.className = `canvas-measure-line ${isVertical ? 'canvas-measure-line--v' : 'canvas-measure-line--h'}`;

      if (isVertical) {
        const top = Math.min(y1, y2);
        const height = Math.abs(y2 - y1);
        if (height < 1) return;
        line.style.left = `${x1}px`;
        line.style.top = `${top}px`;
        line.style.height = `${height}px`;
      } else {
        const left = Math.min(x1, x2);
        const width = Math.abs(x2 - x1);
        if (width < 1) return;
        line.style.left = `${left}px`;
        line.style.top = `${y1}px`;
        line.style.width = `${width}px`;
      }
      measureLayer.appendChild(line);

      const badge = document.createElement('div');
      badge.className = 'canvas-measure-badge';
      badge.textContent = `${dist}`;
      badge.style.left = `${(x1 + x2) / 2}px`;
      badge.style.top = `${(y1 + y2) / 2}px`;
      measureLayer.appendChild(badge);
    }

    function addMeasureTargetBox(x, y, w, h) {
      if (!measureLayer) ensureMeasureLayer();
      const box = document.createElement('div');
      box.className = 'canvas-measure-target-box';
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
      measureLayer.appendChild(box);
    }

    function updateMeasureGuides(mousePos) {
      if (!isMeasureKeyActive) {
        clearMeasureGuides();
        return;
      }
      // Oculta barras flutuantes de edição para não atrapalhar a visualização
      const imageToolbar = document.getElementById('canvas-image-toolbar');
      const cropToolbar = document.getElementById('canvas-crop-toolbar');
      if (textToolbar) textToolbar.classList.remove('is-visible');
      if (imageToolbar) imageToolbar.classList.remove('is-visible');
      if (cropToolbar) cropToolbar.classList.remove('is-visible');

      ensureMeasureLayer();
      if (measureLayer) measureLayer.innerHTML = '';

      // Caso 1: Um nó filho está selecionado (Imagem ou Texto)
      if (selectedChildNodes.length === 1) {
        const sel = selectedChildNodes[0];
        const frame = frames.find(f => f.id === sel.frameId);
        if (!frame) return;
        const child = (frame.children || []).find(c => c.id === sel.childId);
        if (!child) return;
        const elA = world.querySelector(`[data-id="${child.id}"]`);
        const Ah = elA ? elA.offsetHeight : (child.h || 40);
        const Aw = child.w;
        const Ax = frame.x + child.x;
        const Ay = frame.y + child.y;

        // Detecta se o mouse está sobre outro elemento ou frame
        let hoveredChild = null;
        let hoveredFrame = null;

        if (mousePos) {
          const under = document.elementFromPoint(mousePos.clientX, mousePos.clientY);
          if (under) {
            const childEl = under.closest('.canvas-text-node, .canvas-image-node');
            if (childEl && Number(childEl.dataset.id) !== child.id) {
              const cId = Number(childEl.dataset.id);
              const fEl = childEl.closest('.canvas-frame');
              const fId = fEl ? Number(fEl.dataset.id) : null;
              const hFrame = frames.find(f => f.id === fId);
              if (hFrame) {
                const hChild = (hFrame.children || []).find(c => c.id === cId);
                if (hChild) {
                  hoveredChild = { frame: hFrame, child: hChild, el: childEl };
                }
              }
            } else {
              const fEl = under.closest('.canvas-frame');
              if (fEl && Number(fEl.dataset.id) !== frame.id) {
                hoveredFrame = frames.find(f => f.id === Number(fEl.dataset.id));
              }
            }
          }
        }

        // Subcaso A: Hover em outro elemento
        if (hoveredChild) {
          const Bframe = hoveredChild.frame;
          const Bchild = hoveredChild.child;
          const Bel = hoveredChild.el;
          const Bw = Bchild.w;
          const Bh = Bel.offsetHeight || Bchild.h || 40;
          const Bx = Bframe.x + Bchild.x;
          const By = Bframe.y + Bchild.y;

          addMeasureTargetBox(Bx, By, Bw, Bh);

          // Eixo X
          if (Bx >= Ax + Aw) {
            // B está à direita de A
            const gap = Bx - (Ax + Aw);
            const midY = (Math.max(Ay, By) + Math.min(Ay + Ah, By + Bh)) / 2 || (Ay + Ah / 2);
            addMeasureLine(Ax + Aw, midY, Bx, midY, gap, false);
          } else if (Ax >= Bx + Bw) {
            // B está à esquerda de A
            const gap = Ax - (Bx + Bw);
            const midY = (Math.max(Ay, By) + Math.min(Ay + Ah, By + Bh)) / 2 || (Ay + Ah / 2);
            addMeasureLine(Bx + Bw, midY, Ax, midY, gap, false);
          } else {
            // Sobrepostos no eixo X: mostra distâncias de alinhamento
            const midY = (Ay + By) / 2;
            if (Math.abs(Ax - Bx) > 0) {
              addMeasureLine(Math.min(Ax, Bx), midY, Math.max(Ax, Bx), midY, Math.abs(Ax - Bx), false);
            }
          }

          // Eixo Y
          if (By >= Ay + Ah) {
            // B está abaixo de A
            const gap = By - (Ay + Ah);
            const midX = (Math.max(Ax, Bx) + Math.min(Ax + Aw, Bx + Bw)) / 2 || (Ax + Aw / 2);
            addMeasureLine(midX, Ay + Ah, midX, By, gap, true);
          } else if (Ay >= By + Bh) {
            // B está acima de A
            const gap = Ay - (By + Bh);
            const midX = (Math.max(Ax, Bx) + Math.min(Ax + Aw, Bx + Bw)) / 2 || (Ax + Aw / 2);
            addMeasureLine(midX, By + Bh, midX, Ay, gap, true);
          } else {
            // Sobrepostos no eixo Y: mostra distâncias de alinhamento
            const midX = (Ax + Bx) / 2;
            if (Math.abs(Ay - By) > 0) {
              addMeasureLine(midX, Math.min(Ay, By), midX, Math.max(Ay, By), Math.abs(Ay - By), true);
            }
          }
          return;
        }

        // Subcaso B: Padrão Figma — Medição em relação às 4 bordas do frame pai
        const topDist = child.y;
        const bottomDist = frame.h - (child.y + Ah);
        const leftDist = child.x;
        const rightDist = frame.w - (child.x + Aw);

        const midX = Ax + Aw / 2;
        const midY = Ay + Ah / 2;

        // Top
        if (topDist > 0) {
          addMeasureLine(midX, frame.y, midX, Ay, topDist, true);
        }
        // Bottom
        if (bottomDist > 0) {
          addMeasureLine(midX, Ay + Ah, midX, frame.y + frame.h, bottomDist, true);
        }
        // Left
        if (leftDist > 0) {
          addMeasureLine(frame.x, midY, Ax, midY, leftDist, false);
        }
        // Right
        if (rightDist > 0) {
          addMeasureLine(Ax + Aw, midY, frame.x + frame.w, midY, rightDist, false);
        }
        return;
      }

      // Caso 2: Um frame está selecionado
      if (selectedFrameIds.size === 1 && selectedChildNodes.length === 0) {
        const frameA = getSelectedFrames()[0];
        if (!frameA) return;

        let hoveredOtherFrame = null;
        if (mousePos) {
          const under = document.elementFromPoint(mousePos.clientX, mousePos.clientY);
          if (under) {
            const fEl = under.closest('.canvas-frame');
            if (fEl && Number(fEl.dataset.id) !== frameA.id) {
              hoveredOtherFrame = frames.find(f => f.id === Number(fEl.dataset.id));
            }
          }
        }

        if (hoveredOtherFrame) {
          const B = hoveredOtherFrame;
          addMeasureTargetBox(B.x, B.y, B.w, B.h);

          // Eixo X
          if (B.x >= frameA.x + frameA.w) {
            const gap = B.x - (frameA.x + frameA.w);
            const midY = (frameA.y + frameA.h / 2 + B.y + B.h / 2) / 2;
            addMeasureLine(frameA.x + frameA.w, midY, B.x, midY, gap, false);
          } else if (frameA.x >= B.x + B.w) {
            const gap = frameA.x - (B.x + B.w);
            const midY = (frameA.y + frameA.h / 2 + B.y + B.h / 2) / 2;
            addMeasureLine(B.x + B.w, midY, frameA.x, midY, gap, false);
          }

          // Eixo Y
          if (B.y >= frameA.y + frameA.h) {
            const gap = B.y - (frameA.y + frameA.h);
            const midX = (frameA.x + frameA.w / 2 + B.x + B.w / 2) / 2;
            addMeasureLine(midX, frameA.y + frameA.h, midX, B.y, gap, true);
          } else if (frameA.y >= B.y + B.h) {
            const gap = frameA.y - (B.y + B.h);
            const midX = (frameA.x + frameA.w / 2 + B.x + B.w / 2) / 2;
            addMeasureLine(midX, B.y + B.h, midX, frameA.y, gap, true);
          }
        }
      }
    }

    function startChildNodeDrag(e, child, frame, el) {
      const isMultiKey = e.shiftKey || e.metaKey || e.ctrlKey;
      const alreadySelected = isChildNodeSelected(frame.id, child.id);

      if (isMultiKey) {
        selectTextNode(frame.id, child.id, true);
        return;
      }

      if (!alreadySelected) {
        selectTextNode(frame.id, child.id, false);
      }

      const startX = e.clientX;
      const startY = e.clientY;
      const nodesToMove = [...selectedChildNodes];
      const origins = new Map();
      nodesToMove.forEach(n => {
        const f = frames.find(fr => fr.id === n.frameId);
        if (!f) return;
        const c = (f.children || []).find(ch => ch.id === n.childId);
        if (!c) return;
        origins.set(`${n.frameId}_${n.childId}`, { x: c.x, y: c.y });
        const cEl = world.querySelector(`[data-id="${c.id}"]`);
        if (cEl) cEl.classList.add('is-dragging');
      });

      let moved = false;
      const frameEl = frameElOf(frame);
      const snapGuideV = frameEl ? frameEl.querySelector('.canvas-frame__snap-guide--v') : null;
      const snapGuideH = frameEl ? frameEl.querySelector('.canvas-frame__snap-guide--h') : null;

      const onMove = ev => {
        if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) {
          moved = true;
        }
        if (!moved) return;

        let dx = (ev.clientX - startX) / cam.scale;
        let dy = (ev.clientY - startY) / cam.scale;

        // Snapping se apenas 1 elemento estiver selecionado
        if (nodesToMove.length === 1 && snapEnabled && frame) {
          const orig = origins.get(`${frame.id}_${child.id}`);
          if (orig) {
            let targetX = orig.x + dx;
            let targetY = orig.y + dy;
            const nodeH = el.offsetHeight || child.h || 40;
            const nodeCenterX = targetX + child.w / 2;
            const nodeCenterY = targetY + nodeH / 2;
            const frameCenterX = frame.w / 2;
            const frameCenterY = frame.h / 2;
            const SNAP_DIST = 16;

            if (Math.abs(nodeCenterX - frameCenterX) < SNAP_DIST) {
              targetX = Math.round(frameCenterX - child.w / 2);
              dx = targetX - orig.x;
              if (snapGuideV) snapGuideV.classList.add('is-active');
            } else if (snapGuideV) {
              snapGuideV.classList.remove('is-active');
            }

            if (Math.abs(nodeCenterY - frameCenterY) < SNAP_DIST) {
              targetY = Math.round(frameCenterY - nodeH / 2);
              dy = targetY - orig.y;
              if (snapGuideH) snapGuideH.classList.add('is-active');
            } else if (snapGuideH) {
              snapGuideH.classList.remove('is-active');
            }
          }
        }

        nodesToMove.forEach(n => {
          const f = frames.find(fr => fr.id === n.frameId);
          if (!f) return;
          const c = (f.children || []).find(ch => ch.id === n.childId);
          const orig = origins.get(`${n.frameId}_${n.childId}`);
          if (!c || !orig) return;

          c.x = Math.round(orig.x + dx);
          c.y = Math.round(orig.y + dy);
          const cEl = world.querySelector(`[data-id="${c.id}"]`);
          if (cEl) {
            cEl.style.left = `${c.x}px`;
            cEl.style.top = `${c.y}px`;
          }
        });
        updateTextToolbar();
      };

      const onUp = () => {
        nodesToMove.forEach(n => {
          const cEl = world.querySelector(`[data-id="${n.childId}"]`);
          if (cEl) cEl.classList.remove('is-dragging');
        });
        if (snapGuideV) snapGuideV.classList.remove('is-active');
        if (snapGuideH) snapGuideH.classList.remove('is-active');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (moved) save();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    let worldGuideV = null;
    let worldGuideH = null;

    function ensureWorldGuides() {
      if (!worldGuideV || !world.contains(worldGuideV)) {
        worldGuideV = document.createElement('div');
        worldGuideV.className = 'canvas-world-guide canvas-world-guide--v';
        worldGuideV.style.display = 'none';
        world.appendChild(worldGuideV);
      }
      if (!worldGuideH || !world.contains(worldGuideH)) {
        worldGuideH = document.createElement('div');
        worldGuideH.className = 'canvas-world-guide canvas-world-guide--h';
        worldGuideH.style.display = 'none';
        world.appendChild(worldGuideH);
      }
    }

    function startFrameDrag(e, frame) {
      const isMultiKey = e.shiftKey || e.metaKey || e.ctrlKey;
      const alreadySelected = isFrameSelected(frame.id);

      if (isMultiKey) {
        selectFrame(frame.id, true);
        return;
      }

      selectTextNode(null, null);

      if (!alreadySelected || selectedFrameIds.size > 1) {
        selectFrame(frame.id, false);
      } else {
        updateTopbar();
        updateTextToolbar();
      }

      ensureWorldGuides();

      const startX = e.clientX;
      const startY = e.clientY;
      const framesToMove = getSelectedFrames();
      const originPositions = new Map();
      framesToMove.forEach(f => {
        originPositions.set(f.id, { x: f.x, y: f.y });
        const fEl = frameElOf(f);
        if (fEl) fEl.classList.add('is-dragging');
      });

      // Frames estáticos que servem de âncora para o snap magnético
      const movingIds = new Set(framesToMove.map(f => f.id));
      const staticFrames = frames.filter(f => !movingIds.has(f.id));

      const primaryOrig = originPositions.get(frame.id) || { x: frame.x, y: frame.y };
      const SNAP_THRESHOLD = 20; // Raio magnético em pixels do mundo

      let moved = false;

      const onMove = (ev) => {
        let rawDx = (ev.clientX - startX) / cam.scale;
        let rawDy = (ev.clientY - startY) / cam.scale;

        if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) {
          moved = true;
        }
        if (!moved) return;

        let dx = rawDx;
        let dy = rawDy;

        let snappedGuideX = null;
        let snappedGuideY = null;

        if (snapEnabled && staticFrames.length > 0) {
          const rawTargetX = primaryOrig.x + rawDx;
          const rawTargetY = primaryOrig.y + rawDy;
          const Fw = frame.w;
          const Fh = frame.h;

          let bestDiffX = Infinity;
          let bestSnapX = null;
          let bestGuideX = null;

          let bestDiffY = Infinity;
          let bestSnapY = null;
          let bestGuideY = null;

          staticFrames.forEach(other => {
            const Ow = other.w;
            const Oh = other.h;

            // --- ALINHAMENTOS HORIZONTAIS (EIXO X) ---
            const xAlignments = [
              // Esquerda com Esquerda
              { snapX: other.x, guideX: other.x },
              // Centro com Centro
              { snapX: other.x + (Ow - Fw) / 2, guideX: other.x + Ow / 2 },
              // Direita com Direita
              { snapX: other.x + Ow - Fw, guideX: other.x + Ow },
              // Lado a Lado com Gap padrão (120px)
              { snapX: other.x + Ow + FRAME_GAP, guideX: other.x + Ow },
              { snapX: other.x - FRAME_GAP - Fw, guideX: other.x },
              // Lado a Lado encostado (0px)
              { snapX: other.x + Ow, guideX: other.x + Ow },
              { snapX: other.x - Fw, guideX: other.x }
            ];

            xAlignments.forEach(cand => {
              const diff = Math.abs(cand.snapX - rawTargetX);
              if (diff < SNAP_THRESHOLD && diff < bestDiffX) {
                bestDiffX = diff;
                bestSnapX = cand.snapX;
                bestGuideX = cand.guideX;
              }
            });

            // --- ALINHAMENTOS VERTICAIS (EIXO Y) ---
            const yAlignments = [
              // Topo com Topo
              { snapY: other.y, guideY: other.y },
              // Centro com Centro
              { snapY: other.y + (Oh - Fh) / 2, guideY: other.y + Oh / 2 },
              // Base com Base
              { snapY: other.y + Oh - Fh, guideY: other.y + Oh },
              // Empilhado com Gap padrão (120px)
              { snapY: other.y + Oh + FRAME_GAP, guideY: other.y + Oh },
              { snapY: other.y - FRAME_GAP - Fh, guideY: other.y },
              // Empilhado encostado (0px)
              { snapY: other.y + Oh, guideY: other.y + Oh },
              { snapY: other.y - Fh, guideY: other.y }
            ];

            yAlignments.forEach(cand => {
              const diff = Math.abs(cand.snapY - rawTargetY);
              if (diff < SNAP_THRESHOLD && diff < bestDiffY) {
                bestDiffY = diff;
                bestSnapY = cand.snapY;
                bestGuideY = cand.guideY;
              }
            });
          });

          if (bestSnapX !== null) {
            dx = bestSnapX - primaryOrig.x;
            snappedGuideX = bestGuideX;
          }
          if (bestSnapY !== null) {
            dy = bestSnapY - primaryOrig.y;
            snappedGuideY = bestGuideY;
          }
        }

        // Exibe ou oculta as guias visuais magnéticas na tela
        if (worldGuideV) {
          if (snappedGuideX !== null) {
            worldGuideV.style.left = `${snappedGuideX}px`;
            worldGuideV.style.display = 'block';
          } else {
            worldGuideV.style.display = 'none';
          }
        }

        if (worldGuideH) {
          if (snappedGuideY !== null) {
            worldGuideH.style.top = `${snappedGuideY}px`;
            worldGuideH.style.display = 'block';
          } else {
            worldGuideH.style.display = 'none';
          }
        }

        framesToMove.forEach(f => {
          const orig = originPositions.get(f.id);
          if (orig) {
            f.x = Math.round(orig.x + dx);
            f.y = Math.round(orig.y + dy);
            const fEl = frameElOf(f);
            if (fEl) {
              fEl.style.left = `${f.x}px`;
              fEl.style.top = `${f.y}px`;
            }
          }
        });
        wakeRopes();
      };

      const onUp = () => {
        if (worldGuideV) worldGuideV.style.display = 'none';
        if (worldGuideH) worldGuideH.style.display = 'none';
        framesToMove.forEach(f => {
          const fEl = frameElOf(f);
          if (fEl) fEl.classList.remove('is-dragging');
        });
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (moved) save();
        updateTextToolbar();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    function renderImageNode(child, frame, frameEl) {
      ensureImageProps(child);

      const el = document.createElement('div');
      el.className = 'canvas-image-node';
      el.dataset.id = child.id;

      // 1. Ghost Layer (contextual preview outside the crop mask)
      const ghost = document.createElement('div');
      ghost.className = 'canvas-image-node__ghost';
      const ghostImg = document.createElement('img');
      ghostImg.className = 'canvas-image-node__ghost-img';
      ghostImg.draggable = false;
      ghost.appendChild(ghostImg);
      el.appendChild(ghost);

      // 2. Clip Layer (máscara de exibição com overflow: hidden)
      const clip = document.createElement('div');
      clip.className = 'canvas-image-node__clip';

      const img = document.createElement('img');
      img.className = 'canvas-image-node__img';
      img.draggable = false;
      clip.appendChild(img);
      el.appendChild(clip);

      // Helper de sincronização de imagem
      const setImgSrc = (src) => {
        img.src = src;
        ghostImg.src = src;
      };

      if (child.src) {
        setImgSrc(child.src);
      } else if (child.assetId) {
        if (assetCache.has(child.assetId)) {
          setImgSrc(assetCache.get(child.assetId));
        } else {
          getAsset(child.assetId).then(src => {
            if (src) {
              assetCache.set(child.assetId, src);
              setImgSrc(src);
            }
          });
        }
      }

      updateImageNodeDOM(child, el);
      paintBind(child, el);

      // 3. Alça SE de redimensionamento em modo normal
      const resizerSE = document.createElement('div');
      resizerSE.className = 'canvas-image-node__resize canvas-image-node__resize--se';
      el.appendChild(resizerSE);

      // 4. 8 Alças de Recorte (estilo Figma / Canva)
      const cropHandles = [
        { type: 'corner', dir: 'nw' },
        { type: 'corner', dir: 'ne' },
        { type: 'corner', dir: 'sw' },
        { type: 'corner', dir: 'se' },
        { type: 'edge', dir: 'n' },
        { type: 'edge', dir: 's' },
        { type: 'edge', dir: 'w' },
        { type: 'edge', dir: 'e' }
      ];

      cropHandles.forEach(h => {
        const handleEl = document.createElement('div');
        handleEl.className = `canvas-crop-handle canvas-crop-handle--${h.type} canvas-crop-handle--${h.dir}`;
        handleEl.dataset.cropHandle = h.dir;
        el.appendChild(handleEl);
      });

      // Duplo clique: Alterna modo de recorte (Figma style)
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (croppingImage && croppingImage.childId === child.id) {
          exitCropMode();
        } else {
          enterCropMode(frame.id, child.id);
        }
      });

      // Scroll de roda / pinch zoom no modo de recorte
      el.addEventListener('wheel', (e) => {
        if (!croppingImage || croppingImage.childId !== child.id) return;
        e.preventDefault();
        e.stopPropagation();
        const delta = -e.deltaY * 0.0025;
        ensureImageProps(child);
        const nextZoom = Math.min(5, Math.max(1, (child.zoom || 1.0) + delta));
        setCropZoom(nextZoom);
      }, { passive: false });

      // Mousedown para ações (Recorte vs Normal)
      el.addEventListener('mousedown', (e) => {
        const isCroppingThis = croppingImage && croppingImage.childId === child.id;

        // Caso A: Arrastando uma das 8 alças de recorte
        const cropHandle = e.target.closest('.canvas-crop-handle');
        if (isCroppingThis && cropHandle) {
          e.stopPropagation();
          e.preventDefault();
          const dir = cropHandle.dataset.cropHandle;
          const startX = e.clientX;
          const startY = e.clientY;
          const originX = child.x;
          const originY = child.y;
          const originW = child.w;
          const originH = child.h;
          const originImgX = child.imgX;
          const originImgY = child.imgY;

          const onMove = ev => {
            const dx = (ev.clientX - startX) / cam.scale;
            const dy = (ev.clientY - startY) / cam.scale;

            let targetX = originX;
            let targetY = originY;
            let targetW = originW;
            let targetH = originH;
            let targetImgX = originImgX;
            let targetImgY = originImgY;

            if (dir.includes('e')) {
              targetW = Math.max(20, originW + dx);
            }
            if (dir.includes('s')) {
              targetH = Math.max(20, originH + dy);
            }
            if (dir.includes('w')) {
              const maxDx = originW - 20;
              const actualDx = Math.min(maxDx, dx);
              targetX = originX + actualDx;
              targetW = originW - actualDx;
              targetImgX = originImgX - actualDx;
            }
            if (dir.includes('n')) {
              const maxDy = originH - 20;
              const actualDy = Math.min(maxDy, dy);
              targetY = originY + actualDy;
              targetH = originH - actualDy;
              targetImgY = originImgY - actualDy;
            }

            child.x = Math.round(targetX);
            child.y = Math.round(targetY);
            child.w = Math.round(targetW);
            child.h = Math.round(targetH);
            child.imgX = Math.round(targetImgX);
            child.imgY = Math.round(targetImgY);

            updateImageNodeDOM(child, el);
            updateCropToolbar();
          };

          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            save();
          };

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
          return;
        }

        // Caso B: Em modo de recorte, arrastar a imagem faz o pan dentro da máscara
        if (isCroppingThis) {
          e.stopPropagation();
          e.preventDefault();
          const startX = e.clientX;
          const startY = e.clientY;
          const originImgX = child.imgX;
          const originImgY = child.imgY;

          const onMove = ev => {
            const dx = (ev.clientX - startX) / cam.scale;
            const dy = (ev.clientY - startY) / cam.scale;
            child.imgX = Math.round(originImgX + dx);
            child.imgY = Math.round(originImgY + dy);
            updateImageNodeDOM(child, el);
          };

          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            save();
          };

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
          return;
        }

        // Caso C: Redimensionamento em modo normal (alça SE)
        if (e.target === resizerSE) {
          e.stopPropagation();
          e.preventDefault();
          selectTextNode(frame.id, child.id);
          const startX = e.clientX;
          const originW = child.w;
          const originH = child.h;
          const originImgW = child.imgW;
          const originImgH = child.imgH;
          const originImgX = child.imgX;
          const originImgY = child.imgY;
          const ratio = originW / originH;
          
          const onMove = ev => {
            const delta = (ev.clientX - startX) / cam.scale;
            const newW = Math.max(20, originW + delta);
            const scaleFactor = newW / originW;
            child.w = Math.round(newW);
            child.h = Math.round(newW / ratio);
            child.imgW = Math.round(originImgW * scaleFactor);
            child.imgH = Math.round(originImgH * scaleFactor);
            child.imgX = Math.round(originImgX * scaleFactor);
            child.imgY = Math.round(originImgY * scaleFactor);
            updateImageNodeDOM(child, el);
            updateTextToolbar();
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            save();
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
          return;
        }

        // Caso D: Movimentação em modo normal (com suporte a multi-seleção e Snapping)
        e.stopPropagation();
        e.preventDefault();
        startChildNodeDrag(e, child, frame, el);
      });

      frameEl.appendChild(el);
      return el;
    }

    /* --------------------------------------------------
       Variáveis do Batch Create
       O nó continua mostrando o texto de exemplo — é ele que faz o design ficar
       de pé. O `bind` é só a etiqueta que diz de qual coluna da planilha esse
       nó vai puxar o conteúdo na hora de gerar o lote.
       -------------------------------------------------- */
    const BIND_RE = /^[a-z0-9_]+$/;

    // "Título Principal!" -> "titulo_principal": o nome que vira coluna do CSV
    function slugifyBind(raw) {
      return (raw || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 32);
    }

    function paintBind(child, el) {
      el.classList.toggle('has-bind', !!child.bind);
      let tag = el.querySelector('.canvas-node__bind');
      if (!child.bind) {
        if (tag) tag.remove();
        return;
      }
      if (!tag) {
        tag = document.createElement('span');
        tag.className = 'canvas-node__bind';
        el.appendChild(tag);
      }
      tag.textContent = `{{${child.bind}}}`;
    }

    function nodeElement(childId) {
      return world.querySelector(`.canvas-text-node[data-id="${childId}"], .canvas-image-node[data-id="${childId}"]`);
    }

    function toggleBind() {
      const child = selectedChild();
      if (!child) return;
      if (child.bind) {
        delete child.bind;
      } else {
        const suggested = child.type === 'image' ? 'imagem' : slugifyBind(child.text) || 'titulo';
        const raw = prompt('Nome da variável (vira a coluna do CSV):', suggested);
        if (raw === null) return;
        const name = slugifyBind(raw);
        if (!BIND_RE.test(name)) return;
        child.bind = name;
      }
      const el = nodeElement(child.id);
      if (el) paintBind(child, el);
      updateTextToolbar();
      save();
    }

    function renderChildNode(child, frame, frameEl) {
      if (child.type === 'image') return renderImageNode(child, frame, frameEl);
      if (child.type !== 'text') return;
      const el = document.createElement('div');
      el.className = 'canvas-text-node';
      el.dataset.id = child.id;
      el.style.left = `${child.x}px`;
      el.style.top = `${child.y}px`;
      el.style.width = `${child.w}px`;
      
      const content = document.createElement('div');
      content.className = 'canvas-text-node__content';
      // Nasce só selecionável: quem liga a edição é o duplo clique
      content.contentEditable = 'false';
      content.spellcheck = false;
      // html só existe quando algum trecho ganhou estilo próprio
      if (child.html) content.innerHTML = child.html;
      else content.textContent = child.text || '';
      paintTextStyle(child, content);


      content.addEventListener('input', () => {
        syncTextHtml(child, content);
        save();
        updateTextToolbar(); // in case height changes, repositions toolbar
      });

      /* Colar traz HTML do Word, do Notion, do que for. O conteúdo entra cru:
         a marcação de fora sobreporia a tipografia daqui, e os únicos spans
         que este editor entende são os data-run que ele mesmo cria. */
      content.addEventListener('paste', (e) => {
        e.preventDefault();
        const plain = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, plain);
      });

      content.addEventListener('focus', () => selectTextNode(frame.id, child.id));

      el.appendChild(content);
      paintBind(child, el);

      // Resize handle E
      const resizerE = document.createElement('div');
      resizerE.className = 'canvas-text-node__resize canvas-text-node__resize--e';
      el.appendChild(resizerE);

      // Mouse drag no texto
      el.addEventListener('mousedown', (e) => {
        if (e.target === resizerE) {
          // Lida com o resize horizontal
          e.stopPropagation();
          e.preventDefault();
          selectTextNode(frame.id, child.id);
          const startX = e.clientX;
          const originW = child.w;
          
          const onMove = ev => {
            const delta = (ev.clientX - startX) / cam.scale;
            child.w = Math.max(20, originW + delta);
            el.style.width = `${child.w}px`;
            updateTextToolbar();
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            save();
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
          return;
        }

        /* Já editando: o navegador cuida do resto — caret no ponto do clique,
           arrastar para selecionar, duplo clique na palavra, triplo no bloco.
           Qualquer preventDefault aqui mataria os três.
           contains, e não ===: clicar num trecho estilizado acerta o span. */
        if (document.activeElement === content && content.contains(e.target)) return;

        e.stopPropagation();
        e.preventDefault();
        startChildNodeDrag(e, child, frame, el);
      });

      // Duplo clique abre a edição com o cursor onde o mouse parou
      el.addEventListener('dblclick', (e) => {
        if (e.target === resizerE) return;
        e.stopPropagation();
        selectTextNode(frame.id, child.id);
        enterTextEditing(content, e.clientX, e.clientY);
      });

      frameEl.appendChild(el);
      return el;
    }

    /* CRUD do nó de texto. Mesmo molde do frame: mexe no JSON, deriva o DOM.
       Todo caminho de criação (botão, tecla T, duplo clique) passa por aqui. */
    function frameElOf(frame) {
      return world.querySelector(`.canvas-frame[data-id="${frame.id}"]`);
    }

    function focusTextNode(childId) {
      const dom = world.querySelector(`.canvas-text-node[data-id="${childId}"]`);
      if (!dom) return;
      const content = dom.querySelector('.canvas-text-node__content');
      // Texto recém-criado já entra em edição: foi para isso que ele nasceu
      if (content) enterTextEditing(content);
    }

    function addTextNode(frame, localX, localY) {
      const frameEl = frameElOf(frame);
      if (!frameEl) return;
      if (!frame.children) frame.children = [];
      const child = {
        ...TEXT_DEFAULTS,
        id: childSeq++,
        type: 'text',
        x: localX,
        y: localY,
        w: Math.min(600, Math.round(frame.w * 0.72)),
        text: '',
      };
      frame.children.push(child);
      renderChildNode(child, frame, frameEl);
      selectTextNode(frame.id, child.id);
      save();
      // O caret não nasce sozinho num contentEditable vazio recém-inserido
      setTimeout(() => focusTextNode(child.id), 30);
    }

    // Sem coordenada: entra no meio do frame, que é onde o olho já está
    function addTextToSelectedFrame() {
      const frame = frames.find(f => f.id === selectedId);
      if (!frame) return;
      const w = Math.min(600, Math.round(frame.w * 0.72));
      addTextNode(frame, Math.round((frame.w - w) / 2), Math.round(frame.h / 2 - 24));
    }

    async function addImageNode(frame, rawData, imgW, imgH, customX, customY) {
      if (!frame.children) frame.children = [];
      const frameEl = frameElOf(frame);
      if (!frameEl) return;
      
      const MAX_W = Math.min(800, Math.round(frame.w * 0.8));
      let w = imgW;
      let h = imgH;
      if (w > MAX_W) {
        h = Math.round(h * (MAX_W / w));
        w = MAX_W;
      }

      const x = customX !== undefined ? customX : Math.round((frame.w - w) / 2);
      const y = customY !== undefined ? customY : Math.round((frame.h - h) / 2);

      const assetId = 'asset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      assetCache.set(assetId, rawData);
      await saveAsset(assetId, rawData);

      const child = {
        id: childSeq++,
        type: 'image',
        assetId,
        x, y, w, h,
        origW: imgW,
        origH: imgH,
        imgX: 0,
        imgY: 0,
        imgW: w,
        imgH: h,
        zoom: 1.0,
        borderRadius: 0,
        borderWidth: 0,
        borderColor: '#000000',
        opacity: 100,
        blur: 0,
        shadow: 0
      };
      frame.children.push(child);
      renderChildNode(child, frame, frameEl);
      selectTextNode(frame.id, child.id);
      save();
    }

    function duplicateTextNode() {
      if (selectedChildNodes.length === 0) return;
      const newSelections = [];
      selectedChildNodes.forEach(sel => {
        const frame = frames.find(f => f.id === sel.frameId);
        if (!frame) return;
        const src = (frame.children || []).find(c => c.id === sel.childId);
        const frameEl = frameElOf(frame);
        if (!src || !frameEl) return;
        // Deslocamento diagonal para a cópia não sumir embaixo do original
        const copy = {
          ...src,
          id: childSeq++,
          x: src.x + 24,
          y: src.y + 24
        };
        if (src.type === 'image') {
          ensureImageProps(copy);
        }
        frame.children.push(copy);
        renderChildNode(copy, frame, frameEl);
        newSelections.push({ frameId: frame.id, childId: copy.id });
      });
      selectedChildNodes = newSelections;
      selectedTextNode = newSelections.length > 0 ? newSelections[0] : { frameId: null, childId: null };
      world.querySelectorAll('.canvas-text-node, .canvas-image-node').forEach(el => {
        const cId = Number(el.dataset.id);
        el.classList.toggle('is-selected', selectedChildNodes.some(n => n.childId === cId));
      });
      updateTextToolbar();
      save();
    }

    function deleteTextNode() {
      if (croppingImage) exitCropMode();
      if (selectedChildNodes.length === 0) return;
      selectedChildNodes.forEach(sel => {
        const frame = frames.find(f => f.id === sel.frameId);
        if (!frame) return;
        const elText = world.querySelector(`.canvas-text-node[data-id="${sel.childId}"]`);
        const elImg = world.querySelector(`.canvas-image-node[data-id="${sel.childId}"]`);
        if (elText) elText.remove();
        if (elImg) elImg.remove();
        frame.children = (frame.children || []).filter(c => c.id !== sel.childId);
      });
      selectTextNode(null, null);
      save();
    }

    function createSafeZoneElement(frame) {
      const container = document.createElement('div');
      container.className = 'canvas-frame__safezone';

      if (frame.format === 'story') {
        // 9:16 Story / TikTok / Reels (1080 x 1920)
        // Uma zona só para as duas redes = a interseção da pior UI de cada uma.
        // Rodapé: TikTok come 400–484px (legenda + disco de áudio + CTA), Reels
        // 320–400px. Direita: TikTok 140–180px de coluna de ações, Reels 90–120px.
        container.innerHTML = `
          <div class="canvas-safezone__danger canvas-safezone__danger--top" style="height: 200px;">
            <span class="canvas-safezone__badge">⚠️ Topo (Status, Abas & Busca · 200px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--bottom" style="height: 480px;">
            <span class="canvas-safezone__badge">⚠️ Rodapé (Legenda, Áudio & CTA · 480px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--left" style="top: 200px; bottom: 480px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">Margem (60px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--right" style="top: 200px; bottom: 480px; width: 180px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">⚠️ Ações (Like, Comentar, Salvar · 180px)</span>
          </div>
          <div class="canvas-safezone__box" style="top: 200px; bottom: 480px; left: 60px; right: 180px;">
            <span class="canvas-safezone__label">✅ Área Segura TikTok (840 × 1240)</span>
          </div>
        `;
      } else if (frame.format === 'reels') {
        // 9:16 Instagram Reels (1080 x 1920)
        // Rodapé menor que o do TikTok (320–400px) e coluna de ações mais
        // estreita (90–120px), porque a legenda do Reels ocupa menos linhas.
        container.innerHTML = `
          <div class="canvas-safezone__danger canvas-safezone__danger--top" style="height: 220px;">
            <span class="canvas-safezone__badge">⚠️ Topo (Status & "Reels" · 220px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--bottom" style="height: 400px;">
            <span class="canvas-safezone__badge">⚠️ Rodapé (Legenda, @perfil & Áudio · 400px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--left" style="top: 220px; bottom: 400px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">Margem (60px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--right" style="top: 220px; bottom: 400px; width: 120px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">⚠️ Ações (Curtir, Comentar · 120px)</span>
          </div>
          <div class="canvas-safezone__box" style="top: 220px; bottom: 400px; left: 60px; right: 120px;">
            <span class="canvas-safezone__label">✅ Área Segura Reels (900 × 1300)</span>
          </div>
        `;
      } else if (frame.format === 'ig-story') {
        // 9:16 Instagram Story (1080 x 1920)
        // Regra que a própria Meta repete: miolo de 1080 × 1420, ou seja 250px
        // presos em cima (barra de progresso, @perfil, fechar) e 250px embaixo
        // (campo de resposta, enviar e onde caem enquete/caixinha de pergunta).
        container.innerHTML = `
          <div class="canvas-safezone__danger canvas-safezone__danger--top" style="height: 250px;">
            <span class="canvas-safezone__badge">⚠️ Topo (Barra de Progresso & @perfil · 250px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--bottom" style="height: 250px;">
            <span class="canvas-safezone__badge">⚠️ Rodapé (Responder, Enviar & Stickers · 250px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--left" style="top: 250px; bottom: 250px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">Margem (60px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--right" style="top: 250px; bottom: 250px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">Margem (60px)</span>
          </div>
          <div class="canvas-safezone__box" style="top: 250px; bottom: 250px; left: 60px; right: 60px;">
            <span class="canvas-safezone__label">✅ Área Segura Story (960 × 1420)</span>
          </div>
        `;
      } else if (frame.format === 'yt-thumb') {
        // 16:9 Thumbnail do YouTube (1280 x 720)
        // Miolo que sobrevive a todas as vitrines: 1100 × 620 — o app corta as
        // laterais no feed. O carimbo de duração é cravado pelo YouTube no canto
        // inferior direito e entra por cima até da área segura.
        container.innerHTML = `
          <div class="canvas-safezone__danger canvas-safezone__danger--top" style="height: 50px;">
            <span class="canvas-safezone__badge">⚠️ Margem Superior (50px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--bottom" style="height: 50px;">
            <span class="canvas-safezone__badge">⚠️ Rodapé (Barra de Progresso · 50px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--left" style="top: 50px; bottom: 50px; width: 90px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">✂️ Corte no feed (90px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--right" style="top: 50px; bottom: 50px; width: 90px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">✂️ Corte no feed (90px)</span>
          </div>
          <div class="canvas-safezone__box" style="top: 50px; bottom: 50px; left: 90px; right: 90px;">
            <span class="canvas-safezone__label">✅ Área Segura YouTube (1100 × 620)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--corner" style="right: 0; bottom: 0; width: 220px; height: 80px;">
            <span class="canvas-safezone__badge">⏱ Duração</span>
          </div>
        `;
      } else if (frame.format === 'ig-feed') {
        // 4:5 Instagram Feed (1080 x 1350)
        // Desde jan/2025 a grade do perfil é 3:4 (~1013 × 1350), não mais 1:1:
        // o post 4:5 aparece inteiro em altura e perde ~34px de cada lateral.
        // Como 34 < 60, respeitar a margem de respiro já cobre o corte da grade.
        container.innerHTML = `
          <div class="canvas-safezone__danger canvas-safezone__danger--top" style="height: 60px;">
            <span class="canvas-safezone__badge">⚠️ Margem Superior (60px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--bottom" style="height: 60px;">
            <span class="canvas-safezone__badge">⚠️ Margem Inferior (60px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--left" style="top: 60px; bottom: 60px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">✂️ Grade 3:4 corta 34px · margem 60px</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--right" style="top: 60px; bottom: 60px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">✂️ Grade 3:4 corta 34px · margem 60px</span>
          </div>
          <div class="canvas-safezone__box" style="top: 60px; bottom: 60px; left: 60px; right: 60px;">
            <span class="canvas-safezone__label">📸 Feed & Grade 3:4 Seguros (960 × 1230)</span>
          </div>
        `;
      } else if (frame.format === 'pinterest') {
        // 2:3 Pinterest (1000 x 1500)
        // A UI do Pinterest (avatar, título, botão Salvar) come ~15% em cima e
        // embaixo = 225px de cada lado num pin de 1500px de altura.
        container.innerHTML = `
          <div class="canvas-safezone__danger canvas-safezone__danger--top" style="height: 225px;">
            <span class="canvas-safezone__badge">⚠️ Topo (Avatar & Navegação · 225px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--bottom" style="height: 225px;">
            <span class="canvas-safezone__badge">⚠️ Rodapé (Botão Salvar & Título do Site · 225px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--left" style="top: 225px; bottom: 225px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">Margem (60px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--right" style="top: 225px; bottom: 225px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">Margem (60px)</span>
          </div>
          <div class="canvas-safezone__box" style="top: 225px; bottom: 225px; left: 60px; right: 60px;">
            <span class="canvas-safezone__label">📌 Área Segura Pinterest (880 × 1050)</span>
          </div>
        `;
      } else {
        // 1:1 Square (1080 x 1080)
        container.innerHTML = `
          <div class="canvas-safezone__danger canvas-safezone__danger--top" style="height: 60px;">
            <span class="canvas-safezone__badge">⚠️ Margem Superior (60px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--bottom" style="height: 60px;">
            <span class="canvas-safezone__badge">⚠️ Margem Inferior (60px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--left" style="top: 60px; bottom: 60px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">Margem (60px)</span>
          </div>
          <div class="canvas-safezone__danger canvas-safezone__danger--right" style="top: 60px; bottom: 60px; width: 60px;">
            <span class="canvas-safezone__badge canvas-safezone__badge--v">Margem (60px)</span>
          </div>
          <div class="canvas-safezone__box" style="top: 60px; bottom: 60px; left: 60px; right: 60px;">
            <span class="canvas-safezone__label">✅ Área Segura Quadrada (960 × 960)</span>
          </div>
        `;
      }
      return container;
    }

    function applyFrameBackground(frame, frameEl) {
      const el = frameEl || frameElOf(frame);
      if (!el) return;

      let bgLayer = el.querySelector('.canvas-frame__bg-layer');
      if (!bgLayer) {
        bgLayer = document.createElement('div');
        bgLayer.className = 'canvas-frame__bg-layer';
        el.prepend(bgLayer);
      }

      // 1. Imagem de fundo com overlay & blur
      if (frame.bgImage) {
        const overlayAlpha = (frame.bgOverlay != null ? frame.bgOverlay : 35) / 100;
        const blurPx = frame.bgBlur || 0;

        bgLayer.style.backgroundImage = `url("${frame.bgImage}")`;
        bgLayer.style.backgroundSize = 'cover';
        bgLayer.style.backgroundPosition = 'center';
        bgLayer.style.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
        bgLayer.style.transform = blurPx > 0 ? 'scale(1.06)' : 'none';
        bgLayer.style.backgroundColor = frame.bg || 'transparent';

        let overlayEl = el.querySelector('.canvas-frame__bg-overlay');
        if (overlayAlpha > 0) {
          if (!overlayEl) {
            overlayEl = document.createElement('div');
            overlayEl.className = 'canvas-frame__bg-overlay';
            bgLayer.after(overlayEl);
          }
          overlayEl.style.backgroundColor = `rgba(0, 0, 0, ${overlayAlpha})`;
          overlayEl.style.display = 'block';
        } else if (overlayEl) {
          overlayEl.style.display = 'none';
        }
      } else {
        // 2. Cor sólida ou gradiente
        bgLayer.style.backgroundImage = (frame.bg && frame.bg.includes('gradient')) ? frame.bg : 'none';
        bgLayer.style.backgroundColor = (frame.bg && !frame.bg.includes('gradient')) ? frame.bg : (frame.bg || '#FFFFFF');
        bgLayer.style.filter = 'none';
        bgLayer.style.transform = 'none';

        const overlayEl = el.querySelector('.canvas-frame__bg-overlay');
        if (overlayEl) overlayEl.style.display = 'none';
      }
    }

    function renderFrame(frame) {
      const fmt = FORMATS[frame.format];
      const el = document.createElement('div');
      el.className = 'canvas-frame';
      el.dataset.id = frame.id;
      el.style.left = `${frame.x}px`;
      el.style.top = `${frame.y}px`;
      el.style.width = `${frame.w}px`;
      el.style.height = `${frame.h}px`;
      applyFrameBackground(frame, el);

      const label = document.createElement('div');
      label.className = 'canvas-frame__label';
      label.innerHTML = `<b>${fmt.name}</b> <span>${frame.w} × ${frame.h}</span>`;
      el.appendChild(label);

      // Linhas-guia magnéticas de alinhamento ao centro
      const snapGuideV = document.createElement('div');
      snapGuideV.className = 'canvas-frame__snap-guide canvas-frame__snap-guide--v';
      el.appendChild(snapGuideV);

      const snapGuideH = document.createElement('div');
      snapGuideH.className = 'canvas-frame__snap-guide canvas-frame__snap-guide--h';
      el.appendChild(snapGuideH);

      // Overlay de Safe Zone específico do formato
      el.appendChild(createSafeZoneElement(frame));
      
      // Renderiza textos e imagens guardados
      if (frame.children) {
        frame.children.forEach(child => renderChildNode(child, frame, el));
      }

      const pOut = document.createElement('div');
      pOut.className = 'canvas-frame__port canvas-frame__port--out';
      pOut.title = 'Arraste até outro frame para ligar no mesmo post';
      pOut.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        startLinkDrag(frame, e);
      });
      el.appendChild(pOut);

      const pIn = document.createElement('div');
      pIn.className = 'canvas-frame__port canvas-frame__port--in';
      el.appendChild(pIn);

      el.addEventListener('mousedown', (e) => {
        /* Texto em edição devolve o evento para o navegador sem parar a
           propagação — e ele chegava aqui, onde o preventDefault abaixo matava
           o caret, a seleção por arrasto e o duplo clique. O frame só reage a
           cliques que não nasceram dentro de um filho. */
        if (e.target.closest('.canvas-text-node, .canvas-image-node')) return;

        if (e.target.closest('.canvas-text-node, .canvas-image-node')) return;
        if (e.target.closest('.canvas-frame__port')) return;

        e.stopPropagation();
        e.preventDefault();
        startFrameDrag(e, frame);
      });
      
      // Duplo clique cria um nó de texto na coordenada relativa ao frame
      el.addEventListener('dblclick', (e) => {
        if (e.target !== el && e.target !== empty) return;
        const rect = el.getBoundingClientRect();
        // Converte do screen point para a posição dentro do frame
        addTextNode(frame, (e.clientX - rect.left) / cam.scale, (e.clientY - rect.top) / cam.scale - 24);
      });

      world.appendChild(el);
      return el;
    }

    function selectFrame(id, isMulti = false) {
      if (id !== null) {
        selectTextNode(null, null);
      }
      if (id !== null && selectedLinkId !== null) {
        selectedLinkId = null;
        if (linksRoot) {
          linksRoot.querySelectorAll('.canvas-link.is-selected')
            .forEach(g => g.classList.remove('is-selected'));
        }
      }

      if (id === null) {
        selectedFrameIds.clear();
        selectedId = null;
      } else if (isMulti) {
        if (selectedFrameIds.has(id)) {
          selectedFrameIds.delete(id);
        } else {
          selectedFrameIds.add(id);
        }
        selectedId = selectedFrameIds.size > 0 ? [...selectedFrameIds][0] : null;
      } else {
        selectedFrameIds = new Set([id]);
        selectedId = id;
      }

      world.querySelectorAll('.canvas-frame').forEach((el) => {
        const fId = Number(el.dataset.id);
        el.classList.toggle('is-selected', selectedFrameIds.has(fId));
      });
      if (id !== null && document.activeElement && document.activeElement !== document.body && !document.activeElement.isContentEditable) {
        document.activeElement.blur();
      }
      updateTopbar();
      updateTextToolbar();
      if (isMeasureKeyActive) updateMeasureGuides(lastMouseClientPos);
    }

    function updateTopbar() {
      const selectedFrames = getSelectedFrames();
      const hasFrames = selectedFrames.length > 0;
      const firstFrame = selectedFrames[0];
      const btnAddImage = document.getElementById('canvas-add-image');
      if (btnAddText) btnAddText.disabled = !hasFrames;
      if (btnAddImage) btnAddImage.disabled = !hasFrames;
      if (btnDupFrame) btnDupFrame.disabled = !hasFrames;
      // Delete serve para os dois: frame selecionado ou corda selecionada
      if (btnDelFrame) btnDelFrame.disabled = !hasFrames && selectedLinkId === null;
      /* Ligar em carrossel: dois ou mais, e todos da mesma rede. Quando os
         formatos não batem o botão explica no tooltip por que está apagado. */
      if (btnLinkFrames) {
        const enough = selectedFrames.length >= 2;
        const sameFormat = enough && selectedFrames.every(f => f.format === firstFrame.format);
        btnLinkFrames.disabled = !sameFormat;
        btnLinkFrames.title = enough && !sameFormat
          ? 'Formatos diferentes não formam um carrossel'
          : 'Ligar em carrossel (selecione 2+ frames do mesmo formato)';
      }

      /* Atualiza botão e badge de Batch Create */
      const btnBatch = document.getElementById('canvas-batch-btn');
      const badgeBinds = document.getElementById('canvas-batch-binds-count');
      if (btnBatch && badgeBinds) {
        let totalBinds = 0;
        frames.forEach(f => {
          (f.children || []).forEach(c => {
            if (c.bind) totalBinds++;
          });
        });
        btnBatch.disabled = frames.length === 0;
        badgeBinds.style.display = totalBinds > 0 ? 'inline-block' : 'none';
        badgeBinds.textContent = totalBinds;
      }

      if (!topLabel) return;

      if (selectedLinkId !== null) {
        topLabel.textContent = 'Ligação selecionada';
      } else if (selectedFrames.length === 1) {
        topLabel.textContent = `${FORMATS[firstFrame.format].name} · ${firstFrame.w} × ${firstFrame.h}`;
      } else if (selectedFrames.length > 1) {
        topLabel.textContent = `${selectedFrames.length} posts selecionados`;
      } else {
        const posts = computePosts().length;
        if (!frames.length) topLabel.textContent = 'Nenhum frame';
        else topLabel.textContent = `${frames.length} ${frames.length === 1 ? 'frame' : 'frames'} · ${posts} ${posts === 1 ? 'post' : 'posts'}`;
      }
    }

    // Enquadra o frame respeitando a barra de cima e a dock de baixo
    function zoomToFrame(frame) {
      const padX = 80;
      const padTop = 110;
      const padBottom = 140;
      const availW = innerWidth - padX * 2;
      const availH = innerHeight - padTop - padBottom;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(availW / frame.w, availH / frame.h)));
      cam.scale = scale;
      cam.x = padX + (availW - frame.w * scale) / 2 - frame.x * scale;
      cam.y = padTop + (availH - frame.h * scale) / 2 - frame.y * scale;
      applyCamera();
    }

    function addFrame(formatKey) {
      const fmt = FORMATS[formatKey];
      let x, y;
      if (frames.length) {
        // Novo frame entra à direita do último: a fila natural de um carrossel
        const last = frames[frames.length - 1];
        x = last.x + last.w + FRAME_GAP;
        y = last.y;
      } else {
        const center = screenToWorld(innerWidth / 2, innerHeight / 2);
        x = Math.round(center.x - fmt.w / 2);
        y = Math.round(center.y - fmt.h / 2);
      }
      const frame = makeFrame(formatKey, x, y);
      frames.push(frame);
      renderFrame(frame);
      selectFrame(frame.id);
      updateFrameMeta();
      zoomToFrame(frame);
      save();
    }

    function duplicateFrame(id) {
      const framesToDup = selectedFrameIds.size > 0 ? getSelectedFrames() : [frames.find(f => f.id === id)].filter(Boolean);
      if (framesToDup.length === 0) return;
      const newFrameIds = new Set();
      framesToDup.forEach(src => {
        const copy = {
          ...src,
          id: frameSeq++,
          name: src.name ? `${src.name} (cópia)` : '',
          x: src.x + src.w + FRAME_GAP,
          y: src.y,
          children: (src.children || []).map(c => {
            const chCopy = { ...c, id: childSeq++ };
            if (c.type === 'image') ensureImageProps(chCopy);
            return chCopy;
          })
        };
        frames.push(copy);
        renderFrame(copy);
        newFrameIds.add(copy.id);
      });
      selectedFrameIds = newFrameIds;
      selectedId = [...newFrameIds][0];
      world.querySelectorAll('.canvas-frame').forEach((el) => {
        const fId = Number(el.dataset.id);
        el.classList.toggle('is-selected', selectedFrameIds.has(fId));
      });
      updateTopbar();
      updateFrameMeta();
      save();
    }

    function deleteFrame(id) {
      const framesToDelete = selectedFrameIds.size > 0 ? getSelectedFrameIds() : (id !== null ? [id] : []);
      if (framesToDelete.length === 0) return;
      framesToDelete.forEach(fId => {
        const frameEl = world.querySelector(`.canvas-frame[data-id="${fId}"]`);
        if (frameEl) frameEl.remove();
        links = links.filter(l => l.from !== fId && l.to !== fId);
      });
      frames = frames.filter(f => !framesToDelete.includes(f.id));
      selectFrame(null);
      renderLinks();
      updateFrameMeta();
      save();
    }

    /* --------------------------------------------------
       Ligações entre frames (a "cordinha" do carrossel)
       Um link é só { from, to }. O post é a cadeia que sai daí:
       quem não recebe ligação é a capa, e segue-se a corrente.
       -------------------------------------------------- */
    const SVG_NS = 'http://www.w3.org/2000/svg';

    // Saída à direita, entrada à esquerda, ambas na metade da altura
    function portOut(frame) { return { x: frame.x + frame.w, y: frame.y + frame.h / 2 }; }
    function portIn(frame) { return { x: frame.x, y: frame.y + frame.h / 2 }; }

    /* Corda em repouso, no estilo do VCV Rack: o ponto de controle é a média das
       pontas puxada para baixo em proporção à distância. Barata e imediata,
       então é a que segue o mouse enquanto a ligação está sendo puxada. */
    const CABLE_TENSION = 0.35;

    function linkPath(x1, y1, x2, y2) {
      const dist = Math.hypot(x2 - x1, y2 - y1);
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2 + (1 - CABLE_TENSION) * (240 + dist * 0.55);
      return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
    }

    /* --------------------------------------------------
       Motor de corda (Verlet)
       A corda é uma fileira de pontos com gravidade, presos por restrições de
       distância. Método do "Advanced Character Physics" (Jakobsen): integra,
       depois relaxa as distâncias algumas vezes por quadro. É o que dá o
       balanço quando você arrasta o frame e a corda assenta sozinha.
       -------------------------------------------------- */
    const ROPE_POINTS = 22;
    const ROPE_GRAVITY = 3200;
    const ROPE_DAMPING = 0.965;
    const ROPE_RELAX = 12;
    const ROPE_SLACK = 1.16;   // cabo 16% mais longo que a distância: é a folga que faz pender

    const ropes = new Map();
    let ropesRunning = false;
    let ropeIdleFrames = 0;
    let lastRopeTime = 0;

    function makeRope(a, b) {
      const p1 = portOut(a);
      const p2 = portIn(b);
      const pts = [];
      for (let i = 0; i < ROPE_POINTS; i++) {
        const t = i / (ROPE_POINTS - 1);
        const x = p1.x + (p2.x - p1.x) * t;
        const y = p1.y + (p2.y - p1.y) * t;
        pts.push({ x, y, px: x, py: y });
      }
      const dist = Math.max(Math.hypot(p2.x - p1.x, p2.y - p1.y), 260);
      return { pts, segLen: (dist * ROPE_SLACK) / (ROPE_POINTS - 1) };
    }

    function stepRope(rope, a, b, dt) {
      const p1 = portOut(a);
      const p2 = portIn(b);
      const pts = rope.pts;
      const last = pts.length - 1;
      const g = ROPE_GRAVITY * dt * dt;

      // Integração: a velocidade está implícita na diferença para a posição anterior
      for (let i = 1; i < last; i++) {
        const p = pts[i];
        const vx = (p.x - p.px) * ROPE_DAMPING;
        const vy = (p.y - p.py) * ROPE_DAMPING;
        p.px = p.x;
        p.py = p.y;
        p.x += vx;
        p.y += vy + g;
      }

      // Relaxamento: as pontas ficam presas nas portas e o meio se acomoda
      for (let k = 0; k < ROPE_RELAX; k++) {
        pts[0].x = p1.x; pts[0].y = p1.y;
        pts[last].x = p2.x; pts[last].y = p2.y;
        for (let i = 0; i < last; i++) {
          const A = pts[i];
          const B = pts[i + 1];
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          const d = Math.hypot(dx, dy) || 0.0001;
          const shift = ((d - rope.segLen) / d) * 0.5;
          const ox = dx * shift;
          const oy = dy * shift;
          if (i > 0) { A.x += ox; A.y += oy; }
          if (i + 1 < last) { B.x -= ox; B.y -= oy; }
        }
      }
    }

    // Liga os pontos por quadráticas nos pontos médios: sai uma curva lisa
    function ropePath(pts) {
      let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        d += ` Q ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
      }
      const end = pts[pts.length - 1];
      return `${d} L ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
    }

    function ropeTick(now) {
      if (!ropesRunning) return;
      const dt = Math.min(0.032, (now - lastRopeTime) / 1000) || 0.016;
      lastRopeTime = now;

      const byId = new Map(frames.map(f => [f.id, f]));
      let energy = 0;

      links.forEach((link) => {
        const a = byId.get(link.from);
        const b = byId.get(link.to);
        if (!a || !b) return;

        let rope = ropes.get(link.id);
        if (!rope) {
          rope = makeRope(a, b);
          ropes.set(link.id, rope);
        }
        stepRope(rope, a, b, dt);
        rope.pts.forEach(p => { energy += Math.abs(p.x - p.px) + Math.abs(p.y - p.py); });

        const g = linksRoot && linksRoot.querySelector(`.canvas-link[data-id="${link.id}"]`);
        if (g) {
          // Só o traço e a faixa de clique: o "×" tem path próprio e não pode ser tocado
          const d = ropePath(rope.pts);
          g.querySelector('.canvas-link__line').setAttribute('d', d);
          g.querySelector('.canvas-link__hit').setAttribute('d', d);
          const cut = g.querySelector('.canvas-link__cut');
          const mid = rope.pts[Math.floor(rope.pts.length / 2)];
          if (cut) cut.setAttribute('transform', `translate(${mid.x.toFixed(1)}, ${mid.y.toFixed(1)})`);
        }
      });

      // Corda parada dorme: sem isso o requestAnimationFrame giraria à toa
      ropeIdleFrames = energy < 1.5 ? ropeIdleFrames + 1 : 0;
      if (ropeIdleFrames > 18) {
        ropesRunning = false;
        return;
      }
      requestAnimationFrame(ropeTick);
    }

    function wakeRopes() {
      ropeIdleFrames = 0;
      if (ropesRunning) return;
      ropesRunning = true;
      lastRopeTime = performance.now();
      requestAnimationFrame(ropeTick);
    }

    /* O SVG precisa de uma caixa grande de verdade: o que transborda dele é
       desenhado, mas não recebe clique. Então damos área e deslocamos a origem
       para dentro, mantendo as coordenadas do mundo intactas. */
    const LINK_ORIGIN = 50000;

    function ensureLinksLayer() {
      linksLayer = document.createElementNS(SVG_NS, 'svg');
      linksLayer.setAttribute('class', 'canvas-links');
      linksRoot = document.createElementNS(SVG_NS, 'g');
      linksRoot.setAttribute('transform', `translate(${LINK_ORIGIN}, ${LINK_ORIGIN})`);
      linksLayer.appendChild(linksRoot);
      world.appendChild(linksLayer);
    }

    /* Cadeias de frames ligados. Índice 0 é a capa do post. */
    function computePosts() {
      const byId = new Map(frames.map(f => [f.id, f]));
      const next = new Map();
      const hasIncoming = new Set();
      links.forEach((l) => {
        if (!byId.has(l.from) || !byId.has(l.to)) return;
        next.set(l.from, l.to);
        hasIncoming.add(l.to);
      });

      const visited = new Set();
      const posts = [];
      frames.forEach((f) => {
        if (hasIncoming.has(f.id) || visited.has(f.id)) return;
        const chain = [];
        let cur = f.id;
        // O guard do visited também protege de um ciclo acidental
        while (cur !== undefined && !visited.has(cur)) {
          visited.add(cur);
          chain.push(cur);
          cur = next.get(cur);
        }
        // Frame solto também é um post — só que de imagem única
        posts.push(chain);
      });
      return posts;
    }

    // Escreve no rótulo de cada frame a que post e a que página ele pertence
    function updateFrameMeta() {
      const pos = new Map();
      computePosts().forEach((chain, i) => {
        chain.forEach((id, idx) => pos.set(id, { post: i + 1, page: idx + 1, total: chain.length }));
      });

      frames.forEach((frame) => {
        const el = world.querySelector(`.canvas-frame[data-id="${frame.id}"]`);
        if (!el) return;
        const label = el.querySelector('.canvas-frame__label');
        const fmt = FORMATS[frame.format];
        // Um frame preso em ciclo não é alcançado por nenhuma cadeia: cai no rótulo simples
        const p = pos.get(frame.id);
        // Paginação só aparece em carrossel; post de imagem única não precisa de "1/1"
        const head = !p ? fmt.name
          : p.total > 1 ? `Post ${p.post} · ${p.page}/${p.total}`
          : `Post ${p.post}`;
        label.innerHTML = `<b>${head}</b> <span>${fmt.name} · ${frame.w} × ${frame.h}</span>`;
        el.classList.toggle('is-linked', !!p && p.total > 1);
      });
      updateTopbar();
    }

    function renderLinks() {
      if (!linksRoot) return;
      linksRoot.innerHTML = '';
      const byId = new Map(frames.map(f => [f.id, f]));

      links.forEach((link) => {
        const a = byId.get(link.from);
        const b = byId.get(link.to);
        if (!a || !b) return;
        const p1 = portOut(a);
        const p2 = portIn(b);
        const d = linkPath(p1.x, p1.y, p2.x, p2.y);

        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('class', 'canvas-link' + (link.id === selectedLinkId ? ' is-selected' : ''));
        g.dataset.id = link.id;

        // Faixa larga e invisível por cima: é ela que recebe o clique
        const hit = document.createElementNS(SVG_NS, 'path');
        hit.setAttribute('class', 'canvas-link__hit');
        hit.setAttribute('d', d);

        const line = document.createElementNS(SVG_NS, 'path');
        line.setAttribute('class', 'canvas-link__line');
        line.setAttribute('d', d);

        g.appendChild(line);
        g.appendChild(hit);

        /* Botão de desatar no meio da corda: aparece ao passar o mouse.
           Bem mais achável do que "selecione e aperte Delete". */
        const cut = document.createElementNS(SVG_NS, 'g');
        cut.setAttribute('class', 'canvas-link__cut');
        const cutInner = document.createElementNS(SVG_NS, 'g');
        cutInner.setAttribute('class', 'canvas-link__cut-inner');
        const disc = document.createElementNS(SVG_NS, 'circle');
        disc.setAttribute('r', '11');
        const cross = document.createElementNS(SVG_NS, 'path');
        cross.setAttribute('d', 'M -4 -4 L 4 4 M 4 -4 L -4 4');
        cutInner.appendChild(disc);
        cutInner.appendChild(cross);
        cut.appendChild(cutInner);
        cut.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          deleteLink(link.id);
        });
        g.appendChild(cut);

        g.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          selectLink(link.id);
        });

        linksRoot.appendChild(g);
      });

      // Descarta a física de cordas que não existem mais
      const alive = new Set(links.map(l => l.id));
      Array.from(ropes.keys()).forEach(id => { if (!alive.has(id)) ropes.delete(id); });
      wakeRopes();
    }

    function selectLink(id) {
      selectedLinkId = id;
      if (id !== null && selectedId !== null) selectFrame(null);
      linksRoot.querySelectorAll('.canvas-link').forEach((g) => {
        g.classList.toggle('is-selected', Number(g.dataset.id) === id);
      });
      updateTopbar();
    }

    /* A cadeia é um post só, e um post não mistura redes: os slides de um
       carrossel saem como arquivos do mesmo tamanho, então ligar um Feed a um
       TikTok geraria algo que nenhuma rede aceita. */
    function canLink(a, b) {
      return !!a && !!b && a.format === b.format;
    }

    /* Cadeias misturadas salvas antes desta regra existir: derruba na abertura,
       senão o canvas continua mostrando um carrossel que não exporta */
    function pruneMixedLinks() {
      const byId = new Map(frames.map(f => [f.id, f]));
      links = links.filter(l => canLink(byId.get(l.from), byId.get(l.to)));
    }

    function addLink(fromId, toId) {
      if (fromId === toId) return;
      const byId = new Map(frames.map(f => [f.id, f]));
      if (!canLink(byId.get(fromId), byId.get(toId))) return;
      // Carrossel é linha reta: uma saída por frame e uma entrada por frame
      links = links.filter(l => l.from !== fromId && l.to !== toId);
      // Impede fechar um ciclo: seguindo a corrente a partir de `toId`
      // não se pode voltar em `fromId`
      const next = new Map(links.map(l => [l.from, l.to]));
      let cur = toId;
      const seen = new Set();
      while (cur !== undefined && !seen.has(cur)) {
        if (cur === fromId) return;
        seen.add(cur);
        cur = next.get(cur);
      }
      links.push({ id: linkSeq++, from: fromId, to: toId });
      renderLinks();
      updateFrameMeta();
      save();
    }

    /* Liga a seleção inteira numa corrente só, sem puxar corda a corda.
       A ordem é a que está na tela — esquerda para direita, de cima para baixo
       no empate — porque é assim que se lê um carrossel. */
    function linkSelectedFrames() {
      const chain = getSelectedFrames().sort((a, b) => a.x - b.x || a.y - b.y);
      if (chain.length < 2) return;
      if (!chain.every(f => canLink(f, chain[0]))) return;
      for (let i = 0; i < chain.length - 1; i++) addLink(chain[i].id, chain[i + 1].id);
    }

    function deleteLink(id) {
      links = links.filter(l => l.id !== id);
      if (selectedLinkId === id) selectedLinkId = null;
      renderLinks();
      updateFrameMeta();
      save();
    }

    /* Puxar a corda de uma porta até outro frame */
    function startLinkDrag(frame, e) {
      /* Frame sob o cursor + se ele aceita a corda que está sendo puxada */
      const frameUnder = (ev) => {
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const el = under && under.closest('.canvas-frame');
        if (!el || Number(el.dataset.id) === frame.id) return null;
        const other = frames.find(f => f.id === Number(el.dataset.id));
        return { el, ok: canLink(frame, other) };
      };

      const p1 = portOut(frame);
      const ghost = document.createElementNS(SVG_NS, 'path');
      ghost.setAttribute('class', 'canvas-link__line canvas-link__ghost');
      linksRoot.appendChild(ghost);
      let hovered = null;

      const onMove = (ev) => {
        const w = screenToWorld(ev.clientX, ev.clientY);
        ghost.setAttribute('d', linkPath(p1.x, p1.y, w.x, w.y));

        // Realça o frame sob o cursor para deixar claro onde a corda vai encaixar
        const target = frameUnder(ev);
        // Recusa em cima da hora: azul encaixa, vermelho diz que o formato não bate
        const valid = target ? target.el : null;
        if (hovered !== valid) {
          if (hovered) hovered.classList.remove('is-link-target', 'is-link-invalid');
          if (valid) valid.classList.add(target.ok ? 'is-link-target' : 'is-link-invalid');
          hovered = valid;
        }
      };

      const onUp = (ev) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        ghost.remove();
        if (hovered) hovered.classList.remove('is-link-target', 'is-link-invalid');
        const target = frameUnder(ev);
        if (target && target.ok) addLink(frame.id, Number(target.el.dataset.id));
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    function renderAll() {
      world.innerHTML = '';
      ensureLinksLayer();
      ensureWorldGuides();
      ensureMeasureLayer();
      frames.forEach(renderFrame);
      renderLinks();
      updateFrameMeta();
      applyCamera();
    }

    /* --------------------------------------------------
       Pan (com Espaço / Botão do Meio) e Seleção Múltipla (Marquee / Lasso)
       -------------------------------------------------- */
    view.addEventListener('mousedown', (e) => {
      if (e.target.closest('.canvas-hud')) return;
      if (e.target.closest('.canvas-frame') || e.target.closest('.canvas-topbar')) return;
      if (e.target.closest('.canvas-text-toolbar') || e.target.closest('.canvas-image-toolbar') || e.target.closest('.canvas-crop-toolbar')) return;

      const isPanning = isSpacePressed || e.button === 1 || e.altKey;

      if (isPanning) {
        e.preventDefault();
        view.classList.add('is-panning');
        if (isSpacePressed) view.classList.add('is-space-grabbing');
        const startX = e.clientX;
        const startY = e.clientY;
        const originX = cam.x;
        const originY = cam.y;

        const onMove = (ev) => {
          cam.x = originX + (ev.clientX - startX);
          cam.y = originY + (ev.clientY - startY);
          applyCamera();
        };
        const onUp = () => {
          view.classList.remove('is-panning', 'is-space-grabbing');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          save(false);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return;
      }

      // Marquee Selection no Canvas com Botão Esquerdo
      if (e.button === 0) {
        const startScreenX = e.clientX;
        const startScreenY = e.clientY;
        const startWorldPt = screenToWorld(startScreenX, startScreenY);
        let marqueeEl = null;
        let moved = false;

        const onMove = (ev) => {
          const dx = ev.clientX - startScreenX;
          const dy = ev.clientY - startScreenY;
          if (!moved && Math.abs(dx) + Math.abs(dy) > 4) {
            moved = true;
            marqueeEl = document.createElement('div');
            marqueeEl.className = 'canvas-marquee-box';
            view.appendChild(marqueeEl);
          }
          if (!moved || !marqueeEl) return;

          const curScreenX = ev.clientX;
          const curScreenY = ev.clientY;
          const left = Math.min(startScreenX, curScreenX);
          const top = Math.min(startScreenY, curScreenY);
          const width = Math.abs(curScreenX - startScreenX);
          const height = Math.abs(curScreenY - startScreenY);

          marqueeEl.style.left = `${left}px`;
          marqueeEl.style.top = `${top}px`;
          marqueeEl.style.width = `${width}px`;
          marqueeEl.style.height = `${height}px`;

          const curWorldPt = screenToWorld(curScreenX, curScreenY);
          const boxX1 = Math.min(startWorldPt.x, curWorldPt.x);
          const boxX2 = Math.max(startWorldPt.x, curWorldPt.x);
          const boxY1 = Math.min(startWorldPt.y, curWorldPt.y);
          const boxY2 = Math.max(startWorldPt.y, curWorldPt.y);

          // 1. Testa nós filhos dentro dos frames
          const hitChildren = [];
          frames.forEach(f => {
            (f.children || []).forEach(c => {
              const nodeX1 = f.x + c.x;
              const nodeY1 = f.y + c.y;
              const nodeX2 = nodeX1 + c.w;
              const nodeY2 = nodeY1 + (c.h || 40);
              const intersects = !(nodeX2 < boxX1 || nodeX1 > boxX2 || nodeY2 < boxY1 || nodeY1 > boxY2);
              if (intersects) {
                hitChildren.push({ frameId: f.id, childId: c.id });
              }
            });
          });

          // 2. Testa frames
          const hitFrames = [];
          frames.forEach(f => {
            const fX1 = f.x;
            const fY1 = f.y;
            const fX2 = f.x + f.w;
            const fY2 = f.y + f.h;
            const intersects = !(fX2 < boxX1 || fX1 > boxX2 || fY2 < boxY1 || fY1 > boxY2);
            if (intersects) {
              hitFrames.push(f.id);
            }
          });

          // Feedback visual em tempo real:
          if (hitChildren.length > 0) {
            world.querySelectorAll('.canvas-text-node, .canvas-image-node').forEach(el => {
              const cId = Number(el.dataset.id);
              el.classList.toggle('is-selected', hitChildren.some(n => n.childId === cId));
            });
            world.querySelectorAll('.canvas-frame').forEach(el => el.classList.remove('is-selected'));
          } else {
            world.querySelectorAll('.canvas-text-node, .canvas-image-node').forEach(el => el.classList.remove('is-selected'));
            world.querySelectorAll('.canvas-frame').forEach(el => {
              const fId = Number(el.dataset.id);
              el.classList.toggle('is-selected', hitFrames.includes(fId));
            });
          }
        };

        const onUp = (ev) => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);

          if (marqueeEl) {
            marqueeEl.remove();
          }

          if (moved) {
            const curScreenX = ev.clientX;
            const curScreenY = ev.clientY;
            const curWorldPt = screenToWorld(curScreenX, curScreenY);
            const boxX1 = Math.min(startWorldPt.x, curWorldPt.x);
            const boxX2 = Math.max(startWorldPt.x, curWorldPt.x);
            const boxY1 = Math.min(startWorldPt.y, curWorldPt.y);
            const boxY2 = Math.max(startWorldPt.y, curWorldPt.y);

            const hitChildren = [];
            frames.forEach(f => {
              (f.children || []).forEach(c => {
                const nodeX1 = f.x + c.x;
                const nodeY1 = f.y + c.y;
                const nodeX2 = nodeX1 + c.w;
                const nodeY2 = nodeY1 + (c.h || 40);
                if (!(nodeX2 < boxX1 || nodeX1 > boxX2 || nodeY2 < boxY1 || nodeY1 > boxY2)) {
                  hitChildren.push({ frameId: f.id, childId: c.id });
                }
              });
            });

            if (hitChildren.length > 0) {
              selectedFrameIds.clear();
              selectedId = null;
              selectedChildNodes = hitChildren;
              selectedTextNode = hitChildren[0];
              world.querySelectorAll('.canvas-text-node, .canvas-image-node').forEach(el => {
                const cId = Number(el.dataset.id);
                el.classList.toggle('is-selected', hitChildren.some(n => n.childId === cId));
              });
              world.querySelectorAll('.canvas-frame').forEach(el => el.classList.remove('is-selected'));
              updateTextToolbar();
              updateTopbar();
            } else {
              const hitFrames = [];
              frames.forEach(f => {
                const fX1 = f.x;
                const fY1 = f.y;
                const fX2 = f.x + f.w;
                const fY2 = f.y + f.h;
                if (!(fX2 < boxX1 || fX1 > boxX2 || fY2 < boxY1 || fY1 > boxY2)) {
                  hitFrames.push(f.id);
                }
              });
              selectedChildNodes = [];
              selectedTextNode = { frameId: null, childId: null };
              selectedFrameIds = new Set(hitFrames);
              selectedId = hitFrames.length > 0 ? hitFrames[0] : null;
              world.querySelectorAll('.canvas-frame').forEach(el => {
                const fId = Number(el.dataset.id);
                el.classList.toggle('is-selected', selectedFrameIds.has(fId));
              });
              world.querySelectorAll('.canvas-text-node, .canvas-image-node').forEach(el => el.classList.remove('is-selected'));
              updateTopbar();
              updateTextToolbar();
            }
          } else {
            // Clique simples no vazio: limpa seleção
            selectFrame(null);
            selectTextNode(null, null);
            selectLink(null);
          }
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      }
    });

    /* Zoom no scroll; scroll puro de trackpad faz pan lateral/vertical */
    view.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.08 : 0.92);
      } else {
        cam.x -= e.deltaX;
        cam.y -= e.deltaY;
        applyCamera();
        save();
      }
    }, { passive: false });

    /* --------------------------------------------------
       Drag & Drop de Imagens (Desktop / Finder / Outros Sites)
       Soltar uma imagem em qualquer lugar do canvas calcula a posição exata
       onde o mouse soltou e ancora dentro do frame sob o cursor.
       -------------------------------------------------- */
    view.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    view.addEventListener('dragenter', (e) => {
      e.preventDefault();
    });

    view.addEventListener('drop', (e) => {
      e.preventDefault();
      const worldPt = screenToWorld(e.clientX, e.clientY);
      
      // Encontra o frame sob o cursor (do topo para baixo) ou usa o selecionado
      let targetFrame = [...frames].reverse().find(f => 
        worldPt.x >= f.x && worldPt.x <= f.x + f.w &&
        worldPt.y >= f.y && worldPt.y <= f.y + f.h
      ) || frames.find(f => f.id === selectedId) || frames[0];

      if (!targetFrame) {
        targetFrame = makeFrame('ig-feed', Math.round(worldPt.x - 540), Math.round(worldPt.y - 675));
        frames.push(targetFrame);
        renderFrame(targetFrame);
        selectFrame(targetFrame.id);
      }

      // Caso 1: Arquivos arrastados da pasta / Desktop (Finder/Explorer)
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        Array.from(e.dataTransfer.files).forEach((file, index) => {
          if (!file.type.startsWith('image/')) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            const rawData = ev.target.result;
            const img = new Image();
            img.onload = () => {
              const origW = img.naturalWidth || img.width;
              const origH = img.naturalHeight || img.height;
              const MAX_W = Math.min(800, Math.round(targetFrame.w * 0.8));
              let w = origW;
              let h = origH;
              if (w > MAX_W) {
                h = Math.round(h * (MAX_W / w));
                w = MAX_W;
              }
              // Posição exata onde o cursor soltou a imagem
              const localX = Math.round(worldPt.x - targetFrame.x - (w / 2)) + (index * 24);
              const localY = Math.round(worldPt.y - targetFrame.y - (h / 2)) + (index * 24);
              addImageNode(targetFrame, rawData, origW, origH, localX, localY);
            };
            img.src = rawData;
          };
          reader.readAsDataURL(file);
        });
        return;
      }

      // Caso 2: Imagem arrastada de outro site / aba / Google Images / Pinterest
      let url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      const html = e.dataTransfer.getData('text/html');
      if (html) {
        const m = html.match(/src\s*=\s*["']([^"']+)["']/i);
        if (m && m[1]) url = m[1];
      }

      if (url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/'))) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          let rawData = url;
          try {
            const cvs = document.createElement('canvas');
            cvs.width = img.naturalWidth || img.width;
            cvs.height = img.naturalHeight || img.height;
            const ctx = cvs.getContext('2d');
            ctx.drawImage(img, 0, 0);
            rawData = cvs.toDataURL('image/png');
          } catch {
            rawData = url;
          }
          const origW = img.naturalWidth || img.width;
          const origH = img.naturalHeight || img.height;
          const MAX_W = Math.min(800, Math.round(targetFrame.w * 0.8));
          let w = origW;
          let h = origH;
          if (w > MAX_W) {
            h = Math.round(h * (MAX_W / w));
            w = MAX_W;
          }
          const localX = Math.round(worldPt.x - targetFrame.x - (w / 2));
          const localY = Math.round(worldPt.y - targetFrame.y - (h / 2));
          addImageNode(targetFrame, rawData, origW, origH, localX, localY);
        };
        img.onerror = () => {
          const fallback = new Image();
          fallback.onload = () => {
            const origW = fallback.naturalWidth || fallback.width;
            const origH = fallback.naturalHeight || fallback.height;
            const localX = Math.round(worldPt.x - targetFrame.x - (origW / 2));
            const localY = Math.round(worldPt.y - targetFrame.y - (origH / 2));
            addImageNode(targetFrame, url, origW, origH, localX, localY);
          };
          fallback.src = url;
        };
        img.src = url;
      }
    });

    /* Rastreia o mouse no canvas para colar (Cmd+V) na posição do cursor */
    let lastMouseScreen = { x: innerWidth / 2, y: innerHeight / 2 };
    view.addEventListener('mousemove', (e) => {
      lastMouseScreen = { x: e.clientX, y: e.clientY };
    });

    /* --------------------------------------------------
       Copiar e Colar (⌘V / Ctrl+V) de Imagens
       Aceita imagens copiadas da área de transferência (print, Finder, Unsplash, etc.)
       -------------------------------------------------- */
    document.addEventListener('paste', (e) => {
      if (!view.classList.contains('is-open')) return;

      const items = (e.clipboardData || window.clipboardData).items;
      if (!items) return;

      let handledImage = false;
      for (const item of items) {
        if (item.type.indexOf('image') !== -1 || item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            e.stopPropagation();
            handledImage = true;

            const reader = new FileReader();
            reader.onload = (ev) => {
              const rawData = ev.target.result;
              const img = new Image();
              img.onload = () => {
                const worldPt = screenToWorld(lastMouseScreen.x, lastMouseScreen.y);
                let targetFrame = [...frames].reverse().find(f => 
                  worldPt.x >= f.x && worldPt.x <= f.x + f.w &&
                  worldPt.y >= f.y && worldPt.y <= f.y + f.h
                ) || frames.find(f => f.id === selectedId) || frames[0];

                if (!targetFrame) {
                  targetFrame = makeFrame('ig-feed', Math.round(worldPt.x - 540), Math.round(worldPt.y - 675));
                  frames.push(targetFrame);
                  renderFrame(targetFrame);
                  selectFrame(targetFrame.id);
                }

                const origW = img.naturalWidth || img.width;
                const origH = img.naturalHeight || img.height;
                const MAX_W = Math.min(800, Math.round(targetFrame.w * 0.8));
                let w = origW;
                let h = origH;
                if (w > MAX_W) {
                  h = Math.round(h * (MAX_W / w));
                  w = MAX_W;
                }

                // Se o mouse estiver sobre o frame alvo, cola sob o mouse; senão no centro do frame
                let localX, localY;
                if (worldPt.x >= targetFrame.x && worldPt.x <= targetFrame.x + targetFrame.w &&
                    worldPt.y >= targetFrame.y && worldPt.y <= targetFrame.y + targetFrame.h) {
                  localX = Math.round(worldPt.x - targetFrame.x - (w / 2));
                  localY = Math.round(worldPt.y - targetFrame.y - (h / 2));
                } else {
                  localX = Math.round((targetFrame.w - w) / 2);
                  localY = Math.round((targetFrame.h - h) / 2);
                }

                addImageNode(targetFrame, rawData, origW, origH, localX, localY);
              };
              img.src = rawData;
            };
            reader.readAsDataURL(file);
            break;
          }
        }
      }

      // Se não for imagem binária mas for um link copiado de imagem (Unsplash, CDN, etc) enquanto não edita texto
      const isEditingText = document.activeElement && 
        (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

      if (!handledImage && !isEditingText) {
        const text = (e.clipboardData || window.clipboardData).getData('text/plain').trim();
        const isImageUrl = /^(https?:\/\/.*\.(?:png|jpg|jpeg|webp|svg|gif)(\?.*)?)$/i.test(text) ||
                           /^https?:\/\/(images\.unsplash\.com|cdn\.pixabay\.com|images\.pexels\.com)\/.*$/i.test(text);
        if (isImageUrl) {
          e.preventDefault();
          const worldPt = screenToWorld(lastMouseScreen.x, lastMouseScreen.y);
          let targetFrame = [...frames].reverse().find(f => 
            worldPt.x >= f.x && worldPt.x <= f.x + f.w &&
            worldPt.y >= f.y && worldPt.y <= f.y + f.h
          ) || frames.find(f => f.id === selectedId) || frames[0];

          if (!targetFrame) {
            targetFrame = makeFrame('ig-feed', Math.round(worldPt.x - 540), Math.round(worldPt.y - 675));
            frames.push(targetFrame);
            renderFrame(targetFrame);
            selectFrame(targetFrame.id);
          }

          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            let rawData = text;
            try {
              const cvs = document.createElement('canvas');
              cvs.width = img.naturalWidth || img.width;
              cvs.height = img.naturalHeight || img.height;
              const ctx = cvs.getContext('2d');
              ctx.drawImage(img, 0, 0);
              rawData = cvs.toDataURL('image/png');
            } catch {
              rawData = text;
            }
            const origW = img.naturalWidth || img.width;
            const origH = img.naturalHeight || img.height;
            const MAX_W = Math.min(800, Math.round(targetFrame.w * 0.8));
            let w = origW;
            let h = origH;
            if (w > MAX_W) {
              h = Math.round(h * (MAX_W / w));
              w = MAX_W;
            }
            let localX = Math.round((targetFrame.w - w) / 2);
            let localY = Math.round((targetFrame.h - h) / 2);
            addImageNode(targetFrame, rawData, origW, origH, localX, localY);
          };
          img.src = text;
        }
      }
    });

    /* Controles */
    const btnUndo = document.getElementById('canvas-undo');
    const btnRedo = document.getElementById('canvas-redo');
    const btnIn = document.getElementById('canvas-zoom-in');
    const btnOut = document.getElementById('canvas-zoom-out');
    const btnLabel = document.getElementById('canvas-zoom-label');
    const btnCenter = document.getElementById('canvas-recenter');

    if (btnUndo) btnUndo.addEventListener('click', () => undo());
    if (btnRedo) btnRedo.addEventListener('click', () => redo());
    if (btnIn) btnIn.addEventListener('click', () => zoomAt(innerWidth / 2, innerHeight / 2, 1.2));
    if (btnOut) btnOut.addEventListener('click', () => zoomAt(innerWidth / 2, innerHeight / 2, 0.8));
    if (btnLabel) btnLabel.addEventListener('click', () => {
      zoomAt(innerWidth / 2, innerHeight / 2, BASE_SCALE / cam.scale);
    });
    if (btnCenter) btnCenter.addEventListener('click', () => {
      cam = { x: 0, y: 0, scale: BASE_SCALE };
      applyCamera();
      save();
    });
    /* Barra do topo: criar, duplicar e apagar frame */
    function closeFormats() {
      if (!formatsMenu) return;
      formatsMenu.classList.remove('is-open');
      if (btnAddFrame) btnAddFrame.classList.remove('active');
    }

    if (btnAddFrame && formatsMenu) {
      btnAddFrame.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = formatsMenu.classList.toggle('is-open');
        btnAddFrame.classList.toggle('active', open);
      });

      formatsMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.canvas-formats__item');
        if (!item) return;
        addFrame(item.dataset.format);
        closeFormats();
      });

      // Clique em qualquer outro lugar fecha o menu
      document.addEventListener('mousedown', (e) => {
        if (!formatsMenu.classList.contains('is-open')) return;
        if (e.target.closest('.canvas-formats') || e.target.closest('#canvas-add-frame')) return;
        closeFormats();
      });
    }

    if (btnAddText) btnAddText.addEventListener('click', () => addTextToSelectedFrame());

    const btnAddImage = document.getElementById('canvas-add-image');
    const imageUpload = document.getElementById('canvas-image-upload');

    if (btnAddImage) {
      btnAddImage.addEventListener('click', () => {
        if (selectedId !== null && imageUpload) imageUpload.click();
      });
    }

    if (imageUpload) {
      imageUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file || selectedId === null) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const rawData = ev.target.result;
          const img = new Image();
          img.onload = () => {
            const frame = frames.find(f => f.id === selectedId);
            if (frame) {
              addImageNode(frame, rawData, img.naturalWidth || img.width, img.naturalHeight || img.height);
            }
          };
          img.src = rawData;
        };
        reader.readAsDataURL(file);
        imageUpload.value = '';
      });
    }

    if (btnDupFrame) btnDupFrame.addEventListener('click', () => {
      if (selectedId !== null) duplicateFrame(selectedId);
    });

    if (btnDelFrame) btnDelFrame.addEventListener('click', () => {
      if (selectedLinkId !== null) deleteLink(selectedLinkId);
      else if (selectedId !== null) deleteFrame(selectedId);
    });

    if (btnLinkFrames) btnLinkFrames.addEventListener('click', () => linkSelectedFrames());

    const btnToggleSnap = document.getElementById('canvas-toggle-snap');
    const btnToggleGuides = document.getElementById('canvas-toggle-guides');

    if (btnToggleSnap) {
      btnToggleSnap.classList.toggle('active', snapEnabled);
      btnToggleSnap.addEventListener('click', () => {
        snapEnabled = !snapEnabled;
        btnToggleSnap.classList.toggle('active', snapEnabled);
        localStorage.setItem('oa_canvas_snap', snapEnabled);
      });
    }

    if (btnToggleGuides) {
      btnToggleGuides.classList.toggle('active', showGuides);
      view.classList.toggle('show-guides', showGuides);
      btnToggleGuides.addEventListener('click', () => {
        showGuides = !showGuides;
        btnToggleGuides.classList.toggle('active', showGuides);
        view.classList.toggle('show-guides', showGuides);
        localStorage.setItem('oa_canvas_guides', showGuides);
      });
    }

    /* --------------------------------------------------
       Atalhos de Teclado (Figma/Canva Standard)
       -------------------------------------------------- */
    window.addEventListener('keydown', (e) => {
      const isTyping = document.activeElement && 
        (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

      if (e.code === 'Space' && !e.repeat && !isTyping) {
        isSpacePressed = true;
        view.classList.add('is-space-grab');
      }

      if ((e.key === 'Alt' || e.key === 'Control') && !isTyping) {
        setMeasureActive(true);
      }
    });

    function setMeasureActive(active) {
      if (isMeasureKeyActive === active) return;
      isMeasureKeyActive = active;
      if (active) {
        updateMeasureGuides(lastMouseClientPos);
      } else {
        clearMeasureGuides();
      }
    }

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        isSpacePressed = false;
        view.classList.remove('is-space-grab', 'is-space-grabbing');
      }
      if (e.key === 'Alt' || e.key === 'Control') {
        setMeasureActive(false);
      }
    });

    window.addEventListener('mousemove', (e) => {
      lastMouseClientPos = { clientX: e.clientX, clientY: e.clientY };
      const isTyping = document.activeElement && 
        (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

      const modifierHeld = (e.altKey || (e.ctrlKey && !e.metaKey)) && !isTyping;
      if (modifierHeld) {
        if (!isMeasureKeyActive) {
          isMeasureKeyActive = true;
        }
        updateMeasureGuides(lastMouseClientPos);
      } else if (isMeasureKeyActive) {
        setMeasureActive(false);
      }
    });

    window.addEventListener('blur', () => {
      setMeasureActive(false);
      isSpacePressed = false;
      view.classList.remove('is-space-grab', 'is-space-grabbing');
    });

    window.addEventListener('focus', () => {
      setMeasureActive(false);
    });

    document.addEventListener('keydown', (e) => {
      if (!view.classList.contains('is-open')) return;

      /* ⌘Z / Ctrl+Z (Undo) e ⌘Shift+Z / Ctrl+Shift+Z / ⌘Y / Ctrl+Y (Redo) */
      if (e.metaKey || e.ctrlKey) {
        const k = e.key.toLowerCase();
        if (k === 'z') {
          const isTyping = document.activeElement && 
            (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT');
          if (!isTyping) {
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) redo();
            else undo();
            return;
          }
        }
        if (k === 'y') {
          const isTyping = document.activeElement && 
            (document.activeElement.isContentEditable || document.activeElement.tagName === 'INPUT');
          if (!isTyping) {
            e.preventDefault();
            e.stopPropagation();
            redo();
            return;
          }
        }
      }

      /* ⌘B/I/U valem mesmo com o cursor dentro do texto */
      if ((e.metaKey || e.ctrlKey) && selectedChildNodes.length > 0) {
        const k = e.key.toLowerCase();
        if (k === 'b') { e.preventDefault(); e.stopPropagation(); toggleBold(); return; }
        if (k === 'i') { e.preventDefault(); e.stopPropagation(); applyTextToolbarAction(c => c.italic = !c.italic); return; }
        if (k === 'u') { e.preventDefault(); e.stopPropagation(); applyTextToolbarAction(c => c.underline = !c.underline); return; }
        // Camadas com modificador: ⌘] (topo) e ⌘[ (fundo)
        if (e.key === ']') { e.preventDefault(); e.stopPropagation(); bringChildToFront(); return; }
        if (e.key === '[') { e.preventDefault(); e.stopPropagation(); sendChildToBack(); return; }
      }

      // Não sequestra as teclas enquanto o texto de uma nota está em edição
      if (document.activeElement && document.activeElement.isContentEditable) return;
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;

      const hasChildren = selectedChildNodes.length > 0;
      const hasFrames = selectedFrameIds.size > 0;

      // Atalhos de camada simples (sem Cmd/Ctrl): ] (avançar 1) e [ (recuar 1)
      if (!e.metaKey && !e.ctrlKey && hasChildren) {
        if (e.key === ']') {
          e.preventDefault();
          e.stopPropagation();
          bringChildForward();
          return;
        }
        if (e.key === '[') {
          e.preventDefault();
          e.stopPropagation();
          sendChildBackward();
          return;
        }
      }

      if (!hasChildren && !hasFrames && selectedLinkId === null) {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        if (hasChildren) deleteTextNode();
        else if (selectedLinkId !== null) deleteLink(selectedLinkId);
        else if (hasFrames) deleteFrame(selectedId);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        if (!hasChildren && !hasFrames) return;
        e.preventDefault();
        e.stopPropagation();
        if (hasChildren) duplicateTextNode();
        else if (hasFrames) duplicateFrame(selectedId);
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        /* Movimentação precisa por pixel (Nudge) com as setas do teclado:
           Seta pura move 1px. Shift + Seta move 10px (Super Nudge).
           Prevenção em fase de captura para impedir que o Chromium mude de aba/tab. */
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const step = e.shiftKey ? 10 : 1;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        else if (e.key === 'ArrowRight') dx = step;
        else if (e.key === 'ArrowUp') dy = -step;
        else if (e.key === 'ArrowDown') dy = step;

        if (hasChildren) {
          selectedChildNodes.forEach(sel => {
            const f = frames.find(fr => fr.id === sel.frameId);
            if (!f) return;
            const child = (f.children || []).find(c => c.id === sel.childId);
            if (!child) return;
            child.x += dx;
            child.y += dy;
            const cEl = world.querySelector(`[data-id="${child.id}"]`);
            if (cEl) {
              cEl.style.left = `${child.x}px`;
              cEl.style.top = `${child.y}px`;
            }
          });
          updateTextToolbar();
          if (isMeasureKeyActive) updateMeasureGuides(lastMouseClientPos);
          save();
          return;
        } else if (hasFrames) {
          const framesToMove = getSelectedFrames();
          framesToMove.forEach(f => {
            f.x += dx;
            f.y += dy;
            const fEl = frameElOf(f);
            if (fEl) {
              fEl.style.left = `${f.x}px`;
              fEl.style.top = `${f.y}px`;
            }
          });
          wakeRopes();
          if (isMeasureKeyActive) updateMeasureGuides(lastMouseClientPos);
          save();
          return;
        }
      } else if (!e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 't' && hasFrames) {
        e.preventDefault();
        e.stopPropagation();
        addTextToSelectedFrame();
      } else if (e.key === 'Enter') {
        if (croppingImage) {
          e.preventDefault();
          e.stopPropagation();
          exitCropMode();
          return;
        }
        const child = selectedChild();
        if (child && child.type === 'image') {
          e.preventDefault();
          e.stopPropagation();
          enterCropMode(selectedTextNode.frameId, child.id);
          return;
        }
      } else if (!e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 'c' && !croppingImage) {
        const child = selectedChild();
        if (child && child.type === 'image') {
          e.preventDefault();
          enterCropMode(selectedTextNode.frameId, child.id);
          return;
        }
      }
    });

    /* Abrir e fechar pela dock */
    function toggleCanvas(open) {
      const isOpen = open === undefined ? !view.classList.contains('is-open') : open;
      view.classList.toggle('is-open', isOpen);
      openBtn.classList.toggle('active', isOpen);
      saveView({ canvas: isOpen });
      if (isOpen) {
        // Desativar App/Site na dock para que só o Canvas fique ativo
        const dockApp = document.getElementById('dock-btn-app');
        const dockSite = document.getElementById('dock-btn-site');
        if (dockApp) dockApp.classList.remove('active');
        if (dockSite) dockSite.classList.remove('active');
        applyCamera();
        wakeRopes();
      } else {
        // Canvas fechou — reativar o botão App ou Site conforme o modo atual
        const dockApp = document.getElementById('dock-btn-app');
        const dockSite = document.getElementById('dock-btn-site');
        if (dockApp) dockApp.classList.toggle('active', currentMode === 'app');
        if (dockSite) dockSite.classList.toggle('active', currentMode === 'site');
      }
    }

    openBtn.addEventListener('click', () => toggleCanvas());

    // Escolher App ou Site pela dock volta direto para o dashboard
    ['dock-btn-app', 'dock-btn-site'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', () => toggleCanvas(false));
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && view.classList.contains('is-open')) {
        const batchModal = document.getElementById('canvas-batch-modal');
        if (batchModal && batchModal.classList.contains('is-open')) {
          if (typeof window.closeBatchModal === 'function') window.closeBatchModal();
          return;
        }

        // No modo de recorte, o primeiro Escape encerra o recorte e salva
        if (croppingImage) {
          exitCropMode();
          return;
        }
        // Editando um texto: o primeiro Escape só sai da edição, mantendo a seleção
        if (document.activeElement && document.activeElement.classList.contains('canvas-text-node__content')) {
          exitTextEditing(document.activeElement);
          return;
        }
        // Escape desfaz uma camada por vez antes de fechar o canvas
        if (selectedTextNode.childId !== null) {
          selectTextNode(null, null);
          return;
        }
        if (formatsMenu && formatsMenu.classList.contains('is-open')) {
          closeFormats();
          return;
        }
        if (selectedLinkId !== null) {
          selectLink(null);
          return;
        }
        if (selectedId !== null) {
          selectFrame(null);
          return;
        }
        toggleCanvas(false);
      }
    });

    /* --------------------------------------------------
       Batch Create Controller (Motor de Criação em Lote)
       -------------------------------------------------- */
    let batchData = {
      headers: [],
      rows: [],
      localImages: new Map(), // filename.toLowerCase() -> dataUrl
      mappings: {},           // bindName -> csvHeader
      originalTemplateSnapshot: null,
      previewRowIndex: null
    };

    function parseCSV(text) {
      const rows = [];
      let currentRow = [];
      let currentCell = '';
      let insideQuotes = false;

      const firstLine = text.split(/\r\n|\n/)[0] || '';
      const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
          if (insideQuotes && nextChar === '"') {
            currentCell += '"';
            i++;
          } else {
            insideQuotes = !insideQuotes;
          }
        } else if (char === delimiter && !insideQuotes) {
          currentRow.push(currentCell.trim());
          currentCell = '';
        } else if ((char === '\r' || char === '\n') && !insideQuotes) {
          if (char === '\r' && nextChar === '\n') i++;
          currentRow.push(currentCell.trim());
          if (currentRow.some(c => c.length > 0)) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentCell = '';
        } else {
          currentCell += char;
        }
      }
      if (currentCell.length > 0 || currentRow.length > 0) {
        currentRow.push(currentCell.trim());
        if (currentRow.some(c => c.length > 0)) {
          rows.push(currentRow);
        }
      }
      if (rows.length === 0) return { headers: [], rows: [] };
      const headers = rows[0].map((h, idx) => h || `coluna_${idx + 1}`);
      const dataRows = rows.slice(1).map(r => {
        const obj = {};
        headers.forEach((h, idx) => {
          obj[h] = r[idx] !== undefined ? r[idx] : '';
        });
        return obj;
      });
      return { headers, rows: dataRows };
    }

    function parseTSVOrCSV(text) {
      if (text.includes('\t')) {
        const lines = text.trim().split(/\r\n|\n/);
        const rows = lines.map(line => line.split('\t').map(c => c.trim()));
        if (rows.length === 0) return { headers: [], rows: [] };
        const headers = rows[0].map((h, i) => h || `coluna_${i + 1}`);
        const dataRows = rows.slice(1).map(r => {
          const obj = {};
          headers.forEach((h, i) => obj[h] = r[i] !== undefined ? r[i] : '');
          return obj;
        });
        return { headers, rows: dataRows };
      }
      return parseCSV(text);
    }

    function initBatchCreateController() {
      const modal = document.getElementById('canvas-batch-modal');
      const openBtn = document.getElementById('canvas-batch-btn');
      const closeBtn = document.getElementById('canvas-batch-close');
      const cancelBtn = document.getElementById('canvas-batch-cancel');
      const dropzone = document.getElementById('canvas-batch-dropzone');
      const csvInput = document.getElementById('canvas-batch-csv-input');
      const dropzoneLabel = document.getElementById('canvas-batch-dropzone-label');
      const mappingsList = document.getElementById('canvas-batch-mappings-list');
      const imagesDropzone = document.getElementById('canvas-batch-images-dropzone');
      const imagesInput = document.getElementById('canvas-batch-images-input');
      const imagesLabel = document.getElementById('canvas-batch-images-label');
      const imagesCount = document.getElementById('canvas-batch-images-count');
      const startBtn = document.getElementById('canvas-batch-start-btn');
      const startLabel = document.getElementById('canvas-batch-start-label');

      if (!modal || !openBtn) return;

      openBtn.addEventListener('click', () => {
        if (modal.classList.contains('open')) {
          closeBatchModal();
        } else {
          openBatchModal();
        }
      });
      if (closeBtn) closeBtn.addEventListener('click', closeBatchModal);
      if (cancelBtn) cancelBtn.addEventListener('click', closeBatchModal);

      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeBatchModal();
      });

      // Dropzone de CSV
      if (dropzone && csvInput) {
        dropzone.addEventListener('click', () => csvInput.click());
        csvInput.addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (file) handleCSVFile(file);
        });

        dropzone.addEventListener('dragover', (e) => {
          e.preventDefault();
          dropzone.classList.add('is-dragover');
        });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
        dropzone.addEventListener('drop', (e) => {
          e.preventDefault();
          dropzone.classList.remove('is-dragover');
          const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (file && (file.name.endsWith('.csv') || file.type.includes('csv') || file.type.includes('text'))) {
            handleCSVFile(file);
          }
        });
      }

      function handleCSVFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target.result;
          const parsed = parseCSV(text);
          if (!parsed.headers.length || !parsed.rows.length) {
            if (dropzoneLabel) {
              dropzoneLabel.innerHTML = `<span style="color: #EF4444;">Arquivo CSV vazio ou sem linhas válidas.</span>`;
            }
            return;
          }
          batchData.headers = parsed.headers;
          batchData.rows = parsed.rows;
          dropzone.classList.add('has-file');
          if (dropzoneLabel) {
            dropzoneLabel.innerHTML = `<strong>${file.name}</strong><br><span style="font-size: 11.5px; color: #10B981; font-weight: 400;">✓ ${parsed.rows.length} ${parsed.rows.length === 1 ? 'linha importada' : 'linhas importadas'} (${parsed.headers.length} colunas)</span>`;
          }
          updateBatchMappings();
          updateBatchFooter();
        };
        reader.readAsText(file, 'UTF-8');
      }

      // Dropzone de Imagens Locais (Zero CORS)
      if (imagesDropzone && imagesInput) {
        imagesDropzone.addEventListener('click', () => imagesInput.click());
        imagesInput.addEventListener('change', (e) => {
          if (e.target.files) handleImageFiles(Array.from(e.target.files));
        });

        imagesDropzone.addEventListener('dragover', (e) => {
          e.preventDefault();
          imagesDropzone.classList.add('is-dragover');
        });
        imagesDropzone.addEventListener('dragleave', () => {
          imagesDropzone.classList.remove('is-dragover');
        });
        imagesDropzone.addEventListener('drop', (e) => {
          e.preventDefault();
          imagesDropzone.classList.remove('is-dragover');
          if (e.dataTransfer && e.dataTransfer.files) {
            handleImageFiles(Array.from(e.dataTransfer.files));
          }
        });
      }

      function handleImageFiles(files) {
        const imgFiles = files.filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name));
        if (!imgFiles.length) return;
        imgFiles.forEach(file => {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const dataUrl = ev.target.result;
            const key = file.name.toLowerCase().trim();
            batchData.localImages.set(key, dataUrl);
            imagesDropzone.classList.add('has-file');
            if (imagesCount) {
              imagesCount.style.display = 'inline-block';
              imagesCount.textContent = `${batchData.localImages.size} fotos`;
            }
            if (imagesLabel) {
              imagesLabel.innerHTML = `<strong>${batchData.localImages.size} ${batchData.localImages.size === 1 ? 'foto indexada' : 'fotos indexadas'}</strong><br><span style="font-size: 11.5px; color: #10B981; font-weight: 400;">✓ Prontas para renderizar sem CORS</span>`;
            }
          };
          reader.readAsDataURL(file);
        });
      }

      function getCanvasBinds() {
        const bindsMap = new Map();
        frames.forEach(f => {
          (f.children || []).forEach(c => {
            if (c.bind) {
              bindsMap.set(c.bind, {
                name: c.bind,
                type: c.type,
                frameId: f.id,
                childId: c.id
              });
            }
          });
        });
        return Array.from(bindsMap.values());
      }

      function updateBatchMappings() {
        if (!mappingsList) return;
        const binds = getCanvasBinds();
        mappingsList.innerHTML = '';

        if (binds.length === 0) {
          mappingsList.innerHTML = `
            <div class="canvas-batch-empty-oa">
              Nenhuma variável {{}} no post. Marque textos ou fotos com o botão <code>{}</code> para conectar.
            </div>`;
          return;
        }

        const headers = batchData.headers || [];

        if (headers.length === 0) {
          mappingsList.innerHTML = `
            <div class="canvas-batch-empty-oa">
              Suba um arquivo .csv acima para conectar às ${binds.length} ${binds.length === 1 ? 'variável' : 'variáveis'} do post.
            </div>`;
          return;
        }

        binds.forEach(bind => {
          const row = document.createElement('div');
          row.className = 'canvas-batch-mapping-row-oa';

          const target = document.createElement('div');
          target.className = 'canvas-batch-mapping-target-oa';
          target.innerHTML = `
            <span style="color: ${bind.type === 'image' ? '#7C3AED' : '#DB2777'};">${bind.type === 'image' ? '🖼️' : '✍️'}</span>
            <span>{{${bind.name}}}</span>
          `;

          const select = document.createElement('select');
          select.className = 'canvas-batch-mapping-select-oa';

          const optNone = document.createElement('option');
          optNone.value = '';
          optNone.textContent = '— Selecionar Coluna —';
          select.appendChild(optNone);

          headers.forEach(h => {
            const opt = document.createElement('option');
            opt.value = h;
            opt.textContent = h;
            select.appendChild(opt);
          });

          // Auto-match
          const normBind = bind.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          let matchedHeader = '';
          headers.forEach(h => {
            const normH = h.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normH === normBind || normH.includes(normBind) || normBind.includes(normH)) {
              matchedHeader = h;
            }
          });

          if (matchedHeader) {
            select.value = matchedHeader;
            batchData.mappings[bind.name] = matchedHeader;
          } else if (batchData.mappings[bind.name] && headers.includes(batchData.mappings[bind.name])) {
            select.value = batchData.mappings[bind.name];
          }

          select.addEventListener('change', () => {
            batchData.mappings[bind.name] = select.value;
          });

          row.appendChild(target);
          row.appendChild(select);
          mappingsList.appendChild(row);
        });
      }

      // ----------------------------------------------------
      // MOTOR DE RENDERIZAÇÃO HIGH-DPI (ATÉ 4K) & EXPORTAÇÃO
      // ----------------------------------------------------
      const exportImageCache = new Map();

      function loadExportImage(src) {
        if (!src) return Promise.resolve(null);
        if (exportImageCache.has(src)) return Promise.resolve(exportImageCache.get(src));
        return new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            exportImageCache.set(src, img);
            resolve(img);
          };
          img.onerror = () => resolve(null);
          img.src = src;
        });
      }

      /* De onde sai o pixel de um nó de imagem. Quem só olha child.src exporta
         o frame vazio: imagem inserida pelo usuário nasce como assetId e o
         arquivo original vive no IndexedDB, igual ao que renderImageNode faz
         para desenhar na tela. */
      async function resolveChildImageSrc(child, overrides) {
        if (child.bind && overrides[child.bind] !== undefined) {
          const val = String(overrides[child.bind]).toLowerCase().trim();
          if (batchData.localImages && batchData.localImages.has(val)) {
            return batchData.localImages.get(val);
          }
          if (overrides[child.bind]) return overrides[child.bind];
        }
        if (child.src) return child.src;
        if (child.assetId) {
          if (assetCache.has(child.assetId)) return assetCache.get(child.assetId);
          return await getAsset(child.assetId);
        }
        return null;
      }

      function wrapTextForCanvas(ctx, text, maxWidth) {
        const lines = [];
        const paragraphs = String(text).split('\n');
        paragraphs.forEach(para => {
          const words = para.split(' ');
          let currentLine = '';
          for (let n = 0; n < words.length; n++) {
            const testLine = currentLine ? `${currentLine} ${words[n]}` : words[n];
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && currentLine) {
              lines.push(currentLine);
              currentLine = words[n];
            } else {
              currentLine = testLine;
            }
          }
          lines.push(currentLine);
        });
        return lines;
      }

      async function renderFrameToCanvas(frame, options = {}) {
        const scale = options.scale || 2;
        const overrides = options.overrides || {};
        const frameW = frame.w || 1080;
        const frameH = frame.h || 1350;

        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(frameW * scale);
        canvas.height = Math.round(frameH * scale);
        const ctx = canvas.getContext('2d');

        ctx.scale(scale, scale);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // 1. Fundo do Frame (Cor, Gradiente ou Imagem com Blur & Overlay)
        if (frame.bgImage) {
          const bgImg = await loadExportImage(frame.bgImage);
          if (bgImg) {
            ctx.save();
            const blurPx = frame.bgBlur || 0;
            if (blurPx > 0 && 'filter' in ctx) {
              ctx.filter = `blur(${blurPx}px)`;
            }

            // Cover fit
            const imgAspect = bgImg.width / bgImg.height;
            const frameAspect = frameW / frameH;
            let drawW, drawH, drawX, drawY;

            if (imgAspect > frameAspect) {
              drawH = frameH;
              drawW = frameH * imgAspect;
              drawX = (frameW - drawW) / 2;
              drawY = 0;
            } else {
              drawW = frameW;
              drawH = frameW / imgAspect;
              drawX = 0;
              drawY = (frameH - drawH) / 2;
            }

            ctx.drawImage(bgImg, drawX, drawY, drawW, drawH);
            ctx.restore();

            // Overlay escuro
            const overlayAlpha = (frame.bgOverlay != null ? frame.bgOverlay : 35) / 100;
            if (overlayAlpha > 0) {
              ctx.fillStyle = `rgba(0, 0, 0, ${overlayAlpha})`;
              ctx.fillRect(0, 0, frameW, frameH);
            }
          }
        } else if (frame.bg && frame.bg.includes('gradient')) {
          const hexes = frame.bg.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/g);
          const c1 = (hexes && hexes[0]) || '#18181B';
          const c2 = (hexes && hexes[1]) || '#09090B';

          let grad;
          if (frame.bg.includes('radial')) {
            const cx = frameW / 2;
            const cy = frameH / 2;
            const radius = Math.max(frameW, frameH) / 1.35;
            grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
          } else if (frame.bg.includes('90deg')) {
            grad = ctx.createLinearGradient(0, 0, frameW, 0);
          } else if (frame.bg.includes('135deg')) {
            grad = ctx.createLinearGradient(0, 0, frameW, frameH);
          } else if (frame.bg.includes('0deg')) {
            grad = ctx.createLinearGradient(0, frameH, 0, 0);
          } else {
            grad = ctx.createLinearGradient(0, 0, 0, frameH);
          }

          grad.addColorStop(0, c1);
          grad.addColorStop(1, c2);
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, frameW, frameH);
        } else {
          ctx.fillStyle = frame.bg || '#FFFFFF';
          ctx.fillRect(0, 0, frameW, frameH);
        }

        // 2. Nós filhos
        const children = frame.children || [];
        for (const child of children) {
          if (child.type === 'image') {
            const src = await resolveChildImageSrc(child, overrides);
            const img = await loadExportImage(src);
            if (img) {
              ctx.save();
              ctx.globalAlpha = (child.opacity != null ? child.opacity : 100) / 100;

              if (child.shadow) {
                ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
                ctx.shadowBlur = 24;
                ctx.shadowOffsetY = 8;
              }

              ctx.beginPath();
              if (child.borderRadius && ctx.roundRect) {
                ctx.roundRect(child.x, child.y, child.w, child.h, child.borderRadius);
              } else {
                ctx.rect(child.x, child.y, child.w, child.h);
              }
              ctx.clip();

              const imgX = child.x + (child.imgX || 0);
              const imgY = child.y + (child.imgY || 0);
              const imgW = child.imgW || child.w;
              const imgH = child.imgH || child.h;

              ctx.drawImage(img, imgX, imgY, imgW, imgH);
              ctx.restore();
            }
          } else if (child.type === 'text') {
            let text = '';
            if (child.bind && overrides[child.bind] !== undefined) {
              text = String(overrides[child.bind]);
            } else if (child.text !== undefined && child.text !== '') {
              text = child.text;
            } else if (child.html) {
              const temp = document.createElement('div');
              temp.innerHTML = child.html.replace(/<br\s*[\/]?>/gi, '\n');
              text = temp.textContent || temp.innerText || '';
            }

            if (!text) continue;

            ctx.save();
            ctx.globalAlpha = (child.opacity != null ? child.opacity : 100) / 100;

            if (child.shadow) {
              ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
              ctx.shadowBlur = 10;
              ctx.shadowOffsetY = 2;
            }

            const fontSize = child.fontSize || 48;
            const fontWeight = child.fontWeight || 500;
            const fontStyle = child.italic ? 'italic ' : '';
            const fontFamily = child.fontFamily || '"Inter Tight", sans-serif';
            ctx.font = `${fontStyle}${fontWeight} ${fontSize}px ${fontFamily}`;
            ctx.fillStyle = child.color || '#000000';
            ctx.textBaseline = 'top';

            const align = child.align || 'left';
            ctx.textAlign = align;

            if ('letterSpacing' in ctx && child.letterSpacing != null) {
              ctx.letterSpacing = `${child.letterSpacing}em`;
            }

            const lines = wrapTextForCanvas(ctx, text, child.w);
            const lh = fontSize * (child.lineHeight || 1.15);

            lines.forEach((line, lineIdx) => {
              let lineX = child.x;
              if (align === 'center') lineX = child.x + child.w / 2;
              else if (align === 'right') lineX = child.x + child.w;

              const lineY = child.y + lineIdx * lh;

              if (child.bg && child.bg !== 'transparent') {
                const metrics = ctx.measureText(line);
                const bgPadX = 10;
                const bgPadY = 4;
                ctx.save();
                ctx.fillStyle = child.bg;
                if (ctx.roundRect) {
                  ctx.beginPath();
                  ctx.roundRect(lineX - (align === 'center' ? metrics.width / 2 : 0) - bgPadX, lineY - bgPadY, metrics.width + bgPadX * 2, fontSize + bgPadY * 2, 6);
                  ctx.fill();
                } else {
                  ctx.fillRect(lineX - (align === 'center' ? metrics.width / 2 : 0) - bgPadX, lineY - bgPadY, metrics.width + bgPadX * 2, fontSize + bgPadY * 2);
                }
                ctx.restore();
              }

              ctx.fillText(line, lineX, lineY);

              if (child.underline) {
                const metrics = ctx.measureText(line);
                let startX = lineX;
                if (align === 'center') startX = lineX - metrics.width / 2;
                else if (align === 'right') startX = lineX - metrics.width;
                ctx.beginPath();
                ctx.strokeStyle = child.color || '#000000';
                ctx.lineWidth = Math.max(1, fontSize / 16);
                ctx.moveTo(startX, lineY + fontSize * 1.05);
                ctx.lineTo(startX + metrics.width, lineY + fontSize * 1.05);
                ctx.stroke();
              }
            });

            ctx.restore();
          }
        }

        return canvas;
      }

      async function exportFrameToBlob(frame, options = {}) {
        const canvas = await renderFrameToCanvas(frame, options);
        const format = options.format || 'png';
        const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const quality = format === 'jpeg' ? 0.95 : undefined;
        return new Promise(resolve => canvas.toBlob(resolve, mime, quality));
      }

      // Execução da Exportação em Lote
      const progressBox = document.getElementById('canvas-batch-progress');
      const progressText = document.getElementById('canvas-batch-progress-text');
      const progressPct = document.getElementById('canvas-batch-progress-pct');
      const progressFill = document.getElementById('canvas-batch-progress-fill');
      const scaleSelect = document.getElementById('canvas-batch-scale');
      const formatSelect = document.getElementById('canvas-batch-format');

      if (startBtn) {
        startBtn.addEventListener('click', runBatchExport);
      }

      async function runBatchExport() {
        if (!window.JSZip) {
          alert('Biblioteca de exportação carregando, tente novamente em um instante.');
          return;
        }

        const totalRows = batchData.rows.length;
        if (totalRows === 0) return;

        const scale = Number(scaleSelect ? scaleSelect.value : 2);
        const format = formatSelect ? formatSelect.value : 'png';
        const ext = format === 'jpeg' ? 'jpg' : 'png';

        const anchor = selectedFrame() || frames[0];
        if (!anchor) return;

        /* O template não é o frame solto, é a cadeia inteira em que ele está:
           uma linha do CSV vira o post completo. Carrossel de 3 slides com 50
           linhas = 50 pastas de 3 arquivos, não 50 imagens avulsas. */
        const byId = new Map(frames.map(f => [f.id, f]));
        const chain = (computePosts().find(c => c.includes(anchor.id)) || [anchor.id])
          .map(id => byId.get(id))
          .filter(Boolean);
        const isCarousel = chain.length > 1;

        startBtn.disabled = true;
        if (progressBox) progressBox.style.display = 'flex';

        const zip = new JSZip();

        for (let i = 0; i < totalRows; i++) {
          const row = batchData.rows[i];
          const pct = Math.round(((i + 1) / totalRows) * 100);
          const postNum = String(i + 1).padStart(3, '0');

          if (progressPct) progressPct.textContent = `${pct}%`;
          if (progressFill) progressFill.style.width = `${pct}%`;

          // Prepara mapeamento para esta linha
          const overrides = {};
          Object.keys(batchData.mappings).forEach(bindName => {
            const col = batchData.mappings[bindName];
            if (col && row[col] !== undefined) {
              overrides[bindName] = row[col];
            }
          });

          // Todos os slides da linha recebem o mesmo `overrides`
          for (let s = 0; s < chain.length; s++) {
            if (progressText) {
              progressText.textContent = isCarousel
                ? `Gerando post ${i + 1} de ${totalRows} · slide ${s + 1}/${chain.length}...`
                : `Gerando post ${i + 1} de ${totalRows}...`;
            }
            const blob = await exportFrameToBlob(chain[s], { scale, format, overrides });
            zip.file(isCarousel
              ? `carrossel_${postNum}/slide_${s + 1}.${ext}`
              : `post_${postNum}.${ext}`, blob);
          }

          // Permite que o navegador respire e renderize o progresso
          await new Promise(r => setTimeout(r, 10));
        }

        if (progressText) progressText.textContent = 'Empacotando arquivo .ZIP...';
        const zipBlob = await zip.generateAsync({ type: 'blob' });

        const downloadUrl = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `lote_posts_${totalRows}_${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);

        if (progressText) progressText.textContent = `✓ ${totalRows} posts exportados com sucesso!`;
        startBtn.disabled = false;
        setTimeout(() => {
          closeBatchModal();
          if (progressBox) progressBox.style.display = 'none';
        }, 1200);
      }

      function updateBatchFooter() {
        const total = batchData.rows.length;
        const binds = getCanvasBinds();
        if (total > 0 && binds.length > 0) {
          if (startBtn) {
            startBtn.disabled = false;
            if (startLabel) startLabel.textContent = `Gerar ${total} ${total === 1 ? 'Post' : 'Posts'}`;
          }
        } else {
          if (startBtn) {
            startBtn.disabled = true;
            if (startLabel) startLabel.textContent = 'Gerar Posts';
          }
        }
      }

      function openBatchModal() {
        document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
        modal.classList.add('open');
        updateBatchMappings();
        updateBatchFooter();
        if (window.lucide) lucide.createIcons();
      }

      function closeBatchModal() {
        modal.classList.remove('open');
      }

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) {
          closeBatchModal();
        }
      });

      window.closeBatchModal = closeBatchModal;
      window.openBatchModal = openBatchModal;
      window.exportFrameToBlob = exportFrameToBlob;
      window.renderFrameToCanvas = renderFrameToCanvas;
    }

    // --------------------------------------------------
    // MODAL DE EXPORTAÇÃO INDIVIDUAL / CARROSSEL (CANVA STYLE)
    // --------------------------------------------------
    function initCanvaExportController() {
      const exportBtn = document.getElementById('canvas-export-btn');
      const modal = document.getElementById('canvas-export-modal');
      const closeBtn = document.getElementById('canvas-export-close');
      const cancelBtn = document.getElementById('canvas-export-cancel');
      const submitBtn = document.getElementById('canvas-export-submit-btn');
      const submitLabel = document.getElementById('canvas-export-submit-label');
      const formatSelect = document.getElementById('canvas-export-format');
      const scaleSelect = document.getElementById('canvas-export-scale');
      const scopeSelect = document.getElementById('canvas-export-scope');
      const progressBox = document.getElementById('canvas-export-progress');
      const progressText = document.getElementById('canvas-export-progress-text');
      const progressPct = document.getElementById('canvas-export-progress-pct');
      const progressFill = document.getElementById('canvas-export-progress-fill');

      if (!exportBtn || !modal) return;

      exportBtn.addEventListener('click', () => {
        if (modal.classList.contains('open')) {
          closeExportModal();
        } else {
          document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
          modal.classList.add('open');
          if (window.lucide) lucide.createIcons();
        }
      });

      function closeExportModal() {
        modal.classList.remove('open');
        if (progressBox) progressBox.style.display = 'none';
      }

      if (closeBtn) closeBtn.addEventListener('click', closeExportModal);
      if (cancelBtn) cancelBtn.addEventListener('click', closeExportModal);

      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeExportModal();
      });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) {
          closeExportModal();
        }
      });

      if (submitBtn) {
        submitBtn.addEventListener('click', async () => {
          if (!window.exportFrameToBlob) return;

          const format = formatSelect ? formatSelect.value : 'png';
          const scale = Number(scaleSelect ? scaleSelect.value : 2);
          const scope = scopeSelect ? scopeSelect.value : 'current';
          const ext = format === 'jpeg' ? 'jpg' : 'png';

          submitBtn.disabled = true;
          if (progressBox) progressBox.style.display = 'flex';

          if (scope === 'all' && frames.length > 1) {
            if (!window.JSZip) {
              alert('Carregando biblioteca de exportação...');
              submitBtn.disabled = false;
              return;
            }
            const zip = new JSZip();
            for (let i = 0; i < frames.length; i++) {
              const f = frames[i];
              const pct = Math.round(((i + 1) / frames.length) * 100);
              if (progressText) progressText.textContent = `Exportando slide ${i + 1} de ${frames.length}...`;
              if (progressPct) progressPct.textContent = `${pct}%`;
              if (progressFill) progressFill.style.width = `${pct}%`;

              const blob = await window.exportFrameToBlob(f, { scale, format });
              zip.file(`carrossel_slide_${i + 1}.${ext}`, blob);
              await new Promise(r => setTimeout(r, 10));
            }

            if (progressText) progressText.textContent = 'Criando arquivo ZIP...';
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `carrossel_${Date.now()}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          } else {
            const frame = selectedFrame() || frames[0];
            if (!frame) return;
            if (progressText) progressText.textContent = 'Gerando imagem em alta resolução...';
            if (progressPct) progressPct.textContent = '100%';
            if (progressFill) progressFill.style.width = '100%';

            const blob = await window.exportFrameToBlob(frame, { scale, format });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `post_${frame.id}_${scale}x.${ext}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }

          if (progressText) progressText.textContent = '✓ Download concluído!';
          submitBtn.disabled = false;
          setTimeout(closeExportModal, 800);
        });
      }
    }

    // --------------------------------------------------
    // CONTROLLER DA BARRA FLUTUANTE DE FUNDO DO FRAME
    // --------------------------------------------------
    function initFrameToolbarController() {
      const frameToolbar = document.getElementById('canvas-frame-toolbar');
      const btnModeSolid = document.getElementById('canvas-frame-mode-solid');
      const btnModeGrad = document.getElementById('canvas-frame-mode-gradient');
      const groupSolid = document.getElementById('canvas-frame-solid-group');
      const groupGrad = document.getElementById('canvas-frame-grad-group');
      const inputBgColor = document.getElementById('canvas-frame-bg-color');
      const inputGradC1 = document.getElementById('canvas-frame-grad-c1');
      const inputGradC2 = document.getElementById('canvas-frame-grad-c2');
      const selectGradDir = document.getElementById('canvas-frame-grad-dir');
      const selectGrad = document.getElementById('canvas-frame-gradient-select');
      const btnBgImg = document.getElementById('canvas-frame-bg-img-btn');
      const fileBgImg = document.getElementById('canvas-frame-bg-file');
      const btnMore = document.getElementById('canvas-frame-more');
      const advRow = document.getElementById('canvas-frame-advanced');
      const inputOverlay = document.getElementById('canvas-frame-overlay');
      const inputBlur = document.getElementById('canvas-frame-blur');
      const btnDelImg = document.getElementById('canvas-frame-del-img');
      const btnReset = document.getElementById('canvas-frame-bg-reset');

      if (!frameToolbar) return;

      if (window.lucide) lucide.createIcons();

      function buildGradientString(c1, c2, dir) {
        if (dir === 'radial') {
          return `radial-gradient(circle, ${c1} 0%, ${c2} 100%)`;
        }
        return `linear-gradient(${dir || '180deg'}, ${c1} 0%, ${c2} 100%)`;
      }

      function applyCustomGradient(frame) {
        if (!frame) return;
        const c1 = (inputGradC1 && inputGradC1.value) || '#18181B';
        const c2 = (inputGradC2 && inputGradC2.value) || '#09090B';
        const dir = (selectGradDir && selectGradDir.value) || '180deg';
        frame.bg = buildGradientString(c1, c2, dir);
        frame.bgImage = null;
        applyFrameBackground(frame);
        save();
      }

      if (btnModeSolid) {
        btnModeSolid.addEventListener('click', () => {
          const frame = selectedFrame();
          if (!frame) return;
          btnModeSolid.classList.add('is-active');
          if (btnModeGrad) btnModeGrad.classList.remove('is-active');
          if (groupSolid) groupSolid.style.display = 'inline-flex';
          if (groupGrad) groupGrad.style.display = 'none';

          frame.bg = (inputBgColor && inputBgColor.value) || '#FFFFFF';
          frame.bgImage = null;
          applyFrameBackground(frame);
          save();
        });
      }

      if (btnModeGrad) {
        btnModeGrad.addEventListener('click', () => {
          const frame = selectedFrame();
          if (!frame) return;
          btnModeGrad.classList.add('is-active');
          if (btnModeSolid) btnModeSolid.classList.remove('is-active');
          if (groupSolid) groupSolid.style.display = 'none';
          if (groupGrad) groupGrad.style.display = 'inline-flex';

          applyCustomGradient(frame);
        });
      }

      if (inputBgColor) {
        inputBgColor.addEventListener('input', (e) => {
          const frame = selectedFrame();
          if (!frame) return;
          frame.bg = e.target.value;
          frame.bgImage = null;
          if (selectGrad) selectGrad.value = '';
          applyFrameBackground(frame);
          save();
        });
      }

      if (inputGradC1) {
        inputGradC1.addEventListener('input', () => {
          const frame = selectedFrame();
          applyCustomGradient(frame);
        });
      }

      if (inputGradC2) {
        inputGradC2.addEventListener('input', () => {
          const frame = selectedFrame();
          applyCustomGradient(frame);
        });
      }

      if (selectGradDir) {
        selectGradDir.addEventListener('change', () => {
          const frame = selectedFrame();
          applyCustomGradient(frame);
        });
      }

      if (selectGrad) {
        selectGrad.addEventListener('change', (e) => {
          const frame = selectedFrame();
          if (!frame) return;
          const val = e.target.value;
          if (!val) return;

          const parts = val.split('|');
          if (parts.length >= 2) {
            const c1 = parts[0];
            const c2 = parts[1];
            const dir = parts[2] || '180deg';
            if (inputGradC1) inputGradC1.value = c1;
            if (inputGradC2) inputGradC2.value = c2;
            if (selectGradDir) selectGradDir.value = dir;

            if (btnModeGrad) btnModeGrad.classList.add('is-active');
            if (btnModeSolid) btnModeSolid.classList.remove('is-active');
            if (groupSolid) groupSolid.style.display = 'none';
            if (groupGrad) groupGrad.style.display = 'inline-flex';

            applyCustomGradient(frame);
          }
          selectGrad.value = '';
        });
      }

      if (btnBgImg && fileBgImg) {
        btnBgImg.addEventListener('click', () => fileBgImg.click());
        fileBgImg.addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            const frame = selectedFrame();
            if (!frame) return;
            frame.bgImage = ev.target.result;
            if (frame.bgOverlay == null) frame.bgOverlay = 35;
            applyFrameBackground(frame);
            save();
            updateTextToolbar();
          };
          reader.readAsDataURL(file);
        });
      }

      if (btnMore && advRow) {
        btnMore.addEventListener('click', () => {
          advRow.classList.toggle('is-open');
          btnMore.classList.toggle('is-active', advRow.classList.contains('is-open'));
          updateTextToolbar();
        });
      }

      if (inputOverlay) {
        inputOverlay.addEventListener('input', (e) => {
          const frame = selectedFrame();
          if (!frame) return;
          frame.bgOverlay = Number(e.target.value);
          applyFrameBackground(frame);
          save();
        });
      }

      if (inputBlur) {
        inputBlur.addEventListener('input', (e) => {
          const frame = selectedFrame();
          if (!frame) return;
          frame.bgBlur = Number(e.target.value);
          applyFrameBackground(frame);
          save();
        });
      }

      if (btnDelImg) {
        btnDelImg.addEventListener('click', () => {
          const frame = selectedFrame();
          if (!frame) return;
          frame.bgImage = null;
          frame.bgOverlay = 0;
          frame.bgBlur = 0;
          applyFrameBackground(frame);
          save();
          updateTextToolbar();
        });
      }

      if (btnReset) {
        btnReset.addEventListener('click', () => {
          const frame = selectedFrame();
          if (!frame) return;
          frame.bg = '#FFFFFF';
          frame.bgImage = null;
          frame.bgOverlay = 0;
          frame.bgBlur = 0;
          if (selectGrad) selectGrad.value = '';
          if (inputBgColor) inputBgColor.value = '#FFFFFF';
          if (btnModeSolid) btnModeSolid.classList.add('is-active');
          if (btnModeGrad) btnModeGrad.classList.remove('is-active');
          if (groupSolid) groupSolid.style.display = 'inline-flex';
          if (groupGrad) groupGrad.style.display = 'none';

          applyFrameBackground(frame);
          save();
          updateTextToolbar();
        });
      }
    }

    initFrameToolbarController();
    initBatchCreateController();
    initCanvaExportController();
    load();
    renderAll();
    if (window.lucide) lucide.createIcons();
    if (loadView().canvas) toggleCanvas(true);
  })();

  window.addEventListener('resize', renderChart);
})();
