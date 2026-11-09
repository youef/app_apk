"""Persistent customer login sessions on Render's private mounted disk.

Opaque browser cookies are 256-bit random tokens. The database stores only their
SHA-256 digest, never passwords, Supabase access tokens or raw cookie secrets.
Customer sessions renew on activity; sign-out and admin revocation invalidate them.
Administrator sessions have a separate persistent, role-checked table with an absolute cap.
"""
from __future__ import annotations

from contextlib import closing, contextmanager
import hashlib
import re
import sqlite3
import time
from pathlib import Path

CUSTOMER_SESSION_SECONDS = 180 * 86400
SESSION_RENEW_WINDOW = 7 * 86400


class MemberSessions:
    def __init__(self, directory):
        folder = Path(directory).resolve()
        folder.mkdir(parents=True, exist_ok=True)
        self.path = folder / "alezz_member_sessions.sqlite3"
        with self._db() as conn:
            conn.execute("""CREATE TABLE IF NOT EXISTS member_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role='customer'),
                csrf TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                last_seen_at INTEGER NOT NULL,
                account_expires_at INTEGER NOT NULL DEFAULT 0
            )""")
            fields={row[1] for row in conn.execute("PRAGMA table_info(member_sessions)")}
            if "account_expires_at" not in fields:
                conn.execute("ALTER TABLE member_sessions ADD COLUMN account_expires_at INTEGER NOT NULL DEFAULT 0")
            conn.execute("CREATE INDEX IF NOT EXISTS member_sessions_user_idx ON member_sessions(user_id)")

    @contextmanager
    def _db(self):
        with closing(sqlite3.connect(str(self.path), timeout=15)) as connection, connection:
            connection.execute("PRAGMA busy_timeout=15000")
            yield connection

    @staticmethod
    def _digest(token):
        if not isinstance(token, str) or re.fullmatch(r"[A-Za-z0-9_-]{32,128}",token) is None:
            return None
        return hashlib.sha256(token.encode("ascii", "strict")).hexdigest()

    def create(self, token, user_id, csrf, account_expires_at=0):
        digest = self._digest(token)
        if digest is None:
            raise ValueError("Invalid session identifier")
        now = int(time.time())
        deadline = int(account_expires_at or 0)
        if deadline and deadline <= now:
            raise ValueError("Customer subscription has expired")
        with self._db() as conn:
            conn.execute("DELETE FROM member_sessions WHERE expires_at<=? OR (account_expires_at>0 AND account_expires_at<=?)", (now, now))
            conn.execute(
                "INSERT INTO member_sessions(token_hash,user_id,role,csrf,expires_at,created_at,last_seen_at,account_expires_at) "
                "VALUES(?,?,'customer',?,?,?,?,?)",
                (digest, user_id, csrf, now + CUSTOMER_SESSION_SECONDS, now, now, deadline),
            )

    def get(self, token):
        digest = self._digest(token)
        if not digest:
            return None
        now = int(time.time())
        with self._db() as conn:
            row = conn.execute("SELECT user_id,role,csrf,expires_at,last_seen_at,account_expires_at FROM member_sessions "
                               "WHERE token_hash=?", (digest,)).fetchone()
            if not row or row[3] <= now or (row[5] and row[5] <= now):
                if row:
                    conn.execute("DELETE FROM member_sessions WHERE token_hash=?", (digest,))
                return None
            renewed = row[3] - now < CUSTOMER_SESSION_SECONDS - SESSION_RENEW_WINDOW
            if renewed:
                conn.execute("UPDATE member_sessions SET expires_at=?, last_seen_at=? "
                             "WHERE token_hash=?", (now + CUSTOMER_SESSION_SECONDS, now, digest))
            # Session tuple keeps the original middleware's (uid, role, deadline, csrf) shape.
            return (row[0], row[1], time.monotonic() +
                    (CUSTOMER_SESSION_SECONDS if renewed else row[3] - now), row[2], row[5]), renewed

    def delete(self, token):
        digest = self._digest(token)
        if digest:
            with self._db() as conn:
                conn.execute("DELETE FROM member_sessions WHERE token_hash=?", (digest,))

    def revoke_user(self, user_id):
        with self._db() as conn:
            conn.execute("DELETE FROM member_sessions WHERE user_id=?", (user_id,))

    def set_user_expiry(self, user_id, account_expires_at):
        """Apply an admin renewal immediately to existing, browser-bound sessions."""
        deadline = int(account_expires_at or 0)
        with self._db() as conn:
            conn.execute("UPDATE member_sessions SET account_expires_at=? WHERE user_id=?",
                         (deadline, user_id))
            if deadline and deadline <= int(time.time()):
                conn.execute("DELETE FROM member_sessions WHERE user_id=?", (user_id,))


# Admin browser sessions are longer lived than the in-memory studio workspace.
# A 30-day hard limit prevents an old stolen cookie from being renewed indefinitely.
ADMIN_SESSION_SECONDS = 7 * 86400
ADMIN_MAX_AGE_SECONDS = 30 * 86400
ADMIN_RENEW_WINDOW = 24 * 3600
ADMIN_ROLE_RECHECK_SECONDS = 4 * 3600


class AdminSessions(MemberSessions):
    """Restart-safe admin sessions, stored only as hashes on the private disk."""

    def __init__(self, directory):
        super().__init__(directory)
        with self._db() as conn:
            conn.execute("""CREATE TABLE IF NOT EXISTS admin_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                csrf TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                last_seen_at INTEGER NOT NULL,
                verified_at INTEGER NOT NULL
            )""")
            conn.execute("CREATE INDEX IF NOT EXISTS admin_sessions_user_idx ON admin_sessions(user_id)")

    def create(self, token, user_id, csrf):
        digest = self._digest(token)
        if not digest or not user_id or not csrf:
            raise ValueError("Invalid administrator session")
        now = int(time.time())
        with self._db() as conn:
            conn.execute("DELETE FROM admin_sessions WHERE expires_at<=? OR created_at<=?",
                         (now, now - ADMIN_MAX_AGE_SECONDS))
            if conn.execute("SELECT COUNT(*) FROM admin_sessions").fetchone()[0] >= 4096:
                raise RuntimeError("Too many active administrator sessions")
            conn.execute(
                "INSERT INTO admin_sessions(token_hash,user_id,csrf,expires_at,created_at,last_seen_at,verified_at) "
                "VALUES(?,?,?,?,?,?,?)",
                (digest, user_id, csrf, now + ADMIN_SESSION_SECONDS, now, now, now),
            )

    def get(self, token):
        digest = self._digest(token)
        if not digest:
            return None
        now = int(time.time())
        with self._db() as conn:
            row = conn.execute(
                "SELECT user_id,csrf,expires_at,created_at,verified_at FROM admin_sessions WHERE token_hash=?",
                (digest,),
            ).fetchone()
            if not row:
                return None
            user_id, csrf, expires_at, created_at, verified_at = row
            absolute_deadline = created_at + ADMIN_MAX_AGE_SECONDS
            if expires_at <= now or absolute_deadline <= now:
                conn.execute("DELETE FROM admin_sessions WHERE token_hash=?", (digest,))
                return None
            next_expiry = min(now + ADMIN_SESSION_SECONDS, absolute_deadline)
            renewed = expires_at - now <= ADMIN_RENEW_WINDOW and next_expiry > expires_at
            if renewed:
                expires_at = next_expiry
                conn.execute("UPDATE admin_sessions SET expires_at=?,last_seen_at=? WHERE token_hash=?",
                             (expires_at, now, digest))
            needs_role_check = now - verified_at >= ADMIN_ROLE_RECHECK_SECONDS
            session = (user_id, "admin", time.monotonic() + (expires_at - now), csrf)
            return session, renewed, needs_role_check

    def mark_verified(self, token):
        digest = self._digest(token)
        if digest:
            with self._db() as conn:
                conn.execute("UPDATE admin_sessions SET verified_at=? WHERE token_hash=?",
                             (int(time.time()), digest))

    def delete(self, token):
        digest = self._digest(token)
        if digest:
            with self._db() as conn:
                conn.execute("DELETE FROM admin_sessions WHERE token_hash=?", (digest,))

    def revoke_user(self, user_id):
        with self._db() as conn:
            conn.execute("DELETE FROM admin_sessions WHERE user_id=?", (user_id,))
