// facebook-capi.js — модуль для відправки подій у Facebook Conversions API
// Токени і PIXEL_ID беруться з .env (FB_ACCESS_TOKEN, FB_PIXEL_ID).

import axios from 'axios';
import CryptoJS from 'crypto-js';

const FB_API_VERSION = 'v26.0';

// SHA256 хешування (обов'язкове для PII згідно Meta policy)
export function hash(val) {
  if (!val) return '';
  return CryptoJS.SHA256(String(val).trim().toLowerCase()).toString();
}

// Перевіряємо, чи значення вже є SHA256-хешем (64 hex-символи).
// Якщо так — повертаємо як є, не хешуємо вдруге.
// Якщо сире — хешуємо.
export function ensureHash(val) {
  if (!val) return undefined;
  const s = String(val).trim();
  if (/^[a-f0-9]{64}$/i.test(s)) return s.toLowerCase();
  return hash(s);
}

// Нормалізація телефону перед хешуванням для Meta CAPI (хоче E.164 БЕЗ "+": лише цифри з кодом країни).
// Якщо значення вже виглядає як SHA256-хеш — повертаємо БЕЗ ЗМІН (цифро-стрип зіпсує літери a-f).
export function normalizePhone(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^[a-f0-9]{64}$/i.test(s)) return s;
  let digits = s.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('0')) digits = `380${digits.slice(1)}`;
  return digits;
}

// Країна за кодом телефону (сирий номер, не хеш). Лише однозначні коди;
// +1 (США/Канада) і невідомі — без країни, щоб не слати хибне.
const PHONE_COUNTRY = [
  ['380', 'ua'], ['373', 'md'], ['370', 'lt'], ['371', 'lv'], ['372', 'ee'],
  ['420', 'cz'], ['421', 'sk'], ['995', 'ge'], ['972', 'il'], ['351', 'pt'],
  ['353', 'ie'], ['358', 'fi'], ['48', 'pl'], ['49', 'de'], ['40', 'ro'],
  ['36', 'hu'], ['43', 'at'], ['41', 'ch'], ['44', 'gb'], ['39', 'it'],
  ['34', 'es'], ['33', 'fr'], ['31', 'nl'], ['32', 'be'], ['45', 'dk'],
  ['46', 'se'], ['47', 'no'], ['90', 'tr'],
].sort((a, b) => b[0].length - a[0].length);

export function countryFromPhone(raw) {
  const s = String(raw || '').trim();
  if (!s || /^[a-f0-9]{64}$/i.test(s)) return '';
  const digits = normalizePhone(s);
  const hit = PHONE_COUNTRY.find(([code]) => digits.startsWith(code));
  return hit ? hit[1] : '';
}

/**
 * Відправка події у Facebook CAPI.
 * PII-поля (email, phone, firstName, lastName, country) приймають
 * і сирі, і вже хешовані значення — сервер сам визначить.
 *
 * @param {Object} opts
 * @param {string} opts.event_name       - наприклад 'Lead', 'CompleteRegistration'
 * @param {string} opts.event_id         - унікальний ID події (для дедуплікації з pixel)
 * @param {Object} opts.user             - { email, phone, firstName, lastName, country }
 *                                         можуть бути сирі АБО вже SHA256-хеш
 * @param {Object} opts.browser          - { fbp, fbc, ip, ua, external_id }
 *                                         ці поля НЕ хешуються
 * @param {Object} [opts.custom]         - { value, currency, ... }
 * @param {string} [opts.source_url]
 * @param {string} [opts.test_code]      - test_event_code для дебагу
 * @returns {Promise<Object>}
 */
export async function sendEvent({
  event_name = 'Lead',
  event_id,
  user = {},
  browser = {},
  custom,
  source_url,
  test_code,
}) {
  const accessToken = process.env.FB_ACCESS_TOKEN;
  const pixelId = process.env.FB_PIXEL_ID;

  if (!accessToken || !pixelId) {
    throw new Error('FB_ACCESS_TOKEN і FB_PIXEL_ID мають бути задані в .env');
  }

  // Всі PII проганяємо через ensureHash — він не хешує вдруге, якщо прийшов хеш.
  const emHash = ensureHash(user.email);
  const phHash = ensureHash(normalizePhone(user.phone));
  const fnHash = ensureHash(user.firstName);
  const lnHash = ensureHash(user.lastName);
  // country у Meta — окремий ключ (ISO-2 у нижньому регістрі, хеш); ct — це МІСТО.
  // Раніше країна йшла в ct, тобто Facebook отримав би «місто ua».
  const countryHash = ensureHash(user.country);

  const user_data = {
    em: emHash ? [emHash] : undefined,
    ph: phHash ? [phHash] : undefined,
    fn: fnHash ? [fnHash] : undefined,
    ln: lnHash ? [lnHash] : undefined,
    country: countryHash ? [countryHash] : undefined,
    fbp: browser.fbp || undefined,
    fbc: browser.fbc || undefined,
    client_ip_address: browser.ip || undefined,
    client_user_agent: browser.ua || undefined,
    external_id: browser.external_id || undefined,
  };

  // прибираємо undefined поля
  Object.keys(user_data).forEach((k) => user_data[k] === undefined && delete user_data[k]);

  const eventData = {
    event_name,
    event_time: Math.floor(Date.now() / 1000),
    event_id,
    event_source_url: source_url,
    action_source: 'website',
    user_data,
  };
  // Без фейкового дефолту: Meta не вимагає custom_data для CompleteRegistration,
  // а фейкові { value: 0.0, currency: 'USD' } на кожній події й були тим,
  // що діагностика Events Manager флагувала як "однакова ціна для всіх подій".
  if (custom) eventData.custom_data = custom;

  const payload = {
    data: [eventData],
    access_token: accessToken,
  };

  if (test_code) payload.test_event_code = test_code;

  const url = `https://graph.facebook.com/${FB_API_VERSION}/${pixelId}/events`;
  const response = await axios.post(url, payload);
  return response.data;
}
