/**
 * شبكة المنتظر — الخلفية المجانية (Google Apps Script)
 * وظيفتان: 1) عدّاد زوار حقيقي  2) تسجيل المشتركين (بريد فقط)
 * الإعداد: انظر README.txt (5 خطوات).
 */
var OWNER_EMAIL = 'abaalfadheln@gmail.com';
var TZ = 'Asia/Baghdad';
var HEARTBEAT_MIN_GAP_MS = 8 * 1000; // هامش تسامح بسيط حول نبضات الـ10 ثوانٍ
var ENTER_WEIGHT = 10; // كل دخول أو تحديث يُحتسب 10 زيارات
var HEARTBEAT_WEIGHT = 10; // كل نبضة بقاء فعلية تُحتسب 10 زيارات

// مزوّدو البريد المسموحون فقط (يجب أن تطابق القائمة في script.js)
var ALLOWED_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com',
  'live.com', 'msn.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com',
  'aol.com', 'yandex.com', 'mail.com', 'gmx.com', 'zoho.com'
];

function doGet(e) {
  var p = (e && e.parameter) || {};
  var out;
  try {
    if (p.action === 'hit') out = hit_(p);
    else if (p.action === 'sub') out = subscribe_(p);
    else out = stats_();
  } catch (err) {
    out = { error: 'server' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyyMMdd'); }

function stats_() {
  var pr = PropertiesService.getScriptProperties();
  return {
    total: parseInt(pr.getProperty('total') || '0', 10),
    unique: parseInt(pr.getProperty('unique') || '0', 10),
    today: parseInt(pr.getProperty('d_' + today_()) || '0', 10)
  };
}

function sheet_(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(header); }
  return sh;
}

// تسجيل زيارة: kind=enter عند الدخول، kind=beat كل 10 ثوانٍ بقاء فعلي
function hit_(p) {
  var vid = String(p.vid || '');
  if (!/^[a-z0-9]{8,32}$/.test(vid)) return stats_();
  var isEnter = p.kind === 'enter';
  if (!isEnter && p.kind !== 'beat') return stats_();
  var beats = isEnter ? 1 : Number(p.beats || 1);
  if (beats < 1 || beats > 60 || Math.floor(beats) !== beats) return stats_();

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Read and write the guard under the same lock as the counters. This
    // prevents concurrent requests from both passing the heartbeat check.
    var cache = CacheService.getScriptCache();
    var key = 'h_' + vid;
    var now = Date.now();
    var last = parseInt(cache.get(key) || '0', 10);
    if (!isEnter && last && now - last < HEARTBEAT_MIN_GAP_MS) return stats_();
    var pr = PropertiesService.getScriptProperties();
    var weight = isEnter ? ENTER_WEIGHT : HEARTBEAT_WEIGHT * beats;
    var total = parseInt(pr.getProperty('total') || '0', 10) + weight;
    var dk = 'd_' + today_();
    var day = parseInt(pr.getProperty(dk) || '0', 10) + weight;
    pr.setProperty('total', String(total));
    pr.setProperty(dk, String(day));

    if (isEnter) {
      var vids = sheet_('vids', ['vid', 'first_seen']);
      var found = vids.getRange('A:A').createTextFinder(vid).matchEntireCell(true).findNext();
      if (!found) {
        vids.appendRow([vid, new Date()]);
        pr.setProperty('unique', String(parseInt(pr.getProperty('unique') || '0', 10) + 1));
      }
    }
    cache.put(key, String(now), 21600);
  } finally {
    lock.releaseLock();
  }
  return stats_();
}

// تطبيع البريد + التحقق الصارم
function normalizeEmail_(raw) {
  var e = String(raw || '').trim().toLowerCase();
  if (e.length < 6 || e.length > 80) return null;
  var m = e.match(/^([a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?)@([a-z0-9.-]+)$/);
  if (!m) return null;
  var local = m[1], domain = m[2];
  if (local.indexOf('..') !== -1) return null;
  if (ALLOWED_DOMAINS.indexOf(domain) === -1) return null;
  return { email: local + '@' + domain, key: (domain === 'gmail.com' || domain === 'googlemail.com') ? local.replace(/\./g, '') + '@gmail.com' : local + '@' + domain };
}

function subscribe_(p) {
  if (p.website) return { ok: true, message: 'تم اشتراكك بنجاح.' }; // فخ الروبوتات
  var n = normalizeEmail_(p.email);
  if (!n) return { ok: false, message: 'أدخل بريداً صحيحاً من مزوّد معروف (Gmail أو Outlook أو Yahoo أو iCloud…).' };

  var cache = CacheService.getScriptCache();
  var rk = 'r_' + String(p.vid || 'x').slice(0, 32);
  var tries = parseInt(cache.get(rk) || '0', 10);
  if (tries >= 4) return { ok: false, message: 'محاولات كثيرة، حاول بعد قليل.' };
  cache.put(rk, String(tries + 1), 3600);

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_('subscribers', ['date', 'email', 'key']);
    var found = sh.getRange('C:C').createTextFinder(n.key).matchEntireCell(true).findNext();
    if (found) return { ok: true, message: 'بريدك مسجّل لدينا مسبقاً. سنراسلك عند الإطلاق.' };
    sh.appendRow([new Date(), n.email, n.key]);
  } finally {
    lock.releaseLock();
  }
  try {
    MailApp.sendEmail(OWNER_EMAIL, 'مشترك جديد في شبكة المنتظر', 'مشترك جديد: ' + n.email);
  } catch (e) {}
  return { ok: true, message: 'تم اشتراكك بنجاح. سنراسلك عند الإطلاق إن شاء الله.' };
}
