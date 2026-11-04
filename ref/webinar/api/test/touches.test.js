// node --test api/test   (Node 20+, без зовнішніх залежностей)
import test from 'node:test';
import assert from 'node:assert/strict';
import { clickIdsFrom, isClickIdKey, cleanValue, landingUrlOf, recordTouch, rawFor } from '../src/touches.js';

test('click-id з page_url: Meta, Google, TikTok разом', () => {
  const url = 'https://webinar.school-design.space/?utm_source=meta&fbclid=AB1&gclid=G2&ttclid=T3&wbraid=W4';
  assert.deepEqual(clickIdsFrom(url), { fbclid: 'AB1', gclid: 'G2', ttclid: 'T3', wbraid: 'W4' });
});

test('utm-поля не потрапляють у click_ids', () => {
  const url = 'https://x.y/?utm_source=meta&utm_campaign=c1&gclid=G';
  assert.deepEqual(clickIdsFrom(url), { gclid: 'G' });
});

test('тіло запиту пріоритетніше за page_url', () => {
  const url = 'https://x.y/?fbclid=FROM_URL';
  assert.deepEqual(clickIdsFrom(url, { fbclid: 'FROM_BODY' }), { fbclid: 'FROM_BODY' });
});

test('незамінені макроси кабінетів відсіюються', () => {
  const url = 'https://x.y/?fbclid={{ad.id}}&gclid={lpurl}&ttclid=OK';
  assert.deepEqual(clickIdsFrom(url, { msclkid: '{{campaign.name}}' }), { ttclid: 'OK' });
});

test('невідома платформа на …clid приймається без зміни коду', () => {
  assert.equal(isClickIdKey('newplatformclid'), true);
  assert.equal(isClickIdKey('utm_source'), false);
  assert.equal(isClickIdKey('email'), false);
  assert.deepEqual(clickIdsFrom('', { newplatformclid: 'N1' }), { newplatformclid: 'N1' });
});

test('битий або порожній page_url не ламає збір', () => {
  assert.deepEqual(clickIdsFrom('not a url'), {});
  assert.deepEqual(clickIdsFrom(undefined, { gclid: 'G' }), { gclid: 'G' });
});

test('cleanValue: пробіли обрізаються, макроси стають порожнім', () => {
  assert.equal(cleanValue('  abc '), 'abc');
  assert.equal(cleanValue('{{site_source_name}}'), '');
  assert.equal(cleanValue('{lpurl}'), '');
  assert.equal(cleanValue(123), '');
});

test('landingUrlOf: без query', () => {
  assert.equal(landingUrlOf('https://webinar.school-design.space/?utm_source=x#top'), 'https://webinar.school-design.space/');
  assert.equal(landingUrlOf(''), '');
});

test('recordTouch: параметри в правильному порядку, click_ids, raw і params як JSON', async () => {
  const calls = [];
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
  const ok = await recordTouch(pool, {
    lead_id: 'L1', event_type: 'webinar_register', event_id: 'reg_1', lead_is_new: true, is_test: false,
    utm_source: 'meta', utm_medium: 'paid-social', utm_campaign: 'webinar-reg-130926', utm_content: 'cr1', utm_term: 'aud1',
    trigger: 'web_reg_1309', click_ids: { fbclid: 'F' }, landing_url: 'https://x.y/', page_url: 'https://x.y/?fbclid=F',
    referrer: 'https://instagram.com/', client_ip_address: '1.2.3.4', client_user_agent: 'UA', raw: { a: 1 },
    params: { adset_name: 'LAL_1' },
  });
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO touches/);
  const p = calls[0].params;
  assert.equal(p.length, 19);
  assert.deepEqual(p.slice(0, 5), ['L1', 'webinar_register', 'reg_1', true, false]);
  assert.equal(p[11], JSON.stringify({ fbclid: 'F' }));
  assert.equal(p[14], 'https://instagram.com/');
  assert.equal(p[17], JSON.stringify({ a: 1 }));
  assert.equal(p[18], JSON.stringify({ adset_name: 'LAL_1' }));
});

test('recordTouch: збій бази не кидає назовні', async () => {
  const pool = { query: async () => { throw new Error('boom'); } };
  const ok = await recordTouch(pool, { lead_id: 'L1', event_type: 'x' });
  assert.equal(ok, false);
});

test('click_ids: стелі — значення до 512, не більше 10 ключів, довгий ключ ігнорується', () => {
  const body = {};
  for (let i = 0; i < 15; i++) body[`p${i}clid`] = 'v';
  body['x'.repeat(41) + 'clid'] = 'ignored';
  body.fbclid = 'a'.repeat(600);
  const out = clickIdsFrom('', body);
  assert.equal(Object.keys(out).length, 10);
  assert.equal(Object.values(out).every((v) => v.length <= 512), true);
  assert.equal(Object.keys(out).some((k) => k.length > 40), false);
});

test('rawFor: лише мітки білим списком, email/phone і сміття не потрапляють', () => {
  const raw = rawFor({ utm_source: 'meta', fbclid: 'F', email: 'a@b.c', phone: '+380', junk: 'x'.repeat(2000), referrer: 'r', trigger: 't' });
  assert.deepEqual(Object.keys(raw).sort(), ['fbclid', 'referrer', 'trigger', 'utm_source']);
});

test('rawFor: значення обрізаються до 512', () => {
  const raw = rawFor({ utm_campaign: 'c'.repeat(1000) });
  assert.equal(raw.utm_campaign.length, 512);
});
