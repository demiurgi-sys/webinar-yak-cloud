const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { pool, initDb } = require("./db");
const { sendEvent } = require("./facebook-capi");

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "https://course.school-design.space");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// event_id приходить із фронта (той самий UUID іде у fbq eventID) —
// так Meta дедуплікує пару браузер-піксель + серверна CAPI-подія.
// Невалідний/відсутній -> генеруємо свій (подія все одно цінна).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function trackEvent(req, res, eventName) {
  try {
    const eventId = UUID_RE.test(req.body.event_id) ? req.body.event_id.toLowerCase() : uuidv4();
    const { fbp, fbc, page_url, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term } = req.body;
    const clientIp = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;
    const clientUserAgent = req.headers["user-agent"];

    // value/currency/content_name з фронта -> custom_data CAPI
    const customData = {};
    if (req.body.value != null) {
      customData.value = req.body.value;
      customData.currency = req.body.currency || "UAH";
    }
    if (req.body.content_name) customData.content_name = req.body.content_name;

    // 1) Захопити подію в Postgres — це джерело правди. Якщо БД впаде -> 500
    //    (це справжня помилка: подію не збережено).
    await pool.query(
      `INSERT INTO course.events
        (event_name, event_id, fbp, fbc, client_ip, client_user_agent, page_url, referrer,
         utm_source, utm_medium, utm_campaign, utm_content, utm_term, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [eventName, eventId, fbp, fbc, clientIp, clientUserAgent, page_url, referrer,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term, JSON.stringify(req.body)]
    );

    // 2) Відправити в Graph API (CAPI). Збій тут — НЕ помилка запиту:
    //    подія вже безпечно в БД, її можна довідправити пізніше. Токен
    //    протух / Meta 5xx / мережа — логуємо, але віддаємо 200. Інакше
    //    проблема на боці Facebook ламала б трекінг живого сайту.
    let fb = "sent";
    try {
      await sendEvent({ eventName, eventId, fbp, fbc, clientIp, clientUserAgent, pageUrl: page_url, customData });
    } catch (fbErr) {
      fb = "failed";
      const g = fbErr.response && fbErr.response.data && fbErr.response.data.error;
      console.error("CAPI send failed:", g ? JSON.stringify(g) : fbErr.message);
    }

    res.json({ ok: true, event_id: eventId, fb });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
app.post("/track/view", (req, res) => trackEvent(req, res, "ViewContent"));
app.post("/track/checkout", (req, res) => trackEvent(req, res, "InitiateCheckout"));
app.post("/track/purchase", (req, res) => trackEvent(req, res, "Purchase"));

app.get("/health", (req, res) => res.json({ status: "ok" }));

initDb().then(() => {
  app.listen(3000, () => console.log("API running on port 3000"));
}).catch(err => {
  console.error("DB init failed:", err);
  process.exit(1);
});
