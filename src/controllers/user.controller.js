/**
 * Controlador de usuarios: perfil propio y administracion de cuentas.
 *
 * Solo adapta HTTP al servicio y garantiza que todo usuario salga por
 * UserResponseDTO (nunca se devuelve el documento crudo).
 */
import {
  CreateUserDTO,
  ListUsersQueryDTO,
  UpdateProfileDTO,
  UpdateUserDTO,
  UserResponseDTO,
} from '../dtos/user.dto.js';
import { requestContext } from '../utils/request-context.js';

export class UserController {
  #users;

  /** @param {{ userService: import('../services/user.service.js').UserService }} deps */
  constructor({ userService }) {
    this.#users = userService;
  }

  /** GET /users/me */
  getMe = async (req, res) => {
    const user = await this.#users.getProfile(req.user);
    res.json({ data: UserResponseDTO.withPermissions(user) });
  };

  /** PATCH /users/me */
  updateMe = async (req, res) => {
    const user = await this.#users.updateProfile(req.user, UpdateProfileDTO.from(req.body), requestContext(req));
    res.json({ data: UserResponseDTO.from(user) });
  };

  /** GET /users */
  list = async (req, res) => {
    const { items, total, page, limit } = await this.#users.listUsers(ListUsersQueryDTO.from(req.query));
    res.json({
      data: UserResponseDTO.fromMany(items),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  };

  /** GET /users/:id */
  getById = async (req, res) => {
    const user = await this.#users.getUserById(req.params.id);
    res.json({ data: UserResponseDTO.from(user) });
  };

  /** POST /users */
  create = async (req, res) => {
    const user = await this.#users.createUser(req.user, CreateUserDTO.from(req.body), requestContext(req));
    res.status(201).location(`${req.baseUrl}/${user._id}`).json({ data: UserResponseDTO.from(user) });
  };

  /** PATCH /users/:id */
  update = async (req, res) => {
    const user = await this.#users.updateUser(req.user, req.params.id, UpdateUserDTO.from(req.body), requestContext(req));
    res.json({ data: UserResponseDTO.from(user) });
  };

  /** PATCH /users/:id/role */
  changeRole = async (req, res) => {
    const user = await this.#users.changeRole(req.user, req.params.id, req.body.role, requestContext(req));
    res.json({ data: UserResponseDTO.from(user) });
  };

  /** PATCH /users/:id/status */
  changeStatus = async (req, res) => {
    const user = await this.#users.changeStatus(req.user, req.params.id, req.body.isActive, requestContext(req));
    res.json({ data: UserResponseDTO.from(user) });
  };

  /**
   * DELETE /users/:id (borrado fisico, solo superusuario). Delega en la purga
   * de la Fase 4: exige borrado logico previo, respeta el bloqueo fiscal y
   * elimina el carrito en cascada. Sin cuerpo en la respuesta (204).
   */
  remove = async (req, res) => {
    await this.#users.deleteUser(req.user, req.params.id, requestContext(req));
    res.status(204).end();
  };
}
