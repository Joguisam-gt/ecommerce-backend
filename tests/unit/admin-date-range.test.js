/**
 * Limites superiores de rango de fechas en los listados del panel (Fase 3):
 * una fecha sin hora debe abarcar el dia completo, igual que en los reportes.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toEndDate } from '../../src/dtos/inventory.dto.js';

describe('toEndDate', () => {
  it('una fecha sin hora cubre hasta las 23:59:59.999 UTC', () => {
    assert.equal(toEndDate('2026-01-31').toISOString(), '2026-01-31T23:59:59.999Z');
  });

  it('una fecha con hora se respeta tal cual', () => {
    assert.equal(toEndDate('2026-01-31T10:00:00.000Z').toISOString(), '2026-01-31T10:00:00.000Z');
  });

  it('sin valor devuelve undefined', () => {
    assert.equal(toEndDate(undefined), undefined);
    assert.equal(toEndDate(null), undefined);
  });
});
