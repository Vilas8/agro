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
    // Safe array check
    if (!Array.isArray(data)) {
      console.warn('dataHandler: data is not array, resetting:', data);
      data = [];
    }
    allData = data;
    recordCount = data.length;
    
    // Merge API + local machine configs (prioritize API)
    machineConfigs = {};
    // API configs first (higher priority)
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
    // Local fallback configs
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
    
    // Refresh UIs
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

// Hybrid API + localStorage SDK
const API_BASE = 'http://localhost:5000/api';

window.dataSdk = {
async create(record) {
    console.log('dataSdk.create - sending to API:', record);
    
    // Validate required fields BEFORE any write (API or local)
    const requiredFields = record.type === 'booking' ? 
      ['user_name', 'user_email', 'user_phone', 'machine_name'] : 
      record.type === 'user' ? ['user_name', 'user_email', 'user_phone', 'user_password'] :
      record.type === 'machine_config' ? ['machine_name'] : [];
    
    const missing = requiredFields.filter(field => !record[field]);
    if (missing.length > 0) {
      const errMsg = `Missing required field: ${missing[0]}`;
      console.error('dataSdk.create validation failed:', errMsg, record);
      return {isOk: false, error: errMsg};
    }
    
    try {
      const apiRes = await fetch(`${API_BASE}/bookings`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(record)
      }).then(r => r.json());
      
      if (apiRes.isOk) {
        console.log('✅ API booking created:', apiRes.record_id || apiRes.booking_id);
        // Cache API record locally
        record.id = apiRes.record_id || apiRes.booking_id;
        record.__backendId = `api_${record.id}`;
        safeLocalUpdate(data => {
          data.unshift(record);
          return data;
        });
        return {isOk: true};
      } else {
        throw new Error(apiRes.error || 'API failed');
      }
    } catch (apiErr) {
      console.warn('API unavailable, fallback localStorage:', apiErr.message);
      
      // Local fallback (already validated above)
      record.__backendId = 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      safeLocalUpdate(data => {
        data.unshift(record);
        return data;
      });
      return {isOk: true, local: true};
    }
  },

  
  async init(handler) {
    dataHandler.handler = handler;
    
    // Load cached data first
    const localData = safeLocalGet();
    handler.onDataChanged(localData);
    
    return {isOk: true};
  },

  async update(record) {
    const id = record.id || record.__backendId;
    console.log('dataSdk.update:', id, record);
    
    try {
      const apiRes = await fetch(`${API_BASE}/bookings/${record.id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(record)
      }).then(r => r.json());
      
      if (apiRes.isOk) {
        safeLocalUpdate(data => {
          const index = data.findIndex(r => (r.id || r.__backendId) === id);
          if (index > -1) data[index] = record;
          return data;
        });
        return {isOk: true};
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
      return {isOk: true, local: true};
    }
  },

  async delete(record) {
    const id = record.id || record.__backendId;
    console.log('dataSdk.delete:', id);
    
    try {
      const apiRes = await fetch(`${API_BASE}/bookings/${record.id}`, {
        method: 'DELETE'
      }).then(r => r.json());
      
      if (apiRes.isOk) {
        safeLocalUpdate(data => data.filter(r => (r.id || r.__backendId) !== id));
        return {isOk: true};
      } else {
        throw new Error(apiRes.error);
      }
    } catch (apiErr) {
      console.warn('API delete failed, local fallback');
      safeLocalUpdate(data => data.filter(r => (r.id || r.__backendId) !== id));
      return {isOk: true, local: true};
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
};


// ===== UTILITY FUNCTIONS =====
function showToast(msg, type='success') {
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
      // Page refresh
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
  
  // Early feedback
  const btn = document.getElementById('reg-btn');
  const errEl = document.getElementById('reg-error');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Creating Account...';

  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim().toLowerCase();
  const phone = document.getElementById('reg-phone').value.trim();
  const pass = document.getElementById('reg-pass').value;

  // Early record limit check
  if (recordCount >= MAX_RECORDS) {
    btn.disabled = false;
    btn.textContent = 'Create Account';
    errEl.textContent = 'System limit reached. Please contact admin.';
    errEl.style.display = 'block';
    return;
  }

  if (!name || !email || !phone || !pass) {
    btn.disabled = false;
    btn.textContent = 'Create Account';
    errEl.textContent = 'Please fill all fields.';
    errEl.style.display = 'block';
    return;
  }
  if (!isValidEmail(email)) {
    btn.disabled = false;
    btn.textContent = 'Create Account';
    errEl.textContent = 'Please enter a valid email address.';
    errEl.style.display = 'block';
    return;
  }
  if (!isValidPhone(phone)) {
    btn.disabled = false;
    btn.textContent = 'Create Account';
    errEl.textContent = 'Please enter a valid phone number (10 digits).';
    errEl.style.display = 'block';
    return;
  }
  if (!isStrongPassword(pass)) {
    btn.disabled = false;
    btn.textContent = 'Create Account';
    errEl.textContent = 'Password must be at least 8 chars with uppercase, lowercase, number & special char.';
    errEl.style.display = 'block';
    return;
  }
  
  // Fast email exists check (only users)
  const usersOnly = allData.filter(r => r.type === 'user');
  const exists = usersOnly.find(r => r.user_email === email);
  if (exists) {
    btn.disabled = false;
    btn.textContent = 'Create Account';
    errEl.textContent = 'An account with this email already exists.';
    errEl.style.display = 'block';
    return;
  }

  // Create account (only real work after early checks)
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

  const config = machineConfigs[machineType] || machineConfigs['Grass Cutter'] || { rate_per_acre: 800, cost_per_km: 15, driver_cost: 600, availability: 'Available' };
  const machine_cost = acres * config.rate_per_acre;
  const travel_cost = dist * config.cost_per_km;
  const driver_cost = config.driver_cost;
  const total_cost = machine_cost + travel_cost + driver_cost;
  const estHours = Math.ceil(acres * 1.5);

  // GRASS CUTTER AVAILABILITY CHECK
  const isGrassCutter = machineType === 'Grass Cutter';
  const isUnavailable = isGrassCutter && config.availability !== 'Available';
  
  // Update machine icon
  const icons = {
    'Grass Cutter': '🌿',
    'Harvester': '🌾', 
    'Flip plow': '🔄',
    'Corn Planter': '🌽',
    'other': '🚜'
  };
  const iconEl = document.getElementById('res-machine-icon');
  if (iconEl) iconEl.textContent = icons[machineType] || '🚜';

  // Update basic UI
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

  // AVAILABILITY UI LOGIC
  const statusEl = document.getElementById('res-machine-status');
  const statusTextEl = document.getElementById('res-status-text');
  const warningEl = document.getElementById('res-unavailable-warning');
  const bookBtn = document.getElementById('book-btn');
  
  if (isUnavailable) {
    // HIDE BOOK BUTTON
    bookBtn.style.display = 'none';
    
    // SHOW WARNING
    if (warningEl) warningEl.style.display = 'block';
    
    // SHOW STATUS BADGE
    if (statusEl && statusTextEl) {
      statusEl.style.display = 'block';
      statusTextEl.textContent = config.availability;
      statusTextEl.className = 'badge machine-status-' + config.availability.toLowerCase().replace(' ', '-');
    }
    
    // POPUP TOAST
    showToast(`Grass Cutter is currently ${config.availability.toLowerCase()}. Cannot book at this time.`, 'error');
  } else {
    // SHOW BOOK BUTTON
    bookBtn.style.display = 'block';
    
    // HIDE WARNING
    if (warningEl) warningEl.style.display = 'none';
    
    // SHOW AVAILABLE STATUS (optional)
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
    machine_cost: machine_cost,
    travel_cost: travel_cost,
    driver_cost: driver_cost,
    total_cost: total_cost,
    estimated_hours: estHours
  };
}

async function confirmBooking() {
  console.log('confirmBooking called', {currentUser, pendingBookingData, recordCount});
  
  if (!currentUser || !currentUser.user_name) {
    console.error('No currentUser or missing user_name:', currentUser);
    return showToast('Please login first or contact admin.', 'error');
  }
  
  if (!pendingBookingData) {
    console.error('No pendingBookingData - calculate cost first');
    return showToast('Please calculate cost first.', 'error');
  }
  
  if (recordCount >= MAX_RECORDS) {
    console.warn('Record limit reached');
    return showToast('Daily booking limit reached. Try tomorrow.', 'error');
  }

  // TEMP DEBUG: Bypass availability check for testing (remove later)
  // const machineType = pendingBookingData.machine_name;
  // const config = machineConfigs[machineType];
  // const isGrassCutter = machineType === 'Grass Cutter';
  // if (isGrassCutter && config && config.availability !== 'Available') {
  //   console.warn('Machine unavailable:', config.availability);
  //   showToast(`Cannot book: ${machineType} is ${config.availability.toLowerCase()}.`, 'error');
  //   return;
  // }

  const btn = document.getElementById('book-btn') || {disabled:false, innerHTML:'', textContent:''};
  const errEl = document.getElementById('book-error');
  if (errEl) errEl.style.display = 'none';
  
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Confirming...';

  try {
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
      
      // Hide results, reset form
      const resultCard = document.getElementById('result-card');
      if (resultCard) resultCard.style.display = 'none';
      
      const searchForm = document.getElementById('search-form');
      if (searchForm) searchForm.reset();
      
      // Force switch + refresh bookings
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
  
  container.innerHTML = '<div style="text-align:center;padding:20px;"><span class="spinner"></span> Loading bookings...</div>';
  
  try {
    // Try API first
    const apiRes = await fetch(`${API_BASE}/bookings/${currentUser.user_email}`).then(r => r.json());
    let bookings = apiRes.isOk ? apiRes.data : [];
    
    // Merge with local
    const localData = JSON.parse(localStorage.getItem('agrobook_data') || '[]');
    const localBookings = localData.filter(r => r.type === 'booking' && r.user_email === currentUser.user_email);
    bookings = [...bookings, ...localBookings].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    if (bookings.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af;"><div style="font-size:40px;margin-bottom:12px;">📭</div><p>No bookings yet. Search and book above!</p></div>';
    } else {
      container.innerHTML = '';
      bookings.forEach(bk => container.appendChild(createBookingRow(bk, false)));
    }
  } catch (err) {
    console.warn('API load failed:', err);
    // Fallback to local cache
    const bookings = allData.filter(r => r.type === 'booking' && r.user_email === currentUser.user_email);
    // ... render logic same as before
    if (bookings.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af;"><div style="font-size:40px;margin-bottom:12px;">📭</div><p>No bookings yet. Search and book a Grass Cutter above!</p></div>';
    } else {
      const sorted = [...bookings].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      container.innerHTML = '';
      sorted.forEach(bk => container.appendChild(createBookingRow(bk, false)));
    }
  }
}

function createBookingRow(bk, isAdminView = false) {
  const el = document.createElement('div');
  el.dataset.bid = bk.__backendId;
  el.className = 'booking-row';
  el.style.cssText = 'border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:12px;background:#fafafa;';
  updateBookingRow(el, bk, isAdminView);
  return el;
}

function updateBookingRow(el, bk, isAdminView = false) {
  const date = new Date(bk.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = new Date(bk.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const statusClass = bk.status === 'Pending' ? 'status-pending' : bk.status === 'Confirmed' ? 'status-confirmed' : 'status-cancelled';
  const adminExtra = isAdminView ? `<div style="font-size:13px;color:#6b7280;margin-bottom:6px;">👤 ${bk.user_name} | ${bk.user_email} | 📞 ${bk.user_phone}</div>` : '';
  const adminActions = isAdminView ? `
    <div class="flex gap-2 flex-wrap mt-3">
      <button class="btn-sm" onclick="updateBookingStatus('${bk.__backendId}','Confirmed')">✅ Confirm</button>
      <button class="btn-sm" style="background:#f59e0b;" onclick="updateBookingStatus('${bk.__backendId}','Cancelled')">❌ Cancel</button>
    </div>
  ` : '';
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
      <div>
        <span style="font-family:'Syne',sans-serif;font-weight:700;font-size:15px;">🚜 ${bk.machine_name}</span>
        <span style="font-size:12px;color:#9ca3af;margin-left:8px;">${date} | ${time}</span>
      </div>
      <span style="font-size:12px;font-weight:600;padding:4px 12px;border-radius:99px;" class="${statusClass}">${bk.status}</span>
    </div>
    ${adminExtra}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-top:10px;">
      <div style="font-size:13px;"><span style="color:#9ca3af;">Crop:</span> <strong>${bk.crop_type}</strong></div>
      <div style="font-size:13px;"><span style="color:#9ca3af;">Acres:</span> <strong>${bk.acres}</strong></div>
      <div style="font-size:13px;"><span style="color:#9ca3af;">Time:</span> <strong>${bk.estimated_hours}h</strong></div>
      <div style="font-size:13px;"><span style="color:#9ca3af;">Total:</span> <strong style="color:var(--green-mid);">₹${Number(bk.total_cost).toLocaleString('en-IN')}</strong></div>
    </div>
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
      <span style="font-size:12px;color:#6b7280;">Machine: ₹${Number(bk.machine_cost).toLocaleString('en-IN')}</span><span style="font-size:12px;color:#9ca3af;">|</span>
      <span style="font-size:12px;color:#6b7280;">Travel: ₹${Number(bk.travel_cost).toLocaleString('en-IN')}</span><span style="font-size:12px;color:#9ca3af;">|</span>
      <span style="font-size:12px;color:#6b7280;">Driver: ₹${Number(bk.driver_cost).toLocaleString('en-IN')}</span>
    </div>
    ${adminActions}
  `;
}

// ===== ADMIN FUNCTIONS =====
async function saveMachineConfig(e) {
  e.preventDefault();
  const machineName = document.getElementById('admin-machine-selector').value || currentAdminMachine || 'Grass Cutter';
  const rate = parseFloat(document.getElementById('cfg-rate').value) || 0;
  const cpkm = parseFloat(document.getElementById('cfg-cpkm').value) || 0;
  const petrolKm = parseFloat(document.getElementById('cfg-petrol-km').value) || 0;
  const driver = parseFloat(document.getElementById('cfg-driver').value) || 0;
  const avail = document.getElementById('cfg-avail').value || 'Available';
  const errEl = document.getElementById('machine-save-error');
  errEl.style.display = 'none';

  if (rate <= 0 || cpkm < 0 || petrolKm < 0 || driver < 0) {
    errEl.textContent = 'All costs must be positive numbers.';
    errEl.style.display = 'block';
    return;
  }

  const payload = {
    type: 'machine_config',
    machine_name: machineName,
    rate_per_acre: rate,
    cost_per_km: cpkm,
    petrol_cost_per_km: petrolKm,
    driver_cost: driver,
    availability: avail,
    updated_at: new Date().toISOString()
  };

  const btn = document.getElementById('machine-save-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving...';

  // Find existing record or create new
  const existing = allData.find(r => r.type === 'machine_config' && r.machine_name === machineName);
  let res;
  if (existing) {
    res = await window.dataSdk.update({ ...existing, ...payload });
  } else {
    if (recordCount >= MAX_RECORDS) {
      btn.disabled = false;
      btn.innerHTML = 'Save Configuration';
      errEl.textContent = 'Max records reached.';
      errEl.style.display = 'block';
      return;
    }
    res = await window.dataSdk.create(payload);
  }

  btn.disabled = false;
  btn.innerHTML = '✅ Saved!';
  setTimeout(() => { btn.innerHTML = 'Save Configuration'; }, 1500);
  
  if (res.isOk) {
    showToast(`${machineName} configuration saved successfully!`, 'success');
    currentAdminMachine = machineName;
    renderAdminMachine();
    document.getElementById('machine-form').reset();
  } else {
    errEl.textContent = 'Save failed. Try refreshing.';
    errEl.style.display = 'block';
  }
}

function renderAdminMachine() {
  // Add selector listener once
  const selector = document.getElementById('admin-machine-selector');
  if (selector && !selector.dataset.listenerAdded) {
    selector.addEventListener('change', function() {
      currentAdminMachine = this.value;
      renderAdminMachine();
    });
    selector.dataset.listenerAdded = 'true';
  }

  const config = machineConfigs[currentAdminMachine] || { rate_per_acre: 800, cost_per_km: 15, petrol_cost_per_km: 25, driver_cost: 600, availability: 'Available' };
  const icons = {
    'Grass Cutter': '🌿',
    'Harvester': '🌾',
    'Flip plow': '🔄',
    'Corn Planter': '🌽'
  };
  document.getElementById('admin-machine-icon').textContent = icons[currentAdminMachine] || '🚜';

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };
  setVal('cfg-rate', config.rate_per_acre);
  setVal('cfg-cpkm', config.cost_per_km);
  setVal('cfg-petrol-km', config.petrol_cost_per_km);
  setVal('cfg-driver', config.driver_cost);
  const av = document.getElementById('cfg-avail');
  if (av) av.value = config.availability;

  const dispRate = document.getElementById('disp-rate');
  if (dispRate) dispRate.textContent = '₹' + config.rate_per_acre;
  const dispCpkm = document.getElementById('disp-cpkm');
  if (dispCpkm) dispCpkm.textContent = '₹' + config.cost_per_km;
  const dispPetrolKm = document.getElementById('disp-petrol-km');
  if (dispPetrolKm) dispPetrolKm.textContent = '₹' + config.petrol_cost_per_km;
  const dispDriver = document.getElementById('disp-driver');
  if (dispDriver) dispDriver.textContent = '₹' + config.driver_cost;

  const badge = document.getElementById('machine-avail-badge');
  if (badge) {
    badge.textContent = config.availability;
    badge.className = 'badge';
    if (config.availability === 'Busy') {
      badge.style.cssText = 'background:#fef9c3;color:#854d0e;border-color:#fde68a;';
    } else if (config.availability === 'Maintenance') {
      badge.style.cssText = 'background:#fee2e2;color:#991b1b;border-color:#fca5a5;';
    } else {
      badge.style.cssText = '';
    }
  }

  // REFRESH USER DASHBOARD if open and result-card visible
  if (currentPage === 'user-dashboard') {
    const resultCard = document.getElementById('result-card');
    if (resultCard && resultCard.style.display !== 'none' && pendingBookingData) {
      calculateCost({preventDefault: () => {}});
    }
  }
}

function renderAdminUsers() {
  const users = allData.filter(r => r.type === 'user');
  const container = document.getElementById('admin-users-list');
  if (!container) return;
  if (users.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af;"><div style="font-size:40px;margin-bottom:12px;">👤</div><p>No users registered yet.</p></div>';
    return;
  }
  container.innerHTML = '';
  users.forEach(u => container.appendChild(createUserRow(u)));
}

function createUserRow(u) {
  const el = document.createElement('div');
  el.dataset.uid = u.__backendId;
  el.style.cssText = 'border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin-bottom:10px;background:#fafafa;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;';
  updateUserRow(el, u);
  return el;
}

function updateUserRow(el, u) {
  el.innerHTML = `
    <div>
      <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:15px;">👤 ${u.user_name}</div>
      <div style="font-size:13px;color:#6b7280;margin-top:2px;">${u.user_email} | 📞 ${u.user_phone}</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      <div id="del-confirm-${u.__backendId}" style="display:none;align-items:center;gap:6px;">
        <span style="font-size:13px;color:#dc2626;font-weight:600;">Delete?</span>
        <button class="btn-sm" style="background:#dc2626;padding:5px 12px;" onclick="deleteUser('${u.__backendId}')">Yes</button>
        <button class="btn-sm" style="background:#6b7280;padding:5px 12px;" onclick="cancelDel('${u.__backendId}')">No</button>
      </div>
      <button class="btn-danger" onclick="askDel('${u.__backendId}')">Delete</button>
    </div>
  `;
}

async function deleteUser(backendId) {
  const user = allData.find(r => r.__backendId === backendId);
  if (!user || !window.dataSdk) return;
  const res = await window.dataSdk.delete(user);
  if (res.isOk) showToast('User deleted.', 'success');
  else showToast('Delete failed.', 'error');
}

function askDel(id) {
  document.getElementById('del-confirm-' + id).style.display = 'flex';
}
function cancelDel(id) {
  const el = document.getElementById('del-confirm-' + id);
  if (el) el.style.display = 'none';
}

function renderAdminBookings() {
  const bookings = allData.filter(r => r.type === 'booking');
  const container = document.getElementById('admin-bookings-list');
  if (!container) return;
  if (bookings.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af;"><div style="font-size:40px;margin-bottom:12px;">📭</div><p>No bookings yet.</p></div>';
    return;
  }
  const sorted = [...bookings].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  container.innerHTML = '';
  sorted.forEach(bk => container.appendChild(createBookingRow(bk, true)));
}

async function updateBookingStatus(backendId, newStatus) {
  const booking = allData.find(r => r.__backendId === backendId);
  if (!booking || !window.dataSdk) return;
  const res = await window.dataSdk.update({ ...booking, status: newStatus });
  if (res.isOk) showToast('Booking ' + newStatus + '!', 'success');
  else showToast('Update failed.', 'error');
}

function switchAdminTab(tab) {
  ['machine', 'users', 'bookings'].forEach(t => {
    const el = document.getElementById('adm-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
    const btn = document.getElementById('adm-tab-' + t);
    if (btn) btn.classList.toggle('active', t === tab);
  });
}

// ===== LOCATIONS - Simplified for user dashboard (static defaults post-removal) =====
function updateDistrictOptions() {
  const select = document.getElementById('select-district');
  if (!select) return;
  select.innerHTML = '<option value="Kolar">Kolar</option>';
}

function updateVillageOptions() {
  const select = document.getElementById('select-village');
  if (!select) return;
  select.innerHTML = '<option value="">Select village</option><option value="Bangarpet">✅ Bangarpet</option><option value="Srinivaspura">✅ Srinivaspura</option><option value="Malur">✅ Malur</option><option value="Mulbagal">✅ Mulbagal</option><option value="Kolar City">✅ Kolar City</option>';
}







// ===== GLOBAL ERROR HANDLER + INIT =====
window.onerror = function(msg, url, line, col, error) {
  console.error('JS ERROR:', msg, 'at', url + ':' + line + ':' + col);
  showToast('App error: ' + msg.substring(0, 50), 'error');
  return false;
};

document.addEventListener('DOMContentLoaded', function() {
  console.log('AgroBook loaded - Full JS active');
  
  // SDK init here - after dataHandler defined
  if (window.dataSdk) {
    window.dataSdk.init(dataHandler);
    // Auto-init defaults after short delay
    setTimeout(() => {
      // Initialize default configs for all machines if missing
      const machines = ['Grass Cutter', 'Harvester', 'Flip plow', 'Corn Planter'];
      const defaults = {
        'Grass Cutter': {rate_per_acre: 800, cost_per_km: 15, petrol_cost_per_km: 25, driver_cost: 600},
        'Harvester': {rate_per_acre: 1500, cost_per_km: 25, petrol_cost_per_km: 35, driver_cost: 900},
        'Flip plow': {rate_per_acre: 600, cost_per_km: 12, petrol_cost_per_km: 20, driver_cost: 500},
        'Corn Planter': {rate_per_acre: 1200, cost_per_km: 20, petrol_cost_per_km: 30, driver_cost: 700}
      };
      machines.forEach(machine => {
        if (!machineConfigs[machine] && recordCount < MAX_RECORDS) {
          window.dataSdk.create({
            type: 'machine_config',
            machine_name: machine,
            ...defaults[machine],
            availability: 'Available',
            created_at: new Date().toISOString()
          });
        }
      });
      // initializeDefaultLocations(); // Removed: function deleted in locations cleanup
      updateDistrictOptions(); // Ensure static district options ready
      updateVillageOptions();
    }, 500);
  }
  
  // Fallback nav listeners
  document.querySelectorAll('[onclick*="safeShowPage"], [onclick*="showPage"]').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      const onclick = this.getAttribute('onclick');
      const match = onclick.match(/[\'\"`]([^\'\"`]+)[\'\"`]/);
      if (match) safeShowPage(match[1]);
    });
  });

  if (typeof lucide !== 'undefined') lucide.createIcons();
  showPage('home');
});

