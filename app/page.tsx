"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle, BarChart3, Bot, CalendarDays, CheckCircle2, ChevronDown, CircleHelp,
  ClipboardPlus, Database, FileSpreadsheet, Filter, Gauge, LoaderCircle, Menu, Plus,
  Search, Settings2, UploadCloud, Wrench, X
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { calculateOee, dateValue, detectMapping, fieldLabels, formatPercent, normaliseHeader, numberValue, OeeRecord } from "@/lib/oee";

type View = "dashboard" | "import" | "entry" | "quality";
type ParsedUpload = { fileName: string; records: OeeRecord[]; headers: string[]; mapped: Record<string, string>; sheet: string; rejected: number; cloudStatus?: string; cloudMessage?: string; cloudImportId?: string };
type RawRow = Record<string, unknown>;
const lossColors = ["#D9574A", "#E6A53B", "#456F9A", "#8096A8", "#C57151"];

function field<T extends keyof OeeRecord>(record: OeeRecord, key: T, value: unknown) {
  if (["operationalMonth", "operationalWeek", "operationalDay", "plannedMinutes", "operatingMinutes", "downtimeMinutes", "breakdownMinutes", "setupMinutes", "cleaningMinutes", "adjustmentsMinutes", "materialShortageMinutes", "supplyShortageMinutes", "microstopsMinutes", "idealCycleSeconds", "technicalSpeed", "averageSpeed", "calendarMinutes", "preventiveExcludedMinutes", "totalCount", "goodCount", "rejectCount"].includes(key)) {
    const parsed = numberValue(value);
    if (parsed !== undefined) (record as OeeRecord)[key] = parsed as never;
  } else if (key === "date") {
    const parsed = dateValue(value);
    if (parsed) record.date = parsed;
  } else if (value !== null && value !== undefined && String(value).trim()) {
    (record as OeeRecord)[key] = String(value).trim() as never;
  }
}

function buildRecords(rows: RawRow[], mapping: Record<string, string>) {
  const records: OeeRecord[] = [];
  let rejected = 0;
  rows.forEach((row, index) => {
    const record: OeeRecord = { id: crypto.randomUUID(), sourceRow: index + 2 };
    Object.entries(mapping).forEach(([header, destination]) => field(record, destination as keyof OeeRecord, row[header]));
    const losses: Record<string, number> = {};
    Object.entries(row).forEach(([header, value]) => {
      const key = normaliseHeader(header);
      const minutes = numberValue(value);
      const cause = key.includes("setup") ? "Setup" : key.includes("quebra") ? "Quebra/manutenção" : key.includes("limpeza") ? "Limpeza" : key.includes("ajuste") ? "Ajustes" : key.includes("materia prima") ? "Falta de matéria-prima" : key.includes("insumo") ? "Falta de insumos" : key.includes("microparada") ? "Microparadas" : null;
      if (cause && minutes !== undefined && minutes > 0) losses[cause] = minutes;
    });
    if (Object.keys(losses).length) record.losses = losses;
    if (Object.keys(record).length > 2) records.push(record); else rejected += 1;
  });
  return { records, rejected };
}

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [records, setRecords] = useState<OeeRecord[]>([]);
  const [upload, setUpload] = useState<ParsedUpload | null>(null);
  // The source rows stay in memory while the import screen is open so that a
  // consultant can correct a column mapping without uploading the file again.
  const [sourceRows, setSourceRows] = useState<RawRow[]>([]);
  const [selectedMachines, setSelectedMachines] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedShift, setSelectedShift] = useState("");
  const [operationalMonth, setOperationalMonth] = useState("");
  const [operationalWeek, setOperationalWeek] = useState("");
  const [operationalDay, setOperationalDay] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [period, setPeriod] = useState("all");
  const [isImporting, setIsImporting] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("gap-oee-local-import-v1");
      if (saved) {
        const parsed = JSON.parse(saved) as { records: OeeRecord[]; upload: Omit<ParsedUpload, "records"> };
        if (parsed.records?.length) {
          setRecords(parsed.records);
          setUpload({ ...parsed.upload, records: parsed.records });
        }
      }
    } catch { window.localStorage.removeItem("gap-oee-local-import-v1"); }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    if (!records.length || !upload) return;
    window.localStorage.setItem("gap-oee-local-import-v1", JSON.stringify({
      records,
      upload: { fileName: upload.fileName, headers: upload.headers, mapped: upload.mapped, sheet: upload.sheet, rejected: upload.rejected }
    }));
  }, [records, upload, storageReady]);

  const machines = useMemo(() => [...new Set(records.map((r) => r.machine).filter(Boolean) as string[])].sort(), [records]);
  const groups = useMemo(() => [...new Set(records.map((r) => r.group).filter(Boolean) as string[])].sort(), [records]);
  const shifts = useMemo(() => [...new Set(records.map((r) => r.shift).filter(Boolean) as string[])].sort(), [records]);
  const products = useMemo(() => [...new Set(records.map((r) => r.product).filter(Boolean) as string[])].sort(), [records]);
  const months = useMemo(() => [...new Set(records.map((r) => r.operationalMonth).filter((value): value is number => value !== undefined))].sort((a, b) => a - b), [records]);
  const weeks = useMemo(() => [...new Set(records.map((r) => r.operationalWeek).filter((value): value is number => value !== undefined))].sort((a, b) => a - b), [records]);
  const days = useMemo(() => [...new Set(records.map((r) => r.operationalDay).filter((value): value is number => value !== undefined))].sort((a, b) => a - b), [records]);
  const filtered = useMemo(() => records.filter((r) => {
    if (selectedMachines.length && (!r.machine || !selectedMachines.includes(r.machine))) return false;
    if (selectedGroups.length && (!r.group || !selectedGroups.includes(r.group))) return false;
    if (selectedShift && r.shift !== selectedShift) return false;
    if (operationalMonth && r.operationalMonth !== Number(operationalMonth)) return false;
    if (operationalWeek && r.operationalWeek !== Number(operationalWeek)) return false;
    if (operationalDay && r.operationalDay !== Number(operationalDay)) return false;
    if (startDate && (!r.date || r.date < startDate)) return false;
    if (endDate && (!r.date || r.date > endDate)) return false;
    if (!r.date || period === "all" || startDate || endDate) return true;
    const target = new Date(`${r.date}T12:00:00`);
    const current = new Date();
    const span = period === "day" ? 1 : period === "week" ? 7 : 31;
    return target >= new Date(current.getTime() - span * 86400000);
  }), [records, selectedMachines, selectedGroups, selectedShift, operationalMonth, operationalWeek, operationalDay, startDate, endDate, period]);
  const metrics = useMemo(() => calculateOee(filtered), [filtered]);
  const operational = useMemo(() => {
    const sum = (key: keyof OeeRecord) => filtered.reduce((total, row) => total + (typeof row[key] === "number" ? Number(row[key]) : 0), 0);
    const operating = sum("operatingMinutes");
    const technicalCapacity = filtered.reduce((total, row) => total + ((row.technicalSpeed || 0) * (row.operatingMinutes || 0)), 0);
    return {
      calendar: sum("calendarMinutes"), preventive: sum("preventiveExcludedMinutes"), planned: sum("plannedMinutes"), operating,
      downtime: Math.max(0, sum("plannedMinutes") - operating), total: sum("totalCount"), good: sum("goodCount"), reject: sum("rejectCount"),
      technicalSpeed: operating ? technicalCapacity / operating : 0, averageSpeed: operating ? sum("totalCount") / operating : 0,
      setup: sum("setupMinutes"), breakdown: sum("breakdownMinutes"), cleaning: sum("cleaningMinutes"), adjustments: sum("adjustmentsMinutes"),
      material: sum("materialShortageMinutes"), supplies: sum("supplyShortageMinutes"), microstops: sum("microstopsMinutes"),
      machines: new Set(filtered.map((row) => row.machine).filter(Boolean)).size, groups: new Set(filtered.map((row) => row.group).filter(Boolean)).size,
      products: new Set(filtered.map((row) => row.product).filter(Boolean)).size, shifts: new Set(filtered.map((row) => row.shift).filter(Boolean)).size
    };
  }, [filtered]);
  const lossData = useMemo(() => {
    const totals = new Map<string, number>();
    filtered.forEach((r) => {
      if (r.losses) Object.entries(r.losses).forEach(([key, minutes]) => totals.set(key, (totals.get(key) || 0) + minutes));
      else {
        const minutes = r.downtimeMinutes || r.breakdownMinutes || r.setupMinutes || 0;
        const key = r.lossReason || r.lossType || (r.breakdownMinutes ? "Quebras" : r.setupMinutes ? "Setups" : "Paradas sem motivo");
        if (minutes) totals.set(key, (totals.get(key) || 0) + minutes);
      }
    });
    return [...totals.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [filtered]);
  const machineData = useMemo(() => machines.map((machine) => {
    const result = calculateOee(filtered.filter((r) => r.machine === machine));
    return { machine, oee: result.oee === null ? 0 : Math.round(result.oee * 1000) / 10 };
  }), [machines, filtered]);
  const analysisScope = useMemo(() => {
    const labels: string[] = [];
    if (startDate || endDate) labels.push(`${startDate || "início"} até ${endDate || "hoje"}`);
    if (operationalMonth) labels.push(`mês operacional ${operationalMonth}`);
    if (operationalWeek) labels.push(`semana operacional ${operationalWeek}`);
    if (operationalDay) labels.push(`dia operacional ${operationalDay}`);
    if (selectedShift) labels.push(`turno ${selectedShift}`);
    if (selectedMachines.length) labels.push(selectedMachines.length === 1 ? `máquina ${selectedMachines[0]}` : `${selectedMachines.length} máquinas`);
    if (selectedGroups.length) labels.push(selectedGroups.length === 1 ? `grupo ${selectedGroups[0]}` : `${selectedGroups.length} grupos`);
    return labels.length ? labels.join(" · ") : "Base completa: todos os períodos, máquinas, grupos e turnos";
  }, [startDate, endDate, operationalMonth, operationalWeek, operationalDay, selectedShift, selectedMachines, selectedGroups]);

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const book = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheetName = book.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(book.Sheets[name], { defval: null }).length })).sort((a, b) => b.rows - a.rows)[0]?.name;
      if (!sheetName) throw new Error("Nenhuma planilha com dados foi encontrada.");
      // raw:true preserves the original numeric values. Formatted strings from
      // Excel (for example "224,608") would otherwise corrupt production totals.
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[sheetName], { defval: null, raw: true });
      const headers = rows.length ? Object.keys(rows[0]) : [];
      const mapping = detectMapping(headers);
      const parsed = buildRecords(rows, mapping);
      setSourceRows(rows);
      setRecords(parsed.records);
      setUpload({ fileName: file.name, records: parsed.records, headers, mapped: mapping, sheet: sheetName, rejected: parsed.rejected, cloudStatus: "saving" });
      setSelectedMachines([]);
      setView("import");
      void persistImport(file, sheetName, mapping);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Não foi possível ler este arquivo.");
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  }

  async function persistImport(file: File, sheet: string, mapping: Record<string, string>) {
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("sheet", sheet);
      body.append("mapping", JSON.stringify(mapping));
      const response = await fetch("/api/import", { method: "POST", body });
      const result = await response.json();
      setUpload((current) => current?.fileName === file.name ? {
        ...current,
        cloudStatus: result.status || "failed",
        cloudMessage: result.error || undefined,
        cloudImportId: result.importId || undefined
      } : current);
    } catch {
      setUpload((current) => current?.fileName === file.name ? { ...current, cloudStatus: "failed", cloudMessage: "A prévia permanece disponível neste navegador; não foi possível salvar na nuvem." } : current);
    }
  }

  async function deleteAnalysis() {
    if (!upload || !window.confirm("Excluir este arquivo, os resultados do dashboard e os registros associados? Esta ação não pode ser desfeita.")) return;
    const importId = upload.cloudImportId;
    // Clear the active local analysis first. If cloud deletion ever fails, the
    // dashboard never keeps showing data the consultant intended to remove.
    window.localStorage.removeItem("gap-oee-local-import-v1");
    setRecords([]); setUpload(null); setSourceRows([]);
    setSelectedMachines([]); setSelectedGroups([]); setSelectedShift(""); setOperationalMonth(""); setOperationalWeek(""); setOperationalDay(""); setStartDate(""); setEndDate(""); setPeriod("all");
    setView("dashboard");
    if (importId) {
      try { await fetch(`/api/import?id=${encodeURIComponent(importId)}`, { method: "DELETE" }); }
      catch { /* The local analysis is still deleted; cloud cleanup can be retried by an administrator. */ }
    }
  }

  function updateMapping(header: string, destination: string) {
    if (!upload || !sourceRows.length) return;
    const mapped = { ...upload.mapped };
    if (destination) mapped[header] = destination;
    else delete mapped[header];
    const parsed = buildRecords(sourceRows, mapped);
    setRecords(parsed.records);
    setUpload({ ...upload, mapped, records: parsed.records, rejected: parsed.rejected });
  }

  function addRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const record: OeeRecord = {
      id: crypto.randomUUID(), date: String(values.get("date") || ""), machine: String(values.get("machine") || ""),
      shift: String(values.get("shift") || ""), product: String(values.get("product") || ""),
      plannedMinutes: numberValue(values.get("plannedMinutes")), downtimeMinutes: numberValue(values.get("downtimeMinutes")),
      breakdownMinutes: numberValue(values.get("breakdownMinutes")), setupMinutes: numberValue(values.get("setupMinutes")),
      idealCycleSeconds: numberValue(values.get("idealCycleSeconds")), totalCount: numberValue(values.get("totalCount")),
      goodCount: numberValue(values.get("goodCount")), rejectCount: numberValue(values.get("rejectCount")),
      lossReason: String(values.get("lossReason") || ""), lossType: String(values.get("lossType") || "Manual")
    };
    setRecords((previous) => [...previous, record]);
    setEntryOpen(false);
    setView("dashboard");
  }

  async function askAssistant(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    setAsking(true); setAnswer("");
    try {
      const response = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, metrics, losses: lossData, filters: { machines: selectedMachines, period }, dataQuality: metrics.missing })
      });
      const data = await response.json();
      setAnswer(data.answer || data.error || "Não foi possível gerar a análise.");
    } catch { setAnswer("O assistente estará disponível após configurar OPENROUTER_API_KEY."); }
    finally { setAsking(false); }
  }

  const hasData = records.length > 0;
  const nav = [
    ["dashboard", "Visão geral", Gauge], ["import", "Importar dados", UploadCloud],
    ["entry", "Novo lançamento", ClipboardPlus], ["quality", "Qualidade dos dados", Database]
  ] as const;

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">G</span><span><strong>GAP</strong><small>OEE Insight</small></span></div>
      <nav>{nav.map(([id, label, Icon]) => <button key={id} className={view === id ? "nav-item active" : "nav-item"} onClick={() => id === "entry" ? setEntryOpen(true) : setView(id)}><Icon size={18}/><span>{label}</span></button>)}</nav>
      <div className="sidebar-bottom"><button className="nav-item"><Settings2 size={18}/><span>Configurações</span></button><p><span className="status-dot"/>{process.env.NEXT_PUBLIC_SUPABASE_URL ? "Banco Supabase configurado" : "Resultados salvos neste navegador"}</p></div>
    </aside>

    <section className="workspace">
      <header className="topbar"><div><button className="mobile-menu" aria-label="Menu"><Menu size={22}/></button><p className="context">Operação industrial</p><h1>{view === "dashboard" ? "Eficiência da operação" : view === "import" ? "Importar planilha" : view === "quality" ? "Qualidade e rastreabilidade" : "Lançar produção"}</h1></div><div className="top-actions"><button className="icon-button" aria-label="Ajuda"><CircleHelp size={19}/></button><button className="profile">GA</button></div></header>

      {view === "dashboard" && <>
        <section className="filter-strip" aria-label="Filtros do dashboard"><div className="filter-label"><Filter size={16}/> Filtrar análise</div><label><CalendarDays size={15}/><select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="all">Todo o período</option><option value="day">Último dia</option><option value="week">Últimos 7 dias</option><option value="month">Últimos 30 dias</option></select></label><label>De<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}/></label><label>Até<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}/></label><details className="advanced-filters"><summary>Mais filtros <ChevronDown size={14}/></summary><div><label>Mês operacional<select value={operationalMonth} onChange={(e) => setOperationalMonth(e.target.value)}><option value="">Todos</option>{months.map((value) => <option key={value} value={value}>Mês {value}</option>)}</select></label><label>Semana operacional<select value={operationalWeek} onChange={(e) => setOperationalWeek(e.target.value)}><option value="">Todas</option>{weeks.map((value) => <option key={value} value={value}>Semana {value}</option>)}</select></label><label>Dia operacional<select value={operationalDay} onChange={(e) => setOperationalDay(e.target.value)}><option value="">Todos</option>{days.map((value) => <option key={value} value={value}>Dia {value}</option>)}</select></label><label>Turno<select value={selectedShift} onChange={(e) => setSelectedShift(e.target.value)}><option value="">Todos</option>{shifts.map((shift) => <option key={shift}>{shift}</option>)}</select></label></div></details><div className="machines-select"><button><Wrench size={15}/>{selectedMachines.length ? `${selectedMachines.length} máquinas` : "Todas as máquinas"}<ChevronDown size={15}/></button><div className="machine-popover">{machines.length ? machines.map((machine) => <label key={machine}><input type="checkbox" checked={selectedMachines.includes(machine)} onChange={() => setSelectedMachines((list) => list.includes(machine) ? list.filter((m) => m !== machine) : [...list, machine])}/>{machine}</label>) : <span>Importe uma planilha para listar máquinas.</span>}</div></div><div className="machines-select"><button><Database size={15}/>{selectedGroups.length ? `${selectedGroups.length} grupos` : "Todos os grupos"}<ChevronDown size={15}/></button><div className="machine-popover">{groups.length ? groups.map((group) => <label key={group}><input type="checkbox" checked={selectedGroups.includes(group)} onChange={() => setSelectedGroups((list) => list.includes(group) ? list.filter((g) => g !== group) : [...list, group])}/>{group}</label>) : <span>Importe uma planilha para listar grupos.</span>}</div></div><button className="clear-filter" onClick={() => { setPeriod("all"); setSelectedMachines([]); setSelectedGroups([]); setSelectedShift(""); setOperationalMonth(""); setOperationalWeek(""); setOperationalDay(""); setStartDate(""); setEndDate(""); }}>Limpar filtros</button></section>
        {!hasData ? <EmptyState onImport={() => fileInput.current?.click()} onEntry={() => setEntryOpen(true)}/> : <Dashboard metrics={metrics} operational={operational} records={filtered.length} lossData={lossData} machineData={machineData} scope={analysisScope} onNewAnalysis={() => fileInput.current?.click()} onDeleteAnalysis={deleteAnalysis}/>} 
      </>}

      {view === "import" && <ImportView upload={upload} onChoose={() => fileInput.current?.click()} onGoDashboard={() => setView("dashboard")} onDelete={deleteAnalysis} onMappingChange={updateMapping} />}
      {view === "quality" && <QualityView upload={upload} metrics={metrics} />}
      {view === "entry" && <EntryPanel machines={machines} onOpen={() => setEntryOpen(true)} />}
    </section>

    <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="visually-hidden" onChange={importFile}/>
    <button className="assistant-fab" onClick={() => setAssistantOpen(true)}><Bot size={20}/> Pergunte aos dados</button>
    {isImporting && <div className="processing"><LoaderCircle className="spin" size={26}/><strong>Lendo e validando a planilha…</strong><span>Nenhum dado é inventado durante a importação.</span></div>}
    {entryOpen && <EntryModal machines={machines} shifts={shifts} products={products} onClose={() => setEntryOpen(false)} onSubmit={addRecord}/>} 
    {assistantOpen && <AssistantPanel question={question} setQuestion={setQuestion} answer={answer} asking={asking} onClose={() => setAssistantOpen(false)} onAsk={askAssistant}/>} 
  </main>;
}

function EmptyState({ onImport, onEntry }: { onImport: () => void; onEntry: () => void }) { return <section className="empty-state"><div className="empty-icon"><FileSpreadsheet size={29}/></div><h2>Comece com os dados da operação</h2><p>Carregue a planilha do cliente para calcular o OEE com dados reais. O sistema apontará os campos ausentes antes de mostrar qualquer indicador.</p><div><button className="primary-button" onClick={onImport}><UploadCloud size={18}/>Carregar planilha Excel</button><button className="secondary-button" onClick={onEntry}><Plus size={18}/>Lançar registro manual</button></div><small>Aceita .xlsx, .xls e .csv. O arquivo original permanece rastreável.</small></section>; }

function Metric({ name, value, tone, note }: { name: string; value: number | null; tone: string; note: string }) { return <article className="metric-card"><div><p>{name}</p><strong className={tone}>{formatPercent(value)}</strong></div><span>{note}</span><div className="metric-track"><i className={tone} style={{ width: `${Math.min(100, Math.max(0, (value || 0) * 100))}%` }}/></div></article>; }

function Dashboard({ metrics, operational, records, lossData, machineData, scope, onNewAnalysis, onDeleteAnalysis }: { metrics: ReturnType<typeof calculateOee>; operational: { [key: string]: number }; records: number; lossData: { name: string; value: number }[]; machineData: { machine: string; oee: number }[]; scope: string; onNewAnalysis: () => void; onDeleteAnalysis: () => void }) { const constraint = [{ label: "Disponibilidade", value: metrics.availability }, { label: "Performance", value: metrics.performance }, { label: "Qualidade", value: metrics.quality }].filter((item): item is { label: string; value: number } => item.value !== null).sort((a, b) => a.value - b.value)[0]; const worstMachine = machineData.length ? [...machineData].sort((a, b) => a.oee - b.oee)[0] : null; return <div className="dashboard">
  <section className="hero-grid"><article className="oee-dial-card"><div><p className="section-kicker">OEE consolidado</p><h2>Visão atual da operação</h2><p className="caption">Resultado ponderado pelos registros filtrados.</p><p className="analysis-scope"><Filter size={13}/>{scope}</p><div className="analysis-actions"><button className="secondary-button" onClick={onNewAnalysis}><UploadCloud size={16}/>Nova análise</button><button className="danger-button" onClick={onDeleteAnalysis}>Excluir</button></div></div><div className="dial-wrap"><div className="dial" style={{ "--value": `${(metrics.oee || 0) * 360}deg` } as React.CSSProperties}><div><strong>{formatPercent(metrics.oee)}</strong><span>OEE</span></div></div><small>{records} registros analisados</small></div></article><article className="inputs-card"><p className="section-kicker">Base de cálculo</p><dl><div><dt>Tempo planejado</dt><dd>{metrics.plannedMinutes.toLocaleString("pt-BR")} min</dd></div><div><dt>Tempo operacional</dt><dd>{metrics.operatingMinutes.toLocaleString("pt-BR")} min</dd></div><div><dt>Produção boa</dt><dd>{metrics.goodCount.toLocaleString("pt-BR")} un</dd></div></dl></article></section>
  {metrics.missing.length > 0 && <div className="warning"><AlertTriangle size={18}/><span><strong>OEE parcial ou indisponível.</strong> Para calcular todos os componentes, revise: {metrics.missing.join(", ")}.</span></div>}
  <section className="metric-grid"><Metric name="Disponibilidade" value={metrics.availability} tone="green" note="Tempo operacional / planejado"/><Metric name="Performance" value={metrics.performance} tone="blue" note="Ciclo ideal x produção / operação"/><Metric name="Qualidade" value={metrics.quality} tone="amber" note="Unidades boas / total"/></section>
  <section className="decision-brief"><div className="decision-mark"><Gauge size={22}/></div><div><p className="section-kicker">Decisão sugerida</p><h2>{constraint ? `Priorize ${constraint.label.toLowerCase()}` : "Complete os dados para priorizar"}</h2><p>{constraint ? `${constraint.label} é hoje o componente mais limitante (${formatPercent(constraint.value)}).${lossData[0] ? ` A primeira investigação deve ser ${lossData[0].name.toLowerCase()}, com ${lossData[0].value.toLocaleString("pt-BR")} minutos registrados.` : ""}` : "O dashboard só recomenda ações quando os insumos mínimos estiverem completos."}</p></div>{worstMachine && <div className="machine-callout"><span>Menor OEE</span><strong>{worstMachine.machine}</strong><b>{worstMachine.oee.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</b></div>}</section>
  <section className="chart-grid"><article className="chart-card"><div className="card-heading"><div><p className="section-kicker">Prioridade de ação</p><h2>Maiores perdas</h2></div><span>minutos</span></div>{lossData.length ? <ResponsiveContainer width="100%" height={250}><BarChart data={lossData} layout="vertical" margin={{ left: 12, right: 22 }}><CartesianGrid horizontal={false} stroke="#e4e9e8"/><XAxis type="number" axisLine={false} tickLine={false}/><YAxis dataKey="name" type="category" width={105} axisLine={false} tickLine={false}/><Tooltip cursor={{ fill: "#eff4f2" }}/><Bar dataKey="value" radius={[0, 5, 5, 0]} fill="#d9574a" /></BarChart></ResponsiveContainer> : <ChartEmpty text="Não há minutos de perda com motivo nos registros filtrados."/>}</article><article className="chart-card"><div className="card-heading"><div><p className="section-kicker">Comparativo</p><h2>OEE por máquina</h2></div><span>%</span></div>{machineData.length ? <ResponsiveContainer width="100%" height={250}><BarChart data={machineData} margin={{ top: 10, right: 8, left: -22, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e4e9e8"/><XAxis dataKey="machine" axisLine={false} tickLine={false}/><YAxis axisLine={false} tickLine={false} domain={[0, 100]}/><Tooltip cursor={{ fill: "#eff4f2" }}/><Bar dataKey="oee" radius={[5, 5, 0, 0]} fill="#456f9a" /></BarChart></ResponsiveContainer> : <ChartEmpty text="Inclua a coluna Máquina para comparar os equipamentos."/>}</article></section>
  <section className="loss-summary"><div><p className="section-kicker">Leitura rápida</p><h2>Onde começar a melhoria</h2>{lossData[0] ? <p>O maior impacto registrado é <strong>{lossData[0].name}</strong>, com {lossData[0].value.toLocaleString("pt-BR")} minutos.</p> : <p>Adicione motivo e duração das paradas para priorizar as ações.</p>}</div>{lossData.length ? <ResponsiveContainer width="38%" height={135}><PieChart><Pie data={lossData} dataKey="value" nameKey="name" innerRadius={36} outerRadius={61} paddingAngle={3}>{lossData.map((_, index) => <Cell key={index} fill={lossColors[index % lossColors.length]}/>)}</Pie><Tooltip/></PieChart></ResponsiveContainer> : null}</section>
  <section className="details-section"><div className="details-heading"><div><p className="section-kicker">Base consolidada</p><h2>Detalhamento operacional</h2></div><span>Todos os valores seguem os filtros ativos</span></div><div className="detail-groups"><DetailGroup title="Tempo" items={[["Calendário", operational.calendar, "min"], ["Preventiva excluída", operational.preventive, "min"], ["Planejado", operational.planned, "min"], ["Em operação", operational.operating, "min"], ["Parado", operational.downtime, "min"]]}/><DetailGroup title="Produção e velocidade" items={[["Produção total", operational.total, "un"], ["Produção boa", operational.good, "un"], ["Refugo/retrabalho", operational.reject, "un"], ["Velocidade técnica", operational.technicalSpeed, "un/min"], ["Velocidade média", operational.averageSpeed, "un/min"]]}/><DetailGroup title="Perdas por causa" items={[["Setup", operational.setup, "min"], ["Quebra/manutenção", operational.breakdown, "min"], ["Limpeza", operational.cleaning, "min"], ["Ajustes", operational.adjustments, "min"], ["Falta matéria-prima", operational.material, "min"], ["Falta insumos", operational.supplies, "min"], ["Microparadas", operational.microstops, "min"]]}/><DetailGroup title="Cobertura" items={[["Registros", records, ""], ["Máquinas", operational.machines, ""], ["Grupos", operational.groups, ""], ["Produtos", operational.products, ""], ["Turnos", operational.shifts, ""]]}/></div></section>
</div>; }

function DetailGroup({ title, items }: { title: string; items: [string, number, string][] }) { return <article className="detail-group"><h3>{title}</h3><dl>{items.map(([label, value, unit]) => <div key={label}><dt>{label}</dt><dd>{value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}{unit ? <small> {unit}</small> : null}</dd></div>)}</dl></article>; }

function ChartEmpty({ text }: { text: string }) { return <div className="chart-empty"><BarChart3 size={25}/><span>{text}</span></div>; }

function ImportView({ upload, onChoose, onGoDashboard, onDelete, onMappingChange }: { upload: ParsedUpload | null; onChoose: () => void; onGoDashboard: () => void; onDelete: () => void; onMappingChange: (header: string, destination: string) => void }) {
  if (!upload) return <EmptyState onImport={onChoose} onEntry={() => {}}/>;
  const required = ["date", "machine", "plannedMinutes", "operatingMinutes", "technicalSpeed", "totalCount", "goodCount"];
  const mapped = Object.values(upload.mapped);
  const fields = Object.entries(fieldLabels).filter(([key]) => key !== "losses");
  const cloudLabel = upload.cloudStatus === "completed" ? "Arquivo e registros salvos no Supabase" : upload.cloudStatus === "saving" ? "Salvando arquivo no Supabase…" : upload.cloudStatus === "uploaded_pending_processing" ? "Arquivo salvo; Pandas será executado na implantação Vercel" : upload.cloudStatus === "failed" ? "Prévia local — falha no salvamento em nuvem" : "Resultados salvos neste navegador";
  return <div className="import-view">
    <section className="import-result"><div className="success-badge"><CheckCircle2 size={23}/></div><div><p className="section-kicker">{cloudLabel}</p><h2>{upload.fileName}</h2><p>Planilha <strong>{upload.sheet}</strong> · {upload.records.length} linhas reconhecidas{upload.cloudMessage ? ` · ${upload.cloudMessage}` : ""}</p></div><div className="import-actions"><button className="secondary-button" onClick={onChoose}><UploadCloud size={17}/>Nova análise / arquivo</button><button className="danger-button" onClick={onDelete}>Excluir análise</button></div></section>
    <section className="import-grid"><article className="mapping-card"><h2>Conferir e mapear colunas</h2><p>O sistema reconhece os nomes conhecidos automaticamente. Para cabeçalhos novos, escolha abaixo o campo equivalente. Uma coluna sem significado definido não entra no cálculo.</p><div className="mapping-list">{upload.headers.map((header) => <div key={header}><span>{header}</span><select aria-label={`Mapear ${header}`} value={upload.mapped[header] || ""} onChange={(event) => onMappingChange(header, event.target.value)}><option value="">Não usar nesta análise</option>{fields.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>)}</div></article><article className="quality-card"><h2>Validação inicial</h2><div className="validation"><div><span>Registros importados</span><strong>{upload.records.length}</strong></div><div><span>Linhas vazias/sem campos</span><strong>{upload.rejected}</strong></div><div><span>Campos essenciais mapeados</span><strong>{required.filter((item) => mapped.includes(item)).length}/{required.length}</strong></div></div><div className="info-note"><AlertTriangle size={17}/><p>Ao mudar um mapeamento, os registros e os indicadores são recalculados. Dados sem correspondência continuam fora do cálculo — nada é presumido.</p></div><button className="primary-button" onClick={onGoDashboard}><Gauge size={18}/>Ver indicadores</button></article></section>
  </div>;
}

function QualityView({ upload, metrics }: { upload: ParsedUpload | null; metrics: ReturnType<typeof calculateOee> }) { return <div className="quality-page"><section><p className="section-kicker">Rastreabilidade</p><h2>Dados que podem ser auditados</h2><p>O arquivo original, a regra de transformação e a linha de origem devem acompanhar cada registro após configurar o Supabase.</p></section><div className="quality-list"><article><FileSpreadsheet size={20}/><div><strong>Arquivo de origem</strong><span>{upload ? upload.fileName : "Nenhum arquivo importado"}</span></div></article><article><CheckCircle2 size={20}/><div><strong>Linhas processadas</strong><span>{upload ? `${upload.records.length} registros reconhecidos` : "Aguardando importação"}</span></div></article><article><AlertTriangle size={20}/><div><strong>Dados necessários</strong><span>{metrics.missing.length ? `Revisar: ${metrics.missing.join(", ")}` : "Campos suficientes para o cálculo completo"}</span></div></article></div></div>; }

function EntryPanel({ machines, onOpen }: { machines: string[]; onOpen: () => void }) { return <div className="entry-page"><section><div className="entry-icon"><ClipboardPlus size={28}/></div><p className="section-kicker">Registro no chão de fábrica</p><h2>Um lançamento rápido, sem planilhas complexas.</h2><p>O formulário usa as mesmas máquinas, turnos e produtos já identificados no arquivo carregado.</p><button className="primary-button" onClick={onOpen}><Plus size={18}/>Novo lançamento</button></section><aside><strong>Como funciona</strong><ol><li>Escolha a máquina e o turno.</li><li>Informe produção, refugo ou perda.</li><li>Salve. Os indicadores são atualizados.</li></ol></aside></div>; }

function EntryModal({ machines, shifts, products, onClose, onSubmit }: { machines: string[]; shifts: string[]; products: string[]; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) { const input = (name: string, label: string, type = "number", optional = true) => <label>{label}<input required={!optional} name={name} type={type} min={type === "number" ? "0" : undefined} step="any"/></label>; return <div className="modal-backdrop"><form className="entry-modal" onSubmit={onSubmit}><header><div><p className="section-kicker">Novo registro</p><h2>Produção e perdas</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={19}/></button></header><div className="form-grid"><label>Data<input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)}/></label><label>Máquina<select name="machine" required><option value="">Selecionar</option>{machines.map((machine) => <option key={machine}>{machine}</option>)}</select></label><label>Turno<select name="shift"><option value="">Selecionar</option>{shifts.map((shift) => <option key={shift}>{shift}</option>)}</select></label><label>Produto<select name="product"><option value="">Selecionar</option>{products.map((product) => <option key={product}>{product}</option>)}</select></label>{input("plannedMinutes", "Tempo planejado (min)", "number", false)}{input("totalCount", "Quantidade produzida", "number", false)}{input("goodCount", "Quantidade boa")}{input("rejectCount", "Refugo")}{input("idealCycleSeconds", "Ciclo ideal (seg.)")}{input("downtimeMinutes", "Paradas (min)")}{input("breakdownMinutes", "Quebras (min)")}{input("setupMinutes", "Setup (min)")}<label className="wide">Motivo da perda<input name="lossReason" placeholder="Ex.: ajuste de ferramenta"/></label></div><footer><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit">Salvar lançamento</button></footer></form></div>; }

function AssistantPanel({ question, setQuestion, answer, asking, onClose, onAsk }: { question: string; setQuestion: (value: string) => void; answer: string; asking: boolean; onClose: () => void; onAsk: (event: React.FormEvent) => void }) { return <div className="assistant-panel"><header><div><Bot size={20}/><div><strong>GAP Insight</strong><span>Leitura assistida dos dados filtrados</span></div></div><button className="icon-button" onClick={onClose}><X size={18}/></button></header><div className="assistant-body">{answer ? <p className="answer">{answer}</p> : <><p>Faça perguntas objetivas sobre o período filtrado.</p><button onClick={() => setQuestion("Qual é a maior perda e qual ação devo priorizar?")}>Qual perda devo priorizar?</button><button onClick={() => setQuestion("Os dados permitem calcular o OEE completo?")}>Os dados são suficientes?</button></>}</div><form onSubmit={onAsk}><input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Pergunte sobre a operação..."/><button aria-label="Enviar pergunta" disabled={asking}>{asking ? <LoaderCircle className="spin" size={18}/> : <Search size={18}/>}</button></form><small>Respostas baseadas apenas no resumo dos dados carregados.</small></div>; }
