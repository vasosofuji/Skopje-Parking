// Account deletion without the app (Google Play requires a web option): sign in, then delete the account.
const API = "https://vkqxtqcuoobiijbnpxod.supabase.co/functions/v1/api";
// A local test can point the page at another API with <html data-api="...">.
const api = () => document.documentElement.dataset.api || API;
const MK = document.documentElement.lang === "mk";

async function call(path, init) {
  const response = await fetch(api() + path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || body.message || "Request failed"), { status: response.status });
  return body;
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("delete-form");
  const status = document.getElementById("delete-status");
  const button = form.querySelector("button");
  const show = (text, kind) => { status.textContent = text; status.className = "status " + kind; };
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = new FormData(form);
    const username = String(data.get("username") || "").trim(), password = String(data.get("password") || "");
    if (!username || !password) return show((MK ? "Внесете корисничко име и лозинка." : "Enter your username and password."), "error");
    if (!data.get("confirm")) return show((MK ? "Штиклирајте за да потврдите." : "Tick the box to confirm."), "error");
    button.disabled = true;
    show((MK ? "Профилот се брише…" : "Deleting your account…"), "");
    try {
      const { token } = await call("/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      await call("/v1/sessions/me", { method: "DELETE", headers: { Authorization: "Bearer " + token } });
      form.reset();
      show((MK ? "Готово. Профилот и вашите податоци се избришани." : "Done. Your account and contributor data were deleted."), "ok");
    } catch (error) {
      show(error.status === 401 ? (MK ? "Корисничкото име и лозинката не се совпаѓаат." : "That username and password don't match.") : error.status === 429 ? (MK ? "Премногу обиди. Обидете се повторно за 15 минути." : "Too many attempts. Try again in 15 minutes.") : (MK ? "Skopje Parking не е достапен. Проверете ја врската и обидете се повторно." : "Couldn't reach Skopje Parking. Check your connection and try again."), "error");
    } finally {
      button.disabled = false;
    }
  });
});
