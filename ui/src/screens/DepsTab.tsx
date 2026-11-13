// Вкладка «Зависимости»: граф связей между модами профиля — кто кому нужен, что рекомендовано,
// что конфликтует (по метаданным модов и находкам Mod Doctor). Моды без связей скрыты.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errText, mods, type DoctorReport, type JournalEntry, type ModFile, type Instance, type Plan } from "../api";
import { useDialog } from "../ui/Dialog";
import { CatalogDialog, FindingCard, PlanDialog } from "./ModsTab";
import { t, tc } from "../i18n";

type Pt = { x: number; y: number };
// Положение узлов, которое игрок задал перетаскиванием, — своё у каждого профиля.
// shortcut: хранится в localStorage окна (теряется при очистке данных WebView); перенести в профиль, если попросят синхронизацию.
const posKey = (id: string) => `axel.deps.pos.${id}`;
function loadPos(id: string): Record<string, Pt> {
  try { return JSON.parse(localStorage.getItem(posKey(id)) ?? "{}"); } catch { return {}; }
}
function savePos(id: string, p: Record<string, Pt>) {
  try { if (Object.keys(p).length) localStorage.setItem(posKey(id), JSON.stringify(p)); else localStorage.removeItem(posKey(id)); } catch { /* без хранилища положение просто не запомнится */ }
}

/** Загрузчик и игра — не моды профиля, в связях их не показываем. */
const BUILTIN = new Set(["minecraft", "java", "fabricloader", "quilt_loader", "neoforge", "forge", "fml"]);

type Kind = "req" | "opt" | "bad";
interface Node { id: string; name: string; lib: boolean }
interface Edge { from: string; to: string; kind: Kind; why?: string }
type View = "all" | "around" | "problems";

function buildGraph(files: ModFile[], report: DoctorReport, journal: JournalEntry[]) {
  const owner = new Map<string, string>();
  for (const f of files) for (const m of f.mods) owner.set(m.id, f.file_name);
  const name = (f: ModFile) => `${f.mods[0]?.name ?? f.file_name} ${f.mods[0]?.version ?? ""}`.trim();
  const edges: Edge[] = [];
  const missing = new Map<string, string[]>();
  for (const f of files.filter((x) => x.enabled)) {
    for (const d of f.mods.flatMap((m) => m.dependencies)) {
      if (BUILTIN.has(d.id)) continue;
      const to = owner.get(d.id);
      // Проблемы решает Mod Doctor: он учитывает версии и то, что даёт сам загрузчик (у Quilt — QSL).
      // Граф только показывает его находки, иначе «не хватает» и «конфликт» расходились бы с «Модами».
      if (!to) {
        if (d.kind === "required" && report.findings.some((fd) => fd.files.includes(f.file_name) && fd.fixes.some((x) => x.kind === "install" && x.mod_id === d.id)))
          missing.set(f.file_name, [...(missing.get(f.file_name) ?? []), d.id]);
        continue;
      }
      if (to === f.file_name) continue;
      const declaredBad = d.kind === "breaks" || d.kind === "conflicts";
      const bad = report.findings.find((fd) => (declaredBad ? fd.files.includes(f.file_name) && fd.files.includes(to)
        : fd.severity === "blocking" && fd.files.includes(f.file_name) && fd.title.toLowerCase().includes(d.id)));
      // Объявленная несовместимость с другими версиями — не конфликт этого профиля.
      if (declaredBad && !bad) continue;
      const kind: Kind = bad ? "bad" : d.kind === "required" ? "req" : "opt";
      edges.push({ from: f.file_name, to, kind, why: bad ? `${tc(bad.title)}. ${tc(bad.detail)}` : undefined });
    }
  }
  for (const fd of report.findings.filter((x) => x.severity === "blocking" && x.files.length >= 2)) {
    edges.push({ from: fd.files[0], to: fd.files[1], kind: "bad", why: `${tc(fd.title)}. ${tc(fd.detail)}` });
  }
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  // «Библиотека» — мод, который лаунчер поставил как чью-то зависимость (по журналу).
  const asDep = (n: string) => journal.some((j) => j.reason.startsWith("нужен для") && j.what.startsWith(n));
  const nodes: Node[] = files.filter((f) => linked.has(f.file_name)).map((f) => ({ id: f.file_name, name: name(f), lib: asDep(f.mods[0]?.name ?? "") }));
  return { nodes, edges, missing, hidden: files.filter((f) => f.enabled && !linked.has(f.file_name)).length };
}

/** Пружинная раскладка: узлы отталкиваются, связи стягивают. Детерминированно (старт по кругу). */
function layout(nodes: Node[], edges: Edge[], w: number, h: number): Map<string, { x: number; y: number }> {
  const pos = new Map(nodes.map((n, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, nodes.length);
    return [n.id, { x: w / 2 + Math.cos(a) * w * 0.3, y: h / 2 + Math.sin(a) * h * 0.3 }];
  }));
  const k = Math.sqrt((w * h) / Math.max(1, nodes.length)) * 0.6;
  for (let it = 0, temp = w / 8; it < 300; it++, temp *= 0.985) {
    const disp = new Map(nodes.map((n) => [n.id, { x: 0, y: 0 }]));
    for (const a of nodes) for (const b of nodes) {
      if (a === b) continue;
      const pa = pos.get(a.id)!, pb = pos.get(b.id)!;
      const dx = pa.x - pb.x, dy = pa.y - pb.y, d = Math.max(1, Math.hypot(dx, dy));
      const f = (k * k) / d;
      disp.get(a.id)!.x += (dx / d) * f; disp.get(a.id)!.y += (dy / d) * f;
    }
    for (const e of edges) {
      const pa = pos.get(e.from), pb = pos.get(e.to);
      if (!pa || !pb) continue;
      const dx = pa.x - pb.x, dy = pa.y - pb.y, d = Math.max(1, Math.hypot(dx, dy));
      const f = (d * d) / k;
      disp.get(e.from)!.x -= (dx / d) * f; disp.get(e.from)!.y -= (dy / d) * f;
      disp.get(e.to)!.x += (dx / d) * f; disp.get(e.to)!.y += (dy / d) * f;
    }
    for (const n of nodes) {
      const p = pos.get(n.id)!, v = disp.get(n.id)!, d = Math.max(1, Math.hypot(v.x, v.y));
      p.x = Math.min(w - 90, Math.max(30, p.x + (v.x / d) * Math.min(d, temp)));
      p.y = Math.min(h - 25, Math.max(25, p.y + (v.y / d) * Math.min(d, temp)));
    }
  }
  return pos;
}

export function DepsTab({ inst, running, onChanged }: { inst: Instance; running: boolean; onChanged: () => void }) {
  const dialog = useDialog();
  const [data, setData] = useState<{ files: ModFile[]; report: DoctorReport; journal: JournalEntry[] } | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("all");
  const [sel, setSel] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ title: string; plan: Plan } | null>(null);
  const [moved, setMoved] = useState<Record<string, Pt>>(() => loadPos(inst.id));
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; start: Pt; moved: boolean } | null>(null);
  const load = useCallback(() => { mods.view(inst.id).then(setData).catch((e) => setError(errText(e))); }, [inst.id]);
  useEffect(load, [load]);
  const g = useMemo(() => (data ? buildGraph(data.files, data.report, data.journal) : null), [data]);
  const W = 900, H = 520;
  const auto = useMemo(() => (g ? layout(g.nodes, g.edges, W, H) : new Map<string, Pt>()), [g]);
  const at = (id: string): Pt | undefined => moved[id] ?? auto.get(id);
  const clamp = (p: Pt): Pt => ({ x: Math.min(W - 90, Math.max(14, p.x)), y: Math.min(H - 14, Math.max(14, p.y)) });
  const place = (id: string, p: Pt, persist: boolean) => setMoved((m) => { const next = { ...m, [id]: clamp(p) }; if (persist) savePos(inst.id, next); return next; });

  // Перетаскивание: координаты мыши переводятся в координаты рисунка (он масштабируется по ширине окна).
  const toSvg = (e: React.PointerEvent) => {
    const m = svg.current?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const down = (e: React.PointerEvent, id: string) => {
    const p = toSvg(e), cur = at(id)!;
    drag.current = { id, dx: cur.x - p.x, dy: cur.y - p.y, start: p, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toSvg(e);
    if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 4) return;
    d.moved = true;
    place(d.id, { x: p.x + d.dx, y: p.y + d.dy }, false);
  };
  const up = (id: string) => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) setMoved((m) => { savePos(inst.id, m); return m; });
    else setSel(sel === id ? null : id);
  };
  const resetPos = () => { savePos(inst.id, {}); setMoved({}); };
  const toggle = async (file: string, enabled: boolean) => {
    try { await mods.toggle(inst.id, file, enabled); load(); onChanged(); } catch (e) { await dialog.alert(t("Не получилось"), errText(e)); }
  };

  if (error) return <div className="alert err"><span>{error}</span></div>;
  if (!g || !data) return <p className="muted"><span className="spinner" /> {t("Загружаем…")}</p>;
  if (g.nodes.length === 0) return <div className="card empty"><p>{t("Связей между модами нет: каждый работает сам по себе.")}</p></div>;

  const near = new Set(sel ? [sel, ...g.edges.filter((e) => e.from === sel || e.to === sel).flatMap((e) => [e.from, e.to])] : []);
  const edges = g.edges.filter((e) => view === "all" || (view === "problems" ? e.kind === "bad" : !sel || near.has(e.from) && near.has(e.to) && (e.from === sel || e.to === sel)));
  const shown = new Set(view === "all" ? g.nodes.map((n) => n.id) : edges.flatMap((e) => [e.from, e.to]).concat(sel ? [sel] : []));
  const node = g.nodes.find((n) => n.id === sel);
  const file = data.files.find((f) => f.file_name === sel);
  const nameOf = (id: string) => g.nodes.find((n) => n.id === id)?.name ?? id;
  const conflicts = g.edges.filter((e) => e.kind === "bad").length;
  const missingCount = [...g.missing.values()].reduce((n, l) => n + l.length, 0);
  const warnings = data.report.findings.filter((f) => f.severity !== "blocking").length;
  const findingsOf = (id: string) => data.report.findings.filter((f) => f.files.includes(id));

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <div className="seg" role="group" aria-label={t("Какие связи показывать")}>
          {([["all", t("Все связи")], ["around", t("Вокруг выбранного")], ["problems", t("Только проблемы")]] as const).map(([v, l]) => (
            <button key={v} className={view === v ? "on" : ""} aria-pressed={view === v} onClick={() => setView(v)}>{l}</button>
          ))}
        </div>
        <span className="muted small">{t("моды без связей скрыты ({0}) · узлы можно перетаскивать", g.hidden)}
          {Object.keys(moved).length > 0 && <> · <button className="btn link small" onClick={resetPos}>{t("Разложить заново")}</button></>}
        </span>
      </div>
      <div className="modsgrid">
        <div className="card graph">
          <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={t("Граф зависимостей модов")} onPointerMove={move}>
            {edges.map((e, i) => {
              const a = at(e.from), b = at(e.to);
              if (!a || !b) return null;
              return (
                <g key={i}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`edge ${e.kind}`} />
                  {e.kind === "bad" && <text x={(a.x + b.x) / 2 + 6} y={(a.y + b.y) / 2} className="edge-label">× {t("конфликт")}</text>}
                </g>
              );
            })}
            {g.nodes.filter((n) => shown.has(n.id)).map((n) => {
              const p = at(n.id)!;
              const bad = g.edges.some((e) => e.kind === "bad" && (e.from === n.id || e.to === n.id));
              return (
                <g key={n.id} className={`node ${n.lib ? "lib" : ""} ${bad ? "bad" : ""} ${sel === n.id ? "on" : ""}`} role="button" tabIndex={0}
                  aria-label={`${n.name}${bad ? `, ${t("конфликт")}` : ""}`} aria-pressed={sel === n.id} aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
                  onPointerDown={(e) => down(e, n.id)} onPointerUp={() => up(n.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(sel === n.id ? null : n.id); return; }
                    // Стрелки двигают узел — перетаскивание без мыши (WCAG 2.5.7).
                    const step = e.shiftKey ? 40 : 10;
                    const d = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[e.key];
                    if (d) { e.preventDefault(); place(n.id, { x: p.x + d[0], y: p.y + d[1] }, true); }
                  }}>
                  <circle cx={p.x} cy={p.y} r={n.lib ? 6 : 10} />
                  <text x={p.x + 14} y={p.y + 4}>{n.name}</text>
                </g>
              );
            })}
          </svg>
        </div>
        <aside className="card modcard" aria-label={t("Сведения о связях")} aria-live="polite">
          {!node ? (
            <>
              <h3>{t("Сводка")}</h3>
              <dl className="kv">
                <dt>{t("Обязательные зависимости")}</dt><dd>{missingCount ? <span style={{ color: "var(--err)" }}>{t("не хватает: {0}", missingCount)}</span> : t("все на месте")}</dd>
                <dt>{t("Конфликтов")}</dt><dd>{conflicts}</dd>
                <dt>{t("Предупреждений")}</dt><dd>{warnings}</dd>
                <dt>{t("Модов со связями")}</dt><dd>{g.nodes.length}</dd>
              </dl>
              <p className="muted small">{t("Нажмите на мод в графе — здесь появятся его связи и что можно сделать. Узел можно перетащить мышью или стрелками, положение запомнится.")}</p>
            </>
          ) : (
            <>
              <h3>{node.name}</h3>
              <p className="muted small">{node.id}</p>
              {findingsOf(node.id).map((f, i) => <FindingCard key={i} f={f} files={data.files} onToggle={toggle} onSearch={(q) => setCatalog(q)} />)}
              <dl className="kv">
                {g.edges.some((e) => e.from === node.id && e.kind !== "bad") && <><dt>{t("Нужны ему")}</dt><dd>{g.edges.filter((e) => e.from === node.id && e.kind !== "bad").map((e) => nameOf(e.to)).join(", ")}</dd></>}
                {g.edges.some((e) => e.to === node.id && e.kind !== "bad") && <><dt>{t("Нужен для")}</dt><dd>{g.edges.filter((e) => e.to === node.id && e.kind !== "bad").map((e) => nameOf(e.from)).join(", ")}</dd></>}
                {g.edges.filter((e) => e.kind === "bad" && (e.from === node.id || e.to === node.id)).map((e, i) => (
                  <Fragment key={i}><dt>{t("Конфликт")}</dt><dd style={{ color: "var(--err)" }}>{e.why ?? t("Конфликт с {0}", nameOf(e.from === node.id ? e.to : e.from))}</dd></Fragment>
                ))}
                {(g.missing.get(node.id) ?? []).length > 0 && <><dt>{t("нет в профиле")}</dt><dd style={{ color: "var(--err)" }}>{g.missing.get(node.id)!.join(", ")}</dd></>}
              </dl>
              <div className="acts">
                {file && <button className="btn" disabled={running} onClick={() => toggle(file.file_name, !file.enabled)}>{file.enabled ? t("Выключить") : t("Включить")}</button>}
                {(g.missing.get(node.id) ?? []).map((id) => <button key={id} className="btn" disabled={running} onClick={() => setCatalog(id)}>{t("Найти «")}{id}{t("» в каталоге")}</button>)}
                <button className="btn link" onClick={() => setSel(null)}>{t("К сводке")}</button>
              </div>
            </>
          )}
        </aside>
      </div>
      <p className="muted small legend">
        <span><i className="lg req" /> {t("требует")}</span>
        <span><i className="lg opt" /> {t("необязательно")}</span>
        <span><i className="lg bad" /> {t("конфликт")}</span>
        <span>{t("серый узел — библиотека, поставлена как зависимость")}</span>
      </p>
      {running && <p className="small" style={{ color: "var(--warn)" }}>{t("Игра запущена — менять моды можно после её закрытия.")}</p>}
      {catalog !== null && <CatalogDialog inst={inst} initial={catalog} kinds={["mod"]} onClose={() => setCatalog(null)} onPlan={(title, p) => { setCatalog(null); setPlan({ title, plan: p }); }} />}
      {plan && <PlanDialog title={plan.title} plan={plan.plan} onClose={() => setPlan(null)} onApply={async (p) => { await mods.apply(inst.id, p, t("Перед: {0}", plan.title.toLowerCase())); setPlan(null); load(); onChanged(); }} />}
    </>
  );
}
