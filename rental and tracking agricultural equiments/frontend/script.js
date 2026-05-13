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
let globalTrackingInterval = null; // keeps running even when modal is closed
let globalTrackingState = null;    // { bookingId, route, index, totalDistKm, totalDurMin, machineName, startedAt }
const deliveredBookings = new Set(); // tracks delivered booking IDs in memory
let trackingPolyline = null;
let travelledPolyline = null;
