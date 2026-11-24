import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { fetchJson, type Session } from "./api";
import { Library } from "./Library";
import { Template } from "./Template";
import { useLocale } from "./locale";
import "./style.css";

function Brand() {
  const { prefix } = useLocale();
  return (
    <Link className="brand" to={prefix || "/"}>
      <b aria-hidden="true">v.</b>vibe-templates
    </Link>
  );
}

function App() {
  const { chinese, prefix, t } = useLocale();
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const { pathname, search } = useLocation();
  useEffect(() => {
    const load = () =>
      fetchJson<Session>("/api/session")
        .then(setSession)
        .catch((e) => setError(e.message));
    load();
    window.addEventListener("owner-session-ended", load);
    return () => window.removeEventListener("owner-session-ended", load);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = "vibe-templates";
    document.documentElement.lang = chinese ? "zh-CN" : "en";
  }, [pathname, chinese]);
  async function changeSession(action: "login" | "logout", password?: string) {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      setSession(
        await fetchJson<Session>("/api/session/" + action, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": session.csrf,
          },
          body: JSON.stringify({ password }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function signIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    changeSession(
      "login",
      String(new FormData(e.currentTarget).get("password")),
    );
  }
  return (
    <div className={session?.authenticated ? "app" : "app entry"}>
      <header>
        <div className="shell bar">
          <Brand />
          {session?.authenticated && (
            <>
              <nav>
                <Link to={prefix + "/templates"}>{t("Templates", "模板")}</Link>
                <Link to={prefix + "/templates?source=local"}>
                  {t("Downloaded", "已下载")}
                </Link>
                <Link
                  lang={chinese ? "en" : "zh-CN"}
                  to={
                    (chinese
                      ? pathname.slice(3) || "/"
                      : "/zh" + (pathname === "/" ? "" : pathname)) + search
                  }
                >
                  {chinese ? "English" : "中文"}
                </Link>
              </nav>
              <button
                className="signout"
                disabled={busy}
                onClick={() => changeSession("logout")}
              >
                {t("Sign out", "退出登录")}
              </button>
            </>
          )}
        </div>
      </header>
      {!session ? (
        <main className="status">
          {error || t("Opening gallery…", "正在打开模板库…")}
        </main>
      ) : !session.authenticated ? (
        <main className="signin">
          <form onSubmit={signIn}>
            <h1>{t("Open your gallery", "打开模板库")}</h1>
            <label htmlFor="password">
              {t("Gallery password", "模板库密码")}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
            {error && <p role="alert">{error}</p>}
            <button className="primary" disabled={busy}>
              {t("Open gallery", "打开模板库")}
            </button>
          </form>
        </main>
      ) : (
        <>
          {error && (
            <p role="alert" className="status">
              {error}
            </p>
          )}
          <Routes>
            <Route path="/" element={<Library home />} />
            <Route path="/templates" element={<Library />} />
            <Route path="/templates/:slug" element={<Template />} />
            <Route path="/zh/templates/:slug" element={<Template />} />
            <Route path="/zh" element={<Library home />} />
            <Route path="/zh/templates" element={<Library />} />
            <Route
              path="*"
              element={
                <main className="status">
                  <h1>{t("Page unavailable", "未找到页面")}</h1>
                  <Link to="/">{t("Browse templates", "浏览模板")}</Link>
                </main>
              }
            />
          </Routes>
        </>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
