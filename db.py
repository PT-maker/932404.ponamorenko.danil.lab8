import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "reservations.db")
SCHEMA_PATH = os.path.join(BASE_DIR, "schema.sql")

CAPACITY = 40
SLOT_HOURS = 2
DT_FORMAT = "%Y-%m-%dT%H:%M"
COLUMNS = "id, name, party_size, date_time, status"


@contextmanager
def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with get_connection() as conn:
        with open(SCHEMA_PATH, encoding="utf-8") as f:
            conn.executescript(f.read())
        if conn.execute("SELECT COUNT(*) FROM reservations").fetchone()[0] == 0:
            seed(conn)


def seed(conn):
    tomorrow = (datetime.now() + timedelta(days=1)).replace(second=0, microsecond=0)

    def at(days, hour, minute=0):
        moment = tomorrow + timedelta(days=days)
        return moment.replace(hour=hour, minute=minute).strftime(DT_FORMAT)

    conn.executemany(
        "INSERT INTO reservations (name, party_size, date_time, status) VALUES (?, ?, ?, ?)",
        [
            ("Иванов Иван", 4, at(0, 19), "confirmed"),
            ("Петрова Анна", 2, at(0, 19, 30), "pending"),
            ("Сидоров Павел", 6, at(0, 20), "confirmed"),
            ("Кузнецова Мария", 3, at(1, 18), "pending"),
            ("Смирнов Алексей", 8, at(1, 20), "cancelled"),
            ("Орлова Елена", 5, at(2, 19), "confirmed"),
        ],
    )


def get_reservations(day=None, status=None):
    sql = f"SELECT {COLUMNS} FROM reservations"
    conditions, params = [], []
    if day is not None:
        start = datetime.combine(day, datetime.min.time())
        end = start + timedelta(days=1)
        conditions.append("date_time >= ? AND date_time < ?")
        params += [start.strftime(DT_FORMAT), end.strftime(DT_FORMAT)]
    if status is not None:
        conditions.append("status = ?")
        params.append(status)
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY date_time, id"
    with get_connection() as conn:
        return [dict(row) for row in conn.execute(sql, params).fetchall()]


def get_reservation(reservation_id):
    with get_connection() as conn:
        row = conn.execute(
            f"SELECT {COLUMNS} FROM reservations WHERE id = ?", (reservation_id,)
        ).fetchone()
        return dict(row) if row else None


def get_availability(date_time, exclude_id=None):
    moment = datetime.strptime(date_time, DT_FORMAT)
    lower = (moment - timedelta(hours=SLOT_HOURS)).strftime(DT_FORMAT)
    upper = (moment + timedelta(hours=SLOT_HOURS)).strftime(DT_FORMAT)
    with get_connection() as conn:
        occupied = conn.execute(
            """
            SELECT COALESCE(SUM(party_size), 0) FROM reservations
            WHERE status != 'cancelled'
              AND date_time > ? AND date_time < ?
              AND (? IS NULL OR id != ?)
            """,
            (lower, upper, exclude_id, exclude_id),
        ).fetchone()[0]
    return {
        "capacity": CAPACITY,
        "occupied": occupied,
        "free": max(CAPACITY - occupied, 0),
        "percent": min(round(occupied * 100 / CAPACITY), 100),
    }


def create_reservation(name, party_size, date_time, status="pending"):
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO reservations (name, party_size, date_time, status) VALUES (?, ?, ?, ?)",
            (name, party_size, date_time, status),
        )
        row = conn.execute(
            f"SELECT {COLUMNS} FROM reservations WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
        return dict(row)


def update_reservation(reservation_id, name, party_size, date_time, status):
    with get_connection() as conn:
        cur = conn.execute(
            "UPDATE reservations SET name = ?, party_size = ?, date_time = ?, status = ? WHERE id = ?",
            (name, party_size, date_time, status, reservation_id),
        )
        if cur.rowcount == 0:
            return None
        row = conn.execute(
            f"SELECT {COLUMNS} FROM reservations WHERE id = ?", (reservation_id,)
        ).fetchone()
        return dict(row)


def delete_reservation(reservation_id):
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM reservations WHERE id = ?", (reservation_id,))
        return cur.rowcount > 0