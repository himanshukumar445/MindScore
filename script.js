"use strict";

/* ---------- Config ---------- */
const API_BASE_URL = "https://mindscore-1-j6wd.onrender.com";
const PREDICT_ENDPOINT = `${API_BASE_URL}/predict`;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_SCORE = 10;            // Scale used for the gauge; change if your model uses another range.
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 54;

/* ---------- Elements ---------- */
const form = document.getElementById("predict-form");
const submitBtn = document.getElementById("submit-btn");
const resultCard = document.getElementById("result");
const gaugeFill = document.getElementById("gauge-fill");
const scoreEl = document.getElementById("score");
const verdictEl = document.getElementById("verdict");
const verdictTextEl = document.getElementById("verdict-text");
const errorTitleEl = document.getElementById("error-title");
const errorTextEl = document.getElementById("error-text");
const errorListEl = document.getElementById("error-list");
const retryBtn = document.getElementById("retry-btn");

document.getElementById("max-score").textContent = MAX_SCORE;

const INTEGER_FIELDS = ["Age", "Daily_Unlocks"];
const FLOAT_FIELDS = ["Avg_Daily_Usage_Hours", "Study_Hours", "Physical_Activity_Hours", "Sleep_Hours_Per_Night"];
const FIELD_LABELS = {
  Age: "Age",
  Gender: "Gender",
  Country: "Country",
  Academic_Level: "Academic level",
  Most_Used_Platform: "Most used platform",
  Purpose_Of_Use: "Main purpose",
  Avg_Daily_Usage_Hours: "Daily usage",
  Daily_Unlocks: "Phone unlocks",
  Study_Hours: "Study hours",
  Physical_Activity_Hours: "Physical activity",
  Sleep_Hours_Per_Night: "Sleep per night",
  stress_level: "Stress level",
};

/* ---------- UI state ---------- */
function setState(state) {
  resultCard.dataset.state = state;
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.classList.toggle("is-loading", isLoading);
  submitBtn.querySelector(".btn-text").textContent = isLoading ? "Predicting…" : "Predict my score";
}

function showError(title, text, details = []) {
  errorTitleEl.textContent = title;
  errorTextEl.textContent = text;
  errorListEl.innerHTML = "";
  details.forEach((msg) => {
    const li = document.createElement("li");
    li.textContent = msg;
    errorListEl.appendChild(li);
  });
  setState("error");
  revealResult();
}

function revealResult() {
  // On small screens the result sits above the form; bring it into view.
  if (window.matchMedia("(max-width: 960px)").matches) {
    resultCard.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

/* ---------- Field errors ---------- */
function fieldWrapper(name) {
  const errorSlot = form.querySelector(`[data-error-for="${name}"]`);
  return errorSlot ? errorSlot.closest(".field") : null;
}

function setFieldError(name, message) {
  const wrapper = fieldWrapper(name);
  if (!wrapper) return;
  wrapper.classList.add("invalid");
  wrapper.querySelector(".error").textContent = message;
}

function clearFieldError(name) {
  const wrapper = fieldWrapper(name);
  if (!wrapper) return;
  wrapper.classList.remove("invalid");
  wrapper.querySelector(".error").textContent = "";
}

function clearAllFieldErrors() {
  form.querySelectorAll("[data-error-for]").forEach((el) => clearFieldError(el.dataset.errorFor));
}

/* ---------- Client-side validation ---------- */
function validateField(name) {
  const inputs = form.querySelectorAll(`[name="${name}"]`);
  const first = inputs[0];
  let message = "";

  if (first.type === "radio") {
    if (![...inputs].some((r) => r.checked)) message = "Choose an option";
  } else {
    const v = first.validity;
    if (v.valueMissing) message = first.tagName === "SELECT" ? "Choose an option" : "Enter a value";
    else if (v.badInput) message = "Enter a valid number";
    else if (v.rangeUnderflow) message = `Must be at least ${first.min}`;
    else if (v.rangeOverflow) message = `Must be ${first.max} or less`;
    else if (v.stepMismatch) message = "Enter a whole number";
  }

  if (message) setFieldError(name, message);
  else clearFieldError(name);
  return message;
}

function validateForm() {
  const names = [...new Set([...form.elements].filter((el) => el.name).map((el) => el.name))];
  const errors = names.map((n) => [n, validateField(n)]).filter(([, msg]) => msg);
  if (errors.length) {
    const firstEl = form.querySelector(`[name="${errors[0][0]}"]`);
    firstEl.focus({ preventScroll: false });
  }
  return errors;
}

/* ---------- Payload ---------- */
function buildPayload() {
  const data = new FormData(form);
  const payload = {};
  for (const [key, value] of data.entries()) {
    if (INTEGER_FIELDS.includes(key)) payload[key] = parseInt(value, 10);
    else if (FLOAT_FIELDS.includes(key)) payload[key] = parseFloat(value);
    else payload[key] = value;
  }
  return payload;
}

/* ---------- API ---------- */
async function requestPrediction(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(PREDICT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    let body = null;
    try { body = await response.json(); } catch (_) { /* non-JSON response */ }

    if (!response.ok) {
      const err = new Error("API error");
      err.status = response.status;
      err.body = body;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/* FastAPI 422 -> [{ loc: ["body", "Age"], msg: "..." }] */
function handleValidationErrors(detail) {
  const lines = [];
  (Array.isArray(detail) ? detail : []).forEach((item) => {
    const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : null;
    const label = FIELD_LABELS[field] || field || "Input";
    const msg = item.msg || "Invalid value";
    if (field && form.querySelector(`[data-error-for="${field}"]`)) setFieldError(field, msg);
    lines.push(`${label}: ${msg}`);
  });
  showError(
    "Some answers need fixing",
    "The server rejected a few values. Correct them and try again.",
    lines
  );
}

function handleRequestError(err) {
  if (err.name === "AbortError") {
    showError("Request timed out", "The server took too long to respond. Try again in a moment.");
  } else if (err.status === 422) {
    handleValidationErrors(err.body && err.body.detail);
  } else if (err.status >= 500) {
    showError("Server error", "The model hit an error while predicting. Check the uvicorn terminal for details.");
  } else if (err.status) {
    const detail = err.body && typeof err.body.detail === "string" ? err.body.detail : `Status ${err.status}`;
    showError("Request failed", detail);
  } else {
    showError(
      "Can't reach the server",
      `Make sure the API is running at ${API_BASE_URL} (python -m uvicorn main:app --reload).`
    );
  }
}

/* ---------- Result rendering ---------- */
function interpret(score) {
  const ratio = score / MAX_SCORE;
  if (ratio >= 0.7) return { tone: "good", title: "Positive wellbeing", text: "Your habits point to a healthy balance. Keep protecting your sleep and offline time." };
  if (ratio >= 0.5) return { tone: "mid", title: "Moderate wellbeing", text: "Some habits may be weighing on you. Small changes to screen time, sleep or activity can help." };
  return { tone: "low", title: "Wellbeing at risk", text: "Your habits suggest added strain. Consider cutting screen time and talking with someone you trust." };
}

function animateScore(target) {
  const duration = 1200;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamped = Math.max(0, Math.min(target, MAX_SCORE));

  gaugeFill.style.strokeDashoffset = GAUGE_CIRCUMFERENCE;
  requestAnimationFrame(() => {
    gaugeFill.style.strokeDashoffset = GAUGE_CIRCUMFERENCE * (1 - clamped / MAX_SCORE);
  });

  if (reduce) { scoreEl.textContent = target.toFixed(2); return; }
  const start = performance.now();
  (function tick(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    scoreEl.textContent = (target * eased).toFixed(2);
    if (p < 1) requestAnimationFrame(tick);
  })(start);
}

function showResult(score) {
  const info = interpret(score);
  resultCard.dataset.tone = info.tone;
  verdictEl.textContent = info.title;
  verdictTextEl.textContent = info.text;
  setState("success");
  animateScore(score);
  revealResult();
}

/* ---------- Events ---------- */
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAllFieldErrors();

  if (validateForm().length) {
    showError("Check your answers", "Complete the highlighted fields, then predict again.");
    return;
  }

  setLoading(true);
  setState("loading");
  revealResult();

  try {
    const data = await requestPrediction(buildPayload());
    const score = Number(data && data.predicted_mental_health_score);
    if (!Number.isFinite(score)) throw new Error("Unexpected response format");
    showResult(score);
  } catch (err) {
    if (err.status || err.name === "AbortError" || err instanceof TypeError) handleRequestError(err);
    else showError("Unexpected response", "The API replied in a format this page doesn't understand.");
  } finally {
    setLoading(false);
  }
});

form.addEventListener("reset", () => {
  clearAllFieldErrors();
  setState("idle");
});

// Clear a field's error as soon as the person edits it
form.addEventListener("input", (e) => e.target.name && clearFieldError(e.target.name));
form.addEventListener("change", (e) => e.target.name && clearFieldError(e.target.name));

retryBtn.addEventListener("click", () => {
  setState("idle");
  form.querySelector(".invalid input, .invalid select, input, select").focus();
});
