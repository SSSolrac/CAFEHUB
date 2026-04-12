import { normalizeError } from '@/lib/errors';
import { asRecord, mapOrderRow } from '@/lib/mappers';
import { requireSupabaseClient } from '@/lib/supabase';
import { orderService } from '@/services/orderService';
import type { DashboardData, DateRangePreset } from '@/types/dashboard';
import type { Order } from '@/types/order';

const roundMoney = (value: number) => Math.round(value * 100) / 100;

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

const toDayKey = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const mapSalesTrend = (value: unknown): DashboardData['salesTrend'] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const r = asRecord(item) ?? {};
      const date = String(r.date ?? r.day ?? r.dayKey ?? r.label ?? '');
      const sales = Number(r.sales ?? r.amount ?? 0);
      return { date, sales: Number.isFinite(sales) ? roundMoney(Math.max(0, sales)) : 0 };
    })
    .filter((item) => Boolean(item.date));
};

const mapOrders = (value: unknown): Order[] => (Array.isArray(value) ? (value as unknown[]).map(mapOrderRow) : []);

const asTrimmed = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const attachOrderEmployees = async (orders: Order[]): Promise<Order[]> => {
  if (!orders.length) return orders;

  const supabase = requireSupabaseClient();
  const orderIds = orders.map((order) => order.id).filter(Boolean);
  if (!orderIds.length) return orders;

  const { data: historyRows, error: historyError } = await supabase
    .from('order_status_history')
    .select('order_id, changed_by, changed_at')
    .in('order_id', orderIds)
    .not('changed_by', 'is', null)
    .order('changed_at', { ascending: false });

  if (historyError || !Array.isArray(historyRows)) return orders;

  const changedByIds = Array.from(new Set(historyRows.map((row) => String(row.changed_by ?? '')).filter(Boolean)));
  if (!changedByIds.length) return orders;

  const { data: profileRows, error: profilesError } = await supabase
    .from('profiles')
    .select('id, name, role')
    .in('id', changedByIds)
    .in('role', ['owner', 'staff']);

  if (profilesError || !Array.isArray(profileRows)) return orders;

  const employeeById = new Map<string, string>(
    profileRows.map((row) => {
      const id = String(row.id ?? '');
      const name = asTrimmed(row.name) || 'Staff';
      return [id, name];
    }),
  );

  const employeeIdByOrderId = new Map<string, string>();
  for (const row of historyRows) {
    const orderId = String(row.order_id ?? '');
    const changedBy = String(row.changed_by ?? '');
    if (!orderId || !changedBy) continue;
    if (!employeeById.has(changedBy)) continue;
    if (!employeeIdByOrderId.has(orderId)) {
      employeeIdByOrderId.set(orderId, changedBy);
    }
  }

  return orders.map((order) => {
    const employeeId = employeeIdByOrderId.get(order.id) ?? null;
    return {
      ...order,
      employeeId,
      employeeName: employeeId ? employeeById.get(employeeId) ?? null : null,
    };
  });
};

const mapDashboardSummary = (payload: unknown): DashboardData => {
  const base = (Array.isArray(payload) ? payload[0] : payload) as unknown;
  const row = asRecord(base) ?? {};

  // Preferred: RPC already returns the canonical DashboardData shape (camelCase).
  const salesNested = asRecord(row.sales);
  const ordersNested = asRecord(row.orders);
  if (salesNested && ordersNested) {
    return {
      sales: {
        today: Number(salesNested.today ?? 0),
        rangeTotal: Number(salesNested.rangeTotal ?? 0),
        averageOrderValue: Number(salesNested.averageOrderValue ?? 0),
      },
      orders: {
        today: Number(ordersNested.today ?? 0),
        rangeTotal: Number(ordersNested.rangeTotal ?? 0),
        pending: Number(ordersNested.pending ?? 0),
        preparing: Number(ordersNested.preparing ?? 0),
        ready: Number(ordersNested.ready ?? 0),
        outForDelivery: Number(ordersNested.outForDelivery ?? 0),
        completed: Number(ordersNested.completed ?? 0),
        cancelled: Number(ordersNested.cancelled ?? 0),
      },
      topItems: Array.isArray(row.topItems)
        ? (row.topItems as unknown[]).map((item) => {
            const r = asRecord(item) ?? {};
            return { itemName: String(r.itemName ?? ''), quantity: Number(r.quantity ?? 0), revenue: Number(r.revenue ?? 0) };
          })
        : [],
      salesTrend: mapSalesTrend(row.salesTrend),
      rangeOrders: mapOrders(row.rangeOrders ?? row.range_orders ?? row.ordersList ?? row.orders_list),
      recentOrders: mapOrders(row.recentOrders),
      alerts: Array.isArray(row.alerts)
        ? (row.alerts as unknown[]).map((item) => {
            const r = asRecord(item) ?? {};
            return { id: String(r.id ?? ''), message: String(r.message ?? ''), type: (r.type as DashboardData['alerts'][number]['type']) ?? 'info' };
          })
        : [],
    };
  }

  // Fallback: RPC returns a flat, snake_case row.
  const topItemsRaw = (row.top_items ?? row.topItems) as unknown;
  const recentOrdersRaw = (row.recent_orders ?? row.recentOrders) as unknown;
  const alertsRaw = (row.alerts ?? row.alerts) as unknown;
  const salesTrendRaw = (row.sales_trend ?? row.salesTrend) as unknown;

  return {
    sales: {
      today: Number(row.sales_today ?? row.today_sales ?? 0),
      rangeTotal: Number(row.sales_range_total ?? row.range_sales ?? 0),
      averageOrderValue: Number(row.average_order_value ?? row.avg_order_value ?? 0),
    },
    orders: {
      today: Number(row.orders_today ?? 0),
      rangeTotal: Number(row.orders_range_total ?? row.orders_total ?? 0),
      pending: Number(row.orders_pending ?? 0),
      preparing: Number(row.orders_preparing ?? 0),
      ready: Number(row.orders_ready ?? 0),
      outForDelivery: Number(row.orders_out_for_delivery ?? row.orders_outForDelivery ?? 0),
      completed: Number(row.orders_completed ?? 0),
      cancelled: Number(row.orders_cancelled ?? 0),
    },
    topItems: Array.isArray(topItemsRaw)
      ? (topItemsRaw as unknown[]).map((item) => {
          const r = asRecord(item) ?? {};
          return {
            itemName: String(r.item_name ?? r.itemName ?? ''),
            quantity: Number(r.quantity ?? 0),
            revenue: Number(r.revenue ?? 0),
          };
        })
      : [],
    salesTrend: mapSalesTrend(salesTrendRaw),
    rangeOrders: mapOrders(row.range_orders ?? row.rangeOrders ?? row.orders_list ?? row.ordersList),
    recentOrders: mapOrders(recentOrdersRaw),
    alerts: Array.isArray(alertsRaw)
      ? (alertsRaw as unknown[]).map((item) => {
          const r = asRecord(item) ?? {};
          return { id: String(r.id ?? ''), message: String(r.message ?? ''), type: (r.type as DashboardData['alerts'][number]['type']) ?? 'info' };
        })
      : [],
  };
};

const summarizeOrders = (orders: Order[]) => {
  const todayStart = startOfToday();
  const dayTotals = new Map<string, number>();

  let salesToday = 0;
  let salesRange = 0;
  let ordersToday = 0;
  let pending = 0;
  let preparing = 0;
  let ready = 0;
  let outForDelivery = 0;
  let completed = 0;
  let cancelled = 0;

  for (const order of orders) {
    const amount = Number.isFinite(order.totalAmount) ? Math.max(0, order.totalAmount) : 0;
    const placedAt = new Date(order.placedAt || order.createdAt).getTime();
    const dayKey = toDayKey(order.placedAt || order.createdAt);

    salesRange += amount;
    if (Number.isFinite(placedAt) && placedAt >= todayStart) {
      salesToday += amount;
      ordersToday += 1;
    }

    if (dayKey) {
      dayTotals.set(dayKey, (dayTotals.get(dayKey) ?? 0) + amount);
    }

    if (order.status === 'pending') pending += 1;
    else if (order.status === 'preparing') preparing += 1;
    else if (order.status === 'ready') ready += 1;
    else if (order.status === 'out_for_delivery') outForDelivery += 1;
    else if (order.status === 'completed' || order.status === 'delivered') completed += 1;
    else if (order.status === 'cancelled') cancelled += 1;
  }

  const rangeTotal = orders.length;
  const salesTrend = Array.from(dayTotals.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, sales]) => ({ date, sales: roundMoney(sales) }));

  return {
    sales: {
      today: roundMoney(salesToday),
      rangeTotal: roundMoney(salesRange),
      averageOrderValue: rangeTotal > 0 ? roundMoney(salesRange / rangeTotal) : 0,
    },
    orders: {
      today: ordersToday,
      rangeTotal,
      pending,
      preparing,
      ready,
      outForDelivery,
      completed,
      cancelled,
    },
    salesTrend,
    recentOrders: orders.slice(0, 10),
  };
};

export const dashboardService = {
  async getDashboardData(range: DateRangePreset): Promise<DashboardData> {
    const supabase = requireSupabaseClient();

    const [rpcResult, derivedOrders] = await Promise.all([
      supabase.rpc('dashboard_summary', { range_key: range }),
      orderService.getOrders({ range, status: 'all' }).catch(() => null),
    ]);

    if (rpcResult.error) throw normalizeError(rpcResult.error, { fallbackMessage: 'Unable to load dashboard summary.' });

    const mapped = mapDashboardSummary(rpcResult.data);
    if (!derivedOrders) {
      return {
        ...mapped,
        rangeOrders: mapped.rangeOrders.length ? mapped.rangeOrders : mapped.recentOrders,
      };
    }

    const ordersWithEmployee = await attachOrderEmployees(derivedOrders);

    const summary = summarizeOrders(ordersWithEmployee);
    return {
      ...mapped,
      sales: summary.sales,
      orders: summary.orders,
      salesTrend: summary.salesTrend,
      rangeOrders: ordersWithEmployee,
      recentOrders: summary.recentOrders,
    };
  },
};
