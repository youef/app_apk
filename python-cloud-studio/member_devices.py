"""One registered browser/device per customer, persisted on Render's private disk.

Browsers cannot expose a trustworthy hardware MAC address. Store only a keyed
hash of a random, HttpOnly per-browser cookie; never a raw device identifier.
"""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import hmac
import os
import secrets
import sqlite3
import time
from pathlib import Path

DEVICE_COOKIE = 'alezz_member_device'
DEVICE_MAX_AGE = 180 * 86400


def friendly_device(user_agent: str) -> str:
    agent = (user_agent or '').lower()[:512]
    if 'iphone' in agent:
        return 'iPhone'
    if 'ipad' in agent:
        return 'iPad'
    if 'android' in agent and ('tv' in agent or 'aft' in agent):
        return 'Android TV'
    if 'android' in agent:
        return 'Android'
    if 'macintosh' in agent or 'mac os' in agent:
        return 'Mac'
    if 'windows' in agent:
        return 'Windows'
    if 'linux' in agent:
        return 'Linux'
    return 'متصفح غير معروف'


class DeviceRegistry:
    def __init__(self, directory: str | Path, secret: str):
        self.path = Path(directory).resolve() / 'alezz_member_devices.sqlite3'
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.secret = secret.encode('utf-8')
        if len(self.secret) < 24:
            raise ValueError('A strong ALEZZ_SITE_SECRET is required for device binding')
        with self.db() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS member_devices (
                user_id TEXT PRIMARY KEY,
                device_digest TEXT NOT NULL,
                device_name TEXT NOT NULL,
                registered_at INTEGER NOT NULL,
                last_seen_at INTEGER NOT NULL
            )""")

    @contextmanager
    def db(self):
        db = sqlite3.connect(str(self.path), timeout=6, isolation_level=None)
        try:
            db.execute('PRAGMA busy_timeout=6000')
            yield db
        finally:
            db.close()

    def fingerprint(self, user_id: str, cookie: str) -> str:
        if not cookie or len(cookie) > 128:
            return ''
        message = (user_id + '\0' + cookie).encode('utf-8')
        return hmac.new(self.secret, message, hashlib.sha256).hexdigest()

    def register(self, user_id: str, cookie: str, user_agent: str) -> bool:
        digest = self.fingerprint(user_id, cookie)
        if not digest:
            return False
        now = int(time.time())
        with self.db() as db:
            try:
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT device_digest FROM member_devices WHERE user_id=?',
                                 (user_id,)).fetchone()
                if row is not None and not secrets.compare_digest(row[0], digest):
                    db.execute('ROLLBACK')
                    return False
                if row is None:
                    db.execute('INSERT INTO member_devices VALUES (?,?,?,?,?)',
                               (user_id, digest, friendly_device(user_agent), now, now))
                else:
                    db.execute('UPDATE member_devices SET last_seen_at=? WHERE user_id=?',
                               (now, user_id))
                db.execute('COMMIT')
                return True
            except Exception:
                db.execute('ROLLBACK')
                raise

    def matches(self, user_id: str, cookie: str) -> bool:
        digest = self.fingerprint(user_id, cookie)
        if not digest:
            return False
        now = int(time.time())
        with self.db() as db:
            row = db.execute('SELECT device_digest,last_seen_at FROM member_devices WHERE user_id=?',
                             (user_id,)).fetchone()
            if row is None or not secrets.compare_digest(row[0], digest):
                return False
            if now - row[1] >= 300:
                db.execute('UPDATE member_devices SET last_seen_at=? WHERE user_id=? AND device_digest=?',
                           (now, user_id, digest))
            return True

    def details(self, user_ids: list[str]) -> dict[str, dict]:
        if not user_ids:
            return {}
        ids = list(dict.fromkeys(user_ids))[:100]
        with self.db() as db:
            marks = ','.join('?' for _ in ids)
            rows = db.execute('SELECT user_id,device_digest,device_name,registered_at,last_seen_at '
                              'FROM member_devices WHERE user_id IN (' + marks + ')', ids).fetchall()
        return {r[0]: {'device_id': r[1][-10:].upper(), 'device_name': r[2],
                       'registered_at': r[3], 'last_seen_at': r[4]} for r in rows}

    def reset(self, user_id: str) -> None:
        with self.db() as db:
            db.execute('DELETE FROM member_devices WHERE user_id=?', (user_id,))
