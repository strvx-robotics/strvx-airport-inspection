// Server-only password hashing for seeds and scripts (never import from client components).
import bcrypt from "bcryptjs";

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}
