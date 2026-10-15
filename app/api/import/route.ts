import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const allowedExtensions = [".xlsx", ".xls", ".csv"];

function safeFileName(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "-");
}

function configuration() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase ainda não foi configurado no servidor.");
  return { url, key };
}

export async function POST(request: Request) {
  try {
    const body = await request.formData();
    const file = body.get("file");
    const sheet = String(body.get("sheet") || "");
    const mapping = JSON.parse(String(body.get("mapping") || "{}"));
    if (!(file instanceof File)) return Response.json({ error: "Envie um arquivo Excel." }, { status: 400 });
    if (!allowedExtensions.some((extension) => file.name.toLowerCase().endsWith(extension))) {
      return Response.json({ error: "Formato não suportado. Envie .xlsx, .xls ou .csv." }, { status: 400 });
    }
    if (file.size > 12 * 1024 * 1024) return Response.json({ error: "O arquivo excede o limite de 12 MB." }, { status: 413 });

    const { url, key } = configuration();
    const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: existingOrganization, error: organizationError } = await admin
      .from("organizations").select("id").order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (organizationError) throw organizationError;
    let organizationId = existingOrganization?.id;
    if (!organizationId) {
      const { data, error } = await admin.from("organizations").insert({ name: "GAP — Operação Industrial" }).select("id").single();
      if (error) throw error;
      organizationId = data.id;
    }

    const storagePath = `imports/${crypto.randomUUID()}/${safeFileName(file.name)}`;
    const { error: uploadError } = await admin.storage.from("gap-imports").upload(storagePath, new Uint8Array(await file.arrayBuffer()), {
      contentType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false
    });
    if (uploadError) throw uploadError;

    const { data: job, error: jobError } = await admin.from("import_jobs").insert({
      organization_id: organizationId, file_name: file.name, storage_path: storagePath, status: "processing", mapping
    }).select("id").single();
    if (jobError) {
      await admin.storage.from("gap-imports").remove([storagePath]);
      throw jobError;
    }

    // The Pandas endpoint is supplied by Vercel's Python runtime. During local
    // Next development the original file and import job are still persisted;
    // the browser keeps its immediate preview and processing happens on deploy.
    if (process.env.VERCEL !== "1") {
      return Response.json({ status: "uploaded_pending_processing", importId: job.id });
    }
    const processor = await fetch(new URL("/api/process_import", request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-import-secret": key },
      body: JSON.stringify({ import_id: job.id, storage_path: storagePath, sheet })
    });
    const outcome = await processor.json();
    if (!processor.ok) return Response.json({ status: "processing_failed", importId: job.id, error: outcome.error || "Falha ao processar arquivo." }, { status: 502 });
    return Response.json({ status: "completed", importId: job.id, accepted: outcome.accepted, rejected: outcome.rejected || 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível salvar a importação.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const importId = new URL(request.url).searchParams.get("id");
    if (!importId) return Response.json({ error: "Informe o identificador da importação." }, { status: 400 });
    const { url, key } = configuration();
    const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: job, error: lookupError } = await admin.from("import_jobs").select("storage_path").eq("id", importId).maybeSingle();
    if (lookupError) throw lookupError;
    if (!job) return Response.json({ status: "already_deleted" });
    const { error: deleteError } = await admin.from("import_jobs").delete().eq("id", importId);
    if (deleteError) throw deleteError;
    // production_records uses ON DELETE CASCADE; remove the source spreadsheet too.
    const { error: storageError } = await admin.storage.from("gap-imports").remove([job.storage_path]);
    if (storageError) throw storageError;
    return Response.json({ status: "deleted" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível excluir a importação.";
    return Response.json({ error: message }, { status: 500 });
  }
}
