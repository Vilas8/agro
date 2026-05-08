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

// ===== DATA HANDLER =====
const dataHandler = {
  onDataChanged(data) {
    if (!Array.isArray(data)) { data = []; }
    allData = data;
    recordCount = data.length;
    machineConfigs = {};
    data.filter(r => r.type === 'machine_config').forEach(mc => {
      const name = mc.machine_name;
      if (name) machineConfigs[name] = {
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

// ===== FETCH ALL DATA FROM API =====
async function fetchAllFromApi() {
  try {
    const [usersRes, machinesRes, bookingsRes] = await Promise.all([
      fetch(`${API_BASE}/users`).then(r => r.json()),
      fetch(`${API_BASE}/machine_configs`).then(r => r.json()),
      fetch(`${API_BASE}/bookings`).then(r => r.json())
    ]);
    const users = (usersRes.isOk ? usersRes.data : []).map(u => ({ ...u, type: 'user' }));
    const machines = (machinesRes.isOk ? machinesRes.data : []).map(m => ({ ...m, type: 'machine_config' }));
    const bookings = (bookingsRes.isOk ? bookingsRes.data : []).map(b => ({ ...b, type: 'booking' }));
    const merged = [...users, ...machines, ...bookings];
    localStorage.setItem('agrobook_data', JSON.stringify(merged));
    dataHandler.onDataChanged(merged);
    return merged;
  } catch (e) {
    console.warn('API fetch failed, using localStorage:', e.message);
    const local = safeLocalGet();
    dataHandler.onDataChanged(local);
    return local;
  }
}

function getApiCollection(type) {
  const map = { user:'users', users:'users', machine_config:'machine_configs', machine_configs:'machine_configs', booking:'bookings', bookings:'bookings' };
  return map[(type||'').toLowerCase()] || 'bookings';
}

// ===== SDK =====
window.dataSdk = {
  async create(record) {
    const req = record.type==='booking' ? ['user_name','user_email','user_phone','machine_name']
      : record.type==='user' ? ['user_name','user_email','user_phone','user_password']
      : record.type==='machine_config' ? ['machine_name'] : [];
    const miss = req.filter(f => !record[f]);
    if (miss.length) return { isOk: false, error: `Missing: ${miss[0]}` };
    try {
      const res = await fetch(`${API_BASE}/${getApiCollection(record.type)}`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(record)
      }).then(r => r.json());
      if (res.isOk) {
        record.id = res.record_id; record.__backendId = `api_${record.id}`;
        safeLocalUpdate(data => { data.unshift(record); return data; });
        return { isOk: true };
      } else { throw new Error(res.error || 'API failed'); }
    } catch(e) {
      record.__backendId = 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2,9);
      safeLocalUpdate(data => { data.unshift(record); return data; });
      return { isOk: true, local: true };
    }
  },
  async init(handler) {
    dataHandler.handler = handler;
    handler.onDataChanged(safeLocalGet());
    await fetchAllFromApi();
    return { isOk: true };
  },
  async update(record) {
    const id = record.id || record.__backendId;
    try {
      const res = await fetch(`${API_BASE}/${getApiCollection(record.type)}/${record.id}`, {
        method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(record)
      }).then(r => r.json());
      if (res.isOk) {
        safeLocalUpdate(data => { const i=data.findIndex(r=>(r.id||r.__backendId)===id); if(i>-1)data[i]=record; return data; });
        return { isOk: true };
      } else { throw new Error(res.error); }
    } catch(e) {
      safeLocalUpdate(data => { const i=data.findIndex(r=>(r.id||r.__backendId)===id); if(i>-1)data[i]=record; return data; });
      return { isOk: true, local: true };
    }
  },
  async delete(record) {
    const id = record.id || record.__backendId;
    try {
      const res = await fetch(`${API_BASE}/${getApiCollection(record.type)}/${record.id}`, { method:'DELETE' }).then(r => r.json());
      if (res.isOk) { safeLocalUpdate(data => data.filter(r=>(r.id||r.__backendId)!==id)); return { isOk: true }; }
      else { throw new Error(res.error); }
    } catch(e) {
      safeLocalUpdate(data => data.filter(r=>(r.id||r.__backendId)!==id));
      return { isOk: true, local: true };
    }
  }
};

function safeLocalGet() {
  try { const d=JSON.parse(localStorage.getItem('agrobook_data')||'[]'); return Array.isArray(d)?d:[]; }
  catch(e) { localStorage.removeItem('agrobook_data'); return []; }
}
function safeLocalUpdate(fn) {
  const d=safeLocalGet(); const nd=fn(d);
  localStorage.setItem('agrobook_data', JSON.stringify(nd));
  dataHandler.onDataChanged(nd);
}

// ===== SESSION PERSISTENCE =====
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
      try {
        const res = await fetch(`${API_BASE}/users`).then(r => r.json());
        if (res.isOk) {
          const freshUser = res.data.find(u => u.user_email === sess.user.user_email && u.user_password === sess.user.user_password);
          if (!freshUser) { localStorage.removeItem('agrobook_session'); currentUser = null; return false; }
          currentUser = { ...freshUser, type: 'user' };
          saveSession();
        } else {
          currentUser = sess.user;
        }
      } catch(e) {
        currentUser = sess.user;
      }
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
  const t=document.getElementById('toast'); if(!t)return;
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
    if(isStrongPassword(pass)){elem.textContent='\u2705 Strong password';elem.style.color='#16a34a';}
    else{elem.textContent='\u274C Weak (8+ chars, upper, lower, number, special)';elem.style.color='#dc2626';}
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
      el.style.display='block'; el.classList.add('active');
      el.classList.remove('fade-in'); void el.offsetWidth; el.classList.add('fade-in');
      currentPage=name;
      if(typeof lucide!=='undefined')lucide.createIcons();
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      const nb=document.getElementById('nav-'+name); if(nb)nb.classList.add('active');
      if(name==='user-dashboard'){
        updateDistrictOptions();
        renderUserBookings();
      }
      if(name==='admin-dashboard'){
        fetchAllFromApi().then(()=>{
          renderAdminMachine();
          renderAdminUsers();
          renderAdminBookings();
          initFleetMap();
        });
      }
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
  if(!isStrongPassword(pass)){btn.disabled=false;btn.textContent='Create Account';errEl.textContent='Weak password \u2014 8+ chars, upper, lower, number, special char.';errEl.style.display='block';return;}
  await fetchAllFromApi();
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
  const btn=document.getElementById('login-btn');
  if(btn){btn.disabled=true;btn.textContent='Logging in...';}
  try {
    const res=await fetch(`${API_BASE}/users`).then(r=>r.json());
    if(res.isOk){
      const apiUsers=res.data.map(u=>({...u,type:'user'}));
      const nonUsers=allData.filter(r=>r.type!=='user');
      const merged=[...apiUsers,...nonUsers];
      localStorage.setItem('agrobook_data',JSON.stringify(merged));
      dataHandler.onDataChanged(merged);
    }
  } catch(e){console.warn('Login pre-fetch failed');}
  if(btn){btn.disabled=false;btn.textContent='Login';}
  const user=allData.find(r=>r.type==='user'&&r.user_email===email&&r.user_password===pass);
  if(!user){errEl.textContent='Invalid email or password.';errEl.style.display='block';return;}
  currentUser=user;
  saveSession();
  const nameEl=document.getElementById('dash-username');
  if(nameEl)nameEl.textContent='\uD83D\uDC64 '+user.user_name;
  document.getElementById('login-form').reset();
  showToast('Welcome back, '+user.user_name+'!','success');
  showPage('user-dashboard');
}

async function handleAdminLogin(e){
  e.preventDefault();
  const email=document.getElementById('admin-email').value.trim().toLowerCase();
  const pass=document.getElementById('admin-pass').value;
  const errEl=document.getElementById('admin-login-error'); errEl.style.display='none';
  if(email==='admin@gmail.com'&&pass.trim()){
    isAdmin=true;
    saveSession();
    document.getElementById('admin-login-form').reset();
    showToast('Welcome, Admin!','success');
    showPage('admin-dashboard');
  } else {errEl.textContent='Please enter admin@gmail.com and password.';errEl.style.display='block';}
}

function logout(){
  currentUser=null; isAdmin=false;
  localStorage.removeItem('agrobook_session');
  stopGpsRefresh();
  showToast('Logged out successfully.','success');
  showPage('home');
}

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
  const icons={'Grass Cutter':'\uD83C\uDF3F','Harvester':'\uD83C\uDF3E','Flip plow':'\uD83D\uDD04','Corn Planter':'\uD83C\uDF3D','other':'\uD83D\uDE9C'};
  const iconEl=document.getElementById('res-machine-icon'); if(iconEl)iconEl.textContent=icons[machineType]||'\uD83D\uDE9C';
  document.title=machineType+' - AgroBook';
  document.getElementById('res-machine').textContent=machineType;
  document.getElementById('res-machine-title').textContent=machineType+' Cost Breakdown';
  document.getElementById('res-crop').textContent=crop;
  document.getElementById('res-acres').textContent=acres+' acres';
  document.getElementById('res-machine-cost').textContent='\u20B9'+machine_cost.toLocaleString('en-IN');
  document.getElementById('res-travel-cost').textContent='\u20B9'+travel_cost.toLocaleString('en-IN');
  document.getElementById('res-driver-cost').textContent='\u20B9'+driver_cost.toLocaleString('en-IN');
  document.getElementById('res-total').textContent='\u20B9'+total_cost.toLocaleString('en-IN');
  document.getElementById('res-time').textContent=estHours+' hour'+(estHours>1?'s':'');
  document.getElementById('result-card').style.display='block';
  const statusEl=document.getElementById('res-machine-status');
  const statusTextEl=document.getElementById('res-status-text');
  const warningEl=document.getElementById('res-unavailable-warning');
  const bookBtn=document.getElementById('book-btn');
  if(isUnavailable){
    bookBtn.style.display='none'; if(warningEl)warningEl.style.display='block';
    if(statusEl&&statusTextEl){statusEl.style.display='block';statusTextEl.textContent=config.availability;}
    showToast('Grass Cutter is currently '+config.availability.toLowerCase()+'. Cannot book.','error');
  } else {
    bookBtn.style.display='block'; if(warningEl)warningEl.style.display='none';
    if(statusEl&&statusTextEl&&isGrassCutter){statusEl.style.display='block';statusTextEl.textContent='Available';}
  }
  pendingBookingData={machine_name:machineType,crop_type:crop,acres,distance:dist,machine_cost,travel_cost,driver_cost,total_cost,estimated_hours:estHours};
}

async function autoFillDistanceFromGPS(){
  if(!navigator.geolocation){showToast('Geolocation not supported','error');return;}
  navigator.geolocation.getCurrentPosition(async pos=>{
    const userLat=pos.coords.latitude,userLng=pos.coords.longitude;
    const machineType=document.getElementById('machine-type').value;
    if(!machineType){showToast('Select a machine type first','error');return;}
    try{
      const locRes=await fetch(`${API_BASE}/location/${encodeURIComponent(machineType)}`).then(r=>r.json());
      if(locRes.isOk&&locRes.data.length){
        const latest=locRes.data[0];
        const distRes=await fetch(`${API_BASE}/distance?lat1=${latest.lat}&lng1=${latest.lng}&lat2=${userLat}&lng2=${userLng}`).then(r=>r.json());
        if(distRes.isOk){document.getElementById('distance-km').value=distRes.distance_km;showToast('Distance auto-filled: '+distRes.distance_km+' km \uD83D\uDCCD','success');}
      } else {
        const distRes=await fetch(`${API_BASE}/distance?lat1=13.135&lng1=78.132&lat2=${userLat}&lng2=${userLng}`).then(r=>r.json());
        if(distRes.isOk){document.getElementById('distance-km').value=distRes.distance_km;showToast('Distance from base: '+distRes.distance_km+' km','success');}
      }
    }catch(e){showToast('GPS distance error: '+e.message,'error');}
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
    const bookingData={type:'booking',user_name:currentUser.user_name,user_email:currentUser.user_email,user_phone:currentUser.user_phone,...pendingBookingData,status:'Pending',created_at:new Date().toISOString()};
    const res=await window.dataSdk.create(bookingData);
    btn.disabled=false; btn.textContent='\u2705 Confirmed!';
    if(res.isOk){
      showToast(pendingBookingData.machine_name+' booked! Check My Bookings. \uD83C\uDF89','success');
      pendingBookingData=null;
      const rc=document.getElementById('result-card'); if(rc)rc.style.display='none';
      const sf=document.getElementById('search-form'); if(sf)sf.reset();
      switchUserTab('bookings'); setTimeout(renderUserBookings,100);
    } else { throw new Error(res.error||JSON.stringify(res)); }
  }catch(error){
    showToast('Booking failed: '+error.message,'error');
    btn.disabled=false; btn.innerHTML='\u2705 Confirm Booking';
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
  container.innerHTML='<div style="color:#6b7280;font-size:0.9rem;padding:1rem">\u23F3 Loading bookings...</div>';
  let userBookings = [];
  try{
    const res=await fetch(`${API_BASE}/bookings?email=${encodeURIComponent(currentUser.user_email)}`).then(r=>r.json());
    if(res.isOk && Array.isArray(res.data)){
      userBookings = res.data;
    } else {
      throw new Error('bad response');
    }
  }catch(e){
    userBookings = allData.filter(r=>r.type==='booking'&&r.user_email===currentUser.user_email);
  }
  if(!userBookings.length){
    container.innerHTML='<div style="text-align:center;padding:56px 16px;color:#9ca3af"><div style="font-size:3rem;margin-bottom:14px">\uD83D\uDCCB</div><p style="font-size:15px">No bookings yet. Search and book a machine above!</p></div>';
    return;
  }
  container.innerHTML=userBookings.map(b=>
    '<div class="booking-card">'+
    '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">'+
    '<span style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:16px;">'+(b.machine_name||'Machine')+'</span>'+
    '<span class="badge status-'+((b.status||'pending').toLowerCase())+'">'+(b.status||'Pending')+'</span>'+
    '</div>'+
    '<div class="booking-meta" style="display:flex;flex-wrap:wrap;gap:12px;margin-top:8px;">'+
    '<span>\uD83C\uDF3E '+(b.crop_type||'-')+'</span>'+
    '<span>\uD83D\uDCD0 '+(b.acres||'-')+' acres</span>'+
    '<span>\uD83D\uDCCD '+(b.distance||'-')+' km</span>'+
    '<span>\uD83D\uDCB0 \u20B9'+((b.total_cost||0).toLocaleString('en-IN'))+'</span>'+
    '<span>\u23F1\uFE0F '+(b.estimated_hours||'-')+' hrs</span>'+
    '</div>'+
    '<div style="font-size:12px;color:#9ca3af;margin-top:6px;">'+(b.created_at?new Date(b.created_at).toLocaleString('en-IN'):'')+'</div>'+
    '<button class="btn-sm" onclick="showBookingMap(\''+b.machine_name+'\')" style="margin-top:10px;font-size:12px;">\uD83D\uDCE1 Track Machine</button>'+
    '</div>'
  ).join('');
}

// ===== GPS - USER BOOKING MAP =====
async function showBookingMap(machineName){
  let modal=document.getElementById('gps-modal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='gps-modal';
    modal.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML=
      '<div style="background:#fff;border-radius:12px;padding:1.5rem;width:90%;max-width:600px;max-height:90vh;overflow-y:auto;">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">'+
      '<h3 style="margin:0">\uD83D\uDCE1 Live Tracking: <span id="gps-modal-title"></span></h3>'+
      '<button onclick="closeGpsModal()" style="background:none;border:none;font-size:1.5rem;cursor:pointer;">\u2715</button>'+
      '</div>'+
      '<div id="gps-info-bar" style="background:#f0fdf4;border-radius:8px;padding:0.75rem;margin-bottom:1rem;font-size:0.9rem;"></div>'+
      '<div id="gps-user-map" style="height:300px;border-radius:8px;"></div>'+
      '<div id="trip-history" style="margin-top:1rem;"></div>'+
      '</div>';
    document.body.appendChild(modal);
  }
  modal.style.display='flex';
  document.getElementById('gps-modal-title').textContent=machineName;
  if(userLocationMap){userLocationMap.remove();userLocationMap=null;}
  userLocationMap=L.map('gps-user-map').setView([13.135,78.132],12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'\u00A9 OpenStreetMap contributors'}).addTo(userLocationMap);
  await refreshUserTrackingMap(machineName);
}
async function refreshUserTrackingMap(machineName){
  try{
    const res=await fetch(`${API_BASE}/location/${encodeURIComponent(machineName)}?limit=50`).then(r=>r.json());
    const infoBar=document.getElementById('gps-info-bar');
    if(!res.isOk||!res.data.length){
      if(infoBar)infoBar.innerHTML='\u26A0\uFE0F No GPS data. Showing base location (Kolar).';
      L.marker([13.135,78.132]).addTo(userLocationMap).bindPopup(machineName+' \u2014 No signal').openPopup();
      return;
    }
    const latest=res.data[0];
    const lat=parseFloat(latest.lat),lng=parseFloat(latest.lng);
    if(infoBar)infoBar.innerHTML='<b>\uD83D\uDCCD Last known:</b> '+lat.toFixed(5)+', '+lng.toFixed(5)+'<br><b>\uD83D\uDE80 Speed:</b> '+(latest.speed||0)+' km/h &nbsp;&nbsp;<b>\uD83D\uDCF6 Signal:</b> '+(latest.signal_strength||'--')+'%&nbsp;&nbsp;<b>\uD83D\uDD50 Updated:</b> '+latest.created_at;
    const liveIcon=L.divIcon({html:'<div style="font-size:1.8rem">\uD83D\uDE9C</div>',iconSize:[32,32],className:''});
    L.marker([lat,lng],{icon:liveIcon}).addTo(userLocationMap).bindPopup(machineName+'<br>Speed: '+(latest.speed||0)+' km/h').openPopup();
    userLocationMap.setView([lat,lng],14);
    if(res.data.length>1){const path=res.data.map(p=>[parseFloat(p.lat),parseFloat(p.lng)]).reverse();L.polyline(path,{color:'#16a34a',weight:3,opacity:0.7}).addTo(userLocationMap);}
    const hist=document.getElementById('trip-history');
    if(hist)hist.innerHTML='<h4 style="margin:0 0 0.5rem">\uD83D\uDDFA\uFE0F Recent Pings (last '+res.data.length+')</h4>'+res.data.slice(0,10).map(p=>'<div style="font-size:0.8rem;padding:0.25rem 0;border-bottom:1px solid #e5e7eb">'+p.created_at+' \u2014 '+parseFloat(p.lat).toFixed(5)+', '+parseFloat(p.lng).toFixed(5)+' \u2014 '+(p.speed||0)+' km/h</div>').join('');
  }catch(e){console.error('GPS fetch error',e);}
}
function closeGpsModal(){
  const m=document.getElementById('gps-modal'); if(m)m.style.display='none';
  if(userLocationMap){userLocationMap.remove();userLocationMap=null;}
}

// ===== GPS - ADMIN FLEET MAP =====
async function initFleetMap(){
  const container=document.getElementById('fleet-map'); if(!container)return;
  if(fleetMap){fleetMap.remove();fleetMap=null;fleetMarkers={};}
  fleetMap=L.map('fleet-map').setView([13.135,78.132],12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'\u00A9 OpenStreetMap contributors'}).addTo(fleetMap);
  L.marker([13.135,78.132],{
    icon:L.divIcon({
      html:'<div style="background:#1a3a1a;color:#fff;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.3);">\uD83C\uDFE0 AgroBook Base</div>',
      iconSize:[130,26],iconAnchor:[65,13],className:''
    })
  }).addTo(fleetMap);
  await refreshFleetMap();
  startGpsRefresh();
  await loadGeofenceAlerts();
}

async function refreshFleetMap(){
  if(!fleetMap) return;
  try{
    const res=await fetch(`${API_BASE}/location/latest`).then(r=>r.json());
    const statusColors={'Available':'#16a34a','Busy':'#dc2626','Maintenance':'#d97706'};
    const statusDot={'Available':'\uD83D\uDFE2','Busy':'\uD83D\uDD34','Maintenance':'\uD83D\uDFE1'};
    const machineEmoji={'Grass Cutter':'\uD83C\uDF3F','Harvester':'\uD83C\uDF3E','Flip plow':'\uD83D\uDD04','Corn Planter':'\uD83C\uDF3D'};
    const defaultCoords={
      'Grass Cutter': [13.1370, 78.1335],
      'Harvester':    [13.1390, 78.1355],
      'Flip plow':    [13.1330, 78.1360],
      'Corn Planter': [13.1310, 78.1310]
    };
    const apiMachines={};
    if(res.isOk && res.data && res.data.length){
      res.data.forEach(loc=>{ apiMachines[loc.machine_name]=loc; });
    }
    const machinesToShow = Object.keys(machineConfigs).length
      ? Object.keys(machineConfigs)
      : Object.keys(defaultCoords);
    machinesToShow.forEach(machineName=>{
      const loc=apiMachines[machineName];
      const coords=defaultCoords[machineName]||[13.135,78.132];
      const lat=loc?parseFloat(loc.lat):coords[0];
      const lng=loc?parseFloat(loc.lng):coords[1];
      const avail=(machineConfigs[machineName]||{}).availability||'Available';
      const color=statusColors[avail]||'#6b7280';
      const dot=statusDot[avail]||'\uD83D\uDFE2';
      const emoji=machineEmoji[machineName]||'\uD83D\uDE9C';
      const iconHtml=
        '<div style="display:flex;flex-direction:column;align-items:center;">'+
        '<div style="background:#fff;border:2px solid '+color+';border-radius:20px;padding:4px 10px;box-shadow:0 2px 8px rgba(0,0,0,0.15);display:flex;align-items:center;gap:5px;white-space:nowrap;">'+
        '<span style="font-size:14px;">'+emoji+'</span>'+
        '<span style="font-size:11px;font-weight:700;color:#1a3a1a;font-family:sans-serif;">'+machineName+'</span>'+
        '<span style="font-size:11px;">'+dot+'</span>'+
        '</div>'+
        '<div style="width:2px;height:6px;background:'+color+';"></div>'+
        '<div style="width:7px;height:7px;border-radius:50%;background:'+color+';border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.25);"></div>'+
        '</div>';
      const icon=L.divIcon({html:iconHtml,iconSize:[150,54],iconAnchor:[75,54],className:''});
      const popup=
        '<b>'+emoji+' '+machineName+'</b><br>'+
        '<span style="color:'+color+';font-weight:600;">'+dot+' '+avail+'</span>'+
        (loc?'<br>Speed: '+(loc.speed||0)+' km/h<br>Signal: '+(loc.signal_strength||'--')+'%<br><small>'+loc.created_at+'</small>':'<br><small>No live GPS \u2014 base location</small>');
      if(fleetMarkers[machineName]){
        fleetMarkers[machineName].setLatLng([lat,lng]);
        fleetMarkers[machineName].setIcon(icon);
        fleetMarkers[machineName].setPopupContent(popup);
      }else{
        fleetMarkers[machineName]=L.marker([lat,lng],{icon}).addTo(fleetMap).bindPopup(popup);
      }
    });
  }catch(e){console.error('Fleet map refresh error',e);}
}

function startGpsRefresh(){stopGpsRefresh();gpsRefreshTimer=setInterval(async()=>{await refreshFleetMap();await loadGeofenceAlerts();},30000);}
function stopGpsRefresh(){if(gpsRefreshTimer){clearInterval(gpsRefreshTimer);gpsRefreshTimer=null;}}

// ===== GEOFENCE ALERTS =====
async function loadGeofenceAlerts(){
  const container=document.getElementById('geofence-alerts-list'); if(!container)return;
  try{
    const res=await fetch(`${API_BASE}/geofence_alerts`).then(r=>r.json());
    if(!res.isOk||!res.data.length){container.innerHTML='<div style="color:#6b7280;font-size:0.9rem">\u2705 No active alerts</div>';return;}
    container.innerHTML=res.data.map(a=>
      '<div class="booking-card" style="border-left:4px solid #dc2626;margin-bottom:0.5rem;">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;">'+
      '<span><b>\u26A0\uFE0F '+a.alert_type+'</b> \u2014 '+a.machine_name+'</span>'+
      '<button onclick="resolveAlert('+a.id+',this)" style="background:#dc2626;color:#fff;border:none;border-radius:6px;padding:0.25rem 0.75rem;cursor:pointer;font-size:0.8rem">Resolve</button>'+
      '</div>'+
      '<div style="font-size:0.82rem;color:#6b7280;margin-top:0.25rem">'+a.message+'</div>'+
      '<div style="font-size:0.75rem;color:#9ca3af">'+a.created_at+'</div>'+
      '</div>'
    ).join('');
  }catch(e){console.error('Geofence alerts error',e);}
}
async function resolveAlert(alertId,btn){
  btn.disabled=true; btn.textContent='Resolving...';
  try{
    const res=await fetch(`${API_BASE}/geofence_alerts/${alertId}/resolve`,{method:'POST'}).then(r=>r.json());
    if(res.isOk){showToast('Alert resolved','success');await loadGeofenceAlerts();}
    else{throw new Error(res.error);}
  }catch(e){showToast('Failed: '+e.message,'error');btn.disabled=false;btn.textContent='Resolve';}
}

// ===== ADMIN: MACHINE CONFIG =====
// FIX 1: onAdminMachineChange reads from machineConfigs which is updated
// immediately in saveMachineConfig before any async refetch runs,
// so the badge and dropdown always reflect the just-saved value.
function onAdminMachineChange(){
  currentAdminMachine = document.getElementById('admin-machine-selector').value;
  const icons = {'Grass Cutter':'\uD83C\uDF3F','Harvester':'\uD83C\uDF3E','Flip plow':'\uD83D\uDD04','Corn Planter':'\uD83C\uDF3D'};
  const iconEl = document.getElementById('admin-machine-icon');
  if(iconEl) iconEl.textContent = icons[currentAdminMachine] || '\uD83D\uDE9C';
  const cfg = machineConfigs[currentAdminMachine] || {rate_per_acre:800,cost_per_km:15,petrol_cost_per_km:25,driver_cost:600,availability:'Available'};
  document.getElementById('cfg-rate').value = cfg.rate_per_acre;
  document.getElementById('cfg-cpkm').value = cfg.cost_per_km;
  document.getElementById('cfg-petrol-km').value = cfg.petrol_cost_per_km;
  document.getElementById('cfg-driver').value = cfg.driver_cost;
  const availEl = document.getElementById('cfg-avail');
  if(availEl) availEl.value = cfg.availability || 'Available';
  const dispRate = document.getElementById('disp-rate'); if(dispRate) dispRate.textContent = '\u20B9'+cfg.rate_per_acre;
  const dispCpkm = document.getElementById('disp-cpkm'); if(dispCpkm) dispCpkm.textContent = '\u20B9'+cfg.cost_per_km;
  const dispPetrol = document.getElementById('disp-petrol-km'); if(dispPetrol) dispPetrol.textContent = '\u20B9'+cfg.petrol_cost_per_km;
  const dispDriver = document.getElementById('disp-driver'); if(dispDriver) dispDriver.textContent = '\u20B9'+cfg.driver_cost;
  const badge = document.getElementById('machine-avail-badge');
  if(badge){
    badge.textContent = cfg.availability || 'Available';
    badge.className = 'badge status-'+(cfg.availability||'Available').toLowerCase().replace(/\s+/g,'-');
  }
}

async function saveMachineConfig(e){
  e.preventDefault();
  const errEl = document.getElementById('machine-save-error');
  const btn = document.getElementById('machine-save-btn');
  if(errEl) errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Saving...';
  const machineName = document.getElementById('admin-machine-selector').value;
  const rate = parseFloat(document.getElementById('cfg-rate').value);
  const cpkm = parseFloat(document.getElementById('cfg-cpkm').value);
  const petrol = parseFloat(document.getElementById('cfg-petrol-km').value);
  const driver = parseFloat(document.getElementById('cfg-driver').value);
  const avail = document.getElementById('cfg-avail').value;
  if(!machineName||isNaN(rate)||isNaN(cpkm)||isNaN(petrol)||isNaN(driver)){
    if(errEl){errEl.textContent='Please fill all fields with valid numbers.';errEl.style.display='block';}
    btn.disabled=false; btn.textContent='Save Configuration'; return;
  }
  const existingRecord = allData.find(r=>r.type==='machine_config'&&r.machine_name===machineName);
  const configRecord = {type:'machine_config',machine_name:machineName,rate_per_acre:rate,cost_per_km:cpkm,petrol_cost_per_km:petrol,driver_cost:driver,availability:avail,updated_at:new Date().toISOString()};
  let res;
  if(existingRecord&&(existingRecord.id||existingRecord.__backendId)){
    res = await window.dataSdk.update({...existingRecord,...configRecord});
  } else {
    res = await window.dataSdk.create(configRecord);
  }
  btn.disabled=false; btn.textContent='Save Configuration';
  if(res.isOk){
    showToast(machineName+' configuration saved! \u2705','success');
    // FIX 1: Update machineConfigs in memory FIRST so onAdminMachineChange
    // reads the new availability immediately — before fetchAllFromApi runs.
    machineConfigs[machineName] = {rate_per_acre:rate,cost_per_km:cpkm,petrol_cost_per_km:petrol,driver_cost:driver,availability:avail};
    // Also patch allData so dataHandler.onDataChanged won't overwrite it
    const idx = allData.findIndex(r=>r.type==='machine_config'&&r.machine_name===machineName);
    if(idx>-1){ allData[idx]={...allData[idx],...configRecord}; } else { allData.unshift(configRecord); }
    // Refresh badge/form from the now-correct machineConfigs
    onAdminMachineChange();
    // Background sync — does NOT call onAdminMachineChange again (no await)
    fetchAllFromApi();
  } else {
    if(errEl){errEl.textContent='Save failed: '+(res.error||'Unknown error');errEl.style.display='block';}
  }
}

async function renderAdminMachine(){
  onAdminMachineChange();
}

// ===== ADMIN: RENDER USERS =====
// FIX 2: Renders directly into #admin-users-list (the always-visible element).
// The HTML has no #admin-users-container, so we just write into #admin-users-list.
// Falls back to allData on API error so it always shows something.
async function renderAdminUsers(){
  const listEl = document.getElementById('admin-users-list');
  if(!listEl) return;
  listEl.innerHTML = '<div style="color:#6b7280;font-size:0.9rem;padding:1rem">\u23F3 Loading users...</div>';
  let users = [];
  try{
    const res = await fetch(`${API_BASE}/users`).then(r=>r.json());
    users = (res.isOk && Array.isArray(res.data)) ? res.data : allData.filter(r=>r.type==='user');
  }catch(e){
    users = allData.filter(r=>r.type==='user');
  }
  if(!users.length){
    listEl.innerHTML='<div style="text-align:center;padding:56px 16px;color:#9ca3af"><div style="font-size:3rem;margin-bottom:14px">\uD83D\uDC64</div><p style="font-size:15px">No users registered yet.</p></div>';
    return;
  }
  listEl.innerHTML = users.map(u=>
    '<div class="user-card" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:14px 0;border-bottom:1px solid #f0fdf4;">'+
    '<div>'+
    '<div style="font-family:\'Syne\',sans-serif;font-weight:700;font-size:16px;">'+(u.user_name||'-')+'</div>'+
    '<div class="booking-meta" style="margin-top:4px;">'+(u.user_email||'-')+' &nbsp;|&nbsp; '+(u.user_phone||'-')+'</div>'+
    '</div>'+
    '<span class="badge status-'+((u.status||'active').toLowerCase())+'">'+(u.status||'active')+'</span>'+
    '</div>'
  ).join('');
}

// ===== ADMIN: RENDER BOOKINGS =====
// FIX 2 (same): Renders directly into #admin-bookings-list.
async function renderAdminBookings(){
  const listEl = document.getElementById('admin-bookings-list');
  if(!listEl) return;
  listEl.innerHTML = '<div style="color:#6b7280;font-size:0.9rem;padding:1rem">\u23F3 Loading bookings...</div>';
  let bookings = [];
  try{
    const res = await fetch(`${API_BASE}/bookings`).then(r=>r.json());
    bookings = (res.isOk && Array.isArray(res.data)) ? res.data : allData.filter(r=>r.type==='booking');
  }catch(e){
    bookings = allData.filter(r=>r.type==='booking');
  }
  if(!bookings.length){
    listEl.innerHTML='<div style="text-align:center;padding:56px 16px;color:#9ca3af"><div style="font-size:3rem;margin-bottom:14px">\uD83D\uDCED</div><p style="font-size:15px">No bookings yet.</p></div>';
    return;
  }
  listEl.innerHTML = bookings.map(b=>{
    const bid = b.id||b.__backendId||'';
    return '<div class="booking-card">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">'+
      '<div>'+
      '<div style="font-family:\'Syne\',sans-serif;font-weight:700;">'+(b.user_name||'-')+' <span style="font-weight:400;font-size:13px;color:#6b7280;">('+(b.user_email||'-')+')</span></div>'+
      '<div class="booking-meta" style="margin-top:4px;">\uD83D\uDE9C '+(b.machine_name||'-')+' &nbsp;|&nbsp; \uD83C\uDF3E '+(b.crop_type||'-')+' &nbsp;|&nbsp; \uD83D\uDCD0 '+(b.acres||'-')+' acres &nbsp;|&nbsp; \uD83D\uDCB0 \u20B9'+((b.total_cost||0).toLocaleString('en-IN'))+'</div>'+
      '</div>'+
      '<div style="display:flex;align-items:center;gap:8px;">'+
      '<span class="badge status-'+((b.status||'pending').toLowerCase())+'">'+(b.status||'Pending')+'</span>'+
      '<select onchange="updateBookingStatus(\''+bid+'\',this.value)" class="form-input" style="padding:4px 8px;font-size:12px;width:auto;border-radius:6px;">'+
      '<option '+(b.status==='Pending'?'selected':'')+'>Pending</option>'+
      '<option '+(b.status==='Confirmed'?'selected':'')+'>Confirmed</option>'+
      '<option '+(b.status==='Cancelled'?'selected':'')+'>Cancelled</option>'+
      '</select>'+
      '</div>'+
      '</div>'+
      '<div style="font-size:12px;color:#9ca3af;margin-top:6px;">'+(b.created_at?new Date(b.created_at).toLocaleString('en-IN'):'')+'</div>'+
      '</div>';
  }).join('');
}

async function updateBookingStatus(bookingId, newStatus){
  const record = allData.find(r=>(r.id||r.__backendId)==bookingId);
  if(!record) return;
  const updated = {...record, status:newStatus};
  const res = await window.dataSdk.update(updated);
  if(res.isOk){ showToast('Booking status updated to '+newStatus,'success'); renderAdminBookings(); }
  else{ showToast('Status update failed','error'); }
}

// ===== ADMIN TAB SWITCHER =====
// FIX 3: This definition in script.js (loaded with defer) runs after the
// inline HTML script, so window.switchAdminTab is explicitly set below in
// DOMContentLoaded to guarantee this version always wins.
function switchAdminTab(tab){
  ['machine','users','bookings','tracker'].forEach(t=>{
    const p = document.getElementById('adm-'+t);
    const b = document.getElementById('adm-tab-'+t);
    if(p) p.style.display = (t===tab) ? '' : 'none';
    if(b) b.classList.toggle('active', t===tab);
  });
  if(tab==='machine')  renderAdminMachine();
  if(tab==='users')    renderAdminUsers();
  if(tab==='bookings') renderAdminBookings();
  if(tab==='tracker')  setTimeout(initFleetMap, 200);
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async()=>{
  await window.dataSdk.init(dataHandler);
  const restored = await restoreSession();
  if(!restored) showPage('home');
  if(typeof lucide!=='undefined') lucide.createIcons();
  // FIX 3: Override inline HTML switchAdminTab with the correct version
  window.switchAdminTab = switchAdminTab;
});
