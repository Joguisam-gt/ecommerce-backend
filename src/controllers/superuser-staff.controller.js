/**
 * Controlador de gestion de personal (Fase 4, /api/superuser/staff).
 *
 * Adapta HTTP a StaffService. Toda cuenta sale por UserResponseDTO (lista
 * blanca): nunca se expone passwordHash ni datos de sesion o bloqueo.
 */
import { CreateUserDTO, ListUsersQueryDTO, UserResponseDTO } from '../dtos/user.dto.js';
import { requestContext } from '../utils/request-context.js';

export class SuperuserStaffController {
  #staff;

  /** @param {{ staffService: import('../services/staff.service.js').StaffService }} deps */
  constructor({ staffService }) {
    this.#staff = staffService;
  }

  /** GET /superuser/staff */
  list = async (req, res) => {
    const { items, total, page, limit } = await this.#staff.listStaff(ListUsersQueryDTO.from(req.query));
    res.json({
      data: UserResponseDTO.fromMany(items),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  };

  /** POST /superuser/staff */
  create = async (req, res) => {
    const user = await this.#staff.createStaff(req.user, CreateUserDTO.from(req.body), requestContext(req));
    res.status(201).location(`${req.baseUrl}/${user._id}`).json({ data: UserResponseDTO.from(user) });
  };

  /** PATCH /superuser/staff/:id/role */
  changeRole = async (req, res) => {
    const user = await this.#staff.changeRole(req.user, req.params.id, req.body.role, requestContext(req));
    res.json({ data: UserResponseDTO.from(user) });
  };

  /** PATCH /superuser/staff/:id/status */
  changeStatus = async (req, res) => {
    const user = await this.#staff.changeStatus(req.user, req.params.id, req.body.isActive, requestContext(req));
    res.json({ data: UserResponseDTO.from(user) });
  };
}
