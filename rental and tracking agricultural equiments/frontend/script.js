// ===== GLOBALS - DECLARED FIRST (Fix TDZ) =====
let currentPage = 'home';
let currentUser = null;
let isAdmin = false;
let allData = [];
let pendingBookingData = null;
let recordCount = 0;
let toastTimer;
let machineConfigs = {}; // {machineName: config}
let currentAdminMachine = 'Grass Cutter';
const MAX_RECORDS = 999;

// ===== SDK INIT (Polyfill Handler) =====
const dataHandler = {
  onDataChanged(data) {
    if (!Array.isArray(data)) {
      console.warn('dataHandler: data is not array, resetting:', data);
      data = [];
    }
    allData = data;
    recordCount = data.length;

    machineConfigs = {};
    data.filter(r => r.type === 'machine_config' && r.id).forEach(mc => {
      const name = mc.machine_name;
      if (name) {
        machineConfigs[name] = {
          rate_per_acre: Number(mc.rate_per_acre) || 800,
          cost_per_km: Number(mc.cost_per_km) || 15,
          petrol_cost_per_km: Number(mc.petrol_cost_per_km) || 25,
          driver_cost: Number(mc.driver_cost) || 600,
          availability: mc.availability || 'Available'
        };
      }
    });
    data.filter(r => r.type === 'machine_config' && !r.id).forEach(mc => {
      const name = mc.machine_name;
      if (name && !machineConfigs[name]) {
        machineConfigs[name] = {
          rate_per_acre: Number(mc.rate_per_acre) || 800,
          cost_per_km: Number(mc.cost_per_km) || 15,
          petrol_cost_per_km: Number(mc.petrol_cost_per_km) || 25,
          driver_cost: Number(mc.driver_cost) || 600,
          availability: mc.availability || 'Available'
        };
      }
    });

    if (currentPage === 'user-dashboard') {
      renderUserBookings();
      updateDistrictOptions();
      updateVillageOptions();
    }
    if (currentPage === 'admin-dashboard') {
      renderAdminMachine();
      renderAdminUsers();
      renderAdminBookings();
    }
  }
};

// ===== API COLLECTION HELPER =====
// FIX: Maps frontend record types to correct backend API collection endpoints
function getApiCollection(type) {
  const map = {
    user: 'users',
    users: 'users',
    machine_config: 'machine_configs',
    machine_configs: 'machine_configs',
    booking: 'bookings',
    bookings: 'bookings'
  };
  return map[(type || '').toLowerCase()] || 'bookings';
}

// Hybrid API + localStorage SDK
const API_BASE = 'http://localhost:5000/api';
window.dataSdk = {
  async create(record) {
    console.log('dataSdk.create - sending to API:', record);

    const requiredFields = record.type === 'booking'
      ? ['user_name', 'user_email', 'user_phone', 'machine_name']
      : record.type === 'user'
        ? ['user_name', 'user_email', 'user_phone', 'user_password']
        : record.type === 'machine_config'
          ? ['machine_name']
          : [];

    const missing = requiredFields.filter(field => !record[field]);
    if (missing.length > 0) {
      const errMsg = `Missing required field: ${missing[0]}`;
      console.error('dataSdk.create validation failed:', errMsg, record);
      return { isOk: false, error: errMsg };
    }

    try {
      // FIX: use correct endpoint based on record type
      const endpoint = `${API_BASE}/${getApiCollection(record.type)}`;
      const apiRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      }).then(r => r.json());

      if (apiRes.isOk) {
        console.log('✅ API record created:', apiRes.record_id);
        record.id = apiRes.record_id;
        record.__backendId = `api_${record.id}`;
        safeLocalUpdate(data => { data.unshift(record); return data; });
        return { isOk: true };
      } else {
        throw new Error(apiRes.error || 'API failed');
      }
    } catch (apiErr) {
      console.warn('API unavailable, fallback localStorage:', apiErr.message);
      record.__backendId = 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      safeLocalUpdate(data => { data.unshift(record); return data; });
      return { isOk: true, local: true };
    }
  },

  async init(handler) {
    dataHandler.handler = handler;
    const localData = safeLocalGet();
    handler.onDataChanged(localData);
    return { isOk: true };
  },

  async update(record) {
    const id = record.id || record.__backendId;
    console.log('dataSdk.update:', id, record);
    try {
      // FIX: use correct endpoint based on record type
      const endpoint = `${API_BASE}/${getApiCollection(record.type)}/${record.id}`;
      const apiRes = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      }).then(r => r.json());

      if (apiRes.isOk) {
        safeLocalUpdate(data => {
          const index = data.findIndex(r => (r.id || r.__backendId) === id);
          if (index > -1) data[index] = record;
          return data;
        });
        return { isOk: true };
      } else {
        throw new Error(apiRes.error);
      }
    } catch (apiErr) {
      console.warn('API update failed, local fallback:', apiErr.message);
      safeLocalUpdate(data => {
        const index = data.findIndex(r => (r.id || r.__backendId) === id);
        if (index > -1) data[index] = record;
        return data;
      });
      return { isOk: true, local: true };
    }
  },

  async delete(record) {
    const id = record.id || record.__backendId;
    console.log('dataSdk.delete:', id);
    try {
      // FIX: use correct endpoint based on record type
      const endpoint = `${API_BASE}/${getApiCollection(record.type)}/${record.id}`;
      const apiRes = await fetch(endpoint, { method: 'DELETE' }).then(r => r.json());

      if (apiRes.isOk) {
        safeLocalUpdate(data => data.filter(r => (r.id || r.__backendId) !== id));
        return { isOk: true };
      } else {
        throw new Error(apiRes.error);
      }
    } catch (apiErr) {
      console.warn('API delete failed, local fallback');
      safeLocalUpdate(data => data.filter(r => (r.id || r.__backendId) !== id));
      return { isOk: true, local: true };
    }
  }
};

// Safe localStorage helpers
function safeLocalGet() {
  try {
    const data = JSON.parse(localStorage.getItem('agrobook_data') || '[]');
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('localStorage corrupt, reset:', e);
    localStorage.removeItem('agrobook_data');
    return [];
  }
}

function safeLocalUpdate(fn) {
  const data = safeLocalGet();
  const newData = fn(data);
  localStorage.setItem('agrobook_data', JSON.stringify(newData));
  dataHandler.onDataChanged(newData);
}

// ===== UTILITY FUNCTIONS =====
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast ' + (type || 'success') + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); }, 3500);
}

function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function isValidPhone(phone) {
  const re = /^[0-9]{10}$/;
  return re.test(phone.replace(/\D/g, ''));
}

function isStrongPassword(pass) {
  const re = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return re.test(pass);
}

let passDebounceTimer = null;
function checkPasswordStrength(pass, elemId) {
  const elem = document.getElementById(elemId);
  if (!elem) return;
  clearTimeout(passDebounceTimer);
  passDebounceTimer = setTimeout(() => {
    if (!pass) { elem.textContent = ''; elem.style.color = '#6b7280'; return; }
    if (isStrongPassword(pass)) {
      elem.textContent = '✅ Strong password';
      elem.style.color = '#16a34a';
    } else {
      elem.textContent = '❌ Weak password (need 8+ chars, uppercase, lowercase, number, special char)';
      elem.style.color = '#dc2626';
    }
  }, 250);
}

function togglePassVis(inputId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(inputId + '-icon');
  if (!input) return;
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  if (icon) icon.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ===== ROUTING =====
function safeShowPage(name) {
  event.preventDefault();
  event.stopPropagation();
  return showPage(name);
}

function showPage(name) {
  try {
    document.querySelectorAll('.page').forEach(p => {
      p.classList.remove('active', 'fade-in');
      p.style.display = 'none';
    });
    const el = document.getElementById('page-' + name);
    if (el) {
      el.style.display = 'block';
      el.classList.add('active');
      el.classList.remove('fade-in');
      void el.offsetWidth;
      el.classList.add('fade-in');
      currentPage = name;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      const navBtn = document.getElementById('nav-' + name);
      if (navBtn) navBtn.classList.add('active');
      if (name === 'user-dashboard') {
        renderUserBookings();
        updateDistrictOptions();
        updateVillageOptions();
      }
      if (name === 'admin-dashboard') {
        renderAdminMachine();
        renderAdminUsers();
        renderAdminBookings();
      }
      return true;
    } else {
      throw new Error(`Page "page-${name}" not found`);
    }
  } catch (error) {
    console.error('Navigation error:', error);
    showToast('Navigation error: ' + error.message, 'error');
    return false;
  }
}

function requireLogin() {
  if (!currentUser) {
    showPage('user-login');
    showToast('Please login first.', 'error');
  } else {
    switchUserTab('bookings');
    showPage('user-dashboard');
  }
}

// ===== AUTH =====
async function handleRegister(e) {
  e.preventDefault();
  const btn = document.getElementById('reg-btn');
  const errEl = document.getElementById('reg-error');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.innerHTML = ' Creating Account...';

  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim().toLowerCase();
  const phone = document.getElementById('reg-phone').value.trim();
  const pass = document.getElementById('reg-pass').value;

  if (recordCount >= MAX_RECORDS) {
    btn.disabled = false; btn.textContent = 'Create Account';
    errEl.textContent = 'System limit reached. Please contact admin.';
    errEl.style.display = 'block'; return;
  }
  if (!name || !email || !phone || !pass) {
    btn.disabled = false; btn.textContent = 'Create Account';
    errEl.textContent = 'Please fill all fields.';
    errEl.style.display = 'block'; return;
  }
  if (!isValidEmail(email)) {
    btn.disabled = false; btn.textContent = 'Create Account';
    errEl.textContent = 'Please enter a valid email address.';
    errEl.style.display = 'block'; return;
  }
  if (!isValidPhone(phone)) {
    btn.disabled = false; btn.textContent = 'Create Account';
    errEl.textContent = 'Please enter a valid phone number (10 digits).';
    errEl.style.display = 'block'; return;
  }
  if (!isStrongPassword(pass)) {
    btn.disabled = false; btn.textContent = 'Create Account';
    errEl.textContent = 'Password must be at least 8 chars with uppercase, lowercase, number & special char.';
    errEl.style.display = 'block'; return;
  }

  const usersOnly = allData.filter(r => r.type === 'user');
  const exists = usersOnly.find(r => r.user_email === email);
  if (exists) {
    btn.disabled = false; btn.textContent = 'Create Account';
    errEl.textContent = 'An account with this email already exists.';
    errEl.style.display = 'block'; return;
  }

  const res = await window.dataSdk.create({
    type: 'user',
    user_name: name,
    user_email: email,
    user_phone: phone,
    user_password: pass,
    created_at: new Date().toISOString(),
    status: 'active'
  });
  btn.disabled = false;
  btn.textContent = 'Create Account';
  if (res.isOk) {
    showToast('Account created successfully! Please login.', 'success');
    document.getElementById('register-form').reset();
    showPage('user-login');
  } else {
    errEl.textContent = 'Registration failed. Please try again.';
    errEl.style.display = 'block';
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const pass = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  const user = allData.find(r => r.type === 'user' && r.user_email === email && r.user_password === pass);
  if (!user) {
    errEl.textContent = 'Invalid email or password.';
    errEl.style.display = 'block';
    return;
  }
  currentUser = user;
  document.getElementById('dash-username').textContent = '👤 ' + user.user_name;
  document.getElementById('login-form').reset();
  showToast('Welcome back, ' + user.user_name + '!', 'success');
  showPage('user-dashboard');
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const email = document.getElementById('admin-email').value.trim().toLowerCase();
  const pass = document.getElementById('admin-pass').value;
  const errEl = document.getElementById('admin-login-error');
  errEl.style.display = 'none';
  if (email.toLowerCase() === 'admin@gmail.com' && pass.trim()) {
    isAdmin = true;
    document.getElementById('admin-login-form').reset();
    showToast('Welcome, Admin!', 'success');
    showPage('admin-dashboard');
  } else {
    errEl.textContent = 'Please enter admin@gmail.com and password.';
    errEl.style.display = 'block';
  }
}

function logout() {
  currentUser = null;
  isAdmin = false;
  showToast('Logged out successfully.', 'success');
  showPage('home');
}

// ===== COST CALCULATOR =====
function calculateCost(e) {
  e.preventDefault();
  const machineType = document.getElementById('machine-type').value;
  const crop = document.getElementById('crop-type').value;
  const acres = parseFloat(document.getElementById('num-acres').value);
  const dist = parseFloat(document.getElementById('distance-km').value);
  const errEl = document.getElementById('search-error');
  errEl.style.display = 'none';

  if (!machineType || !crop || !acres || acres <= 0 || !dist || dist <= 0) {
    errEl.textContent = 'Please fill all fields with valid values.';
    errEl.style.display = 'block';
    return;
  }

  const config = machineConfigs[machineType] || machineConfigs['Grass Cutter'] || {
    rate_per_acre: 800, cost_per_km: 15, driver_cost: 600, availability: 'Available'
  };
  const machine_cost = acres * config.rate_per_acre;
  const travel_cost = dist * config.cost_per_km;
  const driver_cost = config.driver_cost;
  const total_cost = machine_cost + travel_cost + driver_cost;
  const estHours = Math.ceil(acres * 1.5);

  const isGrassCutter = machineType === 'Grass Cutter';
  const isUnavailable = isGrassCutter && config.availability !== 'Available';

  const icons = { 'Grass Cutter': '🌿', 'Harvester': '🌾', 'Flip plow': '🔄', 'Corn Planter': '🌽', 'other': '🚜' };
  const iconEl = document.getElementById('res-machine-icon');
  if (iconEl) iconEl.textContent = icons[machineType] || '🚜';

  document.title = machineType + ' - AgroBook';
  document.getElementById('res-machine').textContent = machineType;
  document.getElementById('res-machine-title').textContent = machineType + ' Cost Breakdown';
  document.getElementById('res-crop').textContent = crop;
  document.getElementById('res-acres').textContent = acres + ' acres';
  document.getElementById('res-machine-cost').textContent = '₹' + machine_cost.toLocaleString('en-IN');
  document.getElementById('res-travel-cost').textContent = '₹' + travel_cost.toLocaleString('en-IN');
  document.getElementById('res-driver-cost').textContent = '₹' + driver_cost.toLocaleString('en-IN');
  document.getElementById('res-total').textContent = '₹' + total_cost.toLocaleString('en-IN');
  document.getElementById('res-time').textContent = estHours + ' hour' + (estHours > 1 ? 's' : '');
  document.getElementById('result-card').style.display = 'block';

  const statusEl = document.getElementById('res-machine-status');
  const statusTextEl = document.getElementById('res-status-text');
  const warningEl = document.getElementById('res-unavailable-warning');
  const bookBtn = document.getElementById('book-btn');

  if (isUnavailable) {
    bookBtn.style.display = 'none';
    if (warningEl) warningEl.style.display = 'block';
    if (statusEl && statusTextEl) {
      statusEl.style.display = 'block';
      statusTextEl.textContent = config.availability;
      statusTextEl.className = 'badge machine-status-' + config.availability.toLowerCase().replace(' ', '-');
    }
    showToast(`Grass Cutter is currently ${config.availability.toLowerCase()}. Cannot book at this time.`, 'error');
  } else {
    bookBtn.style.display = 'block';
    if (warningEl) warningEl.style.display = 'none';
    if (statusEl && statusTextEl && isGrassCutter) {
      statusEl.style.display = 'block';
      statusTextEl.textContent = 'Available';
      statusTextEl.className = 'badge machine-status-available';
    }
  }

  pendingBookingData = {
    machine_name: machineType,
    crop_type: crop,
    acres,
    distance: dist,
    machine_cost,
    travel_cost,
    driver_cost,
    total_cost,
    estimated_hours: estHours
  };
}

async function confirmBooking() {
  console.log('confirmBooking called', { currentUser, pendingBookingData, recordCount });
  if (!currentUser || !currentUser.user_name) {
    return showToast('Please login first or contact admin.', 'error');
  }
  if (!pendingBookingData) {
    return showToast('Please calculate cost first.', 'error');
  }
  if (recordCount >= MAX_RECORDS) {
    return showToast('Daily booking limit reached. Try tomorrow.', 'error');
  }

  const btn = document.getElementById('book-btn') || { disabled: false, innerHTML: '', textContent: '' };
  const errEl = document.getElementById('book-error');
  if (errEl) errEl.style.display = 'none';
  btn.disabled = true;
  btn.innerHTML = ' Confirming...';

  try {
    // FIX: explicitly include user_phone in booking payload
    const bookingData = {
      type: 'booking',
      user_name: currentUser.user_name,
      user_email: currentUser.user_email,
      user_phone: currentUser.user_phone,
      ...pendingBookingData,
      status: 'Pending',
      created_at: new Date().toISOString()
    };

    console.log('=== BOOKING PAYLOAD TO API ===');
    console.log(JSON.stringify(bookingData, null, 2));
    console.log('================================');

    const res = await window.dataSdk.create(bookingData);
    console.log('dataSdk.create result:', res);

    btn.disabled = false;
    btn.textContent = '✅ Confirmed!';

    if (res.isOk) {
      showToast(`${pendingBookingData.machine_name} booked successfully! Check My Bookings tab. 🎉`, 'success');
      pendingBookingData = null;
      const resultCard = document.getElementById('result-card');
      if (resultCard) resultCard.style.display = 'none';
      const searchForm = document.getElementById('search-form');
      if (searchForm) searchForm.reset();
      switchUserTab('bookings');
      setTimeout(renderUserBookings, 100);
    } else {
      throw new Error('dataSdk.create failed: ' + (res.error || JSON.stringify(res)));
    }
  } catch (error) {
    console.error('confirmBooking error:', error);
    showToast('Booking failed: ' + error.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '✅ Confirm Booking';
  }
}

// ===== USER DASHBOARD =====
function switchUserTab(tab) {
  document.getElementById('udash-search').style.display = tab === 'search' ? '' : 'none';
  document.getElementById('udash-bookings').style.display = tab === 'bookings' ? '' : 'none';
  document.getElementById('udash-tab-search').classList.toggle('active', tab === 'search');
  document.getElementById('udash-tab-bookings').classList.toggle('active', tab === 'bookings');
  if (tab === 'bookings') renderUserBookings();
}

async function renderUserBookings() {
  if (!currentUser) return;
  const container = document.getElementById('user-bookings-list');
  if (!container) return;

  const userBookings = allData.filter(r => r.type === 'booking' && r.user_email === currentUser.user_email);

  if (userBookings.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div style="font-size:2.5rem;margin-bottom:0.5rem">📋</div>
        <div>No bookings yet. Search and book a machine above!</div>
      </div>`;
    return;
  }

  container.innerHTML = userBookings.map(b => `
    <div class="booking-card">
      <div class="booking-header">
        <span class="booking-machine">${b.machine_name || 'Machine'}</span>
        <span class="badge status-${(b.status || 'pending').toLowerCase()}">${b.status || 'Pending'}</span>
      </div>
      <div class="booking-details">
        <span>🌾 ${b.crop_type || '-'}</span>
        <span>📐 ${b.acres || '-'} acres</span>
        <span>📍 ${b.distance || '-'} km</span>
        <span>💰 ₹${(b.total_cost || 0).toLocaleString('en-IN')}</span>
        <span>⏱️ ${b.estimated_hours || '-'} hrs</span>
      </div>
      <div class="booking-date">${b.created_at ? new Date(b.created_at).toLocaleDateString('en-IN') : ''}</div>
    </div>`).join('');
}

function updateDistrictOptions() {}
function updateVillageOptions() {}

// ===== ADMIN DASHBOARD =====
async function renderAdminMachine() {
  const container = document.getElementById('admin-machine-container');
  if (!container) return;

  const configs = allData.filter(r => r.type === 'machine_config');
  if (configs.length === 0) {
    container.innerHTML = '<div class="empty-state">No machine configs yet.</div>';
    return;
  }
  container.innerHTML = configs.map(mc => `
    <div class="machine-card">
      <div class="machine-name">${mc.machine_name}</div>
      <div class="machine-details">
        <span>₹${mc.rate_per_acre}/acre</span>
        <span>₹${mc.cost_per_km}/km</span>
        <span>Driver: ₹${mc.driver_cost}</span>
        <span class="badge status-${(mc.availability||'available').toLowerCase()}">${mc.availability||'Available'}</span>
      </div>
    </div>`).join('');
}

async function renderAdminUsers() {
  const container = document.getElementById('admin-users-container');
  if (!container) return;

  const users = allData.filter(r => r.type === 'user');
  if (users.length === 0) {
    container.innerHTML = '<div class="empty-state">No users registered yet.</div>';
    return;
  }
  container.innerHTML = users.map(u => `
    <div class="user-card">
      <div class="user-name">${u.user_name}</div>
      <div class="user-details">
        <span>${u.user_email}</span>
        <span>${u.user_phone}</span>
        <span class="badge status-${(u.status||'active').toLowerCase()}">${u.status||'active'}</span>
      </div>
    </div>`).join('');
}

async function renderAdminBookings() {
  const container = document.getElementById('admin-bookings-container');
  if (!container) return;

  const bookings = allData.filter(r => r.type === 'booking');
  if (bookings.length === 0) {
    container.innerHTML = '<div class="empty-state">No bookings yet.</div>';
    return;
  }
  container.innerHTML = bookings.map(b => `
    <div class="booking-card">
      <div class="booking-header">
        <span>${b.user_name} (${b.user_email})</span>
        <span class="badge status-${(b.status||'pending').toLowerCase()}">${b.status||'Pending'}</span>
      </div>
      <div class="booking-details">
        <span>🚜 ${b.machine_name}</span>
        <span>🌾 ${b.crop_type||'-'}</span>
        <span>📐 ${b.acres||'-'} acres</span>
        <span>💰 ₹${(b.total_cost||0).toLocaleString('en-IN')}</span>
      </div>
    </div>`).join('');
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  await window.dataSdk.init(dataHandler);
  showPage('home');
  if (typeof lucide !== 'undefined') lucide.createIcons();
});
