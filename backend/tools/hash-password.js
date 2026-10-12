import { hashPassword } from '../adminAuth.js';

// Prints the line for the .env file. The password is read from the environment so that it does not
// appear in the shell history:  read -rs PASSWORD; export PASSWORD; node backend/tools/hash-password.js
const password = process.env.PASSWORD;
if (!password || password.length < 12) {
  console.error('Set PASSWORD (at least 12 characters), e.g.: read -rs PASSWORD; export PASSWORD');
  process.exit(2);
}
console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`);