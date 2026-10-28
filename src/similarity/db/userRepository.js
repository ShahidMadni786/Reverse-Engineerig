import { randomUUID } from "node:crypto";
import { getDatabase } from "./database.js";
import { hashPassword, verifyPassword, generateToken } from "../auth/passwords.js";

export class UserRepository {
  static createUser(username, email, password, role, fullName) {
    const db = getDatabase();
    const id = randomUUID();
    const { hash, salt } = hashPassword(password);
    const createdAt = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO users (id, username, email, password_hash, salt, role, full_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, username.trim().toLowerCase(), email.trim().toLowerCase(), hash, salt, role, fullName, createdAt);

    return {
      id,
      username: username.trim().toLowerCase(),
      email: email.trim().toLowerCase(),
      role,
      full_name: fullName,
      created_at: createdAt,
    };
  }

  static findById(id) {
    const db = getDatabase();
    const stmt = db.prepare("SELECT id, username, email, role, full_name, created_at FROM users WHERE id = ?");
    const row = stmt.get(id);
    return row ?? null;
  }

  static findByUsername(username) {
    const db = getDatabase();
    const stmt = db.prepare("SELECT * FROM users WHERE username = ?");
    const row = stmt.get(username.trim().toLowerCase());
    return row ?? null;
  }

  static findByEmail(email) {
    const db = getDatabase();
    const stmt = db.prepare("SELECT * FROM users WHERE email = ?");
    const row = stmt.get(email.trim().toLowerCase());
    return row ?? null;
  }

  static listUsers() {
    const db = getDatabase();
    const stmt = db.prepare("SELECT id, username, email, role, full_name, created_at FROM users ORDER BY created_at DESC");
    return stmt.all() ?? [];
  }

  static updateUser(id, updates) {
    const db = getDatabase();
    const existing = this.findById(id);
    if (!existing) return null;

    if (updates.password) {
      const { hash, salt } = hashPassword(updates.password);
      db.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?").run(hash, salt, id);
    }

    if (updates.email || updates.role || updates.full_name) {
      const email = updates.email ? updates.email.trim().toLowerCase() : existing.email;
      const role = updates.role ?? existing.role;
      const fullName = updates.full_name ?? existing.full_name;
      db.prepare("UPDATE users SET email = ?, role = ?, full_name = ? WHERE id = ?").run(email, role, fullName, id);
    }

    return this.findById(id);
  }

  static deleteUser(id) {
    const db = getDatabase();
    const res = db.prepare("DELETE FROM users WHERE id = ?").run(id);
    return res.changes > 0;
  }

  static createSession(userId, hoursValid = 48) {
    const db = getDatabase();
    const id = randomUUID();
    const token = generateToken();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + hoursValid * 60 * 60 * 1000);

    db.prepare(`
      INSERT INTO sessions (id, user_id, token, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, token, expiresAt.toISOString(), createdAt.toISOString());

    return {
      id,
      user_id: userId,
      token,
      expires_at: expiresAt.toISOString(),
      created_at: createdAt.toISOString(),
    };
  }

  static validateSession(token) {
    const db = getDatabase();
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      SELECT s.id as sessionId, s.expires_at, u.id, u.username, u.email, u.role, u.full_name, u.created_at
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ? AND s.expires_at > ?
    `);
    const row = stmt.get(token, now);
    if (!row) return null;
    return {
      id: row.id,
      sessionId: row.sessionId,
      username: row.username,
      email: row.email,
      role: row.role,
      full_name: row.full_name,
      created_at: row.created_at,
    };
  }

  static revokeSession(token) {
    const db = getDatabase();
    const res = db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return res.changes > 0;
  }

  static ensureDefaultUsers() {
    const db = getDatabase();
    const configuredAdminPassword = process.env["SIMILARITY_ADMIN_PASSWORD"];
    const issuedCredentials = [];

    let admin = this.findByUsername("admin");
    if (!admin) {
      const password = configuredAdminPassword || generateToken();
      this.createUser(
        "admin",
        "admin@academic.local",
        password,
        "admin",
        "System Administrator",
      );
      if (!configuredAdminPassword) issuedCredentials.push(`admin: ${password}`);
    } else if (verifyPassword("admin123", admin.password_hash, admin.salt)) {
      const password = configuredAdminPassword || generateToken();
      const { hash, salt } = hashPassword(password);
      db.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?").run(hash, salt, admin.id);
      issuedCredentials.push(`admin (rotated from the published demo password): ${password}`);
    }

    for (const [username, demoPassword] of [["professor", "prof123"], ["student", "student123"]]) {
      const user = this.findByUsername(username);
      if (!user || !verifyPassword(demoPassword, user.password_hash, user.salt)) continue;
      const password = generateToken();
      const { hash, salt } = hashPassword(password);
      db.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?").run(hash, salt, user.id);
      issuedCredentials.push(`${username} (rotated from the published demo password): ${password}`);
    }

    if (issuedCredentials.length > 0) {
      console.warn(
        `Academic Integrity Engine one-time account credentials:\n${issuedCredentials.join("\n")}\\nSet SIMILARITY_ADMIN_PASSWORD before first launch to choose the initial admin password.`,
      );
    }
  }
}

