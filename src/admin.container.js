/**
 * Raiz de composicion del panel de administracion (Fase 3).
 *
 * Separada de container.js para mantener cada fase legible: recibe las
 * dependencias transversales ya construidas (auditoria, secuencias, ejecutor
 * de transacciones) y devuelve los controladores administrativos con las
 * claves que espera routes/admin.routes.js. Cualquier repositorio puede
 * sustituirse por un doble mediante "repositories" (mismo nombre de clave).
 */
import { AdminCouponController } from './controllers/admin-coupon.controller.js';
import { AdminInvoiceController } from './controllers/admin-invoice.controller.js';
import { AdminOrderController } from './controllers/admin-order.controller.js';
import { CustomerController } from './controllers/customer.controller.js';
import { InventoryController } from './controllers/inventory.controller.js';
import { PurchaseController } from './controllers/purchase.controller.js';
import { ReportController } from './controllers/report.controller.js';
import { SupplierController } from './controllers/supplier.controller.js';
import { AdminCouponRepository } from './repositories/admin-coupon.repository.js';
import { AdminInvoiceRepository } from './repositories/admin-invoice.repository.js';
import { AdminOrderRepository } from './repositories/admin-order.repository.js';
import { AdminProductQueryRepository } from './repositories/admin-product-query.repository.js';
import { CustomerRepository } from './repositories/customer.repository.js';
import { InventoryLossRepository } from './repositories/inventory-loss.repository.js';
import { InventoryStockRepository } from './repositories/inventory-stock.repository.js';
import { InventoryRepository } from './repositories/inventory.repository.js';
import { PurchaseRepository } from './repositories/purchase.repository.js';
import { ReportRepository } from './repositories/report.repository.js';
import { SupplierInvoiceRepository } from './repositories/supplier-invoice.repository.js';
import { SupplierRepository } from './repositories/supplier.repository.js';
import { AdminCouponService } from './services/admin-coupon.service.js';
import { AdminInvoiceService } from './services/admin-invoice.service.js';
import { CouponCodeGenerator } from './services/coupon-code.generator.js';
import { CustomerService } from './services/customer.service.js';
import { InventoryService } from './services/inventory.service.js';
import { OrderReconciliationService } from './services/order-reconciliation.service.js';
import { PurchaseService } from './services/purchase.service.js';
import { ReportService } from './services/report.service.js';
import { SupplierService } from './services/supplier.service.js';

/** Repositorios propios del panel: clave del contenedor -> clase concreta. */
const ADMIN_REPOSITORY_CLASSES = Object.freeze({
  adminOrderRepository: AdminOrderRepository,
  adminCouponRepository: AdminCouponRepository,
  adminProductQueryRepository: AdminProductQueryRepository,
  inventoryStockRepository: InventoryStockRepository,
  inventoryRepository: InventoryRepository,
  inventoryLossRepository: InventoryLossRepository,
  purchaseRepository: PurchaseRepository,
  supplierRepository: SupplierRepository,
  supplierInvoiceRepository: SupplierInvoiceRepository,
  customerRepository: CustomerRepository,
  adminInvoiceRepository: AdminInvoiceRepository,
  reportRepository: ReportRepository,
});

/**
 * Construye servicios y controladores del panel de administracion.
 * @param {{ pick: (name: string, Factory: Function) => object,
 *           sequenceRepository: object, transactionRunner: { run: Function },
 *           auditService: import('./services/audit.service.js').AuditService,
 *           storeConfig: object, clock?: () => Date }} deps
 *        pick resuelve cada repositorio: doble inyectado, clase real con db o marcador "no disponible".
 * @returns {{ services: Record<string, object>, controllers: Record<string, object> }}
 */
export function buildAdminModule({ pick, sequenceRepository, transactionRunner, auditService, storeConfig, clock }) {
  // Repositorios del panel (resueltos con la misma politica que el resto del contenedor).
  const repos = Object.fromEntries(
    Object.entries(ADMIN_REPOSITORY_CLASSES).map(([name, Factory]) => [name, pick(name, Factory)]),
  );

  // Dependencias comunes a los servicios transaccionales.
  const shared = { transactionRunner, auditService, clock };

  // Conciliacion de transferencias y cupones.
  const orderReconciliationService = new OrderReconciliationService({
    adminOrderRepository: repos.adminOrderRepository,
    inventoryStockRepository: repos.inventoryStockRepository,
    adminCouponRepository: repos.adminCouponRepository,
    ...shared,
  });
  const adminCouponService = new AdminCouponService({
    adminCouponRepository: repos.adminCouponRepository,
    adminProductQueryRepository: repos.adminProductQueryRepository,
    couponCodeGenerator: new CouponCodeGenerator(),
    auditService,
    clock,
  });

  // Inventario, mermas, compras a proveedores y proveedores.
  const inventoryService = new InventoryService({
    inventoryRepository: repos.inventoryRepository,
    inventoryStockRepository: repos.inventoryStockRepository,
    inventoryLossRepository: repos.inventoryLossRepository,
    ...shared,
  });
  const purchaseService = new PurchaseService({
    supplierRepository: repos.supplierRepository,
    inventoryRepository: repos.inventoryRepository,
    inventoryStockRepository: repos.inventoryStockRepository,
    purchaseRepository: repos.purchaseRepository,
    supplierInvoiceRepository: repos.supplierInvoiceRepository,
    sequenceRepository,
    storeConfig,
    ...shared,
  });
  const supplierService = new SupplierService({
    supplierRepository: repos.supplierRepository,
    inventoryRepository: repos.inventoryRepository,
    purchaseRepository: repos.purchaseRepository,
    sequenceRepository,
    ...shared,
  });

  // Clientes, facturacion y reportes.
  const customerService = new CustomerService({ customerRepository: repos.customerRepository, auditService, clock });
  const adminInvoiceService = new AdminInvoiceService({ adminInvoiceRepository: repos.adminInvoiceRepository });
  const reportService = new ReportService({ reportRepository: repos.reportRepository });

  return {
    services: {
      orderReconciliationService,
      adminCouponService,
      inventoryService,
      purchaseService,
      supplierService,
      customerService,
      adminInvoiceService,
      reportService,
    },
    controllers: {
      adminOrder: new AdminOrderController({ orderReconciliationService }),
      adminCoupon: new AdminCouponController({ adminCouponService }),
      inventory: new InventoryController({ inventoryService }),
      purchase: new PurchaseController({ purchaseService }),
      supplier: new SupplierController({ supplierService }),
      customer: new CustomerController({ customerService }),
      adminInvoice: new AdminInvoiceController({ adminInvoiceService }),
      report: new ReportController({ reportService }),
    },
  };
}
