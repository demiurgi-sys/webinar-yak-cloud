// node --test   (Node 20+, без зовнішніх залежностей)
import test from 'node:test';
import assert from 'node:assert/strict';
import { paramsFrom, clickIdsFrom, rawFor, clip } from '../src/touches.js';

const BASE = 'https://webinar.school-design.space/';
const EMOJI = String.fromCodePoint(0x1f600);
const NUL = String.fromCharCode(0);
const LONE = String.fromCharCode(0xd83d); // половинка емодзі без пари

// jsonb не приймає ні NUL, ні самотній сурогат — INSERT у leads упав би, лід втрачено.
const jsonbSafe = (obj) => {
  const j = JSON.stringify(obj);
  return !j.includes('\\u0000') && j.isWellFormed() && !/\\ud[89a-f][0-9a-f]{2}/i.test(j);
};

test('params: емодзі на межі 512 не лишає розрізаної пари', () => {
  const out = paramsFrom(`${BASE}?utm_content=a${encodeURIComponent(EMOJI.repeat(300))}`);
  assert.equal(jsonbSafe(out), true);
  assert.equal(out.utm_content.length, 511);
  assert.equal(out.utm_content.endsWith(EMOJI), true);
});

test('params: NUL у ключі й значенні прибирається, битий сурогат з тіла — теж', () => {
  const out = paramsFrom(`${BASE}?a=x%00y&%00b=1&%00=2`, { utm_source: `ig${NUL}`, utm_term: `z${LONE}q` });
  assert.equal(jsonbSafe(out), true);
  assert.deepEqual(out, { utm_source: 'ig', utm_term: 'z�q', a: 'xy', b: '1' });
});

test('params: ключі constructor і tostring не губляться', () => {
  assert.deepEqual(paramsFrom(`${BASE}?constructor=c&toString=t`), { constructor: 'c', tostring: 't' });
});

test('click_ids і raw теж безпечні для jsonb', () => {
  const bad = `a${EMOJI.repeat(300)}${NUL}`;
  assert.equal(jsonbSafe(clickIdsFrom('', { fbclid: bad })), true);
  assert.equal(jsonbSafe(rawFor({ utm_source: bad, fbp: `x${LONE}` })), true);
  assert.equal(clip(undefined), '');
  assert.equal(clip(12345, 3), '123');
});

test('params: 9 міток Meta + fbclid лягають усі, невідомий наперед ключ теж', () => {
  const url = `${BASE}?utm_source=ig&utm_medium=paid_social&utm_campaign=UA_GSD_WBN&utm_content=V_rozkagy`
    + '&utm_term=Instagram_Reels&adset_name=LAL_1&campaign_id=111&adset_id=222&ad_id=333&fbclid=AB1&some_new_tag=x';
  assert.deepEqual(paramsFrom(url), {
    utm_source: 'ig',
    utm_medium: 'paid_social',
    utm_campaign: 'UA_GSD_WBN',
    utm_content: 'V_rozkagy',
    utm_term: 'Instagram_Reels',
    adset_name: 'LAL_1',
    campaign_id: '111',
    adset_id: '222',
    ad_id: '333',
    fbclid: 'AB1',
    some_new_tag: 'x',
  });
});

test('params: незамінені макроси кабінетів і порожні значення відсіюються', () => {
  const url = `${BASE}?ad_id={{ad.id}}&adset_name={{adset.name}}&lp={lpurl}&empty=&campaign_id=111`;
  assert.deepEqual(paramsFrom(url, { utm_source: '', fbclid: '{{x}}' }), { campaign_id: '111' });
});

test('params: eff перекриває адресу (колонка і словник не розходяться)', () => {
  const url = `${BASE}?utm_source=from_url&adset_name=A`;
  assert.deepEqual(paramsFrom(url, { utm_source: 'from_storage', utm_content: 'only_eff' }), {
    utm_source: 'from_storage',
    utm_content: 'only_eff',
    adset_name: 'A',
  });
});

test('params: стелі — ключ до 40, значення до 512, не більше 30 ключів; eff не випадає', () => {
  const longKey = 'k'.repeat(41);
  const many = Array.from({ length: 35 }, (_, i) => `p${i}=v${i}`).join('&');
  const out = paramsFrom(`${BASE}?${longKey}=1&big=${'x'.repeat(600)}&${many}`, { utm_source: 'ig' });
  assert.equal(longKey in out, false);
  assert.equal(out.big.length, 512);
  assert.equal(Object.keys(out).length, 30);
  assert.equal(out.utm_source, 'ig');
  assert.equal(out.p0, 'v0');
  assert.equal('p34' in out, false);
});

test('params: порожній або битий page_url — лишається тільки шар eff', () => {
  assert.deepEqual(paramsFrom('', { utm_source: 'ig', trigger: 'web_reg_0910_0' }), {
    utm_source: 'ig',
    trigger: 'web_reg_0910_0',
  });
  assert.deepEqual(paramsFrom('не адреса'), {});
  assert.deepEqual(paramsFrom(undefined, undefined), {});
  assert.deepEqual(paramsFrom(BASE), {});
});

test('params: ключі в нижньому регістрі, з дублікатів береться перший', () => {
  const url = `${BASE}?Adset_Name=A&UTM_SOURCE=ig&adset_name=B`;
  assert.deepEqual(paramsFrom(url), { adset_name: 'A', utm_source: 'ig' });
});
