import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { label, useApi, type Card, type Listing } from "./api";

import { useLocale } from "./locale";

function TemplateCard({ item }: { item: Card }) {
  const { prefix } = useLocale();
  return (
    <article>
      <Link to={prefix + "/templates/" + item.slug} className="card">
        <div className="cover">
          {item.thumbnail && <img src={item.thumbnail} alt="" loading="lazy" />}
        </div>
        <div className="cardtop">
          <h3>{item.title}</h3>
          <span className="model">{label(item.model)}</span>
        </div>
        <p>{item.tagline}</p>
        <div className="tags">
          {[...new Set([...item.types, ...item.styles])]
            .slice(0, 3)
            .map((t) => (
              <span key={t}>{label(t)}</span>
            ))}
        </div>
      </Link>
    </article>
  );
}

export function Library({ home = false }: { home?: boolean }) {
  const { prefix, t } = useLocale();
  const navigate = useNavigate(),
    [params, setParams] = useSearchParams(),
    query = params.get("q") || "";
  const [input, setInput] = useState(query);
  useEffect(() => setInput(query), [query]);
  const qs = params.toString(),
    { data, error } = useApi<Listing>("/api/templates?" + qs);
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (key !== "page") next.delete("page");
    if (key === "tag" && value) {
      if (next.getAll(key).includes(value)) next.delete(key, value);
      else next.append(key, value);
    } else if (value) next.set(key, value);
    else next.delete(key);
    if (home) navigate(prefix + "/templates?" + next);
    else setParams(next);
  }
  const tags = params.getAll("tag"),
    local = params.get("source") === "local";
  const visibleTags = [
    "landing-page",
    "ecommerce",
    "interactive-explainer",
    "browser-game",
    "portfolio",
    "dashboard",
    "minimal",
    "editorial",
    "dark",
    "playful",
  ];
  const facets = data?.facets ?? [];
  return (
    <main>
      <section className={home ? "hero" : "directory shell"}>
        {home ? (
          <h1>
            {t("Copy the prompt.", "复制提示词。")}{" "}
            <em>{t("Get the website.", "生成网站。")}</em>
          </h1>
        ) : (
          <h1>{t("Vibe coding website templates", "Vibe coding 网站模板")}</h1>
        )}
        <p>
          {home
            ? data
              ? t(
                  data.totalVariants +
                    " live websites, each with the exact prompt that built it.",
                  data.totalVariants + " 个网站及其构建提示词。",
                )
              : t(
                  "Browse websites and their build prompts.",
                  "浏览网站及其构建提示词。",
                )
            : t(
                "Filter by tag, preview a variant, or find a build you already have.",
                "选择标签，预览模板版本或查找已下载的项目。",
              )}
        </p>
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            update("q", input.trim());
          }}
        >
          <Search size={20} aria-hidden="true" />
          <input
            aria-label={t("Search templates", "搜索模板")}
            placeholder={t(
              "Try “dark SaaS”, “portfolio” or “3D”",
              "搜索模板、风格或关键词",
            )}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="primary">{t("Search", "搜索")}</button>
        </form>
      </section>
      <section
        className={
          home ? "shell collection" : "shell collection directory-results"
        }
      >
        {!home && (
          <aside
            className="facet-sidebar"
            aria-label={t("Filter templates", "筛选模板")}
          >
            {Object.entries({
              type: t("Type", "类型"),
              style: t("Style", "风格"),
              usecase: t("Use case", "用途"),
              effect: t("Effect", "效果"),
              industry: t("Industry", "行业"),
              role: t("Role", "角色"),
              stack: t("Stack", "技术栈"),
            }).map(([group, heading]) => {
              const options = facets.filter((f) => f.group === group);
              return (
                options.length > 0 && (
                  <section key={group}>
                    <h2>{heading}</h2>
                    <div className="filters">
                      {options.map((f) => (
                        <button
                          key={f.slug}
                          aria-pressed={tags.includes(f.slug)}
                          onClick={() => update("tag", f.slug)}
                        >
                          {label(f.slug)} <small>{f.count}</small>
                        </button>
                      ))}
                    </div>
                  </section>
                )
              );
            })}
          </aside>
        )}
        <div className="results">
          <div className="sectionhead">
            <h2>
              {home
                ? t("Vibe coding website templates", "Vibe coding 网站模板")
                : local
                  ? t("Downloaded templates", "已下载的模板")
                  : t("Templates", "模板")}{" "}
              {!home && data && <small>{data.count}</small>}
            </h2>
            <div className="switch">
              <button
                aria-pressed={!local}
                onClick={() => update("source", "")}
              >
                {t("All", "全部")}
              </button>
              <button
                aria-pressed={local}
                onClick={() => update("source", "local")}
              >
                {t("Downloaded", "已下载")}
              </button>
            </div>
          </div>
          <div className="filters toolbar">
            {visibleTags
              .filter((t) => facets.some((f) => f.slug === t))
              .map((t) => (
                <button
                  aria-pressed={tags.includes(t)}
                  key={t}
                  onClick={() => update("tag", t)}
                >
                  {label(t)}
                </button>
              ))}
            <select
              aria-label="Filter by tag"
              value=""
              onChange={(e) => update("tag", e.target.value)}
            >
              <option value="">{t("All tags", "所有标签")}</option>
              {facets.map((f) => (
                <option key={f.slug} value={f.slug}>
                  {tags.includes(f.slug) ? "✓ " : ""}
                  {label(f.slug)} ({f.count})
                </option>
              ))}
            </select>
            <select
              aria-label="Sort templates"
              value={params.get("sort") || ""}
              onChange={(e) => update("sort", e.target.value)}
            >
              <option value="">{t("Featured", "精选")}</option>
              <option value="name">A–Z</option>
            </select>
          </div>
          {error ? (
            <p role="alert">{error}</p>
          ) : !data ? (
            <p role="status">{t("Loading templates…", "正在加载模板…")}</p>
          ) : (
            <>
              <div className="grid">
                {data.results.map((item) => (
                  <TemplateCard key={item.slug} item={item} />
                ))}
              </div>
              {!data.results.length && (
                <p>
                  {t(
                    "No templates match these filters.",
                    "没有匹配这些条件的模板。",
                  )}{" "}
                  <Link to={prefix + "/templates"}>
                    {t("Clear filters", "清除筛选")}
                  </Link>
                </p>
              )}
              {data.count > data.pageSize && (
                <div className="pagination">
                  <button
                    disabled={data.page <= 1}
                    onClick={() => {
                      update("page", String(data.page - 1));
                      window.scrollTo(0, 0);
                    }}
                  >
                    {t("← Previous", "← 上一页")}
                  </button>
                  <span>
                    {t(
                      `Page ${data.page} of ${Math.ceil(data.count / data.pageSize)}`,
                      `第 ${data.page} 页，共 ${Math.ceil(data.count / data.pageSize)} 页`,
                    )}
                  </span>
                  <button
                    disabled={data.page * data.pageSize >= data.count}
                    onClick={() => {
                      update("page", String(data.page + 1));
                      window.scrollTo(0, 0);
                    }}
                  >
                    {t("Next →", "下一页 →")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
