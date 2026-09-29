// El server carga el .env desde src/index.ts (el entrypoint), pero los tests no
// pasan por ahí: importan los módulos directo. Por eso el .env se carga acá,
// antes de que se evalúe cualquier módulo del proyecto.
import "dotenv/config";

// Clave fija de cifrado para los tests: los tokens de Mercado Pago que usan los
// mocks tienen que poder cifrarse y descifrarse de verdad, no con un stub.
process.env.TOKEN_ENCRYPTION_KEY =
  "0000000000000000000000000000000000000000000000000000000000000001";

// Secreto de sesión fijo. Los tests no deben depender del JWT_SECRET de la
// máquina de quien los corre: si cambia, los tokens que firman los tests dejan
// de coincidir con los que verifica el código y el fallo es incomprensible.
process.env.JWT_SECRET = "secreto-de-sesion-fijo-para-los-tests-nunca-usar-en-produccion";
