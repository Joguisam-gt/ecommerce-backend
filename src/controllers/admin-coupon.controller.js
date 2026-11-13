/**
 * Controlador de cupones del panel de administracion.
 * Solo adapta HTTP al servicio: sin reglas de negocio.
 */
import {
  ApplicableProductDTO,
  ApplicableProductsQueryDTO,
  CouponDTO,
  CreateCouponDTO,
  ListCouponsQueryDTO,
  UpdateCouponDTO,
} from '../dtos/admin-coupon.dto.js';
import { requestContext } from '../utils/request-context.js';

/**
 * Metadatos de paginacion.
 * @param {{ total: number, page: number, limit: number }} result
 */
const pageMeta = ({ total, page, limit }) => ({ total, page, limit, totalPages: Math.ceil(total / limit) });

export class AdminCouponController {
  #coupons;

  /** @param {{ adminCouponService: import('../services/admin-coupon.service.js').AdminCouponService }} deps */
  constructor({ adminCouponService }) {
    this.#coupons = adminCouponService;
  }

  /** GET /admin/coupons/applicable-products */
  listApplicableProducts = async (req, res) => {
    const result = await this.#coupons.listApplicableProducts(ApplicableProductsQueryDTO.from(req.query));
    res.json({ data: ApplicableProductDTO.fromMany(result.items), meta: pageMeta(result) });
  };

  /** GET /admin/coupons */
  list = async (req, res) => {
    const result = await this.#coupons.list(ListCouponsQueryDTO.from(req.query));
    res.json({ data: CouponDTO.fromMany(result.items), meta: pageMeta(result) });
  };

  /** GET /admin/coupons/:id */
  getById = async (req, res) => {
    const coupon = await this.#coupons.getById(req.params.id);
    res.json({ data: CouponDTO.from(coupon), meta: {} });
  };

  /** POST /admin/coupons */
  create = async (req, res) => {
    const coupon = await this.#coupons.create(req.user, CreateCouponDTO.from(req.body), requestContext(req));
    res.status(201).location(`${req.baseUrl}/${coupon._id}`).json({ data: CouponDTO.from(coupon), meta: {} });
  };

  /** PATCH /admin/coupons/:id */
  update = async (req, res) => {
    const coupon = await this.#coupons.update(req.user, req.params.id, UpdateCouponDTO.from(req.body), requestContext(req));
    res.json({ data: CouponDTO.from(coupon), meta: {} });
  };

  /** PATCH /admin/coupons/:id/deactivate */
  deactivate = async (req, res) => {
    const coupon = await this.#coupons.deactivate(req.user, req.params.id, requestContext(req));
    res.json({ data: CouponDTO.from(coupon), meta: {} });
  };
}
