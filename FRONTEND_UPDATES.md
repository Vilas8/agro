# Frontend JS Updates Required

After pulling the server changes, update `script.js` with these 4 feature implementations.

---

## Feature 1 — Show Machine Base Locations on Map

Call `GET /api/machines/base_locations` and drop a marker for each machine.

```js
async function loadMachineBaseLocations(map) {
  const res = await fetch(`${API_BASE}/api/machines/base_locations`);
  const json = await res.json();
  if (!json.isOk) return;
  json.data.forEach(m => {
    const marker = L.marker([m.lat, m.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:#16a34a;color:#fff;padding:4px 8px;border-radius:6px;font-size:11px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.3)">
                 🚜 ${m.machine_name}
               </div>`,
        iconAnchor: [40, 10]
      })
    }).addTo(map);
    marker.bindPopup(`<b>${m.machine_name}</b><br>${m.address}<br>Status: <b>${m.availability}</b>`);
  });
}
```

---

## Feature 2 — Live Delivery Tracking ("Where is my Train" style)

### Step 1: Trigger simulation when user clicks "Track Machine"

```js
async function startTracking(bookingId, machineName, userLat, userLng) {
  // 1. Generate route
  const res = await fetch(`${API_BASE}/api/tracking/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ booking_id: bookingId, machine_name: machineName, user_lat: userLat, user_lng: userLng })
  });
  const data = await res.json();
  if (!data.isOk) { alert('Could not load tracking data'); return; }

  showTrackingModal(data);
}
```

### Step 2: Render the tracking modal with live movement

```js
function showTrackingModal(routeData) {
  // Create modal overlay
  const modal = document.createElement('div');
  modal.id = 'tracking-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:90%;max-width:600px;padding:20px;position:relative">
      <button onclick="closeTracking()" style="position:absolute;top:12px;right:16px;font-size:20px;background:none;border:none;cursor:pointer">✕</button>
      <h2 style="font-family:Syne,sans-serif;color:#16a34a;margin-bottom:4px">🛰 Live Machine Tracking</h2>
      <p style="color:#6b7280;font-size:13px">Machine: <b>${routeData.machine_name}</b> | Distance: <b>${routeData.total_dist_km} km</b> | ETA: <b>${routeData.eta_minutes} min</b></p>
      <div id="tracking-map" style="height:350px;border-radius:12px;margin-top:12px"></div>
      <div id="tracking-status" style="margin-top:12px;padding:10px;background:#f0fdf4;border-radius:8px;font-size:13px;color:#15803d">
        🚜 Machine departing from base...
      </div>
    </div>`;
  document.body.appendChild(modal);

  // Init Leaflet map inside modal
  const map = L.map('tracking-map').setView([routeData.start.lat, routeData.start.lng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

  // Draw full route path
  const latlngs = routeData.waypoints.map(w => [w.lat, w.lng]);
  L.polyline(latlngs, { color: '#16a34a', weight: 4, dashArray: '8,4' }).addTo(map);

  // Start marker
  L.marker([routeData.start.lat, routeData.start.lng])
   .addTo(map)
   .bindPopup(`📦 Machine Base: ${routeData.start.address}`);

  // Destination marker
  L.marker([routeData.destination.lat, routeData.destination.lng], {
    icon: L.divIcon({ className: '', html: '🏡', iconSize: [24, 24] })
  }).addTo(map).bindPopup('📍 Your Field');

  // Animated machine marker
  const machineIcon = L.divIcon({ className: '', html: '🚜', iconSize: [28, 28] });
  const machineMarker = L.marker([routeData.start.lat, routeData.start.lng], { icon: machineIcon }).addTo(map);

  // Simulate movement through waypoints
  const waypoints = routeData.waypoints;
  let idx = 0;
  const statusEl = document.getElementById('tracking-status');

  function moveToNext() {
    if (idx >= waypoints.length) {
      statusEl.innerHTML = '✅ Machine has arrived at your field!';
      statusEl.style.background = '#dcfce7';
      return;
    }
    const wp = waypoints[idx];
    machineMarker.setLatLng([wp.lat, wp.lng]);
    map.panTo([wp.lat, wp.lng], { animate: true });

    const remaining = waypoints.length - idx;
    const etaMin = Math.round((remaining / waypoints.length) * routeData.eta_minutes);
    statusEl.innerHTML = `🚜 En route — Speed: <b>${wp.speed} km/h</b> | Heading: <b>${wp.heading}°</b> | ETA: <b>~${etaMin} min</b>`;

    idx++;
    // Interval scales with speed: faster speed = shorter interval
    const interval = Math.max(800, 3000 - wp.speed * 30);
    setTimeout(moveToNext, interval);
  }

  setTimeout(moveToNext, 1000);
}

function closeTracking() {
  const m = document.getElementById('tracking-modal');
  if (m) m.remove();
}
```

### Step 3: Connect Track button to tracking

In `renderUserBookings`, update the Track button:
```js
// Replace the Track Machine button onclick with:
onclick="startTracking(${b.id}, '${b.machine_name}', ${b.field_lat || 13.135}, ${b.field_lng || 78.132})"
```

---

## Feature 3 — User Profile Page

Add a Profile tab in the nav and this function:

```js
async function showProfilePage() {
  const email = getCurrentUserEmail(); // from your session/localStorage
  const res   = await fetch(`${API_BASE}/api/users/profile?email=${encodeURIComponent(email)}`);
  const json  = await res.json();
  if (!json.isOk) { alert('Could not load profile'); return; }
  const u = json.data;

  document.getElementById('main-content').innerHTML = `
    <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 16px rgba(0,0,0,0.08)">
      <h2 style="font-family:Syne,sans-serif;color:#16a34a;margin-bottom:20px">👤 My Profile</h2>
      <form onsubmit="saveProfile(event)">
        <label>Full Name</label>
        <input id="pf-name" value="${u.user_name || ''}" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:12px">
        <label>Phone Number</label>
        <input id="pf-phone" value="${u.user_phone || ''}" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:12px">
        <label>Village</label>
        <input id="pf-village" value="${u.village || ''}" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:12px">
        <label>District</label>
        <input id="pf-district" value="${u.district || 'Kolar'}" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:12px">
        <label>Address</label>
        <textarea id="pf-address" rows="2" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:12px">${u.address || ''}</textarea>
        <hr style="margin:16px 0">
        <label>Current Password (to change password)</label>
        <input type="password" id="pf-cur-pw" placeholder="Enter current password" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:12px">
        <label>New Password</label>
        <input type="password" id="pf-new-pw" placeholder="Leave blank to keep current" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:16px">
        <input type="hidden" id="pf-email" value="${u.user_email}">
        <button type="submit" style="width:100%;padding:12px;background:#16a34a;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer">Save Changes</button>
        <div id="pf-msg" style="margin-top:12px;text-align:center;font-size:13px"></div>
      </form>
    </div>`;
}

async function saveProfile(e) {
  e.preventDefault();
  const email   = document.getElementById('pf-email').value;
  const newPw   = document.getElementById('pf-new-pw').value;
  const payload = { user_email: email };

  if (newPw) {
    payload.current_password = document.getElementById('pf-cur-pw').value;
    payload.new_password = newPw;
  } else {
    payload.user_name  = document.getElementById('pf-name').value;
    payload.user_phone = document.getElementById('pf-phone').value;
    payload.village    = document.getElementById('pf-village').value;
    payload.district   = document.getElementById('pf-district').value;
    payload.address    = document.getElementById('pf-address').value;
  }

  const res  = await fetch(`${API_BASE}/api/users/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  const msg  = document.getElementById('pf-msg');
  msg.style.color = json.isOk ? '#16a34a' : '#dc2626';
  msg.textContent = json.isOk ? '✅ ' + json.message : '❌ ' + json.error;
}
```

---

## Feature 4 — Distance from Machine Base (Auto-GPS fix)

When the user clicks "Use My Location" (auto-GPS), compute distance FROM the selected machine base:

```js
async function handleAutoGPS(machineName) {
  if (!navigator.geolocation) { alert('GPS not supported'); return; }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const userLat = pos.coords.latitude;
    const userLng = pos.coords.longitude;

    // Store in booking form fields
    document.getElementById('field-lat').value = userLat;
    document.getElementById('field-lng').value = userLng;

    // Fetch distance FROM machine base TO user's detected location
    const res = await fetch(
      `${API_BASE}/api/distance?machine_name=${encodeURIComponent(machineName)}&user_lat=${userLat}&user_lng=${userLng}`
    );
    const json = await res.json();
    if (json.isOk) {
      document.getElementById('distance-field').value = json.distance_km;
      document.getElementById('distance-display').textContent =
        `📍 ${json.distance_km} km from machine base (~${json.estimated_travel_minutes} min travel)`;
      // Trigger cost recalculation with new distance
      recalculateCost();
    }
  }, (err) => alert('Could not get location: ' + err.message));
}
```

Replace your existing auto-GPS button `onclick` with:
```html
<button type="button" onclick="handleAutoGPS(selectedMachineName)">📍 Use My Location</button>
```
