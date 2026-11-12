/**
 * Controlador de salud para balanceadores y orquestadores.
 *
 * Devuelve 200 si la base de datos responde y 503 en caso contrario.
 */
export class HealthController {
  #pingDatabase;

  /** @param {{ pingDatabase: () => Promise<boolean> }} deps */
  constructor({ pingDatabase }) {
    this.#pingDatabase = pingDatabase;
  }

  /** GET /health */
  check = async (_req, res) => {
    const databaseUp = await this.#pingDatabase();
    res.status(databaseUp ? 200 : 503).json({
      status: databaseUp ? 'ok' : 'degraded',
      database: databaseUp ? 'up' : 'down',
      uptimeSeconds: Math.round(process.uptime()),
    });
  };
}
