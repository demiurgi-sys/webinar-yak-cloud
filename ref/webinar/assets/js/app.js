const CONFIG = {
    date: "5 листопада",
    time: "19:30",
    // Часи ЗАВЖДИ за Києвом (+03:00 влітку, +02:00 взимку), а не за поясом пристрою відвідувача.
    // targetDate – початок ефіру (до нього таймер); closeDate – закриття реєстрації:
    // між ними «Ефір уже йде» (реєстрація відкрита), після closeDate «Наступний ефір скоро».
    targetDate: "2026-11-05T19:30:00+02:00",
    closeDate: "2026-11-05T20:45:00+02:00",
    // relative URL — піде через Nginx на app-контейнер;
    // якщо лендинг хоститься окремо від API, замінити на абсолютний URL.
    api: "/api/submit",
    capi: "/api/fb/convert",
    bot: "GrinevichSchooldesign2023_bot",
    startContext: "web_reg_051126",
    // Підпис на неактивній кнопці після ефіру
    endedLabel: "Реєстрація закрита"
};

const dateEls = document.querySelectorAll('.dynamic-date');
const timeEls = document.querySelectorAll('.dynamic-time');
const modal = document.getElementById('leadModal');
const stickyBar = document.getElementById('stickyBar');
const form = document.getElementById('leadForm');

document.addEventListener('DOMContentLoaded', () => {
    dateEls.forEach(el => el.textContent = CONFIG.date);
    timeEls.forEach(el => el.textContent = CONFIG.time);
    collectParams();
    initStickyBar();
    schedulePhoneWarmup();
    initCountdown();
});

// Три стани за годинником пристрою (як і таймер), час – київський:
//  до targetDate          – таймер, реєстрація відкрита;
//  targetDate..closeDate  – клас is-live: замість таймера «Ефір уже йде – приєднуйся», реєстрація відкрита;
//  після closeDate        – клас is-ended: замість дати й таймера «Наступний ефір скоро», усі кнопки
//                           реєстрації видні, але неактивні, модалка не відкривається, липка панель
//                           ховається. Передреєстрації нема.
let isEnded = false;
function setLive(live) {
    document.documentElement.classList.toggle('is-live', live);
}
function setEnded(ended) {
    if (ended === isEnded) return;
    isEnded = ended;
    document.documentElement.classList.toggle('is-ended', ended);
    document.querySelectorAll('.js-register').forEach((btn) => {
        btn.disabled = ended;
        const label = btn.querySelector('.js-register-label');
        if (label) {
            if (ended) {
                label.dataset.label = label.textContent;
                label.textContent = CONFIG.endedLabel;
            } else if (label.dataset.label) {
                label.textContent = label.dataset.label;
            }
        }
    });
    updateStickyBar();
}

// Countdown
function initCountdown() {
    // Дата береться З CONFIG.targetDate – єдине джерело правди. Рядок із зсувом (+03:00)
    // однаково читається в усіх сучасних браузерах і не залежить від пояса пристрою.
    const target = Date.parse(CONFIG.targetDate);
    if (isNaN(target)) return;
    // нема/збите closeDate – реєстрація закривається разом зі стартом, як було до вікна «Ефір іде»
    let closeAt = Date.parse(CONFIG.closeDate);
    if (isNaN(closeAt)) closeAt = target;

    // Українське відмінювання: 1 день / 2-4 дні / 5-20 днів, з винятком 11-14.
    function plural(n, one, few, many) {
        const n100 = n % 100;
        if (n100 >= 11 && n100 <= 14) return many;
        const n10 = n % 10;
        if (n10 === 1) return one;
        if (n10 >= 2 && n10 <= 4) return few;
        return many;
    }

    function setText(sel, value) {
        document.querySelectorAll(sel).forEach(el => el.textContent = value);
    }

    function update() {
        const now = new Date().getTime();
        const diff = target - now;

        if (now >= closeAt) {
            setLive(false);
            setEnded(true);
            return;
        }
        setEnded(false);
        if (diff < 0) {
            setLive(true);
            return;
        }
        setLive(false);

        const d = Math.floor(diff / (1000 * 60 * 60 * 24));
        document.documentElement.classList.add('countdown-ready');

        if (d > 0) {
            // 6 днів / 2 дні / 1 день
            setText('.js-days', d.toString());
            setText('.js-days-label', plural(d, 'день', 'дні', 'днів'));
            document.querySelectorAll('.js-days-label').forEach(el => el.style.display = '');
        } else {
            // День ефіру: замість «0 днів» пишемо «сьогодні», підпис ховаємо.
            setText('.js-days', 'сьогодні');
            document.querySelectorAll('.js-days-label').forEach(el => el.style.display = 'none');
        }
    }
    
    setInterval(update, 1000);
    update();
}

// UTM & Tracking Parameters
const TRACKING_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'];
function collectParams() {
    const params = new URLSearchParams(window.location.search);
    let tracking = {};
    TRACKING_KEYS.forEach(key => { if (params.has(key)) tracking[key] = params.get(key); });
    // вбудовані браузери (IG/FB in-app, приватний Safari) можуть не давати localStorage
    try {
        if (Object.keys(tracking).length) localStorage.setItem('lead_tracking', JSON.stringify(tracking));
        if (params.has('trigger')) localStorage.setItem('lead_trigger', params.get('trigger'));
    } catch (e) {}
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

// Modal
function openLeadModal(e) {
    if (e) e.preventDefault();
    if (isEnded) return;
    if (typeof fbq === 'function') {
        fbq('track', 'Contact', { content_name: 'Lead Modal Open' });
    }
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    updateStickyBar();
    ensurePhoneInput();
}
function closeLeadModal() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    updateStickyBar();
}

// Sticky bar (телефон/планшет, <992px: на десктопі її ховає CSS).
// Видима, лише коли жодної кнопки реєстрації нема на екрані – ні верхньої
// (під датою), ні нижньої (кінець сторінки) – і форма закрита.
const stickyAnchors = new Map();
function updateStickyBar() {
    if (!stickyBar) return;
    const anchorOnScreen = [...stickyAnchors.values()].some(Boolean);
    const show = !anchorOnScreen && !isEnded && !modal.classList.contains('is-open');
    stickyBar.classList.toggle('is-visible', show);
}
function initStickyBar() {
    if (!stickyBar || !('IntersectionObserver' in window)) return;
    // кнопка вважається «на екрані», коли видно хоча б половину
    const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => stickyAnchors.set(en.target, en.intersectionRatio >= 0.5));
        updateStickyBar();
    }, { threshold: [0, 0.5, 1] });
    document.querySelectorAll('.js-cta-top, .js-cta-bottom').forEach((el) => {
        stickyAnchors.set(el, false);
        io.observe(el);
    });
}

// Phone input (intl-tel-input).
// Бібліотека НЕ вантажиться разом зі сторінкою: CSS, JS, utils (libphonenumber) і прапорці
// підтягуються при першому відкритті форми, а також «прогрівом» у вільну мить після load,
// щоб до тапу на кнопку все вже було на місці. До ініціалізації поле – звичайний <input type="tel">,
// тож вводити номер можна одразу.
const ITI_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/17.0.8';
const PHONE_PLACEHOLDER = 'Номер телефону';
let iti = null;
let phoneLibPromise = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadStyle(href) {
    return new Promise((resolve) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        // стилі не критичні: без них поле лишиться робочим, просто без оформлення прапорця
        link.onload = link.onerror = resolve;
        document.head.appendChild(link);
    });
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error('script load failed: ' + src));
        document.head.appendChild(script);
    });
}

// Підвантажує бібліотеку (один раз) і вішає її на #phone. Не кидає помилок: якщо cdnjs
// недоступний, поле лишається звичайним, а форма шле номер як введено.
function ensurePhoneInput() {
    if (!phoneLibPromise) {
        phoneLibPromise = Promise.all([
            loadStyle(ITI_BASE + '/css/intlTelInput.css'),
            window.intlTelInput ? null : loadScript(ITI_BASE + '/js/intlTelInput.min.js')
        ]).then(initPhoneInput).catch((err) => {
            console.warn('intl-tel-input not loaded:', err && err.message);
            phoneLibPromise = null; // наступна спроба (відкриття форми / відправка) спробує ще раз
        });
    }
    return phoneLibPromise;
}

function initPhoneInput() {
    const input = document.querySelector('#phone');
    if (!input || iti || !window.intlTelInput) return;
    // Бібліотека підвантажує utils по події window.load і слухає лише її. Ми завантажились
    // уже після load, тож ставимо прапорець самі, інакше utils не підтягнуться ніколи.
    if (document.readyState === 'complete' && window.intlTelInputGlobals) {
        window.intlTelInputGlobals.windowLoaded = true;
    }
    const hadFocus = document.activeElement === input;
    // без власного placeholder бібліотека підставить приклад номера обраної країни (autoPlaceholder)
    input.removeAttribute('placeholder');
    iti = window.intlTelInput(input, {
        preferredCountries: ['ua', 'pl', 'de', 'us'],
        separateDialCode: true,
        autoPlaceholder: 'aggressive',
        utilsScript: ITI_BASE + '/js/utils.js'
    });
    // бібліотека ставить autocomplete="off" – повертаємо підказку браузера про номер
    input.setAttribute('autocomplete', 'tel');
    input.setAttribute('inputmode', 'tel');
    input.placeholder = PHONE_PLACEHOLDER; // до приходу utils; далі бібліотека замінить на приклад
    // бібліотека перекладає input в свою обгортку – фокус при цьому губиться
    if (hadFocus) input.focus();
}

function schedulePhoneWarmup() {
    // економія трафіку: на «Заощадженні даних» нічого наперед не качаємо
    if (navigator.connection && navigator.connection.saveData) return;
    const warm = () => {
        if ('requestIdleCallback' in window) requestIdleCallback(ensurePhoneInput, { timeout: 4000 });
        else setTimeout(ensurePhoneInput, 2000);
    };
    if (document.readyState === 'complete') warm();
    else window.addEventListener('load', warm, { once: true });
}

// Номер для відправки в E.164. getNumber() працює лише коли підвантажились utils
// (libphonenumber): без них він віддає '' і телефон пішов би без коду країни – тому
// ПЕРЕД відправкою чекаємо і бібліотеку, і utils. Чекаємо недовго (PHONE_WAIT_MS сумарно,
// не 8 + 8 с), щоб кнопка «Обробка...» не висіла на повільному чи заблокованому cdnjs:
// далі шлемо номер так, як є (див. нижче).
const PHONE_WAIT_MS = 3500;
async function readPhoneNumber(input) {
    const deadline = Date.now() + PHONE_WAIT_MS;
    await Promise.race([ensurePhoneInput(), sleep(PHONE_WAIT_MS)]);
    if (iti) {
        while (!window.intlTelInputUtils && Date.now() < deadline) await sleep(100);
    }
    let phone = iti && window.intlTelInputUtils ? iti.getNumber() : input.value;
    if (iti && !window.intlTelInputUtils) {
        // utils так і не прийшли (мережа): збираємо номер самі – код обраної країни + цифри
        const digits = input.value.replace(/\D/g, '');
        phone = input.value.trim().startsWith('+') ? '+' + digits : '+' + iti.getSelectedCountryData().dialCode + digits.replace(/^0+/, '');
    }
    if (!phone || phone.length < 5) {
        phone = input.value.replace(/\s+/g, '');
    }
    return phone;
}

// Помилки форми — сервер вертає {error, field:'email'|'phone', msg}.
// field відсутній (мережева помилка тощо) → глобальний рядок.
function clearFormErrors() {
    ['error-email', 'error-phone', 'error-global'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}
function showFormError(data) {
    clearFormErrors();
    const field = data && data.field;
    const msg = (data && data.msg) || 'Щось пішло не так. Спробуйте ще раз.';
    const targetId = field === 'email' ? 'error-email' : field === 'phone' ? 'error-phone' : 'error-global';
    const el = document.getElementById(targetId);
    if (el) {
        el.textContent = msg;
        el.style.display = 'block';
        // .form__global-error не має власного CSS (на відміну від .form__error) — колір задаємо тут.
        if (targetId === 'error-global') el.style.color = '#ff6b6b';
    }
}

// Крок «Відкрити Telegram» після форми.
// Вбудовані браузери Facebook/Instagram на Android автоперехід у застосунок
// часто не пускають (05.10: 15% таких лідів не дійшли до бота, у звичайних
// браузерах – 0). Там переходу без натискання не робимо: кнопка веде через
// intent:// просто в застосунок Telegram, а якщо він не відкрився, за 2,5 с –
// на звичайне посилання t.me. Решта браузерів – автоперехід, як і був.
// Загальний Android WebView (`; wv)`) сюди не береться: багато з них intent://
// не обробляють і показують сторінку помилки.
const isAndroidInApp = /Android/i.test(navigator.userAgent)
    && /FBAN|FBAV|FB_IAB|Instagram/i.test(navigator.userAgent);

function telegramIntent(url) {
    const u = new URL(url);
    const domain = u.pathname.replace(/^\//, '');
    const start = u.searchParams.get('start') || '';
    return `intent://resolve?domain=${encodeURIComponent(domain)}&start=${encodeURIComponent(start)}`
        + `#Intent;scheme=tg;package=org.telegram.messenger;S.browser_fallback_url=${encodeURIComponent(url)};end`;
}

function showTelegramStep(url) {
    const done = document.getElementById('leadDone');
    const open = document.getElementById('tgOpen');
    const link = document.getElementById('tgLink');
    const copy = document.getElementById('tgCopy');

    form.hidden = true;
    done.hidden = false;
    link.href = url;
    link.textContent = url;
    open.href = url;

    if (isAndroidInApp) {
        open.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = telegramIntent(url);
            // Запасний перехід скасовується, щойно сторінка втратила фокус чи
            // сховалась: діалог «Відкрити в застосунку?» або вже відкритий Telegram.
            const fallback = setTimeout(() => {
                if (!document.hidden) window.location.href = url;
            }, 2500);
            const cancel = () => clearTimeout(fallback);
            window.addEventListener('blur', cancel, { once: true });
            window.addEventListener('pagehide', cancel, { once: true });
            document.addEventListener('visibilitychange', cancel, { once: true });
        });
    }

    copy.addEventListener('click', async () => {
        let ok = false;
        try {
            await navigator.clipboard.writeText(url);
            ok = true;
        } catch (err) {
            // старі вбудовані браузери без Clipboard API
            const tmp = document.createElement('textarea');
            tmp.value = url;
            tmp.setAttribute('readonly', '');
            document.body.appendChild(tmp);
            tmp.select();
            try { ok = document.execCommand('copy'); } catch (e) {}
            tmp.remove();
        }
        copy.textContent = ok ? 'Скопійовано ✓' : 'Затисніть посилання вище, щоб скопіювати';
    });

    open.focus();
    if (!isAndroidInApp) window.location.href = url;
}

// Піксель вантажиться з затримкою 0,5 с після DOMContentLoaded (див. index.html). Якщо форму
// відправлено раніше (автозаповнення), події ще стоять у черзі заглушки fbq, а перехід у Telegram
// їх би обірвав. Тому підтягуємо fbevents.js негайно й даємо до 1 с, щоб черга (з
// CompleteRegistration) пішла до переходу. Піксель уже завантажений – нічого не чекаємо.
async function flushPixel() {
    if (typeof fbq !== 'function' || fbq.callMethod || typeof window.loadFbPixel !== 'function') return;
    window.loadFbPixel();
    const t0 = Date.now();
    while (!fbq.callMethod && Date.now() - t0 < 1000) await sleep(50);
}

// Form submit
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const emailInput = document.querySelector('input[name="email"]');
    const phoneInput = document.querySelector('#phone');
    clearFormErrors();

    btn.disabled = true;
    btn.innerHTML = 'Обробка...';

    const email = emailInput.value.trim();
    const phone = await readPhoneNumber(phoneInput);

    // мітки — з адреси В МОМЕНТ відправки; localStorage лише фолбек
    // (вбудовані браузери IG/FB його не дають, мітки губились)
    let storedTracking = {}, storedTrigger = '';
    try {
        storedTracking = JSON.parse(localStorage.getItem('lead_tracking') || '{}');
        storedTrigger = localStorage.getItem('lead_trigger') || '';
    } catch (e) {}
    const liveParams = new URLSearchParams(window.location.search);
    const tracking = { ...storedTracking };
    TRACKING_KEYS.forEach(key => { if (liveParams.has(key)) tracking[key] = liveParams.get(key); });
    const trigger = liveParams.get('trigger') || storedTrigger;

    const payload = {
        email, phone, trigger, ...tracking,
        fbp: getCookie('_fbp') || '',
        fbc: getCookie('_fbc') || '',
        user_agent: navigator.userAgent,
        page_url: window.location.href,
        // звідки прийшли (для журналу торкань на бекенді); у вбудованих
        // браузерах IG/FB зазвичай порожній — це нормально
        referrer: document.referrer || ''
    };
    // ?fb_test=TEST12345 — тестовий код Events Manager: серверна подія цього ліда
    // піде в «Тестові події», а не в статистику (API бере його з raw_payload)
    const fbTest = liveParams.get('fb_test') || '';
    if (/^TEST\d+$/.test(fbTest)) payload.fb_test = fbTest;

    try {
        // event_id генеруємо тут і передаємо в API та в браузерний Pixel.
        // Той самий event_id пізніше використає SmartSender у /api/fb/convert —
        // Facebook автоматично дедуплікує браузерну + серверну події.
        const eventId = 'reg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        payload.event_id = eventId;

        const res = await fetch(CONFIG.api, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            showFormError(data);
            btn.disabled = false;
            btn.innerHTML = '<span>📲</span> Продовжити в Telegram';
            return;
        }

        // 🔸 Браузерний Pixel — шлемо ПІСЛЯ отримання data (потрібен data.uuid).
        // 🔸 Серверну CAPI-подію шле SmartSender пізніше, коли юзер дійде
        //    до вебінарної воронки (щоб не забруднювати оптимізацію FB "сміттям"
        //    від тих, хто не відкрив Telegram).
        // Тестовий лід (сервер помітив його is_test) пікселем НЕ рапортуємо —
        // інакше тестова конверсія обійшла б серверний гейт і засмітила Meta.
        if (data.is_test) {
            console.log('[lead] test lead — pixel skipped');
        } else if (typeof fbq === 'function') {
            // Без currency/value: реєстрація на безкоштовний вебінар не має ціни,
            // а фіксовані 2.00 USD на КОЖНІЙ події і були тим, що діагностика
            // Events Manager флагувала як "усі події надсилають однакову ціну".
            // Серверний бік те саме прибрано в b46c4fa — обидві половини
            // дедуплікованої пари мають бути однакові, інакше Meta бачить розбіжність.
            fbq('track', 'CompleteRegistration', {
                content_name: 'Webinar Interior Design',
                external_id: data.uuid
            }, { eventID: eventId });
            await flushPixel();
        }

        // Пріоритет: беремо redirect_url з API; fallback — збираємо самі
        const redirect = data.redirect_url
            || (data.lead_id ? `https://t.me/${CONFIG.bot}?start=${CONFIG.startContext}-${data.lead_id}` : null);

        if (redirect) {
            showTelegramStep(redirect);
        } else {
            throw new Error('No redirect URL');
        }
    } catch (err) {
        console.error('Submit error:', err);
        form.hidden = false;
        const done = document.getElementById('leadDone');
        if (done) done.hidden = true;
        showFormError();
        btn.disabled = false;
        btn.innerHTML = '<span>📲</span> Продовжити в Telegram';
    }
});
