/**
 * Enrutador del panel de administracion (Fase 3), montado en /api/v1/admin.
 *
 * Aplica en un unico punto las dos barreras comunes a todo el panel:
 * 1) authenticate: JWT valido y cuenta activa;
 * 2) requireRoles(admin, superuser): RBAC por rol, de modo que ningun cliente
 *    (rol user) alcanza ninguna ruta administrativa aunque tuviera el permiso.
 * Despues, cada sub-router exige el permiso fino de su modulo con authorize().
 *
 * | Prefijo     | Modulo                                   | Permiso base       |
 * |-------------|------------------------------------------|--------------------|
 * | /orders     | conciliacion de transferencias bancarias | orders:manage      |
 * | /coupons    | cupones y productos aplicables           | coupons:manage     |
 * | /inventory  | inventario y mermas                      | inventory:manage   |
 * | /purchases  | compras a proveedores                    | inventory:manage   |
 * | /suppliers  | proveedores                              | suppliers:manage   |
 * | /customers  | directorio de clientes                   | customers:manage   |
 * | /invoices   | facturacion                              | invoices:manage    |
 * | /reports    | reportes analiticos                      | reports:read       |
 */
import { Router } from 'express';
import { ROLES } from '../constants/roles.js';
import { requireRoles } from '../middlewares/authorize.js';
import { createAdminCouponRoutes } from './admin-coupon.routes.js';
import { createAdminInvoiceRoutes } from './admin-invoice.routes.js';
import { createAdminOrderRoutes } from './admin-order.routes.js';
import { createCustomerRoutes } from './customer.routes.js';
import { createInventoryRoutes } from './inventory.routes.js';
import { createPurchaseRoutes } from './purchase.routes.js';
import { createReportRoutes } from './report.routes.js';
import { createSupplierRoutes } from './supplier.routes.js';

/** Roles con acceso al panel de administracion. */
export const ADMIN_PANEL_ROLES = Object.freeze([ROLES.ADMIN, ROLES.SUPERUSER]);

/**
 * Construye el router del panel con los controladores administrativos del contenedor.
 * @param {{ controllers: Record<string, any>, authenticate: import('express').RequestHandler }} deps
 * @returns {Router}
 */
export function createAdminRoutes({ controllers, authenticate }) {
  const router = Router();

  // Barreras comunes: autenticacion JWT y RBAC por rol para todo el panel.
  router.use(authenticate, requireRoles(...ADMIN_PANEL_ROLES));

  // Modulos administrativos; cada uno declara su permiso fino por ruta.
  router.use('/orders', createAdminOrderRoutes({ adminOrderController: controllers.adminOrder }));
  router.use('/coupons', createAdminCouponRoutes({ adminCouponController: controllers.adminCoupon }));
  router.use('/inventory', createInventoryRoutes({ inventoryController: controllers.inventory }));
  router.use('/purchases', createPurchaseRoutes({ purchaseController: controllers.purchase }));
  router.use('/suppliers', createSupplierRoutes({ supplierController: controllers.supplier }));
  router.use('/customers', createCustomerRoutes({ customerController: controllers.customer }));
  router.use('/invoices', createAdminInvoiceRoutes({ adminInvoiceController: controllers.adminInvoice }));
  router.use('/reports', createReportRoutes({ reportController: controllers.report }));

  return router;
}
