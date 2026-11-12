/**
 * Script: npm run db:seed-superuser
 *
 * Crea el primer superusuario a partir de variables de entorno. Es la unica
 * via para crear un superusuario sin otro superusuario previo (el registro
 * publico siempre crea clientes). No hace nada si ya existe alguno.
 *
 * Variables: SUPERUSER_EMAIL, SUPERUSER_PASSWORD, SUPERUSER_FIRST_NAME, SUPERUSER_LAST_NAME.
 */
import { database } from '../src/config/database.js';
import { loadConfig } from '../src/config/env.js';
import { ROLES } from '../src/constants/roles.js';
import { CreateUserDTO } from '../src/dtos/user.dto.js';
import { ensureCollections } from '../src/database/setup.js';
import { UserRepository } from '../src/repositories/user.repository.js';
import { PasswordService } from '../src/services/password.service.js';
import { buildUserDocument } from '../src/services/user-document.factory.js';
import { createLogger } from '../src/utils/logger.js';
import { validateSchema } from '../src/validators/schema-validator.js';
import { createUserSchema } from '../src/validators/user.validator.js';

const config = loadConfig();
const logger = createLogger({ level: 'info' });

const input = {
  email: process.env.SUPERUSER_EMAIL,
  password: process.env.SUPERUSER_PASSWORD,
  firstName: process.env.SUPERUSER_FIRST_NAME ?? 'Super',
  lastName: process.env.SUPERUSER_LAST_NAME ?? 'Usuario',
  role: ROLES.SUPERUSER,
};

try {
  const errors = validateSchema(createUserSchema, input);
  if (errors.length > 0) {
    throw new Error(`Datos del superusuario invalidos: ${JSON.stringify(errors)}`);
  }

  const db = await database.connect(config.mongo);
  await ensureCollections(db);
  const users = new UserRepository(db);

  if ((await users.countActiveByRole(ROLES.SUPERUSER)) > 0) {
    logger.info('Ya existe un superusuario activo; no se crea otro');
  } else {
    const dto = CreateUserDTO.from(input);
    const passwordHash = await new PasswordService(config.bcrypt).hash(dto.password);
    const user = await users.create(buildUserDocument({ ...dto, passwordHash }, new Date()));
    logger.info('Superusuario creado', { id: user._id.toString(), email: user.email });
  }
} catch (error) {
  logger.error('No se pudo crear el superusuario', { error: error.message });
  process.exitCode = 1;
} finally {
  await database.close();
}
