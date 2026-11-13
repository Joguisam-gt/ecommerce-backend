/**
 * Controlador del directorio de clientes: adapta HTTP al servicio y garantiza
 * que todo cliente salga por CustomerDTO (lista blanca).
 */
import { CustomerDTO, ListCustomersQueryDTO, UpdateCustomerDTO } from '../dtos/customer.dto.js';
import { requestContext } from '../utils/request-context.js';

export class CustomerController {
  #customers;

  /** @param {{ customerService: import('../services/customer.service.js').CustomerService }} deps */
  constructor({ customerService }) {
    this.#customers = customerService;
  }

  /** GET /admin/customers */
  list = async (req, res) => {
    const { items, total, page, limit } = await this.#customers.listCustomers(ListCustomersQueryDTO.from(req.query));
    res.json({
      data: CustomerDTO.fromMany(items),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  };

  /** GET /admin/customers/:id */
  getById = async (req, res) => {
    const row = await this.#customers.getCustomer(req.params.id);
    res.json({ data: CustomerDTO.from(row), meta: {} });
  };

  /** PATCH /admin/customers/:id */
  update = async (req, res) => {
    const user = await this.#customers.updateCustomer(req.user, req.params.id, UpdateCustomerDTO.from(req.body), requestContext(req));
    res.json({ data: CustomerDTO.fromAccount(user), meta: {} });
  };

  /** PATCH /admin/customers/:id/deactivate (borrado logico) */
  deactivate = async (req, res) => {
    const user = await this.#customers.deactivateCustomer(req.user, req.params.id, requestContext(req));
    res.json({ data: CustomerDTO.fromAccount(user), meta: {} });
  };

  /** DELETE /admin/customers/:id (borrado fisico, solo superusuario) */
  remove = async (req, res) => {
    await this.#customers.deleteCustomer(req.user, req.params.id, requestContext(req));
    res.status(204).end();
  };
}
