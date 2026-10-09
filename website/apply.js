// "Apply for testing": the form posts to the Skopje Parking API, which forwards it to the owner's Telegram.
const API = "https://vkqxtqcuoobiijbnpxod.supabase.co/functions/v1/api";
const api = () => document.documentElement.dataset.api || API;
const MK = document.documentElement.lang === "mk";
const say = {
  missing: MK ? "Пополнете ги сите полиња." : "Fill in every field, please.",
  email: MK ? "Проверете ја е-поштата." : "Check your email address.",
  sending: MK ? "Се испраќа…" : "Sending…",
  offline: MK ? "Skopje Parking не е достапен. Проверете ја врската и обидете се повторно." : "Couldn't reach Skopje Parking. Check your connection and try again.",
  done: email => MK ? `Ќе ја додадеме ${email} во тестирањето на Google Play и ќе ви ја испратиме врската за инсталација на Skopje Parking.` : `We'll add ${email} to the test on Google Play and send you the link to install Skopje Parking.`,
  status: (code, fallback) => !MK ? fallback : code === 400 ? "Проверете ги името, е-поштата и телефонскиот број." : code === 429 ? "Премногу обиди. Обидете се повторно подоцна." : code === 503 ? "Пријавите моментално се затворени. Пишете ни на contact@vasojevich.com." : "Пријавата не помина. Обидете се повторно за една минута.",
};

document.addEventListener("DOMContentLoaded", () => {
  const dialog = document.getElementById("apply");
  const form = document.getElementById("apply-form");
  const done = document.getElementById("apply-done");
  const status = document.getElementById("apply-status");
  const submit = form.querySelector('button[type="submit"]');
  const show = (text, kind) => { status.textContent = text; status.className = "status " + kind; };
  const open = () => {
    form.hidden = false; done.hidden = true; show("", "");
    dialog.showModal();
    form.elements.name.focus();
  };
  document.querySelectorAll("[data-apply]").forEach(button => button.addEventListener("click", open));
  dialog.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => dialog.close()));
  // A click on the dimmed backdrop closes the dialog.
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const missing = !String(data.name || "").trim() || !String(data.phone || "").trim() || !data.licence || !data.car;
    if (missing) return show(say.missing, "error");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(data.email || "").trim())) return show(say.email, "error");
    const body = { name: data.name, email: data.email, phone: data.phone, licence: data.licence, car: data.car };
    if (data.website) body.website = data.website;
    submit.disabled = true;
    show(say.sending, "");
    try {
      const response = await fetch(api() + "/v1/tester-applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(say.status(response.status, result.error || "Your application didn't go through. Try again in a minute."));
      document.getElementById("apply-done-text").textContent = say.done(String(data.email).trim());
      form.reset(); form.hidden = true; done.hidden = false;
    } catch (error) {
      show(error instanceof TypeError ? say.offline : error.message, "error");
    } finally {
      submit.disabled = false;
    }
  });
});
