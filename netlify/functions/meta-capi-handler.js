const crypto = require('crypto');
const fetch = require('node-fetch');

// Kunci-kunci rahasia ini akan kita ambil dari Netlify Environment Variables
const LYNK_MERCHANT_KEY = process.env.LYNK_MERCHANT_KEY;
const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_CAPI_ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;

// Fungsi untuk memvalidasi signature dari Lynk.id
function validateLynkSignature(ref_id, amount, message_id, receivedSignature, secretKey) {
  const signatureString = String(amount) + ref_id + message_id + secretKey;
  const calculatedSignature = crypto.createHash('sha256').update(signatureString, 'utf-8').digest('hex');
  return calculatedSignature === receivedSignature;
}

// Handler utama untuk webhook
exports.handler = async (event) => {
  // 1. Validasi metode request
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // 2. Ekstrak data dari Lynk.id dan header
    const receivedSignature = event.headers['x-lynk-signature'];
    const body = JSON.parse(event.body);

    // Pastikan event adalah 'payment.received'
    if (body.event !== 'payment.received') {
        return { statusCode: 200, body: 'Event is not a payment, ignored.' };
    }

    const { refId } = body.data.message_data;
    const { grandTotal } = body.data.message_data.totals;
    const { message_id } = body.data;
    const { email, phone, name } = body.data.message_data.customer;

    // 3. Verifikasi signature untuk keamanan
    if (!validateLynkSignature(refId, grandTotal, message_id, receivedSignature, LYNK_MERCHANT_KEY)) {
      console.error('Invalid signature');
      return { statusCode: 401, body: 'Unauthorized: Invalid signature' };
    }

    // 4. Jika valid, siapkan data untuk dikirim ke Meta CAPI
    const eventData = {
      data: [
        {
          event_name: 'Purchase',
          event_time: Math.floor(Date.now() / 1000),
          event_source_url: `https://lynk.id/middleverse/${refId}`, // URL sebagai konteks
          user_data: {
            em: [crypto.createHash('sha256').update(email.toLowerCase()).digest('hex')],
            ph: [crypto.createHash('sha256').update(phone).digest('hex')],
          },
          custom_data: {
            currency: 'IDR',
            value: grandTotal,
          },
          action_source: 'website',
        },
      ],
    };

    // 5. Kirim data ke Meta Conversion API
    const url = `https://graph.facebook.com/v18.0/${META_PIXEL_ID}/events?access_token=${META_CAPI_ACCESS_TOKEN}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventData),
    });

    const responseData = await response.json();

    if (!response.ok) {
        console.error('Meta CAPI Error:', responseData);
        throw new Error('Failed to send event to Meta CAPI');
    }

    console.log('Event sent to Meta CAPI successfully:', responseData);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (error) {
    console.error('Error processing webhook:', error);
    return { statusCode: 500, body: `Internal Server Error: ${error.message}` };
  }
};
