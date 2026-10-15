export type OeeRecord = {
  id: string;
  sourceRecord?: string;
  date?: string;
  operationalMonth?: number;
  operationalWeek?: number;
  operationalDay?: number;
  machine?: string;
  shift?: string;
  shiftStart?: string;
  shiftEnd?: string;
  product?: string;
  group?: string;
  productionOrder?: string;
  plannedMinutes?: number;
  operatingMinutes?: number;
  downtimeMinutes?: number;
  breakdownMinutes?: number;
  setupMinutes?: number;
  cleaningMinutes?: number;
  adjustmentsMinutes?: number;
  materialShortageMinutes?: number;
  supplyShortageMinutes?: number;
  microstopsMinutes?: number;
  idealCycleSeconds?: number;
  technicalSpeed?: number;
  averageSpeed?: number;
  calendarMinutes?: number;
  preventiveExcludedMinutes?: number;
  totalCount?: number;
  goodCount?: number;
  rejectCount?: number;
  lossReason?: string;
  lossType?: string;
  context?: string;
  losses?: Record<string, number>;
  sourceRow?: number;
};

export type OeeResult = {
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  plannedMinutes: number;
  downtimeMinutes: number;
  operatingMinutes: number;
  totalCount: number;
  goodCount: number;
  missing: string[];
};

export const fieldLabels: Record<keyof Omit<OeeRecord, "id" | "sourceRow">, string> = {
  sourceRecord: "Registro de origem",
  date: "Data",
  operationalMonth: "Mês operacional",
  operationalWeek: "Semana operacional",
  operationalDay: "Dia operacional",
  machine: "Máquina",
  shift: "Turno",
  shiftStart: "Início do turno",
  shiftEnd: "Fim do turno",
  product: "Produto",
  group: "Grupo de máquinas",
  productionOrder: "Ordem de produção",
  plannedMinutes: "Tempo planejado (min)",
  operatingMinutes: "Tempo em operação (min)",
  downtimeMinutes: "Paradas (min)",
  breakdownMinutes: "Quebras (min)",
  setupMinutes: "Setup (min)",
  cleaningMinutes: "Limpeza (min)",
  adjustmentsMinutes: "Ajustes (min)",
  materialShortageMinutes: "Falta de matéria-prima (min)",
  supplyShortageMinutes: "Falta de insumos (min)",
  microstopsMinutes: "Microparadas (min)",
  idealCycleSeconds: "Ciclo ideal (s/un)",
  technicalSpeed: "Velocidade técnica (un/min)",
  averageSpeed: "Velocidade média (un/min)",
  calendarMinutes: "Tempo de calendário (min)",
  preventiveExcludedMinutes: "Preventiva excluída (min)",
  totalCount: "Quantidade total",
  goodCount: "Quantidade boa",
  rejectCount: "Refugo",
  lossReason: "Motivo da perda",
  lossType: "Tipo de perda",
  context: "Contexto",
  losses: "Detalhamento de perdas"
};

const aliases: Record<string, keyof OeeRecord> = {
  registro: "sourceRecord", "registro origem": "sourceRecord",
  data: "date", date: "date", dia: "date", "data producao": "date", "data produção": "date",
  "mes operacional": "operationalMonth", "mês operacional": "operationalMonth", "semana operacional": "operationalWeek", "dia operacional": "operationalDay",
  maquina: "machine", "máquina": "machine", equipamento: "machine", linha: "machine",
  turno: "shift", shift: "shift",
  "inicio turno": "shiftStart", "início turno": "shiftStart", "fim turno": "shiftEnd",
  produto: "product", item: "product", sku: "product", grupo: "group", group: "group",
  "ordem producao": "productionOrder", "ordem produção": "productionOrder",
  "tempo planejado": "plannedMinutes", "tempo programado": "plannedMinutes", "minutos planejados": "plannedMinutes", "planned time": "plannedMinutes",
  "tempo disponivel": "plannedMinutes", "tempo disponível": "plannedMinutes",
  "tempo em operacao": "operatingMinutes", "tempo em operação": "operatingMinutes", "operating time": "operatingMinutes",
  "tempo parada": "downtimeMinutes", "tempo de parada": "downtimeMinutes", "parada min": "downtimeMinutes", "downtime": "downtimeMinutes",
  "tempo quebra": "breakdownMinutes", "quebra min": "breakdownMinutes", "quebra manutencao": "breakdownMinutes", "quebra manutenção": "breakdownMinutes", "breakdown": "breakdownMinutes",
  setup: "setupMinutes", "tempo setup": "setupMinutes", "tempo de setup": "setupMinutes",
  limpeza: "cleaningMinutes", ajustes: "adjustmentsMinutes", "falta materia prima": "materialShortageMinutes", "falta matéria prima": "materialShortageMinutes", "falta insumos": "supplyShortageMinutes", microparadas: "microstopsMinutes",
  "ciclo ideal": "idealCycleSeconds", "tempo ciclo ideal": "idealCycleSeconds", "ideal cycle": "idealCycleSeconds",
  "velocidade tecnica": "technicalSpeed", "velocidade técnica": "technicalSpeed", "capacidade maxima": "technicalSpeed", "capacidade máxima": "technicalSpeed",
  "velocidade media": "averageSpeed", "velocidade média": "averageSpeed",
  "tempo calendario": "calendarMinutes", "tempo calendário": "calendarMinutes", "preventiva excluida": "preventiveExcludedMinutes", "preventiva excluída": "preventiveExcludedMinutes",
  "quantidade total": "totalCount", "qtd total": "totalCount", "produção total": "totalCount", "producao total": "totalCount", producao: "totalCount", "produção": "totalCount",
  "quantidade boa": "goodCount", "producao boa": "goodCount", "produção boa": "goodCount", "qtd boa": "goodCount", aprovados: "goodCount", boas: "goodCount",
  refugo: "rejectCount", rejeitos: "rejectCount", "quantidade refugado": "rejectCount", "refugo e retrabalho": "rejectCount", perdas: "rejectCount",
  motivo: "lossReason", "motivo parada": "lossReason", "causa parada": "lossReason", causa: "lossReason", contexto: "context",
  "tipo perda": "lossType", "tipo de perda": "lossType", categoria: "lossType", classificacao: "lossType", "classificação": "lossType"
};

export function normaliseHeader(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function detectMapping(headers: string[]) {
  return headers.reduce<Record<string, keyof OeeRecord>>((mapping, header) => {
    const normalized = normaliseHeader(header);
    const exact = aliases[normalized];
    if (exact) mapping[header] = exact;
    else {
      // A prefix match permits units such as "(min)" without treating the
      // word "dia" inside "média" as a date field.
      const match = Object.entries(aliases)
        .filter(([key]) => key.length >= 4 && (normalized.startsWith(`${key} `) || normalized.startsWith(`${key}(`)))
        .sort(([a], [b]) => b.length - a.length)[0];
      if (match) mapping[header] = match[1];
    }
    return mapping;
  }, {});
}

export function numberValue(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const raw = String(value).trim().replace(/\\./g, "").replace(",", ".");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function dateValue(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  const raw = String(value).trim();
  const br = raw.match(/^(\\d{1,2})[/-](\\d{1,2})[/-](\\d{2,4})$/);
  if (br) return `${br[3].length === 2 ? `20${br[3]}` : br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  const date = new Date(raw);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString().slice(0, 10);
}

export function calculateOee(records: OeeRecord[]): OeeResult {
  const sum = (key: keyof OeeRecord) => records.reduce<number>((total, item) => total + (typeof item[key] === "number" ? Number(item[key]) : 0), 0);
  const plannedMinutes = sum("plannedMinutes");
  const explicitDowntime = sum("downtimeMinutes");
  const componentDowntime = sum("breakdownMinutes") + sum("setupMinutes");
  const recordedOperating = sum("operatingMinutes");
  const downtimeMinutes = recordedOperating > 0 ? Math.max(0, plannedMinutes - recordedOperating) : (explicitDowntime || componentDowntime);
  const operatingMinutes = recordedOperating > 0 ? recordedOperating : Math.max(0, plannedMinutes - downtimeMinutes);
  const totalCount = sum("totalCount");
  const explicitGood = sum("goodCount");
  const rejects = sum("rejectCount");
  const goodCount = explicitGood || (totalCount > 0 && rejects >= 0 ? Math.max(0, totalCount - rejects) : 0);
  const weightedIdealSeconds = records.reduce((total, item) => total + ((item.idealCycleSeconds || 0) * (item.totalCount || 0)), 0);
  const technicalCapacity = records.reduce((total, item) => total + ((item.technicalSpeed || 0) * (item.operatingMinutes || Math.max(0, (item.plannedMinutes || 0) - (item.downtimeMinutes || 0)))), 0);
  const hasQualityInput = records.some((item) => item.goodCount !== undefined || item.rejectCount !== undefined);
  const availability = plannedMinutes > 0 ? operatingMinutes / plannedMinutes : null;
  const performance = operatingMinutes > 0 && weightedIdealSeconds > 0 && totalCount > 0
    ? (weightedIdealSeconds / 60) / operatingMinutes
    : technicalCapacity > 0 && totalCount > 0 ? totalCount / technicalCapacity : null;
  const quality = totalCount > 0 && hasQualityInput ? goodCount / totalCount : null;
  const missing: string[] = [];
  if (!plannedMinutes) missing.push("tempo planejado");
  if (!recordedOperating && !downtimeMinutes && !records.some((r) => r.downtimeMinutes === 0 || r.breakdownMinutes === 0 || r.setupMinutes === 0)) missing.push("tempo de parada, quebra ou setup");
  if (!weightedIdealSeconds && !technicalCapacity) missing.push("ciclo ideal ou velocidade técnica");
  if (!totalCount) missing.push("quantidade produzida");
  if (!hasQualityInput) missing.push("quantidade boa ou refugo");
  return {
    availability, performance, quality,
    oee: availability !== null && performance !== null && quality !== null ? availability * performance * quality : null,
    plannedMinutes, downtimeMinutes, operatingMinutes, totalCount, goodCount, missing
  };
}

export function formatPercent(value: number | null) {
  return value === null || Number.isNaN(value) ? "—" : `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}
