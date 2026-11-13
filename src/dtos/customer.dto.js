/**
 * DTOs del directorio de clientes: parametros de listado, actualizacion y
 * respuesta (directorio con metricas y cuenta basica tras una mutacion).
 *
 * Respuesta en lista blanca: nunca salen passwordHash, tokenVersion ni datos
 * de bloqueo. El gasto total se expone en unidades decimales.
 */
import { fromCents, toCents } from '../utils/money.js';
import { compact, normalizePhone, normalizeText } from './normalizers.js';

export class ListCustomersQueryDTO {
  /** @param {Record<string, string>} query Query string validada. */
  static from(query) {
    const bool = (value) => (value === undefined ? undefined : value === true || value === 'true');
    const amount = (value) => (value === undefined ? undefined : toCents(Number(value)));
    return Object.freeze({
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      userCode: query.userCode?.trim() || undefined,
      name: query.name?.trim() || undefined,
      email: query.email?.trim() || undefined,
      phone: query.phone?.trim() || undefined,
      isActive: bool(query.isActive),
      includeInactive: bool(query.includeInactive) ?? false,
      preferredPaymentMethod: query.preferredPaymentMethod,
      minTotalSpentCents: amount(query.minTotalSpent),
      maxTotalSpentCents: amount(query.maxTotalSpent),
      minPurchasedItems: query.minPurchasedItems === undefined ? undefined : Number(query.minPurchasedItems),
    });
  }
}

export class UpdateCustomerDTO {
  /** @param {object} body Cuerpo validado. */
  static from(body) {
    let userCode;
    if (body.userCode === null) userCode = null;
    else if (body.userCode !== undefined) userCode = body.userCode.trim().toUpperCase();
    return Object.freeze(
      compact({
        firstName: body.firstName === undefined ? undefined : normalizeText(body.firstName),
        lastName: body.lastName === undefined ? undefined : normalizeText(body.lastName),
        phone: normalizePhone(body.phone),
        userCode,
      }),
    );
  }
}

export class CustomerDTO {
  /**
   * Fila del directorio (resultado de customerMetricsStages).
   * @param {object | null} row
   */
  static from(row) {
    if (!row) return null;
    return {
      id: row._id.toString(),
      userCode: row.userCode ?? row._id.toString(),
      name: row.name,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone ?? null,
      isActive: row.isActive,
      purchasedItems: row.purchasedItems ?? 0,
      returnedItems: row.returnedItems ?? 0,
      totalSpent: fromCents(row.totalSpentCents ?? 0),
      ordersCount: row.ordersCount ?? 0,
      preferredPaymentMethod: row.preferredPaymentMethod ?? null,
      paymentMethods: (row.paymentMethods ?? []).map((entry) => ({
        method: entry.method,
        orders: entry.orders,
        lastOrderAt: entry.lastOrderAt ?? null,
      })),
      createdAt: row.createdAt,
    };
  }

  /** @param {object[]} rows */
  static fromMany(rows) {
    return rows.map((row) => CustomerDTO.from(row));
  }

  /**
   * Cuenta basica tras una mutacion (documento de users, sin metricas).
   * @param {object | null} user
   */
  static fromAccount(user) {
    if (!user) return null;
    return {
      id: user._id.toString(),
      userCode: user.userCode ?? user._id.toString(),
      name: `${user.firstName} ${user.lastName}`,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone ?? null,
      isActive: user.isActive,
      updatedAt: user.updatedAt,
    };
  }
}
