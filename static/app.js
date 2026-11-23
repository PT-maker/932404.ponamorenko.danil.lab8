'use strict';

const API = '/api/reservations';
const STATUS_LABELS = { pending: 'Ожидает', confirmed: 'Подтверждена', cancelled: 'Отменена' };
const GUEST_FORMS = ['гость', 'гостя', 'гостей'];
const DEFAULT_PARTY_SIZE = 2;
const MAX_PARTY_SIZE = 20;

const $ = (id) => document.getElementById(id);

const el = {
  tabList: $('tab-list'),
  tabForm: $('tab-form'),
  filters: $('filters'),
  filterDate: $('filter-date'),
  filterStatus: $('filter-status'),
  filtersReset: $('filters-reset'),
  summary: $('list-summary'),
  list: $('reservations'),
  empty: $('empty'),
  form: $('reservation-form'),
  formTitle: $('form-title'),
  name: $('name'),
  partySize: $('party-size'),
  dateTime: $('date-time'),
  statusField: $('status-field'),
  status: $('status'),
  meter: $('meter'),
  meterFill: $('meter-fill'),
  occupancyText: $('occupancy-text'),
  occupancyHint: $('occupancy-hint'),
  formError: $('form-error'),
  submit: $('submit-btn'),
  cancelEdit: $('cancel-edit'),
  dialog: $('confirm-dialog'),
  dialogTitle: $('dialog-title'),
  dialogText: $('dialog-text'),
  dialogOk: $('dialog-ok'),
  toast: $('toast'),
};

const tabs = [el.tabList, el.tabForm];
const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

let reservations = [];
let editing = null;
let availability = null;
let loadToken = 0;
let availabilityToken = 0;
let availabilityTimer;
let toastTimer;

const pad = (n) => String(n).padStart(2, '0');

function toInputValue(date) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultDateTime() {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return toInputValue(date);
}

function plural(n, forms) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function guests(n) {
  return `${n} ${plural(n, GUEST_FORMS)}`;
}

function formatDateTime(value) {
  return dateFormatter.format(new Date(value));
}

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

async function request(url, options = {}) {
  const init = { ...options };
  if (options.body !== undefined) init.headers = { 'Content-Type': 'application/json' };
  const response = await fetch(url, init).catch(() => {
    throw new Error('Нет соединения с сервером');
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error((data && data.error) || `Ошибка сервера (${response.status})`);
  return data;
}

function showToast(text, isError = false) {
  el.toast.textContent = text;
  el.toast.classList.toggle('toast-error', isError);
  el.toast.classList.add('toast-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('toast-visible'), 3500);
}

function confirmDialog({ title, text, okLabel, danger = false }) {
  return new Promise((resolve) => {
    el.dialogTitle.textContent = title;
    el.dialogText.textContent = text;
    el.dialogOk.textContent = okLabel;
    el.dialogOk.classList.toggle('btn-danger', danger);
    el.dialogOk.classList.toggle('btn-primary', !danger);
    el.dialog.returnValue = '';
    el.dialog.addEventListener('close', () => resolve(el.dialog.returnValue === 'ok'), { once: true });
    el.dialog.showModal();
  });
}

function activateTab(tab, focus = false) {
  for (const item of tabs) {
    const active = item === tab;
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
    $(item.getAttribute('aria-controls')).hidden = !active;
  }
  if (focus) tab.focus();
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    activateTab(tabs[(index + step + tabs.length) % tabs.length], true);
  });
});

function actionButton(action, label, ariaLabel, extraClass = '') {
  return h(
    'button',
    {
      type: 'button',
      class: `btn btn-small ${extraClass}`.trim(),
      dataset: { action },
      'aria-label': ariaLabel,
    },
    label,
  );
}

function renderCard(item) {
  const actions = [];
  if (item.status === 'pending') {
    actions.push(actionButton('confirm', 'Подтвердить', `Подтвердить бронь ${item.name}`, 'btn-success'));
  }
  if (item.status !== 'cancelled') {
    actions.push(actionButton('cancel', 'Отменить', `Отменить бронь ${item.name}`));
  }
  actions.push(actionButton('edit', 'Изменить', `Изменить бронь ${item.name}`));
  actions.push(actionButton('delete', 'Удалить', `Удалить бронь ${item.name}`, 'btn-danger'));

  return h(
    'li',
    { class: `card card-${item.status}`, dataset: { id: item.id } },
    h(
      'div',
      { class: 'card-head' },
      h('h3', { class: 'card-title' }, item.name),
      h('span', { class: `badge badge-${item.status}` }, STATUS_LABELS[item.status]),
    ),
    h(
      'p',
      { class: 'card-meta' },
      h('time', { datetime: item.date_time }, formatDateTime(item.date_time)),
      ` · ${guests(item.party_size)}`,
    ),
    h('div', { class: 'card-actions' }, ...actions),
  );
}

function renderList() {
  el.list.replaceChildren(...reservations.map(renderCard));
  el.empty.hidden = reservations.length > 0;
  el.summary.textContent = reservations.length ? `Найдено: ${reservations.length}` : '';
}

async function loadReservations() {
  const params = new URLSearchParams();
  if (el.filterDate.value) params.set('date', el.filterDate.value);
  if (el.filterStatus.value) params.set('status', el.filterStatus.value);
  const query = params.toString();
  const token = ++loadToken;
  try {
    const data = await request(query ? `${API}?${query}` : API);
    if (token !== loadToken) return;
    reservations = data;
    renderList();
  } catch (error) {
    if (token === loadToken) showToast(error.message, true);
  }
}

async function changeStatus(item, status) {
  const payload = {
    name: item.name,
    party_size: item.party_size,
    date_time: item.date_time,
    status,
  };
  try {
    await request(`${API}/${item.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    showToast(status === 'confirmed' ? 'Бронь подтверждена' : 'Бронь отменена');
    await loadReservations();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function removeReservation(item) {
  try {
    await request(`${API}/${item.id}`, { method: 'DELETE' });
    showToast('Бронь удалена');
    await loadReservations();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handleAction(action, item) {
  if (action === 'edit') {
    startEdit(item);
  } else if (action === 'confirm') {
    await changeStatus(item, 'confirmed');
  } else if (action === 'cancel') {
    const ok = await confirmDialog({
      title: 'Отменить бронь?',
      text: `Бронь «${item.name}» на ${formatDateTime(item.date_time)} будет отменена.`,
      okLabel: 'Отменить бронь',
      danger: true,
    });
    if (ok) await changeStatus(item, 'cancelled');
  } else if (action === 'delete') {
    const ok = await confirmDialog({
      title: 'Удалить бронь?',
      text: `Бронь «${item.name}» на ${formatDateTime(item.date_time)} будет удалена без возможности восстановления.`,
      okLabel: 'Удалить',
      danger: true,
    });
    if (ok) await removeReservation(item);
  }
}

el.list.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = Number(button.closest('li').dataset.id);
  const item = reservations.find((reservation) => reservation.id === id);
  if (item) handleAction(button.dataset.action, item);
});

function showFormError(message) {
  el.formError.textContent = message;
  el.formError.hidden = !message;
}

function syncFormMode() {
  const isEditing = editing !== null;
  el.formTitle.textContent = isEditing ? `Редактирование брони №${editing.id}` : 'Новое бронирование';
  el.tabForm.textContent = isEditing ? 'Редактирование' : 'Новая бронь';
  el.submit.textContent = isEditing ? 'Сохранить' : 'Забронировать';
  el.statusField.hidden = !isEditing;
  el.cancelEdit.hidden = !isEditing;
}

function resetForm() {
  editing = null;
  el.form.reset();
  el.partySize.value = DEFAULT_PARTY_SIZE;
  el.dateTime.value = defaultDateTime();
  el.dateTime.min = toInputValue(new Date());
  el.status.value = 'pending';
  syncFormMode();
  showFormError('');
  refreshAvailability();
}

function startEdit(item) {
  editing = item;
  el.name.value = item.name;
  el.partySize.value = item.party_size;
  el.dateTime.value = item.date_time;
  el.dateTime.min = '';
  el.status.value = item.status;
  syncFormMode();
  showFormError('');
  activateTab(el.tabForm, true);
  el.name.focus();
  refreshAvailability();
}

function readForm() {
  return {
    name: el.name.value.trim(),
    party_size: Number(el.partySize.value),
    date_time: el.dateTime.value,
    status: editing ? el.status.value : 'pending',
  };
}

function validateForm(data) {
  if (!data.name) return 'Укажите имя гостя';
  if (!Number.isInteger(data.party_size) || data.party_size < 1 || data.party_size > MAX_PARTY_SIZE) {
    return `Количество гостей должно быть от 1 до ${MAX_PARTY_SIZE}`;
  }
  if (!data.date_time) return 'Укажите дату и время';
  const timeChanged = !editing || editing.date_time !== data.date_time;
  if (timeChanged && new Date(data.date_time) < new Date()) {
    return 'Нельзя бронировать на прошедшее время';
  }
  return '';
}

async function saveReservation(data) {
  el.submit.disabled = true;
  try {
    const url = editing ? `${API}/${editing.id}` : API;
    await request(url, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(data) });
    showToast(editing ? 'Изменения сохранены' : 'Бронь создана');
    resetForm();
    activateTab(el.tabList, true);
    await loadReservations();
  } catch (error) {
    showFormError(error.message);
  } finally {
    el.submit.disabled = false;
  }
}

el.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = readForm();
  const problem = validateForm(data);
  showFormError(problem);
  if (problem) return;
  if (!editing) {
    const ok = await confirmDialog({
      title: 'Подтвердите бронирование',
      text: `${data.name}, ${guests(data.party_size)}, ${formatDateTime(data.date_time)}.`,
      okLabel: 'Забронировать',
    });
    if (!ok) return;
  }
  await saveReservation(data);
});

el.cancelEdit.addEventListener('click', () => {
  resetForm();
  activateTab(el.tabList, true);
});

function levelFor(percent) {
  if (percent >= 90) return 'high';
  if (percent >= 60) return 'medium';
  return 'low';
}

function setMeter(percent, text, level = '') {
  el.meter.setAttribute('aria-valuenow', String(percent));
  el.meter.setAttribute('aria-valuetext', text);
  el.meter.dataset.level = level;
  el.meterFill.style.width = `${percent}%`;
  el.occupancyText.textContent = text;
}

function renderAvailability() {
  if (!availability) {
    setMeter(0, 'Выберите дату и время');
    el.occupancyHint.textContent = '';
    el.occupancyHint.classList.remove('hint-warning');
    return;
  }
  const partySize = Number(el.partySize.value);
  const enough = !partySize || partySize <= availability.free;
  setMeter(
    availability.percent,
    `Занято ${availability.occupied} из ${availability.capacity} мест`,
    levelFor(availability.percent),
  );
  el.occupancyHint.textContent = enough
    ? `Свободно мест: ${availability.free}`
    : `Свободно мест: ${availability.free}. Для ${guests(partySize)} не хватает.`;
  el.occupancyHint.classList.toggle('hint-warning', !enough);
}

async function refreshAvailability() {
  const value = el.dateTime.value;
  const token = ++availabilityToken;
  if (!value) {
    availability = null;
    renderAvailability();
    return;
  }
  const params = new URLSearchParams({ date_time: value });
  if (editing) params.set('exclude_id', editing.id);
  try {
    const data = await request(`/api/availability?${params}`);
    if (token !== availabilityToken) return;
    availability = data;
    renderAvailability();
  } catch (error) {
    if (token !== availabilityToken) return;
    availability = null;
    setMeter(0, 'Не удалось получить занятость');
    el.occupancyHint.textContent = '';
  }
}

el.dateTime.addEventListener('input', () => {
  clearTimeout(availabilityTimer);
  availabilityTimer = setTimeout(refreshAvailability, 250);
});

el.partySize.addEventListener('input', renderAvailability);

el.filters.addEventListener('submit', (event) => event.preventDefault());
el.filterDate.addEventListener('change', loadReservations);
el.filterStatus.addEventListener('change', loadReservations);
el.filtersReset.addEventListener('click', () => {
  el.filterDate.value = '';
  el.filterStatus.value = '';
  loadReservations();
});

resetForm();
loadReservations();