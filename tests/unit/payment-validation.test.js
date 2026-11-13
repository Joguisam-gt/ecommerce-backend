/**
 * Pruebas de la validacion de pagos del checkout: esquemas por metodo,
 * guardia PCI-DSS, cabecera Idempotency-Key, CheckoutDTO y pasarelas de pago.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CheckoutDTO } from '../../src/dtos/checkout.dto.js';
import { containsPossiblePan, passesLuhn, pciGuard } from '../../src/middlewares/pci-guard.js';
import { validateCheckout } from '../../src/middlewares/validate-checkout.js';
import {
  HttpPaymentGateway,
  SimulatedPaymentGateway,
  createPaymentGateway,
} from '../../src/services/payments/payment-gateway.js';
import { HttpError } from '../../src/utils/http-error.js';
import { listInvoicesQuerySchema } from '../../src/validators/invoice.validator.js';
import { validateSchema } from '../../src/validators/schema-validator.js';

/** PAN de prueba de Visa (pasa Luhn). Nunca debe aparecer en una respuesta. */
const TEST_PAN = '4111111111111111';

/**
 * Ejecuta un middleware sincrono y devuelve lo que paso a next().
 * @param {Function} middleware
 * @param {object} body
 * @param {Record<string, string>} [headers]
 */
function run(middleware, body, headers = {}) {
  let received = 'no-llamado';
  const req = { body, query: {}, get: (name) => headers[name] };
  middleware(req, {}, (arg) => {
    received = arg;
  });
  return received;
}

/** Campos con error de una respuesta VALIDATION_ERROR. */
const fieldsOf = (error) => error.details.map((detail) => detail.field);

const codBody = (overrides = {}) => ({
  paymentMethod: 'cash_on_delivery',
  customerName: 'Ana Perez',
  email: 'ana@example.com',
  phone: '+502 5555-1234',
  shippingAddress: { line1: '5a Avenida 10-20', city: 'Guatemala', country: 'GT' },
  ...overrides,
});

const cardBody = (payment = {}, overrides = {}) => ({
  paymentMethod: 'card',
  payment: { paymentToken: 'tok_visa_approved_01', last4: '4242', cardHolderName: 'Ana Perez', cardBrand: 'Visa', ...payment },
  ...overrides,
});

const transferBody = (payment = {}, overrides = {}) => ({
  paymentMethod: 'bank_transfer',
  payment: {
    bankName: 'G&T',
    senderAccountNumber: '01-2345678-9',
    transferAmount: 250.5,
    authorizationNumber: 'AUT-12345',
    receiptUrl: 'https://banco.example.com/r/12345',
    ...payment,
  },
  ...overrides,
});

describe('validateCheckout: esquemas por metodo de pago', () => {
  it('acepta un cuerpo valido de cada metodo', () => {
    assert.equal(run(validateCheckout, codBody()), undefined);
    assert.equal(run(validateCheckout, cardBody()), undefined);
    assert.equal(run(validateCheckout, transferBody()), undefined);
  });

  it('paymentMethod desconocido o ausente -> 400 VALIDATION_ERROR', () => {
    for (const body of [{ ...codBody(), paymentMethod: 'bitcoin' }, { customerName: 'Ana' }, { paymentMethod: ['card'] }]) {
      const error = run(validateCheckout, body);
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.deepEqual(fieldsOf(error), ['paymentMethod']);
    }
  });

  it('contra entrega exige nombre, correo, telefono y direccion', () => {
    const error = run(validateCheckout, { paymentMethod: 'cash_on_delivery' });
    assert.deepEqual(fieldsOf(error).sort(), ['customerName', 'email', 'phone', 'shippingAddress']);
    const noPhone = run(validateCheckout, codBody({ phone: undefined }));
    assert.deepEqual(fieldsOf(noPhone), ['phone']);
  });

  it('contra entrega no admite datos de pago', () => {
    const error = run(validateCheckout, codBody({ payment: { reference: 'x' } }));
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.ok(fieldsOf(error).includes('payment'));
  });

  it('valida la direccion anidada (pais ISO2)', () => {
    const error = run(validateCheckout, codBody({ shippingAddress: { line1: 'x', city: 'y', country: 'GTM', extra: 1 } }));
    assert.deepEqual(fieldsOf(error).sort(), ['shippingAddress.country', 'shippingAddress.extra']);
  });

  it('tarjeta: payment obligatorio con exactamente los campos permitidos', () => {
    assert.deepEqual(fieldsOf(run(validateCheckout, { paymentMethod: 'card' })), ['payment']);
    const extra = run(validateCheckout, cardBody({ fingerprint: 'abc' }));
    assert.deepEqual(fieldsOf(extra), ['payment.fingerprint']);
  });

  it('tarjeta: marca fuera del enum, last4 invalido y token con forma de PAN', () => {
    const error = run(validateCheckout, cardBody({ cardBrand: 'Discover', last4: '42a2', paymentToken: '4111111111111112' }));
    assert.deepEqual(fieldsOf(error).sort(), ['payment.cardBrand', 'payment.last4', 'payment.paymentToken']);
    // El mensaje nunca repite el valor recibido.
    assert.equal(JSON.stringify(error.details).includes('4111111111111112'), false);
  });

  it('transferencia: banco fuera del enum', () => {
    assert.deepEqual(fieldsOf(run(validateCheckout, transferBody({ bankName: 'Banco Falso' }))), ['payment.bankName']);
  });

  it('transferencia: receiptUrl debe ser https', () => {
    assert.deepEqual(fieldsOf(run(validateCheckout, transferBody({ receiptUrl: 'http://banco.example.com/r/1' }))), [
      'payment.receiptUrl',
    ]);
    assert.deepEqual(fieldsOf(run(validateCheckout, transferBody({ receiptUrl: 'no es una url' }))), ['payment.receiptUrl']);
    assert.deepEqual(fieldsOf(run(validateCheckout, transferBody({ receiptUrl: 'javascript:alert(1)' }))), ['payment.receiptUrl']);
  });

  it('transferencia: monto con 3 decimales, cero, negativo o como texto', () => {
    for (const transferAmount of [10.123, 0, -5, '250.50']) {
      assert.deepEqual(fieldsOf(run(validateCheckout, transferBody({ transferAmount }))), ['payment.transferAmount']);
    }
  });

  it('transferencia: cuenta y autorizacion con formato invalido', () => {
    const error = run(validateCheckout, transferBody({ senderAccountNumber: '12a', authorizationNumber: 'a b' }));
    assert.deepEqual(fieldsOf(error).sort(), ['payment.authorizationNumber', 'payment.senderAccountNumber']);
  });

  it('valida NIT guatemalteco y CF', () => {
    for (const nit of ['1234567-8', '12345678', '1234567-K', '1234567k', 'CF']) {
      assert.equal(run(validateCheckout, codBody({ nit })), undefined, nit);
    }
    for (const nit of ['ABC', '12-34-5', '1234567890123-4', 'cf ']) {
      assert.deepEqual(fieldsOf(run(validateCheckout, codBody({ nit }))), ['nit'], nit);
    }
  });

  it('valida la cabecera Idempotency-Key', () => {
    assert.equal(run(validateCheckout, codBody(), { 'Idempotency-Key': 'abc_DEF-123' }), undefined);
    for (const key of ['short', 'x'.repeat(101), 'con espacios 123', 'k3y;DROP']) {
      assert.deepEqual(fieldsOf(run(validateCheckout, codBody(), { 'Idempotency-Key': key })), ['Idempotency-Key'], key);
    }
  });
});

describe('pciGuard', () => {
  it('algoritmo de Luhn y deteccion de PAN con separadores', () => {
    assert.equal(passesLuhn(TEST_PAN), true);
    assert.equal(passesLuhn('4111111111111112'), false);
    assert.equal(containsPossiblePan('mi tarjeta 4111 1111 1111 1111 gracias'), true);
    assert.equal(containsPossiblePan('4111-1111-1111-1111'), true);
    assert.equal(containsPossiblePan('378282246310005'), true); // Amex de prueba
    assert.equal(containsPossiblePan('pedido 2026-11-12, tel +502 5555-1234'), false);
    assert.equal(containsPossiblePan('4111111111111112'), false);
  });

  it('rechaza claves prohibidas en cualquier nivel y sin distinguir mayusculas', () => {
    for (const payment of [
      { cardNumber: '1' },
      { CVV: '123' },
      { cvc2: '123' },
      { card_number: 'x' },
      { securityCode: '1' },
      { expMonth: 12 },
      { details: { Expiry: '12/30' } },
      { list: [{ pin: '1234' }] },
    ]) {
      const error = run(pciGuard, cardBody(payment));
      assert.ok(error instanceof HttpError, JSON.stringify(Object.keys(payment)));
      assert.equal(error.status, 400);
      assert.equal(error.code, 'PCI_DATA_FORBIDDEN');
      assert.equal(error.details[0].reason, 'forbidden_key');
    }
  });

  it('rechaza cvv y numero de tarjeta en la raiz del cuerpo', () => {
    assert.equal(run(pciGuard, { ...cardBody(), cvv: '123' }).code, 'PCI_DATA_FORBIDDEN');
    assert.equal(run(pciGuard, { ...cardBody(), number: TEST_PAN }).code, 'PCI_DATA_FORBIDDEN');
  });

  it('rechaza un PAN valido por Luhn dentro de cardHolderName o notes sin repetir el valor', () => {
    const inHolder = run(pciGuard, cardBody({ cardHolderName: `Ana ${TEST_PAN}` }));
    assert.equal(inHolder.code, 'PCI_DATA_FORBIDDEN');
    assert.deepEqual(inHolder.details, [{ field: 'payment.cardHolderName', reason: 'possible_pan' }]);

    const inNotes = run(pciGuard, codBody({ notes: 'cobrar a 4111 1111 1111 1111' }));
    assert.equal(inNotes.code, 'PCI_DATA_FORBIDDEN');
    assert.equal(inNotes.details[0].field, 'notes');

    for (const error of [inHolder, inNotes]) {
      const serialized = JSON.stringify({ message: error.message, details: error.details });
      assert.equal(serialized.includes('4111'), false);
    }
  });

  it('rechaza un PAN enviado como numero JSON', () => {
    assert.equal(run(pciGuard, codBody({ notes: undefined, reference: Number(TEST_PAN) })).code, 'PCI_DATA_FORBIDDEN');
  });

  it('no dispara con senderAccountNumber ni authorizationNumber largos', () => {
    const body = transferBody({ senderAccountNumber: TEST_PAN, authorizationNumber: '4111-1111-1111-1111' });
    assert.equal(run(pciGuard, body), undefined);
  });

  it('deja pasar cuerpos legitimos de los tres metodos', () => {
    assert.equal(run(pciGuard, codBody({ notes: 'Entregar despues de las 18:00, casa 12' })), undefined);
    assert.equal(run(pciGuard, cardBody()), undefined);
    assert.equal(run(pciGuard, transferBody()), undefined);
  });
});

describe('CheckoutDTO', () => {
  it('normaliza correo, NIT, pais y monto de la transferencia y se congela', () => {
    const dto = CheckoutDTO.from(
      transferBody(
        { transferAmount: 250.5 },
        {
          email: '  Ana@Example.COM ',
          nit: '1234567-k',
          shippingAddress: { line1: '  Calle  1 ', city: 'Xela', country: 'gt' },
        },
      ),
      'idem-key-0001',
    );
    assert.equal(dto.email, 'ana@example.com');
    assert.equal(dto.nit, '1234567-K');
    assert.deepEqual(dto.shippingAddress, { line1: 'Calle 1', line2: null, city: 'Xela', state: null, postalCode: null, country: 'GT' });
    assert.equal(dto.payment.transferAmountCents, 25050);
    assert.equal('transferAmount' in dto.payment, false);
    assert.equal(dto.idempotencyKey, 'idem-key-0001');
    assert.equal(Object.isFrozen(dto), true);
    assert.equal(Object.isFrozen(dto.payment), true);
  });

  it('contra entrega sin datos de pago y opcionales en null', () => {
    const dto = CheckoutDTO.from({ paymentMethod: 'cash_on_delivery', customerName: 'Ana', email: 'a@b.co', phone: '5555 1234' });
    assert.equal(dto.payment, null);
    assert.equal(dto.nit, null);
    assert.equal(dto.entityName, null);
    assert.equal(dto.notes, null);
    assert.equal(dto.idempotencyKey, null);
  });
});

describe('SimulatedPaymentGateway', () => {
  it('aprueba, rechaza o falla segun el prefijo del token y registra los voids', async () => {
    const gateway = new SimulatedPaymentGateway();
    const base = { amountCents: 1000, currency: 'GTQ', cardBrand: 'Visa', last4: '4242', idempotencyKey: undefined };

    const ok = await gateway.charge({ ...base, paymentToken: 'tok_ok_000001' });
    assert.equal(ok.approved, true);
    assert.match(ok.transactionId, /^sim_[0-9a-f-]{36}$/);
    assert.equal(ok.authorizationCode.length, 6);

    const declined = await gateway.charge({ ...base, paymentToken: 'tok_decline_1' });
    assert.deepEqual([declined.approved, declined.declineCode], [false, 'card_declined']);
    const insufficient = await gateway.charge({ ...base, paymentToken: 'tok_insufficient_1' });
    assert.equal(insufficient.declineCode, 'insufficient_funds');
    await assert.rejects(gateway.charge({ ...base, paymentToken: 'tok_error_1' }));

    assert.deepEqual(await gateway.voidCharge({ transactionId: ok.transactionId, reason: 'test' }), { voided: true });
    assert.deepEqual(await gateway.voidCharge({ transactionId: 'desconocido', reason: 'test' }), { voided: false });
    assert.deepEqual(gateway.voided, [ok.transactionId]);
  });

  it('una clave de idempotencia repetida devuelve el mismo cargo', async () => {
    const gateway = new SimulatedPaymentGateway();
    const request = { amountCents: 1000, currency: 'GTQ', paymentToken: 'tok_ok_000001', idempotencyKey: 'k-1' };
    const first = await gateway.charge(request);
    const second = await gateway.charge(request);
    assert.equal(second.transactionId, first.transactionId);
    assert.equal(gateway.charges.length, 1);
  });
});

describe('HttpPaymentGateway', () => {
  /**
   * fetch falso que registra las llamadas y responde lo indicado.
   * @param {(url: string, init: object) => Promise<object>} respond
   */
  const fakeFetch = (respond) => {
    const calls = [];
    const impl = async (url, init) => {
      calls.push({ url, init });
      return respond(url, init);
    };
    return { calls, impl };
  };

  /** Respuesta HTTP minima compatible con fetch. */
  const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  const chargeRequest = {
    amountCents: 11200,
    currency: 'GTQ',
    paymentToken: 'tok_live_abc12345',
    cardBrand: 'Visa',
    last4: '4242',
    idempotencyKey: 'chk_user_key-0001',
    description: 'Compra POS',
  };

  it('envia Authorization Bearer, Idempotency-Key, JSON y un AbortSignal', async () => {
    const fetch = fakeFetch(async () => jsonResponse(200, { approved: true, transactionId: 'tx_1', authorizationCode: 'A1B2C3' }));
    const gateway = new HttpPaymentGateway({ url: 'https://pagos.example.com/v1/', apiKey: 'sk_test_123', timeoutMs: 500, fetchImpl: fetch.impl });

    const result = await gateway.charge(chargeRequest);
    assert.deepEqual(result, { approved: true, transactionId: 'tx_1', authorizationCode: 'A1B2C3' });

    const [{ url, init }] = fetch.calls;
    assert.equal(url, 'https://pagos.example.com/v1/charges');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer sk_test_123');
    assert.equal(init.headers['Idempotency-Key'], 'chk_user_key-0001');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(JSON.parse(init.body).amountCents, 11200);
  });

  it('traduce un rechazo de la pasarela', async () => {
    const fetch = fakeFetch(async () => jsonResponse(200, { approved: false, declineCode: 'do_not_honor', declineMessage: 'x' }));
    const gateway = new HttpPaymentGateway({ url: 'https://pagos.example.com', apiKey: 'k', timeoutMs: 500, fetchImpl: fetch.impl });
    const result = await gateway.charge(chargeRequest);
    assert.equal(result.approved, false);
    assert.equal(result.declineCode, 'do_not_honor');
  });

  it('respuesta no ok, timeout, error de red o cuerpo invalido -> 502 PAYMENT_GATEWAY_ERROR sin filtrar el token', async () => {
    const scenarios = [
      async () => jsonResponse(500, { error: 'boom' }),
      async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      },
      async () => {
        throw new TypeError('fetch failed');
      },
      async () => ({ ok: true, status: 200, json: async () => JSON.parse('no json') }),
      async () => jsonResponse(200, { approved: true }),
    ];
    for (const respond of scenarios) {
      const gateway = new HttpPaymentGateway({ url: 'https://pagos.example.com', apiKey: 'k', timeoutMs: 50, fetchImpl: fakeFetch(respond).impl });
      await assert.rejects(gateway.charge(chargeRequest), (error) => {
        assert.equal(error.status, 502);
        assert.equal(error.code, 'PAYMENT_GATEWAY_ERROR');
        assert.equal(error.message.includes('tok_live'), false);
        return true;
      });
    }
  });

  it('respeta el timeout real con AbortSignal.timeout', async () => {
    const slowFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      });
    const gateway = new HttpPaymentGateway({ url: 'https://pagos.example.com', apiKey: 'k', timeoutMs: 20, fetchImpl: slowFetch });
    await assert.rejects(gateway.charge(chargeRequest), { status: 502, code: 'PAYMENT_GATEWAY_ERROR' });
  });

  it('anula un cargo con POST /charges/{id}/void', async () => {
    const fetch = fakeFetch(async () => jsonResponse(200, { voided: true }));
    const gateway = new HttpPaymentGateway({ url: 'https://pagos.example.com', apiKey: 'k', timeoutMs: 500, fetchImpl: fetch.impl });
    assert.deepEqual(await gateway.voidCharge({ transactionId: 'tx/1', reason: 'checkout_failed' }), { voided: true });
    assert.equal(fetch.calls[0].url, 'https://pagos.example.com/charges/tx%2F1/void');
    assert.equal(fetch.calls[0].init.headers['Idempotency-Key'], 'void-tx/1');
  });

  it('createPaymentGateway elige la implementacion segun la configuracion', () => {
    assert.ok(createPaymentGateway({ gatewayUrl: undefined }) instanceof SimulatedPaymentGateway);
    assert.ok(createPaymentGateway({ gatewayUrl: 'https://p.example.com', gatewayApiKey: 'k', gatewayTimeoutMs: 100 }) instanceof HttpPaymentGateway);
    assert.throws(() => createPaymentGateway({ gatewayUrl: 'https://p.example.com' }), /PAYMENT_GATEWAY_API_KEY/);
  });
});

describe('listInvoicesQuerySchema', () => {
  it('acepta filtros validos y rechaza estados o ids invalidos', () => {
    assert.deepEqual(validateSchema(listInvoicesQuerySchema, { page: '1', limit: '10', status: 'paid', nit: 'CF' }), []);
    const errors = validateSchema(listInvoicesQuerySchema, { status: 'robada', userId: 'xyz', nit: '$where' });
    assert.deepEqual(errors.map((error) => error.field).sort(), ['nit', 'status', 'userId']);
  });
});
