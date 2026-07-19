const apiVersion = process.env.WHATSAPP_API_VERSION || 'v23.0';

export async function sendWhatsAppImage({ phone, imageUrl, caption }) {
  if (process.env.WHATSAPP_ENABLED !== 'true') {
    return { skipped: true, providerMessageId: null };
  }

  const endpoint = `https://graph.facebook.com/${apiVersion}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'image',
      image: {
        link: imageUrl,
        caption
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'WhatsApp image send failed.');
  }

  return { skipped: false, providerMessageId: data.messages?.[0]?.id || null };
}

export async function sendWhatsAppText({ phone, body }) {
  if (process.env.WHATSAPP_ENABLED !== 'true') {
    return { skipped: true, providerMessageId: null };
  }

  const endpoint = `https://graph.facebook.com/${apiVersion}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'WhatsApp text send failed.');
  }

  return { skipped: false, providerMessageId: data.messages?.[0]?.id || null };
}
