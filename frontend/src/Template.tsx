import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { label, useApi, type Detail } from "./api";

import { useLocale } from "./locale";

function DocumentPanel({ slug }: { slug: string }) {
  const { t } = useLocale();
  const [kind, setKind] = useState<"prompt" | "design">("prompt"),
    [content, setContent] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setContent("");
    setMessage("");
    fetch("/api/templates/" + slug + "/" + kind, { signal: c.signal })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.text();
      })
      .then(setContent)
      .catch(() => {
        if (!c.signal.aborted) setMessage("Unable to load this document.");
      });
    return () => c.abort();
  }, [slug, kind]);
  return (
    <section className="documents">
      <div className="sectionhead">
        <div className="switch">
          {(["prompt", "design"] as const).map((k) => (
            <button
              key={k}
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
            >
              {k === "prompt"
                ? t("Build prompt", "构建提示词")
                : t("Design guide", "设计指南")}
            </button>
          ))}
        </div>
        <button
          disabled={!content}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(content);
              setMessage("Copied");
            } catch {
              setMessage("Select the text to copy it.");
            }
          }}
        >
          {t("Copy " + kind, kind === "prompt" ? "复制提示词" : "复制设计指南")}
        </button>
      </div>
      <span role="status">{message}</span>
      <pre>{content}</pre>
    </section>
  );
}

export function Template() {
  const { prefix, t } = useLocale();
  const { slug = "" } = useParams(),
    [params, setParams] = useSearchParams(),
    [playing, setPlaying] = useState("");
  const { data, error } = useApi<Detail>("/api/templates/" + slug);
  useEffect(() => {
    if (data) document.title = data.title + " · vibe-templates";
  }, [data]);
  if (!data)
    return (
      <main className="status">
        {error || t("Loading template…", "正在加载模板…")}{" "}
        {error && (
          <Link to={prefix + "/templates"}>
            {t("Browse templates", "浏览模板")}
          </Link>
        )}
      </main>
    );
  const selected =
    data.cases.find((c) => c.id === params.get("case")) || data.cases[0];
  return (
    <main className="shell detail">
      <div className="crumb">
        <Link to={prefix + "/templates"}>{t("Templates", "模板")}</Link> /{" "}
        {data.title}
      </div>
      <div className="detailgrid">
        <section className="previewbox">
          <div className="casebar" role="tablist" aria-label="Variants">
            {data.cases.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={c.id === selected.id}
                onClick={() => {
                  setParams({ case: c.id });
                  setPlaying(c.id);
                }}
              >
                {c.label === c.model ? label(c.model) : c.label}
              </button>
            ))}
          </div>
          <div className="preview">
            {playing === selected.id && selected.preview ? (
              <iframe
                key={selected.id}
                title={data.title + " live demo"}
                src={selected.preview}
                sandbox="allow-scripts allow-forms allow-modals allow-downloads"
              />
            ) : (
              <>
                {data.thumbnail && (
                  <img src={data.thumbnail} alt={data.title + " preview"} />
                )}
                {selected.preview && (
                  <button
                    className="play"
                    onClick={() => setPlaying(selected.id)}
                  >
                    ▶ &nbsp; {t("Try the live demo", "查看演示")}
                  </button>
                )}
              </>
            )}
          </div>
          <div className="previewfoot">
            <span>
              {selected.local
                ? t("Local build", "本地预览")
                : t("Online demo", "在线演示")}{" "}
              · {label(selected.model)}
            </span>
            {selected.preview && (
              <a
                href={selected.preview}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("Open in new tab ↗", "在新标签页打开 ↗")}
              </a>
            )}
          </div>
        </section>
        <aside className="infobox">
          <div className="tags">
            {data.types.map((t) => (
              <Link
                key={t}
                to={prefix + "/templates?tag=" + encodeURIComponent(t)}
              >
                {label(t)}
              </Link>
            ))}
          </div>
          <h1>{data.title}</h1>
          <p>{data.tagline}</p>
          <dl>
            <dt>{t("Model", "模型")}</dt>
            <dd>{label(selected.model)}</dd>
            <dt>{t("Tool", "工具")}</dt>
            <dd>{selected.tool}</dd>
            <dt>{t("Variants", "版本")}</dt>
            <dd>{data.cases.length}</dd>
          </dl>
          {selected.source ? (
            <a className="primary download" href={selected.source} download>
              {t("Download source code", "下载源码")}
            </a>
          ) : (
            <button className="download" disabled>
              {t("Source queued for download", "源码等待下载")}
            </button>
          )}
        </aside>
      </div>
      <section className="about">
        <h2>{t("About this template", "关于此模板")}</h2>
        <p>{data.description || data.tagline}</p>
        <p className="stack">{data.stack}</p>
      </section>
      <DocumentPanel key={slug} slug={slug} />
    </main>
  );
}
