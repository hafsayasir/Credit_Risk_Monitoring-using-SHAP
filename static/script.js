(() => {
  "use strict";

  const API_URL = "/predict";
  const SVG_NS = "http://www.w3.org/2000/svg";

  // Ring geometry (must match the SVG viewBox in index.html)
  const CX = 100, CY = 100, R = 78;
  const ARC_LEN = 2 * Math.PI * R;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ANIM_MS = reducedMotion ? 0 : 1200;

  const $ = (id) => document.getElementById(id);
  const form = $("loan-form");
  const panel = $("panel");
  const arc = $("arc");
  const track = $("track");
  const mark = $("mark");
  const valueEl = $("value");
  const verdictEl = $("verdict");
  const detailEl = $("verdict-detail");
  const factProb = $("fact-prob");
  const factThreshold = $("fact-threshold");
  const factVerdict = $("fact-verdict");
  const submitBtn = $("submit-btn");
  const exampleBtn = $("example-btn");
  const shareEl = $("loan_share");

  /* ---------------- field rules ---------------- */
  const FIELDS = {
    person_age:                 { label: "age",                    kind: "int",   min: 18, max: 100 },
    person_income:              { label: "annual income",          kind: "float", min: 1 },
    person_emp_length:          { label: "employment length",      kind: "float", min: 0, max: 60 },
    person_home_ownership:      { label: "home ownership",         kind: "select" },
    loan_intent:                { label: "loan purpose",           kind: "select" },
    loan_grade:                 { label: "loan grade",             kind: "select" },
    loan_amnt:                  { label: "loan amount",            kind: "float", min: 1 },
    loan_int_rate:              { label: "interest rate",          kind: "float", min: 0, max: 40 },
    cb_person_cred_hist_length: { label: "credit history length",  kind: "int",   min: 0, max: 60 },
  };

  const EXAMPLES = [
    { person_age: 29, person_income: 58000, person_emp_length: 5, person_home_ownership: "MORTGAGE",
      loan_intent: "EDUCATION", loan_grade: "B", loan_amnt: 9000, loan_int_rate: 10.9,
      cb_person_default_on_file: "N", cb_person_cred_hist_length: 6 },
    { person_age: 23, person_income: 24000, person_emp_length: 1, person_home_ownership: "RENT",
      loan_intent: "MEDICAL", loan_grade: "E", loan_amnt: 15000, loan_int_rate: 17.8,
      cb_person_default_on_file: "Y", cb_person_cred_hist_length: 2 },
  ];
  let exampleIndex = 0;

  /* ---------------- gauge setup ---------------- */
  // p = 0..1, measured clockwise from the top of the ring
  function polar(p, r) {
    const a = 2 * Math.PI * p;
    return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
  }

  function buildGauge() {
    const d = `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX} ${CY + R} A ${R} ${R} 0 1 1 ${CX} ${CY - R}`;
    track.setAttribute("d", d);
    arc.setAttribute("d", d);
    track.style.strokeDasharray = ARC_LEN;
    arc.style.strokeDasharray = ARC_LEN;
    arc.style.strokeDashoffset = ARC_LEN;
  }

  /* ---------------- gauge state ---------------- */
  let shownPercent = 0;
  let countFrame = null;

  function setArc(p) {
    arc.style.strokeDashoffset = ARC_LEN * (1 - Math.min(Math.max(p, 0), 1));
  }

  function setMark(t) {
    const [x1, y1] = polar(t, R - 12);
    const [x2, y2] = polar(t, R + 12);
    mark.setAttribute("x1", x1);
    mark.setAttribute("y1", y1);
    mark.setAttribute("x2", x2);
    mark.setAttribute("y2", y2);
    mark.setAttribute("opacity", "1");
  }

  function countTo(target) {
    cancelAnimationFrame(countFrame);
    const from = shownPercent;
    if (ANIM_MS === 0) {
      shownPercent = target;
      valueEl.textContent = target.toFixed(1);
      return;
    }
    const start = performance.now();
    const tick = (now) => {
      const k = Math.min((now - start) / ANIM_MS, 1);
      const eased = 1 - Math.pow(1 - k, 3);
      shownPercent = from + (target - from) * eased;
      valueEl.textContent = shownPercent.toFixed(1);
      if (k < 1) countFrame = requestAnimationFrame(tick);
    };
    countFrame = requestAnimationFrame(tick);
  }

  function resetGauge() {
    cancelAnimationFrame(countFrame);
    shownPercent = 0;
    setArc(0);
    mark.setAttribute("opacity", "0");
    valueEl.textContent = "\u2013";
    factProb.textContent = "\u2013";
    factThreshold.textContent = "\u2013";
    factVerdict.textContent = "\u2013";
  }

  function replayPulse(el) {
    el.classList.remove("pulse");
    void el.offsetWidth;
    el.classList.add("pulse");
  }

  function setPanel(state, verdict, detail) {
    panel.classList.remove("is-idle", "is-low", "is-high", "is-error", "has-result");
    panel.classList.add(state);
    if (state === "is-low" || state === "is-high") panel.classList.add("has-result");
    verdictEl.textContent = verdict;
    detailEl.textContent = detail;
    replayPulse(verdictEl);
    replayPulse(detailEl);
  }

  /* ---------------- loan share (calculated) ---------------- */
  function loanShare() {
    const income = parseFloat($("person_income").value);
    const amount = parseFloat($("loan_amnt").value);
    if (!(income > 0) || !(amount > 0)) return null;
    return Math.round((amount / income) * 100) / 100;
  }

  function updateShare() {
    const s = loanShare();
    if (s === null) {
      shareEl.value = "Calculated from income and loan amount";
      shareEl.classList.remove("has-value");
    } else {
      shareEl.value = Math.round(s * 100) + "% of annual income";
      shareEl.classList.add("has-value");
    }
  }

  /* ---------------- validation ---------------- */
  function fieldWrap(name) {
    return $(name).closest(".field");
  }

  function setError(name, message) {
    const wrap = fieldWrap(name);
    const err = $("err-" + name);
    if (message) {
      wrap.classList.add("invalid");
      $(name).setAttribute("aria-invalid", "true");
      err.textContent = message;
    } else {
      wrap.classList.remove("invalid");
      $(name).removeAttribute("aria-invalid");
      err.textContent = "";
    }
  }

  function validateField(name) {
    const rule = FIELDS[name];
    const el = $(name);
    const raw = el.value.trim();

    if (raw === "") {
      setError(name, rule.kind === "select" ? "Select an option." : `Enter the ${rule.label}.`);
      return false;
    }
    if (rule.kind !== "select") {
      const n = Number(raw);
      if (!Number.isFinite(n)) { setError(name, "Enter a number."); return false; }
      if (rule.kind === "int" && !Number.isInteger(n)) { setError(name, "Enter a whole number."); return false; }
      if (rule.min !== undefined && n < rule.min) {
        setError(name, rule.max !== undefined ? `Enter a value between ${rule.min} and ${rule.max}.` : `Enter a value of at least ${rule.min}.`);
        return false;
      }
      if (rule.max !== undefined && n > rule.max) {
        setError(name, `Enter a value between ${rule.min} and ${rule.max}.`);
        return false;
      }
    }
    setError(name, "");
    return true;
  }

  function validateAll() {
    let firstInvalid = null;
    for (const name of Object.keys(FIELDS)) {
      if (!validateField(name) && !firstInvalid) firstInvalid = name;
    }
    // employment cannot be longer than the applicant's life
    if (!firstInvalid) {
      const age = Number($("person_age").value);
      const emp = Number($("person_emp_length").value);
      if (emp > age) {
        setError("person_emp_length", "Employment length can't be greater than age.");
        firstInvalid = "person_emp_length";
      }
    }
    if (firstInvalid) $(firstInvalid).focus();
    return !firstInvalid;
  }

  /* ---------------- payload + request ---------------- */
  function buildPayload() {
    const num = (id) => Number($(id).value);
    return {
      person_age: num("person_age"),
      person_income: num("person_income"),
      person_home_ownership: $("person_home_ownership").value,
      person_emp_length: num("person_emp_length"),
      loan_intent: $("loan_intent").value,
      loan_grade: $("loan_grade").value,
      loan_amnt: num("loan_amnt"),
      loan_int_rate: num("loan_int_rate"),
      loan_percent_income: loanShare(),
      cb_person_default_on_file: form.elements["cb_person_default_on_file"].value,
      cb_person_cred_hist_length: num("cb_person_cred_hist_length"),
    };
  }

  function describeError(status, body) {
    if (status === 422 && body && Array.isArray(body.detail)) {
      const names = body.detail
        .map((d) => (Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : null))
        .filter(Boolean);
      if (names.length) return `The server rejected these fields: ${[...new Set(names)].join(", ")}.`;
    }
    return "The server returned an error. Try again in a moment.";
  }

  async function assess() {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 90000);
    const wakeTimer = setTimeout(() => {
      detailEl.textContent = "Still working. The server may be waking up, which can take up to a minute.";
    }, 5000);

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
        signal: controller.signal,
      });

      let body = null;
      try { body = await res.json(); } catch (_) { /* non-JSON response */ }

      if (!res.ok) {
        resetGauge();
        setPanel("is-error", "Assessment unavailable", describeError(res.status, body));
        return;
      }
      showResult(body);
    } catch (err) {
      resetGauge();
      const aborted = err && err.name === "AbortError";
      setPanel(
        "is-error",
        "Assessment unavailable",
        aborted
          ? "The request timed out. Try again in a moment."
          : "Couldn't reach the model. Check your connection and try again."
      );
    } finally {
      clearTimeout(abortTimer);
      clearTimeout(wakeTimer);
    }
  }

  function showResult(data) {
    const p = Number(data["Default probability"]);
    const t = Number(data["Threshold"]);
    const high = Number(data["Default prediction"]) === 1;

    if (!Number.isFinite(p) || !Number.isFinite(t)) {
      resetGauge();
      setPanel("is-error", "Assessment unavailable", "The server sent a response the page couldn't read.");
      return;
    }

    setPanel(
      high ? "is-high" : "is-low",
      high ? "High risk" : "Low risk",
      high
        ? "The chance of default is higher than usual, so this application needs a closer look."
        : "The chance of default is within the usual range, so this application looks fine to proceed."
    );

    factProb.textContent = (p * 100).toFixed(1) + "%";
    factThreshold.textContent = (t * 100).toFixed(1) + "%";
    factVerdict.textContent = high ? "High risk" : "Low risk";

    setMark(t);
    setArc(p);
    countTo(p * 100);

    if (window.matchMedia("(max-width: 900px)").matches) {
      panel.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    }
  }

  /* ---------------- events ---------------- */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitBtn.getAttribute("aria-busy") === "true") return;
    if (!validateAll()) return;

    submitBtn.setAttribute("aria-busy", "true");
    panel.setAttribute("aria-busy", "true");
    submitBtn.disabled = false; // stays focusable; clicks are ignored while busy
    await assess();
    submitBtn.removeAttribute("aria-busy");
    panel.setAttribute("aria-busy", "false");
  });

  form.addEventListener("input", (e) => {
    const name = e.target.name || e.target.id;
    if (FIELDS[name] && fieldWrap(name).classList.contains("invalid")) setError(name, "");
    if (name === "person_income" || name === "loan_amnt") updateShare();
  });

  exampleBtn.addEventListener("click", () => {
    const ex = EXAMPLES[exampleIndex % EXAMPLES.length];
    exampleIndex += 1;
    for (const [name, value] of Object.entries(ex)) {
      if (name === "cb_person_default_on_file") {
        form.elements[name].value = value;
      } else {
        $(name).value = value;
        setError(name, "");
      }
    }
    updateShare();
  });

  buildGauge();
  updateShare();
})();