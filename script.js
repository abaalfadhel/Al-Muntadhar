(function () {
  "use strict";

  var CFG = window.MN_CONFIG || {};
  var API_URL = (CFG.API_URL || "").trim();
  var BEAT_MS = Math.max(1000, Number(CFG.HEARTBEAT_SECONDS || 10) * 1000);
  var START_DATE = new Date(CFG.START_DATE || "2026-11-05T03:30:00+03:00");
  var LAUNCH_DATE = new Date(CFG.LAUNCH_DATE || "2027-02-12T03:30:00+03:00");

  var $ = function (id) { return document.getElementById(id); };
  var pad = function (n) { return String(n).padStart(2, "0"); };
  var nf = new Intl.NumberFormat("en-US");

  /* ===== الوضع الليلي / النهاري ===== */
  var root = document.documentElement;
  $("theme-toggle").addEventListener("click", function () {
    var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("mn-theme", next); } catch (e) {}
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "dark" ? "#08291f" : "#f6f1e4");
  });

  /* ===== مساعد الصور ===== */
  function watchImage(img, onFail, onOk) {
    if (img.complete) { img.naturalWidth > 0 ? onOk && onOk() : onFail && onFail(); }
    else { img.addEventListener("load", function () { onOk && onOk(); }); img.addEventListener("error", function () { onFail && onFail(); }); }
  }
  var logo = $("brand-logo"), logoFb = $("logo-fallback");
  watchImage(logo, function () { logo.hidden = true; logoFb.hidden = false; });

  /* ===== العداد التنازلي ===== */
  $("launch-date").textContent = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", { dateStyle: "long", timeZone: "Asia/Baghdad" }).format(LAUNCH_DATE);
  function tick() {
    var now = Date.now(), diff = LAUNCH_DATE - now;
    if (diff <= 0) {
      ["cd-days", "cd-hours", "cd-mins", "cd-secs"].forEach(function (id) { $(id).textContent = "00"; });
      $("cd-progress").style.width = "100%";
      return;
    }
    var s = Math.floor(diff / 1000);
    $("cd-days").textContent = String(Math.floor(s / 86400));
    $("cd-hours").textContent = pad(Math.floor((s % 86400) / 3600));
    $("cd-mins").textContent = pad(Math.floor((s % 3600) / 60));
    $("cd-secs").textContent = pad(s % 60);
    var pct = Math.min(100, Math.max(0, ((now - START_DATE) / (LAUNCH_DATE - START_DATE)) * 100));
    $("cd-progress").style.width = pct.toFixed(2) + "%";
  }
  tick();
  setInterval(tick, 1000);

  /* ===== معرّف الزائر ===== */
  function makeVid() {
    var a = new Uint8Array(8);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  var vid;
  try { vid = localStorage.getItem("mn-vid"); if (!vid || !/^[a-z0-9]{8,32}$/.test(vid)) { vid = makeVid(); localStorage.setItem("mn-vid", vid); } }
  catch (e) { vid = makeVid(); }

  function api(params) {
    var q = new URLSearchParams(params);
    return fetch(API_URL + (API_URL.indexOf("?") > -1 ? "&" : "?") + q.toString(), { cache: "no-store", redirect: "follow" })
      .then(function (r) { return r.json(); });
  }

  /* ===== البريد: تحقق صارم (يطابق الخادم) ===== */
  var ALLOWED_DOMAINS = [
    "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com",
    "live.com", "msn.com", "icloud.com", "me.com", "proton.me", "protonmail.com",
    "aol.com", "yandex.com", "mail.com", "gmx.com", "zoho.com"
  ];
  function checkEmail(raw) {
    var e = String(raw || "").trim().toLowerCase();
    if (e.length < 6 || e.length > 80) return null;
    var m = e.match(/^([a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?)@([a-z0-9.-]+)$/);
    if (!m || m[1].indexOf("..") !== -1) return null;
    if (ALLOWED_DOMAINS.indexOf(m[2]) === -1) return null;
    return e;
  }

  /* ===== الاشتراك ===== */
  var form = $("sub-form"), msg = $("sub-msg"), btn = $("sub-btn");
  function say(text, type) { msg.textContent = text; msg.className = "form-msg " + (type || ""); }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = checkEmail($("sub-email").value);
    if (!email) { say("أدخل بريداً صحيحاً من مزوّد معروف: Gmail أو Outlook أو Yahoo أو iCloud أو Proton…", "err"); return; }
    if (!API_URL) { say("خدمة الاشتراك غير مفعّلة بعد. راسلنا على البريد أدناه.", "err"); return; }
    btn.disabled = true; say("جارٍ الإرسال…");
    api({ action: "sub", email: email, vid: vid, website: form.elements.website.value })
      .then(function (j) {
        if (j && j.ok) { say(j.message, "ok"); form.reset(); }
        else { say((j && j.message) || "تعذّر الاشتراك، حاول لاحقاً.", "err"); }
      })
      .catch(function () { say("تعذّر الاتصال بالخدمة. حاول لاحقاً أو راسلنا على البريد أدناه.", "err"); })
      .finally(function () { btn.disabled = false; });
  });

  /* ===== عدّاد الزائرين: +10 عند كل دخول/تحديث، ثم +10 كل 10 ثوانٍ من البقاء الفعلي ===== */
  function setStat(id, val) {
    var el = $(id);
    if (typeof val === "number") { el.textContent = nf.format(val); el.dataset.state = "ok"; }
    else { el.textContent = "—"; el.dataset.state = "off"; }
  }
  function showStats(j) { setStat("st-total", j && j.total); setStat("st-today", j && j.today); }

  if (!API_URL) { showStats(null); }
  else {
    var hit = function (kind, beats) {
      return api({ action: "hit", kind: kind, vid: vid, beats: beats || 1 }).then(showStats).catch(function () { showStats(null); });
    };
    hit("enter");
    // Accumulate elapsed time only while visible. A wall-clock timestamp is
    // essential here: a throttled timer must never turn hidden time into a beat.
    var visibleMs = 0, lastVisibleAt = document.visibilityState === "visible" ? Date.now() : null;
    function accrueVisible(now, includeHideBoundary) {
      if (document.visibilityState !== "visible" && !includeHideBoundary) return;
      if (lastVisibleAt === null) lastVisibleAt = now;
      visibleMs += Math.max(0, now - lastVisibleAt);
      lastVisibleAt = now;
      if (visibleMs >= BEAT_MS) {
        var beats = Math.min(60, Math.floor(visibleMs / BEAT_MS));
        visibleMs %= BEAT_MS;
        hit("beat", beats);
      }
    }
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") lastVisibleAt = Date.now();
      else if (lastVisibleAt !== null) { accrueVisible(Date.now(), true); lastVisibleAt = null; }
    });
    setInterval(function () { accrueVisible(Date.now()); }, 1000);
  }

  /* ===== الوضع التجريبي: واجهة رئيسية ===== */
  var ICONS = {
    scale: "M12 4v16M7 20h10M4 8h16M6 8l-3 6a3 3 0 0 0 6 0zM18 8l-3 6a3 3 0 0 0 6 0z",
    shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
    warning: "M12 4l9 16H3zM12 10v4M12 17v.5",
    book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM6 19h13",
    users: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 2.5-5 6-5s6 2 6 5M17 11a2.5 2.5 0 1 0 0-5M16 15c3 0 5 1.8 5 4",
    heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
    ban: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM6 6l12 12",
    eyeoff: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 4l16 16",
    moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
    mosque: "M3 21V12h18v9M6 12a6 6 0 0 1 12 0M12 3v3M9 21v-4h6v4",
    bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z",
    history: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v5l3 2",
    cap: "M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5",
    star: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
    list: "M8 6h13M8 12h13M8 18h13M3 6h.5M3 12h.5M3 18h.5",
    pray: "M12 3v8M8 8l4 3 4-3M5 21c0-4 3-6 7-6s7 2 7 6",
    beads: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v8M8 12h8",
    checkuser: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 21c0-3.5 2.7-6 6-6M15 18l2.5 2.5L22 15"
  };
  var FEATURED = { t: "موسوعة الإمام المهدي (عج) الشاملة", d: "العقيدة المهدوية • الغيبة والانتظار • علامات الظهور • الروايات والأحاديث", i: "star" };
  var GROUPS = [
    { title: "البوابات الرئيسية", items: [
      ["العقائد والمناظرات", "أصول العقائد والرد على الشبهات", "scale"],
      ["شبهات وردود", "الرد على الشبهات المطروحة", "shield"],
      ["روايات ضعيفة", "روايات شيعية ضعيفة السند", "warning"],
      ["عقيدتنا من كتبهم", "استخراج العقائد من كتب المخالفين", "book"],
      ["مكتبة الحديث", "أهم الأحاديث الشريفة", "list"],
      ["الصالحين", "الصحابة العدول وأتباع أهل البيت", "users"],
      ["مظالم أهل البيت", "ظلامات المعصومين الأربعة عشر", "heart"],
      ["المخالفون الملعونون", "أعداء أهل البيت المذكورون في الروايات", "ban"],
      ["التجسيم عند المخالفين", "روايات التجسيم في كتب السنة", "eyeoff"]
    ]},
    { title: "لشيعتنا (العبادات والسلوك)", items: [
      ["الصلوات", "تعليم الصلاة وأنواعها", "pray"],
      ["الأدعية", "مجموعة الأدعية المأثورة", "beads"],
      ["الزيارات", "زيارات المعصومين الأربعة عشر", "mosque"],
      ["الأذكار والمناجاات", "الأذكار والمناجاات المأثورة", "moon"],
      ["الأحاديث", "أحاديث أهل البيت عليهم السلام", "book"],
      ["نور الأئمة", "سيرة المعصومين الأربعة عشر", "bulb"],
      ["سيرة أهل البيت", "سيرة كاملة للمعصومين", "history"],
      ["النجاة من الجهل", "كيفية التخلص من الجهل", "cap"],
      ["أخلاق النبي وآله", "أخلاق وسيرة المعصومين", "heart"],
      ["قصص أهل البيت", "قصص وحكايات عن المعصومين", "book"],
      ["الاتباع الصحيح", "كيف نتبع أهل البيت", "checkuser"]
    ]},
    { title: "أدوات الباحث", items: [
      ["البحث المتقدم", "بحث في العناوين والنصوص", "search"],
      ["الفهرس الموضوعي", "تصفح المواضيع بالترتيب", "list"],
      ["المصادر والمراجع", "قائمة الكتب والمصادر", "book"],
      ["المفضلة", "موادك المحفوظة", "star"]
    ]}
  ];

  var toast = $("toast"), toastTimer;
  function showToast(name) {
    toast.innerHTML = "";
    var b = document.createElement("b"); b.textContent = "«" + name + "»";
    var s = document.createElement("span"); s.textContent = "هذا وضع تجريبي والموقع قيد التطوير. سيتوفر هذا القسم عند الإطلاق.";
    toast.appendChild(b); toast.appendChild(s);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 3200);
  }
  function icon(name) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", ICONS[name] || ICONS.star); svg.appendChild(p);
    return svg;
  }
  function tile(t, d, i, cls) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "tile " + (cls || "");
    var ic = document.createElement("span"); ic.className = "tile-ic"; ic.appendChild(icon(i));
    var tx = document.createElement("span"); tx.className = "tile-tx";
    var h = document.createElement("strong"); h.textContent = t;
    var p = document.createElement("small"); p.textContent = d;
    tx.appendChild(h); tx.appendChild(p);
    b.appendChild(ic); b.appendChild(tx);
    b.addEventListener("click", function () { showToast(t); });
    return b;
  }
  var portal = $("portal");
  portal.appendChild(tile(FEATURED.t, FEATURED.d, FEATURED.i, "tile-featured"));
  GROUPS.forEach(function (g) {
    var sec = document.createElement("section"); sec.className = "portal-group";
    var h = document.createElement("h3"); h.textContent = g.title; sec.appendChild(h);
    var grid = document.createElement("div"); grid.className = "tile-grid";
    g.items.forEach(function (it) { grid.appendChild(tile(it[0], it[1], it[2])); });
    sec.appendChild(grid); portal.appendChild(sec);
  });

  var navBtns = document.querySelectorAll(".site-nav button");
  navBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      navBtns.forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      if (b.getAttribute("data-sec") !== "الرئيسية") showToast(b.getAttribute("data-sec"));
    });
  });

  var demo = $("demo"), openBtn = $("demo-open"), closeBtn = $("demo-close");
  var headFb = $("head-fallback");
  ["head-img", "head-brand"].forEach(function (id) {
    var im = $(id);
    watchImage(im, null, function () { im.hidden = false; headFb.hidden = true; });
  });
  function openDemo() { demo.hidden = false; document.body.style.overflow = "hidden"; closeBtn.focus(); }
  function closeDemo() { demo.hidden = true; document.body.style.overflow = ""; openBtn.focus(); }
  openBtn.addEventListener("click", openDemo);
  closeBtn.addEventListener("click", closeDemo);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !demo.hidden) closeDemo(); });
})();
