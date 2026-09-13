/**
 * BuddySite helper orb — cute round two-eye character.
 * Inspired by the simple black-sphere + two-eyes language of modern AI mascots.
 * Original BuddySite character (not a brand clone).
 */
(function () {
  if (window.__buddyHelpBotLoaded) return;
  window.__buddyHelpBotLoaded = true;

  const FAQS = [
    "What is a slide product / sliding section?",
    "What are hero slides?",
    "What are category sections?",
    "How do I add a product?",
    "How does commission work?",
    "How do I publish my store?",
  ];

  const style = document.createElement("style");
  style.textContent = `
  .bbot-wrap{
    position:fixed;z-index:80;width:58px;height:58px;
    transition:left .9s cubic-bezier(.22,.8,.28,1), top .9s cubic-bezier(.22,.8,.28,1);
    pointer-events:none;
  }
  .bbot-wrap *{pointer-events:auto;}
  .bbot-hit{
    width:58px;height:58px;display:flex;align-items:center;justify-content:center;
    border:0;padding:0;position:relative;cursor:pointer;
    background:#161616;border-radius:18px;
    box-shadow:0 8px 20px rgba(0,0,0,.28);
  }
  .bbot-svg{width:58px;height:58px;display:block;overflow:visible;}
  .bbot-tip{
    position:absolute;top:50%;transform:translateY(-50%);
    background:#0a0a0a;color:#fff;font:600 11px/1.3 Inter,system-ui,sans-serif;
    padding:7px 10px;border-radius:12px;white-space:nowrap;
    opacity:0;pointer-events:none;transition:opacity .18s;
    box-shadow:0 10px 28px rgba(0,0,0,.28);
    right:68px;
  }
  .bbot-tip:after{
    content:"";position:absolute;right:-6px;top:50%;margin-top:-6px;
    border:6px solid transparent;border-left-color:#0a0a0a;
  }
  .bbot-wrap:hover .bbot-tip{opacity:1;}
  .bbot-tip.flip{right:auto;left:68px;}
  .bbot-tip.flip:after{right:auto;left:-6px;border-left-color:transparent;border-right-color:#0a0a0a;}

  .bbot-panel{
    position:fixed;top:0;right:0;width:min(380px,100vw);height:100vh;
    background:#fff;z-index:90;box-shadow:-12px 0 40px rgba(0,0,0,.14);
    display:flex;flex-direction:column;transform:translateX(105%);
    transition:transform .32s cubic-bezier(.22,.8,.28,1);
    font-family:Inter,system-ui,sans-serif;color:#111;
  }
  .bbot-panel.open{transform:translateX(0);}
  .bbot-panel-head{
    padding:16px 18px;background:#0a0a0a;color:#fff;
    display:flex;align-items:center;justify-content:space-between;gap:10px;
  }
  .bbot-panel-head strong{font-size:1rem;}
  .bbot-panel-head button{
    background:rgba(255,255,255,.12);border:0;color:#fff;width:32px;height:32px;
    border-radius:10px;cursor:pointer;font-size:1.2rem;line-height:1;
  }
  .bbot-faqs{padding:14px 16px 10px;border-bottom:1px solid #ececec;background:#fafafa;}
  .bbot-faqs-title{font-size:.7rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;}
  .bbot-faq-btn{
    display:block;width:100%;text-align:left;background:#fff;border:1px solid #ececec;
    border-radius:12px;padding:9px 12px;margin-bottom:6px;cursor:pointer;
    font-size:.85rem;color:#222;font-family:inherit;
  }
  .bbot-faq-btn:hover{border-color:#111;background:#f6f6f6;}
  .bbot-msgs{flex:1;overflow-y:auto;padding:14px;background:#f7f7f8;display:flex;flex-direction:column;gap:10px;}
  .bbot-m{max-width:88%;padding:10px 12px;border-radius:16px;font-size:.9rem;line-height:1.45;white-space:pre-wrap;}
  .bbot-m.bot{background:#fff;border:1px solid #ececec;align-self:flex-start;}
  .bbot-m.user{background:#0a0a0a;color:#fff;align-self:flex-end;}
  .bbot-input{display:flex;gap:8px;padding:12px;border-top:1px solid #ececec;background:#fff;}
  .bbot-input input{
    flex:1;border:1.5px solid #e5e5e5;border-radius:999px;padding:10px 14px;
    font-size:.95rem;font-family:inherit;outline:none;
  }
  .bbot-input input:focus{border-color:#111;}
  .bbot-input button{
    border:0;border-radius:999px;padding:10px 16px;background:#0a0a0a;color:#fff;
    font-weight:600;cursor:pointer;font-family:inherit;
  }
  .bbot-input button:disabled{opacity:.45;cursor:not-allowed;}
  .bbot-feedback{
    position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.45);
    display:none;align-items:center;justify-content:center;padding:20px;
    font-family:Inter,system-ui,sans-serif;
  }
  .bbot-feedback.open{display:flex;}
  .bbot-feedback-card{
    background:#fff;border-radius:22px;padding:28px 24px;max-width:360px;width:100%;
    text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.25);
  }
  .bbot-stars{display:flex;gap:8px;justify-content:center;margin:16px 0 12px;}
  .bbot-star{font-size:1.8rem;cursor:pointer;opacity:.28;border:0;background:none;padding:0;line-height:1;}
  .bbot-star.on{opacity:1;}
  .bbot-feedback-card textarea{
    width:100%;min-height:70px;border:1.5px solid #e5e5e5;border-radius:12px;
    padding:10px;font-family:inherit;margin-bottom:12px;resize:vertical;
  }
  .bbot-feedback-actions{display:flex;gap:8px;justify-content:center;}
  .bbot-feedback-actions button{
    border-radius:999px;padding:10px 18px;font-weight:600;cursor:pointer;font-family:inherit;
    border:1.5px solid #e5e5e5;background:#fff;
  }
  .bbot-feedback-actions .primary{background:#0a0a0a;color:#fff;border-color:#0a0a0a;}
  `;
  document.head.appendChild(style);

  const wrap = document.createElement("div");
  wrap.className = "bbot-wrap";
  wrap.innerHTML = `
    <div class="bbot-tip">Click on me to ask anything!</div>
    <button type="button" class="bbot-hit" id="bbotHit" aria-label="Open BuddySite helper">
      <svg class="bbot-svg" viewBox="0 0 100 100" aria-hidden="true">
        <g id="bbotBody">
          <circle id="bbotOrb" cx="50" cy="50" r="34" fill="#f7f7f7"/>
          <g id="bbotSpecs" style="display:none">
            <ellipse cx="39" cy="50" rx="11" ry="10" fill="none" stroke="#111" stroke-width="2.4"/>
            <ellipse cx="61" cy="50" rx="11" ry="10" fill="none" stroke="#111" stroke-width="2.4"/>
            <path d="M49 50 H51" stroke="#111" stroke-width="2.4" stroke-linecap="round"/>
          </g>
          <g id="bbotEyes">
            <ellipse class="ew" id="bbotEyeL" cx="39" cy="50" rx="6" ry="11" fill="#111"/>
            <ellipse class="ew" id="bbotEyeR" cx="61" cy="50" rx="6" ry="11" fill="#111"/>
          </g>
          <path id="bbotMouth" d="" fill="#111" opacity="0"/>
        </g>
      </svg>
    </button>`;
  document.body.appendChild(wrap);

  const panel = document.createElement("div");
  panel.className = "bbot-panel";
  panel.innerHTML = `
    <div class="bbot-panel-head">
      <strong>BuddySite Helper</strong>
      <button type="button" id="bbotClose" aria-label="Close">×</button>
    </div>
    <div class="bbot-faqs">
      <div class="bbot-faqs-title">Frequently asked</div>
      ${FAQS.map((q) => `<button type="button" class="bbot-faq-btn">${q}</button>`).join("")}
    </div>
    <div class="bbot-msgs" id="bbotMsgs"></div>
    <div class="bbot-input">
      <input id="bbotInput" type="text" maxlength="500" placeholder="Ask anything about BuddySite…"/>
      <button type="button" id="bbotSend">Send</button>
    </div>`;
  document.body.appendChild(panel);

  const feedback = document.createElement("div");
  feedback.className = "bbot-feedback";
  feedback.innerHTML = `
    <div class="bbot-feedback-card">
      <h3 style="margin:0 0 6px;font-size:1.15rem;">How was the help?</h3>
      <p style="margin:0;color:#666;font-size:.9rem;">Rate BuddySite Helper</p>
      <div class="bbot-stars" id="bbotStars">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="bbot-star" data-n="${n}">★</button>`).join("")}
      </div>
      <textarea id="bbotFbNote" placeholder="Optional comment…"></textarea>
      <div class="bbot-feedback-actions">
        <button type="button" id="bbotFbSkip">Skip</button>
        <button type="button" class="primary" id="bbotFbSend">Submit</button>
      </div>
    </div>`;
  document.body.appendChild(feedback);

  const tip = wrap.querySelector(".bbot-tip");
  const hit = wrap.querySelector("#bbotHit");
  const body = wrap.querySelector("#bbotBody");
  const orb = wrap.querySelector("#bbotOrb");
  const eyes = wrap.querySelector("#bbotEyes");
  const eyeL = wrap.querySelector("#bbotEyeL");
  const eyeR = wrap.querySelector("#bbotEyeR");
  const specs = wrap.querySelector("#bbotSpecs");
  const mouth = wrap.querySelector("#bbotMouth");
  const msgsEl = panel.querySelector("#bbotMsgs");
  const input = panel.querySelector("#bbotInput");
  const sendBtn = panel.querySelector("#bbotSend");

  const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, movedAt: 0 };
  let look = { x: 0, y: 0 };
  let mood = "idle";
  let moodUntil = 0;
  let blink = 1;
  let blinkT = 0;
  let nextBlink = 1800 + Math.random() * 2200;
  let wanderT = 0;
  let chatUsed = false;
  let starRating = 0;
  let panelOpen = false;

  document.addEventListener(
    "mousemove",
    (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.movedAt = performance.now();
    },
    { passive: true }
  );

  function setMood(next, ms) {
    mood = next;
    moodUntil = ms ? performance.now() + ms : 0;
    specs.style.display = next === "specs" ? "block" : "none";
  }

  function addMsg(text, who) {
    const d = document.createElement("div");
    d.className = "bbot-m " + who;
    d.textContent = text;
    msgsEl.appendChild(d);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  addMsg("Hi! I’m your BuddySite helper. Pick a question or type your own.", "bot");

  function tick(now) {
    if (moodUntil && now > moodUntil && mood !== "idle") setMood("idle");

    const bob = Math.sin(now / 650) * 1.4;
    const breath = 1 + Math.sin(now / 900) * 0.02;
    let squashX = 1;
    let squashY = 1;
    let rot = 0;

    if (mood === "happy" || mood === "open") {
      const p = Math.max(0, 1 - (moodUntil - now) / 900);
      squashX = 1 + Math.sin(p * Math.PI) * 0.08;
      squashY = 1 - Math.sin(p * Math.PI) * 0.06;
    }
    if (mood === "wave") rot = Math.sin(now / 90) * 10;
    if (mood === "think" || mood === "specs") rot = Math.sin(now / 380) * 6;

    body.setAttribute(
      "transform",
      `translate(50 ${52 + bob}) scale(${breath * squashX} ${breath * squashY}) rotate(${rot}) translate(-50 -52)`
    );

    // blink
    blinkT += 16;
    if (blinkT > nextBlink) {
      blink = Math.max(0.08, 1 - (blinkT - nextBlink) / 80);
      if (blinkT > nextBlink + 160) {
        blink = 1;
        blinkT = 0;
        nextBlink = 2800 + Math.random() * 3200;
      }
    }

    // Look at the real cursor from the orb's center (all 4 directions)
    const box = wrap.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const idle = now - mouse.movedAt > 1400;
    wanderT += 0.016;
    const wx = idle ? Math.sin(wanderT * 0.6) * 2.2 : 0;
    const wy = idle ? Math.cos(wanderT * 0.45) * 1.6 : 0;
    const tx = Math.max(-9, Math.min(9, (mouse.x - cx) / 14 + wx));
    const ty = Math.max(-9, Math.min(9, (mouse.y - cy) / 14 + wy));
    look.x += (tx - look.x) * 0.28;
    look.y += (ty - look.y) * 0.28;
    eyes.setAttribute("transform", `translate(${look.x} ${look.y})`);

    const happySquint = mood === "happy" ? 0.45 : 1;
    const lid = blink * happySquint;
    eyeL.setAttribute("ry", String(11 * lid));
    eyeR.setAttribute("ry", String(11 * lid));
    if (mood === "think" || mood === "specs") {
      eyeL.setAttribute("ry", String(7 * lid));
      eyeR.setAttribute("ry", String(7 * lid));
    }

    if (mood === "open") {
      mouth.setAttribute("d", "M44 68 Q50 76 56 68 Q50 72 44 68");
      mouth.setAttribute("opacity", "1");
      mouth.setAttribute("fill", "#111");
      mouth.removeAttribute("stroke");
    } else if (mood === "happy" || mood === "smile") {
      mouth.setAttribute("d", "M42 66 Q50 74 58 66");
      mouth.setAttribute("opacity", "1");
      mouth.setAttribute("fill", "none");
      mouth.setAttribute("stroke", "#111");
      mouth.setAttribute("stroke-width", "2.4");
      mouth.setAttribute("stroke-linecap", "round");
    } else {
      mouth.setAttribute("opacity", "0");
      mouth.removeAttribute("stroke");
      mouth.setAttribute("fill", "#111");
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // roam corners
  let spot = 0;
  function roam() {
    if (panelOpen) return;
    const pad = 16;
    const w = 58;
    const h = 58;
    const spots = [
      { left: pad, top: pad + 54 },
      { left: window.innerWidth - w - pad, top: pad + 54 },
      { left: window.innerWidth - w - pad, top: window.innerHeight - h - pad },
      { left: pad, top: window.innerHeight - h - pad },
    ];
    spot = (spot + 1) % spots.length;
    const s = spots[spot];
    wrap.style.left = s.left + "px";
    wrap.style.top = s.top + "px";
    if (s.left < 120) tip.classList.add("flip");
    else tip.classList.remove("flip");
  }
  wrap.style.left = "16px";
  wrap.style.top = window.innerHeight - 86 + "px";
  setTimeout(roam, 400);
  setInterval(roam, 6400);
  window.addEventListener("resize", roam);

  function detect(target) {
    if (!target || !target.closest) return;
    const t = target.closest("button, a, .btn, [data-action]");
    if (!t) return;
    const text = (
      (t.textContent || "") +
      " " +
      (t.id || "") +
      " " +
      (t.className || "")
    ).toLowerCase();
    if (/add product|new product|\+ product|create product/.test(text)) setMood("open", 2200);
    else if (/edit|update product|manage product/.test(text)) setMood("specs", 2800);
    else if (/order|refund|cancel/.test(text)) setMood("think", 1800);
    else if (/publish|coupon|new store|create store/.test(text)) setMood("happy", 1800);
    else if (/finance|commission|payout/.test(text)) setMood("specs", 2000);
    else if (/delete|remove/.test(text)) setMood("think", 1400);
  }
  document.addEventListener("click", (e) => detect(e.target), true);

  hit.addEventListener("click", () => {
    panelOpen = true;
    panel.classList.add("open");
    setMood("wave", 900);
    input.focus();
  });

  function closePanel() {
    panel.classList.remove("open");
    panelOpen = false;
    if (chatUsed) {
      starRating = 0;
      feedback.querySelectorAll(".bbot-star").forEach((s) => s.classList.remove("on"));
      feedback.querySelector("#bbotFbNote").value = "";
      feedback.classList.add("open");
    }
    setMood("idle");
  }
  panel.querySelector("#bbotClose").addEventListener("click", closePanel);

  async function ask(text) {
    const q = (text || "").trim();
    if (!q) return;
    chatUsed = true;
    addMsg(q, "user");
    sendBtn.disabled = true;
    setMood("think", 1600);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/help/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: JSON.stringify({ message: q }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not get an answer.");
      addMsg(data.answer || "I could not answer that.", "bot");
      setMood("happy", 1600);
    } catch (e) {
      addMsg(e.message || "Something went wrong.", "bot");
      setMood("idle");
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener("click", () => {
    const t = input.value;
    input.value = "";
    ask(t);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const t = input.value;
      input.value = "";
      ask(t);
    }
  });
  panel.querySelectorAll(".bbot-faq-btn").forEach((b) => b.addEventListener("click", () => ask(b.textContent)));

  feedback.querySelectorAll(".bbot-star").forEach((btn) => {
    btn.addEventListener("click", () => {
      starRating = Number(btn.dataset.n);
      feedback.querySelectorAll(".bbot-star").forEach((s) => {
        s.classList.toggle("on", Number(s.dataset.n) <= starRating);
      });
    });
  });

  async function submitFb(skip) {
    const note = feedback.querySelector("#bbotFbNote").value.trim();
    feedback.classList.remove("open");
    chatUsed = false;
    if (!skip && starRating > 0) {
      try {
        const token = localStorage.getItem("token");
        await fetch("/api/help/feedback", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: "Bearer " + token } : {}),
          },
          body: JSON.stringify({ rating: starRating, comment: note }),
        });
      } catch (_) {}
      setMood("happy", 1400);
    }
  }
  feedback.querySelector("#bbotFbSend").addEventListener("click", () => submitFb(false));
  feedback.querySelector("#bbotFbSkip").addEventListener("click", () => submitFb(true));
})();
