import type { CsvImportType, CsvValidationResult, SalesImportMergeResult, SalesImportPreview } from '@/types/dashboard';
import { normalizeError } from '@/lib/errors';
import { asRecord } from '@/lib/mappers';
import { requireSupabaseClient } from '@/lib/supabase';

const splitCsvLine = (line: string): string[] => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      // Handle escaped quotes inside quoted fields.
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
};

const normalizeHeader = (header: string) =>
  header
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const asTrimmed = (value: unknown) => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim());

const pickFirst = (row: Record<string, string>, keys: string[]) => {
  for (const key of keys) {
    const value = asTrimmed(row[key]);
    if (value) return value;
  }
  return '';
};

const parseNumeric = (value: string): number | null => {
  const cleaned = value.replace(/[,\s₱$%]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseDateIso = (value: string): string | null => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const normalizeSalesStatus = (value: string) => {
  const raw = value.trim().toLowerCase().replace(/\s+/g, '_');
  if (!raw) return 'completed';
  if (raw === 'complete') return 'completed';
  if (raw === 'cancel' || raw === 'canceled') return 'cancelled';
  if (raw === 'out_for_delivery' || raw === 'out_for_del') return 'out_for_delivery';
  if (raw === 'completed' || raw === 'delivered' || raw === 'pending' || raw === 'preparing' || raw === 'ready' || raw === 'cancelled' || raw === 'refunded') {
    return raw;
  }
  return 'completed';
};

const normalizePaymentMethod = (value: string) => {
  const raw = value.trim().toLowerCase().replace(/\s+/g, '_');
  if (!raw) return 'unknown';
  return raw;
};

const normalizeSalesRow = (
  row: Record<string, string>,
): { ok: true; row: Record<string, string> } | { ok: false; reason: string } => {
  const dateText = pickFirst(row, ['date', 'transaction_date', 'order_date', 'business_date']);
  if (!dateText) return { ok: false, reason: 'Missing required value: date.' };
  const dateIso = parseDateIso(dateText);
  if (!dateIso) return { ok: false, reason: `Invalid date value: ${dateText}` };

  // Accept both strict template and exported summary layouts.
  const amountText = pickFirst(row, ['sales_total', 'net_sales', 'gross_sales', 'total_sales', 'sales']);
  if (!amountText) return { ok: false, reason: 'Missing required value: sales_total/net_sales/gross_sales.' };
  const amount = parseNumeric(amountText);
  if (amount == null) return { ok: false, reason: `Invalid sales amount: ${amountText}` };
  if (amount < 0) return { ok: false, reason: 'Sales amount cannot be negative.' };

  const paymentMethodText = pickFirst(row, ['payment_method', 'payment', 'payment_type', 'mode_of_payment']);
  const statusText = pickFirst(row, ['status', 'order_status']);
  const customerCode = pickFirst(row, ['customer_code', 'customer_id']);
  const itemCode = pickFirst(row, ['item_code', 'menu_item_code', 'product_code']);

  return {
    ok: true,
    row: {
      date: dateIso,
      sales_total: amount.toFixed(2),
      payment_method: normalizePaymentMethod(paymentMethodText),
      status: normalizeSalesStatus(statusText),
      customer_code: customerCode,
      item_code: itemCode,
    },
  };
};

const getDateBounds = (rows: Record<string, string>[]) => {
  if (!rows.length) return undefined;
  const dates = rows.map((row) => row.date).filter(Boolean);
  if (!dates.length) return undefined;
  return {
    start: String(dates.reduce((min, value) => (value < min ? value : min), dates[0])),
    end: String(dates.reduce((max, value) => (value > max ? value : max), dates[0])),
  };
};

export const csvImportService = {
  async parseCsvFile(file: File): Promise<Record<string, string>[]> {
    const text = await file.text();
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 2) return [];

    const rawHeaders = splitCsvLine(lines[0]);
    const headers = rawHeaders.map((header, index) => {
      const trimmed = asTrimmed(header);
      return trimmed || `column_${index + 1}`;
    });
    const normalizedHeaders = headers.map(normalizeHeader);

    return lines.slice(1).map((line) => {
      const values = splitCsvLine(line);
      return headers.reduce<Record<string, string>>((acc, header, index) => {
        const value = values[index] ?? '';
        acc[header] = value;

        const normalized = normalizedHeaders[index];
        if (normalized && !(normalized in acc)) {
          acc[normalized] = value;
        }

        return acc;
      }, {});
    });
  },

  validateImportedRows(type: CsvImportType, rows: Record<string, string>[]): CsvValidationResult {
    if (type !== 'sales') {
      const requiredColumns: Record<Exclude<CsvImportType, 'sales'>, string[]> = {
        orders: ['order_id', 'customer_name', 'total', 'status'],
        customers: ['customer_id', 'name', 'email'],
        'menu-items': ['item_name', 'category', 'price'],
      };
      const required = requiredColumns[type];
      const invalidRows: CsvValidationResult['invalidRows'] = [];
      const validRows: CsvValidationResult['validRows'] = [];

      rows.forEach((row, index) => {
        const missing = required.filter((column) => !asTrimmed(row[column]));
        if (missing.length) {
          invalidRows.push({ rowNumber: index + 2, reason: `Missing required column values: ${missing.join(', ')}`, row });
          return;
        }
        validRows.push(row);
      });

      return { validRows, invalidRows };
    }

    const invalidRows: CsvValidationResult['invalidRows'] = [];
    const validRows: CsvValidationResult['validRows'] = [];

    rows.forEach((row, index) => {
      const normalized = normalizeSalesRow(row);
      if (!normalized.ok) {
        invalidRows.push({ rowNumber: index + 2, reason: normalized.reason, row });
        return;
      }
      validRows.push(normalized.row);
    });

    return { validRows, invalidRows };
  },

  async previewSalesImport(rows: Record<string, string>[]): Promise<SalesImportPreview> {
    const { validRows, invalidRows } = this.validateImportedRows('sales', rows);

    return {
      validRows,
      invalidRows,
      summary: { totalRows: rows.length, validCount: validRows.length, invalidCount: invalidRows.length },
    };
  },

  async importSales(rows: Record<string, string>[], options?: { fileName?: string }): Promise<SalesImportMergeResult> {
    const supabase = requireSupabaseClient();
    const now = new Date().toISOString();
    const { validRows, invalidRows } = this.validateImportedRows('sales', rows);

    const asImportError = (error: unknown, fallback = 'Import failed.') => normalizeError(error, { fallbackMessage: fallback });

    const findMissingColumn = (error: unknown, relation: string) => {
      const message = String(asRecord(error)?.message ?? (error instanceof Error ? error.message : ''));
      const match = message.match(new RegExp(`column \\"(?<column>[a-zA-Z0-9_]+)\\" of relation \\"${relation}\\" does not exist`, 'i'));
      return match?.groups?.column ?? null;
    };

    const insertWithFallback = async (relation: string, payload: Record<string, unknown>) => {
      let attemptPayload = { ...payload };
      let lastError: unknown = null;

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const { data, error } = await supabase.from(relation).insert(attemptPayload).select('*').single();
        if (!error) return data;
        lastError = error;

        const missing = findMissingColumn(error, relation);
        if (!missing || !(missing in attemptPayload)) break;

        const { [missing]: _removed, ...next } = attemptPayload;
        attemptPayload = next;
      }

      throw lastError;
    };

    const user = await supabase.auth.getUser();
    if (user.error) throw asImportError(user.error, 'Unable to load session.');

    const batchPayload: Record<string, unknown> = {
      type: 'sales',
      file_name: options?.fileName ?? null,
      total_rows: rows.length,
      valid_rows: validRows.length,
      invalid_rows: invalidRows.length,
      created_by: user.data.user?.id ?? null,
      created_at: now,
    };

    let batchRow: Record<string, unknown>;
    try {
      batchRow = (await insertWithFallback('sales_import_batches', batchPayload)) as Record<string, unknown>;
    } catch (error) {
      throw asImportError(error, 'Unable to create import batch.');
    }

    const batchId = String(batchRow.id ?? '');

    if (invalidRows.length) {
      const errorRows = invalidRows.map((row) => ({
        batch_id: batchId || null,
        row_number: row.rowNumber,
        reason: row.reason,
        raw_row: row.row,
        created_at: now,
      }));

      const { error } = await supabase.from('import_errors').insert(errorRows);
      if (error) throw asImportError(error, 'Unable to write import errors.');
    }

    if (validRows.length) {
      const salesRows = validRows.map((row) => ({
        batch_id: batchId || null,
        date: row.date,
        sales_total: Number(row.sales_total ?? 0),
        payment_method: row.payment_method || 'unknown',
        status: row.status || 'completed',
        customer_code: row.customer_code || null,
        item_code: row.item_code || null,
        created_at: now,
      }));

      const { error } = await supabase.from('imported_sales_rows').insert(salesRows);
      if (error) throw asImportError(error, 'Unable to write imported sales rows.');
    }

    return {
      added: validRows.length,
      updated: 0,
      skipped: 0,
      affectedDateRange: getDateBounds(validRows),
    };
  },

  async listHistory(): Promise<Array<{ id: string; type: string; totalRows: number; validRows: number; invalidRows: number; importedAt: string }>> {
    try {
      const supabase = requireSupabaseClient();
      const now = new Date().toISOString();
      const { data, error } = await supabase.from('sales_import_batches').select('*').order('created_at', { ascending: false });
      if (error) return [];

      return (Array.isArray(data) ? data : []).map((row) => ({
        id: String((row as { id?: unknown }).id ?? ''),
        type: String((row as { type?: unknown }).type ?? 'sales'),
        totalRows: Number((row as { total_rows?: unknown; totalRows?: unknown }).total_rows ?? (row as { totalRows?: unknown }).totalRows ?? 0),
        validRows: Number((row as { valid_rows?: unknown; validRows?: unknown }).valid_rows ?? (row as { validRows?: unknown }).validRows ?? 0),
        invalidRows: Number((row as { invalid_rows?: unknown; invalidRows?: unknown }).invalid_rows ?? (row as { invalidRows?: unknown }).invalidRows ?? 0),
        importedAt: String(
          (row as { created_at?: unknown; imported_at?: unknown; importedAt?: unknown }).created_at
            ?? (row as { imported_at?: unknown }).imported_at
            ?? (row as { importedAt?: unknown }).importedAt
            ?? now,
        ),
      }));
    } catch {
      return [];
    }
  },

  async listImportedSalesRows(limit = 200): Promise<
    Array<{
      id: string;
      batchId: string;
      date: string;
      salesTotal: number;
      paymentMethod: string;
      status: string;
      customerCode: string | null;
      itemCode: string | null;
      createdAt: string;
    }>
  > {
    try {
      const supabase = requireSupabaseClient();
      const { data, error } = await supabase.from('imported_sales_rows').select('*').order('date', { ascending: false }).limit(limit);
      if (error) return [];

      return (Array.isArray(data) ? data : []).map((row) => ({
        id: String((row as { id?: unknown }).id ?? ''),
        batchId: String((row as { batch_id?: unknown; batchId?: unknown }).batch_id ?? (row as { batchId?: unknown }).batchId ?? ''),
        date: String((row as { date?: unknown }).date ?? ''),
        salesTotal: Number((row as { sales_total?: unknown; salesTotal?: unknown }).sales_total ?? (row as { salesTotal?: unknown }).salesTotal ?? 0),
        paymentMethod: String((row as { payment_method?: unknown; paymentMethod?: unknown }).payment_method ?? (row as { paymentMethod?: unknown }).paymentMethod ?? 'unknown'),
        status: String((row as { status?: unknown }).status ?? 'completed'),
        customerCode: (() => {
          const value = (row as { customer_code?: unknown; customerCode?: unknown }).customer_code ?? (row as { customerCode?: unknown }).customerCode;
          return value == null ? null : String(value);
        })(),
        itemCode: (() => {
          const value = (row as { item_code?: unknown; itemCode?: unknown }).item_code ?? (row as { itemCode?: unknown }).itemCode;
          return value == null ? null : String(value);
        })(),
        createdAt: String((row as { created_at?: unknown; createdAt?: unknown }).created_at ?? (row as { createdAt?: unknown }).createdAt ?? ''),
      }));
    } catch {
      return [];
    }
  },
};
