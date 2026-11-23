import os
from datetime import date, datetime
from typing import Literal

import uvicorn
from fastapi import FastAPI, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import db

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
MAX_PARTY = 20

app = FastAPI(
    title="Система бронирования столиков",
    description="Лабораторная №8, вариант 15",
)
db.init_db()

Status = Literal["pending", "confirmed", "cancelled"]


class ReservationIn(BaseModel):
    name: str = Field(max_length=100)
    party_size: int
    date_time: str = Field(examples=["2026-12-01T19:00"])
    status: Status = "pending"


class Reservation(BaseModel):
    id: int
    name: str
    party_size: int
    date_time: str
    status: Status


class Availability(BaseModel):
    capacity: int
    occupied: int
    free: int
    percent: int


class Error(BaseModel):
    error: str


class ApiError(Exception):
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message


@app.exception_handler(ApiError)
async def api_error_handler(request: Request, exc: ApiError):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.message})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    fields = ", ".join(str(err["loc"][-1]) for err in exc.errors())
    return JSONResponse(status_code=400, content={"error": f"Некорректные данные: {fields}"})


ERRORS = {
    400: {"model": Error, "description": "Некорректные данные"},
    404: {"model": Error, "description": "Бронь не найдена"},
    409: {"model": Error, "description": "Недостаточно свободных мест"},
}


def parse_date_time(value: str) -> datetime:
    try:
        return datetime.strptime(value, db.DT_FORMAT)
    except ValueError:
        raise ApiError(400, "date_time должен быть в формате ГГГГ-ММ-ДДTЧЧ:ММ, например 2026-12-01T19:00")


def validate_reservation(data: ReservationIn, existing: dict | None = None) -> str:
    name = data.name.strip()
    if not name:
        raise ApiError(400, "name не должно быть пустым")
    if not 1 <= data.party_size <= MAX_PARTY:
        raise ApiError(400, f"party_size должен быть от 1 до {MAX_PARTY}")
    moment = parse_date_time(data.date_time)
    time_changed = existing is None or existing["date_time"] != data.date_time
    if time_changed and moment < datetime.now():
        raise ApiError(400, "Нельзя бронировать на прошедшее время")
    return name


def ensure_capacity(date_time: str, party_size: int, status: str, exclude_id: int | None = None):
    if status == "cancelled":
        return
    free = db.get_availability(date_time, exclude_id)["free"]
    if party_size > free:
        raise ApiError(409, f"Недостаточно мест: свободно {free} из {db.CAPACITY}")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/api/reservations", response_model=list[Reservation], responses={400: ERRORS[400]})
def list_reservations(
    day: date | None = Query(default=None, alias="date", description="Дата в формате ГГГГ-ММ-ДД"),
    status: Status | None = Query(default=None, description="pending, confirmed или cancelled"),
):
    return db.get_reservations(day, status)


@app.get("/api/reservations/{reservation_id}", response_model=Reservation, responses=ERRORS)
def get_reservation(reservation_id: int):
    reservation = db.get_reservation(reservation_id)
    if reservation is None:
        raise ApiError(404, "Бронь не найдена")
    return reservation


@app.post("/api/reservations", response_model=Reservation, status_code=201, responses=ERRORS)
def create_reservation(data: ReservationIn):
    name = validate_reservation(data)
    ensure_capacity(data.date_time, data.party_size, data.status)
    return db.create_reservation(name, data.party_size, data.date_time, data.status)


@app.put("/api/reservations/{reservation_id}", response_model=Reservation, responses=ERRORS)
def update_reservation(reservation_id: int, data: ReservationIn):
    existing = db.get_reservation(reservation_id)
    if existing is None:
        raise ApiError(404, "Бронь не найдена")
    name = validate_reservation(data, existing)
    ensure_capacity(data.date_time, data.party_size, data.status, exclude_id=reservation_id)
    return db.update_reservation(reservation_id, name, data.party_size, data.date_time, data.status)


@app.delete("/api/reservations/{reservation_id}", status_code=204, responses={404: ERRORS[404]})
def delete_reservation(reservation_id: int):
    if not db.delete_reservation(reservation_id):
        raise ApiError(404, "Бронь не найдена")
    return Response(status_code=204)


@app.get("/api/availability", response_model=Availability, responses={400: ERRORS[400]})
def availability(date_time: str, exclude_id: int | None = None):
    parse_date_time(date_time)
    return db.get_availability(date_time, exclude_id)


app.mount("/static", StaticFiles(directory=STATIC_DIR, check_dir=False), name="static")


if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), reload=True)