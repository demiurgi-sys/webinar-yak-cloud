const axios = require("axios");

async function sendEvent({ eventName, eventId, fbp, fbc, clientIp, clientUserAgent, pageUrl, customData = {} }) {
  const payload = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      event_source_url: pageUrl,
      action_source: "website",
      user_data: {
        fbp: fbp || undefined,
        fbc: fbc || undefined,
        client_ip_address: clientIp,
        client_user_agent: clientUserAgent,
      },
      custom_data: customData,
    }],
  };

  await axios.post(
    `https://graph.facebook.com/v26.0/${process.env.FB_PIXEL_ID}/events?access_token=${process.env.FB_ACCESS_TOKEN}`,
    payload
  );
}

module.exports = { sendEvent };
