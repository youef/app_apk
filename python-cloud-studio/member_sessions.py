"""Persistent customer login sessions on Render's private mounted disk.

Opaque browser cookies are 256-bit random tokens. The database stores only their
SHA-256 digest, never passwords, Supabase access tokens or raw cookie secrets.
Customer sessions renew on activity; sign-out and admin revocation invalidate them.
Admin sessions intentionally remain short-lived and memory-only.
"""
from __future__ import annotations

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
                last_seen_at INTEGER NOT NULL
            )""")
            conn.execute("CREATE INDEX IF NOT EXISTS member_sessions_user_idx ON member_sessions(user_id)")

    def _db(self):
        connection = sqlite3.connect(str(self.path), timeout=15)
        connection.execute("PRAGMA busy_timeout=15000")
        return connection

    @staticmethod
    def _digest(token):
        if not isinstance(token, str) or re.fullmatch(r"[A-Za-z0-9_-]{32,128}",token) is None:
            return None
        return hashlib.sha256(token.encode("ascii", "strict")).hexdigest()

    def create(self, token, user_id, csrf):
        digest = self._digest(token)
        if digest is None:
            raise ValueError("Invalid session identifier")
        now = int(time.time())
        with self._db() as conn:
            conn.execute("DELETE FROM member_sessions WHERE expires_at<=?", (now,))
            conn.execute(
                "INSERT INTO member_sessions(token_hash,user_id,role,csrf,expires_at,created_at,last_seen_at) "
                "VALUES(?,?,'customer',?,?,?,?)",
                (digest, user_id, csrf, now + CUSTOMER_SESSION_SECONDS, now, now),
            )

    def get(self, token):
        digest = self._digest(token)
        if not digest:
            return None
        now = int(time.time())
        with self._db() as conn:
            row = conn.execute("SELECT user_id,role,csrf,expires_at,last_seen_at FROM member_sessions "
                               "WHERE token_hash=?", (digest,)).fetchone()
            if not row or row[3] <= now:
                if row:
                    conn.execute("DELETE FROM member_sessions WHERE token_hash=?", (digest,))
                return None
            renewed = row[3] - now < CUSTOMER_SESSION_SECONDS - SESSION_RENEW_WINDOW
            if renewed:
                conn.execute("UPDATE member_sessions SET expires_at=?, last_seen_at=? "
                             "WHERE token_hash=?", (now + CUSTOMER_SESSION_SECONDS, now, digest))
            # Session tuple keeps the original middleware's (uid, role, deadline, csrf) shape.
            return (row[0], row[1], time.monotonic() +
                    (CUSTOMER_SESSION_SECONDS if renewed else row[3] - now), row[2]), renewed

    def delete(self, token):
        digest = self._digest(token)
        if digest:
            with self._db() as conn:
                conn.execute("DELETE FROM member_sessions WHERE token_hash=?", (digest,))

    def revoke_user(self, user_id):
        with self._db() as conn:
            conn.execute("DELETE FROM member_sessions WHERE user_id=?", (user_id,))
