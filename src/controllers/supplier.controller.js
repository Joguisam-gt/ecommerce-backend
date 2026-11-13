/**
 * Controlador de proveedores (Fase 3): alta, consulta, actualizacion, baja
 * logica y borrado fisico. Solo adapta HTTP al servicio.
 */
import {
  CreateSupplierDTO,
  ListSuppliersQueryDTO,
  SupplierDetailDTO,
  SupplierDTO,
  UpdateSupplierDTO,
} from '../dtos/supplier.dto.js';
import { requestContext } from '../utils/request-context.js';

export class SupplierController {
  #suppliers;

  /** @param {{ supplierService: import('../services/supplier.service.js').SupplierService }} deps */
  constructor({ supplierService }) {
    this.#suppliers = supplierService;
  }

  /** POST /admin/suppliers */
  create = async (req, res) => {
    const supplier = await this.#suppliers.createSupplier(req.user, CreateSupplierDTO.from(req.body), requestContext(req));
    res.status(201).location(`${req.baseUrl}/${supplier._id}`).json({ data: SupplierDTO.from(supplier), meta: {} });
  };

  /** GET /admin/suppliers */
  list = async (req, res) => {
    const { items, total, page, limit } = await this.#suppliers.listSuppliers(ListSuppliersQueryDTO.from(req.query));
    res.json({ data: SupplierDTO.fromMany(items), meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  };

  /** GET /admin/suppliers/:id */
  getById = async (req, res) => {
    const supplier = await this.#suppliers.getSupplier(req.params.id);
    res.json({ data: SupplierDetailDTO.from(supplier), meta: {} });
  };

  /** PATCH /admin/suppliers/:id */
  update = async (req, res) => {
    const supplier = await this.#suppliers.updateSupplier(
      req.user,
      req.params.id,
      UpdateSupplierDTO.from(req.body),
      requestContext(req),
    );
    res.json({ data: SupplierDTO.from(supplier), meta: {} });
  };

  /** PATCH /admin/suppliers/:id/deactivate */
  deactivate = async (req, res) => {
    const supplier = await this.#suppliers.deactivateSupplier(req.user, req.params.id, requestContext(req));
    res.json({ data: SupplierDTO.from(supplier), meta: {} });
  };

  /** DELETE /admin/suppliers/:id (borrado fisico, solo superusuario) */
  remove = async (req, res) => {
    await this.#suppliers.deleteSupplier(req.user, req.params.id, requestContext(req));
    res.status(204).end();
  };
}
