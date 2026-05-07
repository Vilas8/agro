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
let fleetMap = null;          // Leaflet map instance (admin fleet view)
let fleetMarkers = {};        // { machineName: L.marker }
let userLocationMap = null;   // Leaflet map for user booking ETA
let gpsRefreshTimer = null;   // setInterval handle

// ===== DATA HANDLER =====
const dataHandler = {
  onDataChanged(data) {
    if (!Array.isArray(data)) { data = []; }
    allData = data;
    recordCount = data.length;
    machineConfigs = {};
    data.filter(r => r.type === 'machine_config' && r.id).forEach(mc => {
      const name = mc.machine_name;
      if (name) machineConfigs[name] = {
        rate_per_acre: Number(mc.rate_per_acre) || 800,
        cost_per_km: Number(mc.cost_per_km) || 15,
        petrol_cost_per_km: Number(mc.petrol_cost_per_km) || 25,
        driver_cost: Number(mc.driver_cost) || 600,
        availability: mc.availability || 'Available'
      };
    });
    data.filter(r => r.type === 'machine_config' && !r.id).forEach(mc => {
      const name = mc.machine_name;
      if (name && !machineConfigs[name]) machineConfigs[name] = {
        rate_per_acre: Number(mc.rate_per_acre) || 800,
        cost_per_km: Number(mc.cost_per_km) || 15,
        petrol_cost_per_km: Number(mc.petrol_cost_per_km) || 25,
        driver_cost: Number(mc.driver_cost) || 600,
        availability: mc.availability || 'Available'
      };
    });
    if (currentPage === 'user-dashboard') { renderUserBookings(); }
    if (currentPage === 'admin-dashboard') { renderAdminMachine(); renderAdminUsers(); renderAdminBookings(); }
  }
};

// ===== API COLLECTION HELPER =====
function getApiCollection(type) {
  const map = {
    user: 'users', users: 'users',
    machine_config: 'machine_configs', machine_configs: 'machine_configs',
    booking: 'bookings', bookings: 'bookings'
  };
  return map[(type || '').toLowerCase()] || 'bookings';
}

// ===== SDK =====
window.dataSdk = {
  async create(record) {
    const requiredFields = record.type === 'booking' ? ['user_name','user_email','user_phone','machine_name']
      : record.type === 'user' ? ['user_name','user_email','user_phone','user_password']
      : record.type === 'machine_config' ? ['machine_name'] : [];
    const missing = requiredFields.filter(f => !record[f]);
    if (missing.length) return { isOk: false, error: `Missing required field: ${missing[0]}` };
    try {
      const res = await fetch(`${API_BASE}/${getApiCollection(record.type)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record)
      }).then(r => r.json());
      if (res.isOk) {
        record.id = res.record_id; record.__backendId = `api_${record.id}`;
        safeLocalUpdate(data => { data.unshift(record); return data; });
        return { isOk: true };
      } else { throw new Error(res.error || 'API failed'); }
    } catch (e) {
      console.warn('API unavailable, local fallback:', e.message);
      record.__backendId = 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2,9);
      safeLocalUpdate(data => { data.unshift(record); return data; });
      return { isOk: true, local: true };
    }
  },
  async init(handler) {
    dataHandler.handler = handler;
    handler.onDataChanged(safeLocalGet());
    return { isOk: true };
  },
  async update(record) {
    const id = record.id || record.__backendId;
    try {
      const res = await fetch(`${API_BASE}/${getApiCollection(record.type)}/${record.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record)
      }).then(r => r.json());
      if (res.isOk) { safeLocalUpdate(data => { const i = data.findIndex(r => (r.id||r.__backendId)===id); if(i>-1)data[i]=record; return data; }); return { isOk: true }; }
      else { throw new Error(res.error); }
    } catch (e) {
      safeLocalUpdate(data => { const i = data.findIndex(r => (r.id||r.__backendId)===id); if(i>-1)data[i]=record; return data; });
      return { isOk: true, local: true };
    }
  },
  async delete(record) {
    const id = record.id || record.__backendId;
    try {
      const res = await fetch(`${API_BASE}/${getApiCollection(record.type)}/${record.id}`, { method: 'DELETE' }).then(r => r.json());
      if (res.isOk) { safeLocalUpdate(data => data.filter(r => (r.id||r.__backendId)!==id)); return { isOk: true }; }
      else { throw new Error(res.error); }
    } catch (e) {
      safeLocalUpdate(data => data.filter(r => (r.id||r.__backendId)!==id));
      return { isOk: true, local: true };
    }
  }
};

function safeLocalGet() {
  try { const d = JSON.parse(localStorage.getItem('agrobook_data')||'[]'); return Array.isArray(d)?d:[]; }
  catch(e) { localStorage.removeItem('agrobook_data'); return []; }
}
function safeLocalUpdate(fn) {
  const d = safeLocalGet(); const nd = fn(d);
  localStorage.setItem('agrobook_data', JSON.stringify(nd));
  dataHandler.onDataChanged(nd);
}

// ===== UTILS =====
function showToast(msg, type='success') {
  const t = document.getElementById('toast'); if(!t)return;
  t.textContent=msg; t.className='toast '+(type||'success')+' show';
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),3500);
}
function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function isValidPhone(p) { return /^[0-9]{10}$/.test(p.replace(/\D/g,'')); }
function isStrongPassword(p) { return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(p); }
let passDebounceTimer=null;
function checkPasswordStrength(pass,elemId){
  const elem=document.getElementById(elemId); if(!elem)return;
  clearTimeout(passDebounceTimer);
  passDebounceTimer=setTimeout(()=>{
    if(!pass){elem.textContent='';return;}
    if(isStrongPassword(pass)){elem.textContent='✅ Strong password';elem.style.color='#16a34a';}
    else{elem.textContent='❌ Weak (8+ chars, upper, lower, number, special)';elem.style.color='#dc2626';}
  },250);
}
function togglePassVis(inputId){
  const input=document.getElementById(inputId); const icon=document.getElementById(inputId+'-icon');
  if(!input)return; const ip=input.type==='password'; input.type=ip?'text':'password';
  if(icon)icon.setAttribute('data-lucide',ip?'eye-off':'eye');
  if(typeof lucide!=='undefined')lucide.createIcons();
}

// ===== ROUTING =====
function safeShowPage(name){event.preventDefault();event.stopPropagation();return showPage(name);}
function showPage(name){
  try{
    document.querySelectorAll('.page').forEach(p=>{p.classList.remove('active','fade-in');p.style.display='none';});
    const el=document.getElementById('page-'+name);
    if(el){
      el.style.display='block'; el.classList.add('active'); el.classList.remove('fade-in');
      void el.offsetWidth; el.classList.add('fade-in');
      currentPage=name;
      if(typeof lucide!=='undefined')lucide.createIcons();
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      const nb=document.getElementById('nav-'+name); if(nb)nb.classList.add('active');
      if(name==='user-dashboard'){renderUserBookings();}
      if(name==='admin-dashboard'){renderAdminMachine();renderAdminUsers();renderAdminBookings();initFleetMap();}
      return true;
    } else { throw new Error(`Page "page-${name}" not found`); }
  }catch(error){console.error('Navigation error:',error);showToast('Navigation error: '+error.message,'error');return false;}
}
function requireLogin(){
  if(!currentUser){showPage('user-login');showToast('Please login first.','error');}
  else{switchUserTab('bookings');showPage('user-dashboard');}
}

// ===== AUTH =====
async function handleRegister(e){
  e.preventDefault();
  const btn=document.getElementById('reg-btn'); const errEl=document.getElementById('reg-error');
  errEl.style.display='none'; btn.disabled=true; btn.innerHTML='Creating Account...';
  const name=document.getElementById('reg-name').value.trim();
  const email=document.getElementById('reg-email').value.trim().toLowerCase();
  const phone=document.getElementById('reg-phone').value.trim();
  const pass=document.getElementById('reg-pass').value;
  if(recordCount>=MAX_RECORDS){btn.disabled=false;btn.textContent='Create Account';errEl.textContent='System limit reached.';errEl.style.display='block';return;}
  if(!name||!email||!phone||!pass){btn.disabled=false;btn.textContent='Create Account';errEl.textContent='Please fill all fields.';errEl.style.display='block';return;}
  if(!isValidEmail(email)){btn.disabled=false;btn.textContent='Create Account';errEl.textContent='Invalid email.';errEl.style.display='block';return;}
  if(!isValidPhone(phone)){btn.disabled=false;btn.textContent='Create Account';errEl.textContent='Invalid phone (10 digits).';errEl.style.display='block';return;}
  if(!isStrongPassword(pass)){btn.disabled=false;btn.textContent='Create Account';errEl.textContent='Weak password — 8+ chars, upper, lower, number, special char.';errEl.style.display='block';return;}
  if(allData.filter(r=>r.type==='user').find(r=>r.user_email===email)){btn.disabled=false;btn.textContent='Create Account';errEl.textContent='Email already registered.';errEl.style.display='block';return;}
  const res=await window.dataSdk.create({type:'user',user_name:name,user_email:email,user_phone:phone,user_password:pass,created_at:new Date().toISOString(),status:'active'});
  btn.disabled=false; btn.textContent='Create Account';
  if(res.isOk){showToast('Account created! Please login.','success');document.getElementById('register-form').reset();showPage('user-login');}
  else{errEl.textContent='Registration failed.';errEl.style.display='block';}
}
async function handleLogin(e){
  e.preventDefault();
  const email=document.getElementById('login-email').value.trim().toLowerCase();
  const pass=document.getElementById('login-pass').value;
  const errEl=document.getElementById('login-error'); errEl.style.display='none';
  const user=allData.find(r=>r.type==='user'&&r.user_email===email&&r.user_password===pass);
  if(!user){errEl.textContent='Invalid email or password.';errEl.style.display='block';return;}
  currentUser=user;
  document.getElementById('dash-username').textContent='👤 '+user.user_name;
  document.getElementById('login-form').reset();
  showToast('Welcome back, '+user.user_name+'!','success');
  showPage('user-dashboard');
}
async function handleAdminLogin(e){
  e.preventDefault();
  const email=document.getElementById('admin-email').value.trim().toLowerCase();
  const pass=document.getElementById('admin-pass').value;
  const errEl=document.getElementById('admin-login-error'); errEl.style.display='none';
  if(email==='admin@gmail.com'&&pass.trim()){isAdmin=true;document.getElementById('admin-login-form').reset();showToast('Welcome, Admin!','success');showPage('admin-dashboard');}
  else{errEl.textContent='Please enter admin@gmail.com and password.';errEl.style.display='block';}
}
function logout(){currentUser=null;isAdmin=false;stopGpsRefresh();showToast('Logged out successfully.','success');showPage('home');}

// ===== COST CALCULATOR =====
function calculateCost(e){
  e.preventDefault();
  const machineType=document.getElementById('machine-type').value;
  const crop=document.getElementById('crop-type').value;
  const acres=parseFloat(document.getElementById('num-acres').value);
  const dist=parseFloat(document.getElementById('distance-km').value);
  const errEl=document.getElementById('search-error'); errEl.style.display='none';
  if(!machineType||!crop||!acres||acres<=0||!dist||dist<=0){errEl.textContent='Please fill all fields.';errEl.style.display='block';return;}
  const config=machineConfigs[machineType]||{rate_per_acre:800,cost_per_km:15,driver_cost:600,availability:'Available'};
  const machine_cost=acres*config.rate_per_acre;
  const travel_cost=dist*config.cost_per_km;
  const driver_cost=config.driver_cost;
  const total_cost=machine_cost+travel_cost+driver_cost;
  const estHours=Math.ceil(acres*1.5);
  const isGrassCutter=machineType==='Grass Cutter';
  const isUnavailable=isGrassCutter&&config.availability!=='Available';
  const icons={'Grass Cutter':'🌿','Harvester':'🌾','Flip plow':'🔄','Corn Planter':'🌽','other':'🚜'};
  const iconEl=document.getElementById('res-machine-icon'); if(iconEl)iconEl.textContent=icons[machineType]||'🚜';
  document.title=machineType+' - AgroBook';
  document.getElementById('res-machine').textContent=machineType;
  document.getElementById('res-machine-title').textContent=machineType+' Cost Breakdown';
  document.getElementById('res-crop').textContent=crop;
  document.getElementById('res-acres').textContent=acres+' acres';
  document.getElementById('res-machine-cost').textContent='₹'+machine_cost.toLocaleString('en-IN');
  document.getElementById('res-travel-cost').textContent='₹'+travel_cost.toLocaleString('en-IN');
  document.getElementById('res-driver-cost').textContent='₹'+driver_cost.toLocaleString('en-IN');
  document.getElementById('res-total').textContent='₹'+total_cost.toLocaleString('en-IN');
  document.getElementById('res-time').textContent=estHours+' hour'+(estHours>1?'s':'');
  document.getElementById('result-card').style.display='block';
  const statusEl=document.getElementById('res-machine-status');
  const statusTextEl=document.getElementById('res-status-text');
  const warningEl=document.getElementById('res-unavailable-warning');
  const bookBtn=document.getElementById('book-btn');
  if(isUnavailable){
    bookBtn.style.display='none'; if(warningEl)warningEl.style.display='block';
    if(statusEl&&statusTextEl){statusEl.style.display='block';statusTextEl.textContent=config.availability;statusTextEl.className='badge machine-status-'+config.availability.toLowerCase().replace(' ','-');}
    showToast(`Grass Cutter is currently ${config.availability.toLowerCase()}. Cannot book.`,'error');
  } else {
    bookBtn.style.display='block'; if(warningEl)warningEl.style.display='none';
    if(statusEl&&statusTextEl&&isGrassCutter){statusEl.style.display='block';statusTextEl.textContent='Available';statusTextEl.className='badge machine-status-available';}
  }
  pendingBookingData={machine_name:machineType,crop_type:crop,acres,distance:dist,machine_cost,travel_cost,driver_cost,total_cost,estimated_hours:estHours};
}

async function autoFillDistanceFromGPS(){
  if(!navigator.geolocation){showToast('Geolocation not supported','error');return;}
  navigator.geolocation.getCurrentPosition(async pos=>{
    const userLat=pos.coords.latitude;
    const userLng=pos.coords.longitude;
    const machineType=document.getElementById('machine-type').value;
    if(!machineType){showToast('Select a machine type first','error');return;}
    try{
      // Get latest machine location
      const locRes=await fetch(`${API_BASE}/location/${encodeURIComponent(machineType)}`).then(r=>r.json());
      if(locRes.isOk&&locRes.data.length){
        const latest=locRes.data[0];
        const distRes=await fetch(`${API_BASE}/distance?lat1=${latest.lat}&lng1=${latest.lng}&lat2=${userLat}&lng2=${userLng}`).then(r=>r.json());
        if(distRes.isOk){
          document.getElementById('distance-km').value=distRes.distance_km;
          showToast(`Distance auto-filled: ${distRes.distance_km} km from machine's live location 📍`,'success');
        }
      } else {
        // Fallback: use Kolar base location
        const distRes=await fetch(`${API_BASE}/distance?lat1=13.135&lng1=78.132&lat2=${userLat}&lng2=${userLng}`).then(r=>r.json());
        if(distRes.isOk){document.getElementById('distance-km').value=distRes.distance_km;showToast(`Distance from base: ${distRes.distance_km} km`,'success');}
      }
    } catch(e){showToast('Could not fetch GPS distance: '+e.message,'error');}
  },()=>showToast('Location access denied','error'));
}

async function confirmBooking(){
  if(!currentUser||!currentUser.user_name){return showToast('Please login first.','error');}
  if(!pendingBookingData){return showToast('Please calculate cost first.','error');}
  if(recordCount>=MAX_RECORDS){return showToast('Daily booking limit reached.','error');}
  const btn=document.getElementById('book-btn')||{disabled:false,innerHTML:'',textContent:''};
  const errEl=document.getElementById('book-error'); if(errEl)errEl.style.display='none';
  btn.disabled=true; btn.innerHTML='Confirming...';
  try{
    const bookingData={
      type:'booking',
      user_name:currentUser.user_name,
      user_email:currentUser.user_email,
      user_phone:currentUser.user_phone,
      ...pendingBookingData,
      status:'Pending',
      created_at:new Date().toISOString()
    };
    const res=await window.dataSdk.create(bookingData);
    btn.disabled=false; btn.textContent='✅ Confirmed!';
    if(res.isOk){
      showToast(`${pendingBookingData.machine_name} booked! Check My Bookings. 🎉`,'success');
      pendingBookingData=null;
      const rc=document.getElementById('result-card'); if(rc)rc.style.display='none';
      const sf=document.getElementById('search-form'); if(sf)sf.reset();
      switchUserTab('bookings'); setTimeout(renderUserBookings,100);
    } else { throw new Error(res.error||JSON.stringify(res)); }
  } catch(error){
    showToast('Booking failed: '+error.message,'error');
    btn.disabled=false; btn.innerHTML='✅ Confirm Booking';
  }
}

// ===== USER DASHBOARD =====
function switchUserTab(tab){
  document.getElementById('udash-search').style.display=tab==='search'?'':'none';
  document.getElementById('udash-bookings').style.display=tab==='bookings'?'':'none';
  document.getElementById('udash-tab-search').classList.toggle('active',tab==='search');
  document.getElementById('udash-tab-bookings').classList.toggle('active',tab==='bookings');
  if(tab==='bookings')renderUserBookings();
}
async function renderUserBookings(){
  if(!currentUser)return;
  const container=document.getElementById('user-bookings-list'); if(!container)return;
  const userBookings=allData.filter(r=>r.type==='booking'&&r.user_email===currentUser.user_email);
  if(!userBookings.length){
    container.innerHTML='<div class="empty-state"><div style="font-size:2.5rem">📋</div><div>No bookings yet. Search and book a machine above!</div></div>';
    return;
  }
  container.innerHTML=userBookings.map(b=>`
    <div class="booking-card">
      <div class="booking-header">
        <span class="booking-machine">${b.machine_name||'Machine'}</span>
        <span class="badge status-${(b.status||'pending').toLowerCase()}">${b.status||'Pending'}</span>
      </div>
      <div class="booking-details">
        <span>🌾 ${b.crop_type||'-'}</span>
        <span>📐 ${b.acres||'-'} acres</span>
        <span>📍 ${b.distance||'-'} km</span>
        <span>💰 ₹${(b.total_cost||0).toLocaleString('en-IN')}</span>
        <span>⏱️ ${b.estimated_hours||'-'} hrs</span>
      </div>
      <div class="booking-date">${b.created_at?new Date(b.created_at).toLocaleDateString('en-IN'):''}</div>
      <button class="btn btn-sm btn-outline" onclick="showBookingMap('${b.machine_name}')" style="margin-top:0.5rem;font-size:0.8rem">📡 Track Machine</button>
    </div>`).join('');
}
function updateDistrictOptions(){}
function updateVillageOptions(){}

// ===== GPS — USER BOOKING MAP =====
async function showBookingMap(machineName){
  let modal=document.getElementById('gps-modal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='gps-modal';
    modal.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML=`
      <div style="background:#fff;border-radius:12px;padding:1.5rem;width:90%;max-width:600px;max-height:90vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h3 style="margin:0">📡 Live Tracking: <span id="gps-modal-title"></span></h3>
          <button onclick="closeGpsModal()" style="background:none;border:none;font-size:1.5rem;cursor:pointer;">✕</button>
        </div>
        <div id="gps-info-bar" style="background:#f0fdf4;border-radius:8px;padding:0.75rem;margin-bottom:1rem;font-size:0.9rem;"></div>
        <div id="gps-user-map" style="height:300px;border-radius:8px;"></div>
        <div id="trip-history" style="margin-top:1rem;"></div>
      </div>`;
    document.body.appendChild(modal);
  }
  modal.style.display='flex';
  document.getElementById('gps-modal-title').textContent=machineName;
  // Init map
  if(userLocationMap){userLocationMap.remove();userLocationMap=null;}
  userLocationMap=L.map('gps-user-map').setView([13.135,78.132],12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors'}).addTo(userLocationMap);
  await refreshUserTrackingMap(machineName);
}
async function refreshUserTrackingMap(machineName){
  try{
    const res=await fetch(`${API_BASE}/location/${encodeURIComponent(machineName)}?limit=50`).then(r=>r.json());
    const infoBar=document.getElementById('gps-info-bar');
    if(!res.isOk||!res.data.length){
      if(infoBar)infoBar.innerHTML='⚠️ No GPS data available for this machine. Showing base location (Kolar).';
      L.marker([13.135,78.132]).addTo(userLocationMap).bindPopup(`${machineName} — No signal`).openPopup();
      return;
    }
    const latest=res.data[0];
    const lat=parseFloat(latest.lat); const lng=parseFloat(latest.lng);
    if(infoBar) infoBar.innerHTML=`
      <b>📍 Last known:</b> ${lat.toFixed(5)}, ${lng.toFixed(5)}<br>
      <b>🚀 Speed:</b> ${latest.speed||0} km/h &nbsp;&nbsp;
      <b>📶 Signal:</b> ${latest.signal_strength||'--'}%&nbsp;&nbsp;
      <b>🕐 Updated:</b> ${latest.created_at}`;
    // Live marker
    const liveIcon=L.divIcon({html:'<div style="font-size:1.8rem">🚜</div>',iconSize:[32,32],className:''});
    L.marker([lat,lng],{icon:liveIcon}).addTo(userLocationMap).bindPopup(`${machineName}<br>Speed: ${latest.speed||0} km/h`).openPopup();
    userLocationMap.setView([lat,lng],14);
    // Trip path
    if(res.data.length>1){
      const path=res.data.map(p=>[parseFloat(p.lat),parseFloat(p.lng)]).reverse();
      L.polyline(path,{color:'#16a34a',weight:3,opacity:0.7}).addTo(userLocationMap);
    }
    // Trip history list
    const hist=document.getElementById('trip-history');
    if(hist){
      hist.innerHTML=`<h4 style="margin:0 0 0.5rem">🗺️ Recent Pings (last ${res.data.length})</h4>`+
        res.data.slice(0,10).map(p=>`<div style="font-size:0.8rem;padding:0.25rem 0;border-bottom:1px solid #e5e7eb">${p.created_at} — ${parseFloat(p.lat).toFixed(5)}, ${parseFloat(p.lng).toFixed(5)} — ${p.speed||0} km/h</div>`).join('');
    }
  } catch(e){console.error('GPS fetch error',e);}
}
function closeGpsModal(){
  const m=document.getElementById('gps-modal'); if(m)m.style.display='none';
  if(userLocationMap){userLocationMap.remove();userLocationMap=null;}
}

// ===== GPS — ADMIN FLEET MAP =====
async function initFleetMap(){
  const container=document.getElementById('fleet-map');
  if(!container)return;
  if(fleetMap){fleetMap.remove();fleetMap=null;fleetMarkers={};}
  fleetMap=L.map('fleet-map').setView([13.135,78.132],11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors'}).addTo(fleetMap);
  // Kolar base marker
  L.marker([13.135,78.132],{icon:L.divIcon({html:'<div style="font-size:1.4rem">🏠</div>',iconSize:[28,28],className:''})}).addTo(fleetMap).bindPopup('AgroBook Base — Kolar');
  await refreshFleetMap();
  startGpsRefresh();
  await loadGeofenceAlerts();
}
async function refreshFleetMap(){
  try{
    const res=await fetch(`${API_BASE}/location/latest`).then(r=>r.json());
    if(!res.isOk)return;
    const statusColors={'Available':'#16a34a','Busy':'#dc2626','Maintenance':'#d97706'};
    res.data.forEach(loc=>{
      const lat=parseFloat(loc.lat); const lng=parseFloat(loc.lng);
      const machineName=loc.machine_name;
      const avail=(machineConfigs[machineName]||{}).availability||'Available';
      const color=statusColors[avail]||'#6b7280';
      const iconHtml=`<div style="background:${color};border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.3);font-size:1.1rem">🚜</div>`;
      const icon=L.divIcon({html:iconHtml,iconSize:[36,36],className:''});
      const popupText=`<b>${machineName}</b><br>Status: ${avail}<br>Speed: ${loc.speed||0} km/h<br>Signal: ${loc.signal_strength||'--'}%<br><small>${loc.created_at}</small>`;
      if(fleetMarkers[machineName]){
        fleetMarkers[machineName].setLatLng([lat,lng]).setPopupContent(popupText);
      } else {
        fleetMarkers[machineName]=L.marker([lat,lng],{icon}).addTo(fleetMap).bindPopup(popupText);
      }
    });
  } catch(e){console.error('Fleet map refresh error',e);}
}
function startGpsRefresh(){
  stopGpsRefresh();
  gpsRefreshTimer=setInterval(async()=>{
    await refreshFleetMap();
    await loadGeofenceAlerts();
  },30000); // refresh every 30 seconds
}
function stopGpsRefresh(){
  if(gpsRefreshTimer){clearInterval(gpsRefreshTimer);gpsRefreshTimer=null;}
}

// ===== GEOFENCE ALERTS =====
async function loadGeofenceAlerts(){
  const container=document.getElementById('geofence-alerts-list'); if(!container)return;
  try{
    const res=await fetch(`${API_BASE}/geofence_alerts`).then(r=>r.json());
    if(!res.isOk||!res.data.length){
      container.innerHTML='<div style="color:#6b7280;font-size:0.9rem">✅ No active alerts</div>';
      return;
    }
    container.innerHTML=res.data.map(a=>`
      <div class="booking-card" style="border-left:4px solid #dc2626;margin-bottom:0.5rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span><b>⚠️ ${a.alert_type}</b> — ${a.machine_name}</span>
          <button onclick="resolveAlert(${a.id},this)" style="background:#dc2626;color:#fff;border:none;border-radius:6px;padding:0.25rem 0.75rem;cursor:pointer;font-size:0.8rem">Resolve</button>
        </div>
        <div style="font-size:0.82rem;color:#6b7280;margin-top:0.25rem">${a.message}</div>
        <div style="font-size:0.75rem;color:#9ca3af">${a.created_at}</div>
      </div>`).join('');
  } catch(e){console.error('Geofence alerts error',e);}
}
async function resolveAlert(alertId,btn){
  btn.disabled=true; btn.textContent='Resolving...';
  try{
    const res=await fetch(`${API_BASE}/geofence_alerts/${alertId}/resolve`,{method:'POST'}).then(r=>r.json());
    if(res.isOk){showToast('Alert resolved','success');await loadGeofenceAlerts();}
    else{throw new Error(res.error);}
  }catch(e){showToast('Failed: '+e.message,'error');btn.disabled=false;btn.textContent='Resolve';}
}

// ===== ADMIN DASHBOARD =====
async function renderAdminMachine(){
  const container=document.getElementById('admin-machine-container'); if(!container)return;
  const configs=allData.filter(r=>r.type==='machine_config');
  if(!configs.length){container.innerHTML='<div class="empty-state">No machine configs yet.</div>';return;}
  container.innerHTML=configs.map(mc=>`
    <div class="machine-card">
      <div class="machine-name">${mc.machine_name}</div>
      <div class="machine-details">
        <span>₹${mc.rate_per_acre}/acre</span><span>₹${mc.cost_per_km}/km</span>
        <span>Driver: ₹${mc.driver_cost}</span>
        <span class="badge status-${(mc.availability||'available').toLowerCase()}">${mc.availability||'Available'}</span>
      </div>
    </div>`).join('');
}
async function renderAdminUsers(){
  const container=document.getElementById('admin-users-container'); if(!container)return;
  const users=allData.filter(r=>r.type==='user');
  if(!users.length){container.innerHTML='<div class="empty-state">No users yet.</div>';return;}
  container.innerHTML=users.map(u=>`
    <div class="user-card">
      <div class="user-name">${u.user_name}</div>
      <div class="user-details"><span>${u.user_email}</span><span>${u.user_phone}</span>
        <span class="badge status-${(u.status||'active').toLowerCase()}">${u.status||'active'}</span>
      </div>
    </div>`).join('');
}
async function renderAdminBookings(){
  const container=document.getElementById('admin-bookings-container'); if(!container)return;
  const bookings=allData.filter(r=>r.type==='booking');
  if(!bookings.length){container.innerHTML='<div class="empty-state">No bookings yet.</div>';return;}
  container.innerHTML=bookings.map(b=>`
    <div class="booking-card">
      <div class="booking-header">
        <span>${b.user_name} (${b.user_email})</span>
        <span class="badge status-${(b.status||'pending').toLowerCase()}">${b.status||'Pending'}</span>
      </div>
      <div class="booking-details">
        <span>🚜 ${b.machine_name}</span><span>🌾 ${b.crop_type||'-'}</span>
        <span>📐 ${b.acres||'-'} acres</span><span>💰 ₹${(b.total_cost||0).toLocaleString('en-IN')}</span>
      </div>
    </div>`).join('');
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async()=>{
  await window.dataSdk.init(dataHandler);
  showPage('home');
  if(typeof lucide!=='undefined')lucide.createIcons();
});
