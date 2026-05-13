// ===== GLOBALS =====
let currentPage = 'home';
let currentUser = null;
let isAdmin = false;
let allData = [];
let pendingBookingData = null;
let recordCount = 0;
let toastTimer;
let machineConfigs = {};
let currentAdminMachine = 'Grass Cutter';
const MAX_RECORDS = 999;
const API_BASE = 'https://agro-cc18.onrender.com/api';

// GPS globals
let fleetMap = null;
let fleetMarkers = {};
let userLocationMap = null;
let gpsRefreshTimer = null;

// Tracking simulation globals
let trackingMap = null;
let trackingMarker = null;
let trackingRoute = [];
let trackingIndex = 0;
let trackingTimer = null;
let trackingPolyline = null;
let travelledPolyline = null;

// ===== TRACKING PERSISTENCE (localStorage, survives refresh & modal close) =====
// Key: "tracking_<bookingId>"
// Stores: { startedAt (epoch ms), totalPoints, distKm, durMin, machineName,
//           route: [{lat,lng},...] }
// Progress is computed from startedAt + elapsed time (time-based, not step-based).
// So even when the modal is closed, the machine keeps moving on the timeline.

function saveTrackingState(bookingId, startedAt, totalPoints, machineName, route, distKm, durMin) {
  try {
    localStorage.setItem('tracking_' + bookingId, JSON.stringify({
      startedAt, totalPoints, machineName, route, distKm, durMin,
      savedAt: Date.now()
    }));
  } catch(e) {}
}

function loadTrackingState(bookingId) {
  try {
    const raw = localStorage.getItem('tracking_' + bookingId);
    if (!raw) return null;
    const state = JSON.parse(raw);
    // Expire after 4 hours
    if (Date.now() - state.savedAt > 4 * 3600 * 1000) {
      localStorage.removeItem('tracking_' + bookingId);
      return null;
    }
    return state;
  } catch(e) { return null; }
}

function clearTrackingState(bookingId) {
  try { localStorage.removeItem('tracking_' + bookingId); } catch(e) {}
}

// Given a saved state, compute what the current progress index should be
// based on wall-clock time elapsed since tracking started.
// "1 simulated minute of travel = 2 real seconds" — so total visual duration
// in real ms = durMin * 2000.
function computeCurrentIndex(state) {
  if (!state || !state.startedAt) return 0;
  const elapsedMs = Date.now() - state.startedAt;
  const totalVisualMs = state.durMin * 2000; // total animation duration
  const progress = Math.min(1, elapsedMs / totalVisualMs);
  return Math.min(state.totalPoints - 1, Math.floor(progress * state.totalPoints));
}

// ===== BASE MACHINE LOCATIONS (near Kolar) =====
const MACHINE_BASE_LOCATIONS = {
  'Grass Cutter':  { lat: 13.1370, lng: 78.1335, label: 'Kolar North Depot' },
  'Harvester':     { lat: 13.1390, lng: 78.1355, label: 'Kolar East Yard' },
  'Flip plow':     { lat: 13.1330, lng: 78.1360, label: 'Kolar South Shed' },
  'Corn Planter':  { lat: 13.1310, lng: 78.1310, label: 'Kolar West Farm' },
  'Rotavator':     { lat: 13.1350, lng: 78.1290, label: 'Kolar Central Base' },
  'Paddy Planter': { lat: 13.1400, lng: 78.1300, label: 'Kolar North Farm' },
  'Sprayer':       { lat: 13.1285, lng: 78.1370, label: 'Kolar South Farm' },
  'Cultivator':    { lat: 13.1420, lng: 78.1380, label: 'Kolar East Farm' }
};

// ===== KARNATAKA DISTRICTS + VILLAGES =====
const KA_DISTRICTS = {
  'Kolar': ['Kolar Town','Bangarpet','Malur','Mulbagal','KGF (Kolar Gold Fields)','Srinivaspur','Gudibande','Chintamani'],
  'Bengaluru Rural': ['Doddaballapura','Devanahalli','Hosakote','Nelamangala','Anekal','Hoskote'],
  'Bengaluru Urban': ['Bengaluru City','Yelahanka','Rajajinagar','Whitefield','Electronic City','Jayanagar','Malleswaram'],
  'Chikkaballapura': ['Chikkaballapura','Bagepalli','Chintamani','Gauribidanur','Gudibande','Sidlaghatta'],
  'Tumakuru': ['Tumakuru','Tiptur','Madhugiri','Pavagada','Sira','Gubbi','Kunigal','Koratagere'],
  'Ramanagara': ['Ramanagara','Channapatna','Magadi','Kanakapura'],
  'Hassan': ['Hassan','Belur','Sakleshpur','Alur','Holenarasipur','Arsikere','Channarayapatna'],
  'Mandya': ['Mandya','Maddur','Malavalli','Pandavapura','Nagamangala','Srirangapatna'],
  'Mysuru': ['Mysuru','Hunsur','H D Kote','Piriyapatna','Nanjangud','T Narasipur'],
  'Chamarajanagar': ['Chamarajanagar','Gundlupet','Kollegal','Yelandur'],
  'Dakshina Kannada': ['Mangaluru','Puttur','Sullia','Belthangady','Bantwal'],
  'Udupi': ['Udupi','Karkala','Kundapura'],
  'Shivamogga': ['Shivamogga','Bhadravati','Tirthahalli','Sagar','Sorab','Hosanagara'],
  'Chikkamagaluru': ['Chikkamagaluru','Kadur','Tarikere','Koppa','Mudigere','Sringeri'],
  'Kodagu': ['Madikeri','Virajpet','Somwarpet'],
  'Belagavi': ['Belagavi','Gokak','Chikodi','Khanapur','Bailhongal','Athani','Raibag'],
  'Dharwad': ['Dharwad','Hubli','Kalghatgi','Navalgund','Kundgol'],
  'Gadag': ['Gadag','Shirahatti','Mundargi','Naragund','Ron'],
  'Haveri': ['Haveri','Savanur','Ranibennur','Byadagi','Hanagal','Shiggaon'],
  'Uttara Kannada': ['Karwar','Sirsi','Kumta','Honnavara','Dandeli','Haliyal','Siddapur'],
  'Ballari': ['Ballari','Hospet','Sandur','Siruguppa','Hagaribommanahalli'],
  'Vijayanagara': ['Hosapete','Hagaribommanahalli','Hagari','Kottur'],
  'Koppal': ['Koppal','Gangavati','Kushtagi','Yelburga'],
  'Raichur': ['Raichur','Lingsugur','Manvi','Mudugal','Sindhanur'],
  'Kalaburagi': ['Kalaburagi','Afzalpur','Aland','Chincholi','Sedam','Shahapur'],
  'Yadgir': ['Yadgir','Shorapur','Gurumitkal','Shahpur'],
  'Bidar': ['Bidar','Bhalki','Aurad','Humnabad','Basavakalyan'],
  'Vijayapura': ['Vijayapura','Sindagi','Basavana Bagewadi','Muddebihal','Indi'],
  'Bagalkote': ['Bagalkote','Badami','Bilagi','Guledagudda','Hungund','Ilkal','Jamkhandi','Mudhol'],
  'Davangere': ['Davangere','Channagiri','Honnali','Harihara','Jagalur'],
  'Chitradurga': ['Chitradurga','Holalkere','Hosadurga','Hiriyur','Challakere']
};

function updateDistrictOptions() {
  const sel = document.getElementById('select-district');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">Select district</option>';
  Object.keys(KA_DISTRICTS).sort().forEach(d => {
    const opt = document.createElement('option');
    opt.value = d; opt.textContent = d;
    if (d === current) opt.selected = true;
    sel.appendChild(opt);
  });
  updateVillageOptions();
}

function updateVillageOptions() {
  const distSel = document.getElementById('select-district');
  const vilSel = document.getElementById('select-village');
  if (!distSel || !vilSel) return;
  const district = distSel.value;
  const currentVil = vilSel.value;
  vilSel.innerHTML = '<option value="">Select village / town</option>';
  const villages = district ? (KA_DISTRICTS[district] || []) : [];
  villages.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v;
    if (v === currentVil) opt.selected = true;
    vilSel.appendChild(opt);
  });
}

// ===== CORE: fetch from DB and rebuild local cache =====
async function fetchAllFromApi() {
  try {
    const [usersRes, machinesRes, bookingsRes] = await Promise.all([
      fetch(`${API_BASE}/users`).then(r => r.json()),
      fetch(`${API_BASE}/machine_configs`).then(r => r.json()),
      fetch(`${API_BASE}/bookings`).then(r => r.json())
    ]);
    const users    = (usersRes.isOk    ? usersRes.data    : []).map(u => ({ ...u, type: 'user' }));
    const machines = (machinesRes.isOk ? machinesRes.data : []).map(m => ({ ...m, type: 'machine_config' }));
    const bookings = (bookingsRes.isOk ? bookingsRes.data : []).map(b => ({ ...b, type: 'booking' }));
    const merged = [...users, ...machines, ...bookings];
    allData = merged;
    recordCount = merged.length;
    machineConfigs = {};
    machines.forEach(m => {
      machineConfigs[m.machine_name] = {
        rate_per_acre:       Number(m.rate_per_acre)       || 800,
        cost_per_km:         Number(m.cost_per_km)         || 15,
        petrol_cost_per_km:  Number(m.petrol_cost_per_km)  || 25,
        driver_cost:         Number(m.driver_cost)         || 600,
        availability:        m.availability                || 'Available'
      };
    });
    return merged;
  } catch (e) {
    console.warn('API fetch failed:', e.message);
    return allData;
  }
}

function getApiCollection(type) {
  const map = {
    user:'users', users:'users',
    machine_config:'machine_configs', machine_configs:'machine_configs',
    booking:'bookings', bookings:'bookings'
  };
  return map[(type||'').toLowerCase()] || 'bookings';
}

// ===== SDK =====
window.dataSdk = {
  async create(record) {
    try {
      const res = await fetch(`${API_BASE}/${getApiCollection(record.type)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      }).then(r => r.json());
      if (res.isOk) {
        record.id = res.record_id;
        allData.unshift(record);
        recordCount = allData.length;
        return { isOk: true, id: res.record_id };
      }
      return { isOk: false, error: res.error || 'API error' };
    } catch (e) {
      return { isOk: false, error: e.message };
    }
  },
  async init(handler) {
    await fetchAllFromApi();
    return { isOk: true };
  },
  async update(record) {
    const id = record.id;
    if (!id) return { isOk: false, error: 'No record id' };
    try {
      const res = await fetch(`${API_BASE}/${getApiCollection(record.type)}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      }).then(r => r.json());
      if (res.isOk) {
        const idx = allData.findIndex(r => r.id === id && r.type === record.type);
        if (idx > -1) allData[idx] = record;
        return { isOk: true };
      }
      return { isOk: false, error: res.error || 'Update failed' };
    } catch (e) {
      return { isOk: false, error: e.message };
    }
  },
  async delete(record) {
    const id = record.id;
    if (!id) return { isOk: false, error: 'No record id' };
    try {
      const res = await fetch(`${API_BASE}/${getApiCollection(record.type)}/${id}`, {
        method: 'DELETE'
      }).then(r => r.json());
      if (res.isOk) {
        allData = allData.filter(r => !(r.id === id && r.type === record.type));
        return { isOk: true };
      }
      return { isOk: false, error: res.error || 'Delete failed' };
    } catch (e) {
      return { isOk: false, error: e.message };
    }
  }
};

// ===== SESSION =====
function saveSession() {
  try {
    if (isAdmin) {
      localStorage.setItem('agrobook_session', JSON.stringify({ isAdmin: true }));
    } else if (currentUser) {
      localStorage.setItem('agrobook_session', JSON.stringify({ user: currentUser }));
    } else {
      localStorage.removeItem('agrobook_session');
    }
  } catch(e) {}
}

async function restoreSession() {
  try {
    const sess = JSON.parse(localStorage.getItem('agrobook_session') || 'null');
    if (!sess) return false;
    if (sess.isAdmin) {
      isAdmin = true;
      showPage('admin-dashboard');
      return true;
    } else if (sess.user) {
      await fetchAllFromApi();
      const freshUser = allData.find(
        u => u.type === 'user' &&
             u.user_email === sess.user.user_email &&
             u.user_password === sess.user.user_password
      );
      if (!freshUser) {
        localStorage.removeItem('agrobook_session');
        currentUser = null;
        return false;
      }
      currentUser = freshUser;
      saveSession();
      const nameEl = document.getElementById('dash-username');
      if (nameEl) nameEl.textContent = '\uD83D\uDC64 ' + currentUser.user_name;
      showPage('user-dashboard');
      return true;
    }
  } catch(e) { localStorage.removeItem('agrobook_session'); }
  return false;
}

// ===== UTILS =====
function showToast(msg, type='success') {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg; t.className = 'toast ' + (type||'success') + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}
function isValidEmail(e)  { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function isValidPhone(p)  { return /^[0-9]{10}$/.test(p.replace(/\D/g,'')); }
function isStrongPassword(p) { return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(p); }
let passDebounceTimer = null;
function checkPasswordStrength(pass, elemId) {
  const elem = document.getElementById(elemId); if (!elem) return;
  clearTimeout(passDebounceTimer);
  passDebounceTimer = setTimeout(() => {
    if (!pass) { elem.textContent = ''; return; }
    if (isStrongPassword(pass)) { elem.textContent = '\u2705 Strong password'; elem.style.color = '#16a34a'; }
    else { elem.textContent = '\u274C Weak (8+ chars, upper, lower, number, special)'; elem.style.color = '#dc2626'; }
  }, 250);
}
function togglePassVis(inputId) {
  const input = document.getElementById(inputId);
  const icon  = document.getElementById(inputId + '-icon');
  if (!input) return;
  const ip = input.type === 'password';
  input.type = ip ? 'text' : 'password';
  if (icon) icon.setAttribute('data-lucide', ip ? 'eye-off' : 'eye');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ===== ROUTING =====
function safeShowPage(name) { event.preventDefault(); event.stopPropagation(); return showPage(name); }
function showPage(name) {
  try {
    document.querySelectorAll('.page').forEach(p => {
      p.classList.remove('active', 'fade-in'); p.style.display = 'none';
    });
    const el = document.getElementById('page-' + name);
    if (el) {
      el.style.display = 'block'; el.classList.add('active');
      el.classList.remove('fade-in'); void el.offsetWidth; el.classList.add('fade-in');
      currentPage = name;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      const nb = document.getElementById('nav-' + name); if (nb) nb.classList.add('active');
      if (name === 'user-dashboard') {
        updateDistrictOptions();
        renderUserBookings();
      }
      if (name === 'admin-dashboard') {
        fetchAllFromApi().then(() => {
          renderAdminMachine();
          renderAdminUsers();
          renderAdminBookings();
          initFleetMap();
        });
      }
      return true;
    } else { throw new Error(`Page "page-${name}" not found`); }
  } catch (error) {
    console.error('Navigation error:', error);
    showToast('Navigation error: ' + error.message, 'error');
    return false;
  }
}
function requireLogin() {
  if (!currentUser) { showPage('user-login'); showToast('Please login first.', 'error'); }
  else { switchUserTab('bookings'); showPage('user-dashboard'); }
}

// ===== AUTH =====
async function handleRegister(e) {
  e.preventDefault();
  const btn   = document.getElementById('reg-btn');
  const errEl = document.getElementById('reg-error');
  errEl.style.display = 'none'; btn.disabled = true; btn.innerHTML = 'Creating Account...';
  const name  = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim().toLowerCase();
  const phone = document.getElementById('reg-phone').value.trim();
  const pass  = document.getElementById('reg-pass').value;
  if (!name||!email||!phone||!pass) {
    btn.disabled=false; btn.textContent='Create Account';
    errEl.textContent='Please fill all fields.'; errEl.style.display='block'; return;
  }
  if (!isValidEmail(email)) {
    btn.disabled=false; btn.textContent='Create Account';
    errEl.textContent='Invalid email.'; errEl.style.display='block'; return;
  }
  if (!isValidPhone(phone)) {
    btn.disabled=false; btn.textContent='Create Account';
    errEl.textContent='Invalid phone (10 digits).'; errEl.style.display='block'; return;
  }
  if (!isStrongPassword(pass)) {
    btn.disabled=false; btn.textContent='Create Account';
    errEl.textContent='Weak password \u2014 8+ chars, upper, lower, number, special char.';
    errEl.style.display='block'; return;
  }
  await fetchAllFromApi();
  if (allData.find(r => r.type==='user' && r.user_email===email)) {
    btn.disabled=false; btn.textContent='Create Account';
    errEl.textContent='Email already registered.'; errEl.style.display='block'; return;
  }
  const res = await window.dataSdk.create({
    type: 'user', user_name: name, user_email: email,
    user_phone: phone, user_password: pass,
    created_at: new Date().toISOString(), status: 'active'
  });
  btn.disabled=false; btn.textContent='Create Account';
  if (res.isOk) {
    showToast('Account created! Please login.', 'success');
    document.getElementById('register-form').reset();
    showPage('user-login');
  } else {
    errEl.textContent = res.error || 'Registration failed.';
    errEl.style.display = 'block';
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const pass  = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error'); errEl.style.display = 'none';
  const btn   = document.getElementById('login-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Logging in...'; }
  await fetchAllFromApi();
  if (btn) { btn.disabled = false; btn.textContent = 'Login'; }
  const user = allData.find(r => r.type==='user' && r.user_email===email && r.user_password===pass);
  if (!user) { errEl.textContent = 'Invalid email or password.'; errEl.style.display = 'block'; return; }
  currentUser = user;
  saveSession();
  const nameEl = document.getElementById('dash-username');
  if (nameEl) nameEl.textContent = '\uD83D\uDC64 ' + user.user_name;
  document.getElementById('login-form').reset();
  showToast('Welcome back, ' + user.user_name + '!', 'success');
  showPage('user-dashboard');
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const email = document.getElementById('admin-email').value.trim().toLowerCase();
  const pass  = document.getElementById('admin-pass').value;
  const errEl = document.getElementById('admin-login-error'); errEl.style.display = 'none';
  if (email === 'admin@gmail.com' && pass.trim()) {
    isAdmin = true;
    saveSession();
    document.getElementById('admin-login-form').reset();
    showToast('Welcome, Admin!', 'success');
    showPage('admin-dashboard');
  } else {
    errEl.textContent = 'Please enter admin@gmail.com and password.';
    errEl.style.display = 'block';
  }
}

function logout() {
  currentUser = null; isAdmin = false;
  localStorage.removeItem('agrobook_session');
  stopGpsRefresh();
  stopTracking();
  showToast('Logged out successfully.', 'success');
  showPage('home');
}

// ===== COST CALCULATOR =====
function calculateCost(e) {
  e.preventDefault();
  const machineType = document.getElementById('machine-type').value;
  const crop        = document.getElementById('crop-type').value;
  const acres       = parseFloat(document.getElementById('num-acres').value);
  const dist        = parseFloat(document.getElementById('distance-km').value);
  const errEl       = document.getElementById('search-error'); errEl.style.display = 'none';
  if (!machineType||!crop||!acres||acres<=0||!dist||dist<=0) {
    errEl.textContent = 'Please fill all fields.'; errEl.style.display = 'block'; return;
  }
  const config = machineConfigs[machineType] || { rate_per_acre:800, cost_per_km:15, driver_cost:600, availability:'Available' };
  const machine_cost = acres * config.rate_per_acre;
  const travel_cost  = dist  * config.cost_per_km;
  const driver_cost  = config.driver_cost;
  const total_cost   = machine_cost + travel_cost + driver_cost;
  const estHours     = Math.ceil(acres * 1.5);
  const isGrassCutter  = machineType === 'Grass Cutter';
  const isUnavailable  = isGrassCutter && config.availability !== 'Available';
  const icons = { 'Grass Cutter':'\uD83C\uDF3F','Harvester':'\uD83C\uDF3E','Flip plow':'\uD83D\uDD04','Corn Planter':'\uD83C\uDF3D','other':'\uD83D\uDE9C' };
  const iconEl = document.getElementById('res-machine-icon'); if (iconEl) iconEl.textContent = icons[machineType]||'\uD83D\uDE9C';
  document.title = machineType + ' - AgroBook';
  document.getElementById('res-machine').textContent       = machineType;
  document.getElementById('res-machine-title').textContent = machineType + ' Cost Breakdown';
  document.getElementById('res-crop').textContent          = crop;
  document.getElementById('res-acres').textContent         = acres + ' acres';
  document.getElementById('res-machine-cost').textContent  = '\u20B9' + machine_cost.toLocaleString('en-IN');
  document.getElementById('res-travel-cost').textContent   = '\u20B9' + travel_cost.toLocaleString('en-IN');
  document.getElementById('res-driver-cost').textContent   = '\u20B9' + driver_cost.toLocaleString('en-IN');
  document.getElementById('res-total').textContent         = '\u20B9' + total_cost.toLocaleString('en-IN');
  document.getElementById('res-time').textContent          = estHours + ' hour' + (estHours > 1 ? 's' : '');
  document.getElementById('result-card').style.display     = 'block';
  const statusEl    = document.getElementById('res-machine-status');
  const statusTextEl= document.getElementById('res-status-text');
  const warningEl   = document.getElementById('res-unavailable-warning');
  const bookBtn     = document.getElementById('book-btn');
  if (isUnavailable) {
    bookBtn.style.display = 'none'; if (warningEl) warningEl.style.display = 'block';
    if (statusEl&&statusTextEl) { statusEl.style.display='block'; statusTextEl.textContent=config.availability; }
    showToast('Grass Cutter is currently ' + config.availability.toLowerCase() + '. Cannot book.', 'error');
  } else {
    bookBtn.style.display = 'block'; if (warningEl) warningEl.style.display = 'none';
    if (statusEl&&statusTextEl&&isGrassCutter) { statusEl.style.display='block'; statusTextEl.textContent='Available'; }
  }
  pendingBookingData = { machine_name:machineType, crop_type:crop, acres, distance:dist, machine_cost, travel_cost, driver_cost, total_cost, estimated_hours:estHours };
}

async function autoFillDistanceFromGPS() {
  if (!navigator.geolocation) { showToast('Geolocation not supported','error'); return; }
  navigator.geolocation.getCurrentPosition(async pos => {
    const userLat = pos.coords.latitude, userLng = pos.coords.longitude;
    const machineType = document.getElementById('machine-type').value;
    if (!machineType) { showToast('Select a machine type first','error'); return; }
    const base = MACHINE_BASE_LOCATIONS[machineType] || { lat:13.135, lng:78.132 };
    try {
      const R = 6371;
      const dLat = (userLat - base.lat) * Math.PI / 180;
      const dLng = (userLng - base.lng) * Math.PI / 180;
      const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(base.lat*Math.PI/180)*Math.cos(userLat*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distKm = (R * c * 1.3).toFixed(1);
      document.getElementById('distance-km').value = distKm;
      showToast('Distance: ' + distKm + ' km \uD83D\uDCCD','success');
    } catch(e) { showToast('GPS distance error: ' + e.message,'error'); }
  }, () => showToast('Location access denied','error'));
}

async function confirmBooking() {
  if (!currentUser||!currentUser.user_name) { return showToast('Please login first.','error'); }
  if (!pendingBookingData)                  { return showToast('Please calculate cost first.','error'); }
  const btn   = document.getElementById('book-btn') || { disabled:false, innerHTML:'', textContent:'' };
  const errEl = document.getElementById('book-error'); if (errEl) errEl.style.display='none';
  btn.disabled = true; btn.innerHTML = 'Confirming...';
  try {
    const bookingData = {
      type: 'booking',
      user_name:  currentUser.user_name,
      user_email: currentUser.user_email,
      user_phone: currentUser.user_phone,
      ...pendingBookingData,
      status: 'Pending',
      created_at: new Date().toISOString()
    };
    const res = await window.dataSdk.create(bookingData);
    btn.disabled = false; btn.textContent = '\u2705 Confirmed!';
    if (res.isOk) {
      showToast(pendingBookingData.machine_name + ' booked! \uD83C\uDF89','success');
      pendingBookingData = null;
      const rc = document.getElementById('result-card'); if (rc) rc.style.display = 'none';
      const sf = document.getElementById('search-form'); if (sf) sf.reset();
      switchUserTab('bookings');
    } else { throw new Error(res.error || 'Unknown error'); }
  } catch(error) {
    showToast('Booking failed: ' + error.message,'error');
    btn.disabled = false; btn.innerHTML = '\u2705 Confirm Booking';
  }
}

// ===== USER DASHBOARD =====
function switchUserTab(tab) {
  document.getElementById('udash-search').style.display   = tab==='search'   ? '' : 'none';
  document.getElementById('udash-bookings').style.display = tab==='bookings' ? '' : 'none';
  document.getElementById('udash-tab-search').classList.toggle('active',   tab==='search');
  document.getElementById('udash-tab-bookings').classList.toggle('active', tab==='bookings');
  if (tab === 'bookings') renderUserBookings();
}

async function renderUserBookings() {
  if (!currentUser) return;
  const container = document.getElementById('user-bookings-list'); if (!container) return;
  container.innerHTML = '<div style="color:#6b7280;font-size:0.9rem;padding:1rem">\u23F3 Loading bookings...</div>';
  let userBookings = [];
  try {
    const res = await fetch(`${API_BASE}/bookings?email=${encodeURIComponent(currentUser.user_email)}`).then(r => r.json());
    userBookings = (res.isOk && Array.isArray(res.data)) ? res.data : [];
  } catch(e) {
    userBookings = allData.filter(r => r.type==='booking' && r.user_email===currentUser.user_email);
  }
  if (!userBookings.length) {
    container.innerHTML = '<div style="text-align:center;padding:56px 16px;color:#9ca3af"><div style="font-size:3rem;margin-bottom:14px">\uD83D\uDCCB</div><p style="font-size:15px">No bookings yet. Search and book a machine above!</p></div>';
    return;
  }
  container.innerHTML = userBookings.map(b => {
    const status = (b.status || 'Pending');
    const machineName = b.machine_name || 'Machine';
    const totalCost = Number(b.total_cost) || 0;
    const isConfirmed = status.toLowerCase() === 'confirmed';
    // Check if this booking has already been delivered (tracking finished)
    const savedState = loadTrackingState(b.id);
    const isDelivered = savedState && computeCurrentIndex(savedState) >= savedState.totalPoints - 1;

    // Track button: only show for Confirmed bookings
    let trackBtn = '';
    if (isConfirmed) {
      if (isDelivered) {
        trackBtn = '<div style="margin-top:10px;background:#dcfce7;color:#16a34a;font-size:12px;font-weight:700;padding:8px 14px;border-radius:8px;display:inline-block;">\uD83C\uDF89 Machine Delivered!</div>';
      } else {
        trackBtn = '<button class="btn-sm" onclick="showBookingMap(\'' + machineName.replace(/'/g,"\\'")
          + '\', \'' + b.id + '\')" style="margin-top:10px;font-size:12px;">\uD83D\uDCE1 Track Machine</button>';
      }
    } else if (status.toLowerCase() === 'pending') {
      trackBtn = '<div style="margin-top:10px;font-size:12px;color:#9ca3af;font-style:italic;">\u23F3 Awaiting admin confirmation to track</div>';
    }

    return '<div class="booking-card">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">'+
      '<span style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:16px;">' + machineName + '</span>'+
      '<span class="badge status-' + status.toLowerCase() + '">' + status + '</span>'+
      '</div>'+
      '<div class="booking-meta" style="display:flex;flex-wrap:wrap;gap:12px;margin-top:8px;">'+
      '<span>\uD83C\uDF3E ' + (b.crop_type||'-') + '</span>'+
      '<span>\uD83D\uDCD0 ' + (b.acres||'-') + ' acres</span>'+
      '<span>\uD83D\uDCCD ' + (b.distance||'-') + ' km</span>'+
      '<span>\uD83D\uDCB0 \u20B9' + totalCost.toLocaleString('en-IN') + '</span>'+
      '<span>\u23F1\uFE0F ' + (b.estimated_hours||'-') + ' hrs</span>'+
      '</div>'+
      '<div style="font-size:12px;color:#9ca3af;margin-top:6px;">' + (b.created_at ? new Date(b.created_at).toLocaleString('en-IN') : '') + '</div>'+
      trackBtn +
      '</div>';
  }).join('');
}

// ===== GPS TRACKING — SIMULATION ENGINE =====

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function bearing(lat1, lng1, lat2, lng2) {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
             Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function directionLabel(deg) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW','N'];
  return dirs[Math.round(deg / 45)];
}

async function fetchOSRMRoute(fromLat, fromLng, toLat, toLng) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&steps=false`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const coords = data.routes[0].geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
      const distanceKm = (data.routes[0].distance / 1000).toFixed(1);
      const durationMin = Math.round(data.routes[0].duration / 60);
      return { coords, distanceKm, durationMin };
    }
  } catch(e) { console.warn('OSRM failed, using straight line fallback:', e.message); }
  return null;
}

function interpolateRoute(coords) {
  if (coords.length < 2) return coords;
  const dense = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i], p2 = coords[i+1];
    const segKm = haversineKm(p1.lat, p1.lng, p2.lat, p2.lng);
    const steps = Math.max(1, Math.round(segKm * 10));
    for (let s = 0; s <= steps; s++) {
      dense.push({
        lat: p1.lat + (p2.lat - p1.lat) * s / steps,
        lng: p1.lng + (p2.lng - p1.lng) * s / steps
      });
    }
  }
  return dense;
}

// ===== REALISTIC SPEED ENGINE =====
function getRealisticStepIntervalMs(totalPoints, totalDistKm, currentIndex) {
  const progress = currentIndex / totalPoints;
  let baseSpeedKmh;
  if (progress < 0.1 || progress > 0.9) {
    baseSpeedKmh = 20 + Math.random() * 10;
  } else if (progress < 0.2 || progress > 0.8) {
    baseSpeedKmh = 30 + Math.random() * 15;
  } else {
    baseSpeedKmh = 45 + Math.random() * 15;
  }
  if (Math.random() < 0.10) {
    baseSpeedKmh *= (0.4 + Math.random() * 0.3);
  }
  const stepDistKm = totalDistKm / totalPoints;
  const realStepSec = (stepDistKm / baseSpeedKmh) * 3600;
  const visualMs = Math.round(realStepSec * (2000 / 60));
  return Math.max(150, Math.min(800, visualMs));
}

function getDisplaySpeed(totalPoints, totalDistKm, currentIndex) {
  const progress = currentIndex / totalPoints;
  let base;
  if (progress < 0.1 || progress > 0.9) {
    base = 22 + Math.random() * 8;
  } else if (progress < 0.2 || progress > 0.8) {
    base = 32 + Math.random() * 13;
  } else {
    base = 46 + Math.random() * 14;
  }
  if (Math.random() < 0.08) base *= (0.5 + Math.random() * 0.3);
  return Math.round(base);
}

function stopTracking() {
  if (trackingTimer) { clearTimeout(trackingTimer); trackingTimer = null; }
  trackingRoute = []; trackingIndex = 0;
}

async function showBookingMap(machineName, bookingId) {
  stopTracking();

  // Build modal
  let modal = document.getElementById('gps-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'gps-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(modal);
  }
  modal.innerHTML =
    '<div style="background:#fff;border-radius:16px;padding:1.5rem;width:92%;max-width:640px;max-height:92vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">'+
    '<h3 style="margin:0;font-size:1.1rem;">\uD83D\uDE9C Live Tracking: <span id="gps-modal-title" style="color:#16a34a;"></span></h3>'+
    '<button onclick="closeGpsModal()" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:#6b7280;">\u2715</button>'+
    '</div>'+
    '<div id="gps-info-bar" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.88rem;line-height:1.6;"></div>'+
    '<div id="gps-user-map" style="height:320px;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;"></div>'+
    '<div id="trip-stats" style="margin-top:1rem;display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem;"></div>'+
    '<div id="trip-history" style="margin-top:1rem;"></div>'+
    '</div>';
  modal.style.display = 'flex';
  document.getElementById('gps-modal-title').textContent = machineName;

  if (trackingMap) { trackingMap.remove(); trackingMap = null; }
  if (typeof L === 'undefined') {
    document.getElementById('gps-info-bar').innerHTML = '\u26A0\uFE0F Leaflet map not loaded. Please refresh.';
    return;
  }

  const base = MACHINE_BASE_LOCATIONS[machineName] || { lat:13.135, lng:78.132, label:'Kolar Base' };
  const infoBar = document.getElementById('gps-info-bar');

  // ===== LOAD SAVED STATE (time-based: machine kept moving while modal was closed) =====
  const savedState = loadTrackingState(bookingId);
  let denseRoute, totalDistKm, totalDurMin, startedAt;
  let userLat, userLng;

  if (savedState && savedState.route && savedState.route.length > 1) {
    // Resume: compute where machine is NOW based on elapsed real time
    denseRoute   = savedState.route;
    totalDistKm  = savedState.distKm;
    totalDurMin  = savedState.durMin;
    startedAt    = savedState.startedAt;
    userLat = denseRoute[denseRoute.length - 1].lat;
    userLng = denseRoute[denseRoute.length - 1].lng;

    const resumeIndex = computeCurrentIndex(savedState);
    trackingIndex = resumeIndex;

    const elapsedMin = Math.round((Date.now() - startedAt) / 60000);
    infoBar.innerHTML = '\uD83D\uDD04 <b>Tracking resumed</b> &mdash; machine has been moving for <b>' + elapsedMin + ' min</b> (' + resumeIndex + '/' + savedState.totalPoints + ' pts covered)';
  } else {
    // Fresh start — fetch GPS + route
    trackingIndex = 0;
    infoBar.innerHTML = '\u23F3 Fetching route from <b>' + base.label + '</b> to your location...';

    userLat = 13.0827; userLng = 80.2707;
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
      );
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
    } catch(e) {
      userLat = 12.9716; userLng = 77.5946;
      infoBar.innerHTML += '<br><small style="color:#d97706;">\u26A0\uFE0F Location access denied \u2014 using Bengaluru as demo destination.</small>';
    }

    infoBar.innerHTML = '\uD83D\uDDFA\uFE0F Fetching road route via OSRM...';
    const routeData = await fetchOSRMRoute(base.lat, base.lng, userLat, userLng);

    let routeCoords;
    if (routeData) {
      routeCoords  = routeData.coords;
      totalDistKm  = routeData.distanceKm;
      totalDurMin  = routeData.durationMin;
    } else {
      routeCoords  = interpolateRoute([{ lat:base.lat, lng:base.lng }, { lat:userLat, lng:userLng }]);
      totalDistKm  = haversineKm(base.lat, base.lng, userLat, userLng).toFixed(1);
      totalDurMin  = Math.round(totalDistKm * 2.5);
    }
    denseRoute = interpolateRoute(routeCoords);
    startedAt  = Date.now();

    // Save the new tracking state (startedAt = now, index will be computed from time)
    saveTrackingState(bookingId, startedAt, denseRoute.length, machineName, denseRoute, totalDistKm, totalDurMin);
  }

  trackingRoute = denseRoute;
  const totalPoints = denseRoute.length;

  // If already delivered (machine arrived while modal was closed)
  if (trackingIndex >= totalPoints - 1) {
    infoBar.innerHTML =
      '<div style="text-align:center;padding:1rem;">'+
      '<div style="font-size:2.5rem;">\uD83C\uDF89</div>'+
      '<div style="font-size:1.1rem;font-weight:700;color:#16a34a;margin-top:8px;">'+machineName+' has been Delivered!</div>'+
      '<div style="font-size:0.85rem;color:#6b7280;margin-top:6px;">Your machine reached the destination successfully.</div>'+
      '</div>';
    // Still init map to show final position
    const destPt = denseRoute[totalPoints - 1];
    trackingMap = L.map('gps-user-map').setView([destPt.lat, destPt.lng], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '\u00A9 OpenStreetMap contributors', maxZoom: 18 }).addTo(trackingMap);
    L.polyline(denseRoute.map(p => [p.lat, p.lng]), { color:'#16a34a', weight:5, opacity:0.9 }).addTo(trackingMap);
    const arrivedIcon = L.divIcon({ html: '<div style="font-size:2rem;">\uD83C\uDFE0</div>', iconSize:[36,36], iconAnchor:[18,18], className:'' });
    L.marker([destPt.lat, destPt.lng], { icon: arrivedIcon }).addTo(trackingMap);
    clearTrackingState(bookingId);
    renderUserBookings(); // refresh the booking list to show "Delivered" badge
    return;
  }

  // Init map
  const startPt = denseRoute[trackingIndex] || { lat: base.lat, lng: base.lng };
  const midLat = (startPt.lat + denseRoute[totalPoints-1].lat) / 2;
  const midLng = (startPt.lng + denseRoute[totalPoints-1].lng) / 2;
  trackingMap = L.map('gps-user-map').setView([midLat, midLng], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '\u00A9 OpenStreetMap contributors', maxZoom: 18
  }).addTo(trackingMap);

  const plannedLatLngs = denseRoute.map(p => [p.lat, p.lng]);
  L.polyline(plannedLatLngs, { color:'#d1d5db', weight:4, opacity:0.6, dashArray:'8,6' }).addTo(trackingMap);

  travelledPolyline = L.polyline(
    denseRoute.slice(0, trackingIndex + 1).map(p => [p.lat, p.lng]),
    { color:'#16a34a', weight:5, opacity:0.85 }
  ).addTo(trackingMap);

  const baseIcon = L.divIcon({
    html: '<div style="background:#1a3a1a;color:#fff;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.4);">\uD83C\uDFE0 '+base.label+'</div>',
    iconSize:[140,26], iconAnchor:[70,13], className:''
  });
  L.marker([base.lat, base.lng], { icon: baseIcon }).addTo(trackingMap);

  const destIcon = L.divIcon({
    html: '<div style="background:#2563eb;color:#fff;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.4);">\uD83C\uDFE0 Your Location</div>',
    iconSize:[120,26], iconAnchor:[60,13], className:''
  });
  const destPt = denseRoute[totalPoints - 1];
  L.marker([destPt.lat, destPt.lng], { icon: destIcon }).addTo(trackingMap);

  const machineIcon = L.divIcon({
    html: '<div style="font-size:2rem;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4));">\uD83D\uDE9C</div>',
    iconSize:[36,36], iconAnchor:[18,18], className:''
  });
  trackingMarker = L.marker([startPt.lat, startPt.lng], { icon: machineIcon, zIndexOffset: 1000 }).addTo(trackingMap);

  const bounds = L.latLngBounds(plannedLatLngs);
  trackingMap.fitBounds(bounds, { padding:[30,30] });

  // Stats cards
  const statsEl = document.getElementById('trip-stats');
  if (statsEl) {
    statsEl.innerHTML =
      '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:0.75rem;text-align:center;"><div style="font-size:1.4rem;font-weight:800;color:#16a34a;" id="stat-dist">'+totalDistKm+' km</div><div style="font-size:0.75rem;color:#6b7280;margin-top:2px;">Total Distance</div></div>'+
      '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:0.75rem;text-align:center;"><div style="font-size:1.4rem;font-weight:800;color:#2563eb;" id="stat-eta">'+totalDurMin+' min</div><div style="font-size:0.75rem;color:#6b7280;margin-top:2px;">Est. Arrival</div></div>'+
      '<div style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:0.75rem;text-align:center;"><div style="font-size:1.4rem;font-weight:800;color:#d97706;" id="stat-speed">0 km/h</div><div style="font-size:0.75rem;color:#6b7280;margin-top:2px;">Live Speed</div></div>';
  }

  infoBar.innerHTML = '\uD83D\uDFE2 <b>Live Simulation Active</b> &mdash; '+machineName+' is en route from <b>'+base.label+'</b><br>Total route: <b>'+totalDistKm+' km</b> &nbsp;|&nbsp; Est. time: <b>'+totalDurMin+' min</b>';

  const travelledPath = denseRoute.slice(0, trackingIndex + 1).map(p => [p.lat, p.lng]);
  const stepDistKm = parseFloat(totalDistKm) / totalPoints;

  function scheduleNextStep() {
    if (trackingIndex >= totalPoints - 1) {
      // === DELIVERED ===
      infoBar.innerHTML =
        '<div style="text-align:center;padding:0.75rem;">'+
        '<div style="font-size:2.5rem;">\uD83C\uDF89</div>'+
        '<div style="font-size:1.1rem;font-weight:700;color:#16a34a;margin-top:8px;">'+machineName+' Delivered!</div>'+
        '<div style="font-size:0.85rem;color:#6b7280;margin-top:4px;">Your machine has successfully reached the destination.</div>'+
        '</div>';
      const speedEl = document.getElementById('stat-speed'); if (speedEl) speedEl.textContent = '0 km/h';
      const etaEl = document.getElementById('stat-eta'); if (etaEl) etaEl.textContent = '\u2705 Arrived!';
      const distEl = document.getElementById('stat-dist'); if (distEl) distEl.textContent = '0 km left';
      clearTrackingState(bookingId);
      renderUserBookings(); // update booking card to show "Delivered" badge
      return;
    }

    const intervalMs = getRealisticStepIntervalMs(totalPoints, parseFloat(totalDistKm), trackingIndex);
    trackingTimer = setTimeout(() => {
      // Sync index to wall clock in case time jumped (e.g. tab was inactive)
      const syncedState = loadTrackingState(bookingId);
      if (syncedState) {
        const clockIndex = computeCurrentIndex(syncedState);
        if (clockIndex > trackingIndex + 5) {
          // Jump ahead silently
          trackingIndex = Math.min(clockIndex, totalPoints - 1);
          travelledPolyline.setLatLngs(denseRoute.slice(0, trackingIndex + 1).map(p => [p.lat, p.lng]));
          trackingMarker.setLatLng([denseRoute[trackingIndex].lat, denseRoute[trackingIndex].lng]);
        } else {
          trackingIndex++;
        }
      } else {
        trackingIndex++;
      }

      const curr = denseRoute[trackingIndex];
      const prev = denseRoute[Math.max(0, trackingIndex - 1)];
      travelledPath.push([curr.lat, curr.lng]);
      trackingMarker.setLatLng([curr.lat, curr.lng]);
      travelledPolyline.setLatLngs(travelledPath);

      const liveSpeed = getDisplaySpeed(totalPoints, parseFloat(totalDistKm), trackingIndex);
      const dir = directionLabel(bearing(prev.lat, prev.lng, curr.lat, curr.lng));
      const remainingPoints = totalPoints - trackingIndex;
      const remainingKm = (remainingPoints * stepDistKm).toFixed(1);
      const remainingMin = Math.round((remainingPoints / totalPoints) * parseFloat(totalDurMin));

      const speedEl = document.getElementById('stat-speed'); if (speedEl) speedEl.textContent = liveSpeed+' km/h';
      const etaEl = document.getElementById('stat-eta'); if (etaEl) etaEl.textContent = remainingMin+' min';
      const distEl = document.getElementById('stat-dist'); if (distEl) distEl.textContent = remainingKm+' km left';

      infoBar.innerHTML = '\uD83D\uDFE2 <b>Live</b> &mdash; Speed: <b>'+liveSpeed+' km/h</b> &nbsp;|&nbsp; Direction: <b>'+dir+'</b> &nbsp;|&nbsp; Remaining: <b>'+remainingKm+' km</b> / <b>'+remainingMin+' min</b>';

      trackingMap.panTo([curr.lat, curr.lng], { animate: true, duration: 0.3 });

      // Trip log every 20 steps
      const hist = document.getElementById('trip-history');
      if (hist && trackingIndex % 20 === 0) {
        const entry = '<div style="font-size:0.78rem;padding:0.2rem 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">'+new Date().toLocaleTimeString('en-IN')+' &mdash; '+curr.lat.toFixed(5)+', '+curr.lng.toFixed(5)+' &mdash; '+liveSpeed+' km/h '+dir+'</div>';
        hist.innerHTML = '<h4 style="margin:0 0 0.4rem;font-size:0.85rem;">\uD83D\uDDFA\uFE0F Trip Log</h4>' + entry + (hist.innerHTML.replace(/<h4[^>]*>[^<]*<\/h4>/,'') || '');
      }

      scheduleNextStep();
    }, intervalMs);
  }

  scheduleNextStep();
}

function closeGpsModal() {
  const m = document.getElementById('gps-modal'); if (m) m.style.display = 'none';
  // NOTE: Do NOT call stopTracking() here — we want the timer to keep running
  // so that wall-clock time advances and the machine position is correctly
  // computed via computeCurrentIndex() when the modal re-opens.
  // We only stop the visual animation loop:
  if (trackingTimer) { clearTimeout(trackingTimer); trackingTimer = null; }
  if (trackingMap) { trackingMap.remove(); trackingMap = null; }
}

// ===== GPS - ADMIN FLEET MAP =====
async function initFleetMap() {
  const container = document.getElementById('fleet-map'); if (!container) return;
  if (fleetMap) { fleetMap.remove(); fleetMap = null; fleetMarkers = {}; }
  fleetMap = L.map('fleet-map').setView([13.135,78.132],13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'\u00A9 OpenStreetMap contributors'}).addTo(fleetMap);
  L.marker([13.135,78.132],{
    icon: L.divIcon({
      html: '<div style="background:#1a3a1a;color:#fff;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.3);">\uD83C\uDFE0 AgroBook Base</div>',
      iconSize:[130,26],iconAnchor:[65,13],className:''
    })
  }).addTo(fleetMap);
  await refreshFleetMap();
  startGpsRefresh();
  await loadGeofenceAlerts();
}

async function refreshFleetMap() {
  if (!fleetMap) return;
  const statusColors = {'Available':'#16a34a','Busy':'#dc2626','Maintenance':'#d97706'};
  const statusDot    = {'Available':'\uD83D\uDFE2','Busy':'\uD83D\uDD34','Maintenance':'\uD83D\uDFE1'};
  const machineEmoji = {'Grass Cutter':'\uD83C\uDF3F','Harvester':'\uD83C\uDF3E','Flip plow':'\uD83D\uDD04','Corn Planter':'\uD83C\uDF3D'};

  const machinesToShow = Object.keys(MACHINE_BASE_LOCATIONS);
  machinesToShow.forEach(machineName => {
    const base  = MACHINE_BASE_LOCATIONS[machineName];
    const lat   = base.lat, lng = base.lng;
    const avail = (machineConfigs[machineName]||{}).availability || 'Available';
    const color = statusColors[avail]  || '#6b7280';
    const dot   = statusDot[avail]     || '\uD83D\uDFE2';
    const emoji = machineEmoji[machineName] || '\uD83D\uDE9C';
    const iconHtml =
      '<div style="display:flex;flex-direction:column;align-items:center;">'+
      '<div style="background:#fff;border:2px solid '+color+';border-radius:20px;padding:4px 10px;box-shadow:0 2px 8px rgba(0,0,0,0.15);display:flex;align-items:center;gap:5px;white-space:nowrap;">'+
      '<span style="font-size:14px;">'+emoji+'</span>'+
      '<span style="font-size:11px;font-weight:700;color:#1a3a1a;font-family:sans-serif;">'+machineName+'</span>'+
      '<span style="font-size:11px;">'+dot+'</span>'+
      '</div>'+
      '<div style="width:2px;height:6px;background:'+color+';"></div>'+
      '<div style="width:7px;height:7px;border-radius:50%;background:'+color+';border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.25);"></div>'+
      '</div>';
    const icon  = L.divIcon({html:iconHtml,iconSize:[150,54],iconAnchor:[75,54],className:''});
    const popup =
      '<b>'+emoji+' '+machineName+'</b><br>'+
      '<span style="color:'+color+';font-weight:600;">'+dot+' '+avail+'</span><br>'+
      '\uD83D\uDCCD '+base.label+'<br>'+
      '<small>GPS: '+lat.toFixed(4)+', '+lng.toFixed(4)+'</small>';
    if (fleetMarkers[machineName]) {
      fleetMarkers[machineName].setLatLng([lat,lng]);
      fleetMarkers[machineName].setIcon(icon);
      fleetMarkers[machineName].setPopupContent(popup);
    } else {
      fleetMarkers[machineName] = L.marker([lat,lng],{icon}).addTo(fleetMap).bindPopup(popup);
    }
  });
}

function startGpsRefresh() { stopGpsRefresh(); gpsRefreshTimer = setInterval(async()=>{ await refreshFleetMap(); await loadGeofenceAlerts(); },30000); }
function stopGpsRefresh()  { if (gpsRefreshTimer) { clearInterval(gpsRefreshTimer); gpsRefreshTimer = null; } }

// ===== GEOFENCE ALERTS =====
async function loadGeofenceAlerts() {
  const container = document.getElementById('geofence-alerts-list'); if (!container) return;
  try {
    const res = await fetch(`${API_BASE}/geofence_alerts`).then(r => r.json());
    if (!res.isOk||!res.data.length) { container.innerHTML='<div style="color:#6b7280;font-size:0.9rem">\u2705 No active alerts</div>'; return; }
    container.innerHTML = res.data.map(a =>
      '<div class="booking-card" style="border-left:4px solid #dc2626;margin-bottom:0.5rem;">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;">'+
      '<span><b>\u26A0\uFE0F '+a.alert_type+'</b> \u2014 '+a.machine_name+'</span>'+
      '<button onclick="resolveAlert('+a.id+',this)" style="background:#dc2626;color:#fff;border:none;border-radius:6px;padding:0.25rem 0.75rem;cursor:pointer;font-size:0.8rem">Resolve</button>'+
      '</div>'+
      '<div style="font-size:0.82rem;color:#6b7280;margin-top:0.25rem">'+a.message+'</div>'+
      '<div style="font-size:0.75rem;color:#9ca3af">'+a.created_at+'</div>'+
      '</div>'
    ).join('');
  } catch(e) { container.innerHTML='<div style="color:#6b7280;font-size:0.9rem">\u2705 No active alerts</div>'; }
}
async function resolveAlert(alertId, btn) {
  btn.disabled = true; btn.textContent = 'Resolving...';
  try {
    const res = await fetch(`${API_BASE}/geofence_alerts/${alertId}/resolve`,{method:'POST'}).then(r=>r.json());
    if (res.isOk) { showToast('Alert resolved','success'); await loadGeofenceAlerts(); }
    else { throw new Error(res.error); }
  } catch(e) { showToast('Failed: '+e.message,'error'); btn.disabled=false; btn.textContent='Resolve'; }
}

// ===== ADMIN: MACHINE CONFIG =====
function onAdminMachineChange() {
  currentAdminMachine = document.getElementById('admin-machine-selector').value;
  const icons = {'Grass Cutter':'\uD83C\uDF3F','Harvester':'\uD83C\uDF3E','Flip plow':'\uD83D\uDD04','Corn Planter':'\uD83C\uDF3D'};
  const iconEl = document.getElementById('admin-machine-icon');
  if (iconEl) iconEl.textContent = icons[currentAdminMachine] || '\uD83D\uDE9C';
  const cfg = machineConfigs[currentAdminMachine] || {rate_per_acre:800,cost_per_km:15,petrol_cost_per_km:25,driver_cost:600,availability:'Available'};
  document.getElementById('cfg-rate').value       = cfg.rate_per_acre;
  document.getElementById('cfg-cpkm').value       = cfg.cost_per_km;
  document.getElementById('cfg-petrol-km').value  = cfg.petrol_cost_per_km;
  document.getElementById('cfg-driver').value     = cfg.driver_cost;
  const availEl = document.getElementById('cfg-avail');
  if (availEl) availEl.value = cfg.availability || 'Available';
  const dispRate   = document.getElementById('disp-rate');       if (dispRate)   dispRate.textContent   = '\u20B9'+cfg.rate_per_acre;
  const dispCpkm   = document.getElementById('disp-cpkm');       if (dispCpkm)   dispCpkm.textContent   = '\u20B9'+cfg.cost_per_km;
  const dispPetrol = document.getElementById('disp-petrol-km');  if (dispPetrol) dispPetrol.textContent = '\u20B9'+cfg.petrol_cost_per_km;
  const dispDriver = document.getElementById('disp-driver');     if (dispDriver) dispDriver.textContent = '\u20B9'+cfg.driver_cost;
  const badge = document.getElementById('machine-avail-badge');
  if (badge) {
    badge.textContent = cfg.availability || 'Available';
    badge.className   = 'badge status-' + (cfg.availability||'Available').toLowerCase().replace(/\s+/g,'-');
  }
}

async function saveMachineConfig(e) {
  e.preventDefault();
  const errEl = document.getElementById('machine-save-error');
  const btn   = document.getElementById('machine-save-btn');
  if (errEl) errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Saving...';
  const machineName = document.getElementById('admin-machine-selector').value;
  const rate   = parseFloat(document.getElementById('cfg-rate').value);
  const cpkm   = parseFloat(document.getElementById('cfg-cpkm').value);
  const petrol = parseFloat(document.getElementById('cfg-petrol-km').value);
  const driver = parseFloat(document.getElementById('cfg-driver').value);
  const avail  = document.getElementById('cfg-avail').value;
  if (!machineName||isNaN(rate)||isNaN(cpkm)||isNaN(petrol)||isNaN(driver)) {
    if (errEl) { errEl.textContent='Please fill all fields with valid numbers.'; errEl.style.display='block'; }
    btn.disabled=false; btn.textContent='Save Configuration'; return;
  }
  const existingRecord = allData.find(r => r.type==='machine_config' && r.machine_name===machineName);
  const configRecord   = { type:'machine_config', machine_name:machineName, rate_per_acre:rate, cost_per_km:cpkm, petrol_cost_per_km:petrol, driver_cost:driver, availability:avail, updated_at:new Date().toISOString() };
  let res;
  if (existingRecord && existingRecord.id) {
    res = await window.dataSdk.update({ ...existingRecord, ...configRecord });
  } else {
    res = await window.dataSdk.create(configRecord);
  }
  btn.disabled=false; btn.textContent='Save Configuration';
  if (res.isOk) {
    showToast(machineName + ' configuration saved! \u2705','success');
    machineConfigs[machineName] = { rate_per_acre:rate, cost_per_km:cpkm, petrol_cost_per_km:petrol, driver_cost:driver, availability:avail };
    const idx = allData.findIndex(r => r.type==='machine_config' && r.machine_name===machineName);
    if (idx > -1) { allData[idx] = { ...allData[idx], ...configRecord }; } else { allData.unshift(configRecord); }
    onAdminMachineChange();
    fetchAllFromApi();
    if (typeof refreshFleetMap === 'function') refreshFleetMap();
  } else {
    if (errEl) { errEl.textContent='Save failed: '+(res.error||'Unknown error'); errEl.style.display='block'; }
  }
}

async function renderAdminMachine() {
  onAdminMachineChange();
}

// ===== ADMIN: RENDER USERS =====
async function renderAdminUsers() {
  const listEl = document.getElementById('admin-users-list');
  if (!listEl) return;
  listEl.innerHTML = '<div style="color:#6b7280;font-size:0.9rem;padding:1rem">\u23F3 Loading users...</div>';
  let users = [];
  try {
    const res = await fetch(`${API_BASE}/users`).then(r => r.json());
    users = (res.isOk && Array.isArray(res.data)) ? res.data : allData.filter(r => r.type==='user');
  } catch(e) {
    users = allData.filter(r => r.type==='user');
  }
  if (!users.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:56px 16px;color:#9ca3af"><div style="font-size:3rem;margin-bottom:14px">\uD83D\uDC64</div><p style="font-size:15px">No users registered yet.</p></div>';
    return;
  }
  listEl.innerHTML = users.map(u =>
    '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:14px 0;border-bottom:1px solid #f0fdf4;">'+
    '<div>'+
    '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:16px;">'+(u.user_name||'-')+'</div>'+
    '<div class="booking-meta" style="margin-top:4px;">'+(u.user_email||'-')+' &nbsp;|&nbsp; '+(u.user_phone||'-')+'</div>'+
    '</div>'+
    '<span class="badge status-'+((u.status||'active').toLowerCase())+'">'+(u.status||'active')+'</span>'+
    '</div>'
  ).join('');
}

// ===== ADMIN: RENDER BOOKINGS =====
async function renderAdminBookings() {
  const listEl = document.getElementById('admin-bookings-list');
  if (!listEl) return;
  listEl.innerHTML = '<div style="color:#6b7280;font-size:0.9rem;padding:1rem">\u23F3 Loading bookings...</div>';
  let bookings = [];
  try {
    const res = await fetch(`${API_BASE}/bookings`).then(r => r.json());
    bookings = (res.isOk && Array.isArray(res.data)) ? res.data : allData.filter(r => r.type==='booking');
  } catch(e) {
    bookings = allData.filter(r => r.type==='booking');
  }
  if (!bookings.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:56px 16px;color:#9ca3af"><div style="font-size:3rem;margin-bottom:14px">\uD83D\uDCED</div><p style="font-size:15px">No bookings yet.</p></div>';
    return;
  }
  listEl.innerHTML = bookings.map(b => {
    const bid = b.id || '';
    return '<div class="booking-card">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">'+
      '<div>'+
      '<div style="font-family:\'Syne\',sans-serif;font-weight:700;">'+(b.user_name||'-')+' <span style="font-weight:400;font-size:13px;color:#6b7280;">('+(b.user_email||'-')+')</span></div>'+
      '<div class="booking-meta" style="margin-top:4px;">\uD83D\uDE9C '+(b.machine_name||'-')+' &nbsp;|&nbsp; \uD83C\uDF3E '+(b.crop_type||'-')+' &nbsp;|&nbsp; \uD83D\uDCD0 '+(b.acres||'-')+' acres &nbsp;|&nbsp; \uD83D\uDCB0 \u20B9'+((Number(b.total_cost)||0).toLocaleString('en-IN'))+'</div>'+
      '</div>'+
      '<div style="display:flex;align-items:center;gap:8px;">'+
      '<span class="badge status-'+((b.status||'pending').toLowerCase())+'">'+(b.status||'Pending')+'</span>'+
      '<select onchange="updateBookingStatus('+bid+',this.value)" class="form-input" style="padding:4px 8px;font-size:12px;width:auto;border-radius:6px;">'+
      '<option '+(b.status==='Pending'   ?'selected':'')+'>Pending</option>'+
      '<option '+(b.status==='Confirmed' ?'selected':'')+'>Confirmed</option>'+
      '<option '+(b.status==='Cancelled' ?'selected':'')+'>Cancelled</option>'+
      '</select>'+
      '</div>'+
      '</div>'+
      '<div style="font-size:12px;color:#9ca3af;margin-top:6px;">'+(b.created_at ? new Date(b.created_at).toLocaleString('en-IN') : '')+'</div>'+
      '</div>';
  }).join('');
}

async function updateBookingStatus(bookingId, newStatus) {
  if (!bookingId) return;
  const record  = allData.find(r => r.id == bookingId && r.type === 'booking');
  const updated = record ? { ...record, status: newStatus } : { id: bookingId, type: 'booking', status: newStatus };
  const res = await window.dataSdk.update(updated);
  if (res.isOk) { showToast('Status updated to ' + newStatus,'success'); await renderAdminBookings(); }
  else { showToast('Status update failed','error'); }
}

// ===== ADMIN TAB SWITCHER =====
function switchAdminTab(tab) {
  ['machine','users','bookings','tracker'].forEach(t => {
    const p = document.getElementById('adm-'+t);
    const b = document.getElementById('adm-tab-'+t);
    if (p) p.style.display = (t===tab) ? '' : 'none';
    if (b) b.classList.toggle('active', t===tab);
  });
  if (tab==='machine')  renderAdminMachine();
  if (tab==='users')    renderAdminUsers();
  if (tab==='bookings') renderAdminBookings();
  if (tab==='tracker')  setTimeout(initFleetMap, 200);
}

// ===== USER PROFILE =====
function showUserProfile() {
  if (!currentUser) return;
  let modal = document.getElementById('profile-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'profile-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(modal);
  }
  modal.innerHTML =
    '<div style="background:#fff;border-radius:16px;padding:1.75rem;width:90%;max-width:460px;box-shadow:0 20px 60px rgba(0,0,0,0.25);">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;">'+
    '<h3 style="margin:0;font-size:1.1rem;">\uD83D\uDC64 My Profile</h3>'+
    '<button onclick="document.getElementById(\'profile-modal\').style.display=\'none\'" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:#6b7280;">\u2715</button>'+
    '</div>'+
    '<div id="profile-save-msg" style="display:none;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:0.6rem 1rem;margin-bottom:1rem;font-size:0.88rem;color:#16a34a;"></div>'+
    '<form id="profile-form" onsubmit="saveUserProfile(event)">'+
    '<div style="margin-bottom:1rem;">'+
    '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;color:#374151;">Full Name</label>'+
    '<input id="prof-name" class="form-input" value="'+(currentUser.user_name||'')+'">'+
    '</div>'+
    '<div style="margin-bottom:1rem;">'+
    '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;color:#374151;">Email</label>'+
    '<input id="prof-email" class="form-input" value="'+(currentUser.user_email||'')+'" readonly style="background:#f9fafb;cursor:not-allowed;">'+
    '</div>'+
    '<div style="margin-bottom:1rem;">'+
    '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;color:#374151;">Phone</label>'+
    '<input id="prof-phone" class="form-input" value="'+(currentUser.user_phone||'')+'">'+
    '</div>'+
    '<div style="margin-bottom:1rem;">'+
    '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;color:#374151;">Address / Village</label>'+
    '<input id="prof-address" class="form-input" placeholder="Your village or address" value="'+(currentUser.address||'')+'">'+
    '</div>'+
    '<div style="margin-bottom:1.25rem;">'+
    '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;color:#374151;">New Password <span style="font-weight:400;color:#9ca3af;">(leave blank to keep current)</span></label>'+
    '<input id="prof-pass" class="form-input" type="password" placeholder="New password">'+
    '</div>'+
    '<button type="submit" id="prof-save-btn" class="btn-primary" style="width:100%;">\u2705 Save Changes</button>'+
    '</form>'+
    '</div>';
  modal.style.display = 'flex';
}

async function saveUserProfile(e) {
  e.preventDefault();
  const btn = document.getElementById('prof-save-btn');
  btn.disabled = true; btn.textContent = 'Saving...';
  const name    = document.getElementById('prof-name').value.trim();
  const phone   = document.getElementById('prof-phone').value.trim();
  const address = document.getElementById('prof-address').value.trim();
  const newPass = document.getElementById('prof-pass').value;
  if (!name || !phone) { showToast('Name and phone are required','error'); btn.disabled=false; btn.textContent='\u2705 Save Changes'; return; }
  if (!isValidPhone(phone)) { showToast('Invalid phone number','error'); btn.disabled=false; btn.textContent='\u2705 Save Changes'; return; }
  if (newPass && !isStrongPassword(newPass)) { showToast('Weak password — 8+ chars, upper, lower, number, special','error'); btn.disabled=false; btn.textContent='\u2705 Save Changes'; return; }
  const updated = { ...currentUser, user_name:name, user_phone:phone, address:address };
  if (newPass) updated.user_password = newPass;
  const res = await window.dataSdk.update(updated);
  btn.disabled=false; btn.textContent='\u2705 Save Changes';
  if (res.isOk) {
    currentUser = updated;
    saveSession();
    const nameEl = document.getElementById('dash-username');
    if (nameEl) nameEl.textContent = '\uD83D\uDC64 ' + currentUser.user_name;
    const msgEl = document.getElementById('profile-save-msg');
    if (msgEl) { msgEl.textContent = '\u2705 Profile updated successfully!'; msgEl.style.display='block'; setTimeout(()=>msgEl.style.display='none',3000); }
    showToast('Profile updated!','success');
  } else {
    showToast('Update failed: '+(res.error||'Unknown error'),'error');
  }
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  await window.dataSdk.init(null);
  const restored = await restoreSession();
  if (!restored) showPage('home');
  if (typeof lucide !== 'undefined') lucide.createIcons();
  window.switchAdminTab = switchAdminTab;
});
