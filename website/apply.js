// "Apply for testing": the form posts to the Skopje Parking API, which forwards it to the owner's Telegram.
const API = "https://vkqxtqcuoobiijbnpxod.supabase.co/functions/v1/api";
const api = () => document.documentElement.dataset.api || API;

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
    if (missing) return show("Fill in every field, please.", "error");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(data.email || "").trim())) return show("Check your email address.", "error");
    const body = { name: data.name, email: data.email, phone: data.phone, licence: data.licence, car: data.car };
    if (data.website) body.website = data.website;
    submit.disabled = true;
    show("Sending…", "");
    try {
      const response = await fetch(api() + "/v1/tester-applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Your application didn't go through. Try again in a minute.");
      document.getElementById("apply-done-text").textContent = `We'll add ${String(data.email).trim()} to the test on Google Play and send you the link to install Skopje Parking.`;
      form.reset(); form.hidden = true; done.hidden = false;
    } catch (error) {
      show(error instanceof TypeError ? "Couldn't reach Skopje Parking. Check your connection and try again." : error.message, "error");
    } finally {
      submit.disabled = false;
    }
  });
});
