// ═══════════════════════════════════════
// CSV HELPERS
// ═══════════════════════════════════════
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i]?.trim());
    return obj;
  });
}

function buildSlotsFromCSV(rows) {
  const slotMap = new Map();
  for (const row of rows) {
    const time = row.time;
    if (!slotMap.has(time)) slotMap.set(time, []);
    slotMap.get(time).push({
      name: row.name,
      lat:  +row.lat,
      lon:  +row.lon,
      temp: +row.temp,
      hum:  +row.hum
    });
  }
  return Array.from(slotMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([time, stations]) => ({ time, stations }));
}

function buildBoundaryFromCSV(rows) {
  return rows.map(r => [+r.lon, +r.lat]);
}

// ═══════════════════════════════════════
// MAP INIT (done once, before data loads)
// ═══════════════════════════════════════
const map = L.map('map', { zoomControl: false, attributionControl: true })
  .setView([17.9834, 79.5319], 16);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 20,
  subdomains: 'abcd',
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'
}).addTo(map);

L.control.zoom({ position: 'bottomright' }).addTo(map);

// ═══════════════════════════════════════
// LOAD CSV FILES FROM USER-PROVIDED URLs
// ═══════════════════════════════════════
let appInitialised = false;

function setStatus(msg, isError) {
  const el = document.getElementById('loadMsg');
  el.textContent = msg;
  el.style.color = isError ? '#ff6b6b' : '#f1d060';
}

function loadFromUrls() {
  const sUrl = document.getElementById('stationsUrl').value.trim();
  const bUrl = document.getElementById('boundaryUrl').value.trim();

  if (!sUrl || !bUrl) {
    setStatus('⚠ Please enter both CSV URLs.', true);
    return;
  }

  setStatus('⏳ Fetching data…', false);
  document.getElementById('loadBtn').disabled = true;

  // Use a CORS proxy if needed — direct fetch first, fallback to proxy
  const proxify = url => `https://corsproxy.io/?${encodeURIComponent(url)}`;

  function safeFetch(url) {
    return fetch(url)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
      .catch(() => fetch(proxify(url)).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} from proxy`);
        return r.text();
      }));
  }

  Promise.all([safeFetch(sUrl), safeFetch(bUrl)])
    .then(([stationText, boundaryText]) => {
      const slots    = buildSlotsFromCSV(parseCSV(stationText));
      const boundary = buildBoundaryFromCSV(parseCSV(boundaryText));

      if (!slots.length)    throw new Error('stations.csv parsed 0 rows — check column names.');
      if (!boundary.length) throw new Error('boundary.csv parsed 0 rows — check column names.');

      setStatus(`✔ Loaded ${slots.length} time slots, ${boundary.length} boundary points.`, false);

      // Show controls, hide URL row
      document.getElementById('dataRow').style.display    = 'none';
      document.getElementById('controlsRow').style.display = 'flex';

      if (appInitialised) {
        // Re-init: remove old overlay by reloading page state
        location.reload();
        return;
      }
      appInitialised = true;
      initApp(slots, boundary);
    })
    .catch(err => {
      setStatus(`⚠ ${err.message}`, true);
      document.getElementById('loadBtn').disabled = false;
      console.error(err);
    });
}

document.getElementById('loadBtn').addEventListener('click', loadFromUrls);

// Allow pressing Enter in either URL field to trigger load
['stationsUrl','boundaryUrl'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') loadFromUrls();
  });
});

// ═══════════════════════════════════════
// MAIN APP — called after CSVs are loaded
// ═══════════════════════════════════════
function initApp(slots, boundary) {

  // "Change Data" button — show URL inputs again
  document.getElementById('reloadBtn').addEventListener('click', () => {
    document.getElementById('controlsRow').style.display = 'none';
    document.getElementById('dataRow').style.display     = 'flex';
    document.getElementById('loadBtn').disabled          = false;
    setStatus('', false);
  });

  // ── BOUNDARY ──
  const bLatLngs = boundary.map(c => [c[1], c[0]]);
  const boundaryPoly = L.polygon(bLatLngs, {
    color: '#ffe066', weight: 2.5, fill: false, dashArray: '7,4', opacity: .95
  }).addTo(map);
  map.fitBounds(boundaryPoly.getBounds(), { padding: [65, 65] });
  setTimeout(() => map.invalidateSize(), 120);

  // ── GRATICULE ──
  (function addGraticule() {
    const b = boundaryPoly.getBounds();
    const step = 0.004;
    const gs = { color: '#aaa', weight: .5, opacity: .45, dashArray: '3,6', interactive: false };
    for (let lat = Math.floor(b.getSouth() * 1000) / 1000; lat <= b.getNorth() + step; lat += step)
      L.polyline([[lat, b.getWest() - step], [lat, b.getEast() + step]], gs).addTo(map);
    for (let lon = Math.floor(b.getWest() * 1000) / 1000; lon <= b.getEast() + step; lon += step)
      L.polyline([[b.getSouth() - step, lon], [b.getNorth() + step, lon]], gs).addTo(map);
  })();

  // ── COLOUR SCHEMES ──
  const C_TEMP9 = ['#313695','#4575b4','#74add1','#abd9e9','#ffffbf','#fee090','#fdae61','#f46d43','#d73027'];
  const C_HUM9  = ['#d73027','#f46d43','#fdae61','#fee090','#ffffbf','#d9ef8b','#a6d96a','#66bd63','#1a9850'];

  function pickColors(n, isTemp) {
    const base = isTemp ? C_TEMP9 : C_HUM9;
    if (n === 9) return base;
    if (n === 7) return [base[0],base[1],base[3],base[4],base[5],base[7],base[8]];
    return [base[0],base[2],base[4],base[6],base[8]];
  }
  function h2rgb(h) {
    return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  }

  // ── IDW ──
  function idw(lon, lat, stations, key, power) {
    let n = 0, d = 0;
    for (const s of stations) {
      const dy = (lat - s.lat) * 111000;
      const dx = (lon - s.lon) * 111000 * Math.cos(lat * Math.PI / 180);
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < 1) return s[key];
      const w = 1 / Math.pow(dist, power);
      n += w * s[key]; d += w;
    }
    return n / d;
  }

  // ── POINT-IN-POLYGON ──
  function pip(lon, lat, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > lat) !== (yj > lat)) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  }

  // ── GLOBAL RANGES ──
  let gTMin=Infinity, gTMax=-Infinity, gHMin=Infinity, gHMax=-Infinity;
  for (const sl of slots) for (const s of sl.stations) {
    if (s.temp < gTMin) gTMin = s.temp; if (s.temp > gTMax) gTMax = s.temp;
    if (s.hum  < gHMin) gHMin = s.hum;  if (s.hum  > gHMax) gHMax = s.hum;
  }

  // ── IDW RENDER ──
  let overlay = null;
  const cvs = document.createElement('canvas');

  function renderIDW(si) {
    const slot   = slots[si];
    const isTemp = document.getElementById('varSel').value === 'temp';
    const power  = +document.getElementById('powerSel').value;
    const N      = +document.getElementById('gridSel').value;
    const nC     = +document.getElementById('classSel').value;
    const colors = pickColors(nC, isTemp);
    const gMin   = isTemp ? gTMin : gHMin, gMax = isTemp ? gTMax : gHMax;

    const lons = boundary.map(c => c[0]), lats = boundary.map(c => c[1]);
    const x0 = Math.min(...lons), x1 = Math.max(...lons);
    const y0 = Math.min(...lats), y1 = Math.max(...lats);

    cvs.width = N; cvs.height = N;
    const ctx = cvs.getContext('2d');
    const img = ctx.createImageData(N, N);

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const lat = y1 - (r / N) * (y1 - y0);
        const lon = x0 + (c / N) * (x1 - x0);
        const i4  = (r * N + c) * 4;
        if (!pip(lon, lat, boundary)) { img.data[i4+3] = 0; continue; }
        const val = idw(lon, lat, slot.stations, isTemp ? 'temp' : 'hum', power);
        const t   = Math.max(0, Math.min(.9999, (val - gMin) / (gMax - gMin)));
        const ci  = Math.floor(t * nC);
        const [rd, gn, bl] = h2rgb(colors[ci]);
        img.data[i4]=rd; img.data[i4+1]=gn; img.data[i4+2]=bl; img.data[i4+3]=205;
      }
    }
    ctx.putImageData(img, 0, 0);
    const url    = cvs.toDataURL();
    const bounds = [[y0, x0], [y1, x1]];

    if (overlay) { overlay.setUrl(url); overlay.setBounds(bounds); }
    else {
      overlay = L.imageOverlay(url, bounds, { opacity:1, interactive:true, zIndex:300 }).addTo(map);
      overlay.on('click', e => {
        const lo = e.latlng.lng, la = e.latlng.lat;
        if (!pip(lo, la, boundary)) return;
        const p  = +document.getElementById('powerSel').value;
        const tv = idw(lo, la, slot.stations, 'temp', p).toFixed(2);
        const hv = idw(lo, la, slot.stations, 'hum',  p).toFixed(2);
        L.popup().setLatLng(e.latlng).setContent(
          `<div style="font-family:Georgia;font-size:.78rem;">
            <b style="font-size:.82rem;">IDW Estimate — ${slot.time}</b><br><hr style="margin:4px 0">
            🌡 Temperature: <b>${tv} °C</b><br>
            💧 Humidity: <b>${hv} %</b><br>
            📍 ${la.toFixed(5)}°N, ${lo.toFixed(5)}°E
          </div>`).openOn(map);
      });
    }

    updateLegend(nC, isTemp, gMin, gMax, colors, slot, power);
    document.getElementById('mapTitle').innerHTML =
      `IDW Interpolation of ${isTemp ? 'Temperature' : 'Humidity'}<br>NITW Campus, Warangal`;
    document.getElementById('mapSubtitle').textContent =
      `Time: ${slot.time}  |  p=${power}  |  3 Stations`;
    document.getElementById('timeDisp').textContent = slot.time;
    document.getElementById('cTime').textContent = `⏱ ${slot.time}`;
  }

  // ── LEGEND ──
  const ST_COLORS = ['#00c8ff','#ff6600','#00e060'];

  function updateLegend(nC, isTemp, gMin, gMax, colors, slot, power) {
    const unit = isTemp ? '°C' : '%';
    let html = '';
    for (let i = 0; i < nC; i++) {
      const lo = (gMin + (i / nC) * (gMax - gMin)).toFixed(2);
      const hi = (gMin + ((i+1) / nC) * (gMax - gMin)).toFixed(2);
      html += `<div class="leg-item">
        <div class="leg-swatch" style="background:${colors[i]}"></div>
        <span class="leg-label">${lo} – ${hi} ${unit}</span>
      </div>`;
    }
    document.getElementById('legItems').innerHTML = html;

    const names = ['Studium','Biotech1','ALC'];
    let shtml = '';
    for (let i = 0; i < 3; i++) {
      const s = slot.stations[i];
      const v = isTemp ? s.temp.toFixed(1) : s.hum.toFixed(1);
      shtml += `<div class="leg-station">
        <div class="leg-diamond" style="background:${ST_COLORS[i]}"></div>
        <span class="leg-st-label">${names[i]}: <b>${v}${unit}</b></span>
      </div>`;
    }
    document.getElementById('legStations').innerHTML = shtml;
    document.getElementById('varLabel').textContent =
      `${isTemp ? 'Temperature (°C)' : 'Humidity (%)'} · p=${power}`;
  }

  // ── STATION MARKERS ──
  const stMeta = [
    { name:'Studium',  color:'#00c8ff' },
    { name:'Biotech1', color:'#ff6600' },
    { name:'ALC',      color:'#00e060' },
  ];
  const stMarkers = [];

  function initMarkers() {
    const s0 = slots[0].stations;
    for (let i = 0; i < 3; i++) {
      const s = s0[i], c = stMeta[i].color, nm = stMeta[i].name;
      const icon = L.divIcon({ className:'',
        html:`<div style="width:13px;height:13px;background:${c};
          border:2px solid #fff;transform:rotate(45deg);
          box-shadow:1px 1px 4px rgba(0,0,0,.7);"></div>`,
        iconSize:[13,13], iconAnchor:[6,6] });
      const m = L.marker([s.lat, s.lon], { icon, zIndexOffset:600 })
        .bindTooltip(`<b>${nm}</b>`, { permanent:true, direction:'top',
          offset:[0,-10], className:'',
          style:'background:rgba(0,0,0,.75);color:#fff;border:none;font-size:.65rem;padding:2px 5px;border-radius:3px;' })
        .addTo(map);
      stMarkers.push(m);
    }
  }
  initMarkers();

  function updateMarkerTooltips(slot, isTemp) {
    const unit = isTemp ? '°C' : '%';
    for (let i = 0; i < 3; i++) {
      const s = slot.stations[i];
      const v = isTemp ? s.temp : s.hum;
      stMarkers[i].setTooltipContent(`<b>${stMeta[i].name}</b><br>${v.toFixed(1)}${unit}`);
    }
  }

  // ── SCALE BAR ──
  function drawScaleBar() {
    const cv  = document.getElementById('scaleCanvas');
    const ctx = cv.getContext('2d');
    const mpp = 156543.03392 * Math.cos(map.getCenter().lat * Math.PI / 180) / Math.pow(2, map.getZoom());
    const px = 120, meters = mpp * px;
    const nice = [25,50,100,200,250,500,1000];
    const chosen = nice.reduce((a,b) => Math.abs(b-meters) < Math.abs(a-meters) ? b : a);
    const barPx = chosen / mpp;
    ctx.clearRect(0, 0, 155, 16);
    const seg = barPx / 4, ox = 15;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i%2===0 ? '#1b2838' : '#fff';
      ctx.fillRect(ox + i*seg, 3, seg, 9);
      ctx.strokeStyle = '#1b2838'; ctx.lineWidth = 1;
      ctx.strokeRect(ox + i*seg, 3, seg, 9);
    }
    ctx.strokeStyle = '#1b2838'; ctx.lineWidth = 1.2;
    [[ox,1],[ox,14],[ox+barPx,1],[ox+barPx,14]].forEach(([x]) => {
      ctx.beginPath(); ctx.moveTo(x, 3); ctx.lineTo(x, 12); ctx.stroke();
    });
    const lbl = chosen >= 1000 ? `0 — ${chosen/1000} km` : `0 — ${chosen} m`;
    document.getElementById('scaleLabel').textContent = lbl;
  }
  map.on('zoomend moveend', drawScaleBar);
  setTimeout(drawScaleBar, 400);

  // ── COORD BAR ──
  map.on('mousemove', e => {
    const lo = e.latlng.lng, la = e.latlng.lat;
    document.getElementById('cLon').textContent = `Lon: ${lo.toFixed(6)}°E`;
    document.getElementById('cLat').textContent = `Lat: ${la.toFixed(6)}°N`;
    if (pip(lo, la, boundary)) {
      const si     = +document.getElementById('timeSlider').value;
      const p      = +document.getElementById('powerSel').value;
      const isTemp = document.getElementById('varSel').value === 'temp';
      const v      = idw(lo, la, slots[si].stations, isTemp ? 'temp' : 'hum', p).toFixed(2);
      document.getElementById('cVal').textContent = `Est: ${v}${isTemp ? '°C' : '%'}`;
    } else {
      document.getElementById('cVal').textContent = 'Est: —';
    }
  });

  // ── TIME CONTROLS ──
  let playing = false, timer = null, cur = 0;
  const slider  = document.getElementById('timeSlider');
  const playBtn = document.getElementById('playBtn');

  // Update slider max to match actual slot count
  slider.max = slots.length - 1;

  function setSlot(i) {
    cur = i; slider.value = i;
    const isTemp = document.getElementById('varSel').value === 'temp';
    renderIDW(i);
    updateMarkerTooltips(slots[i], isTemp);
  }

  slider.addEventListener('input', () => setSlot(+slider.value));

  ['varSel','powerSel','classSel','gridSel'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      if (overlay) { map.removeLayer(overlay); overlay = null; }
      setSlot(cur);
    });
  });

  playBtn.addEventListener('click', () => {
    if (playing) {
      clearInterval(timer); playing = false;
      playBtn.textContent = '▶ Play'; playBtn.className = 'btn';
    } else {
      playing = true; playBtn.textContent = '⏹ Stop'; playBtn.className = 'btn stop';
      const sp = +document.getElementById('speedSel').value;
      timer = setInterval(() => setSlot((cur + 1) % slots.length), sp);
    }
  });

  // ── INIT ──
  setSlot(0);

} // end initApp
